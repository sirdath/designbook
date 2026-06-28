/* Catalog the SFX library: scans sfx-pack/*.mp3, categorizes by name, probes
   duration, and writes index.json (machine) + README.md (human) so every sound is
   discoverable by name/category/role. Run: node tools/build-sfx-index.mjs */
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'sfx-pack');
const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.mp3')).sort();

// name → category + role (the vocabulary of the pack)
const CATS = [
  { re: /granular whoosh/i, cat: 'whoosh', role: 'transition — textured swish' },
  { re: /whoosh/i, cat: 'whoosh', role: 'transition — scene-to-scene swish' },
  { re: /granular/i, cat: 'texture', role: 'ambient/granular texture (loopable bed candidate)' },
  { re: /click/i, cat: 'click', role: 'UI click — button / select / pointer' },
  { re: /count/i, cat: 'counter', role: 'number count-up / metric tick (StatBurst)' },
  { re: /data/i, cat: 'data', role: 'data / number reveal' },
  { re: /text/i, cat: 'typing', role: 'typing / text-reveal (per-key or one-shot sweep)' },
  { re: /interface/i, cat: 'interface', role: 'interface open / confirm' },
  { re: /digital/i, cat: 'digital', role: 'digital confirm / blip' },
  { re: /rise/i, cat: 'rise', role: 'rising confirmation (CTA landing)' },
  { re: /hover/i, cat: 'hover', role: 'pointer hover / cursor-arrives' },
  { re: /paper/i, cat: 'paper', role: 'paper / soft reveal' },
];
const classify = (name) => CATS.find((c) => c.re.test(name)) || { cat: 'misc', role: 'uncategorized' };

// which sounds are currently mapped into the video's 7 slots (public/sfx/)
const MAPPED = {
  'whoosh 3': 'whoosh', 'click 3 [all layers]': 'click', 'click 3 [layer 1]': 'key',
  'count [all layers]': 'pop', 'rise [reverb]': 'chime', 'interface open [small]': 'success',
};

const entries = files.map((f) => {
  const name = f.replace(/\.mp3$/i, '');
  const { cat, role } = classify(name);
  let sec = 0;
  try { sec = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DIR, f)], { encoding: 'utf8' }).trim()) || 0; } catch {}
  // tags: words from the name + category + role keywords
  const tags = [...new Set([cat, ...name.toLowerCase().replace(/[\[\]().,]/g, ' ').split(/\s+/).filter((w) => w && w.length > 1 && !/^\d+$/.test(w))])];
  return { name, file: f, category: cat, role, durationSec: Math.round(sec * 100) / 100, mappedSlot: MAPPED[name] || null, tags };
});

const byCat = {};
for (const e of entries) (byCat[e.category] ||= []).push(e);

const index = {
  library: 'designbook-sfx',
  description: 'Owner-supplied UI/video sound-effect pack. The 7-slot video mapping copies picks into remotion-studio/public/sfx/; swap from here by name.',
  count: entries.length,
  categories: Object.fromEntries(Object.entries(byCat).map(([c, es]) => [c, es.length])),
  sounds: entries,
};
writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(index, null, 2));

// human catalog
let md = `# Design Book — SFX library\n\n${entries.length} sound effects, indexed by name. Source: owner-supplied pack.\n`;
md += `Provenance/licence: supplied by the project owner — verify CC0/ownership before redistributing outside this repo.\n\n`;
md += `The video pipeline maps picks into \`remotion-studio/public/sfx/\` (the 7 slots: whoosh·click·key·pop·chime·success + synth \`music\` bed). To swap, point a slot at any \`name\` below.\n\n`;
for (const cat of Object.keys(byCat).sort()) {
  md += `## ${cat} (${byCat[cat].length})\n\n| name | dur | role | mapped slot |\n|---|---|---|---|\n`;
  for (const e of byCat[cat].sort((a, b) => a.name.localeCompare(b.name))) {
    md += `| \`${e.name}\` | ${e.durationSec}s | ${e.role} | ${e.mappedSlot ? '**' + e.mappedSlot + '**' : '—'} |\n`;
  }
  md += '\n';
}
md += `\nRegenerate: \`node tools/build-sfx-index.mjs\`\n`;
writeFileSync(path.join(DIR, 'README.md'), md);

console.log(`indexed ${entries.length} sounds → sfx-pack/index.json + README.md`);
console.log('categories:', JSON.stringify(index.categories));
