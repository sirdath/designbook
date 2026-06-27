import { getSceneStyles, Theme } from './getSceneStyles';

/* A deterministic mock SaaS dashboard — sidebar, topbar, stat cards, bar chart.
   Scenes render this when no real media.src is set, so a bare draft reads as
   "an actual product UI" (the critique flagged empty placeholders as invisible)
   instead of a void. Theme-aware (light/dark), brand accent, no randomness. */

const BARS = [42, 66, 54, 80, 60, 94, 72];

const hexLum = (hex?: string): number => {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return 200;
  return 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16);
};

export const FauxUI = ({ theme }: { theme?: Theme }) => {
  const s = getSceneStyles(theme);
  const light = hexLum(s.bg) > 150;
  const surface = light ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.045)';
  const line = light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)';
  const faint = light ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.18)';

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: s.bg, color: s.ink, fontFamily: s.fontFamily, overflow: 'hidden' }}>
      {/* sidebar */}
      <div style={{ width: '20%', borderRight: `1px solid ${line}`, padding: '3% 1.6%', display: 'flex', flexDirection: 'column', gap: '4%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '6%' }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: s.accent }} />
          <div style={{ width: 64, height: 11, borderRadius: 6, background: faint }} />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: i === 1 ? s.accent + '22' : 'transparent' }}>
            <div style={{ width: 15, height: 15, borderRadius: 5, background: i === 1 ? s.accent : faint }} />
            <div style={{ width: 78 - i * 7, height: 8, borderRadius: 5, background: i === 1 ? s.accent : faint, opacity: i === 1 ? 1 : 0.7 }} />
          </div>
        ))}
      </div>
      {/* main */}
      <div style={{ flex: 1, padding: '3% 2.4%', display: 'flex', flexDirection: 'column', gap: '3.5%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ width: 150, height: 15, borderRadius: 7, background: faint }} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 170, height: 30, borderRadius: 9, background: surface, border: `1px solid ${line}` }} />
            <div style={{ width: 30, height: 30, borderRadius: 9999, background: s.accent }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '3%' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, padding: 18, borderRadius: 12, background: surface, border: `1px solid ${line}` }}>
              <div style={{ width: '52%', height: 8, borderRadius: 5, background: faint }} />
              <div style={{ width: '68%', height: 22, borderRadius: 6, background: s.ink, opacity: 0.85, marginTop: 12 }} />
              <div style={{ width: '38%', height: 7, borderRadius: 5, background: s.accent, marginTop: 12 }} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 20, borderRadius: 12, background: surface, border: `1px solid ${line}`, display: 'flex', alignItems: 'flex-end', gap: '2.4%' }}>
          {BARS.map((h, i) => (
            <div key={i} style={{ flex: 1, height: h + '%', borderRadius: '6px 6px 0 0', background: i === 5 ? s.accent : s.accent + '66' }} />
          ))}
        </div>
      </div>
    </div>
  );
};
