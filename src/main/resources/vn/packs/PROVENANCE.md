# Vendored VN pack manifests — provenance

The four `<packId>/pack.json` files in this directory are BYTE-FAITHFUL vendored
copies from the `hugmesh-character-studio-ui` repo:

    hugmesh-character-studio-ui/src/assets/vn/packs/menagerie-v1/pack.json
    hugmesh-character-studio-ui/src/assets/vn/packs/anime-v1/pack.json
    hugmesh-character-studio-ui/src/assets/vn/packs/base-anthro-v1/pack.json
    hugmesh-character-studio-ui/src/assets/vn/packs/srd-taxonomy-v1/pack.json

(The platform convention marks vendored cross-repo models with a provenance
header comment; `pack.json` is JSON, which carries no comments, so this sidecar
file is the provenance record — the copies themselves stay byte-identical to the
source so drift is a plain `diff`.)

WHY they are vendored here: the `/bff/character-forge/map` endpoint implements
the server-side half of the VnCharacter→Char3DConfig mapping (DESIGN §2), whose
first rule is "look up the head part's `headArchetype` in the pack manifest".
`VnPackManifests` parses ONLY the stable parameterization out of these files at
startup (slot → partId → headArchetype); the SVG file paths/anchors/z-orders are
ignored — mapping keys off the parameterization, never the SVG geometry.

WHEN the studio packs change: re-copy the four files verbatim and re-run the
tests (`VnMapServiceTest` pins the mapping behaviour; a removed/renamed part
falls back per the documented partId → body-archetype → humanoid chain, so a
stale copy degrades gracefully rather than failing).

License note: srd-taxonomy-v1 carries SRD 5.1 CC-BY-4.0 attribution inside its
manifest (`licenseSpdx`/`attribution` fields) — preserved verbatim by the
byte-faithful copy.
