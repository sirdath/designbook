import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { fade, countUp, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { stat?: number | string; suffix?: string; label?: string; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const StatBurst = ({ stat = 98, suffix = '%', label = 'faster than before', theme, startFrame = 0, durationInFrames = 50 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const target = typeof stat === 'number' ? stat : parseFloat(String(stat)) || 0;
  const isNum = typeof stat === 'number' || /^\d/.test(String(stat));
  // odometer count-up (eased, rushes then settles) + a snap-overshoot scale punch
  const value = countUp(frame, fps, target, 6, SPRINGS.hero);
  const punch = enterScale(frame, fps, 0.7, SPRINGS.snap, 6); // springs PAST 1.0 then settles
  const settled = settleGate(frame, fps, SPRINGS.snap, 6);
  const a = ambient(frame, { ax: 4, ay: 6, rot: 0.3, scale: 0.006, phase: 0.4 });
  const labA = ambient(frame, { ax: 2, ay: 4, phase: 2.5 });
  const labG = settleGate(frame, fps, SPRINGS.soft, 18);
  // one-shot shock ring on the frame the count lands
  const landed = isNum && value >= target;
  const ringK = fade(frame, 18, 34);

  return (
    <SceneFrame theme={theme} move="push-in" origin="50% 46%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transform: `translateY(${ex.y}px)`, opacity: ex.opacity }}>
        <div style={{ position: 'relative' }}>
          {landed ? <div style={{ position: 'absolute', inset: '-8%', borderRadius: '50%', border: `4px solid ${s.accent}`, opacity: (1 - ringK) * 0.6, transform: `scale(${1 + ringK * 0.6})` }} /> : null}
          <div style={{ color: s.accent, fontSize: 320, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', transform: `scale(${punch}) translate(${a.x}px, ${a.y}px) rotate(${a.r}deg)` }}>
            {isNum ? `${value}${suffix}` : stat}
          </div>
        </div>
        <div style={{ color: s.muted, opacity: fade(frame, 18, 32) * (1 - ex.k), fontSize: 56, fontWeight: 500, marginTop: 26, maxWidth: 1200, transform: `translate(${labA.x * labG}px, ${(1 - labG) * 24 + labA.y * labG}px)` }}>{label}</div>
      </div>
    </SceneFrame>
  );
};

export default StatBurst;
