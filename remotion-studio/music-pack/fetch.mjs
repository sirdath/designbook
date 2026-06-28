/* Re-download the background-music beds from manifest.json. The raw mp3s are NOT
   committed (Mixkit Free License forbids redistributing the files standalone) —
   this fetches them locally so renders have a bed. Run: node fetch.mjs */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
console.log(`fetching ${m.beds.length} beds (${m.license.name})…`);
for (const b of m.beds) {
  try {
    execFileSync('curl', ['-sL', '-A', 'Mozilla/5.0', b.url, '-o', path.join(dir, b.file)]);
    console.log('  ✓', b.file, `(${b.genre}, ${b.durationSec}s)`);
  } catch (e) { console.log('  ✗', b.file, '—', e.message); }
}
console.log('done. Apply one with: node set-bed.mjs <name>');
