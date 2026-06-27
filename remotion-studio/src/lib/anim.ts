/* Frame-driven animation helpers. EVERY motion in a scene flows through these or
   through spring()/useCurrentFrame() directly — interpolate is ALWAYS clamped, so
   a still at frame N and the rendered frame N are identical (the determinism law).
   Never Math.random / Date.now / CSS transitions. */
import { interpolate } from 'remotion';

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 opacity ramp between two frames. */
export const fade = (frame: number, from: number, to: number): number =>
  interpolate(frame, [from, to], [0, 1], CLAMP);

/** translateY in px, easing from `px`→0 between two frames. */
export const rise = (frame: number, from: number, to: number, px = 40): number =>
  interpolate(frame, [from, to], [px, 0], CLAMP);

/** generic clamped interpolate. */
export const lerp = (frame: number, inRange: number[], outRange: number[]): number =>
  interpolate(frame, inRange, outRange, CLAMP);
