/* High-quality SFX/music synthesizer for the video pipeline.
   Synthesizes tasteful sounds sample-by-sample in JS (full envelope/harmonic/filter
   control — far cleaner than raw ffmpeg beeps), writes 16-bit stereo WAV, then
   ffmpeg → mp3 into public/sfx/. Run: node tools/generate-sfx.mjs */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SR = 44100;
const OUT = path.resolve(process.cwd(), 'public/sfx');
mkdirSync(OUT, { recursive: true });

// ---- DSP helpers ------------------------------------------------------------
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const TAU = Math.PI * 2;
// seeded white noise (deterministic)
let _s = 1234567;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return (_s / 0x3fffffff) - 1; };
const brown = (n) => { const o = new Float32Array(n); let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * rnd()) * 0.996; o[i] = last * 12; } return o; };
function lowpass(x, fc) { const o = new Float32Array(x.length); const dt = 1 / SR; let y = 0; for (let i = 0; i < x.length; i++) { const f = typeof fc === 'function' ? fc(i / SR) : fc; const rc = 1 / (TAU * f); const a = dt / (rc + dt); y += a * (x[i] - y); o[i] = y; } return o; }
function highpass(x, fc) { const o = new Float32Array(x.length); const dt = 1 / SR; const rc = 1 / (TAU * fc); const a = rc / (rc + dt); let py = 0, px = 0; for (let i = 0; i < x.length; i++) { const y = a * (py + x[i] - px); o[i] = y; py = y; px = x[i]; } return o; }
const expEnv = (t, d) => Math.exp(-d * t);
// pluck/bell partials with slight inharmonicity
function bell(dur, f0, partials, decay) { const o = buf(dur); for (let i = 0; i < o.length; i++) { const t = i / SR; let v = 0; for (const [mult, amp, inh] of partials) v += amp * Math.sin(TAU * f0 * mult * (1 + (inh || 0)) * t); o[i] = v * expEnv(t, decay); } return o; }
function add(dst, src, at = 0, gain = 1) { const off = Math.floor(at * SR); for (let i = 0; i < src.length; i++) { const j = i + off; if (j < dst.length) dst[j] += src[i] * gain; } return dst; }
function norm(x, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m < 1e-6) return x; const g = peak / m; for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
function softclip(x) { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * 1.1); return x; }
// stereo widen: tiny haas delay on R
function stereo(mono, haasMs = 6, width = 0.35) { const d = Math.floor((haasMs / 1000) * SR); const L = mono, R = new Float32Array(mono.length); for (let i = 0; i < mono.length; i++) R[i] = mono[i - d >= 0 ? i - d : i] * (1 - width) + mono[i] * width; return [L, R]; }

function writeWav(name, L, R) {
  const n = L.length, bytes = n * 4, hdr = 44;
  const b = Buffer.alloc(hdr + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  let o = hdr;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])) * 32767, r = Math.max(-1, Math.min(1, R[i])) * 32767;
    b.writeInt16LE(l | 0, o); b.writeInt16LE(r | 0, o + 2); o += 4;
  }
  const wav = path.join(OUT, name + '.wav');
  writeFileSync(wav, b);
  const mp3 = path.join(OUT, name + '.mp3');
  execFileSync('ffmpeg', ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', '-ar', '44100', mp3], { stdio: 'ignore' });
  execFileSync('rm', ['-f', wav]);
  console.log('  ✓', name + '.mp3', '(' + (L.length / SR).toFixed(2) + 's)');
}

// ---- the sounds -------------------------------------------------------------
console.log('synthesizing sfx →', OUT);

// WHOOSH — filtered brown-noise swish with a downward filter sweep + soft Hann env
(() => {
  const dur = 0.42, n = Math.ceil(dur * SR);
  let x = brown(n);
  x = highpass(x, 320);
  x = lowpass(x, (t) => 3200 - (t / dur) * 2400); // sweep 3200→800Hz = "whoosh"
  for (let i = 0; i < n; i++) { const p = i / n; const env = Math.sin(Math.PI * Math.min(1, p * 1.05)) ** 1.4; x[i] *= env; }
  norm(x, 0.5);
  const [L, R] = stereo(x, 7, 0.5);
  writeWav('whoosh', L, R);
})();

// POP — low body + high transient, fast decay (StatBurst punch)
(() => {
  const dur = 0.17, o = buf(dur);
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = 0.7 * Math.sin(TAU * 190 * t) * expEnv(t, 26) + 0.28 * Math.sin(TAU * 1500 * t) * expEnv(t, 85); }
  softclip(norm(o, 0.85));
  const [L, R] = stereo(o, 3, 0.2); writeWav('pop', L, R);
})();

// CLICK — crisp UI tock (cursor click on a button)
(() => {
  const dur = 0.07, o = buf(dur);
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = 0.5 * Math.sin(TAU * 1700 * t) * expEnv(t, 130) + 0.3 * Math.sin(TAU * 920 * t) * expEnv(t, 95) + 0.12 * rnd() * expEnv(t, 220); }
  norm(o, 0.7); const [L, R] = stereo(o, 2, 0.15); writeWav('click', L, R);
})();

// KEY — soft short keystroke (typewriter), low + high tick
(() => {
  const dur = 0.05, o = buf(dur);
  for (let i = 0; i < o.length; i++) { const t = i / SR; o[i] = 0.32 * Math.sin(TAU * 2100 * t) * expEnv(t, 170) + 0.18 * rnd() * expEnv(t, 260); }
  norm(o, 0.4); const [L, R] = stereo(o, 2, 0.1); writeWav('key', L, R);
})();

// CHIME — warm bell on a perfect fifth (CTA landing)
(() => {
  const dur = 0.9, o = buf(dur);
  add(o, bell(dur, 784, [[1, 0.6, 0], [2, 0.22, 0.002], [3, 0.1, 0.004], [4.2, 0.05, 0.006]], 3.6), 0, 1);     // G5
  add(o, bell(dur, 1175, [[1, 0.45, 0], [2, 0.16, 0.002], [3, 0.07, 0.004]], 4.0), 0.02, 1);                   // D6 (fifth)
  add(o, bell(dur, 1568, [[1, 0.2, 0], [2, 0.07, 0.003]], 5.0), 0.04, 0.7);                                    // G6 shimmer
  softclip(norm(o, 0.7)); const [L, R] = stereo(o, 9, 0.4); writeWav('chime', L, R);
})();

// SUCCESS — bright ascending 3-note arpeggio (UIDemo "Created ✓")
(() => {
  const dur = 0.78, o = buf(dur);
  const notes = [[1046.5, 0], [1318.5, 0.085], [1568, 0.17]]; // C6 E6 G6
  for (const [f, at] of notes) add(o, bell(0.6, f, [[1, 0.5, 0], [2, 0.18, 0.002], [3, 0.08, 0.004]], 4.2), at, 1);
  add(o, bell(0.6, 2093, [[1, 0.14, 0]], 6), 0.17, 0.6); // top octave sparkle
  softclip(norm(o, 0.72)); const [L, R] = stereo(o, 8, 0.4); writeWav('success', L, R);
})();

// MUSIC — soft ambient pad (Amin9), low + filtered, seamlessly loopable (16s)
(() => {
  const dur = 16, n = Math.ceil(dur * SR), o = new Float32Array(n);
  const chord = [110, 164.81, 220, 261.63, 329.63, 493.88]; // A2 E3 A3 C4 E4 B4
  for (let i = 0; i < n; i++) {
    const t = i / SR; let v = 0;
    for (let k = 0; k < chord.length; k++) {
      const f = chord[k] * (1 + (k % 2 ? 0.0008 : -0.0008)); // gentle detune
      const amp = 0.5 / (1 + k * 0.5);
      v += amp * (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * f * 2 * t));
    }
    // LFOs at integer cycles / 16s → seamless loop; slow swell
    const trem = 0.82 + 0.18 * Math.sin(TAU * (2 / dur) * t);
    const swell = 0.7 + 0.3 * Math.sin(TAU * (1 / dur) * t - Math.PI / 2);
    o[i] = v * trem * swell;
  }
  let x = lowpass(o, (t) => 1100 + 300 * Math.sin(TAU * (1 / dur) * t)); // breathing filter
  x = highpass(x, 70);
  norm(x, 0.32); softclip(x);
  const [L, R] = stereo(x, 12, 0.45); writeWav('music', L, R);
})();

console.log('done.');
