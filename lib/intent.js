/* ============================================
   designbook · lib/intent.js — chat → deterministic action
   ============================================
   The user only talks. This pure keyword layer maps a chat message onto the
   deterministic core: a draftable genre + taste preset, or an instant
   taste-only re-theme. Anything it can't resolve stays a plain brief for the
   model engine. No model calls here — this is what makes the chat feel alive
   at zero token cost.
   ============================================ */

const GENRE_WORDS = {
  saas: ['saas', 'software product', 'b2b', 'product site', 'web app', 'platform'],
  agency: ['agency', 'studio site', 'creative studio', 'design firm'],
  portfolio: ['portfolio', 'personal site', 'my work', 'showcase site'],
  ecommerce: ['shop', 'store', 'ecommerce', 'e-commerce', 'boutique', 'jewelry', 'sell '],
  restaurant: ['restaurant', 'cafe', 'café', 'bistro', 'bakery', 'food menu', 'eatery'],
  startup: ['startup', 'waitlist', 'launch page', 'coming soon'],
  blog: ['blog', 'magazine', 'journal', 'newsletter site', 'articles'],
  landing: ['landing page', 'landing', 'homepage', 'one-pager', 'website'],
};

const AESTHETIC_WORDS = {
  luxury: ['luxur', 'premium', 'elegant', 'high-end', 'couture', 'sophisticat', 'exclusive', 'gold'],
  playful: ['playful', 'fun ', 'friendly', 'bubbly', 'colorful', 'kids', 'cheerful', 'cute'],
  technical: ['technical', 'developer', 'dev tool', 'devtool', 'terminal', 'monospace', 'engineer', 'api '],
  editorial: ['editorial', 'magazine', 'literary', 'serif', 'print-like', 'journal'],
  energetic: ['bold', 'energetic', 'vibrant', 'punchy', 'loud', 'electric', 'neon', 'exciting'],
  minimal: ['minimal', 'clean', 'simple', 'calm', 'quiet', 'understated', 'subtle'],
};

// "make it dark" without a named palette → a tasteful default per aesthetic
const MODE_DEFAULTS = {
  dark:  { minimal: 'midnight', luxury: 'luxe-black-gold', technical: 'vercel-mono', editorial: 'ink', energetic: 'electric-night', playful: 'arcade-dark' },
  light: { minimal: 'clean-light', luxury: 'luxe-cream', technical: 'mono-snow', editorial: 'paper', energetic: 'fresh-citrus', playful: 'playful-bright' },
};

function findKey(table, t) {
  for (const [key, words] of Object.entries(table)) {
    if (words.some((w) => t.includes(w))) return key;
  }
  return null;
}

/**
 * parseIntent(text, vault, context) → {
 *   genre, preset, taste:{aesthetic?,palette?,density?,motion?,fontPair?},
 *   tasteOnly,            // true = instant re-theme of the current doc
 *   draft,                // {genre, preset} when a fresh page should be drafted
 * }
 * context = { theme?: current focused theme, hasDoc?: bool }
 */
export function parseIntent(text, vault, context = {}) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';

  const genre = findKey(GENRE_WORDS, t);
  const aesthetic = findKey(AESTHETIC_WORDS, t);

  const density = /( airy | spacious | breathing room | more space )/.test(t) ? 'airy'
    : /( compact | dense | tighter | tight )/.test(t) ? 'compact' : null;
  const motion = /( bouncy | springy | lively motion )/.test(t) ? 'playful'
    : /( no motion | static | less motion | calm motion )/.test(t) ? 'minimal' : null;

  // direct palette mention ("use luxe cream", "midnight palette")
  let palette = null;
  for (const p of vault.palettes) {
    if (t.includes(p.name) || t.includes(p.name.replace(/-/g, ' '))) { palette = p.name; break; }
  }
  const mode = /(dark(er| mode| theme)?)\b/.test(t) ? 'dark'
    : /\b(light(er| mode| theme)?|bright)\b/.test(t) ? 'light' : null;
  if (!palette && mode) {
    const a = aesthetic || context.theme?.aesthetic || 'minimal';
    palette = MODE_DEFAULTS[mode][a] || MODE_DEFAULTS[mode].minimal;
  }

  // preset: aesthetic match, preferring the requested light/dark mode
  let preset = null;
  if (aesthetic) {
    const cands = vault.presets.presets.filter((p) => p.aesthetic === aesthetic);
    const byMode = mode ? cands.find((p) => vault.palettes.find((x) => x.name === p.palette)?.mode === mode) : null;
    preset = (byMode || cands[0] || {}).name || null;
  }

  const taste = {};
  if (aesthetic) taste.aesthetic = aesthetic;
  if (palette) taste.palette = palette;
  if (density) taste.density = density;
  if (motion) taste.motion = motion;
  const hasTaste = Object.keys(taste).length > 0;

  // Smalltalk → a helpful conversational reply, never a queued brief.
  const bare = t.trim().replace(/[!.?,'’]/g, '');
  const GREETINGS = ['hey', 'hi', 'hello', 'yo', 'sup', 'hey there', 'hi there', 'hello there', 'whats up', 'what up', 'good morning', 'good evening', 'thanks', 'thank you', 'ty', 'cool', 'nice', 'ok', 'okay', 'test'];
  if (!genre && !hasTaste && (GREETINGS.includes(bare) || bare.length < 4)) {
    return {
      genre: null, preset: null, taste: {}, tasteOnly: false, draft: null,
      smalltalk: context.hasDoc
        ? 'Hey! Tell me how to change what you see — "make it darker", "more luxurious", "switch to a warm palette" — or describe a brand-new page.'
        : 'Hey! Describe the site you want — e.g. "a landing page for a sleep app, calm and premium" — and a full draft appears here instantly.',
    };
  }

  // Decide the action:
  // - genre mentioned → draft a fresh page (taste rides along via preset/overrides)
  // - no genre, taste words, doc on screen, short message → instant re-theme
  // - no genre, taste words, NO doc → draft a landing page in that taste
  const tasteOnly = !genre && hasTaste && !!context.hasDoc && String(text).length <= 140;
  const draft = (genre || (hasTaste && !context.hasDoc))
    ? { genre: genre || 'landing', preset }
    : null;

  // An EDIT instruction (the iteration loop): a doc is on screen, the message
  // isn't a fresh-page request or a pure re-theme, and it reads like an
  // imperative tweak ("make the hero bigger", "add a testimonials section").
  // Routes to ONE book_refine call instead of the 40-turn agent — cheaper AND
  // faster. Conservative: short + imperative + references a change or a page
  // part; anything longer or ambiguous still falls through to the model engine.
  const IMPERATIVE = /\b(make|add|remove|delete|drop|change|swap|replace|move|put|increase|decrease|bigger|smaller|larger|wider|narrower|bolder|louder|tighten|loosen|shorten|lengthen|fix|improve|punch|pop|emphasi[sz]e|reduce|enlarge|shrink|center|centre|align|rounded|spacing|gap|padding|margin|hero|headline|title|button|cta|nav|menu|footer|section|column|grid|font|type|color|colour|contrast|image|photo|icon)\b/;
  const edit = !genre && !hasTaste && !tasteOnly && !draft && !!context.hasDoc
    && String(text).trim().length >= 4 && String(text).length <= 240 && IMPERATIVE.test(t);

  return { genre, preset, taste, tasteOnly, draft, edit, instruction: edit ? String(text).trim() : null, smalltalk: null };
}
