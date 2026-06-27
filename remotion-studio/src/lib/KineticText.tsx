import { useCurrentFrame, useVideoConfig } from 'remotion';
import { enterY, enterBlur, fade, ambient, settleGate, beat, SPRINGS } from './anim';

/* Kinetic typography — the #1 fix for the PowerPoint tell (whole-headline block
   fade-up). Words travel in on overshoot springs with a motion-blur cascade and
   per-word stagger, THEN breathe forever on decorrelated Lissajous paths so the
   line is never frozen. emphasisIndex lands a word late + in the accent. */
export const KineticText = ({
  text, style, base = 4, step = 5, dist = 70, emphasisIndex = -1, accent, fps: fpsProp,
}: { text: string; style?: any; base?: number; step?: number; dist?: number; emphasisIndex?: number; accent?: string; fps?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = String(text).split(' ');
  return (
    <div style={style}>
      {words.map((w, i) => {
        const delay = beat(i, base, step);
        const y = enterY(frame, fps, dist, SPRINGS.pop, delay);
        const blur = enterBlur(frame, fps, 10, delay, 12);
        const o = fade(frame, delay, delay + 10);
        const g = settleGate(frame, fps, SPRINGS.pop, delay);
        const a = ambient(frame, { ax: 3, ay: 5, rot: 0.2, scale: 0.004, phase: i * 0.6, speed: 0.9 });
        const emph = i === emphasisIndex;
        return (
          <span key={i} style={{
            display: 'inline-block', marginRight: '0.26em',
            transform: `translate(${a.x * g}px, ${y + a.y * g}px) rotate(${a.r * g}deg)`,
            opacity: o, filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
            color: emph && accent ? accent : undefined, willChange: 'transform',
          }}>{w}</span>
        );
      })}
    </div>
  );
};
