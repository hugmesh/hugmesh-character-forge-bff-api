package systems.hugmesh.characterforgebff;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import systems.hugmesh.commons.testsupport.PostgresTestSupport;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DETERMINISTIC OpenAPI SPEC DUMP — copy-adapted from the hugmesh-forum-bff-api
 * {@code OpenApiSpecDumpTest} (the canonical CI-friendly replacement for curling a
 * manually-run server). Boots the full application context under the {@code test}
 * profile (where {@code /v3/api-docs} is PUBLIC — see
 * {@link systems.hugmesh.characterforgebff.config.SecurityConfig}), GETs the
 * springdoc-generated OpenAPI 3 document, normalizes it to a STABLE byte form
 * (alphabetically-sorted keys + 2-space pretty print + trailing newline), and writes
 * it to the committed path {@code src/main/resources/openapi/openapi.json}.
 *
 * <p><b>Why a test, not a server:</b> the spec is produced as an ordinary build
 * artefact during {@code ./mvnw test} — no port to bind, no token, no running BFF,
 * no curl. The paired {@code frontend/} character-forge remote (and any
 * ng-openapi-gen typed client) consumes the COMMITTED copy; the docs pipeline reads
 * the same artefact. The {@code springdoc} pins that make the output typed-client
 * safe live in {@code application.yml}: {@code default-produces-media-type:
 * application/json} (no {@code *}{@code /*} Blob mappings) and {@code api-docs.version:
 * openapi_3_0} (ng-openapi-gen cannot parse 3.1 type arrays).
 *
 * <p><b>Determinism:</b> springdoc emits keys in a non-deterministic order across
 * runs/JVMs. {@link SerializationFeature#ORDER_MAP_ENTRIES_BY_KEYS} re-serializes
 * every object with sorted keys, so re-running the dump on an UNCHANGED API yields a
 * byte-identical file (idempotent) — only a real endpoint/DTO change moves the file.
 *
 * <p><b>Drift guard (optional):</b> {@code -Dopenapi.spec.check=true} flips this from
 * "write" to "assert the committed file already matches" for a CI verify lane.
 * Default (no flag) is write-and-pass so a developer just re-runs the test to
 * refresh the spec.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
@ActiveProfiles("test")
class OpenApiSpecDumpTest extends PostgresTestSupport {

    /** Committed spec path (repo-relative; the test runs with cwd = module root). */
    private static final Path SPEC_PATH = Path.of("src", "main", "resources", "openapi", "openapi.json");

    private static final ObjectMapper STABLE_MAPPER = new ObjectMapper()
            .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
            .enable(SerializationFeature.INDENT_OUTPUT);

    @Autowired WebTestClient client;

    /** No live Casdoor issuer in CI — mock the reactive JWT decoder so the oauth2
     *  resource-server wiring is satisfied without a network call (matches the
     *  context-load smoke test). */
    @MockitoBean ReactiveJwtDecoder reactiveJwtDecoder;

    @Test
    void dumpsDeterministicOpenApiSpec() throws Exception {
        // The Accept: application/json header is REQUIRED. springdoc-webflux's
        // openApiResource only renders the spec for the JSON media type; a default
        // (*/*) Accept falls through to an empty `{}` text/plain body — the one piece
        // of friction the forum-bff template already ironed out.
        String raw = client.get().uri("/v3/api-docs")
                .accept(MediaType.APPLICATION_JSON)
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class)
                .returnResult()
                .getResponseBody();

        assertThat(raw).as("springdoc must serve a non-empty /v3/api-docs").isNotBlank();

        // Re-serialize with sorted keys + indentation so the on-disk form is stable
        // across runs/JVMs (springdoc's own key order is not guaranteed).
        JsonNode tree = STABLE_MAPPER.readTree(raw);

        // ONE normalization beyond key-sorting: springdoc infers `servers` from the
        // test server's RANDOM_PORT (http://localhost:<port>), which changed every
        // run and made the committed file churn (the forum-bff template's committed
        // spec carries such a baked random port — a latent determinism defect this
        // repo fixes). The real deployment is same-origin behind the fe-gateway, so
        // a single relative server entry is both stable AND more truthful.
        ObjectNode servers = STABLE_MAPPER.createObjectNode()
                .put("url", "/")
                .put("description", "same-origin via the fe-gateway (/bff/character-forge/**)");
        ((ObjectNode) tree).set("servers", STABLE_MAPPER.createArrayNode().add(servers));

        // ORDER_MAP_ENTRIES_BY_KEYS sorts java.util.Map entries — NOT ObjectNode
        // fields. Serializing the tree directly would keep springdoc's emission
        // order, which varies across JVM boots (reflection order). Convert to plain
        // Java containers first so the sort genuinely applies at every nesting level.
        Object plain = STABLE_MAPPER.treeToValue(tree, Object.class);
        String stable = STABLE_MAPPER.writeValueAsString(plain) + "\n";

        // Sanity: the document must describe THIS BFF's surface, not an empty shell —
        // pinned to the openapi_3_0 application.yml version pin and both controllers.
        assertThat(tree.path("openapi").asText()).startsWith("3.0");
        assertThat(tree.path("paths").fieldNames())
                .toIterable()
                .as("the character-forge BFF surface must be present in the dumped spec")
                .anyMatch(p -> p.startsWith("/bff/character-forge/characters"));
        assertThat(tree.path("paths").has("/bff/character-forge/map"))
                .as("the /map (VnCharacter → Char3DConfig) surface must be present")
                .isTrue();
        assertThat(tree.path("paths").has("/bff/character-forge/characters/lookup"))
                .as("the batched active-config lookup must be present")
                .isTrue();

        boolean checkOnly = Boolean.getBoolean("openapi.spec.check");
        if (checkOnly) {
            assertThat(Files.exists(SPEC_PATH))
                    .as("committed spec %s must exist when -Dopenapi.spec.check=true", SPEC_PATH)
                    .isTrue();
            String committed = Files.readString(SPEC_PATH, StandardCharsets.UTF_8);
            assertThat(committed)
                    .as("committed %s is STALE — re-run `./mvnw -Dtest=OpenApiSpecDumpTest test` "
                            + "(without -Dopenapi.spec.check) and commit the refreshed spec", SPEC_PATH)
                    .isEqualTo(stable);
            return;
        }

        Files.createDirectories(SPEC_PATH.getParent());
        Files.writeString(SPEC_PATH, stable, StandardCharsets.UTF_8);
    }
}
