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
import { tmpdir } from 'node:os';
import { videoCoherence, totalDuration, TRANSITION_FRAMES } from './videoplan.js';
import { analyzeMotion, analyzeAudio, analyzeStructure, contactSheet } from './videodiag.js';

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
  // gl:'angle' enables WebGL (the @remotion/three ShaderBackground) in headless Chrome.
  _browser = await openBrowser('chrome', { chromiumOptions: { gl: 'angle' } });
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

/**
 * Extract a set of frames from the plan as labeled stills + ONE contact-sheet grid —
 * so a Claude session can be handed "the frames at a place" to eyeball directly.
 * @param {object} opts - { plan, frames?, at?, count?, width?, cols?, shotsDir?, label? }
 *   frames — explicit frame numbers. Else `at` picks them: 'arc' (default) =
 *   evenly-spaced `count` frames across the whole video · 'transitions' = frames
 *   around each cut (before/at/after) · 'scene-starts' = entry + mid of each scene.
 * @returns {Promise<{ok,fps,totalFrames,at,frames:[{frame,sec,url}],sheet:{url,cols,rows}}|{error|skipped}>}
 */
export async function videoFrames({ plan, frames, at = 'arc', count = 12, width = 480, cols = 4, shotsDir, label = 'vframes' } = {}) {
  if (!findRemotion().available) return { skipped: 'Remotion not installed — run: cd remotion-studio && npm install' };
  if (!plan || !plan.scenes) return { error: 'plan required' };
  if (!shotsDir) return { error: 'shotsDir required' };
  const total = totalDuration(plan);
  const fps = plan.fps || 30;
  const clamp = (f) => Math.max(0, Math.min(total - 1, Math.round(f)));

  // scene cut boundaries + starts (mirror sceneKeyframes overlap math)
  const cuts = [], starts = [];
  { let s = 0; const sc = plan.scenes;
    for (let i = 0; i < sc.length; i++) { starts.push(clamp(s + 2)); const next = sc[i + 1]; const end = s + (sc[i].durationInFrames || 0) - ((next && next.transition) ? TRANSITION_FRAMES : 0); if (next) cuts.push(clamp(end)); s = end; } }

  const explicit = Array.isArray(frames) && frames.length;
  let targets = [];
  if (explicit) targets = frames.map(clamp);
  else if (at === 'transitions' && cuts.length) cuts.forEach((c) => targets.push(clamp(c - 8), c, clamp(c + 8)));
  else if (at === 'scene-starts') plan.scenes.forEach((sObj, i) => targets.push(starts[i], clamp(starts[i] + Math.floor((sObj.durationInFrames || 1) / 2))));
  else { const n = Math.max(2, Math.min(24, count)); for (let i = 0; i < n; i++) targets.push(clamp((i / (n - 1)) * (total - 1))); }
  targets = [...new Set(targets)].sort((a, b) => a - b);

  // render each target frame as a still (reuses the memoized studio)
  const out = [];
  for (const f of targets) {
    const shot = await renderPlanStill({ plan, frame: f, label, shotsDir });
    if (shot && shot.path) out.push({ frame: f, sec: Math.round((f / fps) * 100) / 100, path: shot.path, url: shot.url });
    else if (shot && (shot.error || shot.skipped)) return shot;
  }
  if (!out.length) return { error: 'no frames rendered' };

  // tile into one labeled contact sheet
  const sheetPath = join(shotsDir, `${label}-sheet.png`);
  const cs = contactSheet(out.map((o) => o.path), sheetPath, { width, cols, labels: out.map((o) => `f${o.frame}  ${o.sec}s`) });
  return {
    ok: true, fps, totalFrames: total, at: explicit ? 'explicit' : at,
    frames: out.map((o) => ({ frame: o.frame, sec: o.sec, url: o.url })),
    sheet: cs.path ? { url: '/book/shots/' + cs.path.split('/').pop(), cols: cs.cols, rows: cs.rows, count: cs.count } : null,
  };
}

/* ============================================
   diagnoseVideo — the temporal/audio MOAT for video
   ============================================
   The render→diagnose→fix→re-diagnose loop's diagnose step. Runs the three PURE
   deterministic instruments (motion/audio/structure, lib/videodiag.js) over a
   rendered mp4 + the plan, OPTIONALLY fuses a per-scene vision critique (reusing
   critiqueVideo's keyframes + SDK pattern), and emits ONE scored, per-scene,
   actionable report (the page-diagnose digest, for motion).

   Vision is ADDITIVE: when the model is unavailable / throttled, the deterministic
   report is still valid (verdict computed from motion+audio+structure penalties
   only — vision contributes ZERO penalty, never a phantom one). report.visionStatus
   surfaces WHY the perceptual axis was absent.
   ============================================ */

// per-finding penalty weights (page-diagnose style)
const SEV_PENALTY = { high: 16, med: 8, low: 3, soft: 3 };

/**
 * Diagnose a rendered (or freshly-rendered) video across motion/audio/structure
 * (+ optional vision), fused into one scored per-scene report.
 * @param {object} opts - { plan, mp4Path?, shotsDir?, model?, vision? }
 *   mp4Path — analyze this existing mp4 (preferred for tests/CI). If absent and
 *             Remotion is available, renders the plan to a temp mp4 first.
 *   vision  — false to skip the perceptual axis entirely (deterministic-only).
 * @returns {Promise<object>} { ok, score, verdict, scenes[], global, visionStatus, instruments } | {error|skipped}
 */
export async function diagnoseVideo({ plan, mp4Path, shotsDir, model, vision } = {}) {
  if (!plan || !plan.scenes) return { error: 'plan required' };
  const fps = plan.fps || 30;

  // 1) obtain an mp4 to analyze (provided, else render to a temp path)
  let mp4 = mp4Path, rendered = null;
  if (!mp4 || !existsSync(mp4)) {
    if (!findRemotion().available) return { skipped: 'Remotion not installed and no mp4Path — run: cd remotion-studio && npm install, or pass mp4Path' };
    const tmp = join(tmpdir(), `vdiag-render-${Date.now()}.mp4`);
    rendered = await renderVideo({ plan, outPath: tmp });
    if (rendered.error || rendered.skipped) return { error: rendered.error || rendered.skipped };
    mp4 = rendered.path;
  }

  // 2) the three deterministic instruments (pure; never throw the report)
  const motion = analyzeMotion(mp4, plan);
  const audio = analyzeAudio(mp4, plan);
  const structure = analyzeStructure(plan); // plan-only

  // 3) fuse per-scene findings from every instrument onto one shared scene list
  const byId = new Map();
  const order = [];
  const ensure = (s) => {
    if (!byId.has(s.sceneId)) { const o = { sceneId: s.sceneId, type: s.type, frames: s.frames, from: s.from, to: s.to, motion: null, audio: null, structure: null, vision: null, findings: [] }; byId.set(s.sceneId, o); order.push(s.sceneId); }
    return byId.get(s.sceneId);
  };
  for (const s of (motion.scenes || [])) { const o = ensure(s); o.motion = s.motion; for (const f of (s.findings || [])) o.findings.push(f); }
  for (const s of (audio.scenes || [])) { const o = ensure(s); o.audio = s.audio; for (const f of (s.findings || [])) o.findings.push(f); }
  for (const s of (structure.scenes || [])) { const o = ensure(s); o.structure = s.structure; for (const f of (s.findings || [])) o.findings.push(f); }
  // instrument-level findings NOT bound to a scene (e.g. the no-audio-track high,
  // when audio short-circuits with scenes:[]) — fold them into the verdict too.
  const globalFindings = [];
  if (audio && !audio.hasAudio) for (const f of (audio.findings || [])) globalFindings.push(f);

  // 4) per-scene vision critique (additive; degrades to deterministic proxy)
  let visionStatus = 'skipped:disabled';
  let visionResult = null;
  if (vision !== false) {
    visionResult = await visionCritiqueScenes({ plan, shotsDir, model, motion, audio, structure }).catch((e) => ({ skipped: 'threw:' + String((e && e.message) || e).slice(0, 120) }));
    visionStatus = visionResult && visionResult.ok ? (Object.keys(visionResult.scenes || {}).length < (plan.scenes.length) ? 'partial' : 'ok') : ('skipped:' + ((visionResult && visionResult.skipped) || 'unknown'));
  }
  for (const id of order) {
    const o = byId.get(id);
    if (visionResult && visionResult.ok && visionResult.scenes[id]) {
      const v = visionResult.scenes[id];
      o.vision = { score: v.score, alive: v.alive, composition: v.composition, hierarchy: v.hierarchy, aliveness: v.aliveness, tells: v.tells, note: v.note };
      for (const p of (v.perScene || [])) o.findings.push({ dim: 'vision', range: p.range || [o.from, o.to], severity: p.severity || 'med', issue: p.issue, fix: p.fix });
    } else {
      // deterministic vision-proxy: alive iff motion isn't frozen and has presence
      const mp = o.motion || {};
      o.vision = { score: null, alive: mp.pattern ? (mp.pattern !== 'frozen' && !(mp.frozenSpans && mp.frozenSpans.length)) : null, tells: (o.structure && o.structure.verdict && o.structure.verdict !== 'ok') ? [o.structure.verdict] : [], note: 'vision model unavailable — deterministic proxy' };
    }
  }

  // 5) score + verdict (penalties per finding; vision contributes only when present)
  const scenes = order.map((id) => byId.get(id));
  // A single instrument finding whose range straddles a transition overlap is
  // sliced into BOTH adjacent scenes (same object reference). Dedupe by identity
  // so it is penalized once, not twice.
  const allFindings = [...new Set(scenes.flatMap((s) => s.findings))].concat(globalFindings);
  // an info/low advisory that still needs vision arbitration is NOT a conviction
  const convicting = allFindings.filter((f) => !(f.needsVisionArbitration && visionStatus !== 'ok'));
  const penalty = convicting.reduce((p, f) => p + (SEV_PENALTY[f.severity] || 3), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const hasHigh = convicting.some((f) => f.severity === 'high');
  const verdict = (score >= 80 && !hasHigh) ? 'ship' : 'iterate';

  // 6) global summary + the single top fix (highest severity, then first)
  const sevRank = { high: 0, med: 1, soft: 2, low: 3 };
  const top = [...convicting].sort((a, b) => (sevRank[a.severity] ?? 4) - (sevRank[b.severity] ?? 4))[0];
  const global = {
    motionArc: motion.motionArc || null,
    loudnessArc: (audio && audio.loudnessArc) || null,
    durationArc: structure.global && structure.global.durationArc,
    pacing: structure.global && structure.global.pacing,
    transitionCoverage: structure.global && structure.global.transitionCoverage,
    deadAir: (audio && audio.deadAir) || [],
    motion: motion.global || null,
    audio: audio && audio.hasAudio ? { hasAudio: true, integratedLufs: audio.integratedLufs, bed: audio.bed, sfxPresent: audio.sfxPresent, sfxMissing: audio.sfxMissing, sfxMisaligned: audio.sfxMisaligned } : { hasAudio: !!(audio && audio.hasAudio) },
    findingCount: { high: convicting.filter((f) => f.severity === 'high').length, med: convicting.filter((f) => f.severity === 'med').length, soft: convicting.filter((f) => f.severity === 'soft').length, low: convicting.filter((f) => f.severity === 'low').length },
    topFix: top ? top.fix : null,
  };

  return {
    ok: true, score, verdict, visionStatus,
    scenes, globalFindings, global,
    instruments: {
      motion: motion.skipped ? { skipped: motion.skipped } : { diagnostics: motion.diagnostics },
      audio: audio.skipped ? { skipped: audio.skipped } : { hasAudio: audio.hasAudio, diagnostics: audio.diagnostics },
      structure: { structureScore: structure.global && structure.global.structureScore },
      vision: visionResult && visionResult.ok ? { model: visionResult.model, global: visionResult.global } : { skipped: (visionResult && visionResult.skipped) || 'disabled' },
    },
    mp4: { path: mp4, rendered: !!rendered },
  };
}

// ---- per-scene vision critique (FLAGS-before-eyes; degrades gracefully) ----
const VISION_DIAG = `You are a motion-design director reviewing a programmatic SaaS product video scene by scene. For EACH scene you get 1-3 keyframes (entrance/mid/exit) AND a block of MEASURED deterministic flags (per-frame motion energy, audio, structure). The flags are FACTS, not opinions. For each FLAGGED span, judge from the pixels: confirm a real defect, or OVERTURN a false alarm (e.g. a scene the pixel-diff calls 'frozen' that has slow intentional drift a human reads as alive).

Score each scene 0-100 = aliveness(0-30: moving/breathing vs a frozen PowerPoint slide) + composition(0-25) + hierarchy(0-25) + tells(0-20: FEWER AI/stock-deck tells = higher). Calibrate: clean-but-generic 55-68; reserve 85+ for premium art direction.

Respond ONLY with minified JSON, no prose, no code fence:
{"scenes":[{"sceneId":"","aliveness":0,"composition":0,"hierarchy":0,"tells":0,"tellNotes":[],"note":"","perScene":[{"severity":"high|med|low","issue":"","fix":""}]}],"looksAiGenerated":false,"signatureMoment":"","weakestScene":""}`;

async function visionCritiqueScenes({ plan, shotsDir, model, motion, audio, structure }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) return { skipped: 'no-auth' };
  if (!findRemotion().available) return { skipped: 'no-frames' };
  if (!shotsDir) return { skipped: 'no-shotsDir' };

  // entrance/mid/exit keyframes per scene (reuse sceneKeyframes boundary math)
  const total = totalDuration(plan);
  const spans = []; let start = 0;
  for (let i = 0; i < plan.scenes.length; i++) {
    const s = plan.scenes[i]; const from = Math.round(start); const to = Math.round(start + (s.durationInFrames || 0));
    spans.push({ sceneId: s.id, type: s.type, from, to });
    const next = plan.scenes[i + 1]; start += (s.durationInFrames || 0) - ((next && next.transition) ? TRANSITION_FRAMES : 0);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sceneShots = {};
  for (const sp of spans) {
    const L = sp.to - sp.from;
    const e = sp.from + clamp(Math.round(0.12 * L), 3, 18);
    const m = sp.from + Math.round(0.50 * L);
    const x = sp.to - clamp(Math.round(0.10 * L), 2, 12);
    const want = [];
    for (const [role, f] of [['entrance', e], ['mid', m], ['exit', x]]) {
      const fr = clamp(f, 0, total - 1);
      if (!want.some((w) => w.frame === fr)) want.push({ role, frame: fr });
    }
    const shots = [];
    for (const w of want) {
      const s = await renderPlanStill({ plan, frame: w.frame, label: `vdiag-${sp.sceneId}-${w.role}`, shotsDir });
      if (s.path) shots.push({ role: w.role, frame: w.frame, path: s.path });
    }
    if (shots.length) sceneShots[sp.sceneId] = shots;
  }
  if (!Object.keys(sceneShots).length) return { skipped: 'no-frames' };

  // per-scene FLAG DIGEST (only fired flags, scene-LOCAL frames)
  const moById = new Map((motion.scenes || []).map((s) => [s.sceneId, s]));
  const auById = new Map((audio.scenes || []).map((s) => [s.sceneId, s]));
  const stById = new Map((structure.scenes || []).map((s) => [s.sceneId, s]));
  const digest = (sp) => {
    const mo = (moById.get(sp.sceneId) || {}).motion || {};
    const au = (auById.get(sp.sceneId) || {}).audio || {};
    const st = stById.get(sp.sceneId) || {};
    const loc = ([a, b]) => `${a - sp.from}-${b - sp.from}`;
    const lines = [`motion: pattern=${mo.pattern}, mean=${mo.mean}`];
    for (const fz of (mo.frozenSpans || [])) lines.push(`  FROZEN local ${loc(fz)} — CONFIRM: truly static (freeze) or living motion the pixel-diff missed?`);
    for (const lm of (mo.lowMotionSpans || [])) lines.push(`  LOW-MOTION local ${loc(lm)} (mean ${mo.mean}) — intentional calm hold or dead slide?`);
    for (const ev of (au.events || [])) if (ev.class === 'loud' && ev.alignedToCut === false) lines.push(`  SFX '${ev.sfx}' @local ${ev.frame - sp.from} NOT aligned to cut.`);
    for (const d of (au.deadAir || [])) lines.push(`  DEAD-AIR local ${loc(d)} — confirm silent/unfinished.`);
    for (const f of (st.findings || [])) lines.push(`  STRUCTURE: ${f.issue}`);
    return lines.join('\n');
  };
  const blocks = spans.filter((sp) => sceneShots[sp.sceneId]).map((sp) => {
    const kfs = sceneShots[sp.sceneId].map((k) => `    ${k.role}: ${k.path}`).join('\n');
    return `SCENE ${sp.sceneId} (${sp.type}), local frames 0-${sp.to - sp.from}:\n  keyframes:\n${kfs}\n  MEASURED FLAGS:\n${digest(sp) || '  (none)'}`;
  }).join('\n\n');

  let sdk; try { sdk = await import('@anthropic-ai/claude-agent-sdk'); } catch { return { skipped: 'sdk-missing' }; }
  const useModel = model || 'claude-sonnet-4-6';
  let text = '';
  try {
    const stream = sdk.query({ prompt: VISION_DIAG + '\n\n' + blocks, options: { model: useModel, allowedTools: ['Read'], permissionMode: 'bypassPermissions', maxTurns: spans.length + 6, cwd: shotsDir } });
    for await (const msg of stream) {
      if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        const t = msg.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (t) text = t;
      } else if (msg.type === 'result' && typeof msg.result === 'string' && msg.result.trim()) text = msg.result.trim();
    }
  } catch (e) { return { skipped: /429|rate|throttl|timeout|ECONN/i.test(String(e)) ? 'throttled' : 'error', detail: String((e && e.message) || e).slice(0, 200) }; }

  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.scenes)) return { skipped: 'unparseable', raw: text.slice(0, 300) };

  const cl = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const out = {};
  for (const ps of parsed.scenes) {
    const sp = spans.find((s) => s.sceneId === ps.sceneId); if (!sp) continue;
    let aliveness = cl(ps.aliveness, 30);
    // server cap: if motion confirmed a freeze in this scene, cap aliveness
    const mo = (moById.get(sp.sceneId) || {}).motion || {};
    if (mo.frozenSpans && mo.frozenSpans.length) aliveness = Math.min(aliveness, 10);
    const composition = cl(ps.composition, 25), hierarchy = cl(ps.hierarchy, 25), tells = cl(ps.tells, 20);
    out[sp.sceneId] = {
      score: aliveness + composition + hierarchy + tells, aliveness, composition, hierarchy,
      tells: Array.isArray(ps.tellNotes) ? ps.tellNotes.slice(0, 6).map((t) => str(t, 120)) : [],
      alive: aliveness >= 18 && !(mo.frozenSpans && mo.frozenSpans.length),
      note: str(ps.note, 280),
      perScene: Array.isArray(ps.perScene) ? ps.perScene.slice(0, 5).map((p) => ({ severity: ['high', 'med', 'low'].includes(p.severity) ? p.severity : 'med', issue: str(p.issue, 240), fix: str(p.fix, 240), range: [sp.from, sp.to] })) : [],
      keyframes: sceneShots[sp.sceneId].map((k) => ({ role: k.role, frame: k.frame, url: '/book/shots/' + k.path.split('/').pop() })),
    };
  }
  const scoreVals = Object.values(out).map((s) => s.score);
  return {
    ok: true, scenes: out, model: useModel,
    global: { avgVisionScore: scoreVals.length ? Math.round(scoreVals.reduce((a, c) => a + c, 0) / scoreVals.length) : null, looksAiGenerated: !!parsed.looksAiGenerated, signatureMoment: str(parsed.signatureMoment, 400), weakestScene: str(parsed.weakestScene, 60) || (Object.entries(out).sort((a, b) => a[1].score - b[1].score)[0] || [null])[0] },
  };
}
