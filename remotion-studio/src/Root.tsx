import { Composition, AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { SCENE_COMPONENTS } from './registry';
import type { Theme } from './lib/getSceneStyles';

const TRANSITION_FRAMES = 14; // must match designbook/lib/videoplan.js TRANSITION_FRAMES
const presentationFor = (t?: string | null) =>
  t === 'slide-left' ? slide({ direction: 'from-right' })
    : t === 'wipe-up' ? wipe({ direction: 'from-bottom' })
      : fade();

export type Scene = { id: string; type: string; durationInFrames: number; props: any; transition?: string | null };
export type VideoPlan = {
  scenes: Scene[];
  theme: Theme;
  fps?: number;
  width?: number;
  height?: number;
  totalDurationInFrames?: number;
  sfx?: boolean;
  audio?: { music?: { src: string; volume?: number }; voiceover?: { src: string; volume?: number } };
  captions?: { text: string; fromFrame: number; toFrame: number }[];
};

// Music bed + voiceover (agent-attached audio URLs; narration TTS is out of scope
// locally). Music loops low under the SFX; voiceover plays over the whole timeline.
const AudioBed = ({ audio }: { audio?: VideoPlan['audio'] }) => {
  if (!audio) return null;
  return (
    <>
      {audio.music && audio.music.src ? <Audio src={audio.music.src} loop volume={audio.music.volume ?? 0.18} /> : null}
      {audio.voiceover && audio.voiceover.src ? <Audio src={audio.voiceover.src} volume={audio.voiceover.volume ?? 1} /> : null}
    </>
  );
};

// Caption overlays at frame ranges (agent-provided, or from a future whisper pass).
const CaptionLayer = ({ captions }: { captions?: VideoPlan['captions'] }) => {
  if (!captions || !captions.length) return null;
  return (
    <>
      {captions.map((c, i) => (
        <Sequence key={i} from={c.fromFrame || 0} durationInFrames={Math.max(1, (c.toFrame || 0) - (c.fromFrame || 0))}>
          <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 0 84px' }}>
            <div style={{ background: 'rgba(0,0,0,0.62)', color: '#fff', padding: '14px 30px', borderRadius: 12, fontSize: 42, fontWeight: 600, lineHeight: 1.25, fontFamily: 'Inter, system-ui, sans-serif', maxWidth: '78%', textAlign: 'center' }}>{c.text}</div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
};

// SFX layer: whoosh leads each transition, a pop punches the StatBurst, a chime
// lands the CTA. Files are license-free, ffmpeg-synthesized (public/sfx/*.mp3).
const SfxLayer = ({ scenes }: { scenes: Scene[] }) => {
  const events: { frame: number; sfx: string }[] = [];
  let start = 0;
  scenes.forEach((sc, i) => {
    if (i > 0 && sc.transition) events.push({ frame: Math.max(0, start - 7), sfx: 'whoosh' });
    if (sc.type === 'StatBurst') events.push({ frame: start + 6, sfx: 'pop' });
    if (sc.type === 'CTACard') events.push({ frame: start + 4, sfx: 'chime' });
    const next = scenes[i + 1];
    start += (sc.durationInFrames || 0) - (next && next.transition ? TRANSITION_FRAMES : 0);
  });
  return (
    <>
      {events.map((e, i) => (
        <Sequence key={i} from={e.frame} durationInFrames={45}>
          <Audio src={staticFile('sfx/' + e.sfx + '.mp3')} />
        </Sequence>
      ))}
    </>
  );
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
  const children: any[] = [];
  p.scenes.forEach((sc, i) => {
    const Comp = SCENE_COMPONENTS[sc.type] || SCENE_COMPONENTS.TitleCard;
    if (i > 0 && sc.transition) {
      children.push(
        <TransitionSeries.Transition
          key={sc.id + '-t'}
          presentation={presentationFor(sc.transition)}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
      );
    }
    children.push(
      <TransitionSeries.Sequence key={sc.id} durationInFrames={Math.max(1, sc.durationInFrames)}>
        <Comp {...sc.props} theme={p.theme} />
      </TransitionSeries.Sequence>
    );
  });
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <TransitionSeries>{children}</TransitionSeries>
      {/* cinematic vignette — subtle edge darkening so scenes don't read flat/digital */}
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 320px rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
      <CaptionLayer captions={p.captions} />
      {p.sfx !== false ? <SfxLayer scenes={p.scenes} /> : null}
      <AudioBed audio={p.audio} />
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
