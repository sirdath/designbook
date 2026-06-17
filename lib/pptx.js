/* ============================================
   designbook · lib/pptx.js — deck HTML -> editable .pptx bridge
   ============================================
   Parses a composed DECK genre page (.s-slide sections) into an IR, then invokes
   the in-house python-pptx writer (lib/pptx_writer.py) in the .pptx-venv. python
   is an OPTIONAL sidecar — when the venv is absent this returns {ok:false,
   skipped:true} with an install hint, NEVER throws (mirrors the optional-dep,
   degrade-to-skip rule so the gate/export never hard-fails on a missing binary).
   ============================================ */
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolveVaultRoot } from './vault.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_ROOT = join(__dirname, '..');

export function findPy() {
  const p = join(DB_ROOT, '.pptx-venv', 'bin', 'python');
  return existsSync(p) ? p : null;
}

const strip = (s) => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&rarr;/g, '→')
  .trim();

// rgba()/rgb() composited over the bg hex -> solid #rrggbb (pptx wants solids)
function toHex(token, bg) {
  const t = String(token || '').trim();
  if (t.startsWith('#')) return t;
  const m = t.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/i);
  if (!m) return null;
  let [r, g, b] = [+m[1], +m[2], +m[3]];
  const a = m[4] != null ? +m[4] : 1;
  if (a < 1 && bg) {
    const bh = bg.replace('#', '');
    const br = parseInt(bh.slice(0, 2), 16), bgc = parseInt(bh.slice(2, 4), 16), bb = parseInt(bh.slice(4, 6), 16);
    r = Math.round(a * r + (1 - a) * br); g = Math.round(a * g + (1 - a) * bgc); b = Math.round(a * b + (1 - a) * bb);
  }
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function paletteTokens(palName) {
  try {
    const css = readFileSync(join(resolveVaultRoot(), 'colors', 'palettes.css'), 'utf8');
    const block = (css.match(new RegExp('\\.pal-' + palName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
    const v = (name) => (block.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);')) || [])[1];
    const bg = (v('bg') || '#0a0a12').trim();
    return {
      bg,
      fg: toHex(v('fg') || '#f2f3f7', bg),
      accent: toHex(v('accent') || '#7c5cff', bg),
      muted: toHex(v('muted') || '#9aa0ac', bg),
      surface: toHex(v('surface') || '#16161f', bg),
      onAccent: toHex(v('on-accent') || '#0a0a12', bg),
    };
  } catch { return { bg: '#0a0a12', fg: '#f2f3f7', accent: '#7c5cff', muted: '#9aa0ac', surface: '#16161f', onAccent: '#0a0a12' }; }
}

export function parseDeck(html) {
  const s = String(html || '');
  const palName = (s.match(/<body[^>]*class="[^"]*\bpal-([\w-]+)/) || [])[1] || 'midnight';
  const theme = paletteTokens(palName);

  // collect each <section class="s-slide…">…</section> with its index
  const secRe = /<section class="s-slide([^"]*)"[^>]*>([\s\S]*?)<\/section>/g;
  const secs = []; let m;
  while ((m = secRe.exec(s))) secs.push({ mod: m[1], inner: m[2], end: m.index + m[0].length });

  const slides = secs.map((sec, i) => {
    const inner = sec.inner;
    const nextStart = i + 1 < secs.length ? s.indexOf('<section class="s-slide', sec.end) : s.length;
    const between = s.slice(sec.end, nextStart);
    const notes = strip(((between.match(/<aside class="s-notes">([\s\S]*?)<\/aside>/) || [])[1] || '').replace(/<span class="s-notes-label">[\s\S]*?<\/span>/, ''));

    const kicker = strip((inner.match(/<p class="s-eyebrow">([\s\S]*?)<\/p>/) || [])[1]);
    const title = strip((inner.match(/<h1 class="s-slide-title">([\s\S]*?)<\/h1>/) || inner.match(/<h2 class="s-slide-head">([\s\S]*?)<\/h2>/) || [])[1]);
    const lead = strip((inner.match(/<p class="s-slide-lead"[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
    const bullets = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => strip(x[1]));
    const stats = [...inner.matchAll(/<div class="s-slide-stat"><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/div>/g)].map((x) => ({ v: strip(x[1]), l: strip(x[2]) }));
    const cta = strip((inner.match(/<div class="s-slide-cta"><a>([\s\S]*?)<\/a>/) || [])[1]);
    const media = /s-slide-media/.test(inner);

    let layout = /s-slide--title/.test(sec.mod) ? 'title'
      : /s-slide--quote/.test(sec.mod) ? 'quote'
      : /s-slide--divider/.test(sec.mod) ? 'divider'
      : (/s-slide--center/.test(sec.mod) || cta) ? 'cta'
      : stats.length ? 'stats'
      : (media && bullets.length) ? 'twocol'
      : media ? 'media'
      : 'bullets';

    return { layout, kicker, title, lead, bullets, stats, cta, media, notes };
  });

  return { theme, palette: palName, slides };
}

// Export deck HTML -> .pptx at outPath. Returns {ok, out, census} | {ok:false,…}.
export function exportPptx(html, outPath) {
  const py = findPy();
  if (!py) return { ok: false, skipped: true, reason: 'python-pptx not installed — run `npm run setup:pptx` (creates .pptx-venv).' };
  const ir = parseDeck(html);
  if (!ir.slides.length) return { ok: false, error: 'no .s-slide sections found — compose a deck (platform:"deck") first.' };
  try {
    const dir = mkdtempSync(join(tmpdir(), 'pptx-'));
    const irPath = join(dir, 'ir.json');
    writeFileSync(irPath, JSON.stringify(ir));
    const out = execFileSync(py, [join(__dirname, 'pptx_writer.py'), irPath, outPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: outPath, census: JSON.parse(out.trim()) };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || String(e)).slice(0, 400) };
  }
}
