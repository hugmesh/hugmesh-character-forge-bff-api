#!/usr/bin/env node
// Triangle / rig / viseme audit for GLB + VRM files. Read-only.
// Reads the raw glTF JSON chunk (no SDK round-trip) so VRM extensions survive.
// usage: node audit.mjs <file...>   -> NDJSON on stdout
import { readFileSync, statSync } from 'node:fs';

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  const bins = [];
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body));
    else bins.push(body);
    off += 8 + len + ((4 - (len % 4)) % 4 === 4 ? 0 : 0);
    off += (4 - (len % 4)) % 4;
  }
  return { json, bin: bins[0] || Buffer.alloc(0) };
}

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function meshTris(gltf, mesh) {
  let tris = 0;
  let verts = 0;
  for (const prim of mesh.primitives || []) {
    const mode = prim.mode === undefined ? 4 : prim.mode;
    const posAcc = gltf.accessors[prim.attributes.POSITION];
    verts += posAcc ? posAcc.count : 0;
    const n = prim.indices !== undefined ? gltf.accessors[prim.indices].count : posAcc ? posAcc.count : 0;
    if (mode === 4) tris += n / 3;
    else if (mode === 5 || mode === 6) tris += Math.max(0, n - 2);
  }
  return { tris, verts };
}

// Two different numbers, both of which matter and which differ whenever a mesh
// is reused by more than one node (glTF-Transform's dedup() merges identical
// meshes, e.g. KayKit's two sword copies):
//   tris        — UNIQUE mesh geometry. Download/parse cost, and what a
//                 per-mesh inspector reports.
//   renderTris  — triangles submitted per frame, i.e. the scene graph walked
//                 with meshes counted once PER NODE. This is the number the
//                 Quest-3 budget is about, and the number Godot reports after
//                 instantiating the imported PackedScene.
function triCount(gltf) {
  let tris = 0;
  let verts = 0;
  for (const mesh of gltf.meshes || []) {
    const m = meshTris(gltf, mesh);
    tris += m.tris;
    verts += m.verts;
  }
  let renderTris = 0;
  const sceneIdx = gltf.scene === undefined ? 0 : gltf.scene;
  const scene = (gltf.scenes || [])[sceneIdx];
  const walk = (nodeIdx, seen) => {
    if (seen.has(nodeIdx)) return;
    seen.add(nodeIdx);
    const node = (gltf.nodes || [])[nodeIdx];
    if (!node) return;
    if (node.mesh !== undefined && gltf.meshes[node.mesh]) renderTris += meshTris(gltf, gltf.meshes[node.mesh]).tris;
    for (const c of node.children || []) walk(c, seen);
  };
  if (scene) for (const r of scene.nodes || []) walk(r, new Set());
  return { tris: Math.round(tris), verts, renderTris: Math.round(renderTris) };
}

function imageBytes(gltf, binLen) {
  let bytes = 0;
  for (const img of gltf.images || []) {
    if (img.bufferView !== undefined) bytes += gltf.bufferViews[img.bufferView].byteLength || 0;
  }
  return bytes;
}

for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  let gltf;
  let binLen = 0;
  if (path.toLowerCase().endsWith('.gltf')) {
    gltf = JSON.parse(buf.toString('utf8'));
  } else {
    const g = parseGlb(buf);
    gltf = g.json;
    binLen = g.bin.length;
  }
  const { tris, verts, renderTris } = triCount(gltf);
  const morphNames = new Set();
  for (const m of gltf.meshes || []) {
    const names = (m.extras && m.extras.targetNames) || [];
    names.forEach((n) => morphNames.add(n));
    for (const p of m.primitives || []) if (p.targets) morphNames.add(`<${p.targets.length} targets>`);
  }
  const vrm = (gltf.extensions && (gltf.extensions.VRM || gltf.extensions.VRMC_vrm)) || null;
  const vrmBlend = vrm && vrm.blendShapeMaster ? (vrm.blendShapeMaster.blendShapeGroups || []).map((g) => g.presetName || g.name) : null;
  const vrmExpr = vrm && vrm.expressions ? Object.keys(vrm.expressions.preset || {}) : null;
  const visemeNames = (vrmBlend || vrmExpr || [...morphNames]).map(String);
  const hasVisemes = /(^|_)(a|i|u|e|o|aa|ih|ou|ee|oh)$/i.test(visemeNames.join(',')) || visemeNames.some((n) => /^(a|i|u|e|o)$/i.test(n));
  const joints = (gltf.skins || []).reduce((a, s) => a + (s.joints ? s.joints.length : 0), 0);
  // BONE names are the nodes referenced as SKIN JOINTS — not every node in the
  // file. Reading all nodes made `hasJawBone` a false positive on any pack that
  // merely names a MESH "…_Jaw": KayKit's skeletons ship a separate
  // `Skeleton_Warrior_Jaw` mesh node while their 41-joint rig has no jaw bone at
  // all, so all four skeletons claimed a lip-sync channel they cannot drive.
  const jointIdx = new Set();
  for (const s of gltf.skins || []) for (const j of s.joints || []) jointIdx.add(j);
  const boneNames = [...jointIdx].map((i) => ((gltf.nodes || [])[i] || {}).name || '');
  const jawBones = boneNames.filter((n) => /jaw/i.test(n));
  const row = {
    file: path.replace(/^.*\//, ''),
    path,
    bytes: statSync(path).size,
    generator: (gltf.asset && gltf.asset.generator) || null,
    tris,
    renderTris,
    verts,
    meshes: (gltf.meshes || []).length,
    materials: (gltf.materials || []).map((m) => m.name || '(unnamed)'),
    textures: (gltf.images || []).length,
    textureBytes: imageBytes(gltf, binLen),
    skins: (gltf.skins || []).length,
    joints,
    hasJawBone: jawBones.length > 0,
    jawBones,
    boneNames,
    animations: (gltf.animations || []).map((a) => a.name || '(unnamed)'),
    morphTargets: [...morphNames],
    visemeCandidates: visemeNames,
    visemes: !!hasVisemes,
    extensionsUsed: gltf.extensionsUsed || [],
    extensionsRequired: gltf.extensionsRequired || [],
    vrmMeta: vrm && vrm.meta ? vrm.meta : vrm && vrm.meta === undefined && gltf.extensions.VRMC_vrm ? gltf.extensions.VRMC_vrm.meta : null,
  };
  process.stdout.write(JSON.stringify(row) + '\n');
}
