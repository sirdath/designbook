import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';

type Props = { wordmark?: string; logoSrc?: string | null; tagline?: string; theme?: Theme };

export const LogoReveal = ({ wordmark = 'Acme', logoSrc, tagline, theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const reveal = spring({ frame, fps, config: { damping: 200 } });
  const scale = 0.9 + 0.1 * reveal;

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: s.pad }}>
      <div style={{ transform: `scale(${scale})`, opacity: fade(frame, 0, 14) }}>
        {logoSrc ? (
          <Img src={logoSrc} style={{ height: 220, objectFit: 'contain' }} />
        ) : (
          <div style={{ color: s.ink, fontSize: 180, fontWeight: 900, letterSpacing: '-0.04em' }}>{wordmark}</div>
        )}
      </div>
      {tagline ? (
        <div style={{ color: s.muted, opacity: fade(frame, 16, 30), fontSize: 44, fontWeight: 400, marginTop: 30, letterSpacing: '0.02em' }}>{tagline}</div>
      ) : null}
    </AbsoluteFill>
  );
};

export default LogoReveal;
