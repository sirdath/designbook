---
name: design-book
description: Compose tasteful, verification-gated web pages, mobile app flows, slide decks, and architecture diagrams from the frontendmaxxing vault — the Design Book method. Use when asked to design/build a page, landing, dashboard, app screen flow, pitch deck, or diagram, or to make a UI look intentional rather than AI-generated. Teaches the deterministic compose discipline + the save-gate checklist. Pairs with the Design Book MCP, which actually runs the headless gate.
---

# Design Book — compose design that proves itself

The Design Book method turns a huge snippet vault into **one tasteful, coherent,
verified page** — by composing deterministically and *gating on render-truth*,
not by free-styling markup. This skill teaches the method so any agent (Cursor,
Codex, Claude Code) can follow it. The **moat is verification**: a page isn't done
until it renders clean. A markdown skill can't run that gate — see *Honest limit*
at the bottom — but it can hold you to the discipline.

## The loop (do this in order)

1. **Pick a genre.** Each genre has a fixed section *sequence* — the skeleton.
   See [`docs/genres.md`](docs/genres.md) (web · mobile · deck). For a system
   diagram or a spec, use the `diagram` / `plan` genres.
2. **Commit to ONE taste.** A single aesthetic + palette + font-pair + motion +
   density, applied on `<body>`:
   ```html
   <body class="struct pal-<palette>" data-aesthetic="<a>" data-font-pair="<f>" data-motion="<m>" data-density="<d>">
   ```
   Mixing two aesthetics on one page is the #1 "generated-looking" tell. Pick a
   preset (resolves all axes at once) from [`docs/taste.md`](docs/taste.md).
3. **Fill each slot from the vault**, not from scratch. Reach for the genre's
   section shells (`.s-*` from `structure.css`) and real snippets; reuse the
   palette tokens (`var(--accent|--surface|--fg|--muted|--border)`) for every color.
4. **Run the save-gate checklist before claiming done** (below). Fix what it flags.

## The save-gate checklist (the moat)

A page ships only when ALL hold — this is exactly what the MCP enforces headlessly:

- **Renders clean** — zero console errors, zero failed resources (your files + CDN libs).
- **No horizontal overflow** at phone width (393px).
- **No undefined CSS vars** — every `var(--x)` resolves.
- **Nothing invisible/collapsed** — no `opacity:0` content left un-revealed.
- **Coherence ≥ 70** — the anti-slop score (below).
- **Imagery floor** for visual-first genres (ecommerce/portfolio/restaurant/agency/
  landing): at least one real image, not a grey placeholder.

## Coherence — the anti-slop rules

Every "don't" has a token-based "do":

- One **accent** hue for the whole page (`var(--accent)`), not a different color per
  section (rainbow soup = hard fail). Pull all color from the palette tokens — never
  hardcode hex.
- **Real imagery**, not gradient-only — a gradient-heavy page with no images is *the*
  AI tell (hard fail). A substantial inline `<svg>` (e.g. a diagram) counts as imagery.
- **Flat gradients** (two near-identical stops) read fake — use a real hue/lightness
  delta or a solid fill.
- Blessed motion only — `var(--m-dur-fast|--m-dur|--m-dur-slow)` (90–480ms), never
  random `0.3s`/`450ms`. No `transform:scale(1.05)` card hover — lift with
  `translateY` + elevation.
- Radius via `var(--radius)` / `var(--radius-sm)`, never literal px.

## What's in this skill

- [`docs/genres.md`](docs/genres.md) — every genre's section sequence (web/mobile/deck),
  generated from the live engine.
- [`docs/taste.md`](docs/taste.md) — aesthetics, the ~12 presets, and all palettes.
- `build-skill.mjs` — regenerates those docs from the engine; `--check` fails if they
  drift. (Run it after changing genres/presets so this skill never lies.)

## Honest limit + the funnel

**This markdown skill cannot run the headless save-gate.** It teaches the method and
the checklist, but verifying that a page *actually renders clean* needs the **Design
Book MCP** — `book_compose` (deterministic scaffold), `book_save_page` (the headless
gate), `book_inspect` (layout/render facts), `book_coherence`, `book_export_pptx`
(deck → editable PowerPoint), `book_lottie` (validate animations). Install the MCP for
real verification; use this skill when the MCP isn't available and hold yourself to the
checklist by hand.
