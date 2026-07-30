#!/usr/bin/env node
// Curate + download the poly.pizza models we ship, refusing anything whose
// licence is no longer CC0 at fetch time.
// usage: node lib/poly-download.mjs <dest-dir> <work-dir>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [dest, work] = process.argv.slice(2);
if (!dest || !work) {
  console.error('usage: poly-download.mjs <dest-dir> <work-dir>');
  process.exit(2);
}

// CURATION (legal-inventory.md): the bipedal creature / anthro-adjacent roster of
// Ultimate Monsters plus the two slimes; six animals kept as head/tail donors.
const WANT_MONSTERS = ['Cat', 'Bunny', 'Frog', 'Dragon', 'Dragon Evolved', 'Yeti', 'Orc', 'Orc Enemy', 'Demon', 'Blue Demon', 'Ghost', 'Pink Slime', 'Green Blob', 'Mushroom King', 'Tribal'];
const WANT_ANIMALS = ['Fox', 'Wolf', 'Husky', 'Shiba Inu', 'Deer', 'Horse'];

const monsters = JSON.parse(readFileSync(`${work}/poly-monsters.json`, 'utf8'));
const animals = JSON.parse(readFileSync(`${work}/poly-animals.json`, 'utf8'));

const pick = (src, names) =>
  names.map((n) => {
    const c = src.models.filter((m) => m.title === n).sort((a, b) => a.tris - b.tris)[0];
    if (!c) throw new Error(`poly.pizza bundle no longer contains "${n}"`);
    // Licence is re-checked at every fetch: an uploader can relicense later.
    if (c.licence !== 'CC0 1.0') throw new Error(`"${n}" is no longer CC0 (${c.licence}) — refusing to vendor`);
    if (c.creator !== 'Quaternius') throw new Error(`"${n}" creator changed to ${c.creator} — refusing to vendor`);
    return c;
  });

const sel = [
  ...pick(monsters, WANT_MONSTERS).map((m) => ({ ...m, pack: 'monsters' })),
  ...pick(animals, WANT_ANIMALS).map((m) => ({ ...m, pack: 'animals' })),
];
writeFileSync(`${work}/poly-selection.json`, `${JSON.stringify(sel, null, 2)}\n`);

for (const m of sel) {
  const f = `${dest}/${m.pack}__${m.title.replace(/ /g, '_')}.glb`;
  if (existsSync(f)) {
    console.log(`  cached ${f.replace(/^.*\//, '')}`);
    continue;
  }
  const res = await fetch(m.glbUrl);
  if (!res.ok) throw new Error(`${m.glbUrl} -> HTTP ${res.status}`);
  writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  console.log(`  got ${f.replace(/^.*\//, '')} (${m.tris} tris, ${m.licence}, ${m.pageUrl})`);
}
