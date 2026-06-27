import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';

type Props = { quote?: string; attribution?: string; avatar?: string | null; theme?: Theme };

export const QuoteCard = ({ quote = 'It paid for itself in a week.', attribution = 'A very happy customer', avatar, theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const mark = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', padding: s.pad }}>
      <div style={{ color: s.accent, fontSize: 220, lineHeight: 0.6, fontWeight: 900, transform: `scale(${0.6 + 0.4 * mark})`, transformOrigin: 'left top', opacity: fade(frame, 0, 10), height: 110, overflow: 'hidden' }}>&ldquo;</div>
      <div style={{ color: s.ink, opacity: fade(frame, 8, 22), fontSize: 76, fontWeight: 600, lineHeight: 1.18, letterSpacing: '-0.02em', maxWidth: 1500 }}>{quote}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 48, opacity: fade(frame, 22, 36) }}>
        {avatar ? (
          <Img src={avatar} style={{ width: 84, height: 84, borderRadius: 9999, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 84, height: 84, borderRadius: 9999, background: s.accent, opacity: 0.9 }} />
        )}
        <div style={{ color: s.muted, fontSize: 40, fontWeight: 500 }}>{attribution}</div>
      </div>
    </AbsoluteFill>
  );
};

export default QuoteCard;
