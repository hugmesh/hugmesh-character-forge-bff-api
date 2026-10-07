# Vendored VN pack manifests — provenance

The four `<packId>/pack.json` files in this directory were vendored as BYTE-FAITHFUL
copies from the `hugmesh-character-studio-ui` repo. As of 2026-10-07 three still match
upstream `origin/main`; `srd-taxonomy-v1` is behind it (see the end of this file):

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

Drift, checked 2026-10-07: `menagerie-v1`, `anime-v1` and `base-anthro-v1` are
byte-identical to upstream `origin/main`. `srd-taxonomy-v1` is not. The vendored copy is
version `1.0.0` ("Taxonomy + SRD Placeholders v1", 4 slots, 10 heads); upstream is `2.0.0`
("SRD Chibi — All Species", 11 slots, 92 heads). The `licenseSpdx` and `attribution`
fields still match. A head id missing from the vendored copy falls back to `humanoid`.
Before a re-copy, note that upstream 2.0.0 also uses four `headArchetype`/`bodyArchetype`
names that are not among this BFF's 29 families (`ursine_musteline`, `bovid_cervid`,
`plant`, `lagomorph_rodent`). `VnMapService` sends any such name to `humanoid`, so a
plain re-copy would not map those heads to a beast family.

License note: srd-taxonomy-v1 carries SRD 5.1 CC-BY-4.0 attribution inside its
manifest (`licenseSpdx`/`attribution` fields) — preserved verbatim by the
byte-faithful copy. CC-BY discharges on what the END USER sees, so that string is
also rendered in-app by the forge's credits view
(`frontend/src/app/character-forge/panels/credits.component.html`, from the
vendored `models/vn-pack-credits.ts`). `VnPackManifests.credits()` parses the
same block here, and the shared contract fixture
(`frontend/.../contract/server-contract.fixtures.json` -> `vnPackCredits`) pins
the two copies equal — so a re-copy that changes a notice must update the
vendored client copy too, or `ClientContractFixturesTest` fails.
