/* ============================================
   designbook · lib/critique.js — the TASTE half of the MOAT
   ============================================
   inspect.js verifies what is WRONG (facts: contrast, overflow, ARIA, CWV).
   It cannot see whether a page is BLAND. This does: it renders the page to a
   real screenshot and has a VISION model judge the pixels against the Awwwards
   rubric (design 40 / usability 30 / creativity 20 / content 10), returning
   scores + a verdict + the one signature moment + located, actionable fixes.

   Auth + transport reuse the SDK engine (CLAUDE_CODE_OAUTH_TOKEN subscription,
   or ANTHROPIC_API_KEY). The model reads the rendered PNG via the SDK's Read
   tool (vision-capable), so nothing about the HTML source biases the judgment —
   it scores the same pixels a human juror would see. Costs one vision call;
   compose/inspect stay free.
   ============================================ */
import { inspect } from './inspect.js';

const CRITIC_PROMPT = `You are a world-class design critic — an Awwwards juror judging a RENDERED web-page screenshot. Judge ONLY the pixels you see, never code or intent.

Score against this rubric (each capped at its weight):
- design (0-40): typographic scale & rhythm, spacing & alignment, color harmony & contrast, balance, focal hierarchy, finish.
- usability (0-30): is the primary action obvious; is it scannable; does the eye flow top-to-bottom; legibility; clear affordances.
- creativity (0-20): originality and art direction; a memorable signature moment — vs generic/templated/AI-looking.
- content (0-10): copy that is specific and real, vs filler / lorem / vague superlatives.

Calibrate honestly: a clean-but-generic AI-looking page scores 55-68, NOT 80. Reserve 85+ for genuinely striking, art-directed work. Most first drafts are 60-72.

For every issue, name the AREA, what you OBSERVE in the image, and a SPECIFIC fix (not "improve spacing" — "the hero headline and subhead are the same weight; drop the subhead to 400 and 0.7 opacity so the H1 leads").

Name the ONE signature moment the page has — or, if it has none (most don't), the single highest-impact one it SHOULD have.

Respond with ONLY a minified JSON object, no prose, no code fence, exactly this shape:
{"scores":{"design":<int>,"usability":<int>,"creativity":<int>,"content":<int>},"verdict":"<one honest sentence>","looksAiGenerated":<true|false>,"signatureMoment":"<what it is, or what it should be>","strengths":["<short>","..."],"issues":[{"area":"hero|type|color|spacing|hierarchy|imagery|cta|content|nav","severity":"high|med|low","observe":"<what you see>","fix":"<specific change>"}]}`;

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

/**
 * Render a page and score its taste with a vision model.
 * @param {object} a - { html, vaultRoot, bookDir, shotsDir, label, model }
 * @returns {Promise<object>} { ok, scores:{design,usability,creativity,content,total}, verdict,
 *   looksAiGenerated, signatureMoment, strengths[], issues[], screenshotPath, screenshotUrl, model } | { error }
 */
export async function critique({ html, vaultRoot, bookDir, shotsDir, label, model }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    return { error: 'No SDK auth — set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token, subscription) or ANTHROPIC_API_KEY' };
  }
  if (!html) return { error: 'html required' };

  // 1) render the truth: a real full-page desktop screenshot (headless Chrome)
  let pngPath;
  try {
    const shot = await inspect({
      html, vaultRoot, bookDir, viewports: ['desktop'], mode: 'layout',
      screenshot: true, fullPage: true, shotsDir, label: label || 'critique',
    });
    if (shot.error) return { error: 'render failed: ' + shot.error };
    const r = (shot.reports || []).find((x) => x.screenshotPath);
    pngPath = r && r.screenshotPath;
  } catch (e) {
    return { error: 'render threw: ' + String((e && e.message) || e) };
  }
  if (!pngPath) return { error: 'screenshot render produced no PNG' };

  // 2) vision critique — the model READS the rendered PNG (proven SDK auth)
  let sdk;
  try { sdk = await import('@anthropic-ai/claude-agent-sdk'); }
  catch { return { error: 'SDK not installed: npm install @anthropic-ai/claude-agent-sdk', screenshotPath: pngPath }; }

  const useModel = model || 'claude-sonnet-4-6';
  let text = '';
  try {
    const stream = sdk.query({
      prompt: `${CRITIC_PROMPT}\n\nRead the rendered screenshot at this exact path, then critique it:\n${pngPath}`,
      options: {
        model: useModel,
        allowedTools: ['Read'],          // only let it open the screenshot
        permissionMode: 'bypassPermissions',
        maxTurns: 4,
        cwd: bookDir,
      },
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
    return { error: 'critique threw: ' + String((e && e.message) || e), screenshotPath: pngPath };
  }

  const parsed = extractJson(text);
  if (!parsed) return { error: 'critique returned no parseable JSON', raw: text.slice(0, 500), screenshotPath: pngPath };

  // 3) normalize + clamp to the rubric weights, recompute total locally (never trust the model's arithmetic)
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const sc = parsed.scores || {};
  const scores = {
    design: clamp(sc.design, 40),
    usability: clamp(sc.usability, 30),
    creativity: clamp(sc.creativity, 20),
    content: clamp(sc.content, 10),
  };
  scores.total = scores.design + scores.usability + scores.creativity + scores.content;

  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    ok: true,
    scores,
    verdict: str(parsed.verdict, 300),
    looksAiGenerated: !!parsed.looksAiGenerated,
    signatureMoment: str(parsed.signatureMoment, 400),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map((s) => str(s, 160)) : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 12).map((i) => ({
      area: str(i.area, 24),
      severity: ['high', 'med', 'low'].includes(i.severity) ? i.severity : 'med',
      observe: str(i.observe, 300),
      fix: str(i.fix, 300),
    })) : [],
    screenshotPath: pngPath,
    screenshotUrl: '/book/shots/' + pngPath.split('/').pop(),
    model: useModel,
  };
}
