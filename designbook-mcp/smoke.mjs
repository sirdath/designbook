// Live MCP smoke test — boots server.js over stdio and exercises it as a real
// client against the running designbook core server (DESIGNBOOK_URL).
// Prints PASS/FAIL per step; exits non-zero on any failure.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.DESIGNBOOK_URL || 'http://localhost:4747').replace(/\/+$/, '');
const SLUG = 'mcp-smoke-test';

const EXPECTED_TOOLS = [
  'book_overview', 'book_meta', 'book_compose', 'book_coherence', 'book_inspect',
  'book_save_asset', 'book_generate_image', 'book_view', 'book_list_pages', 'book_get_page', 'book_save_page',
  'book_briefs', 'book_claim_brief', 'book_complete_brief'
];

let failures = 0;
async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Pre-clean: remove any leftover test page from a previous run (ignore errors).
await fetch(`${BASE}/api/pages/${SLUG}`, { method: 'DELETE' }).catch(() => {});

const transport = new StdioClientTransport({
  command: 'node',
  args: [join(here, 'server.js')],
  env: { ...process.env, DESIGNBOOK_URL: BASE }
});
const client = new Client({ name: 'designbook-smoke', version: '1.0.0' });
await client.connect(transport);

// 1. list tools — all 12 present
await step('list tools (14)', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  assert(missing.length === 0, `missing: ${missing.join(', ')}`);
  assert(names.length === EXPECTED_TOOLS.length, `expected 14 tools, got ${names.length}: ${names.join(', ')}`);
  const ro = tools.find((t) => t.name === 'book_compose')?.annotations?.readOnlyHint;
  const rw = tools.find((t) => t.name === 'book_save_page')?.annotations?.readOnlyHint;
  assert(ro === true && rw === false, `annotations wrong: compose RO=${ro}, save RO=${rw}`);
  return names.join(', ');
});

// 2. book_overview
await step('book_overview', async () => {
  const r = await client.callTool({ name: 'book_overview', arguments: {} });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const s = r.structuredContent;
  assert(s && s.ok === true, 'health not ok');
  assert(typeof s.queuedBriefs === 'number', 'no queuedBriefs count');
  assert(r.content[0].text.includes('book_compose'), 'workflow text missing book_compose');
  return `${s.snippets} snippets · ${s.queuedBriefs} queued briefs`;
});

// 3. book_compose
let composedHtml = '';
await step("book_compose({genre:'saas', preset:'clean-saas'})", async () => {
  const r = await client.callTool({ name: 'book_compose', arguments: { genre: 'saas', preset: 'clean-saas' } });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const s = r.structuredContent;
  assert(s && typeof s.html === 'string' && s.html.toLowerCase().includes('<!doctype'), 'no html in structuredContent');
  assert(s.theme && s.theme.palette === 'saas-indigo', `unexpected theme: ${JSON.stringify(s.theme)}`);
  assert(Array.isArray(s.sections) && s.sections.length > 0, 'no sections');
  assert(s.coherence && typeof s.coherence.score === 'number', 'no coherence score');
  assert(r.content[0].text.includes('```html'), 'no fenced html in text');
  composedHtml = s.html;
  return `theme pal-${s.theme.palette} · ${s.sections.length} sections · coherence ${s.coherence.score}`;
});

// 4. book_inspect on the composed html at iphone-15
await step("book_inspect(html, ['iphone-15'])", async () => {
  assert(composedHtml, 'no composed html from previous step');
  const r = await client.callTool({ name: 'book_inspect', arguments: { html: composedHtml, viewports: ['iphone-15'] } });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const reports = r.structuredContent?.reports;
  assert(Array.isArray(reports) && reports.length === 1, `expected 1 report, got ${reports?.length}`);
  assert(reports[0].viewport === 'iphone-15', `wrong viewport: ${reports[0].viewport}`);
  assert(typeof reports[0].docHeight === 'number', 'no docHeight fact');
  assert(/##\s+iphone-15/.test(r.content[0].text), 'no per-viewport markdown heading');
  return `docHeight ${reports[0].docHeight}px · hOverflow ${reports[0].hOverflow}`;
});

// 5. book_save_page
await step(`book_save_page('${SLUG}')`, async () => {
  const r = await client.callTool({
    name: 'book_save_page',
    arguments: { slug: SLUG, title: 'MCP Smoke Test', html: composedHtml, manifest: { genre: 'saas' } }
  });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const m = r.structuredContent?.manifest;
  assert(m && m.slug === SLUG, `unexpected manifest: ${JSON.stringify(m)}`);
  return `saved rev ${m.revisions ?? 0}`;
});

// 6. create a throwaway brief directly via the HTTP API
let briefId = null;
await step('create throwaway brief (POST /api/briefs)', async () => {
  const res = await fetch(`${BASE}/api/briefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'smoke-test throwaway brief — claim and complete me', engine: 'mcp' })
  });
  assert(res.ok, `HTTP ${res.status}`);
  const { brief } = await res.json();
  assert(brief && brief.id && brief.status === 'queued', `unexpected brief: ${JSON.stringify(brief)}`);
  briefId = brief.id;
  return `id ${briefId}`;
});

// 7. book_claim_brief
await step('book_claim_brief', async () => {
  assert(briefId, 'no brief id from previous step');
  const r = await client.callTool({ name: 'book_claim_brief', arguments: { id: briefId } });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const b = r.structuredContent?.brief;
  assert(b && b.id === briefId, `claimed wrong brief: ${JSON.stringify(b)}`);
  assert(b.status === 'working', `status not working: ${b.status}`);
  assert(r.content[0].text.includes('smoke-test throwaway brief'), 'brief text not returned');
  return `brief ${b.id} → working`;
});

// 8. book_complete_brief
await step('book_complete_brief', async () => {
  assert(briefId, 'no brief id');
  const r = await client.callTool({
    name: 'book_complete_brief',
    arguments: { id: briefId, pageSlug: SLUG, summary: 'smoke test completed the throwaway brief' }
  });
  assert(!r.isError, r.content?.[0]?.text || 'tool errored');
  const b = r.structuredContent?.brief;
  assert(b && b.status === 'done', `status not done: ${JSON.stringify(b)}`);
  assert(b.pageSlug === SLUG, `pageSlug not set: ${b.pageSlug}`);
  return `brief ${briefId} → done (page ${b.pageSlug})`;
});

// 9. cleanup: delete the test page AND the throwaway brief (never pollute the user's chat)
await step(`cleanup: DELETE /api/pages/${SLUG} + /api/briefs/${briefId}`, async () => {
  const res = await fetch(`${BASE}/api/pages/${SLUG}`, { method: 'DELETE' });
  assert(res.ok, `HTTP ${res.status}`);
  const bres = await fetch(`${BASE}/api/briefs/${briefId}`, { method: 'DELETE' });
  assert(bres.ok, `brief delete HTTP ${bres.status}`);
  return 'deleted page + brief';
});

await client.close();

if (failures) {
  console.log(`\nSMOKE FAILED — ${failures} step(s) failed`);
  process.exit(1);
}
console.log('\nSMOKE OK — all steps passed');
