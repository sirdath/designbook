import { useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { KineticText } from '../lib/KineticText';
import { fade, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { quote?: string; attribution?: string; avatar?: string | null; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const QuoteCard = ({ quote = 'It paid for itself in a week.', attribution = 'A very happy customer', avatar, theme, startFrame = 0, durationInFrames = 90 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const markScale = enterScale(frame, fps, 0.84, SPRINGS.wobbly, 0); // soft overshoot, not a zoom
  const markA = ambient(frame, { ax: 3, ay: 5, rot: 0.6, phase: 0.4 });
  const attrG = settleGate(frame, fps, SPRINGS.soft, 24);
  const attrA = ambient(frame, { ax: 3, ay: 4, phase: 2.8 });

  return (
    <SceneFrame theme={theme} move="pan-left" origin="40% 50%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ transform: `translateY(${ex.y}px)`, opacity: ex.opacity, fontFamily: s.fontFamily }}>
        <div style={{ color: s.accent, fontSize: 220, lineHeight: 0.6, fontWeight: 900, transform: `scale(${markScale}) translate(${markA.x}px, ${markA.y}px) rotate(${markA.r}deg)`, transformOrigin: 'left top', opacity: fade(frame, 0, 10), height: 110, overflow: 'hidden' }}>&ldquo;</div>
        <KineticText text={quote} base={6} step={5} dist={56} style={{ color: s.ink, fontSize: 76, fontWeight: 600, lineHeight: 1.18, letterSpacing: '-0.02em', maxWidth: 1500 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 48, opacity: fade(frame, 24, 38) * (1 - ex.k), transform: `translate(${attrA.x * attrG}px, ${(1 - attrG) * 22 + attrA.y * attrG}px)` }}>
          {avatar ? <Img src={avatar} style={{ width: 84, height: 84, borderRadius: 9999, objectFit: 'cover' }} /> : <div style={{ width: 84, height: 84, borderRadius: 9999, background: s.accent, opacity: 0.9 }} />}
          <div style={{ color: s.muted, fontSize: 40, fontWeight: 500 }}>{attribution}</div>
        </div>
      </div>
    </SceneFrame>
  );
};

export default QuoteCard;
