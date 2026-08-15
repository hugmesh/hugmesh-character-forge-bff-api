#!/usr/bin/env node
/**
 * build-lanes.mjs — resolve lanes.json against the committed pack manifests and
 * emit the two files that wire the vendored packs into the runtime:
 *
 *   godot/character-forge/assets/packs/lanes.json
 *       read by scripts/pack_library.gd, which turns it into a populated
 *       CharForgeRegistry (basis per head family / body archetype).
 *   frontend/src/app/character-forge/models/pack-catalog.generated.ts
 *       read by the Angular character selector, so the style tabs list exactly
 *       the models the engine can actually load — including when the engine
 *       bundle is not baked yet.
 *
 * Nothing here invents facts. Licence fields come from pack.json (which
 * build-manifests.mjs copies from sources.json), the geometry numbers come from
 * the audit of the committed bytes, and the enums are read out of
 * scripts/char3d_config.gd so a lane can never name a family the engine does
 * not have. Any mismatch is a hard failure, not a warning.
 *
 * usage: node build-lanes.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { headTriangles } from './glb-head-tris.mjs';

/**
 * Joint-name globs that define "the head" on a donor rig. MUST stay identical
 * to CharForgeMeshSurgery.DEFAULT_HEAD_JOINTS in
 * godot/character-forge/scripts/mesh_surgery.gd — tests/run_tests.gd asserts the
 * two produce the same triangle count for every shipped donor, so a change here
 * that is not mirrored there fails the Godot suite by name.
 */
const HEAD_JOINT_PATTERNS = ['Head', 'Ear*', 'Horn*', 'Antler*', 'Jaw*'];

/**
 * `--check` regenerates BOTH outputs in memory and diffs them against what is
 * committed, writing nothing and exiting 1 on any difference.
 *
 * It exists because the engine's lanes.json and the frontend's generated
 * catalogue are the SAME data compiled twice, and nothing in CI compared them:
 * the Angular suite reads only the frontend copy and the Godot suite reads only
 * the engine copy, so both stayed green while ten lane keys disagreed and 24% of
 * the catalogue was dead in the browser. The single thing that had ever kept
 * them in step was somebody remembering to run this script.
 */
const CHECK = process.argv.includes('--check');
const drift = [];
const emit = (path, content) => {
  if (!CHECK) {
    writeFileSync(path, content);
    return;
  }
  let current = null;
  try { current = readFileSync(path, 'utf8'); } catch { current = null; }
  if (current !== content) {
    drift.push(current === null ? `${path} (missing)` : path);
  }
};
import { dirname, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, '../..');
const PACKS = resolve(REPO, 'godot/character-forge/assets/packs');
const CONFIG_GD = resolve(REPO, 'godot/character-forge/scripts/char3d_config.gd');
const CATALOG_TS = resolve(
  REPO,
  'frontend/src/app/character-forge/models/pack-catalog.generated.ts',
);

const errors = [];
const fail = (msg) => errors.push(msg);

/**
 * Pull a `const NAME := ["a", "b", ...]` array literal out of the GDScript
 * contract. Reading the enums from the engine's own source (instead of copying
 * them here) is what makes "the lane names a family the assembler knows" a
 * checked fact rather than a hope.
 */
function gdArray(source, name) {
  const start = source.indexOf(`const ${name} := [`);
  if (start < 0) throw new Error(`char3d_config.gd has no const ${name}`);
  const open = source.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']' && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`unterminated ${name} literal in char3d_config.gd`);
  return [...source.slice(open, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const gd = readFileSync(CONFIG_GD, 'utf8');
const FAMILIES = gdArray(gd, 'FAMILIES');
const REGIONS = gdArray(gd, 'ALL_MATERIAL_REGIONS');
const STYLES = gdArray(gd, 'STYLES');

const lanesSrc = JSON.parse(readFileSync(resolve(HERE, 'lanes.json'), 'utf8'));
const index = JSON.parse(readFileSync(resolve(PACKS, 'index.json'), 'utf8'));

const manifests = new Map();
for (const p of index.packs) {
  manifests.set(p.packId, JSON.parse(readFileSync(resolve(PACKS, p.packId, 'pack.json'), 'utf8')));
}

// ── material policy ─────────────────────────────────────────────────────────
// A "map" policy must cover EVERY material in the pack, not merely the ones the
// lanes happen to reference: an unmapped slot silently falls back to the fur
// region at load time, which is exactly the kind of quiet wrongness that only
// shows up as a miscoloured avatar in VR.
const policies = {};
for (const [packId, policy] of Object.entries(lanesSrc.materialPolicy)) {
  const manifest = manifests.get(packId);
  if (!manifest) {
    fail(`materialPolicy names unknown pack '${packId}'`);
    continue;
  }
  if (!['map', 'preserve'].includes(policy.policy)) {
    fail(`${packId}: policy must be 'map' or 'preserve', got '${policy.policy}'`);
  }
  if (!policy.reason || policy.reason.length < 20) {
    fail(`${packId}: a material policy needs a real reason`);
  }
  const slots = policy.slots || {};
  for (const [slot, region] of Object.entries(slots)) {
    if (!REGIONS.includes(region)) {
      fail(`${packId}: slot '${slot}' maps to unknown palette region '${region}'`);
    }
  }
  if (policy.policy === 'map') {
    const present = new Set();
    for (const m of manifest.models) for (const mat of m.materials) present.add(mat);
    for (const mat of present) {
      if (!(mat in slots)) fail(`${packId}: material '${mat}' has no palette region`);
    }
    for (const slot of Object.keys(slots)) {
      if (!present.has(slot)) fail(`${packId}: slot map names '${slot}', which the pack does not have`);
    }
  } else if (Object.keys(slots).length) {
    fail(`${packId}: a 'preserve' policy must not carry a slot map`);
  }
  for (const slot of Object.keys(policy.unverifiedSlots || {})) {
    if (!(slot in slots)) fail(`${packId}: unverifiedSlots names '${slot}', which is not in the slot map`);
  }
  policies[packId] = policy;
}
for (const packId of manifests.keys()) {
  if (!(packId in policies)) fail(`pack '${packId}' has no material policy in lanes.json`);
}

// ── lanes ───────────────────────────────────────────────────────────────────
const MOUNTS = Object.keys(lanesSrc.mounts);
const seenKeys = new Set();
const lanes = [];

for (const lane of lanesSrc.lanes) {
  for (const family of lane.proceduralFamilies || []) {
    if (!FAMILIES.includes(family)) fail(`lane ${lane.id}: unknown procedural family '${family}'`);
  }
  const entries = [];
  for (const entry of lane.entries) {
    const where = `lane ${lane.id} entry ${entry.key}`;
    if (seenKeys.has(entry.key)) fail(`${where}: duplicate key`);
    seenKeys.add(entry.key);
    if (!MOUNTS.includes(entry.mount)) fail(`${where}: unknown mount '${entry.mount}'`);
    if (!FAMILIES.includes(entry.family)) fail(`${where}: unknown head family '${entry.family}'`);
    if (!FAMILIES.includes(entry.archetype)) fail(`${where}: unknown body archetype '${entry.archetype}'`);
    if (!STYLES.includes(entry.style)) fail(`${where}: unknown style '${entry.style}'`);
    if (!entry.notes || entry.notes.length < 10) fail(`${where}: needs a note`);

    // hiddenMeshes: glTF NODE names to hide at mount time (KayKit packs every
    // weapon and shield of the set into each character file). The names cannot
    // be checked here — pack.json records materials, not node names — so this
    // only enforces shape; the ENGINE test walks each model and fails on a name
    // that matches nothing (tests/run_tests.gd::_test_pack_hidden_meshes_exist).
    const hidden = entry.hiddenMeshes ?? [];
    if (!Array.isArray(hidden)) fail(`${where}: hiddenMeshes must be an array`);
    else {
      if (new Set(hidden).size !== hidden.length) fail(`${where}: hiddenMeshes has duplicates`);
      for (const n of hidden) {
        if (typeof n !== 'string' || !n.trim()) fail(`${where}: hiddenMeshes holds a blank name`);
      }
    }

    const manifest = manifests.get(entry.packId);
    if (!manifest) {
      fail(`${where}: unknown packId '${entry.packId}'`);
      continue;
    }
    const model = manifest.models.find((m) => m.id === entry.modelId);
    if (!model) {
      fail(`${where}: pack ${entry.packId} has no model '${entry.modelId}'`);
      continue;
    }

    // A COMPOSED SET (extraPieces): modular garment pieces skinned to the same
    // rig, merged onto one skeleton at mount time. Its primary is a `part`
    // rather than a `character` — that is the only case where a part may be
    // named by a lane, and it must bring at least one sibling piece with it.
    const extra = entry.extraPieces ?? [];
    if (!Array.isArray(extra)) fail(`${where}: extraPieces must be an array`);
    const pieces = [];
    let tris = model.trisAfter;
    let bytes = model.bytes;
    for (const pieceId of Array.isArray(extra) ? extra : []) {
      const piece = manifest.models.find((m) => m.id === pieceId);
      if (!piece) {
        fail(`${where}: pack ${entry.packId} has no piece '${pieceId}'`);
        continue;
      }
      if (piece.kind !== 'part') {
        fail(`${where}: piece '${pieceId}' is a ${piece.kind}, not a part`);
      }
      if (piece.joints !== model.joints) {
        // Re-parenting a skinned mesh onto another skeleton only works when the
        // rigs agree; a mismatch here would render as a collapsed mesh.
        fail(`${where}: piece '${pieceId}' has ${piece.joints} joints, the set's `
          + `primary has ${model.joints} — they cannot share a skeleton`);
      }
      pieces.push(`res://assets/packs/${entry.packId}/${piece.file}`);
      tris += piece.trisAfter;
      bytes += piece.bytes;
    }
    if (pieces.length === 0 && model.kind !== 'character') {
      fail(`${where}: model '${entry.modelId}' is a ${model.kind}, not a character`);
    }
    const policy = policies[entry.packId] || { policy: 'preserve' };

    // A HEAD DONOR: a second vendored model whose head is split off by bone
    // weight at mount time (mesh_surgery.gd) and grafted onto this body's head
    // bone. Only meaningful on the `body` mount, where a head is grafted at all.
    //
    // The donor is a SEPARATE third-party asset appearing in the same avatar, so
    // its licence/attribution travel with it rather than being folded into the
    // body's, and its triangles are added to the entry's budget — an avatar that
    // reports only the body's cost under-states what the GPU draws.
    let headDonor = null;
    if (entry.headDonor) {
      const d = entry.headDonor;
      const dm = manifests.get(d.packId);
      const dModel = dm?.models.find((m) => m.id === d.modelId);
      if (!dm) {
        fail(`${where}: headDonor names unknown packId '${d.packId}'`);
      } else if (!dModel) {
        fail(`${where}: headDonor pack ${d.packId} has no model '${d.modelId}'`);
      } else if (entry.mount !== 'body') {
        fail(`${where}: headDonor only applies to the 'body' mount, not '${entry.mount}'`);
      } else {
        const dPolicy = policies[d.packId] || { policy: 'preserve' };
        const patterns = d.headJoints ?? HEAD_JOINT_PATTERNS;
        const glb = `godot/character-forge/assets/packs/${d.packId}/${dModel.file}`;
        let measured = null;
        try {
          measured = headTriangles(resolve(REPO, glb), patterns, 0.5);
        } catch (err) {
          fail(`${where}: headDonor '${d.modelId}' cannot be split — ${err.message}`);
        }
        if (measured) {
          headDonor = {
            packId: d.packId,
            modelId: d.modelId,
            displayName: dModel.displayName ?? d.modelId,
            glb: `res://assets/packs/${d.packId}/${dModel.file}`,
            headJoints: patterns,
            keepSeam: d.keepSeam !== false,
            // MEASURED off the committed bytes by the same rule the engine
            // applies, and asserted equal to the engine's own extraction by
            // tests/run_tests.gd. Never estimated, never the whole quadruped.
            tris: measured.triangles,
            pureTris: measured.pureTriangles,
            seamTris: measured.seamTriangles,
            vertices: measured.vertices,
            joints: measured.joints,
            slots: dPolicy.policy === 'map' ? dPolicy.slots : {},
            preserveMaterials: dPolicy.policy !== 'map',
            licenseSpdx: dModel.licenseSpdx,
            attribution: dModel.attribution,
            sourceUrl: dModel.sourceUrl,
            retrievedAt: dModel.retrievedAt,
          };
          tris += measured.triangles;
          // The donor GLB is downloaded whole even though only its head is used:
          // the split happens after the file is in memory, so the byte cost the
          // selector shows has to include all of it.
          bytes += dModel.bytes;
        }
      }
    }

    entries.push({
      key: entry.key,
      displayName: entry.displayName,
      lane: lane.id,
      packId: entry.packId,
      modelId: entry.modelId,
      // The res:// path the runtime loader opens. Built here (not in GDScript)
      // so a typo fails the build instead of the avatar.
      glb: `res://assets/packs/${entry.packId}/${model.file}`,
      // Additional GLBs merged onto the primary's skeleton at mount time.
      pieces,
      // Same asset addressed from the frontend's point of view, for the "what
      // would this cost to download" column in the selector.
      family: entry.family,
      archetype: entry.archetype,
      mount: entry.mount,
      style: entry.style,
      partMixable: entry.partMixable !== false,
      wholeAvatar: entry.mount === 'avatar',
      rig: model.file.toLowerCase().endsWith('.vrm') ? 'vrm' : manifest.rig,
      visemes: !!model.visemes,
      hasJawBone: !!model.hasJawBone,
      // Whole-SET cost for a composed entry: the selector's Quest-budget flag
      // has to weigh what actually ends up on screen, not just the first piece.
      tris,
      joints: model.joints,
      bytes,
      recolorable: policy.policy === 'map',
      materialPolicy: policy.policy,
      slots: policy.policy === 'map' ? policy.slots : {},
      // Engine-only (scripts/pack_mount.gd) — deliberately NOT in the frontend
      // catalog: the selector shows what a model IS, not how it is assembled.
      hiddenMeshes: Array.isArray(hidden) ? [...hidden] : [],
      // Engine-only: the frontend gets only the summary fields below, because
      // the selector shows what a model IS, not how it is assembled.
      ...(headDonor ? { headDonor } : {}),
      licenseSpdx: model.licenseSpdx,
      licenseUrl: index.packs.find((p) => p.packId === entry.packId).licenseUrl,
      attributionRequired: manifest.attributionRequired,
      attribution: model.attribution,
      sourceUrl: model.sourceUrl,
      retrievedAt: model.retrievedAt,
      flags: model.flags,
      notes: entry.notes,
    });
  }
  lanes.push({
    id: lane.id,
    displayName: lane.displayName,
    summary: lane.summary,
    proceduralFamilies: lane.proceduralFamilies || [],
    entries,
  });
}

// ── every vendored pack must be REACHABLE, or say why not ───────────────────
// A pack with no lane entry is invisible to both the engine and the selector.
// That is sometimes correct (donor geometry, a test fixture) but it must be a
// decision on the record, not an oversight nobody noticed.
const lanedPacks = new Set(lanes.flatMap((l) => l.entries.map((e) => e.packId)));
const unlaned = lanesSrc.unlaned ?? {};
for (const packId of manifests.keys()) {
  if (lanedPacks.has(packId)) {
    if (packId in unlaned) fail(`pack '${packId}' is BOTH laned and listed as unlaned`);
    continue;
  }
  const reason = unlaned[packId];
  if (!reason || reason.length < 40) {
    fail(`pack '${packId}' has no lane entry and no recorded reason in lanes.json unlaned{}`);
  }
}
for (const packId of Object.keys(unlaned)) {
  if (!manifests.has(packId)) fail(`unlaned names unknown pack '${packId}'`);
}

if (errors.length) {
  console.error('build-lanes FAILED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const out = {
  schema: '3d-pack-lanes',
  schemaVersion: 1,
  generatedBy: 'tools/asset-pipeline/build-lanes.mjs',
  retrievedAt: index.retrievedAt,
  mounts: lanesSrc.mounts,
  materialPolicy: policies,
  lanes,
  blocked: lanesSrc.blocked,
  unlaned,
  totals: {
    lanes: lanes.length,
    entries: lanes.reduce((a, l) => a + l.entries.length, 0),
    recolorable: lanes.reduce((a, l) => a + l.entries.filter((e) => e.recolorable).length, 0),
  },
};
emit(resolve(PACKS, 'lanes.json'), `${JSON.stringify(out, null, 2)}\n`);

// ── frontend catalog ────────────────────────────────────────────────────────
const ts = `/**
 * GENERATED by tools/asset-pipeline/build-lanes.mjs — do not edit.
 * Source of truth: tools/asset-pipeline/lanes.json + the committed pack.json
 * manifests. Re-run \`node tools/asset-pipeline/build-lanes.mjs\` after changing
 * either. The Godot side reads the same data from
 * godot/character-forge/assets/packs/lanes.json, so the selector can never
 * offer a model the engine cannot load.
 */

/** How a catalog entry mounts onto the assembler rig (see lanes.json mounts). */
export type PackMount = ${MOUNTS.map((m) => `'${m}'`).join(' | ')};

export interface PackCatalogEntry {
  readonly key: string;
  readonly displayName: string;
  readonly lane: string;
  readonly packId: string;
  readonly modelId: string;
  /** Extra GLBs merged onto this model's skeleton (composed outfit sets). */
  readonly pieceCount: number;
  readonly family: string;
  readonly archetype: string;
  readonly mount: PackMount;
  readonly style: string;
  /** False for VRoid-derived meshes: pixiv's guideline bars recombining them. */
  readonly partMixable: boolean;
  readonly rig: string;
  readonly visemes: boolean;
  readonly hasJawBone: boolean;
  readonly tris: number;
  readonly joints: number;
  readonly bytes: number;
  /** False for single-atlas packs — per-region colours do not apply to them. */
  readonly recolorable: boolean;
  /**
   * A SECOND vendored model whose head is split off by bone weight at mount
   * time and grafted onto this body. Null for every ordinary entry.
   *
   * Present in the catalogue because the donor is a separate third-party asset
   * on screen at the same time: a credits view that named only the body would
   * under-report it. Its \`tris\` here is the head's MEASURED contribution and
   * is already included in the entry's own \`tris\` total.
   */
  readonly headDonor: {
    readonly modelId: string;
    readonly displayName: string;
    readonly tris: number;
    readonly licenseSpdx: string;
    readonly attribution: string;
    readonly sourceUrl: string;
  } | null;
  readonly licenseSpdx: string;
  readonly licenseUrl: string | null;
  readonly attributionRequired: boolean;
  readonly attribution: string;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly flags: readonly string[];
  readonly notes: string;
}

export interface PackCatalogLane {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  /** Families this lane can render with no asset at all (procedural basis). */
  readonly proceduralFamilies: readonly string[];
  readonly entries: readonly PackCatalogEntry[];
}

export const PACK_CATALOG: readonly PackCatalogLane[] = ${JSON.stringify(
  lanes.map((l) => ({
    id: l.id,
    displayName: l.displayName,
    summary: l.summary,
    proceduralFamilies: l.proceduralFamilies,
    entries: l.entries.map((e) => ({
      key: e.key,
      displayName: e.displayName,
      lane: e.lane,
      packId: e.packId,
      modelId: e.modelId,
      pieceCount: e.pieces.length,
      family: e.family,
      archetype: e.archetype,
      mount: e.mount,
      style: e.style,
      partMixable: e.partMixable,
      rig: e.rig,
      visemes: e.visemes,
      hasJawBone: e.hasJawBone,
      tris: e.tris,
      joints: e.joints,
      bytes: e.bytes,
      recolorable: e.recolorable,
      headDonor: e.headDonor
        ? {
          modelId: e.headDonor.modelId,
          displayName: e.headDonor.displayName,
          tris: e.headDonor.tris,
          licenseSpdx: e.headDonor.licenseSpdx,
          attribution: e.headDonor.attribution,
          sourceUrl: e.headDonor.sourceUrl,
        }
        : null,
      licenseSpdx: e.licenseSpdx,
      licenseUrl: e.licenseUrl,
      attributionRequired: e.attributionRequired,
      attribution: e.attribution,
      sourceUrl: e.sourceUrl,
      retrievedAt: e.retrievedAt,
      flags: e.flags,
      notes: e.notes,
    })),
  })),
  null,
  2,
)} as const;

/** Every catalog entry, flattened (selector lookup by key). */
export const PACK_ENTRIES: readonly PackCatalogEntry[] =
  PACK_CATALOG.flatMap((lane) => lane.entries);

/**
 * Capability gaps recorded at build time — shown in the UI instead of being
 * quietly absent (e.g. why no CC0 animal head is grafted onto the mesh body).
 */
export const PACK_BLOCKED: readonly {
  readonly id: string;
  readonly wanted: string;
  readonly verdict: string;
  readonly evidence: string;
  readonly blocker: string;
  readonly shippedInstead: string;
}[] = ${JSON.stringify(lanesSrc.blocked, null, 2)} as const;
`;
emit(CATALOG_TS, ts);

console.log(
  `lanes: ${out.totals.lanes} lanes, ${out.totals.entries} entries ` +
    `(${out.totals.recolorable} recolourable), ${Object.keys(policies).length} material policies`,
);

if (CHECK) {
  if (drift.length) {
    console.error('build-lanes --check: the committed catalogues do NOT match their source.');
    for (const f of drift) console.error(`  - ${f}`);
    console.error("Run 'node tools/asset-pipeline/build-lanes.mjs' and commit the result.");
    process.exit(1);
  }
  console.log('build-lanes --check: engine lanes.json and the frontend catalogue both match the source.');
}
