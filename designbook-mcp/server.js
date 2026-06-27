#!/usr/bin/env node
/* ============================================
   designbook MCP server
   ============================================
   Exposes the Design Book workbench to MCP-compatible AI agents
   (Claude Code, the SDK engine, Cursor, …). Every tool is a thin
   HTTP client to the designbook core server (DESIGNBOOK_URL env,
   default http://localhost:4747) — the deterministic work (compose,
   coherence, inspect, page CRUD) happens THERE, for free.

   THE EFFICIENCY CONTRACT (encoded in every description):
     Draft with book_compose first — deterministic and free.
     Verify with book_inspect facts. Spend model effort only on
     the delta the brief asks for. Save with manifest + briefId.

   Tools (26):
     orient   book_overview · book_meta
     draft    book_compose · book_variants · book_coherence · book_refine
     enrich   book_generate_image · book_save_asset · book_autofill_imagery   (anti-slop: real imagery)
     verify   book_inspect · book_view · book_critique     (facts + vision taste)
     persist  book_list_pages · book_get_page · book_save_page
     export   book_export_pptx · book_lottie
     briefs   book_briefs · book_claim_brief · book_complete_brief
     video    book_video_compose · book_video_inspect · book_video_critique · book_video_refine · book_video_render · book_video_view
   ============================================ */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
// single source of truth — the inspect lab owns these; the bridge must not drift
import { MODES, VIEWPORTS } from '../lib/inspect.js';

// The save-gate's hard coherence floor. Deliberately distinct from the vault's
// soft 80 advisory (ok = score>=80): 70 is "reject the save", 80 is "could be
// tighter". Kept as a named constant so the two layers never get conflated.
export const GATE_COHERENCE_MIN = 70;

// The full tool surface, single-sourced so the header/docs/tests can't drift.
export const TOOLS = [
  'book_overview', 'book_meta', 'book_compose', 'book_variants', 'book_coherence', 'book_critique', 'book_refine',
  'book_generate_image', 'book_save_asset', 'book_autofill_imagery',
  'book_inspect', 'book_view', 'book_list_pages', 'book_get_page', 'book_save_page', 'book_export_pptx', 'book_lottie',
  'book_briefs', 'book_claim_brief', 'book_complete_brief',
  'book_video_compose', 'book_video_inspect', 'book_video_critique', 'book_video_refine', 'book_video_render', 'book_video_view',
];

const BASE = (process.env.DESIGNBOOK_URL || 'http://localhost:4747').replace(/\/+$/, '');

// =====================================================
// Thin HTTP client (global fetch, Node 18+)
// =====================================================
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new Error(`Design Book server unreachable at ${BASE} (${err.message}). Start it: \`node server.js\` in the designbook root, or set DESIGNBOOK_URL.`);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data && data.error ? data.error : `${method} ${path} → HTTP ${res.status}`);
  return data;
}

// Wrap a handler so any thrown error becomes a proper MCP error result.
function guard(fn) {
  return async (args) => {
    try { return await fn(args || {}); }
    catch (err) { return { content: [{ type: 'text', text: `_${err.message}_` }], isError: true }; }
  };
}

// =====================================================
// Render helpers
// =====================================================
function fenceHtml(html) { return '```html\n' + html + '\n```'; }

// Visual-first genres read as AI wireframes without real imagery — they carry
// a craft-floor (≥1 image) the save-gate enforces. saas/blog/startup are exempt.
export const IMAGERY_MANDATORY = new Set(['ecommerce', 'portfolio', 'restaurant', 'agency', 'landing']);

// The save-gate's deterministic findings. Each is {check, code, cause, fix}:
// `check` drives the loop fingerprint, `code` is the stable string for
// structuredContent.violations, and cause→fix is the one-step remedy the agent
// reads. NEVER a bare name — every rejection tells the agent exactly what to do.
// Pure (args only) so it unit-tests without booting the MCP server.
// the authenticity-aware coherence reject, shared by the web and mobile gates
function coherenceFinding(coh) {
  if ((coh?.score ?? 100) >= GATE_COHERENCE_MIN) return null;
  const slop = (coh?.authenticity?.tells || []).includes('GRADIENT-HEAVY-NO-IMAGERY');
  return { check: 'coherence', code: `coherence:${coh.score}`,
    cause: `score ${coh.score}/100 — ${slop ? 'gradient-heavy with no real imagery (the #1 AI tell)' : 'too many cohesion violations'}`,
    fix: slop ? 'book_generate_image for a hero and remove one gradient' : 'swap hardcoded hex/px/ms for tokens (see the per-type hints below)' };
}

export function gateFindings(coh, diag, ctx) {
  const f = [];
  const cf = coherenceFinding(coh);
  if (cf) f.push(cf);
  const errs = (diag?.console || []).filter((c) => c.level === 'error');
  if (errs.length) f.push({ check: 'console-errors', code: `console-errors:${errs.length}`,
    cause: `${errs.length} JS error(s): ${errs.slice(0, 2).map((e) => e.message).join('; ').slice(0, 140)}`,
    fix: 'fix the first error — it usually cascades and clears the rest' });
  if ((diag?.resources || []).length) f.push({ check: 'failed-resources', code: `failed-resources:${diag.resources.length}`,
    cause: `${diag.resources.length} asset(s) 404: ${diag.resources.slice(0, 2).map((r) => r.url).join(', ').slice(0, 140)}`,
    fix: 'correct the href/src, or book_save_asset the missing file then reference it' });
  if (diag?.layout?.hOverflow) {
    const o = (diag.layout.overflowers || [])[0];
    f.push({ check: 'hOverflow', code: 'hOverflow@iphone-15',
      cause: o ? `${o.sel} reaches ${o.right}px on a 393px phone${o.width ? ` (width ${o.width}px)` : ''}` : 'an element is wider than the phone viewport',
      fix: 'cap the widest element: max-width:100% / flex-wrap:wrap / min-width:0 on the flex child' });
  }
  if ((diag?.css?.undefinedVars || []).length) f.push({ check: 'undefined-vars', code: `undefined-vars:${diag.css.undefinedVars.join(',')}`,
    cause: `CSS var(s) referenced but never defined: ${diag.css.undefinedVars.join(', ')}`,
    fix: 'define them on :root/.struct, or give each a var(--x, fallback)' });
  if ((diag?.render?.invisibleContent || []).length) {
    const iv = diag.render.invisibleContent[0];
    f.push({ check: 'invisible-content', code: `invisible-content:${diag.render.invisibleContent.length}`,
      cause: `${diag.render.invisibleContent.length} element(s) occupy space but render invisible${iv ? ` — e.g. ${iv.sel} (${iv.cause})` : ''}. A human sees a blank/broken page.`,
      fix: iv && /reveal/.test(iv.cause) ? 'the reveal script never ran — ensure the IntersectionObserver script is present, or remove .s-reveal' : 'an element is opacity:0 / visibility:hidden — make it visible or remove it' });
  }
  if ((diag?.layout?.occluded || []).length) {
    const oc = diag.layout.occluded[0];
    f.push({ check: 'occlusion', code: `occlusion:${diag.layout.occluded.length}`,
      cause: `${diag.layout.occluded.length} control(s) covered by an unrelated element — a human can't click them${oc ? ` — e.g. ${oc.sel}${oc.sample ? ` "${oc.sample}"` : ''} sits under ${oc.by}` : ''}`,
      fix: 'a decorative hero/scrim or an ::after band sits over the control — give the control position+z-index above it, or pointer-events:none on the decoration' });
  }
  if ((diag?.layout?.asymmetry || []).length) {
    const sy = diag.layout.asymmetry[0];
    f.push({ check: 'asymmetry', code: `asymmetry:${diag.layout.asymmetry.map((a) => a.kind).join(',')}`,
      cause: `${diag.layout.asymmetry.length} unintended-asymmetry signal(s) — e.g. ${sy.sel}: ${sy.note}`,
      fix: 'restore symmetric horizontal padding/margins, or center the declared-centered block (check for a stray margin / horizontal overflow pushing it)' });
  }
  // imagery craft-floor — visual-first genres must carry real imagery
  const genre = String(ctx?.genre || '').toLowerCase();
  if (IMAGERY_MANDATORY.has(genre) && coh?.authenticity?.imageCount === 0) {
    f.push({ check: 'imagery-floor', code: `imagery-floor:${genre}`,
      cause: `a ${genre} page with 0 images reads as an AI wireframe (the differentiator is real imagery)`,
      fix: 'book_generate_image for the hero/products → book_save_asset → reference them; or Illustrations.mount() for vector scenes' });
  }
  // anti-slop — reject the AI-generated / template tells (web-excellence kill-list).
  // HIGH-severity only blocks; soft tells (superlative copy) just lower the score.
  for (const s of (coh?.antiSlop?.findings || [])) {
    if (s.severity !== 'high') continue;
    f.push({ check: s.check, code: s.check, cause: s.message,
      fix: s.check === 'ai-default-gradient' ? 'replace the indigo/purple→blue gradient with ONE brand hero hue (OKLCH) + a grain overlay'
        : s.check === 'ai-default-tailwind' ? 'bind colors to brand tokens, not Tailwind indigo/purple defaults'
        : s.check === 'lorem-ipsum' ? 'ship real, specific copy — no placeholder text'
        : 'see web-excellence.skill.md' });
  }
  return f;
}

// The mobile save-gate — composed app flows DON'T trip web-overflow (.app-flow
// is overflow-x:auto), so the web gate would wave through a flow with content
// under the status bar, primary actions out of thumb-reach, or no native nav.
// This runs the mobile (HIG) lab instead. NEVER rejects on board-width overflow.
// `mob` is an inspect mode:'mobile' report ({summary, screens}). Pure.
export function gateFindingsMobile(coh, mob) {
  const f = [];
  const cf = coherenceFinding(coh);
  if (cf) f.push(cf);
  if (!mob || mob.error) return f; // couldn't assess HIG — don't block on that
  const s = mob.summary || {};
  if ((s.score ?? 100) < 70) f.push({ check: 'mobile-hig', code: `mobile-hig:${s.score}`,
    cause: `mobile HIG score ${s.score}/100 across ${s.screens || 0} screen(s)`,
    fix: 'fix the per-screen warnings below (safe-area / tap-target / nav)' });
  if (s.safeAreaIssues > 0) f.push({ check: 'safe-area', code: `safe-area:${s.safeAreaIssues}`,
    cause: `${s.safeAreaIssues} safe-area violation(s) — content under the status bar or controls in the home-indicator strip`,
    fix: 'keep content inside .scr-body; bottom bars (.scr-cta / .scr-tabbar) already pad the home indicator' });
  if (s.reachIssues > 0) f.push({ check: 'thumb-reach', code: `thumb-reach:${s.reachIssues}`,
    cause: `${s.reachIssues} primary action(s) above the one-handed thumb-reach zone`,
    fix: 'move the primary CTA into a bottom .scr-cta bar (lower third of the screen)' });
  const navGaps = (mob.screens || []).filter((sc) => (sc.warnings || []).some((w) => /tab bar|nav chrome|back affordance/.test(w)));
  if (navGaps.length) f.push({ check: 'nav-convention', code: `nav-convention:${navGaps.length}`,
    cause: `${navGaps.length} screen(s) missing native nav: ${navGaps.map((sc) => sc.shell).join(', ')}`,
    fix: 'add .scr-tabbar to top-level screens; a ‹ back affordance to pushed/detail screens' });
  return f;
}

function coherenceLine(c) {
  if (!c) return '';
  const counts = c.counts && Object.keys(c.counts).length
    ? ' (' + Object.entries(c.counts).map(([k, v]) => `${k}:${v}`).join(' · ') + ')'
    : '';
  let line = `Coherence: ${c.score}/100${counts}`;
  // surface the authenticity deficit the instant the agent drafts — imagery is
  // the differentiator, and an imageless gradient page is the #1 "AI tell".
  const a = c.authenticity;
  if (a) {
    if (a.tells && a.tells.includes('GRADIENT-HEAVY-NO-IMAGERY')) {
      line += `\n⚠ AI-TELL: gradient-heavy with **0 images** — generate a hero (book_generate_image) or mount an illustration, and drop a gradient. This currently fails the save-gate.`;
    } else if (a.imageCount === 0) {
      line += `\n→ imagery: **0 images** on the page. Real imagery is the biggest "custom, not AI" signal — book_generate_image (photos) or svg/illustrations.js (vector scenes). book_save_asset to attach.`;
    }
    if (a.motionSignals === 0) line += `\n→ motion: none yet — a reveal-on-scroll or tasteful transition lifts it out of "wireframe".`;
  }
  return line;
}

function sectionLines(sections) {
  return (sections || []).map((s) =>
    `- **${s.slot}** → ${s.snippet ? '`' + s.snippet + '`' : '(no match)'}${s.companions && s.companions.length ? ' + ' + s.companions.map((c) => '`' + c + '`').join(', ') : ''}`);
}

function renderMobileReport(r) {
  if (r.error) return `## mobile lab\n_${r.error}_`;
  const s = r.summary || {};
  const head = `## mobile lab — ${s.screens || 0} screen${s.screens === 1 ? '' : 's'} · score ${r.score}/100\n` +
    `summary: ${s.smallTaps || 0} small tap target(s) · ${s.safeAreaIssues || 0} safe-area issue(s) · ${s.reachIssues || 0} thumb-reach issue(s)`;
  const screens = (r.screens || []).map((sc) => {
    const nav = sc.nav || {};
    const chips = [
      nav.hasTabbar ? 'tab bar' : null,
      nav.hasBack ? 'back' : null,
      nav.hasFab ? 'FAB' : null,
      nav.title ? `“${nav.title}”` : null
    ].filter(Boolean).join(' · ') || 'no nav chrome';
    const lines = [`### [${sc.ref}] ${sc.shell} — ${sc.box.w}×${sc.box.h} · score ${sc.score}/100`, `nav: ${chips}`];
    if (sc.warnings && sc.warnings.length) lines.push(...sc.warnings.map((w) => `- ⚠ ${w}`));
    else lines.push('- ✓ clean — safe areas respected, taps ≥44pt, primary actions in reach');
    for (const t of sc.tapTargets?.small || []) lines.push(`  · tap < 44pt: \`${t.sel}\` (${t.w}×${t.h})`);
    return lines.join('\n');
  });
  return [head, ...screens].join('\n\n');
}

function renderDiagnoseReport(r) {
  const out = [`## diagnose — ${r.viewport} · score ${r.score}/100`];
  const errs = (r.console || []).filter((c) => c.level === 'error');
  errs.slice(0, 5).forEach((e) => out.push(`- ✗ console.error: ${e.message}${e.source ? ` (${e.source})` : ''}`));
  (r.resources || []).slice(0, 5).forEach((x) => out.push(`- ✗ failed to load: ${x.url}`));
  // render-truth first — it's the "looks fine in facts, blank to a human" class
  (r.render?.invisibleContent || []).slice(0, 6).forEach((x) => out.push(`- ✗ INVISIBLE: \`${x.sel}\` — ${x.cause}${x.sample ? ` "${x.sample}"` : ''}`));
  (r.render?.collapsedSections || []).forEach((x) => out.push(`- ✗ collapsed: \`${x.sel}\` (${x.height}px tall, has content)`));
  if (r.layout?.hOverflow) out.push('- ✗ horizontal overflow on this viewport');
  (r.a11y?.contrastFails || []).slice(0, 4).forEach((x) => out.push(`- ⚠ contrast ${x.ratio} < ${x.required}: \`${x.sel}\`${x.sample ? ` "${x.sample}"` : ''}`));
  if ((r.a11y?.missingAlt || []).length) out.push(`- ⚠ ${r.a11y.missingAlt.length} image(s) missing alt`);
  if ((r.a11y?.invalidRoles || []).length) out.push(`- ⚠ ${r.a11y.invalidRoles.length} invalid ARIA role(s) (ignored by assistive tech) — e.g. \`${r.a11y.invalidRoles[0].sel}\` role="${r.a11y.invalidRoles[0].role}"`);
  if ((r.a11y?.badAriaAttrs || []).length) out.push(`- ⚠ ${r.a11y.badAriaAttrs.length} unknown aria-* attribute(s) (typo — silently does nothing) — e.g. \`${r.a11y.badAriaAttrs[0].attr}\` on \`${r.a11y.badAriaAttrs[0].sel}\``);
  if ((r.a11y?.positiveTabindex || []).length) out.push(`- ⚠ ${r.a11y.positiveTabindex.length} element(s) with \`tabindex>0\` (scrambles tab order) — e.g. \`${r.a11y.positiveTabindex[0].sel}\` =${r.a11y.positiveTabindex[0].tabindex}; use tabindex=0 or DOM order`);
  if (r.typography?.defaultFont) out.push(`- ⚠ \`${r.typography.defaultFont}\` is the only custom typeface (the default-font tell) — pair a distinctive display face with a workhorse text face`);
  if ((r.images?.missingDims || []).length) out.push(`- ⚠ ${r.images.missingDims.length} image(s) without width/height — these shift layout as they load (CLS). Set explicit dims or aspect-ratio`);
  if (r.images?.lcpNotPreloaded) out.push(`- ⚠ the hero/LCP image (\`${r.images.lcpNotPreloaded.sel}\`) isn't prioritized — add fetchpriority="high" (or <link rel=preload as=image>) to cut LCP`);
  if ((r.images?.belowFoldEager || []).length) out.push(`- ⚠ ${r.images.belowFoldEager.length} below-the-fold image(s) not lazy — add loading="lazy" so they don't compete with the LCP`);
  if ((r.images?.oversized || []).length) out.push(`- ⚠ ${r.images.oversized.length} oversized image(s) (served far larger than shown) — e.g. \`${r.images.oversized[0].sel}\` ${r.images.oversized[0].natural}→${r.images.oversized[0].displayed}; resize or use srcset`);
  if ((r.reducedMotion?.infiniteUnderReduce || []).length) {
    const rm = r.reducedMotion.infiniteUnderReduce;
    out.push(`- ⚠ reduced-motion: ${rm.length} infinite animation(s) keep running under \`prefers-reduced-motion: reduce\` (no guard) — e.g. \`${rm[0].sel}\` (${rm[0].animation}, ${rm[0].duration}). Disable them under reduce: \`@media (prefers-reduced-motion: reduce){ … animation: none }\`.`);
  }
  if ((r.layout?.occluded || []).length) {
    const oc = r.layout.occluded[0];
    out.push(`- ✗ occlusion: ${r.layout.occluded.length} control(s) covered by an unrelated element (unclickable) — e.g. \`${oc.sel}\` under \`${oc.by}\`. Raise the control's z-index or set \`pointer-events:none\` on the decoration.`);
  }
  if ((r.layout?.asymmetry || []).length) {
    out.push(...r.layout.asymmetry.map((a) => `- ⚠ symmetry (${a.kind}): \`${a.sel}\` — ${a.note}`));
  }
  if ((r.css?.undefinedVars || []).length) out.push(`- ⚠ undefined CSS vars: ${r.css.undefinedVars.join(', ')}`);
  if (out.length === 1) out.push('✓ clean — no console errors, no invisible/collapsed content, no overflow, symmetric layout, a11y OK');
  return out.join('\n');
}

function renderTasteReport(r) {
  if (r.error) return `## taste\n_${r.error}_`;
  const t = r.typeScale || {}, c = r.color || {}, fn = r.fonts || {};
  const out = [
    `## taste — score ${r.tasteScore}/100`,
    `type: display ${t.display}px / body ${t.body}px = **${t.ratio}× hierarchy** · ${t.distinctSizes} distinct sizes`,
    `fonts: ${(fn.families || []).join(', ') || '—'}${fn.hasCustomFont ? '' : '  ⚠ system-only'}`,
    `color: ${c.gradients} gradient(s) · ${c.images} image(s) · ${c.glass} glass · ${c.borderCards} left-border card(s)`
  ];
  if ((r.tells || []).length) {
    out.push('', '**Slop tells:**');
    r.tells.forEach((x) => out.push(`- ⚠ ${x.tell}${x.count !== undefined ? ` (${x.count})` : ''} — ${x.note}`));
  } else {
    out.push('', '✓ no slop tells — reads custom, not templated');
  }
  return out.join('\n');
}

function renderReport(r) {
  if (r.mode === 'mobile' || Array.isArray(r.screens)) return renderMobileReport(r);
  if (r.mode === 'diagnose') return renderDiagnoseReport(r);
  if (r.mode === 'taste') return renderTasteReport(r);
  const issues = [];
  if (r.hOverflow) issues.push('- **horizontal scroll present** — something is wider than the viewport');
  for (const o of r.overflowers || []) issues.push(`- overflows right edge: \`${o.sel}\` (right ${o.right}px, width ${o.width}px)`);
  for (const t of r.smallTaps || []) issues.push(`- tap target < 44×44: \`${t.sel}\` (${t.w}×${t.h})`);
  for (const t of r.tinyText || []) issues.push(`- text < 12px: \`${t.sel}\` (${t.px}px)${t.sample ? ` "${String(t.sample).slice(0, 40)}"` : ''}`);
  for (const o of r.offscreen || []) issues.push(`- stranded offscreen left: \`${o.sel}\` (left ${o.left}px)`);
  const c = r.counts || {};
  const lines = [`## ${r.viewport} — ${r.width}×${r.height} · doc ${r.docHeight}px`];
  lines.push(issues.length ? issues.join('\n') : '✓ clean — no layout issues');
  lines.push(`counts: ${c.sections ?? 0} sections · ${c.images ?? 0} images · ${c.buttons ?? 0} buttons · ${c.inputs ?? 0} inputs`);
  if (r.screenshotPath) lines.push(`screenshot: ${r.screenshotPath}`);
  return lines.join('\n');
}

function briefLine(b) {
  return `- \`${b.id}\` [${b.status}]${b.pageSlug ? ` (page: ${b.pageSlug})` : ''} — ${String(b.text || '').slice(0, 120)}`;
}

const WORKFLOW = [
  '**THE WORKFLOW (per brief):**',
  '1. `book_claim_brief(id)` — marks it `working`, returns the brief + page context.',
  '2. `book_compose({genre, preset?, …})` — draft deterministically. FREE and instant; never hand-write a scaffold. (`book_variants` composes a few seeds at once and keeps the best.)',
  '3. Apply only the delta the brief asks for to the composed HTML.',
  '4. **Make it real, not a wireframe** — the draft ships with 0 images. Add real imagery: `book_generate_image` (local photo gen) or mount `svg/illustrations.js` vector scenes, then `book_save_asset` them. Imagery is the #1 "custom, not AI-slop" signal; visual-first genres (ecommerce/portfolio/restaurant/agency/landing) REQUIRE ≥1 image to clear the save-gate. `book_view` to eyeball composition only when facts aren\'t enough.',
  '5. `book_inspect({html})` — verify with structured facts (no screenshots): mode:"diagnose" for the full audit, mode:"mobile" for app flows.',
  '6. `book_save_page({title, html, manifest:{genre}, briefId})` — saves AND auto-completes the brief. The save-gate rejects with one-step `check → fix` findings if anything is off.'
].join('\n');

// Connect-time orientation surfaced to EVERY agent via the MCP `instructions`
// field (it lands in the client's context on initialize) — so an agent knows
// exactly how to use Design Book BEFORE it calls a single tool, not only if it
// happens to call book_overview. Covers both the no-brief and queue paths.
const INSTRUCTIONS = [
  'Design Book — a local design workbench. You compose real, on-brand web pages against a component vault (900+ snippets, 60+ palettes, taste presets), verify them with FACTS via headless Chrome (no guessing), and save them as files. Tools proxy a local server; all work is deterministic and free except local image generation.',
  '',
  'FIRST: call `book_overview` for live vault stats, the brief queue, and the toolset.',
  '',
  'TWO WAYS TO WORK:',
  '• No brief (just make something): `book_compose({genre})` → returns full HTML → change only what was asked → add real imagery (`book_generate_image` / `book_save_asset`) → `book_inspect({html, mode:"diagnose"})` (facts) → `book_critique` (vision taste score + fixes) → `book_save_page({title, html, manifest:{genre}})`.',
  '• From the queue: `book_briefs` → `book_claim_brief(id)` → same compose → enrich → inspect → save, passing `briefId` to `book_save_page` (which auto-completes the brief).',
  '',
  'RULES (these keep output custom-grade, not AI-slop):',
  '1. NEVER hand-write HTML from scratch — always start from `book_compose` (free, instant, on-brand vault tokens).',
  '2. A fresh draft has ZERO images = a wireframe. Add ≥1 real image or vector scene before saving; visual genres (ecommerce/portfolio/restaurant/agency/landing) REQUIRE imagery to pass the save-gate.',
  '3. Verify BOTH halves of quality: `book_inspect` for facts (correct) AND `book_critique` for a vision taste score against the Awwwards rubric with located fixes (beautiful). `book_view` gives the raw screenshot when you want to judge it yourself.',
  '3b. To ACT on a critique instead of hand-editing, `book_refine` rewrites the draft to apply the fixes (compose → critique → refine → save). To ITERATE on a page, call `book_refine({slug, instruction:"bigger hero, warmer palette"})` with no critique — one fast call per tweak.',
  '4. `book_save_page` runs a save-gate that REJECTS slop — default indigo/purple gradients, Tailwind defaults, lorem, low contrast, missing reduced-motion/ARIA, failing Core Web Vitals — with one-step check→fix findings. Fix what it flags, then re-save.',
  '5. Spend effort only on the delta the request asks for — no unrequested redesigns or gold-plating.',
  '',
  'VIDEO: to make a SaaS-style product video, the SAME loop with book_video_*: `book_video_compose({genre})` (free deterministic plan, palette-matched to the page) → set scene copy/media → `book_video_inspect` (facts) → `book_video_critique` (vision taste) → `book_video_refine` (edit the plan JSON) → `book_video_render` (MP4). Needs the remotion-studio install; tools return {skipped} otherwise.',
  'Richer, bespoke pieces: the sibling MCP `frontendmaxxing` (`search_components`, `get_snippet`, `get_palette`, `get_skill "web-excellence"`) is the full vault.',
  '',
  'If any tool returns "Design Book server unreachable", the local core server is down — start it (double-click Design Book.app, or `node server.js` in the designbook root).',
].join('\n');

// =====================================================
// Server setup
// =====================================================
async function main() {
  const server = new McpServer(
    { name: 'designbook', version: '1.0.0' },
    { instructions: INSTRUCTIONS }
  );
  const RO = { readOnlyHint: true, openWorldHint: false };
  const RW = { readOnlyHint: false, openWorldHint: false };

  // ---- book_overview ----
  server.registerTool('book_overview', {
    title: 'Design Book overview',
    description: 'One-call orientation: what the book is, vault stats, queued brief count, the brief workflow, and the full toolset incl. the anti-slop trio (book_generate_image / book_save_asset for real imagery, book_view to see it). Call this first. Efficiency contract: draft free with book_compose, make it real with imagery (drafts are imageless wireframes), verify with book_inspect facts, spend model effort only on the delta the brief asks for.',
    inputSchema: {},
    outputSchema: {
      ok: z.boolean(), vault: z.string(), snippets: z.number(), palettes: z.number(), presets: z.number(),
      queuedBriefs: z.number(), workingBriefs: z.number(), totalBriefs: z.number(),
      queued: z.array(z.any())
    },
    annotations: RO
  }, guard(async () => {
    const [health, briefsRes] = await Promise.all([api('GET', '/api/health'), api('GET', '/api/briefs')]);
    const briefs = briefsRes.briefs || [];
    const queued = briefs.filter((b) => b.status === 'queued');
    const working = briefs.filter((b) => b.status === 'working');
    const text = [
      '# Design Book',
      `A local design workbench on the frontendmaxxing vault (${health.vault}) — ${health.snippets} snippets · ${health.palettes} palettes · ${health.presets} taste presets. Pages live as plain files in book/pages/<slug>/; briefs are the work queue.`,
      '',
      `**Briefs:** ${queued.length} queued · ${working.length} working · ${briefs.length} total`,
      queued.length ? queued.map(briefLine).join('\n') : '_Queue is empty — nothing to claim._',
      '',
      WORKFLOW,
      '',
      '**Make it custom, not slop:** every draft is an imageless wireframe. `book_generate_image` renders real photos locally; `svg/illustrations.js` (Illustrations.get/mount) gives vector scenes; `book_save_asset` attaches them. Real imagery + a little motion is what separates "custom-made" from "AI-generated" — and the coherence score now flags the deficit on every draft.',
      '',
      '**Efficiency contract:** draft with `book_compose` first — deterministic and free. Verify with `book_inspect` facts (never pixels unless asked). Spend model effort only on the delta the brief asks for.'
    ].join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        ok: !!health.ok, vault: health.vault, snippets: health.snippets, palettes: health.palettes, presets: health.presets,
        queuedBriefs: queued.length, workingBriefs: working.length, totalBriefs: briefs.length, queued
      }
    };
  }));

  // ---- book_meta ----
  server.registerTool('book_meta', {
    title: 'Book metadata',
    description: 'All valid compose inputs: genres, taste presets, palettes, aesthetics, densities, motions, font pairs, and named inspect viewports. Consult before book_compose so every axis value is real.',
    inputSchema: {},
    outputSchema: {
      genres: z.array(z.string()), presets: z.array(z.any()), palettes: z.array(z.any()),
      aesthetics: z.array(z.string()), densities: z.array(z.string()), motions: z.array(z.string()),
      fontPairs: z.array(z.string()), viewports: z.array(z.any())
    },
    annotations: RO
  }, guard(async () => {
    const m = await api('GET', '/api/meta');
    const text = [
      '# Design Book meta',
      `**Genres:** ${(m.genres || []).join(', ')}`,
      `**Presets:** ${(m.presets || []).map((p) => `\`${p.name}\` (${p.aesthetic}/${p.palette})`).join(' · ')}`,
      `**Palettes:** ${(m.palettes || []).length} — e.g. ${(m.palettes || []).slice(0, 10).map((p) => p.name).join(', ')}…`,
      `**Aesthetics:** ${(m.aesthetics || []).join(', ')}`,
      `**Densities:** ${(m.densities || []).join(', ')} · **Motions:** ${(m.motions || []).join(', ')}`,
      `**Font pairs:** ${(m.fontPairs || []).join(', ')}`,
      `**Viewports:** ${(m.viewports || []).map((v) => `${v.name} ${v.width}×${v.height}`).join(' · ')}`
    ].join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        genres: m.genres || [], presets: m.presets || [], palettes: m.palettes || [],
        aesthetics: m.aesthetics || [], densities: m.densities || [], motions: m.motions || [],
        fontPairs: m.fontPairs || [], viewports: m.viewports || []
      }
    };
  }));

  // ---- book_compose ----
  server.registerTool('book_compose', {
    title: 'Compose a page draft',
    description: 'Deterministically compose a draft for a genre (+ optional preset/taste axes/seed). DRAFT HERE FIRST — free, instant, zero tokens. platform "web" (default) = one scrolling page of sections; platform "mobile" = an app screen FLOW (phones) from the .scr-* shells (see get_skill("mobile-design")). The draft is a WIREFRAME — it ships with grey media placeholders and 0 images, so its coherence carries an imagery deficit. Real imagery is the difference between "AI slop" and "custom-made": call book_generate_image (photos) or mount svg/illustrations.js (vector scenes) and book_save_asset them. Visual-first genres (ecommerce/portfolio/restaurant/agency/landing) REQUIRE ≥1 real image to clear the save-gate. Then spend model effort only on the brief\'s delta, verify with book_inspect, save with book_save_page.',
    inputSchema: {
      genre: z.string().describe('web genres: saas, agency, portfolio, ecommerce, restaurant, startup, blog, landing. mobile genres: onboarding, social, commerce, health, finance, productivity, media, saas, app.'),
      platform: z.enum(['web', 'mobile']).optional().describe('"web" (default) or "mobile" (an app screen flow).'),
      preset: z.string().optional().describe('Taste preset name from book_meta (e.g. "clean-saas") — sets all axes coherently.'),
      palette: z.string().optional().describe('Palette name override (e.g. "saas-indigo").'),
      aesthetic: z.string().optional().describe('Aesthetic override: minimal, editorial, energetic, luxury, playful, technical.'),
      density: z.string().optional().describe('Density override: compact, normal, airy.'),
      motion: z.string().optional().describe('Motion override: minimal, standard, playful.'),
      fontPair: z.string().optional().describe('Font pair override (e.g. "grotesk-tech").'),
      font_pair: z.string().optional().describe('Alias of fontPair (matches the frontendmaxxing compose convention).'),
      seed: z.number().int().min(0).optional().describe('Variety seed — rotates per-slot/per-screen picks (and palette/type). 0 = house picks.'),
      compact: z.boolean().optional().describe('Omit the full HTML from the text (it stays in structuredContent.html) to save tokens in the compose→inspect→save loop.')
    },
    outputSchema: {
      platform: z.string().optional(), theme: z.record(z.string()),
      sections: z.array(z.any()).optional(), screens: z.array(z.any()).optional(),
      coherence: z.any(), warnings: z.array(z.any()), autofixed: z.array(z.string()).optional(), html: z.string()
    },
    annotations: RO
  }, guard(async (args) => {
    if (args.font_pair && !args.fontPair) args.fontPair = args.font_pair;
    const r = await api('POST', '/api/compose', args);
    const t = r.theme || {};
    const mobile = r.platform === 'mobile';
    const manifest = mobile
      ? (r.screens || []).map((s) => `- **${s.screen}** (\`.scr\` ${s.shell}) → ${s.component ? '`' + s.component + '`' : '_(.scr-* shells)_'}`)
      : sectionLines(r.sections);
    const text = [
      `# Composed ${mobile ? 'app flow' : 'page'}: ${args.genre}${args.preset ? ' · ' + args.preset : ''}${mobile ? `  (${(r.screens || []).length} screens)` : ''}`,
      `Theme: pal-${t.palette} · ${t.aesthetic} · ${t.fontPair} · ${t.motion} · ${t.density}`,
      coherenceLine(r.coherence),
      r.autofixed && r.autofixed.length ? '🔧 auto-healed: ' + r.autofixed.join(' · ') : '',
      r.warnings && r.warnings.length ? '**Warnings:** ' + r.warnings.join(' · ') : '',
      '',
      mobile ? '**Screen manifest (real mobile/ components to wire in):**' : '**Section manifest (real snippets to wire in):**',
      ...manifest,
      '',
      args.compact
        ? `_HTML: ${Buffer.byteLength(r.html || '')} bytes in structuredContent.html (omitted here to save tokens). Pass it to book_inspect / book_save_page._`
        : fenceHtml(r.html)
    ].filter((l) => l !== '').join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: { platform: r.platform, theme: t, sections: r.sections, screens: r.screens, coherence: r.coherence || null, warnings: r.warnings || [], autofixed: r.autofixed || [], html: r.html }
    };
  }));

  // ---- book_variants ----
  server.registerTool('book_variants', {
    title: 'Compose N variants, keep the best',
    description: 'Compose several seeded drafts of the same genre AT ONCE and rank them by coherence — the "explore in parallel, keep the winner" move. Returns a ranked table (seed · theme · score · tells) plus ONLY the winning variant\'s HTML; losers report byte counts, not bodies, to save tokens. Re-run book_compose({genre, seed}) to pull a loser\'s HTML. Same axes as book_compose. Use this instead of composing once when you want range before committing.',
    inputSchema: {
      genre: z.string().describe('Genre to vary (web or mobile genre — see book_compose).'),
      platform: z.enum(['web', 'mobile']).optional().describe('"web" (default) or "mobile".'),
      seeds: z.array(z.number().int().min(0)).optional().describe('Seeds to compose (default [0,1,2,3]). Each rotates per-slot picks (and palette/type where supported).'),
      preset: z.string().optional(), palette: z.string().optional(),
      aesthetic: z.string().optional(), density: z.string().optional(),
      motion: z.string().optional(), fontPair: z.string().optional()
    },
    outputSchema: { winner: z.any(), ranked: z.array(z.any()), html: z.string() },
    annotations: RO
  }, guard(async (args) => {
    const { genre, platform, seeds, ...overrides } = args;
    const body = { genre, platform, seeds: seeds && seeds.length ? seeds : [0, 1, 2, 3], overrides };
    const r = await api('POST', '/api/variants', body);
    const variants = (r.variants || []).map((v) => ({
      seed: v.seed,
      score: v.coherence?.score ?? 0,
      tells: v.coherence?.authenticity?.tells || [],
      theme: `pal-${v.theme?.palette} · ${v.theme?.aesthetic} · ${v.theme?.fontPair}`,
      bytes: Buffer.byteLength(v.html || ''),
      html: v.html || ''
    }));
    variants.sort((a, b) => b.score - a.score);
    const winner = variants[0];
    const table = [
      '| rank | seed | score | theme | bytes | tells |',
      '|---|---|---|---|---|---|',
      ...variants.map((v, i) => `| ${i === 0 ? '🏆' : i + 1} | ${v.seed} | ${v.score} | ${v.theme} | ${v.bytes} | ${v.tells.join(',') || '—'} |`)
    ].join('\n');
    const text = [
      `# ${variants.length} variants of ${genre} — winner: seed ${winner ? winner.seed : '?'} (score ${winner ? winner.score : '?'})`,
      table,
      '',
      'Only the winner HTML is returned (losers show bytes). `book_compose({genre, seed})` re-pulls any loser.',
      '',
      fenceHtml(winner ? winner.html : '')
    ].join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        winner: winner ? { seed: winner.seed, score: winner.score, theme: winner.theme } : null,
        ranked: variants.map(({ html, ...rest }) => rest),
        html: winner ? winner.html : ''
      }
    };
  }));

  // ---- book_coherence ----
  server.registerTool('book_coherence', {
    title: 'Coherence check',
    description: 'Score an HTML string 0–100 for taste cohesion (hardcoded hexes, unblessed durations, px radii, slop hovers). Free and deterministic — run after editing composed HTML, fix what it flags before saving.',
    inputSchema: { html: z.string().describe('Full HTML to score.') },
    outputSchema: { score: z.number(), ok: z.boolean(), counts: z.any(), warnings: z.array(z.any()) },
    annotations: RO
  }, guard(async ({ html }) => {
    const r = await api('POST', '/api/coherence', { html });
    const text = [
      `# Coherence: ${r.score}/100 ${r.ok ? '✓ ok' : '✗ below 80 — fix before saving'}`,
      ...(r.warnings || []).map((w) => `- **${w.type}** ×${w.count} — ${w.hint}${w.sample ? ` (e.g. ${JSON.stringify(w.sample.slice(0, 2))})` : ''}`)
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { score: r.score, ok: r.ok, counts: r.counts || {}, warnings: r.warnings || [] } };
  }));

  // ---- book_critique ----
  server.registerTool('book_critique', {
    title: 'Vision taste critique',
    description: 'The TASTE half of the MOAT. Renders the page to a REAL screenshot and has a VISION model judge the pixels against the Awwwards rubric (design 40 / usability 30 / creativity 20 / content 10) — returning scores, a one-line verdict, the ONE signature moment, and located, actionable fixes ("hero headline and subhead are the same weight — drop the subhead to 400/0.7 so the H1 leads"). book_inspect catches what is WRONG (facts: contrast/overflow/ARIA/CWV); book_critique catches what is BLAND (taste). Run it once a draft is structurally clean, before book_save_page, to push from "passes" to "designed". Costs one model call — compose + inspect stay free.',
    inputSchema: {
      html: z.string().optional().describe('Full HTML to critique. Omit to critique a saved page by slug.'),
      slug: z.string().optional().describe('Saved page slug to critique (alternative to html).'),
    },
    outputSchema: {
      ok: z.boolean(), scores: z.any(), verdict: z.string(), looksAiGenerated: z.boolean(),
      signatureMoment: z.string(), strengths: z.array(z.string()), issues: z.array(z.any()),
      screenshotUrl: z.string().optional(), model: z.string().optional(),
    },
    annotations: RO
  }, guard(async ({ html, slug }) => {
    const r = await api('POST', '/api/critique', { html, slug });
    const s = r.scores || {};
    const sev = { high: '🔴', med: '🟡', low: '⚪' };
    const text = [
      `# Taste critique: ${s.total ?? '?'}/100${r.looksAiGenerated ? '  ·  ⚠︎ reads as AI-generated' : ''}`,
      r.verdict ? `> ${r.verdict}` : '',
      '',
      `**Scores** — design ${s.design}/40 · usability ${s.usability}/30 · creativity ${s.creativity}/20 · content ${s.content}/10`,
      r.signatureMoment ? `\n**Signature moment:** ${r.signatureMoment}` : '',
      (r.strengths && r.strengths.length) ? `\n**Strengths**\n${r.strengths.map((x) => `- ${x}`).join('\n')}` : '',
      (r.issues && r.issues.length) ? `\n**Issues — fix before save**\n${r.issues.map((i) => `- ${sev[i.severity] || ''} **${i.area}** — ${i.observe}\n  → ${i.fix}`).join('\n')}` : '\n_No issues flagged._',
      r.screenshotUrl ? `\nscreenshot: ${r.screenshotUrl}` : '',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  // ---- book_refine ----
  server.registerTool('book_refine', {
    title: 'Generative refine pass',
    description: 'Close the loop: have a model REWRITE a draft to apply book_critique\'s located fixes — minimal diff, on-brand tokens, honoring reduced-motion, building the signature moment the critique named. Returns improved HTML + the change list. FAST PATH (one model call): pass `critique` (the book_critique result you just got) so it skips the internal pre-critique, and leave verify off. Set `verify:true` to re-critique the result for a before→after score delta (proves it moved, but adds two model calls). ITERATION LOOP — `book_refine({slug, instruction:"make the hero bigger and the palette warmer"})` with NO critique is a single fast call (the instruction IS the directive, so it skips the pre-critique); repeat to iterate on a page. Use it instead of hand-editing; then book_inspect and book_save_page. By DEFAULT it auto-picks the safer change: a small CSS-overlay PATCH (preserves the page; fixes type/CTA/spacing/color/hierarchy/nav) for large or polished pages and restyles, vs a full rewrite only for small structural edits (e.g. "add a section"). A full rewrite regenerates everything and can REGRESS a polished page (measured: apex 58→44 vs the patch 58→63), so reserve it. Pass patch:true to force the overlay, patch:false to force a full rewrite.',
    inputSchema: {
      html: z.string().optional().describe('Full HTML to refine. Omit to refine a saved page by slug.'),
      slug: z.string().optional().describe('Saved page slug to refine (alternative to html).'),
      instruction: z.string().optional().describe('Optional specific change to apply on top of the critique fixes.'),
      critique: z.any().optional().describe('A prior book_critique result — pass it to skip the internal pre-critique (saves a model call).'),
      verify: z.boolean().optional().describe('Re-critique the result for a before/after score delta. Default false (lean, one call); set true to prove the score moved (adds two model calls).'),
      patch: z.boolean().optional().describe('Force the change style: true = small CSS-overlay patch (preserves the page, throttle-safe); false = full rewrite (can add markup, but can regress a polished page). Omit to auto-pick (patch for large/restyle, full rewrite for small structural edits).'),
    },
    outputSchema: {
      ok: z.boolean(), html: z.string(), changes: z.array(z.string()),
      before: z.any().optional(), after: z.any().optional(), delta: z.number().nullable().optional(),
      truncated: z.boolean().optional(), unchanged: z.boolean().optional(), model: z.string().optional(),
    },
    annotations: RO
  }, guard(async ({ html, slug, instruction, critique, verify, patch }) => {
    const r = await api('POST', '/api/refine', { html, slug, instruction, critique, verify, patch });
    if (r.unchanged) {
      return { content: [{ type: 'text', text: `# Refine — no change\n${r.note || 'nothing to fix'}` }], structuredContent: r };
    }
    const b = r.before, a = r.after;
    const head = (a && b)
      ? `# Refine: ${b.total} → ${a.total}/100  (${r.delta >= 0 ? '+' : ''}${r.delta})${a.looksAiGenerated ? '  · still reads AI-generated' : ''}`
      : '# Refine complete';
    const text = [
      head,
      a && a.verdict ? `> ${a.verdict}` : (b && b.verdict ? `> was: ${b.verdict}` : ''),
      r.truncated ? '\n⚠︎ output may be truncated (no closing </html>) — re-run, or refine in smaller pieces.' : '',
      (r.changes && r.changes.length) ? `\n**Changed**\n${r.changes.map((c) => `- ${c}`).join('\n')}` : '',
      a && a.screenshotUrl ? `\nscreenshot: ${a.screenshotUrl}` : '',
      '\nImproved HTML is in structuredContent.html — verify with book_inspect, then book_save_page.',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  // ---- book_export_pptx ----
  server.registerTool('book_export_pptx', {
    title: 'Export deck → editable .pptx',
    description: 'Export a composed DECK-genre page (slug or html) to a fully-editable PowerPoint .pptx — every slide becomes native text boxes / shapes, never a flattened image. Structurally faithful, NOT pixel-identical (CSS gradients/web-fonts have no .pptx equivalent). Round-trips the saved file to self-verify it opens (slide/shape/notes census). Needs the python-pptx sidecar (`npm run setup:pptx`); returns {skipped} with an install hint if absent.',
    inputSchema: { slug: z.string().optional().describe('Saved deck page slug.'), html: z.string().optional().describe('Raw deck HTML (provide slug OR html).') },
    outputSchema: { ok: z.boolean(), out: z.string().optional(), census: z.any().optional(), skipped: z.boolean().optional(), reason: z.string().optional(), error: z.string().optional() },
    annotations: RO
  }, guard(async ({ slug, html }) => {
    const r = await api('POST', '/api/export-pptx', { slug, html });
    const text = r.ok
      ? `# Exported .pptx ✓\n- file: \`${r.out}\`\n- opens: ${r.census.opens} · slides: ${r.census.slides} · shapes: ${r.census.shapes} · notes: ${r.census.withNotes}\n\n_Structurally faithful (editable shapes), not pixel-identical._`
      : r.skipped ? `# Skipped — ${r.reason}` : `# Export failed — ${r.error}`;
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  // ---- book_lottie ----
  server.registerTool('book_lottie', {
    title: 'Validate + preview Lottie',
    description: 'Render Lottie JSON headless and return a hard verdict per file — OK (draws AND animates) / STATIC / BLANK / INVALID — plus a preview PNG. Catches LLM-authored Lottie that parses but renders nothing (opacity/size keyframes stuck at 0) — the silent-failure case. The same JSON it greenlights plays in lottie-web AND Flutter\'s `lottie` package. Pass paths:[…] (existing .json files) and/or json+name (inline). Needs the vault\'s tools/lottie-check.mjs + playwright-core; returns {skipped} if absent.',
    inputSchema: {
      paths: z.array(z.string()).optional().describe('Lottie .json file paths to validate (absolute or vault-relative).'),
      json: z.string().optional().describe('Inline Lottie JSON string (provide paths and/or json).'),
      name: z.string().optional().describe('Name for the inline json preview tile.'),
    },
    outputSchema: { ok: z.boolean(), preview: z.string().optional(), results: z.array(z.any()).optional(), skipped: z.boolean().optional(), reason: z.string().optional(), error: z.string().optional() },
    annotations: RO
  }, guard(async ({ paths, json, name }) => {
    const r = await api('POST', '/api/lottie-check', { paths, json, name });
    if (!r.ok) return { content: [{ type: 'text', text: r.skipped ? `# Lottie check skipped — ${r.reason}` : `# Lottie check error — ${r.error}` }], structuredContent: r };
    const res = r.results || [];
    const ok = res.filter((x) => x.verdict === 'OK').length;
    const rows = res.map((x) => `- ${x.verdict === 'OK' ? '✓' : '✗'} **${x.name}** — ${x.verdict}${x.verdict === 'OK' ? ` · ${x.layers}L ${x.frames}` : x.verdict === 'INVALID' ? ` (${x.why})` : ''}`);
    const text = [`# Lottie check — ${ok}/${res.length} OK`, ...rows, '', `preview → \`${r.preview}\``].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  // ---- book_inspect ----
  server.registerTool('book_inspect', {
    title: 'Inspect across viewports',
    description: 'The screenshot killer: render a saved page (slug) or raw HTML in headless Chrome at named viewports and return STRUCTURED LAYOUT FACTS — overflow, small tap targets, tiny text, offscreen content, landmarks, counts. Facts are the default verification; set screenshot:true only when pixels are explicitly needed. Default viewports: iphone-15, ipad, desktop.',
    inputSchema: {
      slug: z.string().optional().describe('Saved page slug to inspect (provide slug OR html).'),
      html: z.string().optional().describe('Raw HTML to inspect (provide slug OR html).'),
      viewports: z.array(z.string()).optional().describe('Named viewports: iphone-se, iphone-15, iphone-15-max, ipad, ipad-landscape, laptop, desktop, desktop-xl.'),
      mode: z.enum(MODES).optional().describe('layout = fit facts (default) · perf = lag diagnostics (lagScore, reflow/recalc cost, census) · diagnose = full common-issues audit incl. RENDER-TRUTH (console errors, 404s, contrast, a11y, undefined vars, invisible/collapsed content) · element = point DevTools for one selector (box, computed, parents, overlaps) · mobile = HIG facts for a composed app flow (safe-area, thumb-reach, ≥44pt taps, nav conventions) · taste = "does it look good" as FACTS not a screenshot (type-scale ratio, rhythm, gradient↔imagery balance, tasteScore + DOM-shape slop tells like gradients-without-imagery / default-font / weak-hierarchy).'),
      selector: z.string().optional().describe('CSS selector — required for mode "element".'),
      screenshot: z.boolean().optional().describe('Also capture PNGs to book/shots/ (opt-in; facts are the default).')
    },
    outputSchema: { reports: z.array(z.any()) },
    annotations: RO
  }, guard(async ({ slug, html, viewports, mode, selector, screenshot }) => {
    if (!slug && !html) throw new Error('book_inspect needs either `slug` or `html`.');
    const body = {};
    if (slug) body.slug = slug;
    if (html) body.html = html;
    if (viewports) body.viewports = viewports;
    if (mode) body.mode = mode;
    if (selector) body.selector = selector;
    if (screenshot !== undefined) body.screenshot = screenshot;
    const r = await api('POST', '/api/inspect', body);
    const reports = r.reports || [];
    const text = [
      `# Inspect${slug ? ': ' + slug : ''} — ${reports.length} viewport${reports.length === 1 ? '' : 's'}`,
      '',
      ...reports.map(renderReport)
    ].join('\n\n');
    return { content: [{ type: 'text', text }], structuredContent: { reports } };
  }));

  // ---- book_save_asset (the agent's drawings become real project files) ----
  server.registerTool('book_save_asset', {
    title: 'Save a project asset',
    description: 'Save a file you created — an SVG illustration, ASCII art, extra CSS, a small image (base64) — into the project\'s assets/ folder. Returns the URL to reference from the page HTML (use that absolute URL in <img src>/<link href>; exports rewrite it to assets/ automatically). DRAW THINGS: hero illustrations, icons, decorative SVGs — pages should feel rich, not bare. The vault also ships ready scenes (svg/illustrations.js → Illustrations.get/mount) and ASCII banners (typography/ascii-banner.js).',
    inputSchema: {
      slug: z.string().describe('Project (page) slug the asset belongs to.'),
      name: z.string().describe('Filename with extension, e.g. "moon-hero.svg", "banner.txt", "extra.css", "photo.png".'),
      content: z.string().describe('File content (text, or base64 with encoding:"base64").'),
      encoding: z.enum(['utf8', 'base64']).optional().describe('Use "base64" for binary (png/jpg/webp).')
    },
    outputSchema: { name: z.string(), url: z.string() },
    annotations: RW
  }, guard(async ({ slug, name, content, encoding }) => {
    const r = await api('POST', `/api/pages/${encodeURIComponent(slug)}/assets`, { name, content, encoding });
    const a = r.asset;
    return {
      content: [{ type: 'text', text: `Saved asset \`${a.name}\` → reference it in the page as \`${a.url}\`` }],
      structuredContent: a,
    };
  }));

  // ---- book_generate_image (real photographs, generated locally) ----
  server.registerTool('book_generate_image', {
    title: 'Generate a real photo (local)',
    description: 'Generate a PHOTOGRAPH locally (mflux Z-Image-turbo on Apple Silicon — free, private, ~30-60s) and save it straight into the project\'s assets. THE LAW: pages without real imagery read as AI-generated; use this for heroes, product shots, ambience. Write photographic prompts (subject + surface/setting + light + lens/style + palette words matching the page tokens), not illustration prompts. Hero ≈ 1280×832, product square ≈ 1024×1024, tall ≈ 832×1216. Returns the asset URL to use in <img src>. Consult get_skill("art-direction") for per-aesthetic prompt recipes.',
    inputSchema: {
      slug: z.string().describe('Project slug the image belongs to.'),
      prompt: z.string().describe('Photographic prompt — subject, setting, light, style, palette.'),
      name: z.string().optional().describe('Asset filename stem, e.g. "hero-beans" → hero-beans.png.'),
      width: z.number().int().optional().describe('Pixels (default 1280, snapped to /16).'),
      height: z.number().int().optional().describe('Pixels (default 832).'),
      seed: z.number().int().optional().describe('Reproducible seed; omit for random.')
    },
    outputSchema: { asset: z.any(), width: z.number(), height: z.number(), seed: z.number(), ms: z.number() },
    annotations: RW
  }, guard(async ({ slug, prompt, name, width, height, seed }) => {
    const r = await api('POST', '/api/generate-image', { slug, prompt, name, width, height, seed });
    return {
      content: [{ type: 'text', text: `Generated ${r.width}×${r.height} in ${Math.round(r.ms / 1000)}s (seed ${r.seed}) → \`${r.asset.url}\`` }],
      structuredContent: r,
    };
  }));

  // ---- book_autofill_imagery (wireframe → deliverable, one call) ----
  server.registerTool('book_autofill_imagery', {
    title: 'Auto-fill empty media with real photos',
    description: 'Turn a composed WIREFRAME into a real deliverable in one call: finds the empty grey media placeholders, derives an on-aesthetic photographic prompt for each (keyed on the page genre + data-aesthetic), generates real photos locally (mflux), swaps them in, and saves a new revision. Serial + bounded so it never starves foreground work. Pass dryRun:true to preview the slots + prompts WITHOUT generating (free, instant). If mflux is unavailable it returns the plan and skips cleanly. Use after book_compose to clear the imagery deficit fast; refine individual shots with book_generate_image.',
    inputSchema: {
      slug: z.string().describe('Saved page slug to fill.'),
      max: z.number().int().min(1).max(6).optional().describe('Max images to generate (default 3).'),
      dryRun: z.boolean().optional().describe('Preview the slots + prompts without generating (free).')
    },
    outputSchema: { slug: z.string(), filled: z.array(z.any()).optional(), plan: z.array(z.any()).optional(), remaining: z.number().optional(), skipped: z.string().optional(), dryRun: z.boolean().optional(), mfluxAvailable: z.boolean().optional() },
    annotations: RW
  }, guard(async ({ slug, max, dryRun }) => {
    const r = await api('POST', '/api/autofill-imagery', { slug, max, dryRun });
    let text;
    if (r.dryRun) {
      text = [`# Autofill plan for \`${r.slug}\` — ${r.plan.length} slot(s) (${r.remaining} empty total)`,
        ...r.plan.map((p, i) => `${i + 1}. **${p.kind}** (${p.aspect}) — "${p.prompt}"`),
        '', 'Run again without dryRun to generate + swap them in.'].join('\n');
    } else if (r.skipped) {
      text = `# Autofill skipped\n${r.skipped}\n\nPlan (${(r.plan || []).length} slot(s)):\n` + (r.plan || []).map((p, i) => `${i + 1}. ${p.kind} — "${p.prompt}"`).join('\n');
    } else {
      const ok = (r.filled || []).filter((f) => f.swapped);
      text = [`# Filled ${ok.length}/${(r.filled || []).length} slot(s) in \`${r.slug}\` — ${r.remaining} still empty`,
        ...(r.filled || []).map((f) => f.swapped ? `- ✓ ${f.kind} → \`${f.url}\` (${Math.round((f.ms || 0) / 1000)}s)` : `- ✗ ${f.kind}: ${f.error || 'not swapped'}`)].join('\n');
    }
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  // ---- book_view (the agent's eyes — returns the actual image) ----
  server.registerTool('book_view', {
    title: 'View a page (real image)',
    description: 'SEE the page like a user would: renders a saved page (slug) or raw HTML at one device viewport and returns the actual screenshot as an image in this tool result — no shell commands, no file juggling. Use AFTER facts-based verification (book_inspect) when you need to judge visual quality, composition, or taste. fullPage captures the whole document (default true).',
    inputSchema: {
      slug: z.string().optional().describe('Saved page slug (provide slug OR html).'),
      html: z.string().optional().describe('Raw HTML (provide slug OR html).'),
      viewport: z.enum(Object.keys(VIEWPORTS)).optional().describe('Device to view at (default desktop).'),
      fullPage: z.boolean().optional().describe('Capture the entire document height, not just the first screen (default true).')
    },
    outputSchema: { viewport: z.string(), width: z.number(), docHeight: z.number().optional(), screenshotPath: z.string().optional() },
    annotations: RO
  }, guard(async ({ slug, html, viewport, fullPage }) => {
    if (!slug && !html) throw new Error('book_view needs either `slug` or `html`.');
    const body = { viewports: [viewport || 'desktop'], screenshot: true, fullPage: fullPage !== false };
    if (slug) body.slug = slug;
    if (html) body.html = html;
    const r = await api('POST', '/api/inspect', body);
    const rep = (r.reports || [])[0] || {};
    const content = [{
      type: 'text',
      text: `# View: ${slug || '(raw html)'} @ ${rep.viewport} (${rep.width}×${rep.docHeight || rep.height})${rep.hOverflow ? ' — ⚠ horizontal overflow present' : ''}`,
    }];
    if (rep.screenshotPath) {
      try {
        const { readFileSync } = await import('node:fs');
        content.push({ type: 'image', data: readFileSync(rep.screenshotPath).toString('base64'), mimeType: 'image/png' });
      } catch (e) {
        content[0].text += `\n(screenshot file unreadable: ${e.message})`;
      }
    } else {
      content[0].text += '\n(no screenshot produced — is Chrome available on the server?)';
    }
    return { content, structuredContent: { viewport: rep.viewport, width: rep.width, docHeight: rep.docHeight, screenshotPath: rep.screenshotPath } };
  }));

  // ---- book_list_pages ----
  server.registerTool('book_list_pages', {
    title: 'List saved pages',
    description: 'List every saved page in the book (manifests only — slug, title, genre, revisions, timestamps). Cheap; use book_get_page only when you actually need the HTML.',
    inputSchema: {},
    outputSchema: { count: z.number(), pages: z.array(z.any()) },
    annotations: RO
  }, guard(async () => {
    const r = await api('GET', '/api/pages');
    const pages = r.pages || [];
    const text = [
      `# Book — ${pages.length} page${pages.length === 1 ? '' : 's'}`,
      ...pages.map((p) => `- \`${p.slug}\` — ${p.title || '(untitled)'}${p.genre ? ' · ' + p.genre : ''} · rev ${p.revisions ?? 0} · updated ${p.updatedAt || '?'}`)
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { count: pages.length, pages } };
  }));

  // ---- book_get_page ----
  server.registerTool('book_get_page', {
    title: 'Get a saved page',
    description: 'Fetch one saved page: its manifest + full HTML. Token-heavy — prefer book_list_pages for orientation and only pull the HTML you intend to edit. compact:true returns the manifest + byte count only (HTML in structuredContent.html).',
    inputSchema: { slug: z.string().describe('Page slug from book_list_pages.'), compact: z.boolean().optional().describe('Omit the full HTML from the text (kept in structuredContent.html) to save tokens.') },
    outputSchema: { manifest: z.any(), html: z.string() },
    annotations: RO
  }, guard(async ({ slug, compact }) => {
    const r = await api('GET', '/api/pages/' + encodeURIComponent(slug));
    const m = r.manifest || {};
    const text = [
      `# ${m.title || slug} (\`${m.slug || slug}\`)`,
      'Manifest: ' + JSON.stringify(m),
      '',
      compact ? `_HTML: ${Buffer.byteLength(r.html || '')} bytes in structuredContent.html (omitted to save tokens)._` : fenceHtml(r.html || '')
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { manifest: m, html: r.html || '' } };
  }));

  // ---- book_save_page (with save-gate + doom-loop guard) ----
  // Research-derived: Lovable's adherence-scan-with-retry + v0's deterministic
  // autofix gate, enforced where the model can't talk past it; plus the
  // fact-fingerprint loop detector nothing with prose logs can build.
  const gateMemory = new Map(); // gateKey(slug|title) -> [fingerprint, fingerprint…]
  server.registerTool('book_save_page', {
    title: 'Save a page to the book',
    description: 'Save HTML as a page (slug auto-derived from title if omitted; revisions archived server-side). Pass briefId to auto-complete the brief you claimed, and manifest:{genre,platform} so the gate picks the right lens. SAVE-GATE (deterministic, rejected with exact one-step `check → fix` findings): WEB pages are checked for coherence ≥ 70, zero console errors / failed resources, no phone overflow, no undefined CSS vars, no invisible/collapsed content, and the imagery floor on visual-first genres. MOBILE app flows (auto-detected) are instead checked by the HIG lab — safe-area respect, thumb-reach, tap targets, native nav. If the same findings persist twice you will be told to change approach or pass force:true and disclose the violations honestly.',
    inputSchema: {
      slug: z.string().optional().describe('Page slug; derived from title when omitted.'),
      title: z.string().describe('Human page title.'),
      html: z.string().describe('Full self-contained HTML (keep vault-relative hrefs like structure/structure.css).'),
      manifest: z.record(z.any()).optional().describe('Extra manifest fields to persist (genre, theme, sections…).'),
      briefId: z.string().optional().describe('Brief to auto-complete (status→done, pageSlug→this page).'),
      force: z.boolean().optional().describe('Bypass the save-gate (only after a detected loop, and disclose the violations in your summary).')
    },
    outputSchema: { manifest: z.any().optional(), brief: z.any().optional(), briefError: z.string().optional(), rejected: z.boolean().optional(), violations: z.array(z.string()).optional(), findings: z.array(z.any()).optional(), loopDetected: z.boolean().optional() },
    annotations: RW
  }, guard(async ({ slug, title, html, manifest, briefId, force }) => {
    const gateKey = slug || title;
    if (!force) {
      // mobile app flows are gated by the HIG lab; web pages by the diagnose lab
      const isMobile = manifest?.platform === 'mobile' || /class="[^"]*\bapp-flow\b|\bscr-frame\b/.test(html);
      let findings;
      if (isMobile) {
        const [coh, mobOut] = await Promise.all([
          api('POST', '/api/coherence', { html }),
          api('POST', '/api/inspect', { html, mode: 'mobile' }),
        ]);
        findings = gateFindingsMobile(coh, (mobOut.reports || [])[0] || {});
      } else {
        const [coh, diagOut] = await Promise.all([
          api('POST', '/api/coherence', { html }),
          api('POST', '/api/inspect', { html, mode: 'diagnose', viewports: ['iphone-15'] }),
        ]);
        findings = gateFindings(coh, (diagOut.reports || [])[0] || {}, { genre: manifest?.genre, html });
      }
      if (findings.length) {
        const violations = findings.map((f) => f.code); // stable codes for fingerprint + structuredContent
        const history = gateMemory.get(gateKey) || [];
        const fingerprint = findings.map((f) => f.check).sort().join('|');
        const loop = history.length >= 1 && history[history.length - 1] === fingerprint;
        history.push(fingerprint);
        gateMemory.set(gateKey, history);
        const detail = [
          `# SAVE REJECTED — ${findings.length} violation${findings.length === 1 ? '' : 's'}`,
          'Each line is **check: what is wrong → the one-step fix.**',
          ...findings.map((f) => `- **${f.check}**: ${f.cause} → ${f.fix}`),
          loop
            ? '\n⚠ **LOOP DETECTED** — the SAME checks failed across consecutive attempts. STOP patching this approach. Either (a) recompose from a fresh book_compose draft and re-apply only the brief\'s delta, or (b) save with force:true and disclose the unresolved violations in your brief summary.'
            : '\nApply the fixes above and call book_save_page again.'
        ].filter(Boolean).join('\n');
        return { content: [{ type: 'text', text: detail }], structuredContent: { rejected: true, violations, findings, loopDetected: loop } };
      }
      gateMemory.delete(gateKey);
    }
    const body = { title, html };
    if (slug) body.slug = slug;
    if (manifest) body.manifest = manifest;
    const saved = await api('POST', '/api/pages', body);
    const m = saved.manifest || {};
    const lines = [`# Saved: \`${m.slug}\` — ${m.title || title} (rev ${m.revisions ?? 0})`];
    let brief = null, briefError;
    if (briefId) {
      try {
        const r = await api('PUT', '/api/briefs/' + encodeURIComponent(briefId), {
          status: 'done', pageSlug: m.slug, summary: `Saved page "${m.title || title}" (${m.slug})`
        });
        brief = r.brief || r;
        lines.push(`Brief \`${briefId}\` completed → status ${brief.status || 'done'}, pageSlug ${m.slug}.`);
      } catch (err) {
        briefError = err.message;
        lines.push(`Page saved, but completing brief \`${briefId}\` FAILED: ${err.message}. Run book_complete_brief manually.`);
      }
    }
    const sc = { manifest: m };
    if (brief) sc.brief = brief;
    if (briefError) sc.briefError = briefError;
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: sc };
  }));

  // ---- book_briefs ----
  server.registerTool('book_briefs', {
    title: 'List briefs',
    description: 'List the work queue, optionally filtered by status (queued | working | done | error). Each brief: id, text, engine, pageSlug, status, summary.',
    inputSchema: { status: z.enum(['queued', 'working', 'done', 'error']).optional().describe('Filter by status.') },
    outputSchema: { count: z.number(), briefs: z.array(z.any()) },
    annotations: RO
  }, guard(async ({ status }) => {
    const r = await api('GET', '/api/briefs' + (status ? '?status=' + encodeURIComponent(status) : ''));
    let briefs = r.briefs || [];
    if (status) briefs = briefs.filter((b) => b.status === status);
    const text = [
      `# Briefs${status ? ' (' + status + ')' : ''} — ${briefs.length}`,
      briefs.length ? briefs.map(briefLine).join('\n') : '_None._'
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { count: briefs.length, briefs } };
  }));

  // ---- book_claim_brief ----
  server.registerTool('book_claim_brief', {
    title: 'Claim a brief',
    description: 'Claim a queued brief (by id, or the first queued one) → status `working`. Returns the brief text plus the target page\'s manifest for context (never the full HTML — use book_get_page only if you must edit existing markup). Then: book_compose to draft free → book_inspect to verify → book_save_page with briefId.',
    inputSchema: { id: z.string().optional().describe('Brief id to claim; omit to take the first queued brief.') },
    outputSchema: { brief: z.any(), pageManifest: z.any().optional() },
    annotations: RW
  }, guard(async ({ id }) => {
    const all = (await api('GET', '/api/briefs?status=queued')).briefs || [];
    const queued = all.filter((b) => b.status === 'queued');
    const target = id ? queued.find((b) => b.id === id) : queued[0];
    if (!target) throw new Error(id ? `No queued brief with id "${id}".` : 'No queued briefs to claim.');
    const brief = ((await api('PUT', '/api/briefs/' + encodeURIComponent(target.id), { status: 'working' })).brief) || target;
    let pageManifest = null;
    if (brief.pageSlug) {
      try {
        const pages = (await api('GET', '/api/pages')).pages || [];
        pageManifest = pages.find((p) => p.slug === brief.pageSlug) || null;
      } catch {}
    }
    const text = [
      `# Claimed brief \`${brief.id}\` (now working)`,
      `**Brief:** ${brief.text}`,
      brief.engine ? `Engine: ${brief.engine}` : '',
      brief.pageSlug
        ? `**Target page:** \`${brief.pageSlug}\`\nManifest: ${JSON.stringify(pageManifest) || '(not found)'}\n_Fetch its HTML with book_get_page only if the brief requires editing existing markup._`
        : '_No target page — this is a fresh-page brief._',
      '',
      'Next: `book_compose` to draft free → apply only the delta the brief asks for → `book_inspect` to verify on all devices → `book_save_page({…, briefId: "' + brief.id + '"})`.'
    ].filter(Boolean).join('\n');
    const sc = { brief };
    if (pageManifest) sc.pageManifest = pageManifest;
    return { content: [{ type: 'text', text }], structuredContent: sc };
  }));

  // ---- book_complete_brief ----
  server.registerTool('book_complete_brief', {
    title: 'Complete a brief',
    description: 'Mark a brief done with the resulting pageSlug and a one-line summary of what changed. (book_save_page with briefId does this automatically — use this tool when completing without a save.)',
    inputSchema: {
      id: z.string().describe('Brief id.'),
      pageSlug: z.string().optional().describe('Slug of the page that fulfilled the brief.'),
      summary: z.string().optional().describe('One line: what was done.')
    },
    outputSchema: { brief: z.any() },
    annotations: RW
  }, guard(async ({ id, pageSlug, summary }) => {
    const body = { status: 'done' };
    if (pageSlug) body.pageSlug = pageSlug;
    if (summary) body.summary = summary;
    const r = await api('PUT', '/api/briefs/' + encodeURIComponent(id), body);
    const brief = r.brief || r;
    const text = `# Brief \`${id}\` → done${brief.pageSlug ? ' · page `' + brief.pageSlug + '`' : ''}${brief.summary ? '\n' + brief.summary : ''}`;
    return { content: [{ type: 'text', text }], structuredContent: { brief } };
  }));

  // ===== VIDEO (book_video_*) — the compose→critique→refine pattern, for Remotion video =====
  const VIDEO_IN = {
    plan: z.any().optional().describe('A full video plan from book_video_compose (preferred). Omit to compose one from genre.'),
    genre: z.string().optional().describe('Compose a plan for this genre (saas/agency/portfolio/ecommerce/restaurant/startup/blog/landing) when no plan is given.'),
    preset: z.string().optional().describe('Optional taste archetype (else auto-picked, brand-matched to the genre).'),
    aspect: z.enum(['16:9', '1:1', '9:16']).optional().describe('Aspect ratio (default 16:9).'),
    seed: z.number().optional().describe('Vary transitions/archetype deterministically.'),
    pageSlug: z.string().optional().describe('CLONE a saved page into the video — renders the real page screenshot into the ScreenshotShowcase scene and inherits the page genre. The "launch video for this page" flow.'),
  };
  const planBody = (a) => (a.plan ? { plan: a.plan } : { genre: a.genre, preset: a.preset, aspect: a.aspect, seed: a.seed, pageSlug: a.pageSlug });

  server.registerTool('book_video_compose', {
    title: 'Compose a video plan',
    description: 'DRAFT A SAAS-STYLE VIDEO PLAN — free, instant, deterministic, no Chrome, no tokens (the book_compose of video). Emits ordered SCENES (TitleCard/FeatureCard/ScreenshotShowcase/StatBurst/LogoReveal/QuoteCard/BulletList/CTACard) with blessed frame durations + real placeholder copy + a theme whose palette tokens MATCH the page genre (brand-identical video). Pass `pageSlug` to CLONE a real saved page into the video — its screenshot fills the product-showcase scene (the "launch video for this page" flow). Then set scene props/copy/media, verify facts with book_video_inspect, taste with book_video_critique, iterate with book_video_refine, export with book_video_render. The PLAN is the single source of truth — edit the plan JSON, never React.',
    inputSchema: VIDEO_IN,
    outputSchema: { plan: z.any(), coherence: z.any() },
    annotations: RO
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-compose', planBody(args));
    const p = r.plan, c = r.coherence || {};
    const text = [
      `# Video plan: ${p.genre} · ${p.aspect} · ${c.totalSeconds ?? '?'}s · coherence ${c.score ?? '?'}${c.ok ? ' ✓' : ''}`,
      `theme: ${p.preset || '?'} (${(p.theme && p.theme.palette) || 'neutral'})`,
      `scenes (${p.scenes.length}): ${p.scenes.map((s) => `${s.type}@${s.durationInFrames}f`).join(' → ')}`,
      (c.findings && c.findings.length) ? `findings: ${c.findings.map((f) => f.check).join(', ')}` : '',
      'Set scene props/copy then book_video_inspect → book_video_critique → book_video_render. Plan in structuredContent.plan.',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  server.registerTool('book_video_inspect', {
    title: 'Inspect a video (facts)',
    description: 'FACTS before pixels for video: renders one representative frame per scene + returns structured facts (dimensions, fps, per-scene/total duration, render success, missing media) WITHOUT a full encode or a model call. The screenshot-killer for motion — run before book_video_critique. Needs the remotion-studio install (returns {skipped} otherwise).',
    inputSchema: VIDEO_IN,
    outputSchema: { ok: z.boolean().optional(), skipped: z.string().optional(), facts: z.any().optional(), coherence: z.any().optional(), scenes: z.array(z.any()).optional() },
    annotations: RO
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-inspect', planBody(args));
    if (r.skipped) return { content: [{ type: 'text', text: `# Video inspect — skipped\n${r.skipped}` }], structuredContent: r };
    const text = [
      `# Video facts: ${r.facts.dimensions} @${r.facts.fps}fps · ${r.facts.sceneCount} scenes · ${r.facts.totalSeconds}s · coherence ${r.coherence.score}${r.coherence.ok ? ' ✓' : ' ✗'}`,
      ...(r.scenes || []).map((s) => `- ${s.sceneId} (${s.type}) ${s.rendered ? '✓' : '✗ ' + (s.error || 'failed')}${s.missingMedia ? ' · ⚠ no media set' : ''}`),
      (r.coherence.findings || []).length ? `findings: ${r.coherence.findings.map((f) => f.check + '(' + f.severity + ')').join(', ')}` : '',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  server.registerTool('book_video_critique', {
    title: 'Vision taste critique (video)',
    description: 'The TASTE half for video: renders keyframes and a VISION model scores them against a motion/SaaS rubric (composition 35 / motion-craft 30 / originality 20 / copy 15), returning a verdict, looksAiGenerated, the signature moment, and LOCATED per-scene fixes. One vision call (compose/inspect stay free). Run before book_video_refine. Needs remotion-studio + SDK auth.',
    inputSchema: VIDEO_IN,
    outputSchema: { ok: z.boolean().optional(), skipped: z.string().optional(), scores: z.any().optional(), verdict: z.string().optional(), looksAiGenerated: z.boolean().optional(), signatureMoment: z.string().optional(), perScene: z.array(z.any()).optional() },
    annotations: RO
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-critique', planBody(args));
    if (r.skipped) return { content: [{ type: 'text', text: `# Video critique — skipped\n${r.skipped}` }], structuredContent: r };
    const s = r.scores || {};
    const text = [
      `# Video critique: ${s.total ?? '?'}/100${r.looksAiGenerated ? '  · ⚠︎ reads as AI-generated' : ''}`,
      r.verdict ? `> ${r.verdict}` : '',
      `**Scores** — composition ${s.composition}/35 · motion ${s.motion}/30 · originality ${s.originality}/20 · copy ${s.copy}/15`,
      r.signatureMoment ? `\n**Signature moment:** ${r.signatureMoment}` : '',
      (r.perScene && r.perScene.length) ? `\n**Per-scene fixes**\n${r.perScene.map((p) => `- [${p.severity}] ${p.sceneId}: ${p.observe}\n  → ${p.fix}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  server.registerTool('book_video_refine', {
    title: 'Refine a video plan',
    description: 'Apply book_video_critique\'s fixes by REWRITING the plan JSON (scene props, copy, durations, order, theme) — not React. Plans are small so a full rewrite is safe + cheap. Pass `critique` (the result you just got) to skip the internal pre-critique, and/or `instruction` ("punchier opener", "add a pricing beat"). verify:true re-renders + re-critiques for a before→after delta. Returns the improved plan; then book_video_inspect and book_video_render.',
    inputSchema: { ...VIDEO_IN, critique: z.any().optional().describe('A prior book_video_critique result (skips the internal pre-critique).'), instruction: z.string().optional().describe('Specific change to apply on top of the critique.'), verify: z.boolean().optional().describe('Re-critique for a before/after delta (default false).') },
    outputSchema: { ok: z.boolean().optional(), skipped: z.string().optional(), plan: z.any().optional(), coherence: z.any().optional(), delta: z.number().nullable().optional() },
    annotations: RO
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-refine', { ...planBody(args), critique: args.critique, instruction: args.instruction, verify: args.verify });
    if (r.skipped) return { content: [{ type: 'text', text: `# Video refine — skipped\n${r.skipped}` }], structuredContent: r };
    const text = [
      (r.delta != null) ? `# Video refine: ${(r.before && r.before.total) ?? '?'} → ${(r.after && r.after.total) ?? '?'}/100 (${r.delta >= 0 ? '+' : ''}${r.delta})` : '# Video refine complete',
      r.coherence ? `coherence ${r.coherence.score}${r.coherence.ok ? ' ✓' : ''}` : '',
      r.plan ? `scenes: ${r.plan.scenes.map((s) => s.type).join(' → ')}` : '',
      'Improved plan in structuredContent.plan — verify with book_video_inspect, then book_video_render.',
    ].filter(Boolean).join('\n');
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  server.registerTool('book_video_render', {
    title: 'Render the video (MP4)',
    description: 'Render the plan to a production MP4 (h264 / crf18 / yuv420p) via Remotion — deterministic, no model, just slow (~1-5× realtime; a 16s video ≈ 1-3 min). Saves the file + returns its URL; progress streams over SSE. Needs remotion-studio (returns {skipped} otherwise). Render only after the plan looks right via book_video_critique.',
    inputSchema: { ...VIDEO_IN, slug: z.string().optional().describe('Name for the output file.') },
    outputSchema: { ok: z.boolean().optional(), skipped: z.string().optional(), url: z.string().optional(), bytes: z.number().optional(), dimensions: z.string().optional() },
    annotations: RW
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-render', { ...planBody(args), slug: args.slug });
    if (r.skipped) return { content: [{ type: 'text', text: `# Video render — skipped\n${r.skipped}` }], structuredContent: r };
    const text = `# Rendered ✓ ${r.dimensions} · ${(r.bytes / 1e6).toFixed(1)}MB · ${r.durationFrames}f\n${r.url}`;
    return { content: [{ type: 'text', text }], structuredContent: r };
  }));

  server.registerTool('book_video_view', {
    title: 'View a video scene (real image)',
    description: 'SEE a rendered keyframe as an image in this result — judge composition/taste yourself. Renders the plan and returns one scene\'s keyframe (sceneId, else the opener) inline. Use after book_video_inspect facts. Needs remotion-studio.',
    inputSchema: { ...VIDEO_IN, sceneId: z.string().optional().describe('Which scene to view (else the first).') },
    outputSchema: { sceneId: z.string().optional(), url: z.string().optional() },
    annotations: RO
  }, guard(async (args) => {
    const r = await api('POST', '/api/video-inspect', planBody(args));
    if (r.skipped) return { content: [{ type: 'text', text: `# Video view — skipped\n${r.skipped}` }], structuredContent: r };
    const scenes = r.scenes || [];
    const pick = (args.sceneId && scenes.find((s) => s.sceneId === args.sceneId)) || scenes.find((s) => s.rendered) || scenes[0];
    const content = [{ type: 'text', text: `# Video scene: ${pick ? pick.sceneId + ' (' + pick.type + ')' : '(none)'}` }];
    if (pick && pick.url) {
      try {
        const imgRes = await fetch(BASE + pick.url);
        content.push({ type: 'image', data: Buffer.from(await imgRes.arrayBuffer()).toString('base64'), mimeType: 'image/png' });
      } catch (e) { content.push({ type: 'text', text: `(could not load image: ${e.message})` }); }
    }
    return { content, structuredContent: { sceneId: pick && pick.sceneId, url: pick && pick.url } };
  }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[designbook-mcp] bridging stdio ↔ ${BASE}\n`);
}

// Only start the server when run directly (so tests can import helpers).
const invokedDirectly = process.argv[1] && (() => {
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();
if (invokedDirectly) {
  main().catch((err) => { process.stderr.write(`[designbook-mcp] Fatal: ${err.stack || err.message}\n`); process.exit(1); });
}
