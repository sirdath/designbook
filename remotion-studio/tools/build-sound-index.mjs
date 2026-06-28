/* Master sound-library index — unifies the three packs (SFX · music · synth) into
   ONE catalog so any sound is discoverable by name/kind/category/role. Writes
   sounds-index.json (machine) + SOUNDS.md (human). Run: node tools/build-sound-index.mjs */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const durOf = (f) => { try { return Math.round(parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) * 100) / 100; } catch { return null; } };

const sounds = [];

// 1) sfx-pack — owner-supplied, committed
const sfx = JSON.parse(readFileSync(path.join(ROOT, 'sfx-pack/index.json'), 'utf8'));
for (const s of sfx.sounds) sounds.push({ name: s.name, kind: 'sfx', dir: 'sfx-pack/', file: s.file, category: s.category, role: s.role, durationSec: s.durationSec, mappedSlot: s.mappedSlot, license: 'owner-supplied', committed: true });

// 2) music-pack — Mixkit, raw files gitignored
const music = JSON.parse(readFileSync(path.join(ROOT, 'music-pack/manifest.json'), 'utf8'));
for (const b of music.beds) sounds.push({ name: b.name, kind: 'music', dir: 'music-pack/', file: b.file, category: b.genre, role: b.mood, durationSec: b.durationSec, mappedSlot: music.currentBed === b.name ? 'bed' : null, license: 'Mixkit Free (no redistribution)', committed: false, source: b.url });

// 3) synth-pack — procedural, ours, committed
const synthDir = path.join(ROOT, 'synth-pack');
if (existsSync(synthDir)) for (const f of readdirSync(synthDir).filter((f) => f.endsWith('.mp3')).sort()) {
  const n = f.replace(/\.mp3$/, '');
  sounds.push({ name: 'synth-' + n, kind: 'synth', dir: 'synth-pack/', file: f, category: 'synthesized', role: `procedural fallback (${n})`, durationSec: durOf(path.join(synthDir, f)), mappedSlot: null, license: 'CC0 (generated)', committed: true });
}

const byKind = {}; for (const s of sounds) (byKind[s.kind] ||= []).push(s);
const index = {
  collection: 'designbook-sounds',
  description: 'Unified sound library for the video pipeline — SFX (owner pack), music beds (Mixkit, re-fetchable), synth fallbacks. The 7 video slots (whoosh·click·key·pop·chime·success + music bed) map from here into public/sfx/.',
  totals: { ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.length])), total: sounds.length },
  sources: {
    sfx: { dir: 'sfx-pack/', count: (byKind.sfx || []).length, committed: true, license: 'owner-supplied — verify CC0/ownership before redistribution' },
    music: { dir: 'music-pack/', count: (byKind.music || []).length, committed: false, license: 'Mixkit Free — free in videos, no attribution; raw files gitignored, re-fetch via music-pack/fetch.mjs' },
    synth: { dir: 'synth-pack/', count: (byKind.synth || []).length, committed: true, license: 'CC0 — procedurally generated (tools/generate-sfx.mjs)' },
  },
  sounds,
};
writeFileSync(path.join(ROOT, 'sounds-index.json'), JSON.stringify(index, null, 2));

let md = `# Design Book — sound library\n\n${sounds.length} sounds in one catalog (SFX · music beds · synth fallbacks). The video maps picks into \`public/sfx/\`; swap by name.\n\n`;
md += `| source | dir | count | committed | licence |\n|---|---|---|---|---|\n`;
for (const [k, v] of Object.entries(index.sources)) md += `| ${k} | \`${v.dir}\` | ${v.count} | ${v.committed ? 'yes' : 'no (gitignored)'} | ${v.license} |\n`;
md += `\n`;
const sfxByCat = {}; for (const s of byKind.sfx || []) (sfxByCat[s.category] ||= []).push(s);
md += `## SFX (${(byKind.sfx || []).length}) — \`sfx-pack/\`\n\n`;
for (const cat of Object.keys(sfxByCat).sort()) {
  md += `### ${cat} (${sfxByCat[cat].length})\n| name | dur | slot |\n|---|---|---|\n`;
  for (const s of sfxByCat[cat].sort((a, b) => a.name.localeCompare(b.name))) md += `| \`${s.name}\` | ${s.durationSec}s | ${s.mappedSlot ? '**' + s.mappedSlot + '**' : '—'} |\n`;
  md += `\n`;
}
md += `## Music beds (${(byKind.music || []).length}) — \`music-pack/\` · gitignored, \`node music-pack/set-bed.mjs <name>\`\n\n| name | genre | dur | mood |\n|---|---|---|---|\n`;
for (const s of byKind.music || []) md += `| \`${s.name}\` | ${s.category} | ${s.durationSec}s | ${s.role} |\n`;
md += `\n## Synth fallbacks (${(byKind.synth || []).length}) — \`synth-pack/\` · CC0, \`node tools/generate-sfx.mjs\`\n\n| name | dur |\n|---|---|\n`;
for (const s of byKind.synth || []) md += `| \`${s.name}\` | ${s.durationSec}s |\n`;
md += `\nRegenerate: \`node tools/build-sound-index.mjs\`\n`;
writeFileSync(path.join(ROOT, 'SOUNDS.md'), md);

console.log(`indexed ${sounds.length} sounds → sounds-index.json + SOUNDS.md`);
console.log('totals:', JSON.stringify(index.totals));
