(function () {
  "use strict";

  /* ============================================================
     Mode: "game" = fullscreen chapter engine, "flow" = native scroll.
     The class was set pre-paint by the inline <head> script; if GSAP
     failed to load we downgrade to flow so nothing depends on it.
     ============================================================ */
  const root = document.documentElement;
  if (root.classList.contains("mode-game") && typeof gsap === "undefined") {
    root.classList.replace("mode-game", "mode-flow");
  }
  const isGame = root.classList.contains("mode-game");
  const hasGsap = typeof gsap !== "undefined";

  // A mode-boundary change (resize past 960px, reduced-motion toggle)
  // rebuilds the page in the right mode.
  window.matchMedia("(min-width: 961px) and (pointer: fine)")
    .addEventListener("change", () => location.reload());
  window.matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", () => location.reload());

  const pad = (n) => String(n).padStart(2, "0");

  /* ---------------- i18n ---------------- */
  let currentLang = "ua";

  function applyLang(lang) {
    currentLang = lang;
    root.lang = lang === "ch" ? "zh" : lang;
    const dict = I18N[lang] || I18N.ua;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === lang);
    });
    deckBuild(false);
  }

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyLang(btn.dataset.lang));
  });

  /* ---------------- Chapter engine ---------------- */
  const screens = Array.from(document.querySelectorAll(".screen"));
  const ghostNum = document.getElementById("ghostNum");
  const hudLinks = document.querySelectorAll(".hud-link");
  let current = 0;
  let transitioning = false;
  let wheelLock = false;

  function syncHud() {
    hudLinks.forEach((l) => l.classList.toggle("active", Number(l.dataset.go) === current));
  }

  /* ---------------- Wave wipe ----------------
     A band with two wavy edges sweeps across the viewport: the leading edge
     washes the old chapter away, the trailing edge recedes over the new one.
     Three layers (violet depth, pink body, ink foam) run slightly offset. */
  const wipeSvg = document.getElementById("wipe");
  const WAVE_LAYERS = wipeSvg ? [
    { el: wipeSvg.querySelector(".wave-violet"), amp: 9, off: 0 },
    { el: wipeSvg.querySelector(".wave-pink"), amp: 6, off: 0.07 },
    { el: wipeSvg.querySelector(".wave-froth"), amp: 8, off: 0.11, fizz: true, pad: 3.5 },
    { el: wipeSvg.querySelector(".wave-foam"), amp: 5, off: 0.13, bubbles: true }
  ] : [];
  WAVE_LAYERS.forEach((L) => { L.le = -70; L.te = -80; });

  // Foam bubbles: circles riding both edges of the foam layer, some breaking
  // loose ahead of the crest
  const bubblesGroup = document.getElementById("waveBubbles");
  const WAVE_BUBBLES = [];
  if (isGame && bubblesGroup) {
    for (let i = 0; i < 34; i++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const edge = i % 2 ? "le" : "te";
      const b = {
        el: c,
        edge,
        y: Math.random() * 100,
        // le-edge bubbles break forward into uncovered space, te-edge ones
        // linger over freshly revealed content
        off: edge === "le" ? gsap.utils.random(-3, 8) : gsap.utils.random(-8, 3),
        r: gsap.utils.random(0.35, 1.4),
        seed: Math.random() * 6.28
      };
      c.setAttribute("r", b.r.toFixed(2));
      c.setAttribute("opacity", gsap.utils.random(0.45, 0.95).toFixed(2));
      bubblesGroup.appendChild(c);
      WAVE_BUBBLES.push(b);
    }
  }

  // Real-sea edge: three sine harmonics sampled down the viewport give each
  // boundary curling lobes and fingers; the phase is driven by the wave's own
  // position, so the lobes churn while the wave travels instead of sliding
  // as a frozen silhouette. An feTurbulence displacement roughs up the edges.
  function edgeW(y, amp, ph, fizz) {
    let w =
      Math.sin(y * 0.115 + ph) * amp +
      Math.sin(y * 0.31 + ph * 1.7 + 1.3) * amp * 0.45 +
      Math.sin(y * 0.052 + ph * 0.6 + 4.1) * amp * 0.8;
    if (fizz) {
      // high-frequency fizz: small frothy fingers on top of the big lobes
      w += Math.sin(y * 0.95 + ph * 2.3) * amp * 0.35 +
           Math.sin(y * 1.7 + ph * 3.1 + 2.2) * amp * 0.2;
    }
    return w;
  }

  function edgePoints(x, amp, ph, fizz) {
    const pts = [];
    for (let y = 0; y <= 100; y += 5) {
      pts.push([+(x + edgeW(y, amp, ph, fizz)).toFixed(2), y]);
    }
    return pts;
  }

  function smoothLine(pts) {
    let d = "";
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(2);
      const yc = ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(2);
      d += ` Q ${pts[i][0]} ${pts[i][1]}, ${xc} ${yc}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L ${last[0]} ${last[1]}`;
  }

  function bandPath(te, le, amp, ph, fizz) {
    const left = edgePoints(te, amp, ph, fizz);
    const right = edgePoints(le, amp * 1.3, ph + 2.4, fizz).reverse();
    return `M ${left[0][0]} ${left[0][1]}` + smoothLine(left) +
      ` L ${right[0][0]} ${right[0][1]}` + smoothLine(right) + " Z";
  }

  function drawWave(L) {
    const ph = (L.le + L.te) * 0.16 + L.off * 9;
    const pad = L.pad || 0;
    L.el.setAttribute("d", bandPath(L.te - pad, L.le + pad, L.amp, ph, L.fizz));
    if (L.bubbles) updateBubbles(L, ph);
  }

  function updateBubbles(L, ph) {
    for (const b of WAVE_BUBBLES) {
      const base = b.edge === "le" ? L.le : L.te;
      const w = b.edge === "le"
        ? edgeW(b.y, L.amp * 1.3, ph + 2.4, true)
        : edgeW(b.y, L.amp, ph, true);
      const cx = base + w + b.off;
      if (cx < -6 || cx > 106) {
        b.el.setAttribute("cx", -20);
        continue;
      }
      const cy = b.y + Math.sin(ph * 2 + b.seed) * 1.4;
      b.el.setAttribute("cx", cx.toFixed(2));
      b.el.setAttribute("cy", cy.toFixed(2));
    }
  }
  if (isGame) WAVE_LAYERS.forEach(drawWave);

  // Foam spray: white droplets bursting off the wave edge
  function spray(xvw, count) {
    for (let i = 0; i < count; i++) {
      const s = document.createElement("i");
      s.className = "spray";
      document.body.appendChild(s);
      const x0 = (xvw + gsap.utils.random(-6, 6)) * window.innerWidth / 100;
      const y0 = gsap.utils.random(0.05, 0.95) * window.innerHeight;
      const size = gsap.utils.random(3, 9);
      gsap.set(s, { x: x0, y: y0, width: size, height: size });
      gsap.to(s, {
        x: x0 + gsap.utils.random(30, 170),
        y: y0 + gsap.utils.random(-80, 140),
        scale: gsap.utils.random(0.1, 0.4),
        opacity: 0,
        duration: gsap.utils.random(0.45, 0.8),
        ease: "power2.out",
        onComplete: () => s.remove()
      });
    }
  }

  // Full transition: wash over -> onCovered (swap + arm entrances while the
  // screen is fully hidden) -> recede. Entrance from-states are applied at
  // the covered moment, so the wave always recedes over ALREADY-HIDDEN
  // content and nothing ever flashes in its final state.
  function waveTransition(onCovered, onDone) {
    const tl = gsap.timeline({ onComplete: onDone });
    WAVE_LAYERS.forEach((L) => { L.le = -70; L.te = -80; drawWave(L); });
    WAVE_LAYERS.forEach((L) => {
      tl.to(L, { le: 170, duration: 0.28, ease: "power2.in", onUpdate: () => drawWave(L) }, L.off * 0.5);
    });
    tl.addLabel("covered")
      .add(() => { onCovered(); spray(78, 18); }, "covered");
    // reversed stagger on the way out: foam recedes first, violet trails,
    // so the recede reads as a dark wave edge instead of a white flash
    WAVE_LAYERS.forEach((L) => {
      tl.to(L, { te: 170, duration: 0.32, ease: "power2.out", onUpdate: () => drawWave(L) }, `covered+=${0.03 + (0.13 - L.off) * 0.5}`);
    });
    tl.add(() => spray(52, 10), "covered+=0.16");
    return tl;
  }

  function goTo(next) {
    if (!isGame) {
      const target = screens[next];
      if (target) target.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (next < 0 || next >= screens.length || next === current || transitioning) return;
    transitioning = true;
    const prev = current;
    current = next;
    syncHud();

    waveTransition(() => {
      screens[prev].classList.remove("active");
      screens[current].classList.add("active");
      ghostNum.textContent = pad(current + 1);
      prepareEnter(screens[current]);
      playEnter(screens[current]); // from-states render NOW, under full cover
    }, () => { transitioning = false; });
  }

  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      goTo(Number(el.dataset.go));
    });
  });

  /* ---------------- Entrance choreography ---------------- */
  let enterTl = null;

  function prepareEnter(screen) {
    if (enterTl) enterTl.kill();
    // Everything gets its state set inside playEnter's from-tweens;
    // prepare only handles the deck, whose layout is JS-driven.
    if (screen.id === "gallery") deckScatter();
  }

  function playEnter(screen) {
    if (!hasGsap) return;
    // immediateRender: every from-tween applies its hidden start state the
    // instant this timeline is created (i.e., while the wave still covers
    // the screen), even for tweens positioned later on the timeline.
    const tl = gsap.timeline({ defaults: { immediateRender: true } });
    enterTl = tl;
    const heading = screen.querySelector(".scr-heading");
    if (heading) {
      tl.from(heading, { x: -90, skewX: 10, opacity: 0, duration: 0.45, ease: "power4.out", clearProps: "all" }, 0);
    }
    switch (screen.id) {
      case "title": {
        // lift the CSS pre-hide the instant the timeline owns the elements
        tl.set([".title-core", ".title-band", ".press-start", ".sound-toggle"], { visibility: "visible" }, 0);
        const chars = screen.querySelectorAll(".title-word span");
        if (chars.length) {
          tl.from(chars, {
            yPercent: 110, scale: 1.5, opacity: 0,
            rotation: () => gsap.utils.random(-24, 24),
            duration: 0.55, stagger: 0.035, ease: "back.out(1.9)"
          }, 0.05);
        }
        tl.from(".title-kicker", { y: 34, opacity: 0, scale: 0.7, duration: 0.4, ease: "back.out(1.8)" }, 0.3)
          .from(".title-tag", { y: 30, opacity: 0, duration: 0.4, ease: "back.out(1.6)" }, 0.42)
          .from(".title-band", { yPercent: 240, rotation: -7, duration: 0.5, ease: "power4.out", clearProps: "transform" }, 0.5)
          .from(".press-start, .sound-toggle", { opacity: 0, duration: 0.4 }, 0.75);
        break;
      }
      case "about":
        tl.from(".story-bio", { x: -70, opacity: 0, duration: 0.45, ease: "power4.out" }, 0.1)
          .fromTo(".story-quote", { scaleX: 0, transformOrigin: "left center" },
            { scaleX: 1, duration: 0.4, ease: "power4.out" }, 0.22)
          .from(".story-quote p", { opacity: 0, duration: 0.3 }, 0.45)
          .from(".story-portrait", { xPercent: 45, opacity: 0, rotation: 3, duration: 0.55, ease: "power4.out", clearProps: "transform,opacity" }, 0.08);
        break;
      case "experience":
        tl.from(".tour-panel", {
          yPercent: 120, opacity: 0, skewY: 5,
          duration: 0.55, stagger: 0.09, ease: "back.out(1.3)", clearProps: "transform,opacity"
        }, 0.12)
          .from(".tour-marker", { scale: 0, rotation: -120, duration: 0.4, stagger: 0.08, ease: "back.out(2.4)", clearProps: "transform" }, 0.45);
        break;
      case "gallery":
        deckDeal(0.15);
        tl.from(".deck-hud", { opacity: 0, y: 16, duration: 0.35, clearProps: "all" }, 0.55);
        break;
      case "video":
        tl.from(".cut-bands i", { xPercent: (i) => (i === 0 ? -130 : 130), duration: 0.5, ease: "power4.out" }, 0)
          .from(".cut-video", {
            y: 90, opacity: 0, scale: 0.85, rotation: (i) => (i === 0 ? -2 : 2),
            duration: 0.5, stagger: 0.12, ease: "back.out(1.5)", clearProps: "transform,opacity"
          }, 0.15)
          .from(".cut-title", { opacity: 0, y: 20, duration: 0.35, stagger: 0.1, clearProps: "all" }, 0.55);
        break;
      case "music":
        tl.from(".track", {
          x: (i) => (i % 2 ? 130 : -130), opacity: 0, skewX: (i) => (i % 2 ? -8 : 8),
          duration: 0.42, stagger: 0.06, ease: "power4.out", clearProps: "transform,opacity"
        }, 0.12);
        break;
      case "contact":
        tl.from(".contact-mail", { y: 56, opacity: 0, scale: 0.92, duration: 0.45, ease: "back.out(1.7)", clearProps: "transform,opacity" }, 0.12)
          .from(".contact-item", { y: 30, opacity: 0, duration: 0.35, stagger: 0.08, ease: "back.out(1.6)", clearProps: "all" }, 0.3)
          .from(".social-link", { y: 26, opacity: 0, scale: 0.5, duration: 0.32, stagger: 0.06, ease: "back.out(2.2)", clearProps: "transform,opacity" }, 0.45)
          .from(".copyright", { opacity: 0, duration: 0.3 }, 0.7);
        break;
    }
    return tl;
  }

  // Title word split (game mode only; flow mode keeps plain text)
  if (isGame) {
    const titleEl = document.querySelector("[data-split-chars]");
    if (titleEl) {
      const text = titleEl.textContent;
      titleEl.innerHTML = "";
      text.split("").forEach((ch) => {
        const span = document.createElement("span");
        span.textContent = ch;
        span.style.display = "inline-block";
        titleEl.appendChild(span);
      });
    }
  }

  /* ---------------- Input: wheel / keys / touch ---------------- */
  function lightboxOpen() {
    return lightbox.classList.contains("open");
  }

  window.addEventListener("wheel", (e) => {
    if (!isGame || transitioning || lightboxOpen()) return;
    if (Math.abs(e.deltaY) < 20) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    if (current === 3 && deckConsumes(dir)) return;
    if (wheelLock) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 650);
    goTo(current + dir);
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (lightboxOpen()) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lbStep(-1);
      if (e.key === "ArrowRight") lbStep(1);
      return;
    }
    if (!isGame || transitioning) return;
    if (["ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); goTo(current + 1); }
    else if (["ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); goTo(current - 1); }
    else if (e.key === "ArrowRight" && current === 3) deckGo(deckIndex + 1);
    else if (e.key === "ArrowLeft" && current === 3) deckGo(deckIndex - 1);
  });

  let touchY = 0, touchX = 0;
  window.addEventListener("touchstart", (e) => {
    touchY = e.touches[0].clientY;
    touchX = e.touches[0].clientX;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (!isGame || transitioning || lightboxOpen()) return;
    const dy = touchY - e.changedTouches[0].clientY;
    const dx = touchX - e.changedTouches[0].clientX;
    if (current === 3 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      deckGo(deckIndex + (dx > 0 ? 1 : -1));
      return;
    }
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) goTo(current + (dy > 0 ? 1 : -1));
  }, { passive: true });

  /* ---------------- Gallery deck (one unified pile, 25 photos) ---------------- */
  const PHOTO_COUNT = 25;
  const deckStage = document.getElementById("deckStage");
  const deckCounter = document.getElementById("deckCounter");
  let deckIndex = 0;
  let deckCards = [];
  let deckLock = false;
  let edgeArmed = 0;

  function deckSpacing() {
    return Math.min(230, Math.max(120, window.innerWidth * 0.115));
  }

  // Y-rotation by distance from the front card: face-on -> quarter turn ->
  // past edge-on -> mostly back -> back only, like a real fanned deck
  const DECK_ROT_STEPS = [0, 45, 100, 125, 145];
  function deckRotY(off) {
    if (off === 0) return 0;
    const step = DECK_ROT_STEPS[Math.min(Math.abs(off), DECK_ROT_STEPS.length - 1)];
    return -Math.sign(off) * step;
  }

  // Idle sway: non-front cards hang slightly skewed and lazily turn in 3D,
  // like floating playing cards; the front card stands straight.
  function startSway(card) {
    card._sway = gsap.to(card._inner, {
      rotation: () => gsap.utils.random(-5, 5),
      rotationY: () => gsap.utils.random(-6, 6),
      skewX: () => gsap.utils.random(-3, 3),
      y: () => gsap.utils.random(-10, 10),
      duration: () => gsap.utils.random(2.2, 3.8),
      yoyo: true, repeat: -1, repeatRefresh: true,
      ease: "sine.inOut",
      delay: Math.random() * -3
    });
  }

  function deckBuild(animate) {
    deckIndex = 0;
    deckStage.innerHTML = "";
    deckCards = [];
    const dict = I18N[currentLang] || I18N.ua;
    for (let i = 1; i <= PHOTO_COUNT; i++) {
      const card = document.createElement("div");
      card.className = "deck-card";
      const inner = document.createElement("div");
      inner.className = "deck-card-inner";
      const faceFront = document.createElement("div");
      faceFront.className = "deck-face deck-face-front";
      const img = document.createElement("img");
      img.src = `img/gallery/photos/photo-${pad(i)}.jpg`;
      img.alt = `YARA · ${dict["gallery.title"] || "Gallery"} ${i}`;
      img.loading = "lazy";
      faceFront.appendChild(img);
      const faceBack = document.createElement("div");
      faceBack.className = "deck-face deck-face-back";
      faceBack.innerHTML = '<span class="deck-back-art"></span>';
      inner.appendChild(faceBack);
      inner.appendChild(faceFront);
      card.appendChild(inner);
      card._inner = inner;
      card._front = undefined;
      const idx = i - 1;
      card.addEventListener("click", () => {
        if (!isGame) { openLightbox(idx); return; }
        if (idx === deckIndex) openLightbox(idx);
        else deckGo(idx);
      });
      deckStage.appendChild(card);
      deckCards.push(card);
    }
    updateDeckCounter();
    if (isGame) {
      if (animate) { deckScatter(); deckDeal(0); }
      else deckLayout(false);
    }
  }

  function deckLayout(animate, extraDelay) {
    if (!isGame) return;
    const spacing = deckSpacing();
    deckCards.forEach((card, i) => {
      const off = i - deckIndex;
      const abs = Math.abs(off);
      card.style.zIndex = 100 - abs;
      card.classList.toggle("is-front", off === 0);
      gsap.to(card, {
        xPercent: -50,
        yPercent: -50,
        x: off * spacing,
        y: abs * 14,
        z: -abs * 34,
        rotation: off * 5,
        rotationY: deckRotY(off),
        scale: Math.max(0.55, 1 - abs * 0.12),
        opacity: abs > 6 ? 0 : 1,
        duration: animate ? 0.5 : 0,
        delay: animate ? abs * 0.03 + (extraDelay || 0) : 0,
        ease: "back.out(1.4)",
        overwrite: true
      });
      // sway state machine: straighten the front card, let the rest float
      const front = off === 0;
      if (front !== card._front) {
        card._front = front;
        if (front) {
          if (card._sway) { card._sway.kill(); card._sway = null; }
          gsap.to(card._inner, { rotation: 0, rotationY: 0, skewX: 0, y: 0, duration: 0.4, ease: "power2.out" });
        } else {
          gsap.killTweensOf(card._inner);
          startSway(card);
        }
      }
    });
  }

  // Pre-entrance: pile every card in the middle, FACE DOWN (deck back showing);
  // the deal then flips each card open as it flies to its fan position
  function deckScatter() {
    if (!isGame || !deckCards.length) return;
    gsap.set(deckCards, {
      xPercent: -50, yPercent: -50,
      x: 0, y: 46, scale: 0.4, opacity: 0,
      rotation: () => gsap.utils.random(-18, 18),
      rotationY: 180
    });
  }

  // Deal the pile out into the fan
  function deckDeal(delay) {
    deckLayout(true, delay || 0);
  }

  function deckGo(idx) {
    if (!isGame || deckLock) return;
    if (idx < 0 || idx >= deckCards.length || idx === deckIndex) return;
    deckLock = true;
    setTimeout(() => { deckLock = false; }, 320);
    deckIndex = idx;
    updateDeckCounter();
    deckLayout(true);
  }

  // Returns true when the deck consumed the wheel event
  function deckConsumes(dir) {
    const atEnd = dir > 0 && deckIndex >= deckCards.length - 1;
    const atStart = dir < 0 && deckIndex <= 0;
    if (!atEnd && !atStart) {
      deckGo(deckIndex + dir);
      return true;
    }
    const now = performance.now();
    if (now - edgeArmed < 2200) return false; // second push at the edge exits the deck
    edgeArmed = now;
    gsap.fromTo(deckStage, { y: 0 }, { y: dir * -16, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" });
    return true;
  }

  function updateDeckCounter() {
    if (deckCounter) deckCounter.textContent = `${pad(deckIndex + 1)} / ${pad(deckCards.length)}`;
  }

  document.querySelector(".deck-prev").addEventListener("click", () => deckGo(deckIndex - 1));
  document.querySelector(".deck-next").addEventListener("click", () => deckGo(deckIndex + 1));

  window.addEventListener("resize", () => { if (isGame) deckLayout(false); });

  /* ---------------- Lightbox ---------------- */
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = lightbox.querySelector(".lightbox-img");
  let lbIndex = 0;

  function openLightbox(index) {
    lbIndex = index;
    setLbImg(false);
    lightbox.classList.add("open");
    if (hasGsap && isGame) {
      gsap.fromTo(lightbox, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out" });
      gsap.fromTo(lightboxImg, { scale: 0.85, rotation: -2, opacity: 0 },
        { scale: 1, rotation: 0, opacity: 1, duration: 0.4, ease: "back.out(1.6)" });
    }
  }

  function setLbImg(animate) {
    const card = deckCards[lbIndex];
    if (!card) return;
    const img = card.querySelector("img");
    const apply = () => { lightboxImg.src = img.src; lightboxImg.alt = img.alt; };
    if (animate && hasGsap && isGame) {
      gsap.to(lightboxImg, {
        opacity: 0, x: -24, duration: 0.13, ease: "power2.in",
        onComplete: () => {
          apply();
          gsap.fromTo(lightboxImg, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.28, ease: "power3.out" });
        }
      });
    } else apply();
  }

  function lbStep(dir) {
    lbIndex = (lbIndex + dir + deckCards.length) % deckCards.length;
    setLbImg(true);
    if (isGame) { deckIndex = lbIndex; updateDeckCounter(); deckLayout(false); }
  }

  function closeLightbox() {
    if (hasGsap && isGame) {
      gsap.to(lightbox, {
        opacity: 0, duration: 0.2, ease: "power2.in",
        onComplete: () => {
          lightbox.classList.remove("open");
          gsap.set(lightbox, { clearProps: "opacity" });
        }
      });
    } else lightbox.classList.remove("open");
  }

  lightbox.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  lightbox.querySelector(".lightbox-prev").addEventListener("click", () => lbStep(-1));
  lightbox.querySelector(".lightbox-next").addEventListener("click", () => lbStep(1));

  /* ---------------- Ambient dust ---------------- */
  (function initDust() {
    if (!isGame) return;
    const canvas = document.getElementById("dust");
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0;
    const P = [];
    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);
    function spawn(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 12,
        r: 0.7 + Math.random() * 1.6,
        s: 0.18 + Math.random() * 0.55,
        a: 0.05 + Math.random() * 0.22,
        drift: (Math.random() - 0.5) * 0.35
      };
    }
    for (let i = 0; i < 46; i++) P.push(spawn(true));
    (function tick() {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ff9fd6";
      for (const p of P) {
        p.y -= p.s;
        p.x += p.drift;
        if (p.y < -14) Object.assign(p, spawn(false));
        ctx.globalAlpha = p.a;
        ctx.fillRect(p.x, p.y, p.r, p.r * 3.2);
      }
      requestAnimationFrame(tick);
    })();
  })();

  /* ---------------- Cursor glow + click burst ---------------- */
  const cursorGlow = document.getElementById("cursorGlow");
  if (isGame) {
    const glowX = gsap.quickTo(cursorGlow, "x", { duration: 0.5, ease: "power3.out" });
    const glowY = gsap.quickTo(cursorGlow, "y", { duration: 0.5, ease: "power3.out" });
    window.addEventListener("mousemove", (e) => { glowX(e.clientX); glowY(e.clientY); });

    document.addEventListener("click", (e) => {
      for (let i = 0; i < 4; i++) {
        const s = document.createElement("i");
        s.className = "burst-shard";
        document.body.appendChild(s);
        gsap.set(s, { x: e.clientX, y: e.clientY, rotation: Math.random() * 360 });
        gsap.to(s, {
          x: e.clientX + gsap.utils.random(-130, 130),
          y: e.clientY + gsap.utils.random(-130, 130),
          opacity: 0, scale: 0.2, duration: 0.5, ease: "power3.out",
          onComplete: () => s.remove()
        });
      }
    });
  }

  /* ---------------- Flow-mode reveals ---------------- */
  if (!isGame && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(
      ".scr-heading, .story-bio, .story-quote, .story-portrait, .tour-panel, .cut-item, .track, .contact-mail, .contact-item, .social-links"
    ).forEach((el) => {
      el.classList.add("will-reveal");
      io.observe(el);
    });
  }

  /* ---------------- Hero video + preloader ---------------- */
  const preloader = document.getElementById("preloader");
  const preloaderFill = document.getElementById("preloaderFill");
  const heroVideo = document.getElementById("heroVideo");
  const soundToggle = document.getElementById("soundToggle");

  const source = heroVideo.querySelector("source");
  const smallScreen = window.matchMedia("(max-width: 760px)").matches;
  source.src = smallScreen ? source.dataset.srcMobile : source.dataset.srcDesktop;
  heroVideo.load();

  const PRELOAD_TIMEOUT_MS = 5000;
  let revealed = false;

  function revealSite() {
    if (revealed) return;
    revealed = true;
    // Wait for display fonts too (capped) -- otherwise the entrance can play
    // on fallback glyphs and the swap reads as "page loaded, then animated"
    const fontsReady = (document.fonts && document.fonts.status !== "loaded")
      ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))])
      : Promise.resolve();
    fontsReady.then(() => {
      heroVideo.play().catch(() => {});
      if (hasGsap && isGame) {
        // Load IS a wave transition: the wave is already covering the screen
        // when the preloader vanishes behind it; entrances arm under cover;
        // the wave recedes over content that is already animating in.
        transitioning = true;
        WAVE_LAYERS.forEach((L) => { L.le = 170; L.te = -80; drawWave(L); });
        preloader.classList.add("done");
        playEnter(screens[0]);
        gsap.delayedCall(0.4, introHud); // HUD flies in as the wave passes it
        const tl = gsap.timeline({ delay: 0.15, onComplete: () => { transitioning = false; } });
        WAVE_LAYERS.forEach((L) => {
          tl.to(L, { te: 170, duration: 0.4, ease: "power2.out", onUpdate: () => drawWave(L) }, (0.13 - L.off) * 0.5);
        });
      } else {
        preloader.classList.add("done");
      }
    });
  }

  function introHud() {
    gsap.set([".hud-top", ".hud-nav", ".hud-ghost"], { visibility: "visible" });
    gsap.from(".hud-top .logo, .hud-top .lang-switcher", {
      y: -44, opacity: 0, duration: 0.45, stagger: 0.08, ease: "power3.out", clearProps: "transform,opacity"
    });
    gsap.from(".hud-link", {
      x: 64, opacity: 0, duration: 0.4, stagger: 0.05, ease: "power3.out", clearProps: "transform,opacity"
    });
    gsap.from(".hud-ghost", { opacity: 0, scale: 1.15, duration: 0.6, ease: "power2.out", clearProps: "transform,opacity" });
  }

  let fakeProgress = 0;
  const progressTimer = setInterval(() => {
    fakeProgress = Math.min(fakeProgress + Math.random() * 18, 92);
    preloaderFill.style.width = fakeProgress + "%";
  }, 180);

  function bufferedEnough() {
    if (heroVideo.readyState >= 3) return true;
    try {
      const buf = heroVideo.buffered;
      if (buf.length && buf.end(0) > 1.5) return true;
    } catch (e) {}
    return false;
  }

  function tryReveal() {
    if (bufferedEnough()) {
      clearInterval(progressTimer);
      preloaderFill.style.width = "100%";
      setTimeout(revealSite, 150);
    }
  }

  heroVideo.addEventListener("canplaythrough", tryReveal);
  heroVideo.addEventListener("progress", tryReveal);
  heroVideo.addEventListener("error", revealSite);

  setTimeout(() => {
    clearInterval(progressTimer);
    preloaderFill.style.width = "100%";
    revealSite();
  }, PRELOAD_TIMEOUT_MS);

  soundToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    heroVideo.muted = !heroVideo.muted;
    const isMuted = heroVideo.muted;
    soundToggle.setAttribute("aria-pressed", (!isMuted).toString());
    soundToggle.querySelector(".icon-sound-off").hidden = !isMuted;
    soundToggle.querySelector(".icon-sound-on").hidden = isMuted;
  });

  /* ---------------- Init ---------------- */
  deckBuild(false);
  syncHud();
})();
