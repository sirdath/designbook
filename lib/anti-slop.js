/* ============================================
   anti-slop.js — detect the AI-generated / template "slop" tells in HTML
   ============================================
   Zero-dep, vanilla regex over arbitrary HTML. Encodes the kill-list from
   web-excellence.skill.md so the save-gate can REJECT the canonical generated-
   looking signatures. Tuned for low false positives: Design Book's own composed
   pages are token-driven (var(--accent), no hardcoded AI hexes, no lorem), so
   they don't trip — this catches pasted / SDK-generated / hand-written slop.

   antiSlop(html) -> { findings: [{check, severity, message}], penalty }
   severity: 'high' (a hard tell, blockable) · 'soft' (lowers the score)
   ============================================ */

// The canonical indigo→purple "AI gradient" hexes (Tailwind 500/600 indigo/violet/purple).
const AI_HEXES = /#(6366f1|818cf8|4f46e5|4338ca|a855f7|8b5cf6|7c3aed|6d28d9|c084fc|a78bfa|9333ea)\b/i;
const PURPLE_IN_GRAD = /#(a855f7|8b5cf6|7c3aed|6d28d9|c084fc|a78bfa|6366f1|818cf8|4f46e5|9333ea)|\b(purple|violet|indigo|fuchsia)\b/i;
const BLUEPINK_IN_GRAD = /#(3b82f6|2563eb|60a5fa|0ea5e9|38bdf8|ec4899|db2777|f472b6|d946ef)|\b(blue|cyan|sky|pink|rose)\b/i;
// Tailwind default-palette utility tokens
const AI_TAILWIND = /\b(from-(purple|indigo|violet|fuchsia)-\d{2,3}|to-(blue|cyan|purple|pink)-\d{2,3}|via-(purple|indigo|violet)-\d{2,3}|bg-(indigo|violet|purple)-(5|6|7)\d{2}|text-(indigo|violet)-\d{2,3})\b/i;
// empty-superlative filler copy (any company could ship it)
const SLOP_PHRASES = [
  'best[- ]in[- ]class', 'cutting[- ]edge', 'seamless integration', 'take it to the next level',
  'game[- ]?changer', 'world[- ]class', 'unlock the (power|potential)', 'empower your',
  'revolutioniz', 'next[- ]generation solution', 'drive meaningful', 'state[- ]of[- ]the[- ]art',
  'one[- ]stop[- ]shop', 'leverage the power', 'supercharge your', 'elevate your',
];

function stripToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
}

export function antiSlop(html) {
  html = String(html || '');
  const findings = [];

  // 1. the AI default indigo/purple→blue gradient — THE signature tell
  let aiGradient = AI_HEXES.test(html);
  if (!aiGradient) {
    const grads = html.match(/(linear|radial|conic)-gradient\([^;){}]*\)/gi) || [];
    for (const g of grads) { if (PURPLE_IN_GRAD.test(g) && BLUEPINK_IN_GRAD.test(g)) { aiGradient = true; break; } }
  }
  if (aiGradient) findings.push({ check: 'ai-default-gradient', severity: 'high',
    message: 'The indigo/purple→blue "AI gradient" — the #1 generated-looking tell. Use a hand-built OKLCH palette with ONE hero hue (and grain on any gradient surface).' });

  // 2. Tailwind default-palette tokens
  if (AI_TAILWIND.test(html)) findings.push({ check: 'ai-default-tailwind', severity: 'high',
    message: 'Tailwind indigo/purple default tokens (from-purple-*, bg-indigo-600, …) — the canonical AI-slop palette. Bind colors to brand tokens instead.' });

  const text = stripToText(html);
  // 3. lorem ipsum placeholder copy in production
  if (/\blorem ipsum\b|\bdolor sit amet\b/i.test(text)) findings.push({ check: 'lorem-ipsum', severity: 'high',
    message: 'Lorem ipsum in content — placeholder copy reads as unfinished/templated. Ship real, specific copy.' });

  // 4. empty-superlative filler copy (need >=2 distinct hits to avoid false flags)
  const hits = SLOP_PHRASES.filter((p) => new RegExp(p, 'i').test(text));
  if (hits.length >= 2) findings.push({ check: 'superlative-copy', severity: 'soft',
    message: 'Empty-superlative filler copy (' + hits.slice(0, 3).join(', ').replace(/[\\[\]]/g, '') + '…). Write specific, opinionated copy about the actual product (Stripe: "Financial infrastructure for the internet").' });

  const penalty = findings.reduce((s, f) => s + (f.severity === 'high' ? 24 : 7), 0);
  return { findings, penalty };
}
