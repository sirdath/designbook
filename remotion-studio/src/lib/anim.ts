/* The motion math core — frame-deterministic. THREE LAWS (kill the PowerPoint feel):
   1. NO RESTING FRAME — every animated value = enter(frame) + ambient(frame); the
      ambient sin/cos drift never stops, so a still at second 5 still differs from
      second 4. 2. DEPTH — layers move at different rates (parallax). 3. PHYSICS
      over easing — entrances use UNDER-damped springs that overshoot + settle
      (damping 9-16), never the lifeless damping:200.
   All values are pure f(useCurrentFrame()) — never Math.random/Date.now/CSS. */
import { interpolate, spring } from 'remotion';

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const fade = (frame: number, from: number, to: number) => interpolate(frame, [from, to], [0, 1], CLAMP);
export const rise = (frame: number, from: number, to: number, px = 40) => interpolate(frame, [from, to], [px, 0], CLAMP);
export const lerp = (frame: number, inR: number[], outR: number[]) => interpolate(frame, inR, outR, CLAMP);

export const BEAT = 12; // 0.4s @30fps — the tempo grid

// Under-damped springs — the overshoot IS the life. damping:200 is BANNED for entrances.
export const SPRINGS = {
  pop: { damping: 12, stiffness: 120, mass: 1 },     // ~8% overshoot — titles, rows, generic hero
  soft: { damping: 16, stiffness: 110, mass: 1 },    // ~5% — body copy, captions, cards
  snappy: { damping: 12, stiffness: 200, mass: 0.9 },// quick lively — chips, kicker, avatar, bars
  snap: { damping: 9, stiffness: 170, mass: 0.9 },   // ~14% punch — stat number, CTA, dots
  hero: { damping: 13, stiffness: 70, mass: 1.1 },   // slow authoritative — logo, big scale
  wobbly: { damping: 9, stiffness: 160, mass: 1 },   // ~15% — quote mark, badges
} as const;
type Cfg = { damping: number; stiffness: number; mass: number };

export const beat = (i: number, base = 4, step = 6) => base + i * step; // stagger start frames
const sp = (frame: number, fps: number, cfg: Cfg, delay: number) => spring({ frame: frame - delay, fps, config: cfg });

// Entrance helpers — under-damped springs momentarily exceed 1 ⇒ visible overshoot.
export const enterY = (frame: number, fps: number, dist = 64, cfg: Cfg = SPRINGS.pop, delay = 0) => (1 - sp(frame, fps, cfg, delay)) * dist;
export const enterX = (frame: number, fps: number, dist = 48, cfg: Cfg = SPRINGS.pop, delay = 0) => (1 - sp(frame, fps, cfg, delay)) * dist;
export const enterScale = (frame: number, fps: number, from = 0.86, cfg: Cfg = SPRINGS.soft, delay = 0) => from + (1 - from) * sp(frame, fps, cfg, delay);
export const enterBlur = (frame: number, fps: number, px = 8, inF = 0, dur = 14) => lerp(frame, [inF, inF + dur], [px, 0]);
/** how settled an entrance is (0→1) — gate the ambient drift in with this so there's no jump. */
export const settleGate = (frame: number, fps: number, cfg: Cfg = SPRINGS.pop, delay = 0) => Math.min(1, sp(frame, fps, cfg, delay));

/** perpetual ambient drift — OPEN Lissajous (different X/Y/rot freqs) so it never reads as a robotic line. */
export const ambient = (frame: number, o: { ax?: number; ay?: number; rot?: number; scale?: number; speed?: number; phase?: number } = {}) => {
  const { ax = 8, ay = 6, rot = 0.4, scale = 0.01, speed = 1, phase = 0 } = o;
  const x = Math.sin(frame * 0.020 * speed + phase) * ax;
  const y = Math.sin(frame * 0.016 * speed + phase * 1.3 + 1.1) * ay;
  const r = Math.sin(frame * 0.013 * speed + phase * 0.7) * rot;
  const sc = 1 + Math.sin(frame * 0.011 * speed + phase) * scale;
  return { x, y, r, sc };
};

/** combined: spring-enter (with overshoot) THEN perpetual float — the no-resting-frame primitive.
 *  returns a ready transform string for translateY + float + scale. */
export const liveY = (frame: number, fps: number, opt: { dist?: number; cfg?: Cfg; delay?: number; ax?: number; ay?: number; rot?: number; scale?: number; phase?: number; speed?: number } = {}) => {
  const { dist = 60, cfg = SPRINGS.pop, delay = 0, ...amb } = opt;
  const g = settleGate(frame, fps, cfg, delay);
  const ey = enterY(frame, fps, dist, cfg, delay);
  const a = ambient(frame, amb);
  return `translate(${a.x * g}px, ${ey + a.y * g}px) rotate(${a.r * g}deg) scale(${a.sc})`;
};

/** elements must be MID-MOTION at the cut, not frozen — exit lean for the last `leave` frames. */
export const exitDrift = (frame: number, dur: number, leave = 18) => {
  const k = lerp(frame, [dur - leave, dur], [0, 1]);
  return { y: -k * 30, opacity: 1 - k, scale: 1 + k * 0.04, k };
};

/** odometer count-up — rushes then decelerates (eased+overshoot), unlike a linear ramp. */
export const countUp = (frame: number, fps: number, target: number, inF = 0, cfg: Cfg = SPRINGS.hero) =>
  Math.round(target * Math.min(1, Math.max(0, sp(frame, fps, cfg, inF))));

/** secondary motion — a child trails its parent: evaluate the child's entrance at a
 *  lagged frame so it follows THROUGH after the parent lands (the alive-vs-robotic tell). */
export const lagFrame = (frame: number, lag = 4) => Math.max(0, frame - lag);

/** follow-through jiggle — a damped oscillation that fires once an element LANDS (at
 *  `start`) and decays to nothing. Adds the secondary bounce after a spring settles. */
export const jiggle = (frame: number, start: number, amp = 6, freq = 0.55, decay = 9) => {
  const t = frame - start;
  return t < 0 ? 0 : amp * Math.exp(-t / decay) * Math.sin(t * freq);
};
