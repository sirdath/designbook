import { useCurrentFrame, useVideoConfig } from 'remotion';
import { settleGate, jiggle, SPRINGS } from './anim';

/* Rolling-digit odometer — each column is a 0-9 strip that ROLLS up to its target
   digit (eased, with a settle jiggle), higher places landing first. Reads mechanical
   and satisfying — the premium upgrade over a plain count-up number. Deterministic:
   the roll position is pure f(frame). */
export const Odometer = ({
  value, color, fontSize = 300, weight = 900, startFrame = 0, spins = 1,
}: { value: number; color?: string; fontSize?: number; weight?: number; startFrame?: number; spins?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const digits = String(Math.max(0, Math.round(value))).split('');
  const digitH = fontSize;
  const colW = fontSize * 0.6;

  return (
    <div style={{ display: 'inline-flex', height: digitH, fontSize: digitH, lineHeight: `${digitH}px`, color, fontWeight: weight, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}>
      {digits.map((d, i) => {
        const target = parseInt(d, 10);
        const N = spins * 10 + target;                 // cells to roll through (last cell = target)
        const t = settleGate(frame, fps, SPRINGS.hero, startFrame + i * 3); // higher places land first
        const land = startFrame + i * 3 + 18;
        const y = -N * digitH * t + jiggle(frame, land, digitH * 0.012, 0.5, 8);
        return (
          <div key={i} style={{ width: colW, height: digitH, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', lineHeight: `${digitH}px`, transform: `translateY(${y}px)` }}>
              {Array.from({ length: N + 1 }, (_, k) => (
                <div key={k} style={{ height: digitH }}>{k % 10}</div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
