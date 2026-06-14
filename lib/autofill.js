/* ============================================
   designbook · lib/autofill.js — wireframe → deliverable
   ============================================
   A composed draft ships with grey media placeholders and 0 images. This finds
   those empty slots, derives an on-aesthetic photo prompt for each, and (in the
   server handler) generates real imagery locally and swaps it in — closing the
   gap between an AI-looking wireframe and a custom-feeling page. The detection,
   prompt-derivation and swap are PURE here (testable without mflux); the handler
   owns the generate + save orchestration.
   ============================================ */

// Per-aesthetic photographic direction (compact distillation of
// frontendmaxxing/art-direction.skill.md's imagery matrix).
const AESTHETIC_IMAGERY = {
  minimal: 'clean minimalist photography, soft even light, generous negative space, muted neutral palette',
  editorial: 'editorial magazine photography, dramatic directional light, rich detail, considered composition',
  energetic: 'vibrant high-energy photography, bold saturated color, dynamic, punchy contrast',
  luxury: 'luxury photography, moody low-key lighting, deep shadows, premium materials, elegant',
  playful: 'playful bright photography, candid warmth, cheerful color, friendly and approachable',
  technical: 'sleek modern photography, crisp studio light, precise, high-contrast, refined',
};
const GENRE_SUBJECT = {
  ecommerce: 'a premium product on a clean surface',
  restaurant: 'a beautifully plated dish, appetizing food',
  portfolio: 'an abstract creative still life',
  agency: 'a modern abstract brand visual',
  landing: 'a hero lifestyle scene',
  saas: 'an abstract product / workspace scene',
  startup: 'a modern lifestyle product scene',
  blog: 'an editorial lifestyle photograph',
};

// Parse the aesthetic the page was composed with off its <body> tag.
export function readAesthetic(html) {
  const m = String(html).match(/<body[^>]*\bdata-aesthetic="([^"]*)"/i);
  return m ? m[1] : '';
}

// Find the empty media placeholders a draft ships with: web mediaBox
// (`.s-reveal` divs with an aspect-ratio + surface background) and mobile
// `.scr-media`. Returns ordered slots, each carrying the exact source string to
// swap and the aspect ratio to size the image.
export function findImagerySlots(html) {
  const h = String(html || '');
  const slots = [];
  // web: <div class="s-reveal" style="aspect-ratio:16/10;background:var(--surface);…"></div>
  const webRe = /<div class="s-reveal" style="([^"]*?)">\s*<\/div>/gi;
  let m;
  while ((m = webRe.exec(h))) {
    if (!/aspect-ratio/i.test(m[1]) || !/var\(--surface\)/i.test(m[1])) continue;
    const ar = (m[1].match(/aspect-ratio:\s*([0-9./\s]+)/i) || [])[1] || '16/10';
    slots.push({ full: m[0], platform: 'web', aspect: ar.trim(), kind: slots.length === 0 ? 'hero' : 'content' });
  }
  // mobile: <div class="scr-media" …></div> (empty) — honor an inline aspect-ratio
  const mobRe = /<div class="scr-media"[^>]*>\s*<\/div>/gi;
  while ((m = mobRe.exec(h))) {
    const ar = (m[0].match(/aspect-ratio:\s*([0-9./\s]+)/i) || [])[1];
    slots.push({ full: m[0], platform: 'mobile', aspect: ar ? ar.trim() : '4/3', kind: slots.length === 0 ? 'hero' : 'content' });
  }
  return slots;
}

export function derivePrompt(slot, { genre, aesthetic } = {}) {
  const subject = GENRE_SUBJECT[String(genre || '').toLowerCase()] || 'a tasteful brand photograph';
  const look = AESTHETIC_IMAGERY[String(aesthetic || '').toLowerCase()] || 'professional photography, natural light';
  const framing = slot.kind === 'hero' ? 'wide hero composition' : 'focused detail';
  return `${subject}, ${look}, ${framing}, photorealistic, no text, no watermark, no logo`;
}

// aspect "16/10" → generation dimensions (snapped later by generateImage)
export function aspectToSize(aspect, baseW) {
  const w = baseW || 1280;
  const m = String(aspect || '16/10').match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
  const arRaw = m ? (+m[1]) / (+m[2]) : 1.6;
  const ar = Number.isFinite(arRaw) && arRaw > 0 ? arRaw : 1.6; // guards 16/0=Infinity, NaN, negatives
  return { width: w, height: Math.round(w / ar) };
}

// Build the <img> that replaces a placeholder, preserving the slot's aspect so
// layout doesn't shift.
export function imgTag(slot, url, alt, w, h) {
  return `<img src="${url}" alt="${alt || ''}" loading="lazy" width="${w}" height="${h}" ` +
    `style="width:100%;height:auto;aspect-ratio:${slot.aspect};object-fit:cover;` +
    (slot.platform === 'web' ? 'border-radius:var(--radius);border:1px solid var(--border);' : '') + '">';
}

// Replace the first remaining occurrence of a placeholder with its <img>.
// Sequential single-occurrence replacement so byte-identical placeholders map
// to distinct images in order.
export function swapFirst(html, needle, replacement) {
  const i = String(html).indexOf(needle);
  if (i === -1) return { html, swapped: false };
  return { html: html.slice(0, i) + replacement + html.slice(i + needle.length), swapped: true };
}
