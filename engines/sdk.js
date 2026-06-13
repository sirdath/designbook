/* ============================================
   designbook · engines/sdk.js — the SDK engine
   ============================================
   Runs a queued brief through the Claude Agent SDK on API credits. Engine
   parity (invariant #1): the agent gets the SAME designbook MCP tool surface
   Claude Code uses — we spawn designbook-mcp/server.js over stdio with
   DESIGNBOOK_URL pointing back at this server. The SDK is an OPTIONAL,
   lazy-loaded dependency: if it (or the API key) is missing we mark the brief
   'error' and return { error } — the server never crashes (invariant #6: the
   key lives in ANTHROPIC_API_KEY env only).
   ============================================ */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = join(__dirname, '..', 'designbook-mcp', 'server.js');

function buildPrompt(brief) {
  const pageContext = brief.pageSlug
    ? `\n\nTarget page: "${brief.pageSlug}". Call book_get_page("${brief.pageSlug}") FIRST to load its manifest and current HTML, change only what the brief asks for, and save back to the same slug.`
    : '';

  return `You are the Design Book engine — a designer-grade agent with two tool surfaces:
- designbook (book_*): the workspace — compose drafts, inspect/diagnose/view across devices, save pages + assets, work briefs.
- frontendmaxxing: the full component vault — 900+ snippets (search_components / get_snippet), 55 palettes, taste presets, skills (get_skill "taste" and "structure" carry the design rules), design_system, illustrations (svg/illustrations.js → Illustrations registry: sleeping-child, night-sky, cat-sleeping…), ASCII banners (typography/ascii-banner.js), backgrounds, effects.

Brief (id ${brief.id}):
${brief.text}

The working contract — follow it exactly:
1. book_overview first; for a NEW design also get_skill("taste") if unsure about the aesthetic rules.
2. Draft deterministically with book_compose — FREE and instant. Then make it RICH, not bare: wire in real vault components (search_components → get_snippet), mount illustrations where they add value, draw bespoke SVGs and store them with book_save_asset.
3. Verify with FACTS: book_inspect across iphone-15, ipad, desktop; book_inspect mode "diagnose" for the full audit. Use book_view (a real image) for the final visual-taste judgment.
4. Save with book_save_page including briefId "${brief.id}" — that auto-completes this brief. The save-gate validates; fix what it rejects.
5. Spend model effort ONLY on what the brief asks for. No unrequested redesigns, no gold-plating.${pageContext}`;
}

/**
 * Run one brief through the Agent SDK.
 * @param {object} brief - a brief from the book store ({ id, text, pageSlug, ... })
 * @param {object} ctx   - { book, vault, port }
 * @returns {Promise<{ brief, transcriptTail } | { error }>}
 */
export async function runBrief(brief, ctx) {
  const { book, port } = ctx;
  book.updateBrief(brief.id, { status: 'working' });

  // No key → no engine. Checked before the import so the user gets the
  // accurate failure mode whether or not the optional dep is installed.
  if (!process.env.ANTHROPIC_API_KEY) {
    const error = 'ANTHROPIC_API_KEY not set';
    book.updateBrief(brief.id, { status: 'error', summary: error });
    return { error };
  }

  let sdk;
  try {
    sdk = await import('@anthropic-ai/claude-agent-sdk');
  } catch {
    const error = 'SDK not installed: npm install @anthropic-ai/claude-agent-sdk';
    book.updateBrief(brief.id, { status: 'error', summary: error });
    return { error };
  }

  const model = (book.getSettings().sdk || {}).model || 'claude-sonnet-4-6';
  let lastText = '';

  try {
    const stream = sdk.query({
      prompt: buildPrompt(brief),
      options: {
        mcpServers: {
          designbook: {
            command: 'node',
            args: [MCP_SERVER_PATH],
            env: { DESIGNBOOK_URL: 'http://localhost:' + port },
          },
          // the FULL vault — search, snippets, palettes, skills, illustrations
          frontendmaxxing: {
            command: 'node',
            args: [join(ctx.vault.root, 'mcp-server', 'server.js')],
          },
        },
        allowedTools: ['mcp__designbook__*', 'mcp__frontendmaxxing__*'],
        model,
        maxTurns: 40,
      },
    });

    for await (const message of stream) {
      if (message.type === 'assistant' && message.message && Array.isArray(message.message.content)) {
        const text = message.message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (text) lastText = text;
      } else if (message.type === 'result' && typeof message.result === 'string' && message.result.trim()) {
        lastText = message.result.trim();
      }
    }

    // Normal completion: the agent should have closed the brief itself via
    // book_complete_brief (or book_save_page with briefId). If it forgot,
    // close it out with its own final words.
    const current = book.listBriefs().find((b) => b.id === brief.id);
    if (current && current.status === 'working') {
      book.updateBrief(brief.id, {
        status: 'done',
        summary: lastText.slice(0, 500) || 'completed (agent left no summary)',
      });
    }
  } catch (e) {
    book.updateBrief(brief.id, { status: 'error', summary: String((e && e.message) || e) });
  }

  return {
    brief: book.listBriefs().find((b) => b.id === brief.id),
    transcriptTail: lastText,
  };
}
