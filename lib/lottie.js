/* ============================================
   designbook · lib/lottie.js — validate + preview Lottie via the vault tool
   ============================================
   Thin bridge to frontendmaxxing/tools/lottie-check.mjs (which renders Lottie
   headless and returns a hard verdict + preview). Catches LLM-authored Lottie
   that parses but renders nothing. Same JSON it greenlights plays in lottie-web
   AND Flutter's `lottie`. Degrades to {skipped} when the tool/playwright-core is
   absent — never throws (optional-capability rule, like lib/pptx.js).
   ============================================ */
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveVaultRoot } from './vault.js';

// Validate Lottie. Pass { paths:[...] } (existing .json files) and/or
// { json, name } (inline). Returns { ok, preview, results:[{name,verdict,…}] }
// | { ok:false, skipped, reason } | { ok:false, error }.
export function checkLottie({ paths = [], json, name = 'anim' } = {}) {
  const root = resolveVaultRoot();
  const tool = join(root, 'tools', 'lottie-check.mjs');
  if (!existsSync(tool)) return { ok: false, skipped: true, reason: 'tools/lottie-check.mjs not found in the vault' };

  const files = Array.isArray(paths) ? paths.filter(Boolean).slice(0, 24) : [];
  if (json) {
    const dir = mkdtempSync(join(tmpdir(), 'lottie-'));
    const p = join(dir, String(name).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) + '.json');
    writeFileSync(p, typeof json === 'string' ? json : JSON.stringify(json));
    files.push(p);
  }
  if (!files.length) return { ok: false, error: 'paths[] or json required' };

  const preview = join(tmpdir(), `lottie-check-${process.pid}-${files.length}.png`);
  let out;
  try {
    out = execFileSync(process.execPath, [tool, ...files, '--json', '--out', preview], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    // lottie-check exits 1 when any file isn't OK — the --json report is still on stdout
    out = (e && e.stdout) || '';
  }
  try { return { ok: true, ...JSON.parse(out) }; }
  catch { return { ok: false, error: 'lottie-check produced no parseable output (is playwright-core installed in tools/?)' }; }
}
