/* SFX/music synthesizer — refined, TACTILE sound design (not tonal/melodic).
   Owner feedback: the v1 tones sounded "goofy". Real product-video sound is
   filtered-noise transients + muted thumps + a dark atmospheric bed, with
   restraint — NOT bells, arpeggios, or major chords. Sample-by-sample synthesis
   → 16-bit stereo WAV → ffmpeg mp3 into public/sfx/. Run: node tools/generate-sfx.mjs */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SR = 44100, TAU = Math.PI * 2;
// Writes the procedural fallback set to synth-pack/ (catalogued in the sound library).
// NOT public/sfx/ — that now holds the real owner-supplied pack; regenerating here
// must never clobber it. To use a synth sound in a video, copy it into public/sfx/.
const OUT = path.resolve(process.cwd(), 'synth-pack');
mkdirSync(OUT, { recursive: true });

const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
let _s = 99173;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return (_s / 0x3fffffff) - 1; };
function white(n) { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = rnd(); return o; }
function brown(n) { const o = new Float32Array(n); let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * rnd()) * 0.996; o[i] = last * 12; } return o; }
function lowpass(x, fc) { const o = new Float32Array(x.length); const dt = 1 / SR; let y = 0; for (let i = 0; i < x.length; i++) { const f = typeof fc === 'function' ? fc(i / SR) : fc; const rc = 1 / (TAU * f); const a = dt / (rc + dt); y += a * (x[i] - y); o[i] = y; } return o; }
function highpass(x, fc) { const o = new Float32Array(x.length); const dt = 1 / SR; const rc = 1 / (TAU * fc); const a = rc / (rc + dt); let py = 0, px = 0; for (let i = 0; i < x.length; i++) { const y = a * (py + x[i] - px); o[i] = y; py = y; px = x[i]; } return o; }
// resonant band-pass (biquad) — gives clicks a tactile "voiced" timbre, not a beep
function biquadBP(x, f0, Q) {
  const w0 = TAU * f0 / SR, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * Q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const o = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xn = x[i]; const yn = (b0 / a0) * xn + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2; o[i] = yn; x2 = x1; x1 = xn; y2 = y1; y1 = yn; }
  return o;
}
const expEnv = (t, d) => Math.exp(-d * t);
function add(dst, src, at = 0, g = 1) { const off = Math.floor(at * SR); for (let i = 0; i < src.length; i++) { const j = i + off; if (j >= 0 && j < dst.length) dst[j] += src[i] * g; } return dst; }
function norm(x, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m < 1e-6) return x; const g = peak / m; for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function softclip(x) { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 1.05); return x; }
function stereo(mono, haasMs = 5, width = 0.3) { const d = Math.floor((haasMs / 1000) * SR); const R = new Float32Array(mono.length); for (let i = 0; i < mono.length; i++) R[i] = mono[i - d >= 0 ? i - d : i] * (1 - width) + mono[i] * width; return [mono, R]; }

function writeWav(name, L, R) {
  const n = L.length, bytes = n * 4, hdr = 44, b = Buffer.alloc(hdr + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  let o = hdr; for (let i = 0; i < n; i++) { b.writeInt16LE((Math.max(-1, Math.min(1, L[i])) * 32767) | 0, o); b.writeInt16LE((Math.max(-1, Math.min(1, R[i])) * 32767) | 0, o + 2); o += 4; }
  const wav = path.join(OUT, name + '.wav'); writeFileSync(wav, b);
  execFileSync('ffmpeg', ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', '-ar', '44100', path.join(OUT, name + '.mp3')], { stdio: 'ignore' });
  execFileSync('rm', ['-f', wav]);
  console.log('  ✓', name + '.mp3', '(' + (L.length / SR).toFixed(2) + 's)');
}

const hann = (n, p) => Math.sin(Math.PI * Math.min(1, p)) ** 1.2; // smooth in/out by progress
console.log('synthesizing refined sfx →', OUT);

// CLICK — tactile UI tick: a short resonant-filtered noise transient + tiny sub body.
(() => {
  const dur = 0.055, n = Math.ceil(dur * SR);
  let nb = white(n); for (let i = 0; i < n; i++) nb[i] *= expEnv(i / SR, 150);
  let click = biquadBP(nb, 1850, 1.6);
  const o = buf(dur);
  for (let i = 0; i < n; i++) { const t = i / SR; o[i] = 0.9 * click[i] + 0.22 * Math.sin(TAU * 150 * t) * expEnv(t, 120); }
  norm(o, 0.55); const [L, R] = stereo(o, 2, 0.12); writeWav('click', L, R);
})();

// KEY — softer, shorter keystroke (mechanical-ish), quiet.
(() => {
  const dur = 0.04, n = Math.ceil(dur * SR);
  let nb = white(n); for (let i = 0; i < n; i++) nb[i] *= expEnv(i / SR, 240);
  let k = biquadBP(nb, 2600, 1.2);
  const o = buf(dur);
  for (let i = 0; i < n; i++) { const t = i / SR; o[i] = 0.8 * k[i] + 0.12 * Math.sin(TAU * 220 * t) * expEnv(t, 200); }
  norm(o, 0.3); const [L, R] = stereo(o, 1.5, 0.1); writeWav('key', L, R);
})();

// WHOOSH — airy filtered brown-noise swish, soft (transition).
(() => {
  const dur = 0.4, n = Math.ceil(dur * SR);
  let x = brown(n); x = highpass(x, 360); x = lowpass(x, (t) => 2600 - (t / dur) * 2000);
  for (let i = 0; i < n; i++) x[i] *= hann(n, i / n);
  norm(x, 0.34); const [L, R] = stereo(x, 7, 0.5); writeWav('whoosh', L, R);
})();

// POP — muted percussive thump (StatBurst): low filtered-noise body + soft click, NOT tonal.
(() => {
  const dur = 0.16, n = Math.ceil(dur * SR);
  let body = white(n); for (let i = 0; i < n; i++) body[i] *= expEnv(i / SR, 34); body = lowpass(body, 240); body = highpass(body, 60);
  let tk = biquadBP(white(n), 1400, 1.4); for (let i = 0; i < n; i++) tk[i] *= expEnv(i / SR, 130);
  const o = buf(dur);
  for (let i = 0; i < n; i++) { const t = i / SR; o[i] = 1.1 * body[i] + 0.25 * tk[i] + 0.3 * Math.sin(TAU * 92 * t) * expEnv(t, 30); }
  softclip(norm(o, 0.62)); const [L, R] = stereo(o, 3, 0.18); writeWav('pop', L, R);
})();

// CHIME → CONFIRM — one soft, warm, low-passed tone with a gentle attack (CTA). Subtle, not a bell.
(() => {
  const dur = 0.5, n = Math.ceil(dur * SR);
  const o = buf(dur);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const atk = Math.min(1, t / 0.02);                      // soft 20ms attack (no click)
    const env = atk * expEnv(t, 6);
    o[i] = (0.6 * Math.sin(TAU * 528 * t) + 0.2 * Math.sin(TAU * 792 * t) + 0.08 * Math.sin(TAU * 1056 * t)) * env;
  }
  let x = lowpass(o, 1600); norm(x, 0.5); const [L, R] = stereo(x, 8, 0.35); writeWav('chime', L, R);
})();

// SUCCESS — understated warm two-note rise (UIDemo "Created ✓"): soft attack, low-passed, NO sparkle.
(() => {
  const dur = 0.6, n = Math.ceil(dur * SR);
  const o = buf(dur);
  const voice = (f, at) => { for (let i = 0; i < n; i++) { const t = i / SR - at; if (t < 0) continue; const atk = Math.min(1, t / 0.018); o[i] += (0.55 * Math.sin(TAU * f * t) + 0.16 * Math.sin(TAU * f * 1.5 * t)) * atk * expEnv(t, 5.5); } };
  voice(528, 0);        // C5
  voice(704, 0.11);     // F5 (warm perfect fourth)
  let x = lowpass(o, 1700); softclip(norm(x, 0.5)); const [L, R] = stereo(x, 8, 0.36); writeWav('success', L, R);
})();

// MUSIC — dark atmospheric bed: low drone + fifth + filtered noise wash, slow swell.
// No chord progression / no major-key brightness. Seamlessly loopable (16s). Very subtle.
(() => {
  const dur = 16, n = Math.ceil(dur * SR), o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const drone = 0.5 * Math.sin(TAU * 55 * t) + 0.34 * Math.sin(TAU * 82.4 * t) + 0.12 * Math.sin(TAU * 110 * t); // A1 + E2 + A2
    const shimmer = 0.05 * Math.sin(TAU * 220 * t) * (0.5 + 0.5 * Math.sin(TAU * (3 / dur) * t)); // faint, breathing
    o[i] = drone + shimmer;
  }
  // filtered noise wash (air), lowpassed heavily + slow swell
  let wash = lowpass(white(n), 900); wash = highpass(wash, 120);
  for (let i = 0; i < n; i++) { const t = i / SR; const sw = 0.5 + 0.5 * Math.sin(TAU * (1 / dur) * t - Math.PI / 2); o[i] += wash[i] * 0.18 * sw; }
  let x = lowpass(o, (t) => 700 + 180 * Math.sin(TAU * (1 / dur) * t)); // dark, breathing filter
  x = highpass(x, 40);
  // overall slow swell envelope (integer cycles → loop-safe)
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= 0.82 + 0.18 * Math.sin(TAU * (2 / dur) * t); }
  norm(x, 0.3); softclip(x);
  const [L, R] = stereo(x, 14, 0.5); writeWav('music', L, R);
})();

console.log('done.');
