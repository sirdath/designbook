import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from './getSceneStyles';
import { settleGate, SPRINGS } from './anim';

/* Animated mock SaaS dashboard — bars grow on staggered springs then bob; the
   active bar + nav row pulse. A static mock inside a moving film re-introduces the
   dead-slide feel, so this lives too. Theme-aware, deterministic. */

const BARS = [42, 66, 54, 80, 60, 94, 72];

const hexLum = (hex?: string): number => {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return 200;
  return 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16);
};

export const FauxUI = ({ theme }: { theme?: Theme; frame?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const light = hexLum(s.bg) > 150;
  const surface = light ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)';
  const line = light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)';
  const faint = light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.18)';
  const navPulse = 0.7 + 0.3 * Math.sin(frame * 0.07);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: s.bg, color: s.ink, fontFamily: s.fontFamily, overflow: 'hidden' }}>
      <div style={{ width: '20%', borderRight: `1px solid ${line}`, padding: '3% 1.6%', display: 'flex', flexDirection: 'column', gap: '4%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '6%' }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: s.accent }} />
          <div style={{ width: 64, height: 11, borderRadius: 6, background: faint }} />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: i === 1 ? s.accent + Math.round(navPulse * 34).toString(16).padStart(2, '0') : 'transparent' }}>
            <div style={{ width: 15, height: 15, borderRadius: 5, background: i === 1 ? s.accent : faint }} />
            <div style={{ width: 78 - i * 7, height: 8, borderRadius: 5, background: i === 1 ? s.accent : faint, opacity: i === 1 ? 1 : 0.7 }} />
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: '3% 2.4%', display: 'flex', flexDirection: 'column', gap: '3.5%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ width: 150, height: 15, borderRadius: 7, background: faint }} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 170, height: 30, borderRadius: 9, background: surface, border: `1px solid ${line}` }} />
            <div style={{ width: 30, height: 30, borderRadius: 9999, background: s.accent }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '3%' }}>
          {[0, 1, 2].map((i) => {
            const g = settleGate(frame, fps, SPRINGS.snappy, 6 + i * 4);
            return (
              <div key={i} style={{ flex: 1, padding: 18, borderRadius: 12, background: surface, border: `1px solid ${line}`, opacity: g }}>
                <div style={{ width: '52%', height: 8, borderRadius: 5, background: faint }} />
                <div style={{ width: `${68 * g}%`, height: 22, borderRadius: 6, background: s.ink, opacity: 0.85, marginTop: 12 }} />
                <div style={{ width: '38%', height: 7, borderRadius: 5, background: s.accent, marginTop: 12 }} />
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, padding: 20, borderRadius: 12, background: surface, border: `1px solid ${line}`, display: 'flex', alignItems: 'flex-end', gap: '2.4%' }}>
          {BARS.map((h, i) => {
            const grow = settleGate(frame, fps, SPRINGS.snappy, 10 + i * 3);
            const bob = 1 + 0.03 * Math.sin(frame * 0.05 + i);
            const active = i === 5;
            return <div key={i} style={{ flex: 1, height: `${h * grow * bob}%`, borderRadius: '6px 6px 0 0', background: active ? s.accent : s.accent + '66', opacity: active ? 0.8 + 0.2 * Math.sin(frame * 0.08) : 1 }} />;
          })}
        </div>
      </div>
    </div>
  );
};
