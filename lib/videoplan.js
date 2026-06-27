/* ============================================
   designbook · lib/videoplan.js — the deterministic VIDEO PLAN composer
   ============================================
   The book_video_compose of the video pipeline: pure JS, zero-dep, no Chrome,
   no model — emits a structured VIDEO PLAN (ordered scenes with blessed frame
   durations + real placeholder copy + a theme) that mirrors how composeWithScore
   drafts a page for FREE. A plan is the single source of truth: lib/video.js
   renders it (one frame for facts, all frames for the MP4); the Remotion
   sub-project (remotion-studio/src/Root.tsx) maps plan.scenes[] into a Series.

   Determinism law (or the critiqued still and the rendered frame diverge and
   facts-before-pixels collapses): scene props are static per plan; ALL motion is
   useCurrentFrame()+interpolate(clamp)+spring()+seeded random() in the .tsx —
   NEVER Math.random/Date.now/CSS-animation. videoCoherence enforces the plan
   half; the scene lint enforces the render half.
   ============================================ */
import { defaultArchetype } from './archetypes.js';

// 30fps everywhere — blessed scene durations below are in FRAMES at 30fps.
export const FPS = 30;

export const ASPECTS = {
  '16:9': { width: 1920, height: 1080 },   // landscape — the default product video
  '1:1': { width: 1080, height: 1080 },    // square — social feed
  '9:16': { width: 1080, height: 1920 },   // vertical — stories/reels
};

// The 8 shipped scene templates (reimplemented from scratch — Locomotion is
// unlicensed, never copied). dur = blessed default frames; range = allowed band
// the coherence gate checks; defaults = real, specific placeholder copy (never
// lorem) the agent/book_video_refine overwrites.
export const SCENES = {
  LogoReveal:        { dur: 45,  range: [40, 60],   role: 'open',  defaults: { wordmark: 'Acme', tagline: '' } },
  TitleCard:         { dur: 75,  range: [60, 90],   role: 'open',  defaults: { kicker: '', headline: 'Ship it faster.', subhead: 'The workspace your team actually wants to use.' } },
  FeatureCard:       { dur: 90,  range: [75, 120],  role: 'body',  defaults: { headline: 'Built for momentum', body: 'Everything in one place, nothing in your way.', media: null } },
  ScreenshotShowcase:{ dur: 120, range: [90, 150],  role: 'body',  defaults: { caption: 'See it in action', media: { src: null, deviceFrame: 'browser' }, cursorPath: null } },
  StatBurst:         { dur: 50,  range: [45, 60],   role: 'body',  defaults: { stat: 98, suffix: '%', label: 'faster than before' } },
  BulletList:        { dur: 90,  range: [60, 120],  role: 'body',  defaults: { kicker: 'Why teams switch', items: ['Real-time, not eventually', 'Zero setup', 'Yours to own'] } },
  QuoteCard:         { dur: 90,  range: [75, 110],  role: 'body',  defaults: { quote: 'It paid for itself in a week.', attribution: 'A very happy customer', avatar: null } },
  CTACard:           { dur: 60,  range: [50, 80],   role: 'close', defaults: { headline: 'Start building today', buttonLabel: 'Get started', urlText: 'acme.com' } },
};

// genre → ordered scene sequence. Always opens with an open-role scene and ends
// with CTACard (the mandatory close), mirroring how the page composer sequences
// sections per genre. Unknown genres fall back to a strong generic arc.
export const GENRE_SEQUENCES = {
  saas:       ['TitleCard', 'FeatureCard', 'ScreenshotShowcase', 'StatBurst', 'FeatureCard', 'CTACard'],
  startup:    ['LogoReveal', 'TitleCard', 'StatBurst', 'FeatureCard', 'CTACard'],
  agency:     ['TitleCard', 'ScreenshotShowcase', 'QuoteCard', 'FeatureCard', 'CTACard'],
  portfolio:  ['TitleCard', 'ScreenshotShowcase', 'ScreenshotShowcase', 'QuoteCard', 'CTACard'],
  ecommerce:  ['TitleCard', 'ScreenshotShowcase', 'FeatureCard', 'StatBurst', 'CTACard'],
  restaurant: ['TitleCard', 'ScreenshotShowcase', 'QuoteCard', 'CTACard'],
  blog:       ['TitleCard', 'BulletList', 'QuoteCard', 'CTACard'],
  landing:    ['TitleCard', 'FeatureCard', 'BulletList', 'StatBurst', 'CTACard'],
};
const FALLBACK_SEQUENCE = ['TitleCard', 'FeatureCard', 'StatBurst', 'CTACard'];

// blessed transitions between scenes (the @remotion/transitions vocabulary).
const TRANSITIONS = ['fade', 'slide-left', 'wipe-up'];

// copy variants per scene type, picked by occurrence — so a repeated scene
// (saas uses FeatureCard twice) gets DIFFERENT placeholder copy, not a duplicate
// (the critique flagged "two identical duplicate scenes"). Agent overwrites these.
const COPY_VARIANTS = {
  FeatureCard: [
    { headline: 'Built for momentum', body: 'Everything in one place, nothing in your way.' },
    { headline: 'Works the way you think', body: 'Keyboard-first, real-time, no busywork.' },
    { headline: 'Scales with you', body: 'From your first project to your thousandth.' },
  ],
  StatBurst: [
    { stat: 98, suffix: '%', label: 'faster than before' },
    { stat: 10, suffix: 'x', label: 'less manual work' },
    { stat: 5, suffix: 'min', label: 'to first value' },
  ],
  ScreenshotShowcase: [
    { caption: 'See it in action' },
    { caption: 'Everything at a glance' },
  ],
};

const BLESSED_DURATIONS = new Set(Object.values(SCENES).map((s) => s.dur));

function clone(v) { return JSON.parse(JSON.stringify(v)); }

/**
 * Compose a deterministic video plan for a genre. FREE, instant, no deps.
 * @param {object} opts - { genre, preset?, aspect?, seed?, theme? }
 *   theme (optional) = { preset, palette, aesthetic, tokens:{bg,ink,accent,muted} }
 *   resolved by the caller from the vault (server composeVideoWithScore); when
 *   omitted a neutral default theme is used so the composer stays pure/testable.
 * @returns {object} the video plan
 */
export function composeVideoPlan(opts = {}) {
  const genre = String(opts.genre || 'landing').toLowerCase();
  const aspect = ASPECTS[opts.aspect] ? opts.aspect : '16:9';
  const seed = Number.isFinite(opts.seed) ? Math.abs(Math.trunc(opts.seed)) : 0;
  // floor-raiser parity: a bare compose gets a curated archetype, never generic.
  const preset = opts.preset || defaultArchetype(genre, seed);
  const theme = opts.theme || { preset, palette: null, aesthetic: null, tokens: defaultTokens() };

  let seq = GENRE_SEQUENCES[genre] || FALLBACK_SEQUENCE;
  // page-clone: guarantee a ScreenshotShowcase to hold the real page screenshot,
  // even if the genre sequence didn't include one (e.g. landing/blog).
  const pageShot = opts.pageShot || null;
  if (pageShot && !seq.includes('ScreenshotShowcase')) {
    seq = seq.slice();
    seq.splice(Math.min(1, seq.length - 1), 0, 'ScreenshotShowcase'); // after the opener
  }
  const occ = {};
  const scenes = seq.map((type, i) => {
    const tpl = SCENES[type] || SCENES.FeatureCard;
    const pool = COPY_VARIANTS[type];
    const variant = pool ? pool[(occ[type] || 0) % pool.length] : null; // vary repeats
    occ[type] = (occ[type] || 0) + 1;
    return {
      id: `s${i + 1}-${type.toLowerCase()}`,
      type,
      durationInFrames: tpl.dur,
      props: { ...clone(tpl.defaults), ...(variant ? clone(variant) : {}) },
      // first scene has no incoming transition; rest rotate the blessed set by seed
      transition: i === 0 ? null : TRANSITIONS[(i + seed) % TRANSITIONS.length],
    };
  });
  if (pageShot) { // drop the real page screenshot into the showcase scene(s)
    for (const sc of scenes) if (sc.type === 'ScreenshotShowcase') sc.props.media = { src: pageShot, deviceFrame: 'browser' };
  }

  return {
    kind: 'video',
    genre,
    preset,
    aspect,
    fps: FPS,
    width: ASPECTS[aspect].width,
    height: ASPECTS[aspect].height,
    theme,
    scenes,
    totalDurationInFrames: totalDuration({ scenes }),
    seed,
    pageSlug: opts.pageSlug || null,
    sfx: opts.sfx !== false, // SFX on by default; pass sfx:false to silence
  };
}

function defaultTokens() {
  // neutral, on-brand-ish default; the server overrides with real vault palette tokens.
  return { bg: '#0b0b0f', ink: '#f5f5f7', accent: '#6c8cff', muted: '#9aa0aa' };
}

// Cross-scene transitions OVERLAP adjacent scenes by TRANSITION_FRAMES, so the
// composition is that much shorter than the raw sum. Root.tsx builds the matching
// TransitionSeries; sceneKeyframes (lib/video.js) uses the same overlap so a
// keyframe lands in a scene's clear middle, not inside a transition.
export const TRANSITION_FRAMES = 14;
export function totalDuration(plan) {
  const scenes = plan.scenes || [];
  const sum = scenes.reduce((n, s) => n + (s.durationInFrames || 0), 0);
  const nT = scenes.filter((s, i) => i > 0 && s.transition).length;
  return Math.max(1, sum - TRANSITION_FRAMES * nT);
}

/**
 * Score a plan 0-100 for video coherence + the determinism/structure laws.
 * Pure + deterministic — the videoCoherence half of the save-gate.
 * @returns {{score:number, ok:boolean, findings:Array}}
 */
export function videoCoherence(plan) {
  const findings = [];
  const scenes = plan.scenes || [];
  const n = scenes.length;

  if (n < 3) findings.push({ check: 'too-short', severity: 'high', note: `${n} scenes — a video needs ≥3 (open, body, close)` });
  if (n > 8) findings.push({ check: 'too-long', severity: 'soft', note: `${n} scenes — keep it tight (≤8)` });

  const last = scenes[n - 1];
  if (!last || last.type !== 'CTACard') findings.push({ check: 'no-cta-close', severity: 'high', note: 'a product video must end on CTACard' });
  const first = scenes[0];
  if (first && SCENES[first.type] && SCENES[first.type].role !== 'open') findings.push({ check: 'weak-open', severity: 'soft', note: `opens on ${first.type} — prefer a TitleCard/LogoReveal hook` });

  for (const s of scenes) {
    if (!SCENES[s.type]) { findings.push({ check: 'unknown-scene', severity: 'high', note: `${s.type} is not a registered scene template` }); continue; }
    const [lo, hi] = SCENES[s.type].range;
    if (s.durationInFrames < lo || s.durationInFrames > hi) {
      findings.push({ check: 'unblessed-duration', severity: 'soft', note: `${s.type} @ ${s.durationInFrames}f outside blessed ${lo}-${hi}f` });
    }
    if (!s.props || typeof s.props !== 'object') findings.push({ check: 'missing-props', severity: 'high', note: `${s.id} has no props` });
  }

  const totalSec = totalDuration(plan) / (plan.fps || FPS);
  if (totalSec < 8) findings.push({ check: 'runtime-short', severity: 'soft', note: `${totalSec.toFixed(1)}s — most product videos are 15-60s` });
  if (totalSec > 90) findings.push({ check: 'runtime-long', severity: 'soft', note: `${totalSec.toFixed(1)}s — over 90s loses attention` });

  const penalty = findings.reduce((p, f) => p + (f.severity === 'high' ? 22 : 6), 0);
  const score = Math.max(0, 100 - penalty);
  return { score, ok: score >= 80 && !findings.some((f) => f.severity === 'high'), findings, totalSeconds: Number(totalSec.toFixed(1)) };
}

export const VIDEO_GENRES = Object.keys(GENRE_SEQUENCES);
export const SCENE_TYPES = Object.keys(SCENES);
