import { readFileSync } from 'node:fs';
function parseGlb(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}
for (const p of process.argv.slice(2)) {
  const g = parseGlb(readFileSync(p));
  const idx = new Set();
  for (const s of g.skins || []) for (const j of s.joints || []) idx.add(j);
  const names = [...idx].map(i => (g.nodes[i] || {}).name || '');
  const pick = (re) => names.filter(n => re.test(n)).join(',') || '-';
  console.log(p.split('/').slice(-1)[0].padEnd(30),
    '| head:', pick(/head/i).padEnd(22),
    '| hips:', pick(/hip|pelvis|^root$|^Root$/i).padEnd(28),
    '| chest:', pick(/chest|torso|spine|tummy/i).padEnd(46),
    '| neck:', pick(/neck/i));
}
