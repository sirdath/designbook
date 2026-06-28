import { useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { Odometer } from '../lib/Odometer';
import { Scramble } from '../lib/Scramble';
import { fade, enterScale, settleGate, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = { stat?: number | string; suffix?: string; label?: string; theme?: Theme; startFrame?: number; durationInFrames?: number };

export const StatBurst = ({ stat = 98, suffix = '%', label = 'faster than before', theme, startFrame = 0, durationInFrames = 50 }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const target = typeof stat === 'number' ? stat : parseFloat(String(stat)) || 0;
  const isNum = typeof stat === 'number' || /^\d/.test(String(stat));
  const punch = enterScale(frame, fps, 0.88, SPRINGS.snap, 6); // gentle pop, not a zoom
  const settled = settleGate(frame, fps, SPRINGS.hero, 6);
  const a = ambient(frame, { ax: 4, ay: 6, rot: 0.3, scale: 0.006, phase: 0.4 });
  const labA = ambient(frame, { ax: 2, ay: 4, phase: 2.5 });
  const labG = settleGate(frame, fps, SPRINGS.soft, 18);
  // one-shot shock ring once the digits land
  const landed = isNum && settled > 0.9;
  const ringK = fade(frame, 24, 42);
  const fs = 300;

  return (
    <SceneFrame theme={theme} move="push-in" origin="50% 46%" dur={durationInFrames} startFrame={startFrame}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', transform: `translateY(${ex.y}px)`, opacity: ex.opacity }}>
        <div style={{ position: 'relative' }}>
          {landed ? <div style={{ position: 'absolute', inset: '-8%', borderRadius: '50%', border: `4px solid ${s.accent}`, opacity: (1 - ringK) * 0.6, transform: `scale(${1 + ringK * 0.6})` }} /> : null}
          <div style={{ transform: `scale(${punch}) translate(${a.x}px, ${a.y}px) rotate(${a.r}deg)`, display: 'inline-flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            {isNum ? (
              <>
                <Odometer value={target} color={s.accent} fontSize={fs} startFrame={6} />
                {suffix ? <span style={{ color: s.accent, fontSize: fs, fontWeight: 900, lineHeight: `${fs}px`, letterSpacing: '-0.04em' }}>{suffix}</span> : null}
              </>
            ) : (
              <div style={{ color: s.accent, fontSize: fs, fontWeight: 900, lineHeight: `${fs}px`, letterSpacing: '-0.04em' }}>{stat}</div>
            )}
          </div>
        </div>
        <div style={{ color: s.muted, opacity: 1 - ex.k, fontSize: 56, fontWeight: 500, marginTop: 26, maxWidth: 1200, transform: `translate(${labA.x * labG}px, ${(1 - labG) * 24 + labA.y * labG}px)` }}><Scramble text={label} startFrame={20} perChar={1} scrambleColor={s.accent} /></div>
      </div>
    </SceneFrame>
  );
};

export default StatBurst;
