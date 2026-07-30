#!/usr/bin/env node
/**
 * vrm-slim.mjs — shrink a .vrm (glTF-binary) by re-encoding its embedded
 * textures, WITHOUT touching the glTF JSON structure.
 *
 * WHY NOT slim.mjs: glTF-Transform only round-trips extensions it has
 * registered. Reading + writing a VRM through it silently DROPS the `VRM` /
 * `VRMC_vrm` / `VRMC_materials_mtoon` extension objects — i.e. the humanoid
 * bone map, the A/I/U/E/O viseme blendShapeMaster, the spring-bone config and
 * the in-file licence metadata, which are the entire reason we ship VRM. Proven
 * locally: a NodeIO round-trip of Godette_vrm_v4.vrm came back with
 * extensionsUsed = [].
 *
 * So this script does byte surgery instead: it rebuilds the BIN chunk from the
 * existing bufferViews (only the image ones change), rewrites bufferView
 * offsets/lengths, and copies every other byte of JSON through verbatim.
 * Accessor byteOffsets are relative to their bufferView, so they stay valid.
 *
 * NOTE (honest limitation): geometry is NOT decimated here. Simplifying a VRM
 * mesh renumbers primitives/morph targets and would invalidate the
 * blendShapeMaster bindings — that needs VRM-aware tooling (or Blender +
 * VRM add-on), which this environment does not have. Over-budget VRMs are
 * flagged in the pack manifest instead of being silently broken.
 *
 * usage: node vrm-slim.mjs <in.vrm> <out.vrm> [--texture-size 512] [--jpeg-quality 82]
 *                          [--drop-morph-normals]
 *
 * --drop-morph-normals removes the NORMAL (and TANGENT) delta streams from every
 * morph target, keeping POSITION. On a VRoid base that is ~1.3 MB of ~4.4 MB.
 * It is index-preserving — targets keep their order, so the VRM
 * blendShapeMaster bindings (the A/I/U/E/O visemes) still resolve — and Godot
 * shades morphed geometry with the base normals, which is what the flat toon
 * ramp wants anyway.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const [input, output] = args.filter((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
if (!input || !output) {
  console.error('usage: vrm-slim.mjs <in.vrm> <out.vrm> [--texture-size N] [--jpeg-quality Q]');
  process.exit(2);
}
const MAX = opt('texture-size', 512);
const Q = opt('jpeg-quality', 82);

const buf = readFileSync(input);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${input} is not a binary glTF`);
let off = 12;
let json = null;
let bin = Buffer.alloc(0);
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const body = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
  else if (type === 0x004e4942) bin = Buffer.from(body);
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) throw new Error('no JSON chunk');

const views = (json.bufferViews || []).map((bv) => bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
const chunks = views.map((v) => Buffer.from(v));

let before = 0;
let after = 0;
for (const img of json.images || []) {
  if (img.bufferView === undefined) continue;
  const src = chunks[img.bufferView];
  before += src.length;
  const meta = await sharp(src).metadata();
  const target = Math.min(MAX, meta.width || MAX, meta.height || MAX);
  const pipeline = sharp(src).resize(target, target, { fit: 'inside' });
  // Keep alpha-bearing maps as PNG (hair/eyelash cutouts); flatten the rest to JPEG.
  const hasAlpha = meta.hasAlpha;
  const out = hasAlpha ? await pipeline.png({ palette: true, effort: 8 }).toBuffer() : await pipeline.jpeg({ quality: Q, mozjpeg: true }).toBuffer();
  chunks[img.bufferView] = out;
  json.bufferViews[img.bufferView].byteLength = out.length;
  img.mimeType = hasAlpha ? 'image/png' : 'image/jpeg';
  after += out.length;
  process.stderr.write(`  [tex] ${img.name || '#' + img.bufferView} ${meta.width}x${meta.height} -> ${target} ${(src.length / 1024) | 0}K -> ${(out.length / 1024) | 0}K\n`);
}

if (args.includes('--drop-morph-normals')) {
  let dropped = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      for (const target of prim.targets || []) {
        for (const key of ['NORMAL', 'TANGENT']) {
          if (target[key] === undefined) continue;
          const bv = json.accessors[target[key]].bufferView;
          if (bv !== undefined) dropped += json.bufferViews[bv].byteLength;
          delete target[key];
        }
      }
    }
  }
  process.stderr.write(`  [morph] dropped NORMAL/TANGENT deltas (~${(dropped / 1048576).toFixed(2)}MB of accessor data)\n`);
}

// Garbage-collect accessors/bufferViews that nothing references any more (the
// orphaned morph deltas). Both arrays are index-addressed, so this compacts them
// and remaps every reference. VRM 0.x/1.0 extension objects address meshes,
// morph-target ORDINALS, materials and nodes — never accessors or bufferViews —
// so the viseme/humanoid/spring-bone bindings are unaffected. (A zero-length
// bufferView would be cheaper but is spec-invalid: byteLength minimum is 1.)
{
  const liveAcc = new Set();
  for (const m of json.meshes || []) {
    for (const p of m.primitives || []) {
      Object.values(p.attributes || {}).forEach((x) => liveAcc.add(x));
      if (p.indices !== undefined) liveAcc.add(p.indices);
      for (const t of p.targets || []) Object.values(t).forEach((x) => liveAcc.add(x));
    }
  }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) liveAcc.add(s.inverseBindMatrices);
  for (const an of json.animations || [])
    for (const sm of an.samplers || []) {
      liveAcc.add(sm.input);
      liveAcc.add(sm.output);
    }

  const accMap = new Map();
  const newAccessors = [];
  (json.accessors || []).forEach((a, i) => {
    if (!liveAcc.has(i)) return;
    accMap.set(i, newAccessors.length);
    newAccessors.push(a);
  });

  const liveView = new Set();
  for (const a of newAccessors) {
    if (a.bufferView !== undefined) liveView.add(a.bufferView);
    if (a.sparse) {
      liveView.add(a.sparse.indices.bufferView);
      liveView.add(a.sparse.values.bufferView);
    }
  }
  for (const i of json.images || []) if (i.bufferView !== undefined) liveView.add(i.bufferView);

  const viewMap = new Map();
  const newViews = [];
  const newChunks = [];
  (json.bufferViews || []).forEach((bv, i) => {
    if (!liveView.has(i)) return;
    viewMap.set(i, newViews.length);
    newViews.push(bv);
    newChunks.push(chunks[i]);
  });

  const remapAcc = (i) => (i === undefined ? undefined : accMap.get(i));
  for (const m of json.meshes || [])
    for (const p of m.primitives || []) {
      for (const k of Object.keys(p.attributes || {})) p.attributes[k] = remapAcc(p.attributes[k]);
      if (p.indices !== undefined) p.indices = remapAcc(p.indices);
      for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = remapAcc(t[k]);
    }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = remapAcc(s.inverseBindMatrices);
  for (const an of json.animations || [])
    for (const sm of an.samplers || []) {
      sm.input = remapAcc(sm.input);
      sm.output = remapAcc(sm.output);
    }
  for (const a of newAccessors) {
    if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
    if (a.sparse) {
      a.sparse.indices.bufferView = viewMap.get(a.sparse.indices.bufferView);
      a.sparse.values.bufferView = viewMap.get(a.sparse.values.bufferView);
    }
  }
  for (const i of json.images || []) if (i.bufferView !== undefined) i.bufferView = viewMap.get(i.bufferView);

  process.stderr.write(
    `  [gc] accessors ${(json.accessors || []).length} -> ${newAccessors.length}, ` +
      `bufferViews ${(json.bufferViews || []).length} -> ${newViews.length}\n`,
  );
  json.accessors = newAccessors;
  json.bufferViews = newViews;
  chunks.length = 0;
  chunks.push(...newChunks);
}

// Re-pack the BIN chunk; bufferView byteStride and ordering are preserved.
let cursor = 0;
const parts = [];
chunks.forEach((c, i) => {
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) {
    parts.push(Buffer.alloc(pad));
    cursor += pad;
  }
  json.bufferViews[i].byteOffset = cursor;
  json.bufferViews[i].byteLength = c.length;
  parts.push(c);
  cursor += c.length;
});
const newBinRaw = Buffer.concat(parts);
const binPad = (4 - (newBinRaw.length % 4)) % 4;
const newBin = Buffer.concat([newBinRaw, Buffer.alloc(binPad)]);
json.buffers[0].byteLength = newBinRaw.length;

const jsonRaw = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + newBin.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(jsonChunk.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(newBin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);

writeFileSync(output, Buffer.concat([header, jh, jsonChunk, bh, newBin]));
process.stderr.write(
  `  -> ${output}  textures ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB, ` +
    `file ${(buf.length / 1048576).toFixed(2)}MB -> ${(readFileSync(output).length / 1048576).toFixed(2)}MB\n`,
);
