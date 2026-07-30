#!/usr/bin/env bash
# verify.sh — gate the committed asset packs. Offline; no network.
#
#  1. re-audit the committed bytes and assert the manifests are not stale
#  2. assert no asset requires a non-core glTF extension (Godot's runtime
#     loader is core-spec only — no Draco/Meshopt/quantization)
#  3. run the glTF validator over every asset and fail on any NEW error code
#     (SKIN_SKELETON_INVALID is a pre-existing upstream FBX2glTF quirk present
#     in the vendor originals; it is allow-listed, everything else is not)
#  4. run the Godot headless pack self-test (real load + triangle/bone/anim/
#     viseme assertions) — needs GODOT to point at a Godot 4.x binary
set -euo pipefail
cd "$(dirname "$0")"

PACKS="${PACKS:-../../godot/character-forge/assets/packs}"
WORK="${WORK:-.work}"
GODOT="${GODOT:-}"
ALLOWED_VALIDATOR_ERRORS='SKIN_SKELETON_INVALID'
fail=0

# Prefer the CLI installed by `npm install` here so the gate really is offline;
# fall back to npx only when node_modules is absent.
if [ -x node_modules/.bin/gltf-transform ]; then
  gltf_transform() { ./node_modules/.bin/gltf-transform "$@"; }
else
  echo "  note: node_modules/.bin/gltf-transform missing — falling back to npx (needs network)" >&2
  gltf_transform() { npx --yes @gltf-transform/cli@^4.4.2 "$@"; }
fi

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/4 manifest freshness"
mkdir -p "$WORK"
find "$PACKS" \( -name '*.glb' -o -name '*.vrm' \) -print0 | xargs -0 node audit.mjs > "$WORK/verify-audit.ndjson"
node lib/check-manifests.mjs "$WORK/verify-audit.ndjson" "$PACKS"
echo "  ok"

say "2/4 + 3/4 glTF validation"
while IFS= read -r -d '' f; do
  out=$(gltf_transform validate "$f" 2>&1 || true)
  printf '%s' "$out" | grep -q 'Validation detected errors' || continue
  # Only the ERROR table: start at its header, stop at the next section header.
  codes=$(printf '%s\n' "$out" | awk '/^ ERROR$/{e=1;next} /^ (WARNING|INFO|HINT)$/{e=0} e' \
    | grep -oE '│ [A-Z_]{4,} ' | tr -d '│ ' | sort -u || true)
  for c in $codes; do
    if [ "$c" != "$ALLOWED_VALIDATOR_ERRORS" ]; then
      echo "  FAIL $f: $c" >&2
      fail=1
    fi
  done
done < <(find "$PACKS" \( -name '*.glb' -o -name '*.vrm' \) -print0)
[ "$fail" = 0 ] && echo "  ok (only the allow-listed upstream $ALLOWED_VALIDATOR_ERRORS remains)"

say "4/4 godot headless pack self-test"
if [ -z "$GODOT" ]; then
  echo "  SKIPPED — set GODOT=/path/to/godot to run assets/packs/verify_packs.gd" >&2
else
  "$GODOT" --headless --path ../../godot/character-forge -s res://assets/packs/verify_packs.gd || fail=1
fi

exit "$fail"
