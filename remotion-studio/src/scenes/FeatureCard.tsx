import { useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { KineticText } from '../lib/KineticText';
import { fade, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';
import { FauxUI } from '../lib/FauxUI';

type Media = { src?: string | null; kind?: string } | null;
type Props = { headline?: string; body?: string; media?: Media; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const FeatureCard = ({ headline = 'Built for momentum', body = 'Everything in one place, nothing in your way.', media, theme, startFrame = 0, durationInFrames = 90 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const hasMedia = !!(media && media.src);
  const cardScale = enterScale(frame, fps, 0.9, SPRINGS.soft, 8);
  const cardA = ambient(frame, { ax: 7, ay: 9, rot: 0.4, scale: 0.006, phase: 1.5 });
  const bodyG = settleGate(frame, fps, SPRINGS.soft, 16);
  const bodyA = ambient(frame, { ax: 2, ay: 4, phase: 3 });

  return (
    <SceneFrame theme={theme} move="pan-right" origin="62% 50%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ display: 'flex', gap: 80, alignItems: 'center', transform: `translateY(${ex.y}px) scale(${ex.scale})`, opacity: ex.opacity }}>
        <div style={{ flex: 1, minWidth: 0, color: s.ink, fontFamily: s.fontFamily }}>
          <KineticText text={headline} base={2} step={5} dist={68} style={{ fontSize: 96, fontWeight: s.displayWeight, lineHeight: 1.0, letterSpacing: '-0.025em' }} />
          <div style={{ color: s.muted, opacity: fade(frame, 16, 30), fontSize: 46, fontWeight: 400, marginTop: 30, lineHeight: 1.3, maxWidth: 820, transform: `translate(${bodyA.x * bodyG}px, ${(1 - bodyG) * 26 + bodyA.y * bodyG}px)` }}>{body}</div>
        </div>
        <div style={{ width: 720, height: 460, borderRadius: s.radius, overflow: 'hidden', background: s.cardBg, border: s.border || '1px solid rgba(255,255,255,0.08)', transform: `scale(${cardScale * cardA.sc}) translate(${cardA.x}px, ${cardA.y}px) rotate(${cardA.r}deg)`, opacity: fade(frame, 8, 22), boxShadow: '0 40px 100px rgba(0,0,0,0.45)' }}>
          {hasMedia ? <Img src={media!.src as string} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FauxUI theme={theme} frame={startFrame + frame} />}
        </div>
      </div>
    </SceneFrame>
  );
};

export default FeatureCard;
