import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';
import { FauxUI } from '../lib/FauxUI';

type Media = { src?: string | null; kind?: string } | null;
type Props = { headline?: string; body?: string; media?: Media; theme?: Theme };

export const FeatureCard = ({ headline = 'Built for momentum', body = 'Everything in one place, nothing in your way.', media, theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const hasMedia = !!(media && media.src);

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', padding: s.pad }}>
      <div style={{ display: 'flex', gap: 80, alignItems: 'center', transform: `translateY(${(1 - enter) * 40}px)`, opacity: fade(frame, 0, 12) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: s.ink, fontSize: 96, fontWeight: s.displayWeight, lineHeight: 1.0, letterSpacing: '-0.025em' }}>{headline}</div>
          <div style={{ color: s.muted, opacity: fade(frame, 10, 24), fontSize: 46, fontWeight: 400, marginTop: 34, lineHeight: 1.3, maxWidth: 820 }}>{body}</div>
        </div>
        <div style={{ width: 720, height: 460, borderRadius: s.radius, overflow: 'hidden', background: s.cardBg, border: s.border || '1px solid rgba(255,255,255,0.08)', opacity: fade(frame, 8, 22), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasMedia ? (
            <Img src={media!.src as string} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <FauxUI theme={theme} />
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export default FeatureCard;
