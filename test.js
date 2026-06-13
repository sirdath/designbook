/* ============================================
   designbook · test.js — core test suite
   ============================================
   Run with: node test.js
   Covers lib/book.js (against a temp dir), lib/vault.js (needs the
   frontendmaxxing vault + the running server at :4747 for the meta reality
   check), lib/inspect.js (table + chrome discovery; full inspect() is
   integration-verified elsewhere) and engines/sdk.js (graceful no-key path).
   ============================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createBook, slugify } from './lib/book.js';
import { loadVault, injectBase } from './lib/vault.js';
import { VIEWPORTS, DEFAULT_VIEWPORTS, findChrome } from './lib/inspect.js';
import { runBrief } from './engines/sdk.js';

const SERVER = process.env.DESIGNBOOK_URL || 'http://localhost:4747';

// ---------------------------------------------------------------- lib/book.js

test('slugify', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify("Bob's Café — Page 2"), 'bobs-caf-page-2'); // apostrophes dropped, runs collapsed
  assert.equal(slugify('  --Already--Sluggy--  '), 'already-sluggy'); // edge dashes trimmed
  assert.equal(slugify('UPPER case TITLE'), 'upper-case-title');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify(null), 'untitled');
  assert.equal(slugify('***'), 'untitled');
  assert.ok(slugify('x'.repeat(200)).length <= 64, 'capped at 64 chars');
});

test('lib/book.js — pages, briefs, settings (temp dir)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'designbook-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const book = createBook(root);

  await t.test('savePage → getPage roundtrip', () => {
    const m = book.savePage({ title: 'Hero Test', html: '<html><body>v0</body></html>' });
    assert.equal(m.slug, 'hero-test');
    assert.equal(m.revisions, 0);
    const got = book.getPage('hero-test');
    assert.equal(got.html, '<html><body>v0</body></html>');
    assert.equal(got.manifest.title, 'Hero Test');
    assert.ok(got.manifest.createdAt && got.manifest.updatedAt);
  });

  await t.test('revision bump archives prior html under revisions/0.html', () => {
    const m = book.savePage({ slug: 'hero-test', title: 'Hero Test', html: '<html><body>v1</body></html>' });
    assert.equal(m.revisions, 1);
    const archived = join(root, 'book', 'pages', 'hero-test', 'revisions', '0.html');
    assert.ok(existsSync(archived), 'prior html archived');
    assert.equal(readFileSync(archived, 'utf8'), '<html><body>v0</body></html>');
    assert.equal(book.getPage('hero-test').html, '<html><body>v1</body></html>');
  });

  await t.test('updatePage merges manifest, keeps untouched fields, bumps revision', () => {
    const m = book.updatePage('hero-test', { manifest: { genre: 'saas', seed: 7 } });
    assert.equal(m.genre, 'saas');
    assert.equal(m.seed, 7);
    assert.equal(m.title, 'Hero Test');
    assert.equal(m.revisions, 2);
    assert.equal(book.updatePage('no-such-page', { title: 'x' }), null);
  });

  await t.test('deletePage', () => {
    assert.equal(book.deletePage('hero-test'), true);
    assert.equal(book.getPage('hero-test'), null);
    assert.equal(book.deletePage('hero-test'), false);
    assert.equal(book.listPages().length, 0);
  });

  await t.test('addBrief / updateBrief lifecycle', () => {
    const b = book.addBrief({ text: 'Make a hero section', engine: 'sdk' });
    assert.equal(b.status, 'queued');
    assert.equal(b.engine, 'sdk');
    assert.equal(b.summary, null);
    assert.equal(book.listBriefs('queued').length, 1);

    const w = book.updateBrief(b.id, { status: 'working' });
    assert.equal(w.status, 'working');

    const d = book.updateBrief(b.id, { status: 'done', summary: 'saved hero', pageSlug: 'hero' });
    assert.equal(d.status, 'done');
    assert.equal(d.summary, 'saved hero');
    assert.equal(d.pageSlug, 'hero');
    assert.equal(book.listBriefs('done').length, 1);
    assert.equal(book.listBriefs('queued').length, 0);
    assert.equal(book.updateBrief('no-such-id', { status: 'done' }), null);
    assert.throws(() => book.addBrief({ text: '   ' }), /text required/);
  });

  await t.test('settings never persist apiKey (invariant #6)', () => {
    const s = book.setSettings({ apiKey: 'sk-secret-do-not-write', engine: 'sdk' });
    assert.equal(s.apiKey, undefined);
    const raw = readFileSync(join(root, 'book', 'settings.json'), 'utf8');
    assert.ok(!raw.includes('apiKey'), 'apiKey key never reaches disk');
    assert.ok(!raw.includes('sk-secret-do-not-write'), 'secret value never reaches disk');
    assert.equal(book.getSettings().engine, 'sdk');
  });
});

// --------------------------------------------------------------- lib/vault.js

test('lib/vault.js — load, compose, coherence, injectBase', async (t) => {
  const vault = await loadVault(); // resolves (throws with a clear message if the vault is missing)
  assert.ok(vault.root && existsSync(join(vault.root, 'INDEX.md')));

  await t.test('compose(clean-saas) uses the palette the running API reports', async () => {
    // Assert against reality: ask the live server which palette clean-saas maps to.
    const meta = await (await fetch(SERVER + '/api/meta')).json();
    const preset = meta.presets.find((p) => p.name === 'clean-saas');
    assert.ok(preset, 'clean-saas preset exists in /api/meta');
    assert.equal(preset.palette, 'saas-indigo'); // today's reality (NOT fintech-light)

    const out = vault.compose({ genre: 'saas', preset: 'clean-saas' });
    assert.ok(out.html.includes('pal-' + preset.palette), `html carries pal-${preset.palette}`);
    assert.ok(Array.isArray(out.sections) && out.sections.length > 0);

    const c = vault.coherence(out.html);
    assert.equal(typeof c.score, 'number', 'coherence score is a number');
    assert.ok(c.score >= 0 && c.score <= 100);
  });

  await t.test('injectBase inserts <base> right after <head> and is idempotent', () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>hi</body></html>';
    const once = injectBase(html, '/vault/');
    const headIdx = once.indexOf('<head>');
    const baseIdx = once.indexOf('<base href="/vault/">');
    assert.ok(baseIdx > headIdx, '<base> after <head>');
    assert.ok(baseIdx < once.indexOf('</head>'), '<base> inside head');
    assert.equal(once.split('<base').length - 1, 1, 'exactly one <base>');
    assert.equal(injectBase(once, '/vault/'), once, 'idempotent');
    assert.equal(injectBase('', '/vault/'), '', 'empty html passes through');
  });
});

// ------------------------------------------------------------- lib/inspect.js

test('lib/inspect.js — viewport table sane, chrome discoverable', () => {
  assert.equal(Object.keys(VIEWPORTS).length, 8, '8 named viewports');
  assert.deepEqual(VIEWPORTS['iphone-15'], { width: 393, height: 852 });
  for (const [name, v] of Object.entries(VIEWPORTS)) {
    assert.ok(Number.isInteger(v.width) && v.width >= 375, `${name} width sane`);
    assert.ok(Number.isInteger(v.height) && v.height >= 667, `${name} height sane`);
  }
  for (const n of DEFAULT_VIEWPORTS) assert.ok(VIEWPORTS[n], `default viewport ${n} is named`);

  const chrome = findChrome();
  assert.equal(typeof chrome, 'string', 'findChrome returns a path on this machine');
  assert.ok(existsSync(chrome), 'chrome binary exists');
  // full inspect() is integration-verified against the running server — skipped here (slow)
});

// ------------------------------------------------------------- engines/sdk.js

test('engines/sdk.js — runBrief without ANTHROPIC_API_KEY is graceful', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'designbook-sdk-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  t.after(() => { if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey; });

  const book = createBook(root);
  const brief = book.addBrief({ text: 'Compose a calm fintech landing page', engine: 'sdk' });

  const res = await runBrief(brief, { book, vault: null, port: 4747 }); // must not throw
  assert.ok(res && res.error, 'returns { error }');
  assert.match(res.error, /ANTHROPIC_API_KEY/, 'error names the missing key');

  const after = book.listBriefs().find((b) => b.id === brief.id);
  assert.equal(after.status, 'error', 'brief ends in error status');
  assert.match(after.summary, /ANTHROPIC_API_KEY/);
});
