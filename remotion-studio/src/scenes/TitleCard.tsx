import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { KineticText } from '../lib/KineticText';
import { fade, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

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

  return (
    <SceneFrame theme={theme} move="push-in" origin="14% 54%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ transform: `translateY(${ex.y}px) scale(${ex.scale})`, opacity: ex.opacity, color: s.ink, fontFamily: s.fontFamily, maxWidth: 1520 }}>
        <div style={{ width: 72 * barG, height: 6, borderRadius: 3, background: s.accent, marginBottom: kicker ? 26 : 40, transform: `translate(${barA.x}px, ${barA.y}px)` }} />
        {kicker ? <div style={{ color: s.accent, opacity: fade(frame, 4, 16), fontSize: 32, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 22 }}>{kicker}</div> : null}
        <KineticText text={headline} base={4} step={5} dist={84} style={{ fontSize: 132, fontWeight: s.displayWeight, lineHeight: 0.95, letterSpacing: '-0.03em' }} />
        {subhead ? (
          <div style={{ color: s.muted, opacity: fade(frame, 22, 38) * (1 - ex.k), fontSize: 46, fontWeight: 400, marginTop: 38, maxWidth: 1150, lineHeight: 1.25, transform: `translate(${subA.x * subG}px, ${(1 - subG) * 30 + subA.y * subG}px)` }}>{subhead}</div>
        ) : null}
      </div>
    </SceneFrame>
  );
};

export default TitleCard;
