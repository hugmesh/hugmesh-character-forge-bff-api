#!/usr/bin/env node
// Scrape a poly.pizza bundle: list its models with slug/name/tris/licence/creator/glb-url.
// usage: node poly-bundle.mjs <bundle-slug> [outJson]
import { writeFileSync } from 'node:fs';

const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
const bundle = process.argv[2];
const out = process.argv[3];

const html = await (await fetch(`https://poly.pizza/bundle/${bundle}`, { headers: UA })).text();
const slugs = [...new Set([...html.matchAll(/"\/m\/([A-Za-z0-9_-]+)"/g)].map((m) => m[1]))];
process.stderr.write(`bundle ${bundle}: ${slugs.length} models\n`);

const rows = [];
for (const slug of slugs) {
  const page = await (await fetch(`https://poly.pizza/m/${slug}`, { headers: UA })).text();
  const m = page.match(/\{"Title":.{0,4000}?"Licence":"([^"]*)","Animated":(true|false)\}/s);
  const raw = m ? m[0] : null;
  const get = (k) => {
    const r = new RegExp(`"${k}":"?([^",}]+)"?`);
    const x = raw && raw.match(r);
    return x ? x[1] : null;
  };
  const rid = get('ResourceID');
  rows.push({
    slug,
    title: get('Title'),
    resourceId: rid,
    tris: raw ? Number(get('Tris')) : null,
    creator: raw && raw.match(/"Creator":\{"Username":"([^"]+)"/) ? raw.match(/"Creator":\{"Username":"([^"]+)"/)[1] : null,
    licence: m ? m[1] : null,
    animated: m ? m[2] === 'true' : null,
    pageUrl: `https://poly.pizza/m/${slug}`,
    glbUrl: rid ? `https://static.poly.pizza/${rid}.glb` : null,
  });
  process.stderr.write('.');
}
process.stderr.write('\n');
rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
const json = JSON.stringify({ bundle, retrievedAt: new Date().toISOString().slice(0, 10), models: rows }, null, 2);
if (out) writeFileSync(out, json);
for (const r of rows) console.log([r.title, r.tris, r.licence, r.animated, r.creator, r.slug].join('\t'));
