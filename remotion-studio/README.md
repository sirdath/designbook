# remotion-studio

The **isolated Remotion sub-project** behind Design Book's `book_video_*` pipeline.

It lives apart from the designbook core on purpose: the core is zero-build vanilla
ESM + `node:http`, while Remotion needs a Webpack/React/TSX toolchain plus Puppeteer
and a Chrome-Headless-Shell (hundreds of MB). Keeping all of that here, with its own
`package.json` and `node_modules`, preserves the core's minimal-dep invariant.
`designbook/lib/video.js` lazy-imports `@remotion/bundler` + `@remotion/renderer`
from this folder by absolute path, and **degrades to `{skipped}` when this project
isn't installed** — exactly like `lib/imagegen.js` does for mflux.

## What it renders

A **video plan** (the JSON produced by `designbook/lib/videoplan.js`) is passed as
Remotion `inputProps`. `src/Root.tsx` maps `plan.scenes[]` into a `TransitionSeries`,
one `<Series.Sequence>` per scene. `renderStill({frame})` gives one frame (the *facts*
for `book_video_inspect`/`book_video_critique`); `renderMedia()` gives the MP4.

## Determinism law

Every scene is frame-deterministic: motion comes **only** from `useCurrentFrame()`,
`interpolate(…, {extrapolateLeft:'clamp', extrapolateRight:'clamp'})`, `spring()`, and
Remotion's seeded `random()`. **Never** `Math.random()`, `Date.now()`, CSS animations/
transitions, or `requestAnimationFrame` — those make the critiqued still and the
rendered frame diverge, collapsing facts-before-pixels.

## Provenance / licensing

The scene templates in `src/scenes/` are **reimplemented from scratch**. The
architecture *ideas* (a single self-contained frame-driven `.tsx` per scene; a small
theme-token map selected by a variant string) are unprotectable and were informed by
surveying the ecosystem — but **no third-party source was copied**. In particular,
`github.com/locomotion-pro/locomotion` is **unlicensed** (all-rights-reserved) and was
used only as conceptual reference, never vendored. Remotion itself is free for
individuals and teams ≤3 (Design Book's case); a paid Company License applies at 4+
employees — see remotion.dev/license.

## Install

```
cd remotion-studio && npm install
```

Heavy (Puppeteer + Chrome-Headless-Shell). Until it's installed, `book_video_compose`
(the deterministic plan composer) still works fully; only the render/critique/refine
tools report `{skipped}`.
