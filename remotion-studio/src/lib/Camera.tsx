import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { lerp } from './anim';

export type CameraMove = 'push-in' | 'pull-back' | 'pan-left' | 'pan-right' | 'orbit';

/* A virtual camera that NEVER stops moving — the single biggest "this is video"
   signal. Continuous dolly (constant-velocity clamped interpolate, no spring so it
   doesn't bounce) + handheld drift + micro-rotate. Moves alternate scene-to-scene
   so cut-to-cut velocity roughly matches (continuity). */
export const Camera = ({ move = 'push-in', dur = 90, origin = '50% 50%', children }: { move?: CameraMove; dur?: number; origin?: string; children: any }) => {
  const frame = useCurrentFrame();
  const sc = move === 'pull-back' ? lerp(frame, [0, dur], [1.09, 1.0])
    : move === 'orbit' ? 1.02 + 0.035 * Math.sin(frame * 0.02)
      : lerp(frame, [0, dur], [1.0, 1.10]);
  const dx = 8 * Math.sin(frame * 0.020)
    + (move === 'pan-left' ? lerp(frame, [0, dur], [44, -44]) : move === 'pan-right' ? lerp(frame, [0, dur], [-44, 44]) : 0);
  const dy = 6 * Math.cos(frame * 0.017);
  const rot = 0.4 * Math.sin(frame * 0.013) + (move === 'orbit' ? 0.6 * Math.sin(frame * 0.02) : 0);
  return (
    <AbsoluteFill style={{ perspective: 1400 }}>
      <AbsoluteFill style={{ transform: `scale(${sc}) translate(${dx}px, ${dy}px) rotate(${rot}deg)`, transformOrigin: origin }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
