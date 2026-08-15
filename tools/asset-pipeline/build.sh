#!/usr/bin/env bash
# build.sh — rebuild godot/character-forge/assets/packs/** from the vendor
# archives fetched by fetch.sh. Idempotent; safe to re-run.
#
#   ./fetch.sh          # network: downloads vendor archives into .work/raw
#   ./build.sh          # offline: converts + slims + writes assets/packs/**
#
# See README.md for the per-source licence verdicts and the rationale behind
# every transform applied here.
set -euo pipefail
cd "$(dirname "$0")"

WORK="${WORK:-.work}"
RAW="$WORK/raw"
EX="$WORK/ex"
PACKS="${PACKS:-../../godot/character-forge/assets/packs}"
NODE_OPTS=()

[ -d node_modules ] || { echo "run 'npm install' in $(pwd) first" >&2; exit 1; }
[ -d "$RAW" ] || { echo "no $RAW — run ./fetch.sh first" >&2; exit 1; }

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
slim() { node "${NODE_OPTS[@]}" slim.mjs "$@"; }
anims() { node "${NODE_OPTS[@]}" animations.mjs "$@"; }
vrmslim() { node "${NODE_OPTS[@]}" vrm-slim.mjs "$@"; }

rm -rf "$EX"; mkdir -p "$EX"

# ── unpack vendor archives ──────────────────────────────────────────────────
say "unpack"
for z in "$RAW"/quaternius/*.zip; do unzip -oq -d "$EX/quaternius" "$z"; done
for z in "$RAW"/oga/*.zip; do unzip -oq -d "$EX/vroid" "$z"; done

Q="$EX/quaternius"
UBC="$Q/Universal Base Characters[Standard]"
OUT="$Q/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)"
UAL="$Q/Universal Animation Library[Standard]/Unreal-Godot"

# ── quaternius-base-v1 : UBC bodies + hairstyles + the shared animation library
# Map an upstream (lowercased) file stem to the name we SHIP.
#
# Several vendors name a pair of assets after a gender. The forge does not model
# a body that way — a base mesh is only a starting point and the parametric axes
# do the shaping — so the pair ships as a/b and the odd one out as _alt. This is
# the ONE place that translation happens: pack.json model ids are derived
# mechanically from the shipped filename (build-manifests.mjs), so without it
# every pipeline run would silently reintroduce the gendered ids into the
# catalogue and re-break the lane entries that reference them.
#
# INPUT paths are deliberately NOT translated: they are what the upstream archive
# actually contains, and fetch.sh / sources.json must keep naming them truthfully
# or the provenance record stops matching the download it describes.
shipname() {
  case "$1" in
    female_peasant_*)  echo "peasant_a_${1#female_peasant_}" ;;
    male_peasant_*)    echo "peasant_b_${1#male_peasant_}" ;;
    female_ranger_*)   echo "ranger_a_${1#female_ranger_}" ;;
    male_ranger_*)     echo "ranger_b_${1#male_ranger_}" ;;
    eyebrows_female)   echo "eyebrows_alt" ;;
    hair_buzzedfemale) echo "hair_buzzed_alt" ;;
    *)                 echo "$1" ;;
  esac
}
lowername() { echo "$1" | tr 'A-Z' 'a-z'; }

say "quaternius-base-v1"
P="$PACKS/quaternius-base-v1"; mkdir -p "$P/models" "$P/anim"
slim "$UBC/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf" "$P/models/ubc_superhero_a.glb" --texture-size 512
slim "$UBC/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf"   "$P/models/ubc_superhero_b.glb"   --texture-size 512
for f in "$UBC/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"/*.gltf; do
  b=$(basename "$f" .gltf)
  slim "$f" "$P/models/$(shipname "$(lowername "$b")").glb" --texture-size 512
done
# UAL ships as a rigged mesh + 43 clips; we only want the clips (shared library).
anims only "$UAL/UAL1_Standard.glb" "$P/anim/quaternius_universal_animation_library.glb"

# ── quaternius-outfits-v1 : modular clothing parts (the assembled 4 outfits are
#    just these parts combined — cut for budget, see README "what was cut").
say "quaternius-outfits-v1"
P="$PACKS/quaternius-outfits-v1"; mkdir -p "$P/models"
for f in "$OUT/Modular Parts"/*.gltf; do
  b=$(basename "$f" .gltf)
  slim "$f" "$P/models/$(shipname "$(lowername "$b")").glb" --texture-size 512
done

# ── quaternius-monsters-v1 / quaternius-animals-v1 : poly.pizza per-model GLBs
say "quaternius monsters + animals"
P="$PACKS/quaternius-monsters-v1"; mkdir -p "$P/models"
for f in "$RAW"/poly/monsters__*.glb; do
  b=$(basename "$f" .glb); b=${b#monsters__}
  slim "$f" "$P/models/$(echo "$b" | tr 'A-Z' 'a-z').glb"
done
P="$PACKS/quaternius-animals-v1"; mkdir -p "$P/models"
for f in "$RAW"/poly/animals__*.glb; do
  b=$(basename "$f" .glb); b=${b#animals__}
  slim "$f" "$P/models/$(echo "$b" | tr 'A-Z' 'a-z').glb"
done

# ── kaykit : one shared animation library per rig, clips stripped from meshes
say "kaykit"
P="$PACKS/kaykit-adventurers-v1"; mkdir -p "$P/models" "$P/anim"
anims only "$RAW/kaykit/KayKit-Character-Pack-Adventures__Knight.glb" "$WORK/kk_adv_anims.glb"
slim "$WORK/kk_adv_anims.glb" "$P/anim/kaykit_adventurers_animations.glb" --no-textures
for f in "$RAW"/kaykit/KayKit-Character-Pack-Adventures__*.glb; do
  b=$(basename "$f" .glb); b=${b#KayKit-Character-Pack-Adventures__}
  anims strip "$f" "$WORK/tmp.glb"
  slim "$WORK/tmp.glb" "$P/models/$(echo "$b" | tr 'A-Z' 'a-z').glb" --texture-size 512
done
P="$PACKS/kaykit-skeletons-v1"; mkdir -p "$P/models" "$P/anim"
anims only "$RAW/kaykit/KayKit-Character-Pack-Skeletons__Skeleton_Warrior.glb" "$WORK/kk_skel_anims.glb"
slim "$WORK/kk_skel_anims.glb" "$P/anim/kaykit_skeletons_animations.glb" --no-textures
for f in "$RAW"/kaykit/KayKit-Character-Pack-Skeletons__*.glb; do
  b=$(basename "$f" .glb); b=${b#KayKit-Character-Pack-Skeletons__}
  anims strip "$f" "$WORK/tmp.glb"
  slim "$WORK/tmp.glb" "$P/models/$(echo "$b" | tr 'A-Z' 'a-z').glb" --texture-size 512
done

# ── VRM lane : NEVER through slim.mjs (drops the VRM extension) ─────────────
say "vrm lane"
P="$PACKS/vroid-cc0-v1"; mkdir -p "$P/models"
# Upstream ships these as Base_Female / Base_Male; we ship them as base_a /
# base_b (see shipname above). The INPUT names stay upstream's.
for n in "Base_Female:base_a" "Base_Male:base_b"; do
  vrmslim "$EX/vroid/${n%%:*}.vrm" "$P/models/${n##*:}.vrm" --texture-size 512 --drop-morph-normals
done

P="$PACKS/polygonalmind-100avatars-v1"; mkdir -p "$P/models"
for f in "$RAW"/100avatars/*.vrm; do
  b=$(basename "$f" .vrm)
  vrmslim "$f" "$P/models/$(echo "$b" | tr 'A-Z' 'a-z').vrm" --texture-size 256 --drop-morph-normals
done

P="$PACKS/godette-v1"; mkdir -p "$P/models"
vrmslim "$RAW/godette/Godette_vrm_v4.vrm" "$P/models/godette.vrm" --texture-size 512

# ── khronos Fox (quadruped reference / CC-BY rig) ───────────────────────────
say "khronos-fox-v1"
P="$PACKS/khronos-fox-v1"; mkdir -p "$P/models"
slim "$RAW/khronos/Fox.glb" "$P/models/fox.glb" --texture-size 512

# ── over-budget decimation pass ─────────────────────────────────────────────
# Only .glb: decimating a .vrm renumbers primitives/morph targets and would
# invalidate its blendShapeMaster viseme bindings (see vrm-slim.mjs header).
say "over-budget decimation (>${TRI_BUDGET:-16000} tris -> ~${TRI_TARGET:-10000})"
# Every file that is actually rewritten is recorded with its pre-decimation
# triangle count, so pack.json can state decimation provenance as a measured
# fact instead of leaving it implied. A file that simply fitted the budget gets
# NO entry here and is reported as decimated:false.
: > "$WORK/decimated.ndjson"
while IFS= read -r -d '' f; do
  rm -f "$WORK/simp.glb"
  before=$(node audit.mjs "$f" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).renderTris))")
  if node simplify.mjs "$f" "$WORK/simp.glb" --budget "${TRI_BUDGET:-16000}" --target "${TRI_TARGET:-10000}"; then
    if [ -f "$WORK/simp.glb" ]; then
      mv "$WORK/simp.glb" "$f"
      printf '{"key":"%s","before":%s}\n' "${f#"$PACKS"/}" "$before" >> "$WORK/decimated.ndjson"
    fi
  else
    echo "  !! kept original (rig would not survive) — manifest will carry the over-tri-budget flag" >&2
  fi
done < <(find "$PACKS" -name '*.glb' -print0)
node -e '
const fs=require("fs");
const out={};
for (const l of fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) {
  const r=JSON.parse(l); out[r.key]={before:r.before};
}
fs.writeFileSync(process.argv[2], JSON.stringify(out,null,2)+"\n");
console.log(`  decimated ${Object.keys(out).length} file(s)`);
' "$WORK/decimated.ndjson" "$WORK/decimated.json"

# ── audit + manifests ───────────────────────────────────────────────────────
say "audit"
find "$PACKS" \( -name '*.glb' -o -name '*.vrm' \) -print0 | xargs -0 node audit.mjs > "$WORK/audit.ndjson"
node build-manifests.mjs "$WORK/audit.ndjson"

# The lane catalogue is derived from the manifests we just wrote — regenerate it
# in the same run so assets/packs/lanes.json (read by the engine) and the
# frontend's pack-catalog.generated.ts can never describe a stale pack.
say "lanes"
node build-lanes.mjs

say "total committed payload"
du -sh "$PACKS"
