import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { SceneFrame } from '../lib/SceneFrame';
import { Cursor } from '../lib/Cursor';
import { Typewriter } from '../lib/Typewriter';
import { fade, enterScale, ambient, exitDrift, SPRINGS } from '../lib/anim';

type Props = {
  headline?: string; query?: string; options?: string[]; selectIndex?: number; buttonLabel?: string;
  theme?: Theme; startFrame?: number; durationInFrames?: number;
};

// shared layout constants (% of frame) — the cursor keys derive from these so the
// click ALWAYS lands exactly on the element. Card: left 27% / top 23% / 46%×54%.
const SEARCH = { x: 33, y: 34 };
const OPTX = 34;
const OPTY = (i: number) => 42 + i * 7;
const BTN = { x: 50, y: 71 };

export const UIDemo = ({
  headline = 'Create a report', query = 'Active users',
  options = ['Revenue', 'Active users', 'Churn rate'], selectIndex = 1,
  buttonLabel = 'Create report', theme, startFrame = 0, durationInFrames = 150,
}: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const ex = exitDrift(frame, durationInFrames);
  const cardS = enterScale(frame, fps, 0.93, SPRINGS.soft, 0);
  const cardA = ambient(frame, { ax: 5, ay: 7, rot: 0.18, scale: 0.003, phase: 0.5 });

  const typeStart = 22;
  const selectAt = 70;   // option highlights/selects
  const clickAt = 104;   // button clicked
  const done = frame >= clickAt + 3;
  const searchFocused = frame >= 16 && frame < selectAt;

  const cursorKeys = [
    { frame: 0, x: 72, y: 84 },
    { frame: 16, x: SEARCH.x, y: SEARCH.y, click: true },
    { frame: 60, x: SEARCH.x, y: SEARCH.y },
    { frame: selectAt, x: OPTX + 6, y: OPTY(selectIndex), click: true },
    { frame: 92, x: OPTX + 6, y: OPTY(selectIndex) },
    { frame: clickAt, x: BTN.x, y: BTN.y, click: true },
    { frame: durationInFrames, x: BTN.x, y: BTN.y },
  ];

  const cardBg = '#16181d', line = 'rgba(255,255,255,0.10)', sub = 'rgba(255,255,255,0.5)';

  return (
    <SceneFrame theme={theme} move="push-in" origin="50% 46%" dur={durationInFrames} startFrame={startFrame} pad={0}>
      <AbsoluteFill>
        <div style={{
          position: 'absolute', left: '27%', top: '23%', width: '46%', height: '54%',
          transform: `translateY(${ex.y}px) scale(${cardS * cardA.sc}) translate(${cardA.x}px, ${cardA.y}px) rotate(${cardA.r}deg)`,
          opacity: fade(frame, 0, 10) * ex.opacity, background: cardBg, border: `1px solid ${line}`, borderRadius: 22,
          boxShadow: '0 50px 130px rgba(0,0,0,0.62)', fontFamily: s.fontFamily, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '24px 30px', borderBottom: `1px solid ${line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ color: '#fff', fontSize: 30, fontWeight: 700 }}>{headline}</div>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.06)' }} />
          </div>
          <div style={{ padding: '24px 30px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            <div style={{ height: 58, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `2px solid ${searchFocused ? s.accent : line}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14, color: '#fff', fontSize: 26 }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${sub}`, flexShrink: 0 }} />
              <div>{frame >= typeStart ? <Typewriter text={query} startFrame={typeStart} cps={13} /> : <span style={{ color: sub }}>Search metrics…</span>}</div>
            </div>
            {options.map((o, i) => {
              const active = i === selectIndex && frame >= selectAt;
              return (
                <div key={i} style={{ height: 54, borderRadius: 12, background: active ? `${s.accent}22` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? s.accent : line}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, opacity: fade(frame, 30 + i * 4, 42 + i * 4), color: '#fff', fontSize: 25 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: active ? s.accent : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#0b0b0f', flexShrink: 0 }}>{active ? '✓' : ''}</div>
                  <div style={{ opacity: active ? 1 : 0.8 }}>{o}</div>
                </div>
              );
            })}
            <div style={{ flex: 1 }} />
            <div style={{ height: 62, borderRadius: 12, background: done ? '#22c55e' : s.accent, color: '#0b0b0f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, transform: `scale(${frame >= clickAt && frame <= clickAt + 4 ? 0.97 : 1})`, transition: 'none' }}>
              {done ? 'Created ✓' : buttonLabel}
            </div>
          </div>
        </div>
        <Cursor keys={cursorKeys} accent={s.accent} />
      </AbsoluteFill>
    </SceneFrame>
  );
};

export default UIDemo;
