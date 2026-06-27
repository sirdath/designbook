import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { lerp } from './anim';

export type CameraMove = 'push-in' | 'pull-back' | 'pan-left' | 'pan-right' | 'orbit';

/* A virtual camera that NEVER stops moving — the single biggest "this is video"
   signal. Continuous dolly (constant-velocity clamped interpolate, no spring so it
   doesn't bounce) + handheld drift + micro-rotate. Moves alternate scene-to-scene
   so cut-to-cut velocity roughly matches (continuity). */
export const Camera = ({ move = 'push-in', dur = 90, origin = '50% 50%', children }: { move?: CameraMove; dur?: number; origin?: string; children: any }) => {
  const frame = useCurrentFrame();
  // NO dolly zoom — pure translational drift + micro-rotate. (Owner: "still too much
  // zooming".) A whisper of non-monotonic breathing keeps it from feeling locked, but
  // it never ramps scale, so nothing "zooms in" over the scene.
  const sc = 1.0 + 0.004 * Math.sin(frame * 0.02);
  const dx = 5 * Math.sin(frame * 0.018)
    + (move === 'pan-left' ? lerp(frame, [0, dur], [18, -18]) : move === 'pan-right' ? lerp(frame, [0, dur], [-18, 18]) : 0);
  const dy = 4 * Math.cos(frame * 0.015)
    + (move === 'push-in' ? lerp(frame, [0, dur], [7, -7]) : move === 'pull-back' ? lerp(frame, [0, dur], [-7, 7]) : 0);
  const rot = 0.26 * Math.sin(frame * 0.013) + (move === 'orbit' ? 0.4 * Math.sin(frame * 0.02) : 0);
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      <AbsoluteFill style={{ transform: `scale(${sc}) translate(${dx}px, ${dy}px) rotate(${rot}deg)`, transformOrigin: origin }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
