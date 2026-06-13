/* ============================================
   designbook · lib/imagegen.js — local photo generation (mflux / Apple MLX)
   ============================================
   Real photographs are what separate "custom-made" from "AI-generated" — the
   owner's law: too many gradients + no images reads as AI; quality imagery +
   motion reads as designed. This module runs Z-Image-turbo locally via mflux
   (fast photorealism on Apple Silicon, free, private). First call downloads
   the model (~3.5GB one-time). See frontendmaxxing/local-image-gen.skill.md.
   ============================================ */
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execFileP = promisify(execFile);

export function findMflux() {
  const candidates = [
    process.env.MFLUX_PATH,
    join(homedir(), '.local', 'bin', 'mflux-generate-z-image-turbo'),
    '/opt/homebrew/bin/mflux-generate-z-image-turbo',
    '/usr/local/bin/mflux-generate-z-image-turbo',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// mflux wants multiple-of-16 dimensions; clamp to sane web sizes
function snap(n, min, max) { return Math.max(min, Math.min(max, Math.round(n / 16) * 16)); }

/**
 * generateImage({ prompt, width?, height?, seed?, steps? })
 *   → { png: Buffer, width, height, seed, ms } | { error }
 * Long-running: ~30-60s warm on M-series; minutes on first run (model download).
 */
export async function generateImage({ prompt, width = 1280, height = 832, seed, steps = 9 }) {
  const bin = findMflux();
  if (!bin) {
    return { error: 'mflux not found. Install: uv tool install --upgrade mflux — see frontendmaxxing/local-image-gen.skill.md' };
  }
  if (!prompt || !String(prompt).trim()) return { error: 'prompt required' };

  const w = snap(width, 512, 1600);
  const h = snap(height, 512, 1600);
  const s = Number.isFinite(+seed) ? Math.abs(Math.floor(+seed)) : Math.floor(Math.random() * 1e6);
  const outDir = join(tmpdir(), 'dbimg');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, createHash('sha1').update(prompt + w + h + s).digest('hex').slice(0, 12) + '.png');

  const t0 = Date.now();
  try {
    // lowest CPU priority + capped MLX cache: image gen must never starve the
    // owner's foreground work (evals, builds) — slower is fine, hogging is not
    await execFileP('/usr/bin/nice', ['-n', '19', bin,
      '--prompt', String(prompt),
      '--width', String(w), '--height', String(h),
      '--seed', String(s), '--steps', String(Math.max(4, Math.min(16, steps))),
      '-q', '8', '--low-ram', '--mlx-cache-limit-gb', '4',
      '--output', out,
    ], { timeout: 15 * 60 * 1000 }); // generous: first run downloads the model
    if (!existsSync(out)) return { error: 'mflux finished but produced no file' };
    const png = readFileSync(out);
    rmSync(out, { force: true });
    return { png, width: w, height: h, seed: s, ms: Date.now() - t0 };
  } catch (e) {
    return { error: 'generation failed: ' + String((e && e.message) || e).slice(0, 400) };
  }
}
