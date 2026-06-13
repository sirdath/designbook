/* ============================================
   designbook · lib/book.js — the plain-file book store
   ============================================
   Pages, briefs, settings. Everything is a human-readable file under book/
   (architecture invariant #4): pages are folders with index.html + manifest,
   briefs/settings are small JSON files. A change listener powers SSE.
   ============================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }

export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'untitled';
}

export function createBook(rootDir) {
  const dir = join(rootDir, 'book');
  const pagesDir = join(dir, 'pages');
  const shotsDir = join(dir, 'shots');
  for (const d of [dir, pagesDir, shotsDir]) mkdirSync(d, { recursive: true });

  const briefsPath = join(dir, 'briefs.json');
  const settingsPath = join(dir, 'settings.json');
  const bookPath = join(dir, 'book.json');
  if (!existsSync(bookPath)) writeJson(bookPath, { name: 'Design Book', createdAt: new Date().toISOString() });
  if (!existsSync(briefsPath)) writeJson(briefsPath, []);
  if (!existsSync(settingsPath)) writeJson(settingsPath, { engine: 'mcp', sdk: { model: 'claude-sonnet-4-6' } });

  const listeners = new Set();
  function emit(type, payload) {
    for (const fn of listeners) { try { fn({ type, ...payload }); } catch { /* listener errors never break the store */ } }
  }

  // ---- pages ----
  function pageDir(slug) { return join(pagesDir, slug); }
  function manifestPath(slug) { return join(pageDir(slug), 'manifest.json'); }

  function listPages() {
    if (!existsSync(pagesDir)) return [];
    return readdirSync(pagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => readJson(manifestPath(d.name), null))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function getPage(slug) {
    const m = readJson(manifestPath(slug), null);
    if (!m) return null;
    const html = existsSync(join(pageDir(slug), 'index.html'))
      ? readFileSync(join(pageDir(slug), 'index.html'), 'utf8') : '';
    return { manifest: m, html };
  }
  function savePage({ slug, title, html, manifest }) {
    if (!html) throw new Error('html required');
    slug = slugify(slug || title);
    const d = pageDir(slug);
    const revDir = join(d, 'revisions');
    mkdirSync(revDir, { recursive: true });
    const prior = readJson(manifestPath(slug), null);
    if (prior && existsSync(join(d, 'index.html'))) {
      // checkpoint = prior html + prior manifest; compose is deterministic, so
      // the manifest alone (genre/preset/theme/seed) can also reproduce a page
      renameSync(join(d, 'index.html'), join(revDir, (prior.revisions || 0) + '.html'));
      writeJson(join(revDir, (prior.revisions || 0) + '.json'), prior);
    }
    const now = new Date().toISOString();
    const m = {
      ...(prior || {}),
      ...(manifest || {}),
      slug,
      title: title || (prior && prior.title) || slug,
      revisions: prior ? (prior.revisions || 0) + 1 : 0,
      createdAt: (prior && prior.createdAt) || now,
      updatedAt: now,
    };
    writeFileSync(join(d, 'index.html'), html);
    writeJson(manifestPath(slug), m);
    emit('pages', { slug });
    return m;
  }
  function updatePage(slug, { title, html, manifest }) {
    const cur = getPage(slug);
    if (!cur) return null;
    return savePage({ slug, title: title || cur.manifest.title, html: html || cur.html, manifest: { ...cur.manifest, ...(manifest || {}) } });
  }
  function deletePage(slug) {
    const d = pageDir(slug);
    if (!existsSync(d)) return false;
    rmSync(d, { recursive: true, force: true });
    emit('pages', { slug, deleted: true });
    return true;
  }

  // ---- project assets (the agent's drawings: svg, ascii, css, small images) ----
  function assetName(name) {
    const clean = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 80);
    if (!clean || !/\.[a-z0-9]{2,5}$/i.test(clean)) throw new Error('asset name needs a safe filename with an extension, e.g. "moon-hero.svg"');
    return clean;
  }
  function saveAsset(slug, name, content, { base64 } = {}) {
    if (!existsSync(manifestPath(slug))) throw new Error('no page: ' + slug);
    const file = assetName(name);
    const dir2 = join(pageDir(slug), 'assets');
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir2, file), base64 ? Buffer.from(String(content), 'base64') : String(content));
    emit('pages', { slug, asset: file });
    return { name: file, url: `/book/pages/${slug}/assets/${file}` };
  }
  function listAssets(slug) {
    const dir2 = join(pageDir(slug), 'assets');
    if (!existsSync(dir2)) return [];
    return readdirSync(dir2, { withFileTypes: true })
      .filter((d2) => d2.isFile())
      .map((d2) => {
        const st = statSync(join(dir2, d2.name));
        return { name: d2.name, size: st.size, url: `/book/pages/${slug}/assets/${d2.name}`, modified: st.mtime.toISOString() };
      });
  }
  function assetPath(slug, name) { return join(pageDir(slug), 'assets', assetName(name)); }

  // ---- briefs ----
  function listBriefs(status) {
    const all = readJson(briefsPath, []);
    return status ? all.filter((b) => b.status === status) : all;
  }
  function addBrief({ text, engine, pageSlug, kind, taste, draft }) {
    if (!text || !String(text).trim()) throw new Error('text required');
    const all = readJson(briefsPath, []);
    const brief = {
      id: randomUUID().slice(0, 8),
      text: String(text).trim(),
      engine: engine === 'sdk' ? 'sdk' : 'mcp',
      pageSlug: pageSlug || null,
      kind: kind || 'brief',       // brief | taste (instant re-theme) — chat renders by kind
      taste: taste || null,        // taste deltas applied for kind=taste
      draft: draft || null,        // {genre, preset, seedBase} instant deterministic draft
      status: 'queued',
      summary: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    all.unshift(brief);
    writeJson(briefsPath, all);
    emit('briefs', { id: brief.id });
    return brief;
  }
  function updateBrief(id, patch) {
    const all = readJson(briefsPath, []);
    const b = all.find((x) => x.id === id);
    if (!b) return null;
    const allowed = ['status', 'summary', 'pageSlug', 'engine', 'kind', 'taste', 'draft'];
    for (const k of allowed) if (patch[k] !== undefined) b[k] = patch[k];
    b.updatedAt = new Date().toISOString();
    writeJson(briefsPath, all);
    emit('briefs', { id });
    return b;
  }
  function deleteBrief(id) {
    const all = readJson(briefsPath, []);
    const idx = all.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    all.splice(idx, 1);
    writeJson(briefsPath, all);
    emit('briefs', { id, deleted: true });
    return true;
  }

  // ---- settings ----
  function getSettings() { return readJson(settingsPath, { engine: 'mcp', sdk: { model: 'claude-sonnet-4-6' } }); }
  function setSettings(patch) {
    const s = { ...getSettings(), ...(patch || {}) };
    delete s.apiKey; // invariant #6: the key never touches disk
    writeJson(settingsPath, s);
    emit('settings', {});
    return s;
  }

  return {
    dir, pagesDir, shotsDir,
    listPages, getPage, savePage, updatePage, deletePage,
    saveAsset, listAssets, assetPath,
    listBriefs, addBrief, updateBrief, deleteBrief,
    getSettings, setSettings,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
