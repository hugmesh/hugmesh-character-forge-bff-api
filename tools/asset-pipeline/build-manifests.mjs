#!/usr/bin/env node
/**
 * build-manifests.mjs — write assets/packs/<id>/pack.json (schema "3d-pack"),
 * assets/packs/index.json (schema "3d-pack-index") and the repo-root
 * THIRD_PARTY_ASSETS.md from sources.json + the audit run.
 *
 * The licence facts come from sources.json ONLY (single source of truth); the
 * per-model numbers come from audit.mjs reading the ACTUAL committed bytes, so
 * a manifest can never claim a triangle count the file does not have.
 *
 * usage: node build-manifests.mjs <audit.ndjson>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '../..');
const PACKS = resolve(REPO, 'godot/character-forge/assets/packs');
const TRI_BUDGET = 16000; // technique.md: 5-15k tris/avatar on Quest 3 browser
const TRI_TARGET = 10000;

const sources = JSON.parse(readFileSync(resolve(HERE, 'sources.json'), 'utf8'));
const auditPath = process.argv[2] || resolve(HERE, '.work/audit.ndjson');
const rows = readFileSync(auditPath, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const polySelPath = resolve(HERE, '.work/poly-selection.json');
const polySel = existsSync(polySelPath) ? JSON.parse(readFileSync(polySelPath, 'utf8')) : [];
const polyByFile = new Map(polySel.map((m) => [`${m.title.replace(/ /g, '_').toLowerCase()}.glb`, m]));

// Written by build.sh's decimation loop: { "<pack>/<file>": {before, after} } for
// the files simplify.mjs actually rewrote. Absent/empty means nothing needed
// decimating — which is NOT the same thing as "we did not try", so the manifest
// states `decimated` explicitly on every model instead of leaving it inferred.
const decPath = resolve(HERE, '.work/decimated.json');
const decimatedMap = existsSync(decPath) ? JSON.parse(readFileSync(decPath, 'utf8')) : {};

const titleCase = (s) =>
  s
    .replace(/\.(glb|vrm)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

function classify(pack, row) {
  const rel = row.path.split(`${pack.id}/`)[1] || row.file;
  if (rel.startsWith('anim/')) return 'animation-library';
  if (pack.id === 'quaternius-outfits-v1') return 'part';
  if (/^(hair_|eyebrows_)/.test(row.file)) return 'part';
  return 'character';
}

const packRows = new Map();
for (const row of rows) {
  const m = row.path.match(/packs\/([^/]+)\//);
  if (!m) continue;
  if (!packRows.has(m[1])) packRows.set(m[1], []);
  packRows.get(m[1]).push(row);
}

const LICENSE_URLS = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
};

const attributions = [];
const indexPacks = [];
let grandBytes = 0;
let grandModels = 0;

for (const pack of sources.packs) {
  const mine = (packRows.get(pack.id) || []).sort((a, b) => a.file.localeCompare(b.file));
  if (!mine.length) {
    console.error(`WARN: no files found for pack ${pack.id}`);
    continue;
  }
  const models = mine.map((row) => {
    const kind = classify(pack, row);
    const poly = polyByFile.get(row.file);
    const flags = [];
    if (kind !== 'animation-library' && row.renderTris > TRI_BUDGET) {
      flags.push(`over-tri-budget: ${row.renderTris} rendered tris > ${TRI_BUDGET}; decimation to ~${TRI_TARGET} deferred (see pack notes)`);
    }
    if (row.extensionsRequired.length) flags.push(`extensionsRequired: ${row.extensionsRequired.join(',')}`);
    if (kind === 'character' && row.joints > 75) flags.push(`${row.joints} joints exceeds the ~75-bone Quest budget (technique.md)`);
    if (kind === 'character' && !row.hasJawBone && !row.visemes) flags.push('no jaw bone and no visemes — lip-sync channel must be added by the assembler');
    const relFile = row.path.split(`${pack.id}/`)[1];
    const dec = decimatedMap[`${pack.id}/${relFile}`] || null;
    return {
      id: row.file.replace(/\.(glb|vrm)$/i, ''),
      displayName: titleCase(row.file),
      file: relFile,
      kind,
      style: pack.style,
      rig: kind === 'part' && !row.skins ? 'none' : pack.rig,
      visemes: row.visemes,
      // trisAfter = rendered triangles measured on the COMMITTED bytes (the
      // Quest-3 budget number, re-asserted by the Godot self-test).
      trisAfter: row.renderTris,
      trisUnique: row.tris,
      // Decimation provenance. `decimated` is false for everything that already
      // fitted the budget after slimming; trisBeforeDecimation is only non-null
      // when simplify.mjs actually rewrote the file.
      decimated: !!dec,
      trisBeforeDecimation: dec ? dec.before : null,
      // What the VENDOR's own page reported at retrieval time (poly.pizza model
      // metadata). Kept for provenance only: it is measured differently from our
      // audit (vendor counts vary with instancing/dedup), so it is NOT a
      // before/after pair with trisAfter and must never be read as one.
      vendorReportedTris: poly ? poly.tris : null,
      vertices: row.verts,
      bytes: row.bytes,
      joints: row.joints,
      hasJawBone: row.hasJawBone,
      // The jaw BONES (skin joints, never mesh nodes) the lip-sync channel could
      // drive. Empty on every pack we ship — recorded explicitly so the claim is
      // falsifiable: assets/packs/verify_packs.gd re-derives it from the imported
      // Skeleton3D and fails if a manifest ever disagrees with the rig.
      jawBones: row.jawBones || [],
      materials: row.materials,
      textures: row.textures,
      animationCount: row.animations.length,
      animations: row.animations.length <= 12 ? row.animations : [...row.animations.slice(0, 12), `…+${row.animations.length - 12} more`],
      visemeChannels: row.visemes ? row.visemeCandidates : [],
      extensionsUsed: row.extensionsUsed,
      licenseSpdx: pack.licenseSpdx,
      attribution: pack.attribution,
      sourceUrl: poly ? poly.pageUrl : pack.sourceUrl,
      retrievedAt: sources.retrievedAt,
      flags,
    };
  });

  const bytes = models.reduce((a, m) => a + m.bytes, 0);
  grandBytes += bytes;
  grandModels += models.length;

  const manifest = {
    packId: pack.id,
    schema: '3d-pack',
    schemaVersion: 1,
    version: '1.0.0',
    displayName: pack.displayName,
    licenseSpdx: pack.licenseSpdx,
    attribution: pack.attribution,
    attributionRequired: pack.attributionRequired,
    sourceUrl: pack.sourceUrl,
    downloadUrl: pack.downloadUrl,
    retrievedAt: sources.retrievedAt,
    licenseQuote: pack.licenseQuote,
    notes: pack.notes,
    style: pack.style,
    rig: pack.rig,
    visemes: pack.visemes,
    totals: { models: models.length, bytes, tris: models.reduce((a, m) => a + m.trisAfter, 0) },
    models,
  };
  writeFileSync(resolve(PACKS, pack.id, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${pack.id.padEnd(32)} ${String(models.length).padStart(3)} files  ${(bytes / 1048576).toFixed(2)} MB  ${pack.licenseSpdx}`);

  indexPacks.push({
    packId: pack.id,
    displayName: pack.displayName,
    manifest: `res://assets/packs/${pack.id}/pack.json`,
    dir: `res://assets/packs/${pack.id}`,
    style: pack.style,
    rig: pack.rig,
    visemes: pack.visemes,
    models: models.length,
    bytes,
    tris: manifest.totals.tris,
    licenseSpdx: pack.licenseSpdx,
    licenseUrl: LICENSE_URLS[pack.licenseSpdx] || null,
    attributionRequired: pack.attributionRequired,
    attribution: pack.attribution,
    sourceUrl: pack.sourceUrl,
    retrievedAt: sources.retrievedAt,
  });

  if (pack.attributionRequired) attributions.push(pack);
}

// ── assets/packs/index.json ────────────────────────────────────────────────
// Why this file exists, and why it is generated rather than hand-kept:
//
//  1. res:// directory enumeration is not dependable in an exported web build
//     (only what the export filter actually packed is listed), so the runtime
//     must be told which packs exist instead of discovering them.
//  2. CC-BY-3.0/4.0 REQUIRE the attribution to be visible to the user, not just
//     sitting in a repo markdown file. `credits[]` is the data source a credits
//     screen renders; `required` marks the entries that are legally mandatory
//     (CC0 packs are listed too, because we credit them anyway).
//
// It carries no facts of its own: every field is copied from the same
// sources.json/audit pair that produced the per-pack manifests, and
// lib/check-manifests.mjs + assets/packs/verify_packs.gd both re-derive it from
// the pack.json files, so it cannot silently drift.
const index = {
  schema: '3d-pack-index',
  schemaVersion: 1,
  generatedBy: 'tools/asset-pipeline/build-manifests.mjs',
  retrievedAt: sources.retrievedAt,
  totals: {
    packs: indexPacks.length,
    models: grandModels,
    bytes: grandBytes,
    budgetBytes: 60 * 1048576,
  },
  packs: indexPacks,
  credits: indexPacks.map((p) => ({
    packId: p.packId,
    displayName: p.displayName,
    required: p.attributionRequired,
    licenseSpdx: p.licenseSpdx,
    licenseUrl: p.licenseUrl,
    attribution: p.attribution,
    sourceUrl: p.sourceUrl,
    retrievedAt: p.retrievedAt,
  })),
  notShipped: sources.notShipped.map((n) => ({
    id: n.id,
    sourceUrl: n.sourceUrl,
    licenseSpdx: n.licenseSpdx,
    reason: n.reason,
  })),
};
writeFileSync(resolve(PACKS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

// ── THIRD_PARTY_ASSETS.md ──────────────────────────────────────────────────
const cc0 = sources.packs.filter((p) => !p.attributionRequired);
const md = `# Third-party assets — hugmesh-character-forge-bff-api

Repo-wide aggregation of every third-party asset vendored into this repository.
**Generated by \`tools/asset-pipeline/build-manifests.mjs\` — do not hand-edit;
change \`tools/asset-pipeline/sources.json\` and re-run \`./build.sh\`.**

Machine-readable per-model provenance (\`licenseSpdx\` / \`attribution\` /
\`sourceUrl\` / \`retrievedAt\`, plus the measured triangle/bone/viseme audit) lives
in \`godot/character-forge/assets/packs/<packId>/pack.json\`.

Vendored *code* (the godot-vrm and MToon addons) is tracked separately in
\`godot/character-forge/THIRD_PARTY_ASSETS.md\` +
\`godot/character-forge/addons/THIRD_PARTY_MANIFEST.json\`.

## License discipline (binding)

Only CC0 / CC-BY items carrying a positive redistribution verdict in the XR-chat
research reports (\`legal-inventory.md\`, \`kemono.md\`, \`jrpg-bases.md\`,
\`link-audit.md\`) may be vendored. **Nothing** from Mixamo, Synty, VRoid Hub,
BOOTH, CGTrader, or unverified Sketchfab uploads. VRoid meshes ship only as
fixed whole avatars and never enter the part-mixer (pixiv VRoid Studio guideline).
Every file gets a \`pack.json\` entry with its licence quoted from the source.

## Where the licence is enforced at runtime

The manifests below are not the only place this discipline lives — the code
refuses to load an asset that lacks them:

| Layer | File | What it enforces |
| --- | --- | --- |
| Basis registry | \`godot/character-forge/scripts/part_registry.gd\` | A mesh basis is REJECTED (family stays procedural) unless it carries \`licenseSpdx\` on the CC0/CC-BY/MIT allow-list plus \`attribution\`, \`sourceUrl\` and an ISO \`retrievedAt\`. |
| Pack library | \`godot/character-forge/scripts/pack_library.gd\` | Copies those four fields verbatim out of \`pack.json\` into the registry entry; a catalogue that fails to load leaves every family procedural. |
| Lane build | \`tools/asset-pipeline/build-lanes.mjs\` | Fails the build when a lane names a pack, model, family or palette region that does not exist. |
| Engine tests | \`godot/character-forge/tests/run_tests.gd\` | Asserts every catalogue entry passes the licence gate, that each \`glb\` path exists on disk, and that an NC licence is still refused. |
| In-app credit | \`frontend/src/app/character-forge/panels/pack-selector.component.html\` | Shows the licence and credit on every model card — what discharges the CC-BY visibility requirement. |

User-imported models never enter any of this: the importer reads the file in
the browser, hands the bytes to the engine, and surfaces the file's OWN
in-file licence terms. Nothing imported is uploaded, stored or redistributed.

## Attribution required (CC-BY — must also be shown in-app)

${attributions
  .map(
    (p) => `### ${p.displayName}
- **License:** ${p.licenseSpdx}
- **Credit:** ${p.attribution}
- **Source:** ${p.sourceUrl}
- **Retrieved:** ${sources.retrievedAt}
- **Path:** \`godot/character-forge/assets/packs/${p.id}/\`
- **Licence text as read at the source:**
  > ${p.licenseQuote.replace(/\n/g, '\n  > ')}
${p.notes ? `- **Notes:** ${p.notes}\n` : ''}`,
  )
  .join('\n')}
## Public domain dedication (CC0 — credit not required, given anyway)

${cc0
  .map(
    (p) => `### ${p.displayName}
- **License:** ${p.licenseSpdx} · **Author:** ${p.attribution}
- **Source:** ${p.sourceUrl} · **Retrieved:** ${sources.retrievedAt}
- **Path:** \`godot/character-forge/assets/packs/${p.id}/\`
- **Licence text as read at the source:**
  > ${p.licenseQuote.replace(/\n/g, '\n  > ')}
${p.notes ? `- **Notes:** ${p.notes}\n` : ''}`,
  )
  .join('\n')}
## Evaluated and deliberately NOT vendored

${sources.notShipped.map((n) => `- **${n.id}** (${n.licenseSpdx}) — ${n.sourceUrl}\n  ${n.reason}`).join('\n')}

---

Committed pack payload: **${grandModels} files, ${(grandBytes / 1048576).toFixed(1)} MB** (budget: 60 MB).
`;
writeFileSync(resolve(REPO, 'THIRD_PARTY_ASSETS.md'), md);
console.log(`\nTOTAL ${grandModels} files, ${(grandBytes / 1048576).toFixed(2)} MB (budget 60 MB)`);
if (grandBytes > 60 * 1048576) {
  console.error('FAIL: committed pack payload exceeds the 60 MB budget');
  process.exit(1);
}
