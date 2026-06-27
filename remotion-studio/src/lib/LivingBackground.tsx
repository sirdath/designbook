import { AbsoluteFill, random } from 'remotion';
import { getSceneStyles, Theme } from './getSceneStyles';

const hexLum = (hex?: string): number => {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return 200;
  return 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16);
};

// fixed fractal-noise grain tile (manually %-encoded so the internal url(#n) survives the data-URI)
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* The animated world behind every scene. `frame` is the GLOBAL timeline frame so
   the aurora/grain/sweep keep moving across cuts (don't reset per scene) — the
   single biggest "this is a video" signal. All layers are pure f(frame). */
export const LivingBackground = ({ theme, frame }: { theme?: Theme; frame: number }) => {
  const s = getSceneStyles(theme);
  const light = hexLum(s.bg) > 150;
  const t = frame;
  const blobs = [
    { c: s.accent, cx: 26, cy: 30, phase: 0 },
    { c: s.muted, cx: 74, cy: 66, phase: 2.1 },
    { c: s.accent, cx: 62, cy: 20, phase: 4.2 },
    { c: s.muted, cx: 38, cy: 78, phase: 5.6 },
  ];
  const grainShift = random(`grain-${Math.floor(t / 2)}`) * 6;
  const dot = light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';
  const mask = 'radial-gradient(125% 105% at 50% 38%, #000 38%, transparent 86%)';

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: s.bg }}>
      {/* L1 — drifting, breathing aurora */}
      {blobs.map((b, i) => {
        const x = b.cx + Math.sin(t * 0.010 + b.phase) * 13;
        const y = b.cy + Math.cos(t * 0.013 + b.phase * 1.7) * 10;
        const scale = 1 + 0.12 * Math.sin(t * 0.008 + b.phase);
        return (
          <div key={i} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`, width: '62%', height: '62%',
            transform: `translate(-50%,-50%) scale(${scale})`, borderRadius: '50%',
            background: `radial-gradient(circle, ${b.c}, transparent 62%)`, filter: 'blur(95px)',
            opacity: light ? 0.10 : 0.22, mixBlendMode: light ? 'multiply' : 'screen',
          }} />
        );
      })}
      {/* L2 — parallax dot field, creeping opposite to content */}
      <AbsoluteFill style={{
        backgroundImage: `radial-gradient(${dot} 1px, transparent 1px)`, backgroundSize: '46px 46px',
        backgroundPosition: `${Math.sin(t * 0.006) * 30}px ${t * 0.15}px`, opacity: 0.05,
        maskImage: mask, WebkitMaskImage: mask,
      }} />
      {/* L3 — slow light sweep (seamless modulo) */}
      <AbsoluteFill style={{
        background: `linear-gradient(105deg, transparent 42%, ${s.accent}14 50%, transparent 58%)`,
        transform: `translateX(${-40 + ((t * 0.4) % 200)}%)`,
      }} />
      {/* L4 — shimmering film grain */}
      <AbsoluteFill style={{
        backgroundImage: GRAIN, backgroundSize: '220px 220px', backgroundPosition: `${grainShift}px ${grainShift}px`,
        opacity: light ? 0.05 : 0.08, mixBlendMode: 'overlay',
      }} />
      {/* L5 — breathing vignette (edges never static) */}
      <AbsoluteFill style={{ boxShadow: `inset 0 0 320px rgba(0,0,0,${0.4 + 0.04 * Math.sin(t * 0.02)})`, pointerEvents: 'none' }} />
    </AbsoluteFill>
  );
};
