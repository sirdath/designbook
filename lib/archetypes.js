/* ============================================
   designbook · lib/archetypes.js — the compose floor-raiser
   ============================================
   A bare compose (genre only, no taste direction) used to fall to the vault
   composer's generic default — `saas-indigo` + `minimal`, the exact indigo-SaaS
   cliché the anti-slop gate flags. Yet 17 curated archetype presets sit unused
   unless a preset is named. This maps each genre to a small pool of strong,
   genre-appropriate archetypes and picks one by seed — so even a zero-effort
   draft looks intentional, and variants (different seeds) get real variety.

   Used ONLY when the caller passed no preset/aesthetic/palette: an explicit
   taste choice always wins. Pure + deterministic (no model calls).
   ============================================ */

// genre → curated archetype pool (all names verified against the vault presets).
// Deliberately distinctive per genre; never the bare saas-indigo/minimal default.
const ARCHETYPES = {
  landing:    ['bold-launch', 'editorial-swiss', 'dark-luxury-jewel', 'ai-iridescent'],
  saas:       ['calm-fintech', 'ai-iridescent', 'dev-tool', 'data-console'],
  startup:    ['bold-launch', 'vibrant-startup', 'ai-iridescent'],
  agency:     ['editorial-swiss', 'dark-luxury-jewel', 'maximalist-pop', 'neubrutalist'],
  portfolio:  ['editorial-ink', 'editorial-swiss', 'dark-luxury-jewel', 'neubrutalist'],
  ecommerce:  ['luxury-cream', 'dark-luxury-jewel', 'editorial-mag', 'luxury-noir'],
  restaurant: ['luxury-cream', 'editorial-mag', 'luxury-noir'],
  blog:       ['editorial-mag', 'editorial-ink', 'editorial-swiss'],
};

// unknown / unmapped genres still get a strong, varied default (never indigo-minimal).
const FALLBACK = ['editorial-swiss', 'bold-launch', 'dark-luxury-jewel', 'luxury-cream'];

/**
 * Pick a curated archetype preset for a genre, varied by seed.
 * @param {string} genre
 * @param {number} [seed]  same seed → same pick (reproducible); different seeds → variety
 * @returns {string} a preset name
 */
export function defaultArchetype(genre, seed) {
  const pool = ARCHETYPES[String(genre || '').toLowerCase()] || FALLBACK;
  const s = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return pool[s % pool.length];
}

export const ARCHETYPE_GENRES = Object.keys(ARCHETYPES);
