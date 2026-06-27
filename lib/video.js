/* ============================================
   designbook · lib/video.js — the VIDEO render/critique/refine engine
   ============================================
   The model-shell of the video pipeline, isolated behind an optional-dep guard
   exactly like lib/imagegen.js guards mflux: it lazy-loads Remotion from the
   sibling remotion-studio/ sub-project (its OWN node_modules, by absolute path),
   so the designbook core stays zero-build. findRemotion() degrades to
   { skipped } when that project isn't installed — the deterministic
   book_video_compose (lib/videoplan.js) always works regardless.

   Renders a VIDEO PLAN (lib/videoplan.js): one frame → facts (book_video_inspect/
   _view), keyframes → vision taste (book_video_critique), the plan JSON rewritten
   → book_video_refine, the whole thing → MP4 (book_video_render). The bundle()
   serveUrl and one openBrowser('chrome') are memoized module-wide (render-api
   gotcha: a fresh bundle + Chrome per render is seconds of waste + leaks).
   ============================================ */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { videoCoherence, totalDuration, TRANSITION_FRAMES } from './videoplan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUDIO = join(__dirname, '..', 'remotion-studio');
const ENTRY = join(STUDIO, 'src', 'index.ts');
const COMPOSITION_ID = 'DesignBookVideo';

// ---- optional-dep guard (mirrors imagegen.findMflux) ----
export function findRemotion() {
  const ok = existsSync(join(STUDIO, 'node_modules', '@remotion', 'renderer')) &&
             existsSync(join(STUDIO, 'node_modules', '@remotion', 'bundler')) &&
             existsSync(ENTRY);
  return ok ? { studio: STUDIO, available: true } : { available: false };
}

let _renderer = null;
function remotion() {
  if (_renderer) return _renderer;
  const req = createRequire(join(STUDIO, 'package.json'));
  const { bundle } = req('@remotion/bundler');
  const r = req('@remotion/renderer');
  _renderer = { bundle, ...r };
  return _renderer;
}

// ---- memoized bundle + browser (build once, reuse for every render) ----
let _serveUrl = null;
let _browser = null;

async function ensureBundle() {
  if (_serveUrl) return _serveUrl;
  const { bundle } = remotion();
  _serveUrl = await bundle({ entryPoint: ENTRY });
  return _serveUrl;
}
async function ensureBrowser() {
  if (_browser) return _browser;
  const { openBrowser } = remotion();
  _browser = await openBrowser('chrome');
  return _browser;
}
/** release the memoized Chrome (optional shutdown hook). */
export async function closeStudio() {
  if (_browser) { try { await _browser.close({ silent: true }); } catch {} _browser = null; }
}

async function select(plan) {
  const serveUrl = await ensureBundle();
  const browser = await ensureBrowser();
  const { selectComposition } = remotion();
  // inputProps must be passed to BOTH selectComposition and the render call (kept identical)
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: { plan }, puppeteerInstance: browser });
  return { serveUrl, browser, composition };
}

// scene id → the global frame at the MIDDLE of that scene (the representative keyframe)
function sceneKeyframes(plan) {
  const total = totalDuration(plan);
  const scenes = plan.scenes || [];
  const out = [];
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    out.push({ sceneId: s.id, type: s.type, frame: Math.min(total - 1, start + Math.floor((s.durationInFrames || 1) / 2)) });
    const next = scenes[i + 1];
    start += (s.durationInFrames || 0) - ((next && next.transition) ? TRANSITION_FRAMES : 0); // overlap pull
  }
  return out;
}

/**
 * Render ONE frame of the plan to a PNG. The book_video_inspect/_view primitive.
 * @returns {Promise<{path,url,width,height}|{error}>}
 */
export async function renderPlanStill({ plan, frame = 0, label = 'video', shotsDir }) {
  if (!findRemotion().available) return { skipped: 'Remotion not installed — run: cd remotion-studio && npm install' };
  if (!plan || !plan.scenes) return { error: 'plan required' };
  if (!shotsDir) return { error: 'shotsDir required' };
  if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });
  try {
    const { serveUrl, browser, composition } = await select(plan);
    const { renderStill } = remotion();
    const fr = Math.max(0, Math.min((composition.durationInFrames || 1) - 1, Math.round(frame)));
    const out = join(shotsDir, `${label}-f${fr}.png`);
    // NB: the still output field is `output` (NOT renderMedia's outputLocation)
    await renderStill({ composition, serveUrl, output: out, frame: fr, inputProps: { plan }, puppeteerInstance: browser });
    return { path: out, url: '/book/shots/' + out.split('/').pop(), width: composition.width, height: composition.height, frame: fr };
  } catch (e) {
    return { error: 'render threw: ' + String((e && e.message) || e) };
  }
}

/**
 * FACTS-before-pixels for video: render one keyframe per scene + structural facts.
 * @returns {Promise<{ok,facts,scenes,coherence,contactSheet}|{error|skipped}>}
 */
export async function inspectVideo({ plan, shotsDir }) {
  if (!findRemotion().available) return { skipped: 'Remotion not installed — run: cd remotion-studio && npm install' };
  if (!plan || !plan.scenes) return { error: 'plan required' };
  const coh = videoCoherence(plan);
  const keys = sceneKeyframes(plan);
  const scenes = [];
  for (const k of keys) {
    const shot = await renderPlanStill({ plan, frame: k.frame, label: `vinspect-${k.sceneId}`, shotsDir });
    scenes.push({
      sceneId: k.sceneId, type: k.type, keyframe: k.frame,
      rendered: !!shot.path, error: shot.error || null, url: shot.url || null,
      missingMedia: /Showcase|Feature/.test(k.type) && !(plan.scenes.find((s) => s.id === k.sceneId)?.props?.media?.src),
    });
  }
  return {
    ok: true,
    facts: { aspect: plan.aspect, dimensions: `${plan.width}x${plan.height}`, fps: plan.fps, sceneCount: plan.scenes.length, totalFrames: totalDuration(plan), totalSeconds: coh.totalSeconds },
    coherence: { score: coh.score, ok: coh.ok, findings: coh.findings },
    scenes,
  };
}

// ---- vision critique (mirrors lib/critique.js, multi-frame + a motion rubric) ----
const VIDEO_CRITIC = `You are a motion-design director reviewing keyframes from a programmatic SaaS product video (one still per scene, in order). Judge the PIXELS.

Score 0-100 across (weights): composition&hierarchy (0-35), motion-craft readiness — type scale, spacing, focal clarity, on-brand color, device/cursor framing (0-30), originality & signature moment vs generic (0-20), copy quality — specific vs filler (0-15).

Calibrate honestly: a clean-but-generic deck scores 55-68. Reserve 85+ for genuinely premium, art-directed work.

For each weak scene give a LOCATED fix (the scene id, what you see, the specific change). Name the ONE signature moment the video has — or the highest-impact one it SHOULD have.

Respond with ONLY a minified JSON object, no prose, no code fence:
{"scores":{"composition":<int>,"motion":<int>,"originality":<int>,"copy":<int>},"verdict":"<one sentence>","looksAiGenerated":<bool>,"signatureMoment":"<...>","perScene":[{"sceneId":"<id>","severity":"high|med|low","observe":"<...>","fix":"<...>"}]}`;

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(raw.slice(a, b + 1)); } catch { return null; }
}

/**
 * The TASTE half for video: render keyframes + a vision model scores them.
 * @returns {Promise<object>} { ok, scores:{...,total}, verdict, looksAiGenerated, signatureMoment, perScene[], keyframes[] } | {error|skipped}
 */
export async function critiqueVideo({ plan, shotsDir, model }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    return { error: 'No SDK auth — set CLAUDE_CODE_OAUTH_TOKEN (subscription) or ANTHROPIC_API_KEY' };
  }
  if (!findRemotion().available) return { skipped: 'Remotion not installed — run: cd remotion-studio && npm install' };
  if (!plan || !plan.scenes) return { error: 'plan required' };

  // 1) render one keyframe per scene
  const keys = sceneKeyframes(plan);
  const shots = [];
  for (const k of keys) {
    const shot = await renderPlanStill({ plan, frame: k.frame, label: `vcrit-${k.sceneId}`, shotsDir });
    if (shot.path) shots.push({ sceneId: k.sceneId, type: k.type, path: shot.path });
  }
  if (!shots.length) return { error: 'no keyframes rendered' };

  // 2) vision critique — the model Reads the keyframe PNGs (proven SDK auth)
  let sdk;
  try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
  catch { return { error: 'SDK not installed', keyframes: shots.map((s) => s.path) }; }
  const useModel = model || 'claude-sonnet-4-6';
  const list = shots.map((s, i) => `${i + 1}. scene ${s.sceneId} (${s.type}): ${s.path}`).join('\n');
  let text = '';
  try {
    const stream = sdk.query({
      prompt: `${VIDEO_CRITIC}\n\nRead these scene keyframes in order, then critique the video:\n${list}`,
      options: { model: useModel, allowedTools: ['Read'], permissionMode: 'bypassPermissions', maxTurns: shots.length + 4, cwd: shotsDir },
    });
    for await (const m of stream) {
      if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (t) text = t;
      } else if (m.type === 'result' && typeof m.result === 'string' && m.result.trim()) text = m.result.trim();
    }
  } catch (e) { return { error: 'critique threw: ' + String((e && e.message) || e), keyframes: shots.map((s) => s.path) }; }

  const parsed = extractJson(text);
  if (!parsed) return { error: 'critique returned no parseable JSON', raw: text.slice(0, 400) };
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const sc = parsed.scores || {};
  const scores = { composition: clamp(sc.composition, 35), motion: clamp(sc.motion, 30), originality: clamp(sc.originality, 20), copy: clamp(sc.copy, 15) };
  scores.total = scores.composition + scores.motion + scores.originality + scores.copy;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    ok: true, scores,
    verdict: str(parsed.verdict, 300), looksAiGenerated: !!parsed.looksAiGenerated, signatureMoment: str(parsed.signatureMoment, 400),
    perScene: Array.isArray(parsed.perScene) ? parsed.perScene.slice(0, 16).map((p) => ({ sceneId: str(p.sceneId, 40), severity: ['high', 'med', 'low'].includes(p.severity) ? p.severity : 'med', observe: str(p.observe, 280), fix: str(p.fix, 280) })) : [],
    keyframes: shots.map((s) => ({ sceneId: s.sceneId, url: '/book/shots/' + s.path.split('/').pop() })),
    model: useModel,
  };
}

// ---- refine the PLAN JSON (mirrors lib/refine.js; plans are small → full rewrite is safe) ----
const REFINE_PLAN = (planJson, critique, instruction) => `You are improving a programmatic SaaS video by editing its PLAN (JSON), not React code. Apply the critique fixes (and any instruction) by editing scene props, copy, durations, scene order, theme — minimal diff, keep what works.

Hard rules:
- Output ONLY the complete revised plan as minified JSON (no prose, no code fence).
- Preserve the schema: keep kind, genre, aspect, fps, width, height, theme, and each scene's {id, type, durationInFrames, props, transition}. Only use scene "type" values that already appear in the plan.
- Keep durations within reason (30-180 frames), the last scene a CTACard, ≥3 scenes. Write specific, real copy — never lorem or vague superlatives.
${instruction ? `- Also apply: ${instruction}\n` : ''}
CRITIQUE:
verdict: ${critique && critique.verdict || ''}
signatureMoment: ${critique && critique.signatureMoment || ''}
perScene fixes: ${JSON.stringify((critique && critique.perScene) || [])}

CURRENT PLAN:
${planJson}

Output the revised plan JSON now.`;

/**
 * Rewrite the plan to apply critique fixes (+ optional instruction). verify re-critiques.
 * @returns {Promise<object>} { ok, plan, before, after, delta } | {error|skipped}
 */
export async function refineVideo({ plan, critique: crit, instruction, verify = false, shotsDir, model }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) return { error: 'No SDK auth' };
  if (!plan || !plan.scenes) return { error: 'plan required' };
  const useModel = model || 'claude-sonnet-4-6';

  let before = crit && crit.scores ? crit : null;
  if (!before && !instruction) {
    before = await critiqueVideo({ plan, shotsDir, model: useModel });
    if (before.error || before.skipped) return { error: before.error || before.skipped };
  }

  let sdk;
  try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
  catch { return { error: 'SDK not installed' }; }
  let text = '';
  try {
    const stream = sdk.query({
      prompt: REFINE_PLAN(JSON.stringify(plan), before, instruction),
      options: { model: useModel, allowedTools: [], maxTurns: 1 },
    });
    for await (const m of stream) {
      if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (t) text = t;
      } else if (m.type === 'result' && typeof m.result === 'string' && m.result.trim()) text = m.result.trim();
    }
  } catch (e) { return { error: 'refine threw: ' + String((e && e.message) || e) }; }

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.scenes)) return { error: 'refine returned no valid plan', raw: text.slice(0, 400) };
  // re-derive trustworthy fields server-side (never trust the model's arithmetic/dimensions)
  parsed.kind = 'video';
  parsed.aspect = plan.aspect; parsed.fps = plan.fps; parsed.width = plan.width; parsed.height = plan.height;
  parsed.theme = parsed.theme && parsed.theme.tokens ? parsed.theme : plan.theme;
  parsed.totalDurationInFrames = totalDuration(parsed);
  const cohAfter = videoCoherence(parsed);

  let after = null;
  if (verify) {
    const a = await critiqueVideo({ plan: parsed, shotsDir, model: useModel });
    if (a.ok) after = { total: a.scores.total, scores: a.scores, verdict: a.verdict, looksAiGenerated: a.looksAiGenerated };
  }
  return {
    ok: true, plan: parsed, coherence: { score: cohAfter.score, ok: cohAfter.ok, findings: cohAfter.findings },
    before: before && before.scores ? { total: before.scores.total } : null,
    after, delta: (after && before && before.scores) ? after.total - before.scores.total : null,
    model: useModel,
  };
}

/**
 * Render the whole plan to an MP4 (deterministic, no model — just slow).
 * @returns {Promise<{ok,path,bytes,durationFrames}|{error|skipped}>}
 */
export async function renderVideo({ plan, outPath, onProgress }) {
  if (!findRemotion().available) return { skipped: 'Remotion not installed — run: cd remotion-studio && npm install' };
  if (!plan || !plan.scenes) return { error: 'plan required' };
  if (!outPath) return { error: 'outPath required' };
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    const { serveUrl, browser, composition } = await select(plan);
    const { renderMedia } = remotion();
    await renderMedia({
      composition, serveUrl, codec: 'h264', outputLocation: outPath, inputProps: { plan },
      puppeteerInstance: browser, concurrency: null, // null ≈ half the CPU threads — don't starve the box
      pixelFormat: 'yuv420p', crf: 18,
      onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
    });
    return { ok: true, path: outPath, bytes: statSync(outPath).size, durationFrames: composition.durationInFrames, dimensions: `${composition.width}x${composition.height}` };
  } catch (e) {
    return { error: 'render threw: ' + String((e && e.message) || e) };
  }
}
