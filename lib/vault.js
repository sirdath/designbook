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
    coherence(html) {
      return fm.checkCoherence(html);
    },
    snippetSource(relPath) {
      const p = String(relPath || '');
      if (!byPath.has(p)) return null;
      return readFileSync(join(root, p), 'utf8');
    },
  };
}
