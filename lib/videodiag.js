/* ============================================
   designbook · lib/videodiag.js — deterministic VIDEO DIAGNOSIS instruments
   ============================================
   The temporal/audio equivalent of the page MOAT. A rendered still is blind to
   motion, timing and audio — the exact axes that kept being wrong (too-zoomy,
   PowerPoint-frozen, goofy sound). This module adds three PURE, deterministic
   analyzers over (mp4Path, plan):

     analyzeMotion   — per-frame frame-to-frame difference (ffmpeg tblend) →
                       frozen / front-loaded / sustained / chaotic / calm-hold.
     analyzeAudio    — loudness envelope, dead-air, SFX-event→cut alignment, bed.
     analyzeStructure— plan-only: blessed durations, pacing rhythm, transition
                       coverage, UIDemo interaction completeness.

   ZERO-DEP ESM. Shells out to ffmpeg/ffprobe (node:child_process). Standalone:
     node -e "import('./lib/videodiag.js').then(m=>import('./lib/videoplan.js')
       .then(p=>console.log(JSON.stringify(m.analyzeStructure(p.composeVideoPlan({genre:'saas'})),null,1))))"

   Determinism law: the plan is the source of truth; diagnosis is read-only over
   a rendered mp4 + the plan. Scene boundary math MIRRORS lib/video.js
   sceneKeyframes / Root.tsx SfxLayer exactly (start += dur - (next.transition?14:0))
   so motion/audio/structure ranges all line up.
   ============================================ */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENES, TRANSITION_FRAMES, FPS, totalDuration, videoCoherence } from './videoplan.js';

// ---- shared constants ----
const BEAT = 12; // ~entrance window in frames

// ---- small numeric helpers ----
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a, m) => (a.length ? Math.sqrt(avg(a.map((v) => (v - (m ?? avg(a))) ** 2))) : 0);
const r2 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 100) / 100);
const r1 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 10) / 10);
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function percentile(arr, p) {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = clampN(Math.round((a.length - 1) * p), 0, a.length - 1);
  return a[idx];
}

// dB ↔ linear power (averaging dB directly is wrong — go through power)
const P = (db) => 10 ** (db / 10);
const D = (p) => 10 * Math.log10(Math.max(p, 1e-12));

const SPARK = '▁▂▃▄▅▆▇█';
function sparkline(values, buckets, scale) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return '';
  const per = Math.max(1, Math.ceil(v.length / buckets));
  let out = '';
  for (let i = 0; i < v.length; i += per) {
    const m = avg(v.slice(i, i + per));
    out += SPARK[clampN(Math.round(m / scale), 0, 8)];
  }
  return out;
}

function ff(args) {
  // run ffmpeg/ffprobe; throws on non-zero. Capture stderr (ffmpeg prints there).
  return execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
}
function ffSafe(bin, args) {
  // ffmpeg writes its analysis output (astats/silencedetect/ebur128/ametadata)
  // to STDERR even on success, and execFileSync discards stderr on a 0 exit.
  // spawnSync captures both regardless of exit code, so merge stdout+stderr.
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 27 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.error) return { ok: false, out, err: String(r.error.message || r.error) };
  return { ok: r.status === 0, out, err: r.status === 0 ? null : `exit ${r.status}` };
}

// scene boundary walk — IDENTICAL overlap formula to sceneKeyframes & SfxLayer
function boundaries(plan) {
  const out = []; let start = 0; const sc = (plan && plan.scenes) || [];
  for (let i = 0; i < sc.length; i++) {
    const s = sc[i], next = sc[i + 1];
    out.push({ i, id: s.id, type: s.type, scene: s, from: Math.round(start), to: Math.round(start + (s.durationInFrames || 0)) });
    start += (s.durationInFrames || 0) - ((next && next.transition) ? TRANSITION_FRAMES : 0);
  }
  return out;
}

/* ════════════════════════════════════════════
   1) MOTION  —  analyzeMotion(mp4Path, plan)
   ════════════════════════════════════════════ */
const MOTION = {
  FROZEN_FLOOR: 0.12,      // YAVG below which a frame is "no motion" (empty valley between codec noise ~0.006 and ambient floor ~0.25)
  FROZEN_MIN_FRAMES: 8,    // run length to call a span frozen (~0.27s @30)
  GLITCH_TOL: 2,           // above-floor frames bridged inside a freeze (GOP/I-frame artifacts)
  CALM_LO: 0.12, CALM_HI: 1.0, CALM_MIN_FRAMES: 24, // calm-hold advisory band
  ALIVE_FLOOR: 1.5,        // scene mean above which motion is clearly sufficient
  FRONT_RATIO: 2.5,        // firstThird/lastThird ratio for front-loaded
  CHAOS_CV: 0.6, CHAOS_MEAN: 3.5, CHAOS_HOTFRAC: 0.5,
};

// maximal runs where YAVG<floor for >=minLen, bridging <=tol above-floor frames
function runsBelow(seg, base, floor, minLen, tol) {
  const spans = []; let i = 0; const n = seg.length;
  while (i < n) {
    if (seg[i] < floor) {
      let j = i, glitch = 0, lastBelow = i;
      while (j < n) {
        if (seg[j] < floor) { lastBelow = j; j++; }
        else if (glitch < tol) { glitch++; j++; }
        else break;
      }
      const len = lastBelow - i + 1;
      if (len >= minLen) spans.push([base + i, base + lastBelow]);
      i = j;
    } else i++;
  }
  return spans;
}
// maximal runs where lo<=YAVG<hi for >=minLen
function runsInBand(seg, base, lo, hi, minLen) {
  const spans = []; let i = 0; const n = seg.length;
  while (i < n) {
    if (seg[i] >= lo && seg[i] < hi) {
      let j = i; while (j < n && seg[j] >= lo && seg[j] < hi) j++;
      if (j - i >= minLen) spans.push([base + i, base + j - 1]);
      i = j;
    } else i++;
  }
  return spans;
}

export function analyzeMotion(mp4Path, plan) {
  if (!mp4Path || !existsSync(mp4Path)) return { skipped: 'mp4 not found: ' + mp4Path };
  const fps = (plan && plan.fps) || FPS;
  const tmp = mkdtempSync(join(tmpdir(), 'vdiag-motion-'));
  const statsFile = join(tmp, 'mstats.txt');
  let motion = [];
  try {
    const res = ffSafe('ffmpeg', ['-y', '-i', mp4Path, '-vf',
      `tblend=all_mode=difference,signalstats,metadata=print:file=${statsFile}`, '-an', '-f', 'null', '-']);
    if (!res.ok && !existsSync(statsFile)) return { skipped: 'ffmpeg produced no motion stats', detail: String(res.err).slice(0, 200) };
    const txt = existsSync(statsFile) ? readFileSync(statsFile, 'utf8') : '';
    motion = txt.split('\n')
      .map((l) => l.match(/lavfi\.signalstats\.YAVG=([\d.]+)/))
      .filter(Boolean).map((m) => parseFloat(m[1])).filter(Number.isFinite);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  if (!motion.length) return { skipped: 'ffmpeg produced no motion stats' };

  const bounds = boundaries(plan);
  const scenes = bounds.map((b) => {
    // tblend yields N-1 diffs for N frames → slice [from, to-1]
    const seg = motion.slice(b.from, Math.max(b.from, b.to - 1)).filter(Number.isFinite);
    const baseObj = { type: b.type, sceneId: b.id, frames: `${b.from}-${b.to}`, from: b.from, to: b.to };
    if (seg.length < 3) return { ...baseObj, motion: { mean: null, pattern: 'unknown', frozenSpans: [], lowMotionSpans: [], verdict: 'too few frames' }, findings: [] };
    const mean = avg(seg), sd = std(seg, mean), cv = sd / (mean || 1e-6), max = Math.max(...seg);
    const t = Math.floor(seg.length / 3);
    const thirds = { first: avg(seg.slice(0, t)), mid: avg(seg.slice(t, 2 * t)), last: avg(seg.slice(2 * t)) };
    const entrancePeak = Math.max(...seg.slice(0, Math.min(BEAT, seg.length)));
    const hotFrac = seg.filter((v) => v > 3.0).length / seg.length;
    const frozenSpans = runsBelow(seg, b.from, MOTION.FROZEN_FLOOR, MOTION.FROZEN_MIN_FRAMES, MOTION.GLITCH_TOL);
    const lowSpans = runsInBand(seg, b.from, MOTION.CALM_LO, MOTION.CALM_HI, MOTION.CALM_MIN_FRAMES);

    let pattern, verdict;
    if (frozenSpans.length) { pattern = 'frozen'; verdict = `frozen span(s) ${frozenSpans.map((s) => s.join('-')).join(', ')} (powerpoint tell)`; }
    else if (cv < MOTION.CHAOS_CV && mean >= MOTION.CHAOS_MEAN && hotFrac >= MOTION.CHAOS_HOTFRAC) { pattern = 'chaotic'; verdict = 'sustained high energy, no calm focus (too-busy tell)'; }
    else if (thirds.first / (thirds.last || 1e-6) >= MOTION.FRONT_RATIO && thirds.last < MOTION.ALIVE_FLOOR) { pattern = 'front-loaded'; verdict = 'enters then settles to a near-static hold'; }
    else if (mean >= MOTION.ALIVE_FLOOR) { pattern = 'sustained'; verdict = 'alive'; }
    else { pattern = 'calm-hold'; verdict = 'calm low-motion hold — vision to confirm intentional'; }

    const findings = [];
    for (const sp of frozenSpans) findings.push({ dim: 'motion', range: sp, severity: 'high',
      issue: `${b.type} freezes for ${sp[1] - sp[0]} frames (YAVG≈0) — reads as a static slide`,
      fix: 'add perpetual ambient() drift / stagger an exit lean so no frame is at rest (anim.ts no-resting-frame law)' });
    if (pattern === 'chaotic') findings.push({ dim: 'motion', range: [b.from, b.to], severity: 'med',
      issue: `${b.type} never rests (mean ${mean.toFixed(1)}, ${Math.round(hotFrac * 100)}% hot frames)`,
      fix: 'reduce zoom/scale rate, give the eye a focal hold; cap ambient amplitude' });
    if (pattern === 'calm-hold' || pattern === 'front-loaded') for (const sp of lowSpans) findings.push({ dim: 'motion', range: sp, severity: 'low', needsVisionArbitration: true,
      issue: `${b.type} low-motion hold ${sp[0]}-${sp[1]} (mean ${mean.toFixed(2)})`,
      fix: 'if vision confirms it reads frozen: add ambient drift or shorten the hold; if intentional, leave it' });

    return { ...baseObj, motion: {
      mean: r2(mean), max: r2(max), sd: r2(sd), cv: r2(cv), pattern,
      frozenSpans, lowMotionSpans: lowSpans, entrancePeak: r2(entrancePeak),
      thirds: { first: r2(thirds.first), mid: r2(thirds.mid), last: r2(thirds.last) }, verdict,
    }, findings };
  });

  const arc = sparkline(motion, 30, 1.1);
  const framesFrozen = scenes.reduce((n, s) => n + (s.motion.frozenSpans || []).reduce((m, sp) => m + (sp[1] - sp[0]), 0), 0);
  const histo = {}; for (const s of scenes) histo[s.motion.pattern] = (histo[s.motion.pattern] || 0) + 1;
  return {
    dim: 'motion', scenes, motionArc: arc,
    global: { meanAll: r2(avg(motion)), framesFrozen, frozenSceneCount: scenes.filter((s) => s.motion.pattern === 'frozen').length, patternHistogram: histo },
    diagnostics: { framesAnalyzed: motion.length, planTotal: totalDuration(plan),
      offsetNote: 'tblend yields N-1 diffs for N frames; scenes sliced [from,to-1]' },
  };
}

/* ════════════════════════════════════════════
   2) AUDIO  —  analyzeAudio(mp4Path, plan)
   ════════════════════════════════════════════ */
const AUDIO = {
  SILENCE_NOISE_FLOOR: -40, SILENCE_MIN_DURATION: 0.4,
  BED_LUFS_FLOOR: -50, BED_P20_FLOOR: -45,
  SFX_TRANSIENT_DELTA: 3.0, SFX_SEARCH_WINDOW: 15, SFX_ALIGN_TOLERANCE: 4,
  LOUDNESS_WINDOW: 0.5, LOUDNESS_DIP_DELTA: 6,
};
const LOUD_SFX = new Set(['pop', 'chime', 'success']);

// mirror Root.tsx SfxLayer exactly.
// CUT-ANCHORED ALIGNMENT: each SFX is emitted at a FIXED offset from its scene
// cut (whoosh cut-7, pop cut+6, chime cut+4, success cut+clickAt+4). `expectAt`
// is the intended emit position DERIVED FROM THE CUT (cut + emitOffset) — it is
// the alignment reference. `frame` is the same value but is only used as a search
// hint; the audio search hunts a WIDE window (SFX_SEARCH_WINDOW ≫ SFX_ALIGN_TOLERANCE)
// around expectAt for the real transient, so a transient that drifted from intent is
// still found (present:true) and can be flagged misaligned (|onset-expectAt|>tol)
// instead of degrading to a false 'inaudible'. emitOffset is stored so a moved cut
// re-derives expectAt and DIVERGES from a stale rendered onset.
function predictSfx(plan, fps) {
  const TF = TRANSITION_FRAMES; const sc = (plan && plan.scenes) || [];
  const predicted = []; const cuts = []; let start = 0;
  const push = (cut, emitOffset, sfx) => {
    const expectAt = Math.max(0, cut + emitOffset);
    predicted.push({ frame: expectAt, sfx, cut, emitOffset, expectAt });
  };
  for (let i = 0; i < sc.length; i++) {
    const s = sc[i]; const cut = Math.round(start);
    cuts.push({ type: s.type, cut });
    if (i > 0 && s.transition) push(cut, -7, 'whoosh');
    if (s.type === 'StatBurst') push(cut, 6, 'pop');
    if (s.type === 'CTACard') push(cut, 4, 'chime');
    if (s.type === 'UIDemo') {
      const q = String((s.props && s.props.query) || 'Active users');
      const typeStart = 22, cps = 13, selectAt = 70, clickAt = 104;
      for (let c = 0; c < q.length; c += 2) { if (q[c] === ' ') continue; push(cut, Math.round(typeStart + (c / cps) * fps), 'key'); }
      push(cut, selectAt, 'click');
      push(cut, clickAt, 'click');
      push(cut, clickAt + 4, 'success');
    }
    const next = sc[i + 1];
    start += (s.durationInFrames || 0) - ((next && next.transition) ? TF : 0);
  }
  return { predicted, cuts };
}

function windowVals(series, t0, t1) { return series.filter((s) => s.t >= t0 && s.t < t1).map((s) => s.db); }

export function analyzeAudio(mp4Path, plan) {
  if (!mp4Path || !existsSync(mp4Path)) return { skipped: 'mp4 not found: ' + mp4Path };
  const fps = (plan && plan.fps) || FPS;
  const total = totalDuration(plan);
  const totalSec = total / fps;

  // PASS 0 — stream probe
  let streams = [];
  try {
    const probe = ff(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index,codec_name,sample_rate,channels', '-of', 'json', mp4Path]);
    streams = (JSON.parse(probe).streams) || [];
  } catch (e) { return { skipped: 'ffprobe failed', detail: String((e && e.message) || e).slice(0, 160) }; }
  if (!streams.length) {
    return { dim: 'audio', hasAudio: false, scenes: [], findings: [{ dim: 'audio', range: [0, total], severity: 'high', issue: 'no audio track', fix: 'render with sfx!==false or attach plan.audio' }] };
  }

  // PASS 1 — loudness envelope (astats per-frame RMS)
  const r1env = ffSafe('ffmpeg', ['-hide_banner', '-i', mp4Path, '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-']);
  const series = []; // {t, db}
  {
    const lines = (r1env.out || '').split('\n'); let pendingT = null;
    for (const line of lines) {
      const mt = line.match(/pts_time:([\d.]+)/);
      if (mt) { pendingT = parseFloat(mt[1]); continue; }
      const mr = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-?inf)/);
      if (mr && pendingT != null) { const raw = mr[1]; series.push({ t: pendingT, db: raw === '-inf' || raw === 'inf' ? -90 : parseFloat(raw) }); pendingT = null; }
    }
  }
  const allDb = series.map((s) => s.db);
  const bedFloor = series.length ? percentile(allDb, 0.20) : -90;
  const medianRms = series.length ? percentile(allDb, 0.50) : -90;

  // loudness windows (0.5s, power-mean)
  const windows = [];
  if (series.length) {
    const W = AUDIO.LOUDNESS_WINDOW; const end = Math.max(totalSec, series[series.length - 1].t);
    for (let t = 0; t < end; t += W) {
      const vals = windowVals(series, t, t + W);
      if (!vals.length) continue;
      const rms = D(avg(vals.map(P)));
      windows.push({ frames: `${Math.round(t * fps)}-${Math.round((t + W) * fps)}`, from: Math.round(t * fps), to: Math.round((t + W) * fps), rms: r1(rms) });
    }
  }
  const loudnessArc = sparkline(windows.map((w) => 90 + (w.rms || -90)), 30, 90 / 8 || 1); // shift so -90..0 → 0..90

  // ebur128 integrated loudness (report only)
  let ebur = { I: null, LRA: null, peak: null };
  {
    const r = ffSafe('ffmpeg', ['-nostats', '-hide_banner', '-i', mp4Path, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
    const out = r.out || '';
    const mi = out.match(/I:\s*(-?[\d.]+)\s*LUFS/g); if (mi) { const last = mi[mi.length - 1].match(/(-?[\d.]+)/); ebur.I = last ? parseFloat(last[1]) : null; }
    const ml = out.match(/LRA:\s*(-?[\d.]+)\s*LU/g); if (ml) { const last = ml[ml.length - 1].match(/(-?[\d.]+)/); ebur.LRA = last ? parseFloat(last[1]) : null; }
    const mp = out.match(/Peak:\s*(-?[\d.]+)\s*dBFS/g); if (mp) { const last = mp[mp.length - 1].match(/(-?[\d.]+)/); ebur.peak = last ? parseFloat(last[1]) : null; }
  }

  // PASS 2 — dead air (silencedetect)
  const deadAir = [];
  {
    const r = ffSafe('ffmpeg', ['-hide_banner', '-i', mp4Path, '-af', `silencedetect=noise=${AUDIO.SILENCE_NOISE_FLOOR}dB:d=${AUDIO.SILENCE_MIN_DURATION}`, '-f', 'null', '-']);
    const out = r.out || ''; let openStart = null;
    for (const line of out.split('\n')) {
      const ms = line.match(/silence_start:\s*(-?[\d.]+)/);
      const me = line.match(/silence_end:\s*([\d.]+)/);
      if (ms) openStart = parseFloat(ms[1]);
      else if (me && openStart != null) { deadAir.push([Math.max(0, Math.round(openStart * fps)), Math.round(parseFloat(me[1]) * fps)]); openStart = null; }
    }
    if (openStart != null) deadAir.push([Math.max(0, Math.round(openStart * fps)), total]); // trailing open silence → EOF
  }

  // bed presence + dips
  const deadCoverFrames = deadAir.reduce((n, [a, b]) => n + (b - a), 0);
  const bedPresent = !((ebur.I != null && ebur.I <= AUDIO.BED_LUFS_FLOOR) || (deadCoverFrames >= 0.8 * total) || (bedFloor != null && bedFloor <= -85 && !series.length));
  const inDead = (w) => deadAir.some(([a, b]) => w.from < b && w.to > a);
  const dips = windows.filter((w) => w.rms != null && medianRms != null && w.rms <= medianRms - AUDIO.LOUDNESS_DIP_DELTA && !inDead(w))
    .map((w) => ({ range: [w.from, w.to], dropDb: r1(medianRms - w.rms) }));

  // PASS 3 — predict + verify SFX
  const sfxOn = !(plan && plan.sfx === false);
  const { predicted } = sfxOn ? predictSfx(plan, fps) : { predicted: [] };
  const events = [];
  for (const e of predicted) {
    const cls = LOUD_SFX.has(e.sfx) ? 'loud' : 'quiet';
    if (cls === 'quiet') { events.push({ frame: e.frame, sfx: e.sfx, cut: e.cut, class: 'quiet', present: 'unverifiable', alignedToCut: null }); continue; }
    // Hunt a WIDE window (±SFX_SEARCH_WINDOW, ≫ tolerance) centered on the
    // CUT-DERIVED intended position expectAt for the loudest transient. A noise
    // floor read just BEFORE the window (not before expectAt) keeps the baseline
    // independent of where the transient actually lands.
    const tExpect = e.expectAt / fps;
    const base = D(avg(windowVals(series, tExpect - AUDIO.SFX_SEARCH_WINDOW / fps - 0.22, tExpect - AUDIO.SFX_SEARCH_WINDOW / fps).map(P)));
    let best = { delta: -99, frame: e.expectAt };
    for (let off = -AUDIO.SFX_SEARCH_WINDOW; off <= AUDIO.SFX_SEARCH_WINDOW; off++) {
      const tc = (e.expectAt + off) / fps;
      const vals = windowVals(series, tc - 0.02, tc + 0.10);
      if (!vals.length) continue;
      const tr = D(avg(vals.map(P)));
      if (tr - base > best.delta) best = { delta: tr - base, frame: e.expectAt + off };
    }
    const present = best.delta >= AUDIO.SFX_TRANSIENT_DELTA;
    const offsetFrames = best.frame - e.expectAt;
    const alignedToCut = present && Math.abs(best.frame - e.expectAt) <= AUDIO.SFX_ALIGN_TOLERANCE;
    events.push({ frame: e.frame, sfx: e.sfx, cut: e.cut, class: 'loud', present, onsetFrame: best.frame, offsetFrames, deltaDb: r1(best.delta), alignedToCut });
  }

  // findings
  const findings = [];
  if (!bedPresent) findings.push({ dim: 'audio', range: [0, total], severity: 'high', issue: 'no music bed (audio reads silent)', fix: 'enable MusicBed (sfx!==false) or attach plan.audio.music.src' });
  for (const [s, eF] of deadAir) findings.push({ dim: 'audio', range: [s, eF], severity: (eF - s) >= fps ? 'high' : 'med', issue: `dead air ${(s / fps).toFixed(2)}-${(eF / fps).toFixed(2)}s`, fix: 'bed missing or ducked here; check AudioBed/MusicBed and SFX coverage' });
  for (const d of dips) findings.push({ dim: 'audio', range: d.range, severity: 'soft', issue: `audio dips ${d.dropDb}dB below median`, fix: 'thin mix — verify bed loops and an SFX lands in this span' });
  for (const ev of events) {
    if (ev.class !== 'loud') continue;
    if (!ev.present) findings.push({ dim: 'audio', range: [ev.frame, ev.frame + 15], severity: 'high', issue: `${ev.sfx} inaudible (Δ${ev.deltaDb}dB<3.0)`, fix: `SFX_VOL[${ev.sfx}] or public/sfx/${ev.sfx}.mp3 missing, or SfxLayer not emitting` });
    // Anchor the range to the INTENDED emit frame (inside this SFX's own scene)
    // so the finding attaches to a single scene; the actual onset is reported in
    // the message. (A range straddling the transition overlap would double-attach.)
    else if (!ev.alignedToCut) findings.push({ dim: 'audio', range: [ev.frame, ev.frame + 1], severity: 'med', issue: `${ev.sfx} onset @${ev.onsetFrame} is ${ev.offsetFrames > 0 ? 'late' : 'early'} ${Math.abs(ev.offsetFrames)}f vs intended emit @${ev.frame} (cut ${ev.cut}+${ev.frame - ev.cut})`, fix: 'verify scene start frame / TRANSITION_FRAMES overlap matches SfxLayer; SFX must land at cut + fixed offset' });
  }

  // per-scene slices
  const bounds = boundaries(plan);
  const scenes = bounds.map((b) => {
    const t0 = b.from / fps, t1 = b.to / fps;
    const vals = windowVals(series, t0, t1);
    const rms = vals.length ? r1(D(avg(vals.map(P)))) : null;
    const evs = events.filter((e) => e.frame >= b.from && e.frame < b.to);
    const dead = deadAir.filter(([a, bb]) => a < b.to && bb > b.from).map(([a, bb]) => [Math.max(a, b.from), Math.min(bb, b.to)]);
    const sFind = findings.filter((f) => f.range[0] < b.to && f.range[1] > b.from);
    return { type: b.type, sceneId: b.id, frames: `${b.from}-${b.to}`, from: b.from, to: b.to, audio: { rms, events: evs, deadAir: dead }, findings: sFind };
  });

  const loudEvents = events.filter((e) => e.class === 'loud');
  return {
    dim: 'audio', hasAudio: true,
    integratedLufs: ebur.I, loudnessRange: ebur.LRA, truePeakDbfs: ebur.peak,
    bed: { present: bedPresent, floorDb: r1(bedFloor), medianRmsDb: r1(medianRms) },
    loudnessWindows: windows, loudnessArc, deadAir, dips, events,
    sfxVerifiable: loudEvents.length, sfxPresent: loudEvents.filter((e) => e.present).length,
    sfxMissing: loudEvents.filter((e) => !e.present).length, sfxMisaligned: loudEvents.filter((e) => e.present && !e.alignedToCut).length,
    scenes, findings,
    diagnostics: { framesOfAudio: series.length, totalSec: r2(totalSec) },
  };
}

/* ════════════════════════════════════════════
   3) STRUCTURE  —  analyzeStructure(plan)  (PURE, plan-only)
   ════════════════════════════════════════════ */
const TRANSITION_VOCAB = new Set(['fade', 'slide-left', 'wipe-up']);
// MIRRORED from remotion-studio/src/scenes/UIDemo.tsx (lines 14-46) — keep in sync.
const UIDEMO = {
  typeStart: 22, cps: 13, selectAt: 70, clickAt: 104,
  CARD: { x0: 27, y0: 23, x1: 73, y1: 77 }, // left27 top23 w46 h54
  targets: (sel) => ({ search: { x: 33, y: 34 }, opt: { x: 34 + 6, y: 42 + sel * 7 }, btn: { x: 50, y: 71 } }),
};
const TYPE_MARGIN = 6, CLICK_MARGIN = 8, ADJ_RATIO_MAX = 3.5, CV_MIN = 0.08;

export function analyzeStructure(plan, _mp4Ignored) {
  const fps = (plan && plan.fps) || FPS;
  const bounds = boundaries(plan);
  const coh = videoCoherence(plan);
  const cohChecks = new Set(coh.findings.map((f) => f.check));
  const scenes = []; const findings = [];
  const add = (sObj, sev, issue, fix, range) => { const f = { dim: 'structure', range, severity: sev, issue, fix }; sObj.findings.push(f); findings.push(f); };

  for (const b of bounds) {
    const tpl = SCENES[b.type]; const range = [b.from, b.to];
    const sObj = {
      type: b.type, sceneId: b.id, frames: `${b.from}-${b.to}`, from: b.from, to: b.to,
      structure: {
        durationFrames: b.scene.durationInFrames,
        durationSeconds: +(b.scene.durationInFrames / fps).toFixed(2),
        blessed: true, role: tpl ? tpl.role : '?', transition: b.scene.transition || null, verdict: 'ok',
      }, findings: [],
    };

    // (1) blessed duration — DEDUPE vs videoCoherence
    if (tpl) {
      const [lo, hi] = tpl.range;
      if (b.scene.durationInFrames < lo || b.scene.durationInFrames > hi) {
        sObj.structure.blessed = false;
        if (!cohChecks.has('unblessed-duration')) add(sObj, 'soft', `${b.type} @ ${b.scene.durationInFrames}f outside blessed ${lo}-${hi}f`, `set durationInFrames into ${lo}-${hi}`, range);
        sObj.structure.verdict = 'unblessed';
      }
    } else add(sObj, 'high', `${b.type} is not a registered scene template`, 'use a SCENES type', range);

    // (3) transition coverage (incoming)
    const tr = b.scene.transition;
    if (b.i === 0 && tr) add(sObj, 'med', 'first scene has an incoming transition', 'set transition:null on scene 0', range);
    if (b.i > 0) {
      if (!tr) add(sObj, 'soft', `cut into ${b.type} has no declared transition`, 'add a blessed transition (fade/slide-left/wipe-up)', range);
      else if (!TRANSITION_VOCAB.has(tr)) add(sObj, 'med', `transition '${tr}' unknown → silently falls back to fade`, 'use fade|slide-left|wipe-up', range);
      const prev = bounds[b.i - 1].scene;
      if (tr && TRANSITION_FRAMES >= Math.min(prev.durationInFrames, b.scene.durationInFrames)) add(sObj, 'high', 'transition (14f) ≥ scene length — the scene is erased', 'lengthen the scene or drop the transition', range);
    }

    // (4) interaction-completeness — UIDemo (and ScreenshotShowcase WITH cursorPath)
    if (b.type === 'UIDemo') {
      const p = b.scene.props || {}; const q = String(p.query || 'Active users');
      const sel = Number.isInteger(p.selectIndex) ? p.selectIndex : 1;
      const opts = Array.isArray(p.options) ? p.options : [];
      const typeEnd = UIDEMO.typeStart + (q.length / UIDEMO.cps) * fps;
      const dur = b.scene.durationInFrames;
      const inter = { typeEndLocal: +typeEnd.toFixed(1), selectAt: UIDEMO.selectAt, clickAt: UIDEMO.clickAt, sceneEndLocal: dur, typingFinishesBeforeSelect: false, clickBeforeEnd: false, cursorOnTarget: true, ok: false };
      if (typeEnd > UIDEMO.selectAt - TYPE_MARGIN) add(sObj, 'high', `typing ends @${typeEnd.toFixed(0)}f but option selects @${UIDEMO.selectAt}f (needs ${TYPE_MARGIN}f gap)`, `shorten query (≤${Math.floor((UIDEMO.selectAt - TYPE_MARGIN - UIDEMO.typeStart) / fps * UIDEMO.cps)} chars) or raise selectAt`, range);
      else inter.typingFinishesBeforeSelect = true;
      if (!(UIDEMO.selectAt < UIDEMO.clickAt)) add(sObj, 'high', 'select fires at/after click — order inverted', 'selectAt < clickAt', range);
      if (UIDEMO.clickAt + 4 >= dur - CLICK_MARGIN) add(sObj, 'high', `click@${UIDEMO.clickAt}f + success cut off before scene end ${dur}f`, `lengthen UIDemo to ≥${UIDEMO.clickAt + 4 + CLICK_MARGIN}f`, range);
      else inter.clickBeforeEnd = true;
      if (sel < 0 || sel >= Math.max(opts.length, 1)) add(sObj, 'med', `selectIndex ${sel} out of options range`, 'set a valid selectIndex', range);
      const T = UIDEMO.targets(sel); const C = UIDEMO.CARD;
      for (const [name, pt] of Object.entries(T)) {
        if (pt.x < C.x0 || pt.x > C.x1 || pt.y < C.y0 || pt.y > C.y1) { inter.cursorOnTarget = false; add(sObj, 'med', `cursor ${name} target (${pt.x},${pt.y}) outside card rect — clicks empty space`, 'restore UIDemo layout constants', range); }
      }
      inter.ok = inter.typingFinishesBeforeSelect && inter.clickBeforeEnd && inter.cursorOnTarget;
      sObj.structure.interaction = inter;
      if (!inter.ok) sObj.structure.verdict = 'broken-interaction';
    }

    // (5) duplicate adjacent identical scene
    if (b.i > 0) {
      const prev = bounds[b.i - 1].scene;
      if (prev.type === b.scene.type && JSON.stringify(prev.props) === JSON.stringify(b.scene.props)) add(sObj, 'soft', `${b.type} is identical to the previous scene (duplicate)`, 'vary the copy or merge the scenes', range);
    }

    scenes.push(sObj);
  }

  // (2) pacing rhythm — body scenes only
  const bodyDurs = bounds.filter((b) => SCENES[b.type] && SCENES[b.type].role === 'body').map((b) => b.scene.durationInFrames);
  const mean = bodyDurs.length ? avg(bodyDurs) : 0;
  const sd = std(bodyDurs, mean);
  const cv = mean ? sd / mean : 0;
  let maxRatio = 1; for (let i = 1; i < bodyDurs.length; i++) { const r = Math.max(bodyDurs[i], bodyDurs[i - 1]) / Math.min(bodyDurs[i], bodyDurs[i - 1]); maxRatio = Math.max(maxRatio, r); }
  const monotone = bodyDurs.length >= 3 && cv < CV_MIN;
  const jarring = maxRatio > ADJ_RATIO_MAX;
  const wholeRange = bounds.length ? [bounds[0].from, bounds[bounds.length - 1].to] : [0, totalDuration(plan)];
  if (monotone) add(scenes.find((s) => SCENES[s.type] && SCENES[s.type].role === 'body') || scenes[0] || { findings: [] }, 'soft', `every body scene is ~${Math.round(mean)}f — no tempo variation (deck tell)`, 'vary scene durations for rhythm', wholeRange);
  if (jarring) add(scenes[0] || { findings: [] }, 'soft', `adjacent body scenes jump ${maxRatio.toFixed(1)}× in length`, 'soften the tempo break', wholeRange);

  const runtimeSeconds = +(totalDuration(plan) / fps).toFixed(2);
  const runBand = runtimeSeconds < 8 ? 'short' : runtimeSeconds > 90 ? 'long' : 'ok';
  if (runBand !== 'ok' && !cohChecks.has(runBand === 'short' ? 'runtime-short' : 'runtime-long')) add(scenes[0] || { findings: [] }, 'soft', `runtime ${runtimeSeconds}s is ${runBand}`, runBand === 'short' ? 'add a scene or lengthen' : 'trim scenes', [0, totalDuration(plan)]);

  const sc = (plan && plan.scenes) || [];
  const declared = sc.filter((s, i) => i > 0 && s.transition).length;
  const expected = Math.max(0, sc.length - 1);
  const allBlessed = sc.every((s, i) => i === 0 || !s.transition || TRANSITION_VOCAB.has(s.transition));
  const firstClean = !sc[0] || !sc[0].transition;

  const penalty = findings.reduce((p, f) => p + (f.severity === 'high' ? 22 : f.severity === 'med' ? 10 : 6), 0);
  const structureScore = Math.max(0, 100 - penalty);
  const order = ['high', 'med', 'soft']; const top = [...findings].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))[0];

  return {
    dim: 'structure', scenes,
    global: {
      pacing: { runtimeSeconds, band: runBand, bodyDurationCV: +cv.toFixed(3), monotone, maxAdjBodyRatio: +maxRatio.toFixed(2), verdict: jarring ? 'jarring' : monotone ? 'monotone' : 'varied' },
      transitionCoverage: { declared, expected, ratio: expected ? +(declared / expected).toFixed(2) : 1, allBlessed, firstSceneClean: firstClean },
      structureScore, topFix: top ? top.fix : null,
      durationArc: sc.map((s) => s.durationInFrames).join('·'),
    },
    findings,
  };
}
