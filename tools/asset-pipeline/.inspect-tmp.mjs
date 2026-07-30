import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const r = doc.getRoot();
  console.log('=== ' + f.split('/').slice(-2).join('/'));
  console.log('  meshes: ' + r.listMeshes().map(m => `${m.getName()}[${m.listPrimitives().length}p]`).join(', '));
  console.log('  meshNodes: ' + r.listNodes().filter(n => n.getMesh()).map(n => n.getName()).join(', '));
  const skins = r.listSkins();
  console.log('  skins: ' + skins.map(s => `${s.getName()} joints=${s.listJoints().length}`).join(', '));
  if (skins[0]) console.log('  joints: ' + skins[0].listJoints().map(j => j.getName()).join(','));
  console.log('  materials: ' + r.listMaterials().map(m => m.getName()).join(', '));
}
