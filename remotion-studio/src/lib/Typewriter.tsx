import { useCurrentFrame, useVideoConfig } from 'remotion';

/* Frame-deterministic typing: characters appear at `cps` chars/sec from startFrame,
   with a blinking caret (frame-based, never CSS). */
export const Typewriter = ({ text, startFrame = 0, cps = 16, color }: { text: string; startFrame?: number; cps?: number; color?: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = Math.max(0, frame - startFrame);
  const n = Math.floor((elapsed / fps) * cps);
  const shown = text.slice(0, Math.min(text.length, n));
  const done = n >= text.length;
  const doneFor = elapsed - (text.length / cps) * fps;
  const caretOn = (Math.floor(frame / 8) % 2 === 0) && !(done && doneFor > 26);
  return (
    <>
      {shown}
      <span style={{ opacity: caretOn ? 0.9 : 0, fontWeight: 300, color }}>|</span>
    </>
  );
};
