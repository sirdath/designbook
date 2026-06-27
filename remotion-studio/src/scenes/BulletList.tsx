import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';

type Props = { kicker?: string; items?: string[]; theme?: Theme };

export const BulletList = ({ kicker, items = ['Real-time, not eventually', 'Zero setup', 'Yours to own'], theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const list = Array.isArray(items) ? items.slice(0, 6) : [];

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', padding: s.pad }}>
      {kicker ? (
        <div style={{ color: s.accent, opacity: fade(frame, 0, 12), fontSize: 34, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 48 }}>{kicker}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
        {list.map((item, i) => {
          const start = 6 + i * 10; // stagger convention
          const enter = spring({ frame: frame - start, fps, config: { damping: 200 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 32, opacity: fade(frame, start, start + 12), transform: `translateX(${(1 - enter) * 48}px)` }}>
              <div style={{ width: 26, height: 26, borderRadius: 9999, background: s.accent, flexShrink: 0 }} />
              <div style={{ color: s.ink, fontSize: 68, fontWeight: 600, letterSpacing: '-0.015em' }}>{item}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default BulletList;
