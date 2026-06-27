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
import { VIEWPORTS, DEFAULT_VIEWPORTS, findChrome, MODES } from './lib/inspect.js';
import { buildFlowHandoff, isMobileHtml } from './lib/handoff.js';
import { autofix } from './lib/autofix.js';
import { findImagerySlots, derivePrompt, imgTag, swapFirst, readAesthetic } from './lib/autofill.js';
import { gateFindings, gateFindingsMobile, IMAGERY_MANDATORY, TOOLS, GATE_COHERENCE_MIN } from './designbook-mcp/server.js';
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

  await t.test('composeApp(mobile) builds a phone flow with stamped screen refs', () => {
    assert.ok(Array.isArray(vault.mobileGenres) && vault.mobileGenres.length >= 8, 'mobile genres exposed');
    const out = vault.composeApp({ genre: 'social', seed: 0 });
    assert.equal(out.platform, 'mobile');
    assert.ok(out.screens.length >= 2, 'multi-screen flow');
    // each device frame is stamped data-db-ref="scr<i>-<shell>" for diagnostics
    const refs = (out.html.match(/data-db-ref="scr\d+-[a-z]+"/g) || []);
    assert.equal(refs.length, out.screens.length, 'one stamped ref per screen frame');
    assert.match(out.html, /class="app-flow"/);
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

// ------------------------------------------------------------- lib/handoff.js

test('lib/handoff.js — mobile FLOW.md from a composed app', async () => {
  const vault = await loadVault();
  const out = vault.composeApp({ genre: 'finance', seed: 0 });
  assert.ok(isMobileHtml(out.html), 'composed app reads as mobile');
  assert.equal(isMobileHtml('<body class="struct"><section>web</section></body>'), false, 'a web page is not mobile');

  const md = buildFlowHandoff({
    html: out.html,
    manifest: { title: 'Money App', slug: 'money-app', genre: 'finance', platform: 'mobile' },
    palettes: vault.palettes,
  });
  assert.match(md, /Money App — mobile handoff/);
  assert.match(md, /## Screen flow \(\d+\)/);
  assert.match(md, /## Design tokens/);
  assert.match(md, /390 × 844/);           // device geometry present
  assert.match(md, /44 × 44 pt/);          // iOS tap-target rule (in the iOS↔Android table)
  assert.match(md, /iOS ↔ Android/);       // the divergence table is present
  assert.match(md, /48 × 48 dp/);          // Material counterpart
  assert.match(md, /tab root|pushed|modal/); // per-screen role shown
  // the resolved palette name from the composed <body> is reflected
  const pal = (out.html.match(/\bpal-([a-z0-9-]+)/) || [])[1];
  if (pal) assert.ok(md.includes('pal-' + pal), 'handoff names the composed palette');
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

  assert.ok(MODES.includes('mobile'), 'mobile (HIG) inspect mode is registered');
  assert.ok(MODES.includes('taste'), 'taste (composition facts) inspect mode is registered');
  assert.deepEqual(MODES, ['layout', 'perf', 'diagnose', 'element', 'mobile', 'taste']);

  const chrome = findChrome();
  assert.equal(typeof chrome, 'string', 'findChrome returns a path on this machine');
  assert.ok(existsSync(chrome), 'chrome binary exists');
  // full inspect() is integration-verified against the running server — skipped here (slow)
});

// ------------------------------------------------------------- lib/autofix.js

test('autofix — injects reveal observer + repairs missing alt, idempotently', () => {
  // .s-reveal with no script → observer injected
  const blank = '<body><div class="s-reveal"><h1>hi</h1></div></body>';
  const a = autofix(blank);
  assert.match(a.html, /IntersectionObserver/, 'reveal observer injected');
  assert.ok(a.fixed.some((f) => /reveal/.test(f)), 'reports the reveal fix');
  // idempotent — a second pass changes nothing
  assert.equal(autofix(a.html).fixed.length, 0, 'no double-injection');

  // already has a reveal mechanism → untouched
  assert.equal(autofix(blank.replace('</body>', '<script>IntersectionObserver</script></body>')).fixed.length, 0);

  // <img> without alt → alt="" + marker; decorative mediaBox <div> untouched
  const img = '<body><img src="hero.jpg"><div class="s-reveal" style="background:var(--surface)"></div></body>';
  const b = autofix(img);
  assert.match(b.html, /<img alt="" data-todo-alt/, 'alt added to img');
  assert.ok(b.fixed.some((f) => /alt/.test(f)));
  // an img that already has alt is left alone
  assert.equal(autofix('<body><img src="x" alt="real"></body>').fixed.some((f) => /alt/.test(f)), false);
});

// ------------------------------------------------------------- lib/autofill.js

test('autofill — finds empty media slots, derives prompts, swaps idempotently', () => {
  const html = '<body data-aesthetic="luxury"><div class="s-reveal" style="aspect-ratio:16/10;background:var(--surface);border-radius:var(--radius);"></div><div class="s-reveal" style="aspect-ratio:1/1;background:var(--surface);"></div><div class="s-reveal" style="padding:2rem"><h2>not media</h2></div></body>';
  assert.equal(readAesthetic(html), 'luxury');
  const slots = findImagerySlots(html);
  assert.equal(slots.length, 2, 'only the two empty media boxes (the content .s-reveal is skipped)');
  assert.equal(slots[0].kind, 'hero');
  assert.equal(slots[0].aspect, '16/10');

  const p = derivePrompt(slots[0], { genre: 'restaurant', aesthetic: 'luxury' });
  assert.match(p, /food/, 'restaurant subject');
  assert.match(p, /low-key/, 'luxury look');
  assert.match(p, /no text|no watermark/, 'guards against text/watermark');

  // two byte-identical placeholders → sequential swaps hit distinct ones
  const a = swapFirst(html, slots[0].full, imgTag(slots[0], '/book/a.png', 'hero', 1280, 800));
  assert.ok(a.swapped && /<img[^>]+a\.png/.test(a.html));
  assert.equal(findImagerySlots(a.html).length, 1, 'one slot left after first swap');

  // mobile .scr-media must keep its real inline aspect-ratio (not hardcode 4/3)
  const mob = findImagerySlots('<div class="scr-media" style="aspect-ratio:1/1;border-radius:50%;"></div><div class="scr-media"></div>');
  assert.equal(mob[0].aspect, '1/1', 'parses the inline aspect-ratio');
  assert.equal(mob[1].aspect, '4/3', 'falls back to 4/3 when none given');
});

// ------------------------------------------------------------- save-gate (designbook-mcp)

test('gateFindings — prescriptive findings + imagery craft-floor', () => {
  // a clean, imagery-bearing page on a non-visual genre passes
  const clean = { score: 95, authenticity: { imageCount: 2, tells: [] } };
  assert.deepEqual(gateFindings(clean, {}, { genre: 'saas' }), [], 'clean page → no findings');

  // visual-first genre with 0 images trips the craft-floor
  const noImg = { score: 88, authenticity: { imageCount: 0, tells: ['NO-IMAGERY'] } };
  const eco = gateFindings(noImg, {}, { genre: 'ecommerce' });
  const floor = eco.find((f) => f.check === 'imagery-floor');
  assert.ok(floor, 'ecommerce + 0 images → imagery-floor finding');
  assert.match(floor.code, /^imagery-floor:ecommerce$/);
  assert.ok(floor.fix.includes('book_generate_image'), 'fix names the remedy tool');

  // same page on an exempt genre does NOT trip the floor
  assert.equal(gateFindings(noImg, {}, { genre: 'saas' }).some((f) => f.check === 'imagery-floor'), false, 'saas is exempt');
  assert.ok(IMAGERY_MANDATORY.has('portfolio') && !IMAGERY_MANDATORY.has('blog'));

  // gradient-slop (coherence < 70) is rejected with an imagery-pointing fix
  const slop = { score: 48, authenticity: { imageCount: 0, tells: ['GRADIENT-HEAVY-NO-IMAGERY', 'NO-IMAGERY'] } };
  const sf = gateFindings(slop, {}, { genre: 'landing' }).find((f) => f.check === 'coherence');
  assert.ok(sf && sf.fix.includes('book_generate_image'), 'gradient slop fix points at imagery');

  // every finding is prescriptive: check + code + cause + fix, never a bare name
  const diag = { console: [{ level: 'error', message: 'x is not defined' }], layout: { hOverflow: true, overflowers: [{ sel: 'div.wide', right: 520, width: 600 }] }, css: { undefinedVars: ['--ghost'] } };
  for (const f of gateFindings(noImg, diag, { genre: 'ecommerce' })) {
    assert.ok(f.check && f.code && f.cause && f.fix, `finding fully formed: ${JSON.stringify(f)}`);
  }
});

test('gateFindingsMobile — HIG lens, never web-overflow', () => {
  const okCoh = { score: 80, authenticity: { tells: [] } };
  // a clean composed flow passes
  const clean = { summary: { score: 96, screens: 3, safeAreaIssues: 0, reachIssues: 0 }, screens: [{ shell: 'feed', warnings: [] }] };
  assert.deepEqual(gateFindingsMobile(okCoh, clean), [], 'clean HIG flow → no findings');

  // safe-area + reach violations are rejected (the things the web gate misses)
  const bad = { summary: { score: 62, screens: 3, safeAreaIssues: 1, reachIssues: 2 },
    screens: [{ shell: 'detail', warnings: ['top-level screen (feed) has no tab bar'] }] };
  const ff = gateFindingsMobile(okCoh, bad);
  const checks = ff.map((f) => f.check);
  assert.ok(checks.includes('safe-area'), 'rejects safe-area violations');
  assert.ok(checks.includes('thumb-reach'), 'rejects out-of-reach primary actions');
  assert.ok(checks.includes('mobile-hig'), 'rejects a low overall HIG score');
  assert.ok(checks.includes('nav-convention'), 'rejects missing native nav');
  for (const f of ff) assert.ok(f.check && f.code && f.cause && f.fix, 'prescriptive');

  // never blocks on a missing/error mobile report (don't fail a save we cannot assess)
  assert.deepEqual(gateFindingsMobile(okCoh, { error: 'no .scr-frame' }), []);
});

// ------------------------------------------------------------- invariants (E1)

test('tool surface + gate constants are single-sourced and stable', () => {
  assert.equal(TOOLS.length, 27, 'all 27 tools enumerated');
  for (const t of ['book_overview', 'book_compose', 'book_variants', 'book_autofill_imagery', 'book_inspect', 'book_save_page', 'book_export_pptx', 'book_lottie', 'book_video_diagnose']) {
    assert.ok(TOOLS.includes(t), `${t} in the manifest`);
  }
  assert.equal(GATE_COHERENCE_MIN, 70, 'gate floor is 70 (distinct from the vault soft 80)');
});

test('web compose stamps a unique data-db-ref per section (provenance invariant)', async () => {
  const vault = await loadVault();
  const out = vault.compose({ genre: 'saas', seed: 0 });
  const refs = (out.html.match(/data-db-ref="(s\d+-[^"]+)"/g) || []);
  assert.ok(refs.length >= 3, `expected several stamped sections, got ${refs.length}`);
  assert.equal(new Set(refs).size, refs.length, 'every data-db-ref is unique');
});

test('every web genre composes to a renderable page (no throw, has body + reveal)', async () => {
  const vault = await loadVault();
  for (const genre of vault.genres) {
    const out = vault.compose({ genre, seed: 0 });
    assert.match(out.html, /<body[^>]*class="struct/, `${genre} has a .struct body`);
    assert.match(out.html, /IntersectionObserver/, `${genre} ships the reveal script (no blank page)`);
  }
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
