import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { KineticText } from '../lib/KineticText';
import { Scramble } from '../lib/Scramble';
import { fade, lerp, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { kicker?: string; headline?: string; subhead?: string; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const TitleCard = ({ kicker, headline = 'Ship it faster.', subhead, theme, startFrame = 0, durationInFrames = 75 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);

  const barG = settleGate(frame, fps, SPRINGS.snappy, 0);
  const barA = ambient(frame, { ax: 2, ay: 2, rot: 0, scale: 0, phase: 0.5 });
  const subG = settleGate(frame, fps, SPRINGS.soft, 22);
  const subA = ambient(frame, { ax: 2, ay: 4, phase: 2.2 });
  const wipe = lerp(frame, [22, 46], [0, 100]); // mask-reveal the subhead L→R

  return (
    <SceneFrame theme={theme} move="push-in" origin="14% 54%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ transform: `translateY(${ex.y}px) scale(${ex.scale})`, opacity: ex.opacity, color: s.ink, fontFamily: s.fontFamily, maxWidth: 1520 }}>
        <div style={{ width: 72 * barG, height: 6, borderRadius: 3, background: s.accent, marginBottom: kicker ? 26 : 40, transform: `translate(${barA.x}px, ${barA.y}px)` }} />
        {kicker ? <div style={{ color: s.accent, fontSize: 32, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 22 }}><Scramble text={kicker} startFrame={4} /></div> : null}
        <KineticText text={headline} base={4} step={5} dist={84} split="char" style={{ fontSize: 132, fontWeight: s.displayWeight, lineHeight: 0.95, letterSpacing: '-0.03em' }} />
        {subhead ? (
          <div style={{ color: s.muted, opacity: 1 - ex.k, clipPath: `inset(0 ${100 - wipe}% 0 0)`, fontSize: 46, fontWeight: 400, marginTop: 38, maxWidth: 1150, lineHeight: 1.25, transform: `translate(${subA.x * subG}px, ${(1 - subG) * 30 + subA.y * subG}px)` }}>{subhead}</div>
        ) : null}
      </div>
    </SceneFrame>
  );
};

export default TitleCard;
