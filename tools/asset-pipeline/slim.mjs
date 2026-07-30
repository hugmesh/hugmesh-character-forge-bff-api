#!/usr/bin/env node
/**
 * slim.mjs — turn a vendor glTF/GLB into a toon-ready, Quest-budget GLB.
 *
 * WHY each step (see research/technique.md):
 *  - The runtime renders every avatar with the HOUSE TOON SHADER on the Godot
 *    Compatibility (WebGL2) renderer + a palette-strip recolor texture. Normal /
 *    metallic-roughness / occlusion maps are never sampled, so they are pure
 *    download weight: dropped.
 *  - Base-colour maps are resized (default 512px) and re-encoded as palette PNG.
 *    Runtime GLB loading does NOT generate mipmaps and has no VRAM compression
 *    (engine bug godotengine/godot#100481), so small textures matter twice.
 *  - `resample` losslessly de-duplicates baked keyframes; vendor FBX->glTF
 *    exports are typically 30fps-baked and shrink hard.
 *  - NO Draco / Meshopt / quantization: Godot's glTF importer must read these at
 *    runtime with core glTF 2.0 only. The script asserts extensionsRequired is
 *    empty on output.
 *
 * usage: node slim.mjs <in.gltf|in.glb> <out.glb> [--texture-size 512]
 *                      [--keep-pbr] [--no-textures]
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const [input, output] = args.filter((a) => !a.startsWith('--'));
if (!input || !output) {
  console.error('usage: slim.mjs <in> <out.glb> [--texture-size N] [--keep-pbr] [--no-textures]');
  process.exit(2);
}
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const texSize = Number(opt('texture-size', 512));

// Some vendor packs (Quaternius "Standard" zips) reference `<name>_png.png`
// variants that are not shipped. Alias them onto the real file so the read
// does not hard-fail; they are normal maps and get dropped a few lines later.
class AliasingIO extends NodeIO {
  readURI(uri, type) {
    const base = dirname(resolve(input));
    const p = resolve(base, decodeURIComponent(uri));
    if (!existsSync(p)) {
      const alt = p.replace(/_png\.png$/i, '.png');
      if (existsSync(alt)) {
        process.stderr.write(`  [alias] missing ${uri} -> ${alt.replace(/^.*\//, '')}\n`);
        return type === 'view' ? new Uint8Array(readFileSync(alt)) : readFileSync(alt, 'utf8');
      }
    }
    return super.readURI(uri, type);
  }
}

const io = new AliasingIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

if (!flag('keep-pbr')) {
  for (const mat of root.listMaterials()) {
    mat.setNormalTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    // Flat toon lighting: kill the specular lobe rather than shipping a map for it.
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(1);
  }
}
if (flag('no-textures')) {
  for (const mat of root.listMaterials()) mat.setBaseColorTexture(null);
}

await doc.transform(resample(), dedup(), prune({ keepAttributes: false, keepLeaves: false }));

if (!flag('no-textures')) {
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const meta = await sharp(img).metadata();
    if (!meta.width) continue;
    const target = Math.min(texSize, meta.width, meta.height);
    const out = await sharp(img)
      .resize(target, target, { fit: 'inside' })
      .png({ palette: true, quality: 90, effort: 8 })
      .toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/png');
    process.stderr.write(`  [tex] ${tex.getName() || '(unnamed)'} ${meta.width}x${meta.height} -> ${target}px, ${(img.byteLength / 1024) | 0}K -> ${(out.length / 1024) | 0}K\n`);
  }
}

await io.write(output, doc);

// Hard gate: Godot's runtime glTF loader is core-spec only.
const json = JSON.parse(
  (() => {
    const buf = readFileSync(output);
    const len = buf.readUInt32LE(12);
    return buf.subarray(20, 20 + len).toString('utf8');
  })(),
);
const req = json.extensionsRequired || [];
if (req.length) {
  console.error(`FAIL ${output}: extensionsRequired=${JSON.stringify(req)} (Godot runtime loader is core-glTF only)`);
  process.exit(1);
}
process.stderr.write(`  -> ${output}\n`);
