import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';

type Props = { headline?: string; buttonLabel?: string; urlText?: string; theme?: Theme };

export const CTACard = ({ headline = 'Start building today', buttonLabel = 'Get started', urlText, theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const head = spring({ frame, fps, config: { damping: 200 } });
  const btn = spring({ frame: frame - 8, fps, config: { damping: 12, stiffness: 140 } }); // settle 0.95→1
  const btnScale = 0.92 + 0.08 * btn;

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: s.pad }}>
      <div style={{ color: s.ink, opacity: fade(frame, 0, 12), transform: `translateY(${(1 - head) * 36}px)`, fontSize: 104, fontWeight: s.displayWeight, lineHeight: 1.0, letterSpacing: '-0.02em', maxWidth: 1400 }}>
        {headline}
      </div>
      <div style={{ marginTop: 56, transform: `scale(${btnScale})`, opacity: fade(frame, 8, 20) }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', height: 96, padding: '0 56px', borderRadius: s.radius === 0 ? 0 : 9999, background: s.accent, color: s.bg, fontSize: 40, fontWeight: 700, letterSpacing: '0.01em', border: s.border }}>
          {buttonLabel}
        </div>
      </div>
      {urlText ? (
        <div style={{ color: s.muted, opacity: fade(frame, 18, 30), fontSize: 34, marginTop: 40, letterSpacing: '0.04em' }}>{urlText}</div>
      ) : null}
    </AbsoluteFill>
  );
};

export default CTACard;
