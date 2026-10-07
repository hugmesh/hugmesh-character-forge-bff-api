# Character Forge 3D asset pipeline

Reproducible fetch → convert → audit → manifest pipeline for the vendored 3D
character packs in `assets/packs/**` of the Godot project.

**The Godot project no longer lives in this repo.** It moved to hugmesh-games as
`games/character-forge/` (commit `b232d38`), and the 75 committed pack files went
with it. The scripts here still look for it at `godot/character-forge/`, which
holds only a leftover `build/bundle/` in this repo. See known gap 9.

Nobody makes or edits anything under `assets/packs/` by hand. With the project in
place, the commands below reproduce the committed bytes and the manifests that
describe them.

```bash
cd tools/asset-pipeline
npm install                                       # gltf-transform SDK + sharp + meshoptimizer
./fetch.sh                                        # NETWORK: vendor archives -> .work/raw
./build.sh                                        # OFFLINE: -> ../../godot/character-forge/assets/packs/**
GODOT=/path/to/godot ./verify.sh                  # gate: freshness + glTF validation + Godot load test
```

`.work/` and `node_modules/` are git-ignored. The ~500 MB of vendor archives never
enters the repository.

---

## 1. License discipline (the part that is not negotiable)

Only **CC0** and **CC-BY** items with a positive redistribution verdict in the
XR-chat research reports may be vendored. Every licence in `sources.json` was
**read at the source during retrieval**: the LICENSE file inside the download, the
licence block on the submission page, or (for VRM) the model's own
`extensions.VRM.meta`. Each is quoted verbatim in `licenseQuote`.

`sources.json` is the single source of truth. `build-manifests.mjs` copies those
fields into every `assets/packs/<id>/pack.json` **and** into the repo-root
`THIRD_PARTY_ASSETS.md`, so the three cannot drift. Do not hand-edit either
generated file.

Never vendored, whatever a page claims: **Mixamo** (Adobe's terms bar raw-file
redistribution), **Synty**, **VRoid Hub**, **BOOTH**, **CGTrader**, unverified
**Sketchfab** uploads, and anything from the "final fantasy free dl" style
collections (game rips whose CC labels are void).

### At-source corrections found while retrieving

| Source | Research brief said | Source actually says | Action |
|---|---|---|---|
| 100Avatars (Polygonal Mind) | CC0 | `CCLicense.md` is the verbatim **CC-BY-4.0** text | shipped as CC-BY-4.0 with mandatory attribution |
| 100Avatars | — | README: *"we started to rig them properly using Mixamo"* | shipped, disclosed in the manifest, flagged for legal review; scoped to an importer test corpus |
| OGA VRoid CC0 bundle | 8 CC0 models | `Base_Female`/`Base_Male` carry in-file `licenseName: "CC0"`; `AvatarSample_D–G` carry `licenseName: "Other"` | only the two bases shipped |
| KayKit itch pages | CC0 + "don't resell unmodified" | repo `LICENSE.txt` is plain CC0 with a *non-mandatory* credit request | shipped as CC0, credit given anyway |
| Khronos Fox | CC0 | mesh CC0, **rig + animation CC-BY-4.0** | whole file ships as CC-BY-4.0 |

### VRoid part-mixer prohibition

pixiv's VRoid Studio guideline bars applications that *generate or output* models
from deformed or recombined VRoid meshes. VRoid-derived files therefore ship as
**fixed, whole avatars only** and never enter the part-mixer. The CC0 mixing lane
is Quaternius + KayKit.

---

## 2. What each script does, and why

| Script | Purpose |
|---|---|
| `fetch.sh` | Downloads every source in `sources.json`. No source needs an account or API token. |
| `lib/itch-fetch.sh` | itch.io's free ("name your own price") download handshake — game page → CSRF → `/download_url` → `/file/<id>`. Quaternius routes all its downloads through itch. |
| `lib/poly-bundle.mjs` | Scrapes a poly.pizza bundle for per-model GLB URLs **plus** the triangle count, licence and creator, so curation happens before download. |
| `slim.mjs` | vendor glTF/GLB → toon-ready GLB. |
| `animations.mjs` | `strip` (drop clips) / `only` (mesh-less shared animation library). |
| `simplify.mjs` | over-budget decimation that **refuses to write** if skinning/morphs/joints did not survive. |
| `vrm-slim.mjs` | VRM texture surgery that preserves the VRM extension byte-for-byte. |
| `audit.mjs` | read-only measurement of the committed bytes (tris, render-tris, joints, jaw bone, animations, morph targets, visemes, extensions, VRM licence metadata). |
| `build-manifests.mjs` | writes `pack.json` × 10 + `assets/packs/index.json` + `THIRD_PARTY_ASSETS.md`; fails the build over 60 MB. |
| `lanes.json` + `build-lanes.mjs` | the hand-authored mapping of models onto the assembler's style lanes / head families / palette regions, resolved against the manifests and the engine's own enums (read out of `char3d_config.gd`, so a lane cannot name a family the engine lacks). Emits `assets/packs/lanes.json` for `scripts/pack_library.gd` and `pack-catalog.generated.ts` for the Angular selector — one source, two consumers, no drift. `--check` regenerates both in memory and fails if either committed file differs; the GitHub `frontend` job runs it. |
| `glb-measure.mjs` | counts, straight from the GLB bytes, the triangles a bone-weight head split will yield and the glTF node names that carry a mesh. Feeds `build-lanes.mjs` so the catalogue can publish an honest triangle budget for the body-plus-donor-head entries. It splits nothing; the split runs at runtime in `mesh_surgery.gd`. |
| `lib/check-manifests.mjs` | asserts every manifest still describes the bytes on disk, that no file is unmanifested, and that `index.json` agrees with every `pack.json` it indexes. |
| `verify.sh` | offline gate: manifest freshness, no non-core glTF extensions, glTF validation, Godot load test. |

### The gate, and the proof it is not vacuous

`GODOT=… ./verify.sh` reports **1805 passed, 0 failed** over 75 assets (rechecked
2026-10-07 with Godot 4.7.2, against the hugmesh-games tree at `origin/main`).
These are measurements, not existence checks. Each was confirmed by breaking it on
purpose and watching the gate go red:

| Injected lie | Gate response |
|---|---|
| `khronos-fox-v1` manifest claims 999 tris instead of 576 | `FAIL: fox.glb renders 576 triangles, manifest says 999` |
| blank the CC-BY-3.0 attribution text in `index.json` `credits[]` | `FAIL: godette-v1 is CC-BY-3.0: credits[] carries attribution text and a licence URL` |
| relabel the CC-BY-4.0 100Avatars pack as CC0 in `index.json` | `FAIL: index.json polygonalmind-100avatars-v1.licenseSpdx agrees with pack.json` |

`./build.sh` is also byte-reproducible: from the cached vendor archives it
reproduced all **75/75 committed files with identical SHA-256 digests**.

### Why `slim.mjs` throws away the PBR maps

The runtime shades every avatar with the house toon shader on Godot's
Compatibility (WebGL2) renderer plus a palette-strip recolor texture. It never
samples normal, metallic-roughness, occlusion or emissive maps. They are pure
download weight, and Quaternius ships 4096² normal + ORM maps. Dropping them and
resizing base colour to 512 px turned the Modular Outfits pack from **785 MB of
naively-embedded GLBs into 6.6 MB**. Runtime GLB loading also generates no mipmaps
and has no VRAM compression (godotengine/godot#100481), so small textures pay
twice.

### Why no Draco / Meshopt / quantization

Godot's glTF loader reads these files at runtime (`append_from_buffer`) with
**core glTF 2.0 only**. `slim.mjs` asserts `extensionsRequired` is empty on every
file it writes, and `verify.sh` asserts it again over the committed tree.

### Why the animation libraries are separate files

Every KayKit adventurer shipped the *same* 41-bone rig with the *same* 76 clips
embedded: ~3.4 MB of duplicated animation per character (Knight was 3.49 MB, of
which 6,952 triangles and a 13 KB texture). technique.md's canonical-rig rule is
one shared `AnimationLibrary` per rig. So `animations.mjs only` extracts a
mesh-less clip donor and `animations.mjs strip` empties the characters. Knight
went **3.49 MB → 0.35 MB**, and the pack pays for its 76 clips once.

### Why `.vrm` never goes through `slim.mjs`

glTF-Transform round-trips only the extensions it has registered. A `NodeIO`
round-trip of `Godette_vrm_v4.vrm` came back with `extensionsUsed: []`. The
humanoid bone map, the A/I/U/E/O viseme `blendShapeMaster`, the spring-bone config
and the in-file licence metadata were all silently deleted. `vrm-slim.mjs`
therefore rebuilds only the BIN chunk (re-encoded images, GC'd orphan buffer
views) and copies the JSON through, so the extension objects survive verbatim.
`--drop-morph-normals` also removes the NORMAL/TANGENT delta streams from morph
targets. It keeps indices, so viseme bindings still resolve. That took a VRoid base
from **15.6 MB → 3.05 MB** with the visemes intact, proven by the Godot
runtime-load test asserting `get_blend_shape_count() > 0`.

### The four triangle numbers in `pack.json`, and which one is real

| Field | Meaning |
|---|---|
| **`trisAfter`** | **Rendered triangles measured on the committed bytes.** The Quest-3 budget number; the Godot self-test re-measures it after instantiating the asset and fails on any disagreement. This is the only number to plan against. |
| `trisUnique` | Unique mesh geometry, i.e. download/parse cost. `dedup()` merges identical meshes (KayKit ships two copies of the same sword), so this diverges from `trisAfter` whenever a mesh is reused by more than one node. |
| `trisBeforeDecimation` | Non-null **only** when `simplify.mjs` actually rewrote the file. `decimated` states this as a boolean on every model rather than leaving it inferred. |
| `vendorReportedTris` | Provenance only — what poly.pizza's own model metadata claimed at retrieval time. **Not** a before/after pair with `trisAfter`: the vendor counts differently (it can be *lower* than our measurement, e.g. Blue Demon 4,456 vs 5,800), so reading it as "our pipeline added triangles" would be wrong. |

At the current curation **nothing needed decimating**. Every asset already fits the
16k budget after `slim.mjs`, so `decimated` is `false` and `trisBeforeDecimation` is
`null` everywhere. `simplify.mjs` still runs over every file on each build (it
reports `skip … <= budget`). A future source that lands over budget gets decimated,
and the decimation and its provenance are recorded automatically.

---

## 3. Curation and what was cut

Hard budget: **60 MB** of committed pack payload. Actual: **38.78 MB / 75 files**.

| Pack | Files | MB | License | Style / rig |
|---|---:|---:|---|---|
| `quaternius-base-v1` | 11 | 5.06 | CC0-1.0 | jrpg / humanoid (2 bases, 8 hair+brow parts, 43-clip library) |
| `quaternius-outfits-v1` | 20 | 6.61 | CC0-1.0 | jrpg / humanoid (modular clothing parts) |
| `quaternius-monsters-v1` | 15 | 3.39 | CC0-1.0 | monster / humanoid |
| `quaternius-animals-v1` | 6 | 3.60 | CC0-1.0 | furry-donor / quadruped |
| `kaykit-adventurers-v1` | 6 | 3.91 | CC0-1.0 | jrpg / humanoid (5 chars + 76-clip library) |
| `kaykit-skeletons-v1` | 5 | 4.46 | CC0-1.0 | monster / humanoid (4 chars + 95-clip library) |
| `vroid-cc0-v1` | 2 | 6.09 | CC0-1.0 | anime / humanoid, **visemes** |
| `polygonalmind-100avatars-v1` | 8 | 5.02 | CC-BY-4.0 | filler / humanoid, **visemes** |
| `godette-v1` | 1 | 0.49 | CC-BY-3.0 | anime / humanoid, **visemes** |
| `khronos-fox-v1` | 1 | 0.14 | CC-BY-4.0 | furry-donor / quadruped |

**Cut, and why:**

- **30 of the 45 Ultimate Monsters** — kept the bipedal creature/anthro-adjacent
  roster (Cat, Bunny, Frog, Dragon ×2, Yeti, Orc ×2, Demon ×2, Ghost, Mushroom
  King, Tribal) + two slimes; dropped the fish/birds/aliens/ninja/wizard and the
  "Evolved" duplicates that add no silhouette.
- **6 of the 12 Animated Animals** — kept Fox/Wolf/Husky/Shiba/Deer/Horse as
  head/tail donors; cut the farm set (Cow, Bull, Donkey, Alpaca, Stag, White
  Horse), which donates nothing the Deer/Horse do not.
- **The 4 assembled Quaternius outfits** — they are the 20 modular parts already
  shipped, pre-combined (~1.4 MB of redundancy).
- **`AvatarSample_D/E/F/G`** — in-file `licenseName: "Other"`, 26.7k–34.4k tris,
  417–498 joints, and no safe decimation path for a VRM.
- **192 of the 200 non-voxel 100Avatars, and all 200 voxel variants** — 8 are
  enough for an importer corpus; the whole repo is 2.4 GB.
- **The "Origin at 0" hairstyle variants** — the "Rigged to Head Bone" copies are
  the useful ones.
- **Quaternius `.blend` source tiers, all FBX copies, all normal/ORM/roughness
  maps** — see §2.

The remaining headroom (~21 MB) is deliberately **not** spent on larger textures.
Runtime-loaded GLBs get no VRAM compression on web, so 1024² maps would cost 4× the
GPU memory for a look the palette-strip recolor design does not need.

---

## 4. Known gaps / follow-ups

1. **Blender-only sources are not converted.** `OGA Modular RPG Characters
   (System G6)` and `OGA Base Rigged Stylized Humanoid (YW)` ship `.blend` files
   only. Blender is not installed here, so they are recorded in
   `sources.json → notShipped` and not faked. **TODO:** on a machine with
   Blender, export both to GLB (`--background --python` batch), re-slot materials
   to the 7 semantic regions, add a jaw bone, and add them to `sources.json`.
2. **No jaw bone anywhere on the CC0 lane.** Every Quaternius/KayKit/Fox character
   is flagged `no jaw bone and no visemes` (33 of the 75 models). Adding a bone is
   a Blender batch job (legal-inventory.md). Until then the lip-sync channel for
   these models comes from the assembler (procedural jaw) or the JRPG-authentic
   5-frame mouth-texture strip (`shaders/mouth_strip.gdshader` already exists).
3. **Over-bone-budget models.** `bunny` (98 joints), `orc`/`mushroom_king` (86),
   and both VRoid bases (166/134, the VRoid spring-bone hair chains) exceed the ~75
   bone Quest guidance. `pack.json` flags each one. The fix is bone-chain pruning,
   which needs a rig-aware tool.
4. **RESOLVED — the web export dropped every `.vrm`** (issue #3). The Godot
   project now lives in hugmesh-games (`games/character-forge/`), whose
   `export_presets.cfg` sets
   `include_filter="assets/packs/*.json,assets/packs/*.vrm"`. Verified on a
   real Web export (Godot 4.7.1, 2026-09-01): with that filter the PCK carries
   all **11 `.vrm`** and all **12 `.json`** (10 `pack.json` + `index.json` +
   `lanes.json`), byte-identical to source; with the filter blanked the same
   export drops all 11 `.vrm` (35.3 MB → 23.2 MB PCK) while still exiting 0 —
   the `.json` survive only because the engine loads JSON as a resource, which
   nothing relies on. Guards, in hugmesh-games: `games/character-forge/export_required.txt`
   declares the raw-byte files; `tests/run_tests.gd` checks the preset's
   filters cover each one with the engine's own `matchn`; `make build-godot`
   runs `scripts/verify-godot-pck.mjs` on the produced `index.pck` and fails on
   any missing or drifted file. Nothing in this repo produces the export: it
   is built in hugmesh-games and copied into `frontend/src/assets/game/` by
   the orchestrator (see `godot/README.md`).
5. **Quaternius RPG Character Pack** is Google-Drive-only and was skipped; what it
   covers is already shipped. (Confirmed at the source: the only download control
   on `quaternius.com/packs/rpgcharacters.html` is an
   `onclick="window.open('https://drive.google.com/drive/folders/…')"`. It is the
   one Quaternius pack with no itch.io listing, so `lib/itch-fetch.sh` cannot
   reach it.)
5b. **KayKit Character Animations is the wrong rig, not a missing download.** It
   fetches fine (CC0, verified in the pack's own `LICENSE.txt`), but its
   `KayKit_AnimatedCharacter_v1.2.glb` is the blocky PrototypePete demo body on a
   **6-joint** rig, while the Adventurers/Skeletons characters we ship are a
   41-bone rig — the 30 clips cannot drive them without a rig-aware retarget.
   The 76-clip library already extracted from the Adventurers pack is on the
   correct rig and covers the room's social poses (Idle, Cheer, Sit_Chair_*,
   Sit_Floor_*, Lie_*, Interact, PickUp, Throw). **TODO** (needs Blender or an
   editor-authored BoneMap): retarget the 5 clips unique to the standalone pack —
   Wave, Dance, Climbing, Hop, Roll — onto the 41-bone rig. `Wave` and `Dance` are
   the two a chat room actually wants.
6. **Sketchfab anthro candidates** need an account token plus per-model IP vetting
   (link-audit.md). An unauthenticated pipeline cannot attempt them.
7. **Upstream `SKIN_SKELETON_INVALID`** appears on 13 assets. It is in the vendor
   originals byte for byte (an FBX2glTF quirk), so `verify.sh` allow-lists exactly
   that one code and nothing else.
8. **Quaternius' free UBC zip references textures it does not ship**
   (`T_Eye_Normal_png.png`, `T_Hair_1_Normal_png.png`). `slim.mjs` aliases
   `<name>_png.png` → `<name>.png` and drops them as normal maps regardless.
9. **The scripts still point at the old Godot path.** `build-lanes.mjs`,
   `build-manifests.mjs` and the defaults of `build.sh` and `verify.sh` use
   `godot/character-forge/…`, which no longer exists here. `build.sh` and
   `verify.sh` take a `PACKS=` override; `build-lanes.mjs` and
   `build-manifests.mjs` hard-code the path (they also read `scripts/char3d_config.gd`
   and write `THIRD_PARTY_ASSETS.md` relative to this repo). Run from this repo as
   it stands, `node tools/asset-pipeline/build-lanes.mjs --check` stops with
   `ENOENT … godot/character-forge/scripts/char3d_config.gd`, so the last step of
   the GitHub `frontend` job cannot pass. It passes (48 entries) when
   `godot/character-forge` is a link to a checkout of hugmesh-games'
   `games/character-forge`, which replaces the leftover `build/bundle/` there; do not commit
   that link. Pack bytes are committed in hugmesh-games, so a changed pack lands as
   a pull request in both repos. The fix is to make the path a parameter.

---

## 5. Adding a source

1. Verify the licence **at the source** and copy the text into `licenseQuote`.
2. Add a block to `sources.json` (`packs[]` if shipping, `notShipped[]` if not).
3. Add its download to `fetch.sh` and its conversion to `build.sh`.
4. `./build.sh && GODOT=... ./verify.sh` — the manifests, `THIRD_PARTY_ASSETS.md`
   and the budget check all update themselves.
