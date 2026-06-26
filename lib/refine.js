/* ============================================
   designbook · lib/refine.js — the generative half of the loop
   ============================================
   autofix.js heals only deterministic-safe failures; everything judgement-y
   ("the headline is too small", "build a signature moment") it leaves to the
   agent. This is that judgement layer: it takes a draft + its critique findings
   and has a model REWRITE the HTML to apply the fixes — minimal diff, on-brand
   tokens, honoring reduced-motion, building the signature moment the critique
   named. Then (verify:true) it re-critiques so you SEE the score move.

   The loop: book_compose → book_critique → book_refine → (re-verify) → save.
   Critique supplies the targets; refine hits them. Reuses the SDK auth/transport.
   ============================================ */
import { critique } from './critique.js';

const SENTINEL = '---CHANGES---';

const refinePrompt = (html, issues, signatureMoment, instruction) => `You are a senior design engineer improving an EXISTING web page. You are given its full HTML and a list of specific, located issues from a design critique. Apply every fix precisely.

Hard rules:
- Make a MINIMAL diff: change only what the fixes require (plus what's needed to land the signature moment). Preserve all real copy, structure, and the existing design tokens / palette unless a fix says otherwise.
- Stay on-brand: reuse the existing CSS custom properties (var(--*)); do NOT introduce hardcoded hex/px/ms where a token exists, default indigo/purple gradients, Tailwind-default looks, or lorem.
- Honor prefers-reduced-motion for any motion you add.
${signatureMoment ? `- Signature moment to build (the critique says the page lacks/needs it): ${signatureMoment}\n` : ''}${instruction ? `- Also apply this instruction: ${instruction}\n` : ''}
ISSUES TO FIX:
${issues.length ? issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.area} — ${i.observe} → FIX: ${i.fix}`).join('\n') : '(none flagged — apply the instruction above)'}

CURRENT HTML:
${html}

Output the COMPLETE revised HTML document first (nothing before it — start at <!doctype or <html), then a line containing exactly ${SENTINEL}, then 3-6 short bullet lines naming what you changed. No other prose.`;

function splitOutput(text) {
  const idx = text.indexOf(SENTINEL);
  const htmlPart = idx >= 0 ? text.slice(0, idx) : text;
  const changesPart = idx >= 0 ? text.slice(idx + SENTINEL.length) : '';
  // strip an optional code fence, then start at the first tag
  const fence = htmlPart.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let html = (fence ? fence[1] : htmlPart).trim();
  const lt = html.search(/<!doctype|<html/i);
  if (lt > 0) html = html.slice(lt);
  const changes = changesPart
    .split('\n').map((l) => l.replace(/^\s*[-*•]\s?/, '').trim()).filter(Boolean).slice(0, 8);
  return { html: html.trim(), changes };
}

/**
 * Improve a draft by applying its critique findings (and/or an instruction).
 * @param {object} a - { html, instruction?, critique?, verify?, vaultRoot, bookDir, shotsDir, model }
 * @returns {Promise<object>} { ok, html, changes[], before, after, delta, model } | { error }
 */
export async function refine({ html, instruction, critique: crit, verify = false, vaultRoot, bookDir, shotsDir, model }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    return { error: 'No SDK auth — set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token, subscription) or ANTHROPIC_API_KEY' };
  }
  if (!html) return { error: 'html required' };
  const useModel = model || 'claude-sonnet-4-6';

  // 1) targets — use a provided critique; else critique now ONLY when there's no
  // explicit instruction. An instruction IS the directive (the iteration loop:
  // "make the hero bigger"), so we skip the extra critique call — refine({slug,
  // instruction}) is then a single fast model call.
  let before = (crit && crit.issues) ? crit : null;
  if (!before && !instruction) {
    before = await critique({ html, vaultRoot, bookDir, shotsDir, label: 'refine-before', model: useModel });
    if (before.error) return { error: 'pre-critique failed: ' + before.error };
  }
  const issues = before ? (before.issues || []) : [];
  if (!issues.length && !instruction) {
    return { ok: true, html, changes: [], unchanged: true, note: 'no issues flagged and no instruction — nothing to refine', before: (before && before.scores) ? { scores: before.scores } : null };
  }

  // 2) rewrite (single completion, no tools — HTML in, HTML out)
  let sdk;
  try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
  catch { return { error: 'SDK not installed: npm install @anthropic-ai/claude-agent-sdk' }; }

  let text = '';
  try {
    const stream = sdk.query({
      prompt: refinePrompt(html, issues, before ? before.signatureMoment : '', instruction),
      options: { model: useModel, allowedTools: [], maxTurns: 1 },
    });
    for await (const m of stream) {
      if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
        const t = m.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (t) text = t;
      } else if (m.type === 'result' && typeof m.result === 'string' && m.result.trim()) {
        text = m.result.trim();
      }
    }
  } catch (e) {
    return { error: 'refine threw: ' + String((e && e.message) || e) };
  }

  const { html: newHtml, changes } = splitOutput(text);
  if (!newHtml || newHtml.length < 200) return { error: 'refine produced no usable HTML', raw: text.slice(0, 400) };
  const truncated = !/<\/html\s*>/i.test(newHtml);   // missing closing tag ⇒ output cut off

  // 3) verify — re-critique the improved page so the score delta is visible
  let after = null;
  if (verify) {
    const a = await critique({ html: newHtml, vaultRoot, bookDir, shotsDir, label: 'refine-after', model: useModel });
    if (a.ok) after = { total: a.scores.total, scores: a.scores, verdict: a.verdict, looksAiGenerated: a.looksAiGenerated, screenshotUrl: a.screenshotUrl };
  }

  return {
    ok: true,
    html: newHtml,
    changes,
    truncated,
    before: (before && before.scores) ? { total: before.scores.total, scores: before.scores, verdict: before.verdict } : null,
    after,
    delta: (after && before && before.scores) ? after.total - before.scores.total : null,
    model: useModel,
  };
}
