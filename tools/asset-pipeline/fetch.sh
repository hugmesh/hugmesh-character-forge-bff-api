#!/usr/bin/env bash
# fetch.sh — download every vendor archive listed in sources.json into .work/raw.
# NETWORK step; run once, then ./build.sh (offline) as often as you like.
#
# No source here needs an account or an API token. Sources that DO need one
# (Sketchfab's Download API) are listed under `notShipped` in sources.json and
# are deliberately not attempted.
set -euo pipefail
cd "$(dirname "$0")"

RAW="${WORK:-.work}/raw"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
mkdir -p "$RAW"/{quaternius,oga,poly,kaykit,100avatars,godette,khronos}

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
get() { # get <url> <dest>
  [ -s "$2" ] && { echo "  cached $(basename "$2")"; return 0; }
  curl -fsSL -A "$UA" "$1" -o "$2" && echo "  got $(basename "$2") ($(du -h "$2" | cut -f1))"
}

# ── Quaternius: quaternius.com routes every download through itch.io. The free
#    "Standard" upload needs no account — just itch's CSRF handshake, which
#    lib/itch-fetch.sh performs.
say "quaternius (itch.io, free Standard uploads)"
for g in universal-base-characters modular-character-outfits-fantasy universal-animation-library; do
  ./lib/itch-fetch.sh quaternius "$g" "$RAW/quaternius" || echo "  !! itch fetch failed for $g" >&2
done
rm -f "$RAW/quaternius/.uploads.tsv"

# ── Quaternius Ultimate Monsters + Animated Animals come from poly.pizza, which
#    serves per-model CC0 GLBs (rigged + animated) with a triangle count in the
#    page metadata — far better for curation than the 1-of-everything itch zip.
say "poly.pizza (Quaternius monsters + animals, curated)"
node lib/poly-bundle.mjs Ultimate-Monsters-Bundle-5oyGWAmOB6 "${WORK:-.work}/poly-monsters.json" >/dev/null
node lib/poly-bundle.mjs Animated-Animal-Pack-ILAPXeUYiS   "${WORK:-.work}/poly-animals.json"  >/dev/null
node lib/poly-download.mjs "$RAW/poly" "${WORK:-.work}"

# ── KayKit: GitHub mirrors of the itch packs (research: prefer GitHub URLs).
say "kaykit (github)"
ADV=KayKit-Character-Pack-Adventures-1.0
SKE=KayKit-Character-Pack-Skeletons-1.0
for c in Barbarian Knight Mage Rogue Rogue_Hooded; do
  get "https://raw.githubusercontent.com/KayKit-Game-Assets/$ADV/main/addons/kaykit_character_pack_adventures/Characters/gltf/$c.glb" "$RAW/kaykit/KayKit-Character-Pack-Adventures__$c.glb"
done
for c in Skeleton_Warrior Skeleton_Mage Skeleton_Rogue Skeleton_Minion; do
  get "https://raw.githubusercontent.com/KayKit-Game-Assets/$SKE/main/addons/kaykit_character_pack_skeletons/Characters/gltf/$c.glb" "$RAW/kaykit/KayKit-Character-Pack-Skeletons__$c.glb"
done
get "https://raw.githubusercontent.com/KayKit-Game-Assets/$ADV/main/LICENSE.txt" "$RAW/kaykit/${ADV}_LICENSE.txt"
get "https://raw.githubusercontent.com/KayKit-Game-Assets/$SKE/main/LICENSE.txt" "$RAW/kaykit/${SKE}_LICENSE.txt"

# ── OpenGameArt: the VRoid Studio CC0 bundle. Only the two BASE bodies are
#    vendored (in-file licenseName == "CC0"); AvatarSample_D..G carry
#    licenseName "Other" and blow the tri/bone budget — see sources.json.
say "opengameart (VRoid CC0 base bodies)"
get "https://opengameart.org/sites/default/files/base_female.zip" "$RAW/oga/base_female.zip"
get "https://opengameart.org/sites/default/files/base_male.zip"   "$RAW/oga/base_male.zip"

# ── 100Avatars (Polygonal Mind), CC-BY-4.0 — curated VRM importer corpus.
say "100avatars (github, curated 8)"
for v in 003/100Avatars_003_Jimmy 005/100Avatars_005_Skull 009/100Avatars_009_CactusBoy \
         010/100Avatars_010_Froggy 011/100Avatars_011_Teddy 013/100Avatars_013_Mint \
         029/100Avatars_029_Skelly 051/100Avatars_051_Polybot; do
  n=$(basename "$v")
  get "https://raw.githubusercontent.com/PolygonalMind/100Avatars/master/100Avatars_${v%%/*}/$n.vrm" "$RAW/100avatars/$n.vrm"
done
get "https://raw.githubusercontent.com/PolygonalMind/100Avatars/master/CCLicense.md" "$RAW/100avatars/CCLicense.md"
get "https://raw.githubusercontent.com/PolygonalMind/100Avatars/master/README.md" "$RAW/100avatars/README.md"

# ── Godette (CC-BY-3.0) + Khronos Fox (CC0 mesh / CC-BY-4.0 rig)
say "godette + khronos fox"
get "https://raw.githubusercontent.com/V-Sekai/godot-vrm/master/vrm_samples/Godette_vrm_v4.vrm" "$RAW/godette/Godette_vrm_v4.vrm"
get "https://raw.githubusercontent.com/V-Sekai/godot-vrm/master/vrm_samples/LICENSE_SAMPLES.txt" "$RAW/godette/LICENSE_SAMPLES.txt"
get "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb" "$RAW/khronos/Fox.glb"
get "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/README.md" "$RAW/khronos/Fox-README.md"

say "done"
du -sh "$RAW"/*
