package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import net.hugmesh.commons.web.ApiException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * The FULL server-side Char3DConfig v1 contract (DESIGN §2/§3) — the single reason the
 * cross-user {@code /lookup} surface needs no moderation pass, so every rule here is
 * load-bearing:
 *
 * <ul>
 *   <li>unknown keys → 400 at EVERY level (root/source/body/head/parts/materials);</li>
 *   <li>numerics CLAMP into range; wrong TYPE still rejects (clamping is for range,
 *       never type confusion);</li>
 *   <li>hex colours match {@code ^#[0-9a-fA-F]{3,8}$}; families/styles/packs/
 *       expressions are enum-checked; ids/short strings pattern-bounded;</li>
 *   <li>the 16KB serialized cap;</li>
 *   <li>the output is the CANONICAL form (defaults applied, all seven parts/materials
 *       keys present) and re-validating it is IDEMPOTENT.</li>
 * </ul>
 */
class Char3DConfigValidatorTest {

    private static final ObjectMapper M = new ObjectMapper();

    /** A minimal VALID definition (body+head+style are the required trio). */
    private static ObjectNode minimal() {
        ObjectNode root = M.createObjectNode();
        root.put("schemaVersion", 1);
        root.putObject("body").put("archetype", "canid");
        root.putObject("head").put("family", "canid");
        root.put("style", "toon");
        return root;
    }

    private static ApiException reject(JsonNode def) {
        ApiException ex = catchThrowableOfType(ApiException.class,
                () -> Char3DConfigValidator.validate(def));
        assertThat(ex).as("expected a 400 ApiException").isNotNull();
        assertThat(ex.status().value()).isEqualTo(400);
        return ex;
    }

    // ── shape / root ────────────────────────────────────────────────────

    @Nested
    class RootShape {

        @Test
        void minimalValidDefinition_passes_andCanonicalFormIsComplete() {
            ObjectNode out = Char3DConfigValidator.validate(minimal());
            assertThat(out.get("schemaVersion").intValue()).isEqualTo(1);
            // Numeric defaults applied.
            assertThat(out.get("body").get("build").doubleValue()).isEqualTo(0.5);
            assertThat(out.get("body").get("height").doubleValue()).isEqualTo(1.0);
            assertThat(out.get("head").get("snoutLength").doubleValue()).isEqualTo(0.5);
            // ALL seven parts + materials keys always present (null = unset).
            for (String k : Char3DConfigValidator.PART_KEYS) {
                assertThat(out.get("parts").has(k)).as("parts.%s present", k).isTrue();
                assertThat(out.get("parts").get(k).isNull()).isTrue();
            }
            for (String k : Char3DConfigValidator.MATERIAL_KEYS) {
                assertThat(out.get("materials").has(k)).as("materials.%s present", k).isTrue();
            }
            assertThat(out.get("style").textValue()).isEqualTo("toon");
        }

        @Test
        void nonObject_null_andArray_reject() {
            reject(null);
            reject(M.nullNode());
            reject(M.createArrayNode());
            reject(M.getNodeFactory().textNode("{}"));
        }

        @Test
        void unknownRootKey_rejects_withKeyNamedInMessage() {
            ObjectNode def = minimal();
            def.put("payload", "smuggled");
            assertThat(reject(def).getMessage()).contains("payload");
        }

        @Test
        void schemaVersion_mustBeTheInteger1() {
            ObjectNode def = minimal();
            def.put("schemaVersion", 2);
            reject(def);
            def.put("schemaVersion", "1");          // string "1" is NOT the int 1
            reject(def);
            def.remove("schemaVersion");
            reject(def);
        }

        @Test
        void missingBody_head_orStyle_rejects() {
            ObjectNode noBody = minimal();
            noBody.remove("body");
            reject(noBody);

            ObjectNode noHead = minimal();
            noHead.remove("head");
            reject(noHead);

            ObjectNode noStyle = minimal();
            noStyle.remove("style");
            reject(noStyle);
        }

        @Test
        void definitionOver16KB_rejects() {
            ObjectNode def = minimal();
            // The name cap (120) can't reach 16KB, so oversize via the source slots.
            ObjectNode source = def.putObject("source");
            source.put("packId", "menagerie-v1");
            ObjectNode slots = source.putObject("slots");
            // ~24 slots * 64-char part ids is far under 16KB, so blow up ONE key's
            // value legality but the SIZE check runs FIRST — craft raw oversized json.
            for (int i = 0; i < Char3DConfigValidator.MAX_SOURCE_SLOTS; i++) {
                slots.put("slot-" + i, "x".repeat(64));
            }
            // Still under the cap? Then pad with a huge (invalid) name — the byte cap
            // is checked BEFORE field validation, so the 400 must name the cap.
            def.put("name", "n".repeat(20000));
            ApiException ex = reject(def);
            assertThat(ex.getMessage()).contains("16384");
        }

        @Test
        void name_over120_orWithControlChars_rejects() {
            ObjectNode longName = minimal();
            longName.put("name", "x".repeat(121));
            reject(longName);

            ObjectNode ctl = minimal();
            ctl.put("name", "evil\u0007name");          // BEL control char
            reject(ctl);

            ObjectNode nl = minimal();
            nl.put("name", "two\nlines");               // newline control char too
            reject(nl);

            ObjectNode ok = minimal();
            ok.put("name", "Fenrir the Grey");
            assertThat(Char3DConfigValidator.validate(ok).get("name").textValue())
                    .isEqualTo("Fenrir the Grey");
        }
    }

    // ── numerics: clamp range, reject type ──────────────────────────────

    @Nested
    class Numerics {

        @Test
        void build_andHeight_clampIntoRange() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("body")).put("build", 7.5);
            ((ObjectNode) def.get("body")).put("height", -3.0);
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("body").get("build").doubleValue()).isEqualTo(1.0);
            assertThat(out.get("body").get("height").doubleValue()).isEqualTo(0.5);
        }

        @Test
        void snoutLength_clamps() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("head")).put("snoutLength", 99.0);
            assertThat(Char3DConfigValidator.validate(def)
                    .get("head").get("snoutLength").doubleValue()).isEqualTo(1.0);
        }

        @Test
        void wrongTypeNumeric_rejects_notClamps() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("body")).put("build", "0.5");
            reject(def);

            ObjectNode def2 = minimal();
            ((ObjectNode) def2.get("body")).put("height", true);
            reject(def2);
        }

        /** THE MIGRATION GUARD. Every character stored before the shape axes
         *  existed carries a body block with no curve/top, and there is no
         *  migration mechanism in this service (Liquibase 001 only, definition
         *  is jsonb). Those rows MUST come back as 0.5/0.5 — the neutral value
         *  the assembler is calibrated to render exactly as it did before the
         *  axes were added. If this test ever goes red, every saved character
         *  silently changes silhouette on next load. */
        @Test
        void curve_andTop_defaultToNeutral_whenAbsent() {
            ObjectNode def = minimal();
            assertThat(def.get("body").has("curve")).isFalse();
            assertThat(def.get("body").has("top")).isFalse();

            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("body").get("curve").doubleValue()).isEqualTo(0.5);
            assertThat(out.get("body").get("top").doubleValue()).isEqualTo(0.5);
        }

        @Test
        void curve_andTop_clampIntoRange() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("body")).put("curve", 9.0);
            ((ObjectNode) def.get("body")).put("top", -4.0);
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("body").get("curve").doubleValue()).isEqualTo(1.0);
            assertThat(out.get("body").get("top").doubleValue()).isEqualTo(0.0);
        }

        @Test
        void curve_andTop_roundTripTheirValues() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("body")).put("curve", 0.9);
            ((ObjectNode) def.get("body")).put("top", 0.2);
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("body").get("curve").doubleValue()).isEqualTo(0.9);
            assertThat(out.get("body").get("top").doubleValue()).isEqualTo(0.2);
        }

        @Test
        void curve_andTop_rejectWrongType() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("body")).put("curve", "0.9");
            reject(def);

            ObjectNode def2 = minimal();
            ((ObjectNode) def2.get("body")).put("top", true);
            reject(def2);
        }
    }

    // ── enums / patterns ────────────────────────────────────────────────

    @Nested
    class EnumsAndPatterns {

        @Test
        void unknownFamily_orArchetype_orStyle_rejects() {
            ObjectNode f = minimal();
            ((ObjectNode) f.get("head")).put("family", "xenomorph");
            reject(f);

            ObjectNode a = minimal();
            ((ObjectNode) a.get("body")).put("archetype", "blob");
            reject(a);

            ObjectNode s = minimal();
            s.put("style", "photoreal");
            reject(s);
        }

        @Test
        void all29Families_areAccepted_asFamilyAndArchetype() {
            assertThat(Char3DConfigValidator.FAMILIES).hasSize(29).contains("humanoid", "slime", "synth");
            for (String fam : Char3DConfigValidator.FAMILIES) {
                ObjectNode def = minimal();
                ((ObjectNode) def.get("head")).put("family", fam);
                ((ObjectNode) def.get("body")).put("archetype", fam);
                assertThat(Char3DConfigValidator.validate(def).get("head").get("family").textValue())
                        .isEqualTo(fam);
            }
        }

        @Test
        void materials_hexPatterns_acceptedAndRejected() {
            ObjectNode def = minimal();
            ObjectNode mats = def.putObject("materials");
            mats.put("fur", "#a1B2c3");
            mats.put("accent", "#abc");
            mats.put("detail", "#aabbccdd");
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("materials").get("fur").textValue()).isEqualTo("#a1B2c3");
            assertThat(out.get("materials").get("iris").isNull()).isTrue();

            ObjectNode bad = minimal();
            bad.putObject("materials").put("fur", "red");
            reject(bad);

            ObjectNode bad2 = minimal();
            bad2.putObject("materials").put("line", "#12");        // 2 digits < 3
            reject(bad2);

            ObjectNode bad3 = minimal();
            bad3.putObject("materials").put("skin", "#ggg");
            reject(bad3);
        }

        @Test
        void extendedCoatBlocks_areOptional_validatedAndOnlyStoredWhenSupplied() {
            // kemono.md's extra colour masks (inner muzzle, socks, inner ear, tail
            // tip). The maker renders all eleven regions; the server has to accept
            // the four extended ones or a kemono character cannot be saved at all.
            ObjectNode def = minimal();
            ObjectNode mats = def.putObject("materials");
            mats.put("fur", "#8b5a2b");
            mats.put("innerMuzzle", "#ffd9c0");
            mats.put("tailTip", "#FFF");
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("materials").get("innerMuzzle").textValue()).isEqualTo("#ffd9c0");
            assertThat(out.get("materials").get("tailTip").textValue()).isEqualTo("#FFF");

            // Absent extended regions must NOT be materialized as nulls: absent is
            // the signal that the maker derives the colour, and a stored null would
            // freeze today's derivation into the character forever.
            assertThat(out.get("materials").has("socks")).isFalse();
            assertThat(out.get("materials").has("innerEar")).isFalse();

            // Canonical form round-trips unchanged (idempotence covers the new keys).
            ObjectNode again = Char3DConfigValidator.validate(out);
            assertThat(again).isEqualTo(out);

            // They are hex-validated exactly like the canonical seven.
            ObjectNode badWord = minimal();
            badWord.putObject("materials").put("socks", "beige");
            reject(badWord);

            ObjectNode badShort = minimal();
            badShort.putObject("materials").put("innerEar", "#12");
            reject(badShort);
        }

        @Test
        void unknownMaterialRegion_orPartSlot_rejects() {
            ObjectNode m = minimal();
            m.putObject("materials").put("glow", "#fff");
            reject(m);

            // Near-misses on the extended names are still unknown keys.
            ObjectNode near = minimal();
            near.putObject("materials").put("innermuzzle", "#fff");
            reject(near);

            ObjectNode p = minimal();
            p.putObject("parts").put("jetpack", "part_x");
            reject(p);
        }

        @Test
        void partIds_boundedPattern_nullAllowed() {
            ObjectNode def = minimal();
            ObjectNode parts = def.putObject("parts");
            parts.put("tail", "tail_wolf_bushy_01");
            parts.putNull("wings");
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("parts").get("tail").textValue()).isEqualTo("tail_wolf_bushy_01");
            assertThat(out.get("parts").get("wings").isNull()).isTrue();

            ObjectNode bad = minimal();
            bad.putObject("parts").put("tail", "tail with spaces!");
            reject(bad);

            ObjectNode tooLong = minimal();
            tooLong.putObject("parts").put("tail", "x".repeat(65));
            reject(tooLong);
        }

        @Test
        void headShortStrings_boundedAndOptional() {
            ObjectNode def = minimal();
            ObjectNode head = (ObjectNode) def.get("head");
            head.put("variant", "head_wolf_01");
            head.put("earStyle", "ears_lop_01");
            head.putNull("hornStyle");
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("head").get("variant").textValue()).isEqualTo("head_wolf_01");
            assertThat(out.get("head").get("hornStyle").isNull()).isTrue();

            ObjectNode bad = minimal();
            ((ObjectNode) bad.get("head")).put("variant", "x".repeat(41));
            reject(bad);
        }

        /**
         * REGRESSION (shipped 400 on the primary save path): all three client mirrors
         * encode "no variant" as the empty string — the Angular editor's free-text box
         * ({@code char3d-config.ts} {@code defaultChar3dConfig()}), the Godot maker's
         * {@code defaults()}, and the VN import when the source has no head part. The
         * short-string pattern has a minimum length of 1, so {@code ""} used to be a
         * hard 400 and NOTHING could ever be created, activated or looked up.
         */
        @Test
        void blankShortStrings_areUNSET_notARejection() {
            ObjectNode def = minimal();
            ObjectNode head = (ObjectNode) def.get("head");
            head.put("variant", "");
            head.put("earStyle", "");
            head.put("hornStyle", "   ");

            ObjectNode out = Char3DConfigValidator.validate(def);
            // variant is ALWAYS present with "" = unset (DESIGN §2 declares it a plain
            // "str ≤40"), so the canonical head has a FIXED key set the clients can
            // reproduce byte-for-byte. earStyle/hornStyle keep null as their unset.
            assertThat(out.get("head").get("variant").textValue()).isEmpty();
            assertThat(out.get("head").get("earStyle").isNull()).isTrue();
            assertThat(out.get("head").get("hornStyle").isNull()).isTrue();
            assertThat(Char3DConfigValidator.validate(out))
                    .as("blank-is-unset must stay idempotent")
                    .isEqualTo(out);
        }

        /** Blank-is-unset must not become "anything goes": a non-blank value is still
         *  pattern-checked, and the surrounding whitespace is stripped (the Godot
         *  mirror's {@code _opt_str} behaviour). */
        @Test
        void nonBlankShortStrings_areStrippedAndStillPatternChecked() {
            ObjectNode def = minimal();
            ((ObjectNode) def.get("head")).put("earStyle", "  lop ears  ");
            assertThat(Char3DConfigValidator.validate(def).get("head").get("earStyle").textValue())
                    .isEqualTo("lop ears");

            ObjectNode hostile = minimal();
            ((ObjectNode) hostile.get("head")).put("earStyle", "Lop-ears!");
            reject(hostile);

            ObjectNode markup = minimal();
            ((ObjectNode) markup.get("head")).put("variant", "<script>alert(1)</script>");
            reject(markup);

            ObjectNode wrongType = minimal();
            ((ObjectNode) wrongType.get("head")).put("hornStyle", 42);
            reject(wrongType);
        }
    }

    // ── source echo ─────────────────────────────────────────────────────

    @Nested
    class SourceEcho {

        @Test
        void validSourceEcho_roundTrips() {
            ObjectNode def = minimal();
            ObjectNode source = def.putObject("source");
            source.put("packId", "anime-v1");
            source.putObject("slots").put("head", "head_anime_round_01").putNull("tail");
            source.putObject("palette").put("skin", "#ffe0bd");
            source.put("defaultExpression", "smug");
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("source").get("packId").textValue()).isEqualTo("anime-v1");
            assertThat(out.get("source").get("defaultExpression").textValue()).isEqualTo("smug");
        }

        @Test
        void unknownPackId_orExpression_orSourceKey_rejects() {
            ObjectNode p = minimal();
            p.putObject("source").put("packId", "hacked-v9");
            reject(p);

            ObjectNode e = minimal();
            ObjectNode src = e.putObject("source");
            src.put("packId", "menagerie-v1");
            src.put("defaultExpression", "screaming");
            reject(e);

            ObjectNode k = minimal();
            ObjectNode src2 = k.putObject("source");
            src2.put("packId", "menagerie-v1");
            src2.put("svgOverride", "<svg onload=alert(1)>");
            reject(k);
        }

        @Test
        void allTenCanonicalExpressions_accepted() {
            assertThat(Char3DConfigValidator.EXPRESSIONS).containsExactly(
                    "neutral", "happy", "sad", "angry", "surprised",
                    "embarrassed", "thinking", "wink", "sleepy", "smug");
            for (String expr : Char3DConfigValidator.EXPRESSIONS) {
                ObjectNode def = minimal();
                ObjectNode src = def.putObject("source");
                src.put("packId", "menagerie-v1");
                src.put("defaultExpression", expr);
                Char3DConfigValidator.validate(def);        // must not throw
            }
        }

        @Test
        void sourceSlots_andPalette_capsEnforced() {
            ObjectNode def = minimal();
            ObjectNode src = def.putObject("source");
            src.put("packId", "menagerie-v1");
            ObjectNode slots = src.putObject("slots");
            for (int i = 0; i <= Char3DConfigValidator.MAX_SOURCE_SLOTS; i++) {
                slots.put("slot-" + i, "part-" + i);
            }
            reject(def);

            ObjectNode def2 = minimal();
            ObjectNode src2 = def2.putObject("source");
            src2.put("packId", "menagerie-v1");
            ObjectNode palette = src2.putObject("palette");
            for (int i = 0; i <= Char3DConfigValidator.MAX_SOURCE_PALETTE; i++) {
                palette.put("region-" + i, "#abc");
            }
            reject(def2);
        }
    }

    // ── canonicalization is idempotent ──────────────────────────────────

    @Test
    void canonicalForm_isIdempotent() {
        ObjectNode def = minimal();
        def.put("name", "Idempotent");
        ((ObjectNode) def.get("body")).put("build", 2.0);   // clamps to 1.0
        def.putObject("parts").put("tail", "tail_wolf_bushy_01");
        def.putObject("materials").put("fur", "#8a5a2b");
        ObjectNode once = Char3DConfigValidator.validate(def);
        ObjectNode twice = Char3DConfigValidator.validate(once);
        assertThat(twice).isEqualTo(once);
        assertThat(Char3DConfigValidator.canonicalJson(twice))
                .isEqualTo(Char3DConfigValidator.canonicalJson(once));
    }

    @Test
    void canonicalJson_isCompactDeterministicText() {
        ObjectNode out = Char3DConfigValidator.validate(minimal());
        String json = Char3DConfigValidator.canonicalJson(out);
        assertThat(json).startsWith("{\"schemaVersion\":1");
        assertThat(json).doesNotContain("\n");
    }

    @Test
    void lockedVocabularies_matchDesign() {
        assertThat(Char3DConfigValidator.STYLES).containsExactly("anime", "toon", "classic");
        assertThat(Char3DConfigValidator.PACK_IDS).containsExactly(
                "menagerie-v1", "anime-v1", "base-anthro-v1", "srd-taxonomy-v1");
        assertThat(Char3DConfigValidator.PART_KEYS).containsExactly(
                "tail", "wings", "ears", "feature", "accessory", "markings", "hair");
        assertThat(Char3DConfigValidator.MATERIAL_KEYS).containsExactly(
                "fur", "accent", "detail", "line", "iris", "skin", "hair");
        assertThat(List.of(Char3DConfigValidator.MAX_DEFINITION_BYTES)).containsExactly(16 * 1024);
    }

    @Test
    void errorsAreFieldPrecise() {
        ObjectNode def = minimal();
        ((ObjectNode) def.get("head")).put("family", "xenomorph");
        assertThatThrownBy(() -> Char3DConfigValidator.validate(def))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("definition.head.family");
    }

    @Nested
    class Rig {
        @Test
        void rig_isOptional_andAbsentFromCanonicalWhenIdentity() {
            ObjectNode def = minimal();
            def.putObject("rig").putObject("jaw").putArray("offset").add(0).add(0).add(0);
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.has("rig")).as("an all-identity rig is dropped").isFalse();
            assertThat(Char3DConfigValidator.validate(minimal()).has("rig")).isFalse();
        }

        @Test
        void rig_clampsOffsetsAndScales_andKeepsOnlyRealJoints() {
            ObjectNode def = minimal();
            ObjectNode rig = def.putObject("rig");
            ObjectNode eye = rig.putObject("eye_l");
            eye.putArray("offset").add(0.5).add(-0.5).add(0.01);
            eye.putArray("scale").add(3.0).add(0.1).add(1.0);
            rig.putObject("brow_r").putArray("scale").add(1.0).add(1.0).add(1.0);
            ObjectNode out = Char3DConfigValidator.validate(def);
            assertThat(out.get("rig").fieldNames()).toIterable().containsExactly("eye_l");
            JsonNode off = out.get("rig").get("eye_l").get("offset");
            assertThat(off.get(0).doubleValue()).isEqualTo(Char3DConfigValidator.RIG_OFFSET_MAX);
            assertThat(off.get(1).doubleValue()).isEqualTo(-Char3DConfigValidator.RIG_OFFSET_MAX);
            assertThat(off.get(2).doubleValue()).isEqualTo(0.01);
            JsonNode sc = out.get("rig").get("eye_l").get("scale");
            assertThat(sc.get(0).doubleValue()).isEqualTo(Char3DConfigValidator.RIG_SCALE_MAX);
            assertThat(sc.get(1).doubleValue()).isEqualTo(Char3DConfigValidator.RIG_SCALE_MIN);
            // Idempotent: re-validating the canonical form changes nothing.
            assertThat(Char3DConfigValidator.validate(out)).isEqualTo(out);
        }

        @Test
        void rig_rejectsUnknownJoints_unknownEntryKeys_andWrongTypes() {
            ObjectNode a = minimal();
            a.putObject("rig").putObject("nose").putArray("offset").add(0.01).add(0).add(0);
            assertThat(reject(a).getMessage()).contains("nose");
            ObjectNode b = minimal();
            b.putObject("rig").putObject("jaw").put("twist", 1.0);
            assertThat(reject(b).getMessage()).contains("twist");
            ObjectNode c = minimal();
            c.putObject("rig").putObject("jaw").putArray("offset").add("x").add(0).add(0);
            assertThat(reject(c).getMessage()).contains("definition.rig.jaw.offset");
            ObjectNode d = minimal();
            d.putObject("rig").putObject("jaw").putArray("offset").add(0).add(0);
            assertThat(reject(d).getMessage()).contains("array of 3 numbers");
            ObjectNode e = minimal();
            e.putObject("rig").put("jaw", "garbage");
            assertThat(reject(e).getMessage()).contains("definition.rig.jaw");
        }
    }
}
