import { useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { fade, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { wordmark?: string; logoSrc?: string | null; tagline?: string; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const LogoReveal = ({ wordmark = 'Acme', logoSrc, tagline, theme, startFrame = 0, durationInFrames = 45 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const scale = enterScale(frame, fps, 0.95, SPRINGS.hero, 0); // slow authoritative settle (minimal scale)
  const a = ambient(frame, { ax: 4, ay: 5, rot: 0.25, scale: 0.008, phase: 0.3 });
  const tagA = ambient(frame, { ax: 2, ay: 3, phase: 2.4 });
  const tagG = settleGate(frame, fps, SPRINGS.soft, 16);

  return (
    <SceneFrame theme={theme} move="pull-back" origin="50% 50%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transform: `translateY(${ex.y}px)`, opacity: ex.opacity, fontFamily: s.fontFamily }}>
        <div style={{ transform: `scale(${scale * a.sc}) translate(${a.x}px, ${a.y}px) rotate(${a.r}deg)`, opacity: fade(frame, 0, 12) }}>
          {logoSrc ? <Img src={logoSrc} style={{ height: 220, objectFit: 'contain' }} /> : <div style={{ color: s.ink, fontSize: 180, fontWeight: 900, letterSpacing: '-0.04em' }}>{wordmark}</div>}
        </div>
        {tagline ? <div style={{ color: s.muted, opacity: fade(frame, 16, 28) * (1 - ex.k), fontSize: 44, fontWeight: 400, marginTop: 28, letterSpacing: '0.02em', transform: `translate(${tagA.x * tagG}px, ${(1 - tagG) * 20 + tagA.y * tagG}px)` }}>{tagline}</div> : null}
      </div>
    </SceneFrame>
  );
};

export default LogoReveal;
