import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
import { getSceneStyles, Theme } from '../lib/getSceneStyles';
import { fade } from '../lib/anim';

type Props = { kicker?: string; headline?: string; subhead?: string; theme?: Theme };

export const TitleCard = ({ kicker, headline = 'Ship it faster.', subhead, theme }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = getSceneStyles(theme);
  const up = spring({ frame, fps, config: { damping: 200 } }); // no overshoot
  const headlineY = (1 - up) * 44;

  return (
    <AbsoluteFill style={{ backgroundColor: s.bg, fontFamily: s.fontFamily, justifyContent: 'center', padding: s.pad }}>
      {kicker ? (
        <div style={{ color: s.accent, opacity: fade(frame, 4, 18), fontSize: 32, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 26 }}>
          {kicker}
        </div>
      ) : null}
      <div style={{ color: s.ink, opacity: fade(frame, 0, 12), transform: `translateY(${headlineY}px)`, fontSize: 132, fontWeight: s.displayWeight, lineHeight: 0.95, letterSpacing: '-0.03em', maxWidth: 1500 }}>
        {headline}
      </div>
      {subhead ? (
        <div style={{ color: s.muted, opacity: fade(frame, 12, 28), fontSize: 46, fontWeight: 400, marginTop: 38, maxWidth: 1150, lineHeight: 1.25 }}>
          {subhead}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export default TitleCard;
