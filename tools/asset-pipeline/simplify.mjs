#!/usr/bin/env node
/**
 * simplify.mjs — decimate an over-budget GLB toward the Quest-3 triangle target,
 * and REFUSE to write the result if skinning did not survive.
 *
 * technique.md budget: ~5-15k tris per avatar on the Quest 3 browser. build.sh
 * routes any character above --budget (default 16000) through here; the honest
 * fallback when a rig cannot survive decimation is to keep the original and let
 * the manifest carry an over-tri-budget flag (which build-manifests.mjs adds
 * automatically from the measured triangle count).
 *
 * Skinning verification (all must hold, else exit 1 and leave the input alone):
 *   - every primitive that had JOINTS_0/WEIGHTS_0 still has them
 *   - the joint count of every skin is unchanged
 *   - the morph-target count of every primitive is unchanged
 *   - no non-core glTF extension was introduced
 *
 * usage: node simplify.mjs <in.glb> <out.glb> [--target 10000] [--budget 16000]
 *                          [--error 0.001]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const [input, output] = args.filter((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
if (!input || !output) {
  console.error('usage: simplify.mjs <in.glb> <out.glb> [--target N] [--budget N] [--error E]');
  process.exit(2);
}
const TARGET = opt('target', 10000);
const BUDGET = opt('budget', 16000);
const ERROR = opt('error', 0.001);

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const snapshot = () => ({
  tris: root
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0),
  skinned: root
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .map((p) => !!(p.getAttribute('JOINTS_0') && p.getAttribute('WEIGHTS_0'))),
  targets: root
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .map((p) => p.listTargets().length),
  joints: root.listSkins().map((s) => s.listJoints().length),
});

const before = snapshot();
if (before.tris <= BUDGET) {
  console.log(`skip ${input.replace(/^.*\//, '')}: ${Math.round(before.tris)} tris <= budget ${BUDGET}`);
  process.exit(0);
}

await MeshoptSimplifier.ready;
const ratio = Math.min(1, TARGET / before.tris);
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: ERROR }));
const after = snapshot();

const problems = [];
before.skinned.forEach((was, i) => {
  if (was && !after.skinned[i]) problems.push(`primitive ${i} lost JOINTS_0/WEIGHTS_0`);
});
if (before.skinned.length !== after.skinned.length) problems.push(`primitive count changed ${before.skinned.length} -> ${after.skinned.length}`);
before.targets.forEach((n, i) => {
  if (after.targets[i] !== n) problems.push(`primitive ${i} morph targets ${n} -> ${after.targets[i]}`);
});
before.joints.forEach((n, i) => {
  if (after.joints[i] !== n) problems.push(`skin ${i} joints ${n} -> ${after.joints[i]}`);
});
const exts = root.listExtensionsUsed().map((e) => e.extensionName).filter((n) => !/^KHR_/.test(n));
if (exts.length) problems.push(`introduced non-KHR extensions: ${exts.join(',')}`);

if (problems.length) {
  console.error(`REFUSED ${input}: decimation broke the rig -> keep original and flag`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

await io.write(output, doc);
console.log(`simplify ${input.replace(/^.*\//, '')}: ${Math.round(before.tris)} -> ${Math.round(after.tris)} tris (rig verified: ${after.joints.join('/')} joints, ${after.skinned.filter(Boolean).length} skinned prims)`);
