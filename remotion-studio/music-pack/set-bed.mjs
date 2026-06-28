/* Duck a music bed into the video's MusicBed (public/sfx/music.mp3) — loudnorm to a
   subtle level + a short fade-in. Usage: node set-bed.mjs <name>
   e.g. node set-bed.mjs other-world   (names from manifest.json `beds[].name`) */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const name = process.argv[2];
const bed = m.beds.find((b) => b.name === name);
if (!bed) {
  console.error('unknown bed:', name || '(none)', '\navailable:', m.beds.map((b) => b.name).join(', '));
  process.exit(1);
}
const src = path.join(dir, bed.file);
if (!existsSync(src)) { console.error('missing', bed.file, '— run `node fetch.mjs` first'); process.exit(1); }
const out = path.resolve(dir, '..', 'public', 'sfx', 'music.mp3');
execFileSync('ffmpeg', ['-y', '-i', src, '-af', 'loudnorm=I=-26:TP=-3:LRA=11,afade=t=in:d=0.7', '-ar', '44100', out], { stdio: 'ignore' });
console.log(`bed set → ${bed.name} (${bed.mood}).  Re-render to hear it.`);
console.log('note: this overwrites public/sfx/music.mp3 locally; the committed default is the synth pad.');
