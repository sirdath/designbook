/* ============================================
   designbook · lib/color-audit.js — perceptual color signal for the gate
   ============================================
   culori-based analysis layered ON TOP of the vault's regex coherence (which
   stays zero-dep). Two high-value signals the regex scorer can't see:

     • flat-gradient  (SOFT) — a `*-gradient()` whose color stops are perceptually
       near-identical (ΔE2000 < ~4) reads as a fake/AI gradient. We EXCLUDE
       alpha-fade scrims (same rgb, varying alpha) — those are legitimate.
     • rainbow-soup   (HARD) — too many distinct VIVID hues (OKLCH chroma above a
       floor, binned by hue) = "a different accent in every section." Mirrors the
       vault's existing GRADIENT-HEAVY asymmetry (only the worst tell hard-rejects).

   Pure + synchronous + ESM (culori is ESM; designbook is type:module). Designbook
   only — never imported by the zero-dep vault. Merged in lib/vault.js coherence().
   ============================================ */
import { parse, converter, differenceCiede2000 } from 'culori';

const toOklch = converter('oklch');
const dE = differenceCiede2000();

// ---- color extraction ----------------------------------------------------
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;

// split a comma list at TOP level only (respecting one level of nested parens)
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// pull every `*-gradient(...)` with balanced parens out of the html/css
function extractGradients(s) {
  const grads = [];
  const re = /(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\(/gi;
  let m;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    for (; i < s.length && depth > 0; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
    }
    if (depth !== 0) continue;
    const args = s.slice(start, i - 1);
    // each stop = "<color> [position]"; the color is the first parseable token
    const stops = splitTop(args).map((seg) => {
      const c = (seg.match(COLOR_RE) || [])[0];
      return c ? parse(c) : null;
    }).filter(Boolean);
    if (stops.length >= 2) grads.push({ raw: m[0] + args.slice(0, 50), stops });
  }
  return grads;
}

const alphaOf = (c) => (c && c.alpha != null ? c.alpha : 1);

// ---- the audit -----------------------------------------------------------
export function colorAudit(html, opts = {}) {
  const s = String(html || '');
  const findings = [];

  // 1) flat gradients (soft, capped) — skip true alpha-fades (scrims)
  let flatCount = 0;
  for (const g of extractGradients(s)) {
    const alphas = g.stops.map(alphaOf);
    const alphaRange = Math.max(...alphas) - Math.min(...alphas);
    // an intentional fade (e.g. a hero scrim) varies alpha → legitimate, skip
    if (alphaRange > 0.18) continue;
    let maxDE = 0;
    for (let i = 0; i < g.stops.length - 1; i++) maxDE = Math.max(maxDE, dE(g.stops[i], g.stops[i + 1]) || 0);
    if (maxDE < 4) {
      flatCount++;
      findings.push({
        check: 'flat-gradient', severity: 'soft', penalty: 6,
        message: `flat gradient — stops nearly identical (ΔE ${maxDE.toFixed(1)}); reads as a fake/AI gradient. Use a real hue/lightness delta or a solid fill: ${g.raw}…`,
      });
    }
  }

  // 2) rainbow soup (hard) — count distinct VIVID hues across all literal colors
  const hues = new Set();
  let vivid = 0;
  const seen = new Set();
  for (const tok of s.match(COLOR_RE) || []) {
    if (seen.has(tok)) continue; seen.add(tok);
    const col = parse(tok); if (!col) continue;
    if (alphaOf(col) < 0.35) continue;            // faint overlays don't count as accents
    const o = toOklch(col); if (!o || o.h == null) continue;
    if (o.c < 0.09 || o.l < 0.12 || o.l > 0.95) continue;  // skip greys / near-black / near-white
    vivid++;
    hues.add(Math.round(o.h / 30) % 12);          // 30° hue buckets
  }
  if (hues.size >= 4) {
    findings.push({
      check: 'rainbow-soup', severity: 'hard', penalty: 38,
      message: `rainbow soup — ${hues.size} distinct vivid hues hardcoded across the page. Commit to one accent (+ at most one accent-2); pull color from the palette tokens, not per-section hexes.`,
    });
  }

  const penalty = Math.min(38 + 24, findings.reduce((a, f) => a + f.penalty, 0)); // cap total
  return {
    findings,
    penalty,
    stats: { flatGradients: flatCount, vividColors: vivid, distinctHues: hues.size },
  };
}
