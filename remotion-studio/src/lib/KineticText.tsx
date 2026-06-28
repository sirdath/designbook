import { useCurrentFrame, useVideoConfig } from 'remotion';
import { enterY, enterBlur, fade, ambient, settleGate, beat, SPRINGS } from './anim';

/* Kinetic typography — the #1 fix for the PowerPoint tell (whole-headline block
   fade-up). Units (words OR chars via `split`) travel in on overshoot springs with a
   motion-blur cascade + per-unit stagger, THEN breathe forever on decorrelated
   Lissajous paths so the line is never frozen. split="char" = a tight letter cascade
   (catalog E4) for hero headlines; "word" (default) for body. */
export const KineticText = ({
  text, style, base = 4, step = 5, dist = 70, emphasisIndex = -1, accent, split = 'word',
}: { text: string; style?: any; base?: number; step?: number; dist?: number; emphasisIndex?: number; accent?: string; split?: 'word' | 'char' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const char = split === 'char';
  const units = char ? [...String(text)] : String(text).split(' ');
  const stp = char ? 1.4 : step; // tight, fast letter cascade (~0.05s/char)

  return (
    <div style={style}>
      {units.map((u, i) => {
        if (char && u === ' ') return <span key={i} style={{ display: 'inline-block', width: '0.3em' }} />;
        const delay = beat(i, base, stp);
        const y = enterY(frame, fps, dist, SPRINGS.pop, delay);
        const blur = enterBlur(frame, fps, 10, delay, 12);
        const o = fade(frame, delay, delay + 10);
        const g = settleGate(frame, fps, SPRINGS.pop, delay);
        const a = ambient(frame, { ax: 3, ay: 5, rot: 0.2, scale: 0.004, phase: i * 0.6, speed: 0.9 });
        const emph = i === emphasisIndex;
        return (
          <span key={i} style={{
            display: 'inline-block', marginRight: char ? undefined : '0.26em',
            transform: `translate(${a.x * g}px, ${y + a.y * g}px) rotate(${a.r * g}deg)`,
            opacity: o, filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
            color: emph && accent ? accent : undefined, willChange: 'transform',
          }}>{u}</span>
        );
      })}
    </div>
  );
};
