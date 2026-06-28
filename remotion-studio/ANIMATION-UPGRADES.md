# Remotion video — "cool animations" upgrade roadmap

Research-backed plan to push the video pipeline past its current 2D-DOM ceiling into
premium motion design. Verified against remotion.dev (June 2026).

## Three findings that shape everything

1. **The ceiling:** the motion system (`src/lib/`: LivingBackground, Camera, KineticText,
   anim.ts springs, Cursor/Typewriter) is strong but **entirely 2D DOM** — no 3D, no
   WebGL/shaders, no particles, no SVG path-draw, no data-viz, no motion-blur, no
   masking/morph grammar. That's the headroom.
2. **The accelerator:** the **vault already ships the hardest assets** — 18 GLSL shaders
   in `frontendmaxxing/shaders/`. `gradient-mesh.glsl.js` is literally a Stripe-style fBm
   mesh (time uniform); `gl-transition-runner.js` is already a two-texture, single-`progress`
   quad. These drop into `@remotion/three` / custom transitions with near-zero rewrite.
3. **No version bump:** `remotion@4.0.484` is installed; `@remotion/{three,motion-blur,
   paths,shapes,noise,lottie,skia,gif}` are one `npm i --save-exact` away. Free for ≤3-person
   operations; only the `cube()` transition is paid.

## The determinism law (non-negotiable for every upgrade)

Every animated value = pure `f(useCurrentFrame())` via `interpolate`/`spring`/**seeded**
noise. Shaders get `uTime = frame/fps` (never wall-clock). Replace every `Math.random()`
with Remotion `random(seed)` / `@remotion/noise` `noise2D/3D`. Never CSS-animation, never
R3F `useFrame()` clock. The stills-as-facts diagnosis depends on it.

## Prioritized upgrades (wow ÷ effort)

| # | Upgrade | API | Effort | Payoff |
|---|---|---|---|---|
| 1 | **Global film-shutter motion blur** on transitions + fast moves | `@remotion/motion-blur` `<CameraMotionBlur samples=6 shutterAngle=180>` | S | Biggest CG→film delta for least work |
| 2 | **Shader mesh-gradient background** (port vault `gradient-mesh`) | `@remotion/three` + `<shaderMaterial>` | M | The signature Stripe "premium SaaS" look; shader already written |
| 3 | **Dynamic shadow + chromatic-edge post stack** (shadow from same transform; RGB-split + grain/vignette) | core `interpolate` + CSS layers | S | Cards lift; whole frame "shot on film" |
| 4 | **SVG path-draw primitive** (lines/underlines/connectors/diagrams) | `@remotion/paths` `evolvePath` + `@remotion/shapes` | S | Self-drawing diagrams; reusable everywhere |
| 5 | **Odometer/rolling-digit counter** (replaces linear countUp in StatBurst) | core `interpolate(Easing.out)` + spring land | S | Mechanical, satisfying metric reveals |
| 6 | **Secondary motion / follow-through** in anim.ts (child trails by frame-lag) | core `spring({frame: frame-lag})` | S | Cheapest "alive vs robotic" jump; helps every scene |
| 7 | **Shader scene transitions** (port vault `gl-transition-runner`) | custom `@remotion/transitions` presentation + three | M | Bespoke shader warps replace fade/slide; runner is progress-driven |
| 8 | **Connection-graph / particle field** (seeded-index dots that link when near; CTA confetti) | `@remotion/noise` + seeded `random` | M | "Computational / networked" energy; deterministic |
| 9 | **Animated data-viz scene** (bars/line draw-in + axis counters) — new scene type | `@remotion/paths` + `interpolate` + shapes | M | Tells "growth" viscerally; fills the biggest gap |
| 10 | **Scramble/decode + variable-font headline mode** in KineticText | seeded `random("scr-"+i+"-"+frame)`; `font-variation-settings` | S | Energetic AI/dev-tool headlines; subtle weight-morph |
| 11 | **Clip-path reveal grammar + rack-focus** (masked reveals; inverse-blur focus pulls) | core `clip-path`/`filter:blur()` | M | Editorial reveals; cinematographic eye-direction |
| 12 | **True 3D card/device tilt + parallax** (perspective camera, z-layers, shadow-coupled) for Showcase/Feature | `@remotion/three` | L | Apple-style product weight; marquee feature |

## Sequencing

1. **S-effort global wins first** (a day; touch every scene): #1 motion blur, #3 post stack,
   #5 odometer, #6 follow-through.
2. **M structural that exploit the vault:** #2 shader background, #7 shader transitions,
   #4 path-draw, #8 particles, #9 data-viz.
3. **#12 true 3D last** — needs `@remotion/three` render plumbing (`chromiumOptions.gl:"angle"`)
   proven out by #2/#7 first.

## Verify-before-coding flags

`@remotion/noise` exports `noise2D/3D/4D` (NOT `createNoise2D`). `@remotion/paths` uses
`getSubpaths` (NOT `getParts`, removed in v4). `@remotion/transitions` has no `customTiming`
export (hand-write the timing object); `cube()` is paid. `@remotion/three` render needs
`chromiumOptions.gl: "angle"`; Lambda has no GPU. Lock all `@remotion/*` to `4.0.484`,
install `--save-exact`.
