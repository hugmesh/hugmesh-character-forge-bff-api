package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import systems.hugmesh.commons.web.ApiException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * The DESIGN §2 mapping rules, pinned one by one against the REAL vendored pack
 * manifests (the {@code vn/packs/<packId>/pack.json} copies — every ARCHETYPE-bearing
 * head/body part id used below exists in the shipped packs, so a studio pack change
 * that breaks the mapping breaks THIS test, not production; passthrough slots don't
 * require existence, only the bounded-id pattern):
 *
 * <ul>
 *   <li>{@code slots.head} partId → manifest {@code headArchetype} → {@code head.family}
 *       (+ partId as variant); fallback chain head → body → humanoid;</li>
 *   <li>kemonomimi (anime-v1) → humanoid + ears/tail parts — via the manifest, no
 *       special case;</li>
 *   <li>slot passthrough to {@code parts.*}; palette regions → materials 1:1;</li>
 *   <li>style: anime-v1 → anime, srd-taxonomy-v1 → classic, else toon;</li>
 *   <li>the output is ALWAYS valid against {@link Char3DConfigValidator} — {@code /map}
 *       can never emit a config the create/update surface rejects.</li>
 * </ul>
 */
class VnMapServiceTest {

    private static final ObjectMapper M = new ObjectMapper();

    /** The REAL manifests parsed from the vendored classpath copies. */
    private final VnMapService svc = new VnMapService(new VnPackManifests());

    private static ObjectNode vn(String packId) {
        ObjectNode root = M.createObjectNode();
        root.put("packId", packId);
        root.putObject("slots");
        root.putObject("palette");
        return root;
    }

    private static ObjectNode slots(ObjectNode vn) {
        return (ObjectNode) vn.get("slots");
    }

    // ── head/body archetype resolution (real manifest lookups) ──────────

    @Nested
    class ArchetypeResolution {

        @Test
        void menagerieWolfHead_mapsToCanidFamily_withPartIdAsVariant() {
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("head", "head_wolf_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("canid");
            assertThat(out.get("head").get("variant").textValue()).isEqualTo("head_wolf_01");
            // body falls back to the resolved head family (no body slot given).
            assertThat(out.get("body").get("archetype").textValue()).isEqualTo("canid");
        }

        @Test
        void menagerieDragonHead_mapsToDragonFamily_withDragonSnoutDefault() {
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("head", "head_dragon_metallic_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("dragon");
            assertThat(out.get("head").get("snoutLength").doubleValue())
                    .isEqualTo(VnMapService.SNOUT_BY_FAMILY.get("dragon"));
        }

        @Test
        void bodySlot_establishesBodyArchetypeIndependently() {
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("head", "head_wolf_01");            // canid head
            slots(in).put("body", "body_aquatic_01");         // aquatic body
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("canid");
            assertThat(out.get("body").get("archetype").textValue()).isEqualTo("aquatic");
        }

        @Test
        void unknownHeadPart_fallsBackToBodyLookup_thenHumanoid() {
            // Unknown head + known body -> family from the BODY lookup.
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("head", "head_does_not_exist");
            slots(in).put("body", "body_amphibian_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("amphibian");

            // Unknown head + unknown body -> humanoid.
            ObjectNode in2 = vn("menagerie-v1");
            slots(in2).put("head", "head_does_not_exist");
            ObjectNode out2 = svc.map(in2);
            assertThat(out2.get("head").get("family").textValue()).isEqualTo("humanoid");
        }

        @Test
        void kemonomimi_animeHead_landsOnHumanoid_withEarsAndTailAsParts() {
            // The DESIGN kemonomimi rule falls out of the manifest (anime heads carry
            // headArchetype: humanoid) — no special case in the mapper.
            ObjectNode in = vn("anime-v1");
            slots(in).put("head", "head_anime_round_01");
            slots(in).put("ears", "ears_neko_01");
            slots(in).put("tail", "tail_neko_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("humanoid");
            assertThat(out.get("parts").get("ears").textValue()).isEqualTo("ears_neko_01");
            assertThat(out.get("parts").get("tail").textValue()).isEqualTo("tail_neko_01");
            assertThat(out.get("head").get("earStyle").textValue()).isEqualTo("ears_neko_01");
            // humanoid gets the near-flat snout default.
            assertThat(out.get("head").get("snoutLength").doubleValue())
                    .isEqualTo(VnMapService.SNOUT_BY_FAMILY.get("humanoid"));
        }

        @Test
        void srdCanidHead_resolvesViaSrdManifest() {
            ObjectNode in = vn("srd-taxonomy-v1");
            slots(in).put("head", "head_canid_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("head").get("family").textValue()).isEqualTo("canid");
        }
    }

    // ── parts passthrough + horn feature ────────────────────────────────

    @Nested
    class PartsMapping {

        @Test
        void allSevenSlots_passThroughToParts() {
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("head", "head_wolf_01");
            slots(in).put("tail", "tail_wolf_bushy_01");
            slots(in).put("wings", "wings_feathered_01");
            slots(in).put("ears", "ears_lop_01");
            slots(in).put("feature", "feature_mane_01");
            slots(in).put("accessory", "accessory_scarf_01");
            slots(in).put("markings", "markings_socks_01");
            slots(in).put("hair", "hair_short_01");
            ObjectNode out = svc.map(in);
            assertThat(out.get("parts").get("tail").textValue()).isEqualTo("tail_wolf_bushy_01");
            assertThat(out.get("parts").get("wings").textValue()).isEqualTo("wings_feathered_01");
            assertThat(out.get("parts").get("ears").textValue()).isEqualTo("ears_lop_01");
            assertThat(out.get("parts").get("feature").textValue()).isEqualTo("feature_mane_01");
            assertThat(out.get("parts").get("accessory").textValue()).isEqualTo("accessory_scarf_01");
            assertThat(out.get("parts").get("markings").textValue()).isEqualTo("markings_socks_01");
            assertThat(out.get("parts").get("hair").textValue()).isEqualTo("hair_short_01");
        }

        @Test
        void hornOrAntlerFeature_echoesAsHornStyle_maneDoesNot() {
            ObjectNode antlers = vn("menagerie-v1");
            slots(antlers).put("feature", "feature_antlers_01");
            assertThat(svc.map(antlers).get("head").get("hornStyle").textValue())
                    .isEqualTo("feature_antlers_01");

            ObjectNode mane = vn("menagerie-v1");
            slots(mane).put("feature", "feature_mane_01");
            assertThat(svc.map(mane).get("head").get("hornStyle").isNull()).isTrue();
        }

        @Test
        void malformedPartIds_areDroppedTolerantly_neverA400() {
            ObjectNode in = vn("menagerie-v1");
            slots(in).put("tail", "tail with spaces — not an id!");
            slots(in).put("wings", "x".repeat(200));
            ObjectNode out = svc.map(in);
            assertThat(out.get("parts").get("tail").isNull()).isTrue();
            assertThat(out.get("parts").get("wings").isNull()).isTrue();
        }
    }

    // ── palette → materials ─────────────────────────────────────────────

    @Nested
    class MaterialsMapping {

        @Test
        void paletteRegions_mapToMaterials1to1_unknownAndBadDropped() {
            ObjectNode in = vn("menagerie-v1");
            ObjectNode palette = (ObjectNode) in.get("palette");
            palette.put("fur", "#8a5a2b");
            palette.put("accent", "#f0e0d0");
            palette.put("iris", "#3366ff");
            palette.put("glowingcore", "#ff0000");   // unknown region -> dropped
            palette.put("line", "not-a-hex");        // bad hex -> the canonical default
            ObjectNode out = svc.map(in);
            assertThat(out.get("materials").get("fur").textValue()).isEqualTo("#8a5a2b");
            assertThat(out.get("materials").get("accent").textValue()).isEqualTo("#f0e0d0");
            assertThat(out.get("materials").get("iris").textValue()).isEqualTo("#3366ff");
            // DESIGN §2 spells the mapping output's materials as seven plain "#hex"
            // values. A region the VN palette does not name (or names badly) gets the
            // ONE canonical default — the same table char3d-config.ts and
            // char3d_config.gd fall back to, so "Preview locally" and "Map on server"
            // cannot paint the same character two different colours.
            assertThat(out.get("materials").get("line").textValue())
                    .isEqualTo(Char3DConfigValidator.DEFAULT_MATERIALS.get("line"));
            for (String region : Char3DConfigValidator.MATERIAL_KEYS) {
                assertThat(out.get("materials").get(region).isTextual())
                        .as("materials.%s must never be null in /map output", region)
                        .isTrue();
            }
            assertThat(out.get("materials").has("glowingcore")).isFalse();
        }

        @Test
        void animeSkinAndHairRegions_carryThrough() {
            ObjectNode in = vn("anime-v1");
            ObjectNode palette = (ObjectNode) in.get("palette");
            palette.put("skin", "#ffe0bd");
            palette.put("hair", "#663399");
            ObjectNode out = svc.map(in);
            assertThat(out.get("materials").get("skin").textValue()).isEqualTo("#ffe0bd");
            assertThat(out.get("materials").get("hair").textValue()).isEqualTo("#663399");
        }
    }

    // ── style + source echo ─────────────────────────────────────────────

    @Nested
    class StyleAndSource {

        @Test
        void styleByPack_animeClassicToon() {
            assertThat(svc.map(vn("anime-v1")).get("style").textValue()).isEqualTo("anime");
            assertThat(svc.map(vn("srd-taxonomy-v1")).get("style").textValue()).isEqualTo("classic");
            assertThat(svc.map(vn("menagerie-v1")).get("style").textValue()).isEqualTo("toon");
            assertThat(svc.map(vn("base-anthro-v1")).get("style").textValue()).isEqualTo("toon");
        }

        @Test
        void sourceEcho_carriesSanitizedInputs_forRoundTrip() {
            ObjectNode in = vn("menagerie-v1");
            in.put("name", "Ranulf");
            in.put("defaultExpression", "smug");
            slots(in).put("head", "head_wolf_01");
            slots(in).putNull("tail");
            ((ObjectNode) in.get("palette")).put("fur", "#8a5a2b");
            ObjectNode out = svc.map(in);
            assertThat(out.get("name").textValue()).isEqualTo("Ranulf");
            assertThat(out.get("source").get("packId").textValue()).isEqualTo("menagerie-v1");
            assertThat(out.get("source").get("slots").get("head").textValue()).isEqualTo("head_wolf_01");
            assertThat(out.get("source").get("slots").get("tail").isNull()).isTrue();
            assertThat(out.get("source").get("palette").get("fur").textValue()).isEqualTo("#8a5a2b");
            assertThat(out.get("source").get("defaultExpression").textValue()).isEqualTo("smug");
        }

        @Test
        void unknownExpression_clampsToNeutralInTheSourceEcho() {
            // The echo's SHAPE is unconditional: the client mirror (util/map-vn.ts)
            // cannot reproduce a key set that depends on the input, and a consumer
            // that has to re-derive "neutral" itself is the same defaulting twice.
            ObjectNode in = vn("menagerie-v1");
            in.put("defaultExpression", "screaming");
            assertThat(svc.map(in).get("source").get("defaultExpression").textValue())
                    .isEqualTo("neutral");
            in.remove("defaultExpression");
            assertThat(svc.map(in).get("source").get("defaultExpression").textValue())
                    .isEqualTo("neutral");
        }

        @Test
        void sourceEchoAlwaysCarriesSlotsAndPaletteObjects() {
            ObjectNode bare = vn("menagerie-v1");
            bare.remove("slots");
            bare.remove("palette");
            ObjectNode source = (ObjectNode) svc.map(bare).get("source");
            assertThat(source.get("slots").isObject()).isTrue();
            assertThat(source.get("slots")).isEmpty();
            assertThat(source.get("palette").isObject()).isTrue();
            assertThat(source.get("palette")).isEmpty();
        }

        @Test
        void extraVnWireFields_areIgnored_notRejected() {
            // The VnCharacter wire shape carries fields we don't own (transform,
            // userParts, …) — the mapper must tolerate them.
            ObjectNode in = vn("menagerie-v1");
            in.putObject("transform").put("scale", 1.2);
            in.putArray("userParts");
            in.put("createdAt", "2026-07-19T00:00:00Z");
            ObjectNode out = svc.map(in);
            assertThat(out.get("style").textValue()).isEqualTo("toon");
        }

        @Test
        void controlCharsInName_strippedAndTruncated_tolerantly() {
            ObjectNode in = vn("menagerie-v1");
            in.put("name", "AB" + "x".repeat(300));
            ObjectNode out = svc.map(in);
            String name = out.get("name").textValue();
            assertThat(name).startsWith("AB");
            assertThat(name.length()).isLessThanOrEqualTo(120);
        }
    }

    // ── rejections ──────────────────────────────────────────────────────

    @Nested
    class Rejections {

        @Test
        void nonObjectBody_rejects400() {
            ApiException ex = catchThrowableOfType(ApiException.class, () -> svc.map(null));
            assertThat(ex).isNotNull();
            assertThat(ex.status().value()).isEqualTo(400);
            assertThat(catchThrowableOfType(ApiException.class,
                    () -> svc.map(M.createArrayNode()))).isNotNull();
        }

        @Test
        void unknownOrMissingPackId_rejects400() {
            ApiException ex = catchThrowableOfType(ApiException.class, () -> svc.map(vn("hacked-v9")));
            assertThat(ex).isNotNull();
            assertThat(ex.status().value()).isEqualTo(400);
            assertThat(ex.getMessage()).contains("packId");

            ObjectNode noPack = M.createObjectNode();
            assertThat(catchThrowableOfType(ApiException.class, () -> svc.map(noPack))).isNotNull();
        }

        @Test
        void oversizedInput_rejects400() {
            ObjectNode in = vn("menagerie-v1");
            in.put("padding", "x".repeat(VnMapService.MAX_INPUT_BYTES + 1));
            ApiException ex = catchThrowableOfType(ApiException.class, () -> svc.map(in));
            assertThat(ex).isNotNull();
            assertThat(ex.status().value()).isEqualTo(400);
        }
    }

    // ── THE guarantee: /map output is always create-able ────────────────

    @Test
    void mapOutput_isAlwaysValidAgainstTheValidator() {
        String[][] cases = {
                {"menagerie-v1", "head_wolf_01", "tail_wolf_bushy_01"},
                {"menagerie-v1", "head_dragon_crystal_01", null},
                {"anime-v1", "head_anime_sharp_01", "tail_kitsune_01"},
                {"base-anthro-v1", "head_canine_01", null},
                {"srd-taxonomy-v1", "head_reptile_01", null},
        };
        for (String[] c : cases) {
            ObjectNode in = vn(c[0]);
            slots(in).put("head", c[1]);
            if (c[2] != null) {
                slots(in).put("tail", c[2]);
            }
            ((ObjectNode) in.get("palette")).put("fur", "#8a5a2b");
            ObjectNode out = svc.map(in);
            // validate() throwing here would fail the test — /map output must ALWAYS
            // round-trip through the create/update validation unchanged.
            ObjectNode revalidated = Char3DConfigValidator.validate(out);
            assertThat(revalidated).isEqualTo(out);
        }
    }
}
