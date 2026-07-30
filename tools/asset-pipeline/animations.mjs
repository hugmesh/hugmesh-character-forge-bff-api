#!/usr/bin/env node
/**
 * animations.mjs — split a vendor character GLB into (a) a mesh with no clips
 * and (b) a mesh-less animation library that drives the same skeleton.
 *
 * WHY: every KayKit adventurer ships the SAME 41-bone rig with the SAME 76
 * clips embedded, and every KayKit skeleton the same 95 clips — ~3.5 MB of
 * duplicated animation per character. technique.md's canonical-rig rule says
 * ship ONE shared AnimationLibrary and retarget/reuse it, so we keep one
 * library GLB per rig and strip the clips from every character.
 *
 * usage:
 *   node animations.mjs strip <in.glb> <out.glb>   # drop all animations
 *   node animations.mjs only  <in.glb> <out.glb>   # drop all meshes, keep clips
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample } from '@gltf-transform/functions';

const [mode, input, output] = process.argv.slice(2);
if (!['strip', 'only'].includes(mode) || !input || !output) {
  console.error('usage: animations.mjs strip|only <in.glb> <out.glb>');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

if (mode === 'strip') {
  for (const anim of root.listAnimations()) anim.dispose();
} else {
  // Keep the skeleton nodes (animation channels target them) but drop the
  // renderable payload: mesh bindings, skins, materials, textures.
  for (const node of root.listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  for (const mesh of root.listMeshes()) mesh.dispose();
  for (const skin of root.listSkins()) skin.dispose();
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();
  await doc.transform(resample());
}

// keepLeaves: bone nodes carry no mesh — pruning leaves would delete the rig.
await doc.transform(prune({ keepLeaves: true, keepAttributes: false }));
await io.write(output, doc);

const r = doc.getRoot();
process.stderr.write(
  `  ${mode}: ${input.replace(/^.*\//, '')} -> ${output.replace(/^.*\//, '')} ` +
    `(meshes=${r.listMeshes().length} anims=${r.listAnimations().length} nodes=${r.listNodes().length})\n`,
);
