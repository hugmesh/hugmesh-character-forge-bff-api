#!/usr/bin/env node
// Assert every pack.json still describes the bytes on disk.
// usage: node lib/check-manifests.mjs <audit.ndjson> <packs-dir>
import { readFileSync, readdirSync } from 'node:fs';

const [audit, packs] = process.argv.slice(2);
const BUDGET = 60 * 1048576;

const rows = new Map(
  readFileSync(audit, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const r = JSON.parse(l);
      return [r.path.replace(/^.*packs\//, ''), r];
    }),
);

let bad = 0;
let bytes = 0;
const seenPacks = new Map();
for (const dir of readdirSync(packs)) {
  let man;
  try {
    man = JSON.parse(readFileSync(`${packs}/${dir}/pack.json`, 'utf8'));
  } catch {
    continue;
  }
  seenPacks.set(dir, man);
  for (const m of man.models) {
    const key = `${dir}/${m.file}`;
    const row = rows.get(key);
    if (!row) {
      console.error(`  MISSING ${key}`);
      bad++;
      continue;
    }
    bytes += row.bytes;
    if (row.bytes !== m.bytes) {
      console.error(`  STALE bytes ${key}: file ${row.bytes} vs manifest ${m.bytes}`);
      bad++;
    }
    if (row.renderTris !== m.trisAfter) {
      console.error(`  STALE trisAfter ${key}: file ${row.renderTris} vs manifest ${m.trisAfter}`);
      bad++;
    }
    if (!m.licenseSpdx || !m.attribution || !m.sourceUrl || !m.retrievedAt) {
      console.error(`  MISSING licence fields on ${key}`);
      bad++;
    }
    if (row.extensionsRequired.length) {
      console.error(`  NON-CORE EXTENSION REQUIRED ${key}: ${row.extensionsRequired}`);
      bad++;
    }
  }
}
const orphans = [...rows.keys()].filter((k) => {
  const dir = k.split('/')[0];
  try {
    const man = JSON.parse(readFileSync(`${packs}/${dir}/pack.json`, 'utf8'));
    return !man.models.some((m) => `${dir}/${m.file}` === k);
  } catch {
    return true;
  }
});
for (const o of orphans) {
  console.error(`  UNMANIFESTED FILE ${o}`);
  bad++;
}

// ── index.json must agree with the pack.json files it indexes ──────────────
// The index is what the runtime reads (res:// enumeration is unreliable in a
// web export) and what a credits screen renders, so a stale index is a licence
// bug, not a cosmetic one.
let index;
try {
  index = JSON.parse(readFileSync(`${packs}/index.json`, 'utf8'));
} catch {
  console.error('  MISSING index.json — run ./build.sh');
  bad++;
}
if (index) {
  if (index.schema !== '3d-pack-index') {
    console.error(`  index.json schema is '${index.schema}', expected '3d-pack-index'`);
    bad++;
  }
  const indexed = new Set((index.packs || []).map((p) => p.packId));
  for (const dir of seenPacks.keys()) {
    if (!indexed.has(dir)) {
      console.error(`  index.json does not list pack ${dir}`);
      bad++;
    }
  }
  for (const p of index.packs || []) {
    const man = seenPacks.get(p.packId);
    if (!man) {
      console.error(`  index.json lists ${p.packId}, which has no pack.json`);
      bad++;
      continue;
    }
    for (const [field, actual] of [
      ['models', man.totals.models],
      ['bytes', man.totals.bytes],
      ['tris', man.totals.tris],
      ['licenseSpdx', man.licenseSpdx],
      ['attribution', man.attribution],
      ['attributionRequired', man.attributionRequired],
      ['sourceUrl', man.sourceUrl],
      ['retrievedAt', man.retrievedAt],
      ['style', man.style],
      ['rig', man.rig],
      ['visemes', man.visemes],
    ]) {
      if (p[field] !== actual) {
        console.error(`  STALE index.json ${p.packId}.${field}: ${p[field]} vs pack.json ${actual}`);
        bad++;
      }
    }
    if (p.manifest !== `res://assets/packs/${p.packId}/pack.json`) {
      console.error(`  index.json ${p.packId}.manifest is not the res:// path to its pack.json`);
      bad++;
    }
  }
  // Every CC-BY pack must appear in credits[] with required=true: this is the
  // only machine-readable list an in-app credits screen can render, and CC-BY
  // attribution that never reaches the user is a licence violation.
  const credits = new Map((index.credits || []).map((c) => [c.packId, c]));
  for (const [dir, man] of seenPacks) {
    const c = credits.get(dir);
    if (!c) {
      console.error(`  index.json credits[] omits ${dir}`);
      bad++;
      continue;
    }
    if (c.required !== man.attributionRequired || c.attribution !== man.attribution) {
      console.error(`  index.json credits[] for ${dir} disagrees with its pack.json`);
      bad++;
    }
    if (man.attributionRequired && !c.attribution) {
      console.error(`  ${dir} is CC-BY but its credits entry has no attribution text`);
      bad++;
    }
  }
  if (index.totals?.bytes !== bytes || index.totals?.models !== rows.size) {
    console.error(
      `  STALE index.json totals: ${index.totals?.models} models / ${index.totals?.bytes} bytes` +
        ` vs measured ${rows.size} / ${bytes}`,
    );
    bad++;
  }
}

console.log(`  ${rows.size} assets, ${(bytes / 1048576).toFixed(2)} MB committed`);
if (bytes > BUDGET) {
  console.error(`  OVER BUDGET: ${(bytes / 1048576).toFixed(2)} MB > 60 MB`);
  bad++;
}
process.exit(bad ? 1 : 0);
