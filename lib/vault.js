/* ============================================
   designbook · lib/vault.js — bridge into the frontendmaxxing vault
   ============================================
   Resolves the vault, imports its exported PURE helpers in-process (no MCP
   round-trip — Layer 0 of the architecture), and exposes one `vault` object
   the rest of the app uses. See ARCHITECTURE.md "Vault resolution".
   ============================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { colorAudit } from './color-audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function resolveVaultRoot() {
  const candidates = [
    process.env.FRONTENDMAXXING_PATH && resolve(process.env.FRONTENDMAXXING_PATH),
    resolve(__dirname, '..', '..', 'frontendmaxxing'),  // sibling checkout (local dev — your live vault)
    resolve(__dirname, '..', 'frontendmaxxing'),        // bundled git submodule (fresh recursive clones)
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, 'INDEX.md'))) return c;
  }
  throw new Error(
    'frontendmaxxing vault not found. Run `git submodule update --init`, set FRONTENDMAXXING_PATH, or place designbook/ next to frontendmaxxing/.\nTried: ' + candidates.join(' · ')
  );
}

// Inject a <base> right after <head> so vault-relative hrefs resolve.
// Browser previews use "/vault/", headless renders use file://<vault>/.
export function injectBase(html, href) {
  if (!html) return html;
  if (/<base\s/i.test(html)) return html;
  return String(html).replace(/<head([^>]*)>/i, `<head$1>\n<base href="${href}">`);
}

export async function loadVault() {
  const root = resolveVaultRoot();
  const serverUrl = pathToFileURL(join(root, 'mcp-server', 'server.js')).href;
  // Pure helpers — the module only boots its MCP server when run directly.
  const fm = await import(serverUrl);

  const entries = fm.parseIndex(readFileSync(join(root, 'INDEX.md'), 'utf8'));
  const { search } = fm.buildSearchIndex(entries);
  const { companions } = fm.buildRelations(entries);
  const palettes = fm.parsePalettes(readFileSync(join(root, 'colors', 'palettes.css'), 'utf8'));
  const presets = require(join(root, 'taste', 'presets.js'));

  const byPath = new Map(entries.map((e) => [e.path, e]));
  const palByName = new Map(palettes.map((p) => [p.name, p]));
  const composeDeps = { presets, palByName, search, byPath, companions };

  return {
    root,
    entries,
    palettes,
    presets,
    search,
    byPath,
    genres: Object.keys(fm.GENRE_SEQUENCES),
    mobileGenres: Object.keys(fm.MOBILE_FLOWS || {}),
    deckGenres: Object.keys(fm.DECK_FLOWS || {}),
    aesthetics: presets.AESTHETICS,
    densities: presets.DENSITIES,
    motions: presets.MOTIONS,
    fontPairs: presets.FONT_PAIRS,

    compose(opts) {
      const { genre, preset, palette, aesthetic, density, motion, fontPair, seed } = opts || {};
      const r = fm.composePage(genre, { preset, palette, aesthetic, density, motion, fontPair, seed }, composeDeps);
      // Provenance stamping (research rec #1, the Lovable element-ID pattern,
      // free at compose time): the root element of every section gets
      // data-db-ref="s<i>-<slot>" so diagnostics can cite the exact section an
      // issue lives in and targeted edits can address sections by ref.
      let html = r.html;
      let cursor = 0;
      r.sections.forEach((s, i) => {
        const marker = `<!-- ${s.slot}:`;
        const at = html.indexOf(marker, cursor);
        if (at === -1) return;
        const tagStart = html.indexOf('<', html.indexOf('-->', at) + 3);
        const tagEnd = tagStart !== -1 ? html.indexOf('>', tagStart) : -1;
        if (tagEnd === -1) return;
        const ref = `s${i}-${s.slot}`;
        html = html.slice(0, tagEnd) + ` data-db-ref="${ref}"` + html.slice(tagEnd);
        s.ref = ref;
        cursor = tagEnd + ref.length;
      });
      r.html = html;
      return r;
    },
    // mobile: assemble an app screen flow. Stamps data-db-ref="scr<i>-<shell>"
    // on each device frame so diagnostics/edits can cite a specific screen.
    composeApp(opts) {
      const { genre, preset, palette, aesthetic, density, motion, fontPair, seed } = opts || {};
      const r = fm.composeApp(genre, { preset, palette, aesthetic, density, motion, fontPair, seed }, { presets, palByName });
      let html = r.html;
      let cursor = 0;
      r.screens.forEach((s, i) => {
        const at = html.indexOf('<div class="scr-frame">', cursor);
        if (at === -1) return;
        const ref = `scr${i}-${s.shell}`;
        html = html.slice(0, at) + `<div class="scr-frame" data-db-ref="${ref}">` + html.slice(at + '<div class="scr-frame">'.length);
        s.ref = ref;
        cursor = at + 40;
      });
      r.html = html;
      return r;
    },
    // deck: assemble a 16:9 slide deck. data-db-ref is stamped inside
    // renderComposedDeck already, so this is a thin pass-through.
    composeDeck(opts) {
      const { genre, preset, palette, aesthetic, density, motion, fontPair, seed } = opts || {};
      return fm.composeDeck(genre, { preset, palette, aesthetic, density, motion, fontPair, seed }, { presets, palByName });
    },
    coherence(html) {
      // Vault regex coherence (zero-dep) + a designbook-side perceptual layer
      // (culori). Perceptual findings adjust the score so they flow through
      // book_coherence + the compose score + the save-gate via one wiring point.
      const c = fm.checkCoherence(html);
      const ca = colorAudit(html);
      if (!ca.findings.length) return { ...c, color: ca };
      const score = Math.max(0, Math.round((c.score || 0) - ca.penalty));
      return {
        ...c,
        score,
        ok: score >= 80,
        warnings: [...(c.warnings || []), ...ca.findings.map((f) => f.message)],
        color: ca,
      };
    },
    snippetSource(relPath) {
      const p = String(relPath || '');
      if (!byPath.has(p)) return null;
      return readFileSync(join(root, p), 'utf8');
    },
  };
}
