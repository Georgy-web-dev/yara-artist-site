# Design

## Visual Theme

Persona-style game-UI language (diagonal cuts, shard wipes, HUD chapters) now carried by a **hot pink / electric violet** palette on a deep plum near-black — the client rejected first orange, then teal/violet, then the midnight-blue P3R pass; pink-violet was their own call and happens to match both her stage-lighting photography and the teenage-pop-artist register better than any previous round. One hot signature color (magenta pink) does all the shouting; electric violet is its counterpart in shard wipes and offset shadows.

## Color (approx hex — see `css/style.css` `:root` for source of truth)

| Role | Hex | Use |
|---|---|---|
| `--bg` | #140a1c | Page base, near-black deep plum |
| `--bg-deep` | #0c0512 | Preloader, darkest shard |
| `--surface` | #221430 | Cards, panels, buttons |
| `--surface-raised` | #34204a | Borders, elevated panels |
| `--ink` | #f8eefb | Primary text, pink-tinted white |
| `--ink-muted` | #b7a0c9 | Secondary text, muted lilac |
| `--signature` (hot pink) | #e02d92 | The one hot color — CTAs, active HUD, wipe shards, title shadow, quote band |
| `--signature-light` | #ff9fd6 | Light pink — highlights, card borders, dust particles, ghost number stroke |
| `--violet` | #7a3df0 | Electric violet — secondary shard color, second video's offset shadow |
| `--violet-light` | #c9b2ff | Soft lavender accents |

Body text always resolves to `--ink` (not `--ink-muted`) at 16px+; `--ink-muted` is reserved for captions/metadata ≥14px bold or ≥18px.

## Typography

- **Display**: Bricolage Grotesque (variable, Google Fonts) — bold, slightly quirky, carries the "vivid/theatrical" personality without reflex fonts (Playfair/Fraunces territory, which the old site used and we're deliberately dropping).
- **Body**: Manrope (Google Fonts) — geometric warmth, strong Cyrillic + Latin + acceptable Chinese fallback pairing with a system CJK stack for the `zh` locale.
- Scale: fluid `clamp()`, ratio ≥1.25 between steps. Hero title clamps ≤6rem.
- Light-on-dark line-height bumped +0.08 over default per body copy block.

## Layout

Rebuilt (July 2026) as a **game shell**, not a scrolling page — client brief: "a game that pulls you in, not a regular page; visual storytelling; we don't even need half the info."

- **Game mode** (desktop, fine pointer, motion OK): seven fullscreen chapters, no free scroll. Wheel / arrow keys / swipe / HUD clicks switch chapters through a fullscreen diagonal shard wipe. Chapters: 01 Title (hero video) → 02 Story → 03 World Tour (3 expanding level-select panels: China / France / TV) → 04 Gallery (one unified card-deck of 25 photos — the Stage/Studio/Life split was dropped as unnecessary; wheel cycles cards, non-front cards idle with a slight skewed sway like floating objects, rotation progresses with distance — face-on → 45° → past-edge → back-only, card backs carry the old YARA promo vector (`img/yara-promo.svg`) tinted pink via CSS mask over a hatched pattern; a second push at the deck edge exits the chapter) → 05 Cutscenes (two YouTube embeds side by side: «Заспівайте, Мамо» + «Joker Of Trumps») → 06 Soundtrack (tracklist rows) → 07 Contact.
- **Flow mode** (mobile / reduced motion / no GSAP): the same chapters as normal vertically scrolling sections with scroll-snap, gallery becomes a native horizontal snap strip, wipes and dust disabled. Mode is chosen pre-paint by an inline head script (`.mode-game` / `.mode-flow` on `<html>`); crossing the boundary reloads.
- HUD: fixed logo + language switcher on top, right-edge chapter rail (numbers, expanding labels), giant outlined ghost chapter number bottom-left.
- Content deliberately cut for visual storytelling: team roster, stat counters, and languages line are dropped from the screens (i18n keys retained in js/i18n.js for future use).

## Motion

- **Wave wipe** is the core event (replaced the earlier straight shard panels): a three-layer SVG sea wave (violet depth → pink body → ink foam) washes across the viewport on every chapter switch. Edges are built from three sampled sine harmonics (curling lobes that churn as the wave travels, phase driven by wave position) and roughened by an feTurbulence displacement filter; white foam-spray droplets burst off the crest at the covered moment and mid-recede. On recede the stagger reverses (foam exits first) so the exit edge reads dark, not a white flash. Entrance timelines are created AT the covered moment with `immediateRender: true` defaults, so all from-states apply under full cover — the wave always recedes over already-hidden/animating content, never over a final-state frame (this was the "page loads, then animates" bug). Initial page load reuses the same system: the wave starts fully covering, the preloader vanishes behind it.
- Every chapter has a bespoke entrance timeline fired as the wipe clears: title chars slam with rotation, story quote band scales from zero width, tour panels launch from below with skew, deck cards deal out from a center pile, tracks fly in from alternating sides. All `back.out`/`power4` at 0.3–0.55s.
- Idle life: ambient dust canvas (46 drifting blue slivers), blinking "press start" prompt, angled marquee band on the title, click-burst shards at the cursor on every click.
- Lenis and ScrollTrigger removed — no scroll to smooth in game mode; flow mode uses IntersectionObserver reveals (default state stays visible; `.will-reveal` is added only when the observer is armed).
- Preloader: video-buffer-gated, 5s hard cap, SVG stroke logo draw.
- Reduced motion always lands in flow mode: no wipes, no dust, no card fan, instant states.

## Components

- **Nav**: fixed, transparent over hero, solid `--surface` after scroll past hero, language switcher (UA/EN/CH) + anchor links.
- **Gallery tabs**: pill-style tab bar, active tab underlined in `--signature`, lightbox on click (keyboard-navigable, focus-trapped).
- **Gallery items / music cards**: tarot-card corner index marks (Persona 3 motif) fade in on hover — thin corner brackets in `--signature-light`, not a full card border.
- **Achievement cards**: no default card-grid cliché — International Experience renders as a vertical timeline (real sequence: Tianjin 2024 → France → TV feature), each with a photo, not icon+heading+text tiles.
- **Music placeholder cards**: track title + "Coming soon" state, no fake player controls.
- **Team disclosure**: single closed `<details>`-style reveal, not a hidden-by-JS section (keeps it accessible/indexable, just visually quiet).
- **Section backgrounds**: diagonal feathered energy bands (gradient + blur, rotated ±5–7°) instead of round blurred glow blobs — reads as a fast cut rather than ambient light.
