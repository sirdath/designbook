#!/usr/bin/env node
/* ============================================
   designbook · tools/regression.js — the golden-set quality gate
   ============================================
   Composes a FIXED golden set and re-scores it on every change, failing if
   quality regresses vs the committed baseline. Pure + deterministic — no model
   calls, no headless Chrome — so it runs in CI and locally in <1s and guards
   everything the composer/archetype/coherence layers produce.

   What it asserts per golden page:
     • coherence didn't drop (deterministic compose → a drop is a real regression)
     • no NEW high-severity anti-slop tell appeared
     • the floor invariant holds: a bare compose never reverts to the
       saas-indigo / minimal cliché (the archetype default still fires)

   Usage:
     node tools/regression.js            # check against the baseline (CI gate)
     node tools/regression.js --update    # regenerate the baseline after an
                                          # intentional, reviewed improvement
   ============================================ */
import { loadVault } from '../lib/vault.js';
import { antiSlop } from '../lib/anti-slop.js';
import { defaultArchetype } from '../lib/archetypes.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(__dirname, 'golden-baseline.json');
const COH_TOL = 1; // coherence is deterministic; allow 1pt of noise, fail a real drop

// The golden set: the main genres, with a few landing seeds to exercise the
// archetype variety. Deterministic — same {genre, seed} → same draft.
const GOLDEN = [
  { genre: 'landing', seed: 0 }, { genre: 'landing', seed: 1 }, { genre: 'landing', seed: 2 },
  { genre: 'saas', seed: 0 }, { genre: 'startup', seed: 0 }, { genre: 'agency', seed: 0 },
  { genre: 'portfolio', seed: 0 }, { genre: 'ecommerce', seed: 0 },
  { genre: 'restaurant', seed: 0 }, { genre: 'blog', seed: 0 },
];

const vault = await loadVault();

function scoreOne(spec) {
  const opts = { genre: spec.genre, seed: spec.seed };
  // mirror composeWithScore's floor-raiser: bare compose → curated archetype
  if (!opts.preset && !opts.aesthetic && !opts.palette) opts.preset = defaultArchetype(opts.genre, opts.seed);
  let r;
  try { r = vault.compose(opts); }
  catch (e) { return { key: `${spec.genre}#${spec.seed}`, error: String(e && e.message || e).slice(0, 80) }; }
  const slop = antiSlop(r.html);
  return {
    key: `${spec.genre}#${spec.seed}`,
    coherence: vault.coherence(r.html).score,
    slopHigh: slop.findings.filter((f) => f.severity === 'high').length,
    palette: r.theme.palette,
    aesthetic: r.theme.aesthetic,
  };
}

const current = GOLDEN.map(scoreOne);

if (process.argv.includes('--update')) {
  const bad = current.filter((c) => c.error);
  if (bad.length) { console.error('cannot update — compose failed:', bad.map((b) => `${b.key} (${b.error})`).join(', ')); process.exit(2); }
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log(`baseline updated: ${current.length} golden pages → tools/golden-baseline.json`);
  process.exit(0);
}

if (!existsSync(BASELINE)) { console.error('no baseline — run: node tools/regression.js --update'); process.exit(2); }
const byKey = new Map(JSON.parse(readFileSync(BASELINE, 'utf8')).map((b) => [b.key, b]));

let failures = 0;
console.log('  golden          coherence    slop  theme');
for (const c of current) {
  const b = byKey.get(c.key);
  const issues = [];
  if (c.error) issues.push(`compose FAILED: ${c.error}`);
  else {
    if (b && c.coherence < b.coherence - COH_TOL) issues.push(`coherence ${b.coherence}→${c.coherence}`);
    if (b && c.slopHigh > b.slopHigh) issues.push(`slop ${b.slopHigh}→${c.slopHigh}`);
    if (c.palette === 'saas-indigo') issues.push('FLOOR reverted to saas-indigo');
    if (!b) issues.push('NEW (run --update to baseline)');
  }
  const hard = issues.some((i) => !i.startsWith('NEW'));
  if (hard) failures++;
  const mark = hard ? '✗' : issues.length ? '•' : '✓';
  const stat = c.error ? '  —' : `${String(c.coherence).padStart(3)}${b ? ` (was ${b.coherence})` : ''}`;
  console.log(`${mark} ${c.key.padEnd(13)} ${stat.padEnd(13)} ${c.error ? '' : String(c.slopHigh).padStart(2)}    ${c.error ? '' : `${c.palette}/${c.aesthetic}`}${issues.length ? `   ⚠ ${issues.join('; ')}` : ''}`);
}
console.log(failures ? `\n✗ REGRESSION: ${failures} golden page(s) got worse` : `\n✓ OK: ${current.length} golden pages, no regressions`);
process.exit(failures ? 1 : 0);
