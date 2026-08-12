package net.hugmesh.characterforgebff.character;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import net.hugmesh.commons.testsupport.PostgresTestSupport;
import net.hugmesh.characterforgebff.testsupport.TestIssuer;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The ROLE MATRIX + OWNERSHIP + DOMAIN-ISOLATION contract asserted at the HTTP layer
 * with REAL RS256 tokens (the forum-bff {@code ForumRoleMatrixHttpTest} /
 * {@code ForumDomainIsolationHttpTest} pattern). {@code CharacterForgeControllerTest}
 * pins the same gates with {@code mockJwt().authorities(...)} over a MOCKED repository
 * — hand-assembled authorities that skip the real Casdoor JWT → {@code ROLE_<UPPER>}
 * conversion, the issuer→domain stamping, and the real store. This class drives the
 * REAL filter chain + REAL {@link CharacterForgeService} + REAL Postgres
 * (Testcontainers, production Liquibase changelog) authenticated by REAL tokens whose
 * {@code roles}/{@code iss} claims the production converter maps — the exact way a
 * browser token is processed.
 *
 * <p>The character-forge matrix is deliberately FLAT (DESIGN §3): the whole surface
 * is {@code .authenticated()} + {@code hasRole('USER')} method gates, and the
 * converter floors EVERY authenticated principal to ROLE_USER — so the load-bearing
 * rows are:
 * <ul>
 *   <li><b>no token → 401</b> (the path floor is real);</li>
 *   <li><b>any authenticated principal → allowed</b> (no-roles/user/admin all pass;
 *       SUPERADMIN passes via the {@code ROLE_SUPERADMIN > ROLE_USER} hierarchy);</li>
 *   <li><b>ownership is NOT a role:</b> a foreign owner's id is <b>404, never 403</b>
 *       on GET/PUT/DELETE/activate — and this floor is UNWEAKENED even for
 *       SUPERADMIN (the owner predicate keys on the JWT {@code sub});</li>
 *   <li><b>domain isolation:</b> a brand-Y caller cannot address a brand-X row (404)
 *       and a brand-Y {@code /lookup} does NOT resolve a brand-X active config —
 *       while the cross-USER same-brand lookup (the XR room's avatar resolve)
 *       DOES resolve it, which is the point of the surface;</li>
 *   <li><b>the validator sits on the real boundary:</b> an unknown definition key is
 *       a 400 through the whole booted stack.</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
@ActiveProfiles("test")
class CharacterForgeRoleMatrixHttpTest extends PostgresTestSupport {

    /** Two trusted brands, BOTH kept running (brand-Y mints the cross-brand callers).
     *  STATIC so they exist before the {@code @DynamicPropertySource} runs and all
     *  methods share the URIs the booted context was wired with. */
    private static final TestIssuer BRAND_X = new TestIssuer();
    private static final TestIssuer BRAND_Y = new TestIssuer();

    @DynamicPropertySource
    static void tenancy(DynamicPropertyRegistry registry) {
        registry.add("app.tenancy.issuers",
                () -> BRAND_X.issuerUri() + "=brandx," + BRAND_Y.issuerUri() + "=brandy");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", BRAND_X::issuerUri);
    }

    @AfterAll
    static void stopIssuers() {
        BRAND_X.close();
        BRAND_Y.close();
    }

    @Autowired WebTestClient web;

    private static final String BASE = "/bff/character-forge/characters";

    /** Minimal VALID Char3DConfig v1 (required: schemaVersion, body, head, style). */
    private static final String DEF =
            "{\"schemaVersion\":1,\"body\":{\"archetype\":\"canid\"},"
                    + "\"head\":{\"family\":\"canid\"},\"style\":\"toon\"}";

    private static String createBody(String name) {
        return "{\"name\":\"" + name + "\",\"definition\":" + DEF + "}";
    }

    private String tokenX(String subject, String... roles) {
        return BRAND_X.mint(subject, List.of(roles));
    }

    private String tokenY(String subject, String... roles) {
        return BRAND_Y.mint(subject, List.of(roles));
    }

    /** POST a valid character as the given bearer; returns the created id. */
    private String create(String bearer, String name) {
        byte[] body = web.post().uri(BASE)
                .headers(h -> h.setBearerAuth(bearer))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(createBody(name))
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.id").isNotEmpty()
                .jsonPath("$.active").isEqualTo(false)
                .returnResult().getResponseBody();
        String json = new String(body, java.nio.charset.StandardCharsets.UTF_8);
        // id is the first field of CharacterView; extract without a mapper dependency.
        int idx = json.indexOf("\"id\":\"");
        return json.substring(idx + 6, idx + 6 + 36);
    }

    // ── the ROLE rows (real converter: every principal floors to ROLE_USER) ──

    @Test
    void unauthenticated_401_onListCreateAndIdVerbs() {
        web.get().uri(BASE).exchange().expectStatus().isUnauthorized();
        web.post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue(createBody("nope")).exchange().expectStatus().isUnauthorized();
        web.delete().uri(BASE + "/" + UUID.randomUUID()).exchange().expectStatus().isUnauthorized();
    }

    @Test
    void tokenWithNoRoles_floorsToRoleUser_andIsAllowed() {
        // The converter's ROLE_USER floor: a token carrying an EMPTY roles claim still
        // passes the hasRole('USER') method gate (200 with an owner-scoped list).
        web.get().uri(BASE)
                .headers(h -> h.setBearerAuth(BRAND_X.mint("norole-" + UUID.randomUUID(), List.of())))
                .exchange()
                .expectStatus().isOk()
                .expectBody().json("[]");
    }

    @Test
    void userRole_isAllowed() {
        web.get().uri(BASE)
                .headers(h -> h.setBearerAuth(tokenX("plainuser-" + UUID.randomUUID(), "user")))
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    void adminRole_isAllowed_viaTheUserFloor() {
        // ADMIN holds ROLE_USER via the converter floor (not via a hierarchy edge).
        web.get().uri(BASE)
                .headers(h -> h.setBearerAuth(tokenX("adm-" + UUID.randomUUID(), "admin")))
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    void superadmin_isAllowed_byHierarchyAndFloor() {
        web.get().uri(BASE)
                .headers(h -> h.setBearerAuth(tokenX("su-" + UUID.randomUUID(), "superadmin")))
                .exchange()
                .expectStatus().isOk();
    }

    // ── OWNERSHIP: foreign id → 404, NEVER 403 (across every id verb) ──

    @Test
    void foreignOwnersId_is404NotForbidden_onEveryIdVerb() {
        String owner = "owner-a-" + UUID.randomUUID();
        String stranger = "stranger-" + UUID.randomUUID();
        String id = create(tokenX(owner, "user"), "mine");

        // The owner reads it back fine (control).
        web.get().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(tokenX(owner, "user")))
                .exchange().expectStatus().isOk();

        String strangerBearer = tokenX(stranger, "user");
        // GET / PUT / DELETE / PUT-active all surface 404 — indistinguishable from a
        // nonexistent id (no existence oracle), and specifically NOT a 403.
        web.get().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(strangerBearer))
                .exchange().expectStatus().isNotFound();
        web.put().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(strangerBearer))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(createBody("stolen"))
                .exchange().expectStatus().isNotFound();
        web.put().uri(BASE + "/" + id + "/active")
                .headers(h -> h.setBearerAuth(strangerBearer))
                .exchange().expectStatus().isNotFound();
        web.delete().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(strangerBearer))
                .exchange().expectStatus().isNotFound();

        // And the row is untouched: the owner still sees the original name.
        web.get().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(tokenX(owner, "user")))
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.name").isEqualTo("mine");
    }

    @Test
    void superadmin_cannotAddressAnotherOwnersId_ownershipFloorUnweakened() {
        String owner = "owner-b-" + UUID.randomUUID();
        String id = create(tokenX(owner, "user"), "keep-out");
        // SUPERADMIN is domain-UNSCOPED but the owner==sub predicate stands: 404.
        web.get().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(tokenX("su-" + UUID.randomUUID(), "superadmin")))
                .exchange().expectStatus().isNotFound();
    }

    // ── the ACTIVE flow over the real store ──

    @Test
    void activeFlow_noActive404_thenActivate_thenSwapKeepsSingleActive() {
        String owner = "owner-c-" + UUID.randomUUID();
        String bearer = tokenX(owner, "user");

        web.get().uri(BASE + "/active")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange().expectStatus().isNotFound();

        String first = create(bearer, "first");
        String second = create(bearer, "second");

        web.put().uri(BASE + "/" + first + "/active")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.active").isEqualTo(true);
        web.get().uri(BASE + "/active")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.id").isEqualTo(first);

        // Activating the second SWAPS (single active per owner+brand).
        web.put().uri(BASE + "/" + second + "/active")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange().expectStatus().isOk();
        web.get().uri(BASE + "/active")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.id").isEqualTo(second);
        web.get().uri(BASE + "/" + first)
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.active").isEqualTo(false);
    }

    // ── LOOKUP: cross-USER within a brand resolves; cross-BRAND does not ──

    @Test
    void lookup_resolvesAnotherUsersActiveConfig_sameBrand_theXrRoomContract() {
        String owner = "owner-d-" + UUID.randomUUID();
        String ownerBearer = tokenX(owner, "user");
        String id = create(ownerBearer, "avatar-d");
        web.put().uri(BASE + "/" + id + "/active")
                .headers(h -> h.setBearerAuth(ownerBearer))
                .exchange().expectStatus().isOk();

        String ghost = "ghost-" + UUID.randomUUID();   // no active character
        // A DIFFERENT same-brand user resolves the owner's active config — the
        // cross-user read is the surface's purpose; the ghost subject is ABSENT.
        web.post().uri(BASE + "/lookup")
                .headers(h -> h.setBearerAuth(tokenX("viewer-" + UUID.randomUUID(), "user")))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[\"" + owner + "\",\"" + ghost + "\"]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.configs['" + owner + "'].name").isEqualTo("avatar-d")
                .jsonPath("$.configs['" + owner + "'].definition.style").isEqualTo("toon")
                .jsonPath("$.configs['" + ghost + "']").doesNotExist();
    }

    @Test
    void lookup_fromAnotherBrand_doesNotResolve_theBrandWall() {
        String owner = "owner-e-" + UUID.randomUUID();
        String ownerBearer = tokenX(owner, "user");
        String id = create(ownerBearer, "avatar-e");
        web.put().uri(BASE + "/" + id + "/active")
                .headers(h -> h.setBearerAuth(ownerBearer))
                .exchange().expectStatus().isOk();

        // brand-Y caller: the brand-X active config is INVISIBLE (absent key)…
        web.post().uri(BASE + "/lookup")
                .headers(h -> h.setBearerAuth(tokenY("y-viewer-" + UUID.randomUUID(), "user")))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[\"" + owner + "\"]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.configs['" + owner + "']").doesNotExist();

        // …and the row is not id-addressable either — even for the SAME subject
        // string authenticated by the OTHER brand's issuer (404, the brand wall).
        web.get().uri(BASE + "/" + id)
                .headers(h -> h.setBearerAuth(tokenY(owner, "user")))
                .exchange().expectStatus().isNotFound();
    }

    @Test
    void lookup_beanValidationBounds_51Subjects400_empty400() {
        StringBuilder many = new StringBuilder("{\"subjects\":[");
        for (int i = 0; i < 51; i++) {
            many.append(i > 0 ? "," : "").append("\"s-").append(i).append('"');
        }
        many.append("]}");
        String bearer = tokenX("bounds-" + UUID.randomUUID(), "user");
        web.post().uri(BASE + "/lookup")
                .headers(h -> h.setBearerAuth(bearer))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(many.toString())
                .exchange().expectStatus().isBadRequest();
        web.post().uri(BASE + "/lookup")
                .headers(h -> h.setBearerAuth(bearer))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[]}")
                .exchange().expectStatus().isBadRequest();
    }

    // ── the validator guards the REAL boundary ──

    @Test
    void invalidDefinition_unknownKey_is400_throughTheBootedStack() {
        String bad = "{\"name\":\"x\",\"definition\":{\"schemaVersion\":1,"
                + "\"body\":{\"archetype\":\"canid\"},\"head\":{\"family\":\"canid\"},"
                + "\"style\":\"toon\",\"payload\":\"nope\"}}";
        web.post().uri(BASE)
                .headers(h -> h.setBearerAuth(tokenX("val-" + UUID.randomUUID(), "user")))
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(bad)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody().jsonPath("$.error").value(err ->
                        assertThat(String.valueOf(err)).contains("unknown key"));
    }
}
