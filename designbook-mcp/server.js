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

   Tools (names locked by ARCHITECTURE.md):
     book_overview · book_meta · book_compose · book_coherence
     book_inspect · book_list_pages · book_get_page · book_save_page
     book_briefs · book_claim_brief · book_complete_brief
   ============================================ */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';

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

function coherenceLine(c) {
  if (!c) return '';
  const counts = c.counts && Object.keys(c.counts).length
    ? ' (' + Object.entries(c.counts).map(([k, v]) => `${k}:${v}`).join(' · ') + ')'
    : '';
  return `Coherence: ${c.score}/100${counts}`;
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

function renderReport(r) {
  if (r.mode === 'mobile' || Array.isArray(r.screens)) return renderMobileReport(r);
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
  '2. `book_compose({genre, preset?, …})` — draft deterministically. FREE and instant; never hand-write a scaffold.',
  '3. Apply only the delta the brief asks for to the composed HTML.',
  '4. `book_inspect({html, viewports?})` — verify with structured facts across devices (no screenshots needed).',
  '5. `book_save_page({title, html, briefId})` — saves the page AND auto-completes the brief.'
].join('\n');

// =====================================================
// Server setup
// =====================================================
async function main() {
  const server = new McpServer({ name: 'designbook', version: '1.0.0' });
  const RO = { readOnlyHint: true, openWorldHint: false };
  const RW = { readOnlyHint: false, openWorldHint: false };

  // ---- book_overview ----
  server.registerTool('book_overview', {
    title: 'Design Book overview',
    description: 'One-call orientation: what the book is, vault stats, queued brief count, and the brief workflow. Call this first. Efficiency contract: draft with book_compose first — deterministic and free. Verify with book_inspect facts. Spend model effort only on the delta the brief asks for.',
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
    description: 'Deterministically compose a draft for a genre (+ optional preset/taste axes/seed). DRAFT HERE FIRST — free, instant, zero tokens. platform "web" (default) = one scrolling page of sections; platform "mobile" = an app screen FLOW (phones) from the .scr-* shells (see get_skill("mobile-design")). Then spend model effort only on the brief\'s delta, verify with book_inspect, save with book_save_page.',
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
      seed: z.number().int().min(0).optional().describe('Variety seed — rotates per-slot/per-screen picks. 0 = house picks.')
    },
    outputSchema: {
      platform: z.string().optional(), theme: z.record(z.string()),
      sections: z.array(z.any()).optional(), screens: z.array(z.any()).optional(),
      coherence: z.any(), warnings: z.array(z.any()), html: z.string()
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
      r.warnings && r.warnings.length ? '**Warnings:** ' + r.warnings.join(' · ') : '',
      '',
      mobile ? '**Screen manifest (real mobile/ components to wire in):**' : '**Section manifest (real snippets to wire in):**',
      ...manifest,
      '',
      fenceHtml(r.html)
    ].filter((l) => l !== '').join('\n');
    return {
      content: [{ type: 'text', text }],
      structuredContent: { platform: r.platform, theme: t, sections: r.sections, screens: r.screens, coherence: r.coherence || null, warnings: r.warnings || [], html: r.html }
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

  // ---- book_inspect ----
  server.registerTool('book_inspect', {
    title: 'Inspect across viewports',
    description: 'The screenshot killer: render a saved page (slug) or raw HTML in headless Chrome at named viewports and return STRUCTURED LAYOUT FACTS — overflow, small tap targets, tiny text, offscreen content, landmarks, counts. Facts are the default verification; set screenshot:true only when pixels are explicitly needed. Default viewports: iphone-15, ipad, desktop.',
    inputSchema: {
      slug: z.string().optional().describe('Saved page slug to inspect (provide slug OR html).'),
      html: z.string().optional().describe('Raw HTML to inspect (provide slug OR html).'),
      viewports: z.array(z.string()).optional().describe('Named viewports: iphone-se, iphone-15, iphone-15-max, ipad, ipad-landscape, laptop, desktop, desktop-xl.'),
      mode: z.enum(['layout', 'perf', 'diagnose', 'element', 'mobile']).optional().describe('layout = fit facts (default) · perf = lag diagnostics (lagScore, reflow/recalc cost, census) · diagnose = full common-issues audit (console errors, 404s, contrast, a11y, undefined vars) · element = point DevTools for one selector (box, computed, parents, overlaps) · mobile = HIG facts for a composed app flow (per-screen safe-area respect, thumb-reach of primary actions, tap targets ≥44pt, native nav conventions). Use mobile mode on compose({platform:"mobile"}) output.'),
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

  // ---- book_view (the agent's eyes — returns the actual image) ----
  server.registerTool('book_view', {
    title: 'View a page (real image)',
    description: 'SEE the page like a user would: renders a saved page (slug) or raw HTML at one device viewport and returns the actual screenshot as an image in this tool result — no shell commands, no file juggling. Use AFTER facts-based verification (book_inspect) when you need to judge visual quality, composition, or taste. fullPage captures the whole document (default true).',
    inputSchema: {
      slug: z.string().optional().describe('Saved page slug (provide slug OR html).'),
      html: z.string().optional().describe('Raw HTML (provide slug OR html).'),
      viewport: z.enum(['iphone-se', 'iphone-15', 'iphone-15-max', 'ipad', 'ipad-landscape', 'laptop', 'desktop', 'desktop-xl']).optional().describe('Device to view at (default desktop).'),
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
    description: 'Fetch one saved page: its manifest + full HTML. Token-heavy — prefer book_list_pages for orientation and only pull the HTML you intend to edit.',
    inputSchema: { slug: z.string().describe('Page slug from book_list_pages.') },
    outputSchema: { manifest: z.any(), html: z.string() },
    annotations: RO
  }, guard(async ({ slug }) => {
    const r = await api('GET', '/api/pages/' + encodeURIComponent(slug));
    const m = r.manifest || {};
    const text = [
      `# ${m.title || slug} (\`${m.slug || slug}\`)`,
      'Manifest: ' + JSON.stringify(m),
      '',
      fenceHtml(r.html || '')
    ].join('\n');
    return { content: [{ type: 'text', text }], structuredContent: { manifest: m, html: r.html || '' } };
  }));

  // ---- book_save_page (with save-gate + doom-loop guard) ----
  // Research-derived: Lovable's adherence-scan-with-retry + v0's deterministic
  // autofix gate, enforced where the model can't talk past it; plus the
  // fact-fingerprint loop detector nothing with prose logs can build.
  const gateMemory = new Map(); // gateKey(slug|title) -> [fingerprint, fingerprint…]
  function gateFindings(coh, diag) {
    const violations = [];
    if ((coh?.score ?? 100) < 70) violations.push(`coherence:${coh.score}`);
    const errs = (diag?.console || []).filter((c) => c.level === 'error');
    if (errs.length) violations.push(`console-errors:${errs.length}`);
    if ((diag?.resources || []).length) violations.push(`failed-resources:${diag.resources.length}`);
    if (diag?.layout?.hOverflow) violations.push('hOverflow@iphone-15');
    if ((diag?.css?.undefinedVars || []).length) violations.push(`undefined-vars:${diag.css.undefinedVars.join(',')}`);
    return violations;
  }
  server.registerTool('book_save_page', {
    title: 'Save a page to the book',
    description: 'Save HTML as a page (slug auto-derived from title if omitted; revisions archived server-side). Pass briefId to auto-complete the brief you claimed — the one-call finish for the brief workflow. SAVE-GATE: the save is validated deterministically first (coherence ≥ 70, zero console errors / failed resources, no phone overflow, no undefined CSS vars) and REJECTED with the exact findings if it fails — fix them and retry. If the same findings persist twice, you will be told to change approach or pass force:true and report the violations honestly.',
    inputSchema: {
      slug: z.string().optional().describe('Page slug; derived from title when omitted.'),
      title: z.string().describe('Human page title.'),
      html: z.string().describe('Full self-contained HTML (keep vault-relative hrefs like structure/structure.css).'),
      manifest: z.record(z.any()).optional().describe('Extra manifest fields to persist (genre, theme, sections…).'),
      briefId: z.string().optional().describe('Brief to auto-complete (status→done, pageSlug→this page).'),
      force: z.boolean().optional().describe('Bypass the save-gate (only after a detected loop, and disclose the violations in your summary).')
    },
    outputSchema: { manifest: z.any().optional(), brief: z.any().optional(), briefError: z.string().optional(), rejected: z.boolean().optional(), violations: z.array(z.string()).optional(), loopDetected: z.boolean().optional() },
    annotations: RW
  }, guard(async ({ slug, title, html, manifest, briefId, force }) => {
    const gateKey = slug || title;
    if (!force) {
      const [coh, diagOut] = await Promise.all([
        api('POST', '/api/coherence', { html }),
        api('POST', '/api/inspect', { html, mode: 'diagnose', viewports: ['iphone-15'] }),
      ]);
      const diag = (diagOut.reports || [])[0] || {};
      const violations = gateFindings(coh, diag);
      if (violations.length) {
        const history = gateMemory.get(gateKey) || [];
        const fingerprint = violations.map((v) => v.split(':')[0]).sort().join('|');
        const loop = history.length >= 1 && history[history.length - 1] === fingerprint;
        history.push(fingerprint);
        gateMemory.set(gateKey, history);
        const detail = [
          `# SAVE REJECTED — ${violations.length} violation${violations.length === 1 ? '' : 's'}`,
          ...violations.map((v) => `- ${v}`),
          coh?.warnings?.length ? '\nCoherence hints:\n' + coh.warnings.map((w) => `- ${w.type}: ${w.hint}`).join('\n') : '',
          diag?.layout?.overflowers?.length ? '\nOverflowers (iphone-15):\n' + diag.layout.overflowers.slice(0, 5).map((o) => `- ${o.sel}`).join('\n') : '',
          (diag?.console || []).slice(0, 5).map((c) => `- console.${c.level}: ${c.message}`).join('\n'),
          loop
            ? '\n⚠ **LOOP DETECTED** — the SAME violations persisted across consecutive attempts. STOP patching this approach. Either (a) recompose from a fresh book_compose draft and re-apply only the brief\'s delta, or (b) save with force:true and disclose the unresolved violations in your brief summary.'
            : '\nFix the findings above and call book_save_page again.'
        ].filter(Boolean).join('\n');
        return { content: [{ type: 'text', text: detail }], structuredContent: { rejected: true, violations, loopDetected: loop } };
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
