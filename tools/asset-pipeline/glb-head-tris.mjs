/**
 * glb-head-tris.mjs — count the triangles a bone-weight head split will yield.
 *
 * WHY A THIRD IMPLEMENTATION EXISTS, AND WHY IT IS SAFE
 * The split itself happens at runtime in GDScript (godot/character-forge/scripts/
 * mesh_surgery.gd). This module does NOT split anything: it only COUNTS, so the
 * catalogue can publish an honest triangle budget for a body+donor-head avatar
 * instead of guessing or quoting the whole quadruped.
 *
 * Two implementations of the same rule can drift, so they are pinned against
 * each other: tests/run_tests.gd asserts that the number this script bakes into
 * lanes.json equals what CharForgeMeshSurgery actually extracts, per donor. If
 * the rule ever changes on one side only, the Godot suite fails and names the
 * donor — the same parity discipline that guards the two catalogues.
 *
 * The rule (identical to mesh_surgery.gd):
 *   - a vertex belongs to the head when >= THRESHOLD of its skin weight sits on
 *     a joint matching one of the head patterns;
 *   - a triangle is kept when at least one of its vertices does (keepSeam), or
 *     when all three do (keepSeam false).
 */
import { readFileSync } from 'node:fs';

const COMPONENT = {
  5120: ['getInt8', 1],
  5121: ['getUint8', 1],
  5122: ['getInt16', 2],
  5123: ['getUint16', 2],
  5125: ['getUint32', 4],
  5126: ['getFloat32', 4],
};
const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Splits a .glb container into its JSON chunk and its binary chunk. */
function readGlb(path) {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + length).toString('utf8'));
    else if (type === 0x004e4942) bin = buf.subarray(start, start + length);
    offset += 8 + length;
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { json, bin, view: bin ? new DataView(bin.buffer, bin.byteOffset, bin.byteLength) : null };
}

/** Reads accessor `index` as an array of numeric tuples. */
function accessor({ json, view }, index) {
  const a = json.accessors[index];
  const [getter, size] = COMPONENT[a.componentType];
  const width = COMPONENTS_PER[a.type];
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride || size * width;
  const out = [];
  for (let i = 0; i < a.count; i += 1) {
    const at = base + i * stride;
    const tuple = new Array(width);
    for (let c = 0; c < width; c += 1) tuple[c] = view[getter](at + c * size, true);
    out.push(tuple);
  }
  return out;
}

/**
 * Head triangle/vertex counts for a rigged GLB.
 *
 * @param {string} path      .glb on disk
 * @param {string[]} patterns joint-name globs ("Head", "Ear*") — the same list
 *                            mesh_surgery.gd's DEFAULT_HEAD_JOINTS carries
 * @param {number} threshold  share of skin weight that wins a vertex
 * @returns {{triangles:number, pureTriangles:number, seamTriangles:number,
 *            vertices:number, joints:string[], surfacesDropped:number}}
 */
export function headTriangles(path, patterns, threshold = 0.5) {
  const glb = readGlb(path);
  const { json } = glb;
  if (!json.skins?.length) throw new Error(`${path}: not skinned — cannot split by bone weight`);
  const skin = json.skins[0];
  const jointNames = skin.joints.map((n) => json.nodes[n].name ?? '');
  const globs = patterns.map(
    (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`),
  );
  const wanted = new Set();
  const joints = [];
  jointNames.forEach((name, i) => {
    if (name && globs.some((g) => g.test(name))) {
      wanted.add(i);
      joints.push(name);
    }
  });
  if (!wanted.size) throw new Error(`${path}: rig exposes none of ${patterns.join(', ')}`);

  let triangles = 0;
  let pure = 0;
  let vertices = 0;
  let surfacesDropped = 0;
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const attrs = prim.attributes;
      if (attrs.JOINTS_0 === undefined || attrs.WEIGHTS_0 === undefined) continue;
      const J = accessor(glb, attrs.JOINTS_0);
      const W = accessor(glb, attrs.WEIGHTS_0);
      const owned = J.map((row, v) =>
        row.reduce((sum, joint, c) => (wanted.has(joint) ? sum + W[v][c] : sum), 0) >= threshold);
      const index = prim.indices !== undefined
        ? accessor(glb, prim.indices).map((t) => t[0])
        : owned.map((_, i) => i);
      const kept = new Set();
      let before = triangles;
      for (let t = 0; t + 2 < index.length; t += 3) {
        const tri = [index[t], index[t + 1], index[t + 2]];
        const hits = tri.filter((v) => owned[v]).length;
        if (hits === 0) continue;
        if (hits === 3) pure += 1;
        triangles += 1;
        tri.forEach((v) => kept.add(v));
      }
      if (triangles === before) surfacesDropped += 1;
      vertices += kept.size;
    }
  }
  if (!triangles) throw new Error(`${path}: the joint set matched no geometry`);
  return {
    triangles,
    pureTriangles: pure,
    seamTriangles: triangles - pure,
    vertices,
    joints,
    surfacesDropped,
  };
}
