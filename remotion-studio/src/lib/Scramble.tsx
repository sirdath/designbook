import { useCurrentFrame, random } from 'remotion';
import { fade } from './anim';

/* Decode / scramble (catalog E7): every char flickers through random glyphs from
   frame 0, locking to the real character left→right. Fully seeded (random(seed)) so
   it's frame-deterministic. Use on kickers / labels for a "decrypting" reveal. */
const GLYPHS = [...'!<>-_\\/[]{}=+*^?#$%&ABCDEFGHJKLMNPRSTUVWXYZ0123456789'];

export const Scramble = ({
  text, startFrame = 0, perChar = 2, settle = 10, scrambleColor, style,
}: { text: string; startFrame?: number; perChar?: number; settle?: number; scrambleColor?: string; style?: any }) => {
  const frame = useCurrentFrame();
  const chars = [...String(text)];
  const local = frame - startFrame;
  return (
    <span style={{ ...style, opacity: fade(frame, startFrame, startFrame + 6) }}>
      {chars.map((ch, i) => {
        if (ch === ' ') return <span key={i}>{' '}</span>;
        const lockAt = i * perChar + settle;       // this char locks (relative to startFrame)
        if (local >= lockAt) return <span key={i}>{ch}</span>;
        const g = GLYPHS[Math.floor(random(`scr-${i}-${frame}`) * GLYPHS.length)];
        return <span key={i} style={{ color: scrambleColor }}>{g}</span>;
      })}
    </span>
  );
};
