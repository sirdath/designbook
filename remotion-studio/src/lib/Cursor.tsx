import { useCurrentFrame } from 'remotion';

export type CursorKey = { frame: number; x: number; y: number; click?: boolean };

// easeInOutCubic — natural accel/decel between waypoints (cursors don't move linearly)
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* A cursor that travels through scripted waypoints (x,y in % of the parent) with
   eased motion and an accurate click (press dip + ripple) at click waypoints. The
   UI positions and the cursor keys derive from the SAME constants so the click
   always lands exactly on the target. */
export const Cursor = ({ keys, accent = '#5b8cff' }: { keys: CursorKey[]; accent?: string }) => {
  const frame = useCurrentFrame();
  let x = keys[0].x, y = keys[0].y;
  if (frame <= keys[0].frame) { x = keys[0].x; y = keys[0].y; }
  else if (frame >= keys[keys.length - 1].frame) { x = keys[keys.length - 1].x; y = keys[keys.length - 1].y; }
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (frame >= a.frame && frame <= b.frame) {
        const t = ease((frame - a.frame) / Math.max(1, b.frame - a.frame));
        x = a.x + (b.x - a.x) * t; y = a.y + (b.y - a.y) * t; break;
      }
    }
  }
  // nearest click waypoint → press dip + ripple
  const clk = keys.find((k) => k.click && Math.abs(frame - k.frame) <= 16);
  let press = 1, ripple = -1;
  if (clk) {
    const d = frame - clk.frame;
    press = 1 - 0.16 * Math.max(0, 1 - Math.abs(d) / 4);
    if (d >= 0 && d <= 16) ripple = d / 16;
  }

  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: `scale(${press})`, transformOrigin: 'top left', pointerEvents: 'none', zIndex: 60, willChange: 'transform' }}>
      {ripple >= 0 ? (
        <div style={{ position: 'absolute', left: 4, top: 4, width: 8 + ripple * 56, height: 8 + ripple * 56, marginLeft: -(ripple * 28), marginTop: -(ripple * 28), borderRadius: '50%', border: `3px solid ${accent}`, opacity: 1 - ripple }} />
      ) : null}
      <svg width="42" height="42" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 4px 7px rgba(0,0,0,0.55))' }}>
        <path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.7 L11 14 L18 14 Z" fill="#fff" stroke="#1a1a1a" strokeWidth="1" />
      </svg>
    </div>
  );
};
