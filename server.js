#!/usr/bin/env node
/* ============================================
   designbook · server.js — the app server
   ============================================
   Zero-dep node:http server: JSON API + SSE + static mounts. Layer 0 of the
   architecture — every deterministic capability lives here; both engines and
   the UI consume the same endpoints. See ARCHITECTURE.md for the contract.

   Run:  node server.js   (PORT=4747, FRONTENDMAXXING_PATH to override vault)
   ============================================ */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVault, injectBase } from './lib/vault.js';
import { createBook, slugify } from './lib/book.js';
import { inspect, VIEWPORTS, DEFAULT_VIEWPORTS } from './lib/inspect.js';
import { critique } from './lib/critique.js';
import { refine } from './lib/refine.js';
import { defaultArchetype } from './lib/archetypes.js';
import { parseIntent } from './lib/intent.js';
import { zipStore } from './lib/zip.js';
import { buildFlowHandoff, isMobileHtml } from './lib/handoff.js';
import { exportPptx } from './lib/pptx.js';
import { checkLottie } from './lib/lottie.js';
import { tmpdir } from 'node:os';
import { autofix } from './lib/autofix.js';
import { findImagerySlots, derivePrompt, aspectToSize, imgTag, swapFirst, readAesthetic } from './lib/autofill.js';
import { generateImage, findMflux } from './lib/imagegen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4747);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function send(res, code, body, type) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type || 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}
function err(res, code, message) { send(res, code, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 32 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// static file serving with traversal guard
function serveStatic(res, rootDir, relPath, { baseHref } = {}) {
  const safe = normalize(relPath).replace(/^([/\\])+|\.\.(?=[/\\]|$)/g, '');
  let p = join(rootDir, safe);
  if (!p.startsWith(rootDir)) return err(res, 403, 'forbidden');
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p) || !statSync(p).isFile()) return err(res, 404, 'not found: ' + relPath);
  const type = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
  let body = readFileSync(p);
  if (baseHref && type.startsWith('text/html')) body = injectBase(body.toString('utf8'), baseHref);
  send(res, 200, body, type);
}

async function main() {
  const vault = await loadVault();
  const book = createBook(__dirname);

  // ---- SSE ----
  const sseClients = new Set();
  const broadcast = (evt) => {
    const line = `data: ${JSON.stringify(evt)}\n\n`;
    for (const res of sseClients) { try { res.write(line); } catch { sseClients.delete(res); } }
  };
  book.onChange(broadcast);

  function composeWithScore(body) {
    const opts = {
      genre: body.genre, preset: body.preset, palette: body.palette,
      aesthetic: body.aesthetic, density: body.density, motion: body.motion,
      fontPair: body.fontPair || body.font_pair, seed: body.seed,
    };
    // floor-raiser: a bare compose (no taste direction) gets a curated genre
    // archetype instead of the composer's generic saas-indigo/minimal default.
    // An explicit preset/aesthetic/palette always wins.
    if (!opts.preset && !opts.aesthetic && !opts.palette) {
      opts.preset = defaultArchetype(opts.genre, opts.seed);
    }
    if (body.platform === 'mobile') {
      const r = vault.composeApp(opts);
      const { html, fixed } = autofix(r.html);
      const c = vault.coherence(html);
      return { platform: 'mobile', html, theme: r.theme, screens: r.screens, warnings: r.warnings, autofixed: fixed, coherence: { score: c.score, counts: c.counts, authenticity: c.authenticity } };
    }
    if (body.platform === 'deck') {
      const r = vault.composeDeck(opts);
      const { html, fixed } = autofix(r.html);
      const c = vault.coherence(html);
      return { platform: 'deck', html, theme: r.theme, slides: r.slides, warnings: r.warnings, autofixed: fixed, coherence: { score: c.score, counts: c.counts, authenticity: c.authenticity } };
    }
    const r = vault.compose(opts);
    // self-heal at source so the agent never inherits a blank/inaccessible draft
    const { html, fixed } = autofix(r.html);
    const c = vault.coherence(html);
    return { platform: 'web', html, theme: r.theme, sections: r.sections, warnings: r.warnings, autofixed: fixed, coherence: { score: c.score, counts: c.counts, authenticity: c.authenticity } };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method;

    try {
      // ===== API =====
      if (path === '/api/health') {
        return send(res, 200, { ok: true, vault: vault.root, snippets: vault.entries.length, palettes: vault.palettes.length, presets: vault.presets.presets.length, hasKey: !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY), auth: process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription' : process.env.ANTHROPIC_API_KEY ? 'api-key' : null, baseUrl: process.env.ANTHROPIC_BASE_URL || null });
      }
      if (path === '/api/meta') {
        return send(res, 200, {
          genres: vault.genres,
          mobileGenres: vault.mobileGenres,
          presets: vault.presets.presets.map((p) => ({ name: p.name, label: p.label, aesthetic: p.aesthetic, palette: p.palette, fontPair: p.fontPair, motion: p.motion, density: p.density, summary: p.summary })),
          palettes: vault.palettes.map((p) => ({ name: p.name, mode: p.mode, group: p.group, accent: p.tokens.accent, bg: p.tokens.bg })),
          aesthetics: vault.aesthetics, densities: vault.densities, motions: vault.motions, fontPairs: vault.fontPairs,
          viewports: Object.entries(VIEWPORTS).map(([name, v]) => ({ name, ...v })), defaultViewports: DEFAULT_VIEWPORTS,
          settings: book.getSettings(),
        });
      }
      if (path === '/api/compose' && method === 'POST') {
        const body = await readBody(req);
        if (!body.genre) return err(res, 400, 'genre required');
        return send(res, 200, composeWithScore(body));
      }
      if (path === '/api/variants' && method === 'POST') {
        const body = await readBody(req);
        if (!body.genre) return err(res, 400, 'genre required');
        const seeds = Array.isArray(body.seeds) && body.seeds.length ? body.seeds : [0, 1, 2];
        const variants = seeds.map((seed) => {
          const v = composeWithScore({ ...body, ...(body.overrides || {}), seed });
          return { seed, html: v.html, theme: v.theme, coherence: v.coherence };
        });
        return send(res, 200, { variants });
      }
      if (path === '/api/coherence' && method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, vault.coherence(String(body.html || '')));
      }
      if (path === '/api/search') {
        const q = url.searchParams.get('q') || '';
        const limit = Math.min(Number(url.searchParams.get('limit')) || 10, 30);
        const hits = vault.search(q, limit).map(({ entry, score }) => ({ path: entry.path, score, description: entry.desc, global: entry.global || undefined }));
        return send(res, 200, { hits });
      }
      if (path === '/api/snippet') {
        const p = url.searchParams.get('path') || '';
        const source = vault.snippetSource(p);
        if (source == null) return err(res, 404, 'not in INDEX: ' + p);
        return send(res, 200, { path: p, source });
      }

      // pages
      if (path === '/api/pages' && method === 'GET') return send(res, 200, { pages: book.listPages() });
      if (path === '/api/pages' && method === 'POST') {
        const body = await readBody(req);
        if (!body.html) return err(res, 400, 'html required');
        if (!body.title && !body.slug) return err(res, 400, 'title or slug required');
        return send(res, 200, { manifest: book.savePage(body) });
      }
      const pageMatch = path.match(/^\/api\/pages\/([a-z0-9-]+)$/);
      if (pageMatch) {
        const slug = pageMatch[1];
        if (method === 'GET') {
          const page = book.getPage(slug);
          return page ? send(res, 200, page) : err(res, 404, 'no page: ' + slug);
        }
        if (method === 'PUT') {
          const body = await readBody(req);
          const m = book.updatePage(slug, body);
          return m ? send(res, 200, { manifest: m }) : err(res, 404, 'no page: ' + slug);
        }
        if (method === 'DELETE') {
          return book.deletePage(slug) ? send(res, 200, { ok: true }) : err(res, 404, 'no page: ' + slug);
        }
      }

      // briefs
      if (path === '/api/briefs' && method === 'GET') {
        return send(res, 200, { briefs: book.listBriefs(url.searchParams.get('status') || undefined) });
      }
      if (path === '/api/briefs' && method === 'POST') {
        const body = await readBody(req);
        // Chat → deterministic action (lib/intent.js). Taste-only messages
        // resolve instantly (kind 'taste', already done); genre/taste messages
        // get a free deterministic draft attached; everything else queues for
        // the model engine untouched.
        const intent = parseIntent(body.text, vault, body.context || {});
        const extra = {};
        if (intent.smalltalk) {
          extra.kind = 'chat';
        } else if (intent.tasteOnly) {
          extra.kind = 'taste';
          extra.taste = { ...intent.taste, ...(intent.preset ? { preset: intent.preset } : {}) };
        } else if (intent.draft) {
          const seedBase = Math.abs([...String(body.text)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) % 50;
          extra.draft = { genre: intent.draft.genre, preset: intent.draft.preset || null, seedBase, taste: intent.taste };
        } else if (intent.edit && body.slug) {
          extra.kind = 'edit';                 // the iteration loop: one book_refine call on the focused page
          extra.instruction = intent.instruction;
        }
        const brief = book.addBrief({ ...body, ...extra });
        if (brief.kind === 'taste') {
          book.updateBrief(brief.id, { status: 'done', summary: 'Re-themed instantly — 0 tokens.' });
          brief.status = 'done';
        } else if (brief.kind === 'chat') {
          book.updateBrief(brief.id, { status: 'done', summary: intent.smalltalk });
          brief.status = 'done';
          brief.summary = intent.smalltalk;
        } else if (brief.kind === 'edit') {
          // the iteration loop: ONE book_refine call on the focused page, saved in
          // place — cheaper + faster than the 40-turn agent for a tweak.
          const page = book.getPage(slugify(body.slug));
          if (!page) {
            book.updateBrief(brief.id, { status: 'error', summary: 'no page: ' + body.slug });
            brief.status = 'error'; brief.summary = 'no page to edit';
          } else {
            const out = await refine({
              html: page.html, instruction: intent.instruction,
              vaultRoot: vault.root, bookDir: book.dir, shotsDir: book.shotsDir,
              model: (book.getSettings().sdk || {}).model || 'claude-sonnet-4-6',
            });
            if (out.ok && out.html) {
              book.savePage({ slug: page.manifest.slug, title: page.manifest.title, html: out.html, manifest: page.manifest });
              const sum = (out.changes && out.changes.length) ? out.changes.slice(0, 3).join('; ') : 'applied your edit';
              book.updateBrief(brief.id, { status: 'done', summary: sum.slice(0, 400) });
              brief.status = 'done'; brief.summary = sum.slice(0, 400);
            } else {
              const e = out.error || 'edit failed';
              book.updateBrief(brief.id, { status: 'error', summary: e });
              brief.status = 'error'; brief.summary = e;
            }
          }
        }
        return send(res, 200, { brief });
      }
      // chat → the human-in-the-loop iteration loop. A tweak or re-theme on the
      // page already on screen is ONE book_refine call (~15-40s); smalltalk is an
      // instant reply; fresh builds + anything ambiguous fall through to the full
      // SDK agent (the model decides everything, over the designbook MCP tools).
      // Returns { brief, needsSetup? } — needsSetup carries setup instructions when
      // no engine is available, so the UI can render a setup card.
      if (path === '/api/chat' && method === 'POST') {
        const body = await readBody(req);
        if (!body.text || !String(body.text).trim()) return err(res, 400, 'text required');
        if (body.model) book.setSettings({ sdk: { ...(book.getSettings().sdk || {}), model: body.model } });

        // -- fast path: smalltalk reply + single-call edits/re-themes on the focused doc --
        const intent = parseIntent(body.text, vault, { hasDoc: !!body.slug });
        if (intent.smalltalk) {
          const b = book.addBrief({ text: body.text, engine: 'chat', kind: 'chat', pageSlug: body.slug || null });
          book.updateBrief(b.id, { status: 'done', summary: intent.smalltalk });
          return send(res, 200, { brief: book.listBriefs().find((x) => x.id === b.id) });
        }
        if (body.slug && (intent.edit || intent.tasteOnly)) {
          const page = book.getPage(slugify(body.slug));
          if (page) {
            const b = book.addBrief({ text: body.text, engine: 'edit', kind: 'edit', pageSlug: page.manifest.slug });
            const out = await refine({
              html: page.html, instruction: body.text,
              vaultRoot: vault.root, bookDir: book.dir, shotsDir: book.shotsDir,
              model: (book.getSettings().sdk || {}).model || 'claude-sonnet-4-6',
            });
            if (out.ok && out.html) {
              book.savePage({ slug: page.manifest.slug, title: page.manifest.title, html: out.html, manifest: page.manifest });
              const sum = (out.changes && out.changes.length) ? out.changes.slice(0, 3).join('; ') : 'applied your edit';
              book.updateBrief(b.id, { status: 'done', summary: sum.slice(0, 400) });
            } else {
              book.updateBrief(b.id, { status: 'error', summary: out.error || 'edit failed' });
            }
            return send(res, 200, { brief: book.listBriefs().find((x) => x.id === b.id) });
          }
        }

        const brief = book.addBrief({ text: body.text, engine: 'sdk', kind: 'agent', pageSlug: body.slug || null });
        let engine;
        try { engine = await import('./engines/sdk.js'); }
        catch {
          book.updateBrief(brief.id, { status: 'error', summary: 'Agent SDK not installed.' });
          return send(res, 200, { brief: book.listBriefs().find((b) => b.id === brief.id), needsSetup: 'Run `npm install` in designbook/ and set ANTHROPIC_API_KEY, then restart the server.' });
        }
        const result = await engine.runBrief(brief, { book, vault, port: PORT });
        if (result.error && /KEY|not installed/i.test(result.error)) {
          return send(res, 200, { brief: book.listBriefs().find((b) => b.id === brief.id), needsSetup: result.error + ' — set ANTHROPIC_API_KEY (uses your subscription’s SDK credit pool) and restart, or connect a Claude Code session to the designbook MCP server.' });
        }
        return send(res, 200, { brief: book.listBriefs().find((b) => b.id === brief.id) });
      }

      // project assets: the agent's drawings (svg, ascii, css, small images)
      const assetMatch = path.match(/^\/api\/pages\/([a-z0-9-]+)\/assets$/);
      if (assetMatch && method === 'GET') {
        return send(res, 200, { assets: book.listAssets(assetMatch[1]) });
      }
      if (assetMatch && method === 'POST') {
        const body = await readBody(req);
        if (!body.name || body.content === undefined) return err(res, 400, 'name and content required');
        try {
          const saved = book.saveAsset(assetMatch[1], body.name, body.content, { base64: body.encoding === 'base64' });
          return send(res, 200, { asset: saved });
        } catch (e) { return err(res, 400, e.message); }
      }

      // design-files tree for a project: index.html + the vault assets it links
      const filesMatch = path.match(/^\/api\/pages\/([a-z0-9-]+)\/files$/);
      if (filesMatch && method === 'GET') {
        const page = book.getPage(filesMatch[1]);
        if (!page) return err(res, 404, 'no page: ' + filesMatch[1]);
        const assets = [];
        const seen = new Set();
        const re = /(?:<link[^>]*href|<script[^>]*src)=["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(page.html))) {
          const href = m[1];
          if (/^https?:|^data:/i.test(href)) continue;
          const rel = href.replace(/^\/vault\//, '').replace(/^\.?\//, '');
          if (seen.has(rel)) continue;
          seen.add(rel);
          try {
            const st = statSync(join(vault.root, rel));
            assets.push({ name: rel.split('/').pop(), vaultPath: rel, size: st.size });
          } catch { assets.push({ name: rel.split('/').pop(), vaultPath: rel, size: 0, missing: true }); }
        }
        return send(res, 200, {
          slug: page.manifest.slug,
          files: [{ name: 'index.html', size: Buffer.byteLength(page.html), modified: page.manifest.updatedAt }],
          assets,
          projectAssets: book.listAssets(page.manifest.slug),
          revisions: page.manifest.revisions || 0,
        });
      }

      // Share: a ZIP of the design files — <slug>/index.html + <slug>/assets/*
      // (links rewritten to ./assets/…), exactly the folder a developer expects.
      if (path === '/api/export.zip' && method === 'GET') {
        const slug = url.searchParams.get('slug');
        const page = slug && book.getPage(slugify(slug));
        if (!page) return err(res, 404, 'no page: ' + slug);
        let html = page.html.replace(/<base[^>]*>\s*/gi, '');
        const entries = [];
        const added = new Set();
        const slugName = page.manifest.slug;
        // project assets first (the agent's own drawings) — /book/…/assets/x → assets/x
        for (const a of book.listAssets(slugName)) {
          entries.push({ name: `${slugName}/assets/${a.name}`, data: readFileSync(book.assetPath(slugName, a.name)) });
          added.add(a.name);
        }
        html = html.split(`/book/pages/${slugName}/assets/`).join('assets/');
        // vault dependencies → assets/<flattened>
        html = html.replace(/((?:<link[^>]*href|<script[^>]*src)=["'])([^"']+)(["'])/gi, (full, pre, href, post) => {
          if (/^https?:|^data:|^assets\//i.test(href)) return full;
          const rel = href.replace(/^\/vault\//, '').replace(/^\.?\//, '');
          const flat = rel.replace(/\//g, '-');
          if (!added.has(flat)) {
            try {
              entries.push({ name: `${slugName}/assets/${flat}`, data: readFileSync(join(vault.root, rel)) });
              added.add(flat);
            } catch { return full; }
          }
          return `${pre}assets/${flat}${post}`;
        });
        entries.unshift({ name: `${slugName}/index.html`, data: html });
        // mobile designs ship a developer handoff (flow + tokens + device geometry)
        if (page.manifest.platform === 'mobile' || isMobileHtml(page.html)) {
          entries.push({
            name: `${slugName}/FLOW.md`,
            data: buildFlowHandoff({ html: page.html, manifest: page.manifest, palettes: vault.palettes }),
          });
        }
        const zip = zipStore(entries);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${page.manifest.slug}.zip"`,
          'Content-Length': zip.length,
        });
        return res.end(zip);
      }

      // deck → editable .pptx (python-pptx sidecar). Degrades to {skipped} when the
      // venv is absent — never 500s on a missing optional dep.
      if (path === '/api/export-pptx' && method === 'POST') {
        const body = await readBody(req);
        let html = body.html;
        const name = slugify(body.slug || body.name || 'deck');
        if (!html && body.slug) {
          const page = book.getPage(slugify(body.slug));
          if (!page) return err(res, 404, 'no page: ' + body.slug);
          html = page.html;
        }
        if (!html) return err(res, 400, 'html or slug required');
        const out = join(tmpdir(), name + '.pptx');
        const r = exportPptx(String(html).replace(/<base[^>]*>\s*/gi, ''), out);
        return send(res, (r.ok || r.skipped) ? 200 : 500, r);
      }

      // validate + preview Lottie JSON (render-truth for animations)
      if (path === '/api/lottie-check' && method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, checkLottie(body));
      }

      // single-file export: inline every vault-relative <link>/<script> so the
      // page is portable anywhere (http(s) urls left alone)
      if (path === '/api/export' && method === 'POST') {
        const body = await readBody(req);
        let html = body.html;
        if (!html && body.slug) {
          const page = book.getPage(slugify(body.slug));
          if (!page) return err(res, 404, 'no page: ' + body.slug);
          html = page.html;
        }
        if (!html) return err(res, 400, 'html or slug required');
        html = String(html).replace(/<base[^>]*>\s*/gi, '');
        html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
          const m = tag.match(/href=["']([^"']+)["']/i);
          if (!m || /^https?:/i.test(m[1])) return tag;
          const rel = m[1].replace(/^\/vault\//, '').replace(/^\.?\//, '');
          try { return '<style>\n' + readFileSync(join(vault.root, rel), 'utf8') + '\n</style>'; } catch { return tag; }
        });
        html = html.replace(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
          if (/^https?:/i.test(src)) return tag;
          const rel = src.replace(/^\/vault\//, '').replace(/^\.?\//, '');
          try { return '<script>\n' + readFileSync(join(vault.root, rel), 'utf8') + '\n</script>'; } catch { return tag; }
        });
        return send(res, 200, { html, bytes: Buffer.byteLength(html) });
      }
      const briefMatch = path.match(/^\/api\/briefs\/([a-z0-9-]+)$/);
      if (briefMatch && method === 'PUT') {
        const body = await readBody(req);
        const b = book.updateBrief(briefMatch[1], body);
        return b ? send(res, 200, { brief: b }) : err(res, 404, 'no brief: ' + briefMatch[1]);
      }
      if (briefMatch && method === 'DELETE') {
        return book.deleteBrief(briefMatch[1]) ? send(res, 200, { ok: true }) : err(res, 404, 'no brief: ' + briefMatch[1]);
      }

      // settings
      if (path === '/api/settings' && method === 'GET') return send(res, 200, book.getSettings());
      if (path === '/api/settings' && method === 'PUT') {
        const body = await readBody(req);
        return send(res, 200, book.setSettings(body));
      }

      // SDK engine
      if (path === '/api/generate' && method === 'POST') {
        const body = await readBody(req);
        const brief = book.listBriefs().find((b) => b.id === body.briefId);
        if (!brief) return err(res, 404, 'no brief: ' + body.briefId);
        let engine;
        try { engine = await import('./engines/sdk.js'); }
        catch { return err(res, 501, 'SDK engine not installed. Run: npm install (and set ANTHROPIC_API_KEY).'); }
        const result = await engine.runBrief(brief, { book, vault, port: PORT });
        return send(res, result.error ? 502 : 200, result);
      }

      // local photo generation → saved straight into the project's assets
      if (path === '/api/generate-image' && method === 'POST') {
        const body = await readBody(req);
        if (!body.slug) return err(res, 400, 'slug required (images are project assets)');
        if (!body.prompt) return err(res, 400, 'prompt required');
        const r = await generateImage(body);
        if (r.error) return err(res, 502, r.error);
        const name = (body.name && String(body.name).replace(/\.(png|jpg|jpeg|webp)$/i, '') || 'image-' + r.seed) + '.png';
        try {
          const asset = book.saveAsset(slugify(body.slug), name, r.png.toString('base64'), { base64: true });
          return send(res, 200, { asset, width: r.width, height: r.height, seed: r.seed, ms: r.ms });
        } catch (e) { return err(res, 400, e.message); }
      }
      if (path === '/api/generate-image' && method === 'GET') {
        return send(res, 200, { available: !!findMflux(), engine: 'mflux z-image-turbo (local, Apple MLX)' });
      }
      // autofill-imagery — one call: find empty media slots, generate on-aesthetic
      // photos locally, swap them in, save a new revision. dryRun previews the
      // plan (slots + prompts) without touching mflux. Bounded + serial so it
      // never starves the owner's foreground work.
      if (path === '/api/autofill-imagery' && method === 'POST') {
        const body = await readBody(req);
        if (!body.slug) return err(res, 400, 'slug required');
        const page = book.getPage(slugify(body.slug));
        if (!page) return err(res, 404, 'no page: ' + body.slug);
        const slug = page.manifest.slug;
        const genre = page.manifest.genre || '';
        const aesthetic = readAesthetic(page.html) || page.manifest.aesthetic || '';
        const max = Math.max(1, Math.min(6, body.max || 3));
        const slots = findImagerySlots(page.html).slice(0, max);
        const plan = slots.map((s) => ({ kind: s.kind, platform: s.platform, aspect: s.aspect, prompt: derivePrompt(s, { genre, aesthetic }) }));
        if (!slots.length) return send(res, 200, { slug, filled: [], plan: [], remaining: 0, note: 'no empty media placeholders found' });
        if (body.dryRun) return send(res, 200, { slug, dryRun: true, plan, remaining: findImagerySlots(page.html).length });
        if (!findMflux()) return send(res, 200, { slug, filled: [], plan, skipped: 'mflux unavailable — install it (frontendmaxxing/local-image-gen.skill.md) or fill imagery by hand', mfluxAvailable: false });
        let html = page.html;
        const filled = [];
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          const prompt = plan[i].prompt;
          const { width, height } = aspectToSize(s.aspect, s.kind === 'hero' ? 1280 : 1024);
          broadcast({ type: 'autofill', slug, i: i + 1, of: slots.length, status: 'generating', kind: s.kind });
          const r = await generateImage({ prompt, width, height });
          if (r.error) { filled.push({ kind: s.kind, error: r.error }); continue; }
          const name = `autofill-${s.kind}-${i + 1}-${r.seed}.png`;
          let asset;
          try { asset = book.saveAsset(slug, name, r.png.toString('base64'), { base64: true }); }
          catch (e) { filled.push({ kind: s.kind, error: e.message }); continue; }
          const swap = swapFirst(html, s.full, imgTag(s, asset.url, `${genre || 'brand'} ${s.kind}`, r.width, r.height));
          html = swap.html;
          filled.push({ kind: s.kind, url: asset.url, prompt, ms: r.ms, swapped: swap.swapped });
        }
        if (filled.some((f) => f.swapped)) {
          book.savePage({ slug, title: page.manifest.title, html, manifest: page.manifest });
        }
        return send(res, 200, { slug, filled, remaining: findImagerySlots(html).length, mfluxAvailable: true });
      }

      // viewport lab
      if (path === '/api/inspect' && method === 'POST') {
        const body = await readBody(req);
        let html = body.html;
        let label = body.label;
        let pagePlatform = null;
        if (!html && body.slug) {
          const page = book.getPage(slugify(body.slug));
          if (!page) return err(res, 404, 'no page: ' + body.slug);
          html = page.html;
          label = label || page.manifest.slug;
          pagePlatform = page.manifest.platform || null;
        }
        if (!html) return err(res, 400, 'html or slug required');
        // auto-route: an app-flow page with no explicit mode gets the mobile (HIG)
        // lab, not the web probe — running the 2600px layout probe on a phone flow
        // reports spurious overflow and zero HIG facts.
        let mode = body.mode;
        let autoRoutedMobile = false;
        if (!mode && (pagePlatform === 'mobile' || isMobileHtml(html))) { mode = 'mobile'; autoRoutedMobile = true; }
        const out = await inspect({
          html, vaultRoot: vault.root,
          bookDir: book.dir,
          viewports: body.viewports, mode, selector: body.selector,
          screenshot: !!body.screenshot, fullPage: !!body.fullPage, shotsDir: book.shotsDir,
          label: label ? slugify(label) : undefined,
        });
        if (out.error) return err(res, 500, out.error);
        // never mutate `out` — inspect() returns the cached object by reference, so
        // stamping fields on it would leak across requests. Build a fresh payload.
        const payload = autoRoutedMobile ? { ...out, autoRoutedMobile: true } : out;
        // screenshot results are never cached, so stamping their URLs is safe
        for (const r of payload.reports || []) {
          if (r.screenshotPath) r.screenshotUrl = '/book/shots/' + r.screenshotPath.split('/').pop();
        }
        return send(res, 200, payload);
      }

      // taste critique — render the page + have a VISION model score the pixels
      // against the Awwwards rubric (the taste half of the MOAT). Costs one model
      // call; everything above (compose/inspect) is free.
      if (path === '/api/critique' && method === 'POST') {
        const body = await readBody(req);
        let html = body.html;
        let label = body.label;
        if (!html && body.slug) {
          const page = book.getPage(slugify(body.slug));
          if (!page) return err(res, 404, 'no page: ' + body.slug);
          html = page.html;
          label = label || page.manifest.slug;
        }
        if (!html) return err(res, 400, 'html or slug required');
        const model = (book.getSettings().sdk || {}).model || 'claude-sonnet-4-6';
        const out = await critique({
          html, vaultRoot: vault.root, bookDir: book.dir, shotsDir: book.shotsDir,
          label: label ? slugify(label) : 'critique', model,
        });
        if (out.error) return err(res, /auth/i.test(out.error) ? 503 : 500, out.error);
        return send(res, 200, out);
      }

      // refine — the generative pass: apply critique findings (+ optional
      // instruction) to a draft and return improved HTML, with a before/after
      // score delta when verify (default true). compose→critique→refine→verify.
      if (path === '/api/refine' && method === 'POST') {
        const body = await readBody(req);
        let html = body.html;
        let label = body.label;
        if (!html && body.slug) {
          const page = book.getPage(slugify(body.slug));
          if (!page) return err(res, 404, 'no page: ' + body.slug);
          html = page.html;
          label = label || page.manifest.slug;
        }
        if (!html) return err(res, 400, 'html or slug required');
        const model = (book.getSettings().sdk || {}).model || 'claude-sonnet-4-6';
        const out = await refine({
          html, instruction: body.instruction, critique: body.critique,
          verify: body.verify === true, patch: body.patch === true,
          vaultRoot: vault.root, bookDir: book.dir, shotsDir: book.shotsDir, model,
        });
        if (out.error) return err(res, /auth/i.test(out.error) ? 503 : 500, out.error);
        return send(res, 200, out);
      }

      // SSE
      if (path === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
          'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // ===== static mounts =====
      if (path.startsWith('/vault/')) return serveStatic(res, vault.root, path.slice('/vault/'.length));
      if (path.startsWith('/book/')) return serveStatic(res, book.dir, path.slice('/book/'.length), { baseHref: '/vault/' });
      return serveStatic(res, join(__dirname, 'ui'), path === '/' ? 'index.html' : path);
    } catch (e) {
      return err(res, 500, e.message || String(e));
    }
  });

  server.listen(PORT, () => {
    process.stdout.write(`designbook · http://localhost:${PORT} · vault ${vault.root} (${vault.entries.length} snippets, ${vault.presets.presets.length} presets)\n`);
  });
  return server;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  main().catch((e) => { process.stderr.write('designbook fatal: ' + (e.stack || e.message) + '\n'); process.exit(1); });
}
export { main };
