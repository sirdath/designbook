import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade, lerp } from '../lib/anim';

type Props = { stat?: number | string; suffix?: string; label?: string; theme?: Theme };

export const StatBurst = ({ stat = 98, suffix = '%', label = 'faster than before', theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const target = typeof stat === 'number' ? stat : parseFloat(String(stat)) || 0;
  // deterministic count-up via clamped interpolate (NOT Math.random/Date.now)
  const value = Math.round(lerp(frame, [8, 38], [0, target]));
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const scale = 0.86 + 0.14 * pop;

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: s.pad }}>
      <div style={{ color: s.accent, fontSize: 320, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.04em', transform: `scale(${scale})`, fontVariantNumeric: 'tabular-nums' }}>
        {typeof stat === 'number' || /^\d/.test(String(stat)) ? `${value}${suffix}` : stat}
      </div>
      <div style={{ color: s.muted, opacity: fade(frame, 16, 30), fontSize: 56, fontWeight: 500, marginTop: 28, maxWidth: 1200 }}>{label}</div>
    </AbsoluteFill>
  );
};

export default StatBurst;
