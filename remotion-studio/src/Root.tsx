import { Composition, Series, AbsoluteFill } from 'remotion';
import { SCENE_COMPONENTS } from './registry';
import type { Theme } from './lib/getSceneStyles';

export type Scene = { id: string; type: string; durationInFrames: number; props: any; transition?: string | null };
export type VideoPlan = {
  scenes: Scene[];
  theme: Theme;
  fps?: number;
  width?: number;
  height?: number;
  totalDurationInFrames?: number;
};

// A minimal default so Remotion Studio shows something; the real plan always
// arrives as inputProps from lib/video.js (designbook/lib/videoplan.js output).
const DEFAULT_PLAN: VideoPlan = {
  fps: 30,
  width: 1920,
  height: 1080,
  totalDurationInFrames: 75 + 90 + 60,
  theme: { tokens: { bg: '#0b0b0f', ink: '#f5f5f7', accent: '#6c8cff', muted: '#9aa0aa' } },
  scenes: [
    { id: 's1', type: 'TitleCard', durationInFrames: 75, props: { headline: 'Ship it faster.', subhead: 'The workspace your team actually wants.' } },
    { id: 's2', type: 'FeatureCard', durationInFrames: 90, props: { headline: 'Built for momentum', body: 'Everything in one place, nothing in your way.' } },
    { id: 's3', type: 'CTACard', durationInFrames: 60, props: { headline: 'Start building today', buttonLabel: 'Get started', urlText: 'acme.com' } },
  ],
};

export const VideoFromPlan = ({ plan }: { plan: VideoPlan }) => {
  const p = plan && plan.scenes ? plan : DEFAULT_PLAN;
  const bg = (p.theme && p.theme.tokens && p.theme.tokens.bg) || '#0b0b0f';
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <Series>
        {p.scenes.map((sc) => {
          const Comp = SCENE_COMPONENTS[sc.type] || SCENE_COMPONENTS.TitleCard;
          return (
            <Series.Sequence key={sc.id} durationInFrames={Math.max(1, sc.durationInFrames)}>
              <Comp {...sc.props} theme={p.theme} />
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="DesignBookVideo"
      component={VideoFromPlan as any}
      durationInFrames={DEFAULT_PLAN.totalDurationInFrames as number}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ plan: DEFAULT_PLAN }}
      calculateMetadata={({ props }) => {
        const plan: VideoPlan = (props as any).plan || DEFAULT_PLAN;
        return {
          durationInFrames: Math.max(1, plan.totalDurationInFrames || DEFAULT_PLAN.totalDurationInFrames || 225),
          fps: plan.fps || 30,
          width: plan.width || 1920,
          height: plan.height || 1080,
        };
      }}
    />
  );
};
