import { useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { fade, lerp, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';
import { FauxUI } from '../lib/FauxUI';

type Media = { src?: string | null; deviceFrame?: 'browser' | 'phone' };
type Props = { caption?: string; media?: Media; cursorPath?: null; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const ScreenshotShowcase = ({ caption, media, theme, startFrame = 0, durationInFrames = 120 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const deviceFrame = (media && media.deviceFrame) || 'browser';
  const src = media && media.src;
  const phone = deviceFrame === 'phone';

  const enter = enterScale(frame, fps, 0.9, SPRINGS.soft, 0);
  const a = ambient(frame, { ax: 9, ay: 11, rot: 0.5, scale: 0.004, phase: 0.6 }); // device float
  const zoom = lerp(frame, [0, 150], [1.08, 1.0]);
  const move = settleGate(frame, fps, { damping: 26, stiffness: 90, mass: 1 }, 14);
  const curX = lerp(move, [0, 1], [78, 50]);
  const curY = lerp(move, [0, 1], [82, 46]);
  const ripple = lerp(frame, [44, 64], [0, 1]);
  const rippleOn = frame >= 44 && frame <= 66;
  const frameW = phone ? 540 : 1380;
  const frameH = phone ? 1100 : 800;

  return (
    <SceneFrame theme={theme} move="orbit" origin="50% 50%" dur={durationInFrames} startFrame={startFrame} pad={70}>
      <div style={{ position: 'relative', transform: `translateY(${ex.y}px) scale(${enter * a.sc}) translate(${a.x}px, ${a.y}px) rotate(${a.r}deg)`, opacity: ex.opacity }}>
        <div style={{ width: frameW, height: frameH, borderRadius: phone ? 56 : Math.max(16, s.radius), overflow: 'hidden', background: '#15161a', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 60px 150px rgba(0,0,0,0.6)' }}>
          {!phone ? (
            <div style={{ height: 56, background: '#1d1f24', display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 24 }}>
              {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 9999, background: c }} />)}
              <div style={{ marginLeft: 24, height: 28, flex: 1, marginRight: 24, borderRadius: 8, background: '#2a2d34' }} />
            </div>
          ) : null}
          <div style={{ position: 'relative', width: '100%', height: phone ? '100%' : 'calc(100% - 56px)', overflow: 'hidden' }}>
            {src ? (
              <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
            ) : (
              <div style={{ width: '100%', height: '100%', transform: `scale(${zoom})` }}><FauxUI theme={theme} /></div>
            )}
          </div>
        </div>
        {rippleOn ? <div style={{ position: 'absolute', left: `${curX}%`, top: `${curY}%`, width: 12 + ripple * 120, height: 12 + ripple * 120, marginLeft: -(6 + ripple * 60), marginTop: -(6 + ripple * 60), borderRadius: 9999, border: `3px solid ${s.accent}`, opacity: 1 - ripple }} /> : null}
        <svg width="44" height="44" viewBox="0 0 24 24" style={{ position: 'absolute', left: `${curX}%`, top: `${curY}%`, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))' }}>
          <path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.7 L11 14 L18 14 Z" fill="#fff" stroke="#000" strokeWidth="1" />
        </svg>
      </div>
      {caption ? <div style={{ position: 'absolute', bottom: 44, left: 0, right: 0, textAlign: 'center', color: s.muted, opacity: fade(frame, 20, 34) * (1 - ex.k), fontSize: 42, fontWeight: 500, fontFamily: s.fontFamily }}>{caption}</div> : null}
    </SceneFrame>
  );
};

export default ScreenshotShowcase;
