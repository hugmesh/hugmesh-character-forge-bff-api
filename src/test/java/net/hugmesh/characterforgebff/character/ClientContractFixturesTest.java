package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import net.hugmesh.commons.web.ApiException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The SERVER half of the shared cross-language contract fixture
 * ({@code frontend/src/app/character-forge/contract/server-contract.fixtures.json};
 * the client half is {@code contract/server-contract.spec.ts}).
 *
 * <p><b>Why this exists.</b> DESIGN §2/§3 make the BFF authoritative and the Angular /
 * Godot copies "mirrors", but nothing in either suite ever compared them. The shipped
 * result was that the frontend's own {@code defaultChar3dConfig()} — the payload every
 * first save sends — was rejected 400 by the validator over
 * {@code head.variant: ""}, so no character could be created, activated, or looked up
 * by the XR room. A per-side suite cannot catch that by construction: the Java tests
 * only ever fed the validator Java-built nodes, and the karma specs only ever compared
 * the client against itself.
 *
 * <p>This test pins the two directions the Java side owns:
 * <ol>
 *   <li>every {@code serverContract} constant in the fixture EQUALS the real
 *       {@link Char3DConfigValidator} constant, so the file cannot drift from the
 *       server (the karma spec then validates client output against it);</li>
 *   <li>every {@code acceptedDefinitions[].definition} — verbatim payloads the shipped
 *       clients POST — is ACCEPTED by the real validator;</li>
 *   <li>every {@code vnPackCredits} entry EQUALS what {@link VnPackManifests#credits()}
 *       parses out of the vendored manifests, so the attribution the Angular remote's
 *       in-app credits view renders is the manifest's own string, VERBATIM.</li>
 * </ol>
 */
class ClientContractFixturesTest {

    /** Shared with the Angular suite; surefire runs from the project basedir. */
    static final Path FIXTURES = Path.of(
            "frontend", "src", "app", "character-forge", "contract",
            "server-contract.fixtures.json");

    private static final ObjectMapper M = new ObjectMapper();

    private static JsonNode fixtures;

    @BeforeAll
    static void load() throws IOException {
        assertThat(FIXTURES).as("the shared contract fixture must ship in the repo").exists();
        fixtures = M.readTree(Files.readString(FIXTURES));
    }

    private static JsonNode contract() {
        return fixtures.get("serverContract");
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.textValue()));
        return out;
    }

    // ── direction 1: the fixture cannot drift from the server ───────────

    @Test
    void fixturePatternsAndCapsEqualTheValidatorConstants() {
        JsonNode c = contract();
        assertThat(c.get("hexPattern").textValue()).isEqualTo(Char3DConfigValidator.HEX_PATTERN);
        assertThat(c.get("partIdPattern").textValue())
                .isEqualTo(Char3DConfigValidator.PART_ID_PATTERN);
        assertThat(c.get("shortStrPattern").textValue())
                .isEqualTo(Char3DConfigValidator.SHORT_STR_PATTERN);
        assertThat(c.get("keyPattern").textValue()).isEqualTo(Char3DConfigValidator.KEY_PATTERN);
        assertThat(c.get("maxNameLength").intValue())
                .isEqualTo(Char3DConfigValidator.MAX_NAME_LENGTH);
        assertThat(c.get("maxDefinitionBytes").intValue())
                .isEqualTo(Char3DConfigValidator.MAX_DEFINITION_BYTES);
        assertThat(c.get("maxSourceSlots").intValue())
                .isEqualTo(Char3DConfigValidator.MAX_SOURCE_SLOTS);
        assertThat(c.get("maxSourcePalette").intValue())
                .isEqualTo(Char3DConfigValidator.MAX_SOURCE_PALETTE);
    }

    @Test
    void fixtureVocabulariesEqualTheValidatorVocabularies() {
        JsonNode c = contract();
        assertThat(texts(c.get("families")))
                .containsExactlyElementsOf(Char3DConfigValidator.FAMILIES);
        assertThat(texts(c.get("styles"))).containsExactlyElementsOf(Char3DConfigValidator.STYLES);
        assertThat(texts(c.get("expressions")))
                .containsExactlyElementsOf(Char3DConfigValidator.EXPRESSIONS);
        assertThat(texts(c.get("packIds")))
                .containsExactlyElementsOf(Char3DConfigValidator.PACK_IDS);
        assertThat(texts(c.get("partKeys")))
                .containsExactlyElementsOf(Char3DConfigValidator.PART_KEYS);
        assertThat(texts(c.get("materialKeys")))
                .containsExactlyElementsOf(Char3DConfigValidator.MATERIAL_KEYS);
    }

    // ── direction 2: the shipped clients' payloads must actually save ───

    @Test
    void everyShippedClientPayloadIsAcceptedByTheRealValidator() {
        JsonNode payloads = fixtures.get("acceptedDefinitions");
        assertThat(payloads).as("fixture must carry client payloads").isNotEmpty();
        for (JsonNode entry : payloads) {
            String label = entry.get("label").textValue();
            JsonNode definition = entry.get("definition");
            assertThatCode(() -> Char3DConfigValidator.validate(definition))
                    .as("POST /characters would 400 for: %s", label)
                    .doesNotThrowAnyException();
        }
    }

    @Test
    void validatingAShippedClientPayloadTwiceIsAFixedPoint() {
        for (JsonNode entry : fixtures.get("acceptedDefinitions")) {
            JsonNode canonical = Char3DConfigValidator.validate(entry.get("definition"));
            assertThat(Char3DConfigValidator.validate(canonical))
                    .as("re-validating the stored canonical form must be idempotent for: %s",
                            entry.get("label").textValue())
                    .isEqualTo(canonical);
        }
    }

    @Test
    void fixtureDefaultMaterialsEqualTheValidatorDefaults() {
        JsonNode defaults = contract().get("defaultMaterials");
        assertThat(defaults).as("fixture must carry the canonical unset-region palette").isNotNull();
        for (String region : Char3DConfigValidator.MATERIAL_KEYS) {
            assertThat(defaults.path(region).textValue())
                    .as("defaultMaterials.%s", region)
                    .isEqualTo(Char3DConfigValidator.DEFAULT_MATERIALS.get(region));
        }
    }

    /** The invisible/bidi set the display-name gate refuses — the karma mirror strips
     *  exactly these, so the two sides must be talking about the same code points. */
    @Test
    void everyFixtureForbiddenNameCodePointIsRefusedByTheValidator() {
        JsonNode points = contract().get("forbiddenNameCodePoints");
        assertThat(points).as("fixture must carry the forbidden name code points").isNotEmpty();
        for (JsonNode point : points) {
            int cp = point.intValue();
            assertThat(Char3DConfigValidator.isForbiddenNameCodePoint(cp))
                    .as("U+%04X must be forbidden in a display name", cp)
                    .isTrue();
            String hostile = "Ada" + new String(Character.toChars(cp)) + "Lovelace";
            assertThatThrownBy(() -> Char3DConfigValidator.displayName(hostile, "name"))
                    .as("displayName must reject U+%04X", cp)
                    .isInstanceOf(ApiException.class);
        }
        assertThatCode(() -> Char3DConfigValidator.displayName("Ada Lovelace", "name"))
                .as("an ordinary name still passes")
                .doesNotThrowAnyException();
    }

    // ── direction 3: /map must agree with its client mirror, case by case ──

    /**
     * The SERVER half of the DESIGN §2 "implemented BOTH in the BFF /map endpoint and
     * mirrored client-side" claim: {@link VnMapService#map} must return EXACTLY the
     * fixture's {@code expected} config, and {@code contract/server-contract.spec.ts}
     * requires {@code mapVnToChar3d} to return the same object for the same input.
     *
     * <p>Neither suite could see the drift alone, and it was real: for one menagerie
     * wolf the client answered {@code snoutLength 0.5 / earStyle null / hornStyle null
     * / body.archetype humanoid} where the server answered {@code 0.55 /
     * "ears_lop_01" / "feature_antlers_01" / canid}, so "Preview locally" and "Map on
     * server" built two different characters from one VN source and whichever the user
     * saved is what the XR room showed everyone else.
     */
    @Test
    void everyVnMapCaseMatchesTheSharedExpectation() {
        JsonNode cases = fixtures.get("vnMapCases");
        assertThat(cases).as("fixture must carry /map cases").isNotEmpty();
        VnMapService mapper = new VnMapService(new VnPackManifests());
        for (JsonNode entry : cases) {
            String label = entry.get("label").textValue();
            assertThat((JsonNode) mapper.map(entry.get("vnCharacter")))
                    .as("VnMapService.map disagrees with the shared expectation for: %s", label)
                    .isEqualTo(entry.get("expected"));
        }
    }

    /** A mapped config must also be storable as-is — {@code /map} output feeds straight
     *  into {@code POST /characters}, and the expectation is the canonical form. */
    @Test
    void everyVnMapExpectationIsAValidatorFixedPoint() {
        for (JsonNode entry : fixtures.get("vnMapCases")) {
            JsonNode expected = entry.get("expected");
            assertThat((JsonNode) Char3DConfigValidator.validate(expected))
                    .as("the mapped config for %s is not the canonical form",
                            entry.get("label").textValue())
                    .isEqualTo(expected);
        }
    }

    // ── direction 4: the in-app credits cannot drift from the manifests ──

    /**
     * The SERVER half of the credits contract. {@code vn/packs/<packId>/pack.json}
     * carries the pack-level {@code attribution}; the Angular remote ships a vendored
     * copy ({@code models/vn-pack-credits.ts}) because the credits view must render
     * signed-out and with no BFF reachable. Two vendored copies of one licence term is
     * exactly the shape that rots quietly, so the fixture pins BOTH: this test against
     * {@link VnPackManifests#credits()}, {@code server-contract.spec.ts} against
     * {@code VN_PACK_CREDITS}.
     */
    @Test
    void everyVnPackCreditEqualsTheVendoredManifest() {
        JsonNode credits = fixtures.get("vnPackCredits");
        assertThat(credits).as("fixture must carry the VN pack credit blocks").isNotEmpty();
        List<VnPackManifests.VnPackCredit> parsed = new VnPackManifests().credits();
        assertThat(credits.size()).as("one fixture entry per vendored pack")
                .isEqualTo(parsed.size());
        for (int i = 0; i < parsed.size(); i++) {
            JsonNode entry = credits.get(i);
            VnPackManifests.VnPackCredit credit = parsed.get(i);
            assertThat(entry.get("packId").textValue()).isEqualTo(credit.packId());
            assertThat(entry.get("displayName").textValue())
                    .as("displayName for %s", credit.packId())
                    .isEqualTo(credit.displayName());
            assertThat(entry.get("licenseSpdx").textValue())
                    .as("licenseSpdx for %s", credit.packId())
                    .isEqualTo(credit.licenseSpdx());
            String attribution = entry.get("attribution").textValue();   // null when JSON null
            assertThat(attribution)
                    .as("the attribution for %s must be VERBATIM", credit.packId())
                    .isEqualTo(credit.attribution());
        }
    }

    /**
     * srd-taxonomy-v1 ships SRD 5.1 material under CC-BY-4.0, whose attribution is
     * MANDATORY and must be shown to end users — not merely kept in repo metadata.
     * A re-copy of the studio pack that drops or rewords the string fails HERE rather
     * than shipping a credits view with nothing to credit.
     */
    @Test
    void theSrdPackCarriesItsMandatoryAttribution() {
        VnPackManifests.VnPackCredit srd = new VnPackManifests().credits().stream()
                .filter(c -> "srd-taxonomy-v1".equals(c.packId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("srd-taxonomy-v1 must be vendored"));
        assertThat(srd.licenseSpdx()).isEqualTo("CC-BY-4.0");
        assertThat(srd.attribution())
                .as("the SRD 5.1 attribution must reach the in-app credits view")
                .contains("System Reference Document 5.1")
                .contains("Wizards of the Coast")
                .contains("https://creativecommons.org/licenses/by/4.0/legalcode");
    }
}
