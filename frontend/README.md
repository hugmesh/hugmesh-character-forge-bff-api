# character-forge frontend

Angular 22 native-federation remote **`character-forge`** (exposes `./routes` →
`CHARACTER_FORGE_ROUTES`), structurally cloned from
`hugmesh-character-studio-ui` and mounted by the hugmesh.net host at
`/character-forge`. It is part of the `hugmesh-character-forge-bff-api` repo. The
Spring BFF lives at the repo root. The Godot maker moved to hugmesh-games
(`games/character-forge/`); `../godot/` is only a pointer.

## What it does

- **Forge studio page** — embeds the Godot 3D character maker (web export,
  Engine JS API, same-origin `src/assets/game/`, threads OFF). The committed
  export (`index.js`, `index.pck`, `index.wasm`, two audio worklets) lives there.
  Without it the page still boots and shows an honest "engine bundle not
  present" panel (`assets/game/README.md`).
- **Character selector** — one tab per style lane (Anime / JRPG / Kemono-Furry /
  Monsters / Import) over the GENERATED catalogue
  (`models/pack-catalog.generated.ts`, emitted by
  `tools/asset-pipeline/build-lanes.mjs` from the same lanes file the engine
  reads), so the selector never offers a model the engine cannot load. Each card
  shows the licence, the credit, and the cost that matters in VR (triangles /
  joints / megabytes). It also says so when a model is a baked atlas ("fixed
  colours"), when its licence bars recombining it ("whole model only", the VRoid
  part-mixer clause), and when it blows the Quest-3 budget. Every one of the 48
  catalogue entries recolours today, so "fixed colours" appears on none; the flag
  stays for any future single-atlas model. Preview thumbnails are captured at
  runtime from the engine and cached for the session; no thumbnail assets are
  shipped or fetched. The recorded capability gaps (today: the Blender-only base
  that could not be converted) are listed, not hidden. A modular outfit is ONE card
  ("4-piece set" or "5-piece set") that carries the whole set's triangle and byte
  cost, because that is what lands on screen.
- **Bring your own avatar** — the Import tab takes a `.vrm`/`.glb` (up to 24 MB)
  the user picked. The browser reads the file and hands it to the engine as
  bytes. It is never uploaded to the BFF, never persisted, never saved with the
  character (only the parametric definition is, and it holds no geometry). For a
  VRM the panel shows the model's OWN in-file terms (author, licence,
  redistribution, credit), because those are the author's terms, not ours. Bases
  we may not redistribute (TheRPGslayer's kemono trio, BOOTH) are LINKED, with
  that stated plainly (`models/import-sources.ts`).
- **Parameter editor** — Char3DConfig v1 (DESIGN §2): body archetype/build/
  height/curve/top/legs/arms/limb, head family (+variant/snout/ears/horns), the
  seven part slots (real VN part ids), the seven material regions, style. Every
  edit goes through the client-side mirror of the BFF's validation
  (`models/char3d-config.ts` — clamps, hex regex, enum checks, 16KB cap).
- **Rigging panel** — the optional `rig` of Char3DConfig v1: joint picker, six
  sliders (offset and scale on three axes), Auto-adjust (the engine fits eyes,
  brows, jaw and ears to the head it built) and reset. Beside it, a turntable
  spin control.
- **Coat-block colours** — the four extended kemono regions (`innerMuzzle`,
  `socks`, `innerEar`, `tailTip`) as pin/derive controls. The swatch shows the
  colour the maker will render, including the 0.45 innerMuzzle lightening
  mirrored from `palette.gd`. "Derive" un-pins the region and hands it back to the
  maker's derivation, which is what an ABSENT key means on the wire.
- **Import from VN** — paste (or pick up from localStorage) a character-studio
  `VnCharacter` JSON; map it client-side (`util/map-vn.ts` mirror) or through the
  authoritative BFF `POST /bff/character-forge/map`.
- **Save/load/list/active** — a thin typed fetch client
  (`services/forge-bff.service.ts`) for the `/bff/character-forge` API,
  authenticated by the HttpOnly `bff_` cookie only (no browser bearer; a 401
  degrades honestly).
- **Seeded randomizer** — deterministic `randomChar3dConfig(seed)` (mulberry32),
  with the same curated colours as the 2D studio.

## Engine bridge contract

`services/engine-bridge.service.ts` speaks the `CharForge` JavaScriptBridge
singleton the Godot game registers on `window` (DESIGN §4): in —
`setConfig(json)`, `setExpression(label)`, `setOpenness(float)`,
`randomize(seed)`, `snapshot(w,h) → base64 PNG`, `setRig(json)`,
`autoAdjustRig()`, `setAutoRotate(bool)`, `setPack(key)`,
`importModel(base64, fileName)`, `listPacks()`; out — the page assigns
`CharForge.onConfigChanged(json)`, `onPackChanged(json)` and
`onImportResult(json)`. Calls made before the game boots are queued as versioned
`{v:1, t:...}` envelopes (every call except `importModel`) and flushed FIFO on
registration.

`importModel` is the only call that carries bytes. A chunked encoder turns them
into base64 (`String.fromCharCode(...bytes)` throws `RangeError` long before a
20 MB avatar), and they go straight into WASM memory. This service never posts
them anywhere. The engine answers on `onImportResult` with a mount report plus the
file's own licence block.

## Dev

```bash
npm ci
npm start           # standalone dev shell on :4213
npm test            # karma/jasmine, ChromeHeadlessCI
npm run build       # native-federation production bundle (dist/character-forge)
```

Serving: `Dockerfile` (node:24-alpine build → nginxinc/nginx-unprivileged:1.27-alpine
on :8080) + `nginx.conf` (immutable hashed bundles, no-cache `remoteEntry.json`,
`application/wasm` for the Godot bundle). COOP/COEP are deliberately NOT set: the
export is single-threaded, and the gateway owns those headers.

## Vendored models

`src/app/character-forge/models/vn-character.ts` + `vn-manifest.ts` were vendored
byte for byte from hugmesh-character-studio-ui (provenance headers in-file;
native-federation forbids cross-remote runtime imports). Both now lag upstream: as
of 2026-10-07 the studio's copies add slot-transform types (`vn-character.ts`) and
`viseme`/`visemeOf` fields (`vn-manifest.ts`) that these lack.
`part-archetypes.ts` is generated data extracted from the studio's packs
(partId → headArchetype + per-slot part ids). It powers the client-side map
mirror and the randomizer.

`models/pack-catalog.generated.ts` is GENERATED — do not edit it. It is written
by `node tools/asset-pipeline/build-lanes.mjs` together with the engine's
`assets/packs/lanes.json` (now in hugmesh-games, `games/character-forge/`), so
the selector and the engine always describe the same 48 catalogue entries. The
3D assets themselves live in the Godot project, never in this bundle. Every
attribution shown on a card is aggregated in the repo-root
`THIRD_PARTY_ASSETS.md`.
