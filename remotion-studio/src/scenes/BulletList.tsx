import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { fade, enterX, enterScale, settleGate, ambient, exitDrift, beat, SPRINGS } from '../lib/anim';

type Props = { kicker?: string; items?: string[]; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const BulletList = ({ kicker, items = ['Real-time, not eventually', 'Zero setup', 'Yours to own'], theme, startFrame = 0, durationInFrames = 90 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const list = Array.isArray(items) ? items.slice(0, 6) : [];

  return (
    <SceneFrame theme={theme} move="push-in" origin="20% 50%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ transform: `translateY(${ex.y}px)`, opacity: ex.opacity, fontFamily: s.fontFamily }}>
        {kicker ? <div style={{ color: s.accent, opacity: fade(frame, 0, 12), fontSize: 34, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 48 }}>{kicker}</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
          {list.map((item, i) => {
            const delay = beat(i, 6, 6); // 6f stagger wave
            const x = enterX(frame, fps, 56, SPRINGS.pop, delay);
            const g = settleGate(frame, fps, SPRINGS.pop, delay);
            const dotScale = enterScale(frame, fps, 0.3, SPRINGS.snap, delay);
            const a = ambient(frame, { ax: 2, ay: 4, rot: 0.2, phase: i * 0.7 });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 32, opacity: fade(frame, delay, delay + 12), transform: `translate(${x + a.x * g}px, ${a.y * g}px)` }}>
                <div style={{ width: 26, height: 26, borderRadius: 9999, background: s.accent, flexShrink: 0, transform: `scale(${dotScale})` }} />
                <div style={{ color: s.ink, fontSize: 68, fontWeight: 600, letterSpacing: '-0.015em' }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
    </SceneFrame>
  );
};

export default BulletList;
