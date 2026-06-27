import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { KineticText } from '../lib/KineticText';
import { fade, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { headline?: string; buttonLabel?: string; urlText?: string; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const CTACard = ({ headline = 'Start building today', buttonLabel = 'Get started', urlText, theme, startFrame = 0, durationInFrames = 60 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const btnScale = enterScale(frame, fps, 0.8, SPRINGS.snap, 10); // snap overshoot
  const btnG = settleGate(frame, fps, SPRINGS.snap, 10);
  const btnA = ambient(frame, { ax: 0, ay: 4, rot: 0, scale: 0.012, phase: 0.8 }); // breathing pulse
  const urlA = ambient(frame, { ax: 2, ay: 3, phase: 3 });
  const urlG = settleGate(frame, fps, SPRINGS.soft, 20);

  return (
    <SceneFrame theme={theme} move="push-in" origin="50% 50%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transform: `translateY(${ex.y}px)`, opacity: ex.opacity, fontFamily: s.fontFamily }}>
        <KineticText text={headline} base={3} step={5} dist={70} style={{ color: s.ink, fontSize: 104, fontWeight: s.displayWeight, lineHeight: 1.0, letterSpacing: '-0.02em', maxWidth: 1400 }} />
        <div style={{ marginTop: 56, transform: `scale(${btnScale * btnA.sc}) translateY(${btnA.y}px)`, opacity: fade(frame, 10, 22) }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', height: 96, padding: '0 56px', borderRadius: s.radius === 0 ? 0 : 9999, background: s.accent, color: s.bg, fontSize: 40, fontWeight: 700, border: s.border, boxShadow: `0 24px 60px ${s.accent}44` }}>
            {buttonLabel}
          </div>
        </div>
        {urlText ? <div style={{ color: s.muted, opacity: fade(frame, 20, 32) * (1 - ex.k), fontSize: 34, marginTop: 40, letterSpacing: '0.04em', transform: `translate(${urlA.x * urlG}px, ${urlA.y * urlG}px)` }}>{urlText}</div> : null}
      </div>
    </SceneFrame>
  );
};

export default CTACard;
