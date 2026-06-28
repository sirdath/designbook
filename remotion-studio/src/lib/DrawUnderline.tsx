import { useCurrentFrame, random } from 'remotion';
import { evolvePath } from '@remotion/paths';

/* Draw-on hand-drawn underline (catalog M8/E15): a slightly-wavy stroke under text
   that's "drawn" by an invisible pen via evolvePath (Rough-Notation vibe, no dep).
   Spans the parent width (viewBox + width:100% + non-scaling stroke). Deterministic. */
export const DrawUnderline = ({
  color = '#5b8cff', startFrame = 0, dur = 16, strokeWidth = 7, seed = 'ul',
}: { color?: string; startFrame?: number; dur?: number; strokeWidth?: number; seed?: string }) => {
  const frame = useCurrentFrame();
  const W = 1000, H = 24, segs = 6;
  let d = `M 4 ${12 + (random(`${seed}-0`) - 0.5) * 4}`;
  for (let i = 1; i <= segs; i++) {
    const x = (W / segs) * i;
    const y = 12 + (random(`${seed}-${i}`) - 0.5) * 7;
    const cx = x - W / segs / 2;
    const cy = 12 + (random(`${seed}-c-${i}`) - 0.5) * 9;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const p = Math.min(1, Math.max(0, (frame - startFrame) / dur));
  const { strokeDasharray, strokeDashoffset } = evolvePath(p, d);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
        vectorEffect="non-scaling-stroke" strokeDasharray={strokeDasharray} strokeDashoffset={strokeDashoffset} />
    </svg>
  );
};
