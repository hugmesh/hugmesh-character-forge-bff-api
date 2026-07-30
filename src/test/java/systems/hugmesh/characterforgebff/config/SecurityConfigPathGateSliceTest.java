package systems.hugmesh.characterforgebff.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.ReactiveAuthenticationManagerResolver;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import systems.hugmesh.commons.config.TenancyResolvers;
import systems.hugmesh.commons.config.TenancyResourceServerConfig;
import systems.hugmesh.commons.security.DomainRegistry;
import systems.hugmesh.characterforgebff.testsupport.TestIssuer;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The COARSE PATH-GATE slice — exercises this repo's real {@code authorizeExchange}
 * policy (in {@link SecurityConfig}) end-to-end through the production filter chain
 * with REAL RS256 tokens (minted by an in-process {@link TestIssuer}, zero network),
 * not mocked authorities. Companion to {@link MultiIssuerSecuritySliceTest}; the slice
 * plumbing is identical (see {@code docs/testing/MULTI-ISSUER-SLICE.md}), only the
 * path/role table changes.
 *
 * <p>What the coarse path policy decides (from {@code SecurityConfig.commonRoutes}):
 * <ul>
 *   <li>{@code /actuator/health} (+ {@code /info}) — {@code permitAll} (no token).</li>
 *   <li>{@code /bff/character-forge/**} — {@code .authenticated()} (the ROLE_USER
 *       floor is enforced upstream at the gateway; here authentication is enough at
 *       the path level — the {@code hasRole('USER')} re-checks live at the METHOD
 *       level, and ownership at the SERVICE level).</li>
 *   <li>{@code anyExchange()} — {@code .authenticated()}.</li>
 * </ul>
 *
 * <p><b>There is deliberately NO admin sub-path</b> (the surface has no admin seam —
 * every stored definition is fully server-validated parametric data); the only
 * role-gated paths are the PROD chain's OpenAPI-spec paths, asserted below via
 * {@link SecuritySliceSupport#prodSliceClient}.
 */
class SecurityConfigPathGateSliceTest extends SecuritySliceSupport {

    /** Tiny controller covering the gated path prefix — it only needs to EXIST so
     *  the path policy has something to (dis)allow; the body is never reached on a 401. */
    @RestController
    @RequestMapping("/bff/character-forge")
    static class ForgeStub {
        @GetMapping("/whoami")
        Mono<String> whoami() { return Mono.just("ok"); }
        @GetMapping("/characters")
        Mono<String> characters() { return Mono.just("[]"); }
    }

    @RestController
    static class HealthStub {
        @GetMapping("/actuator/health")
        Mono<String> health() { return Mono.just("UP"); }
    }

    private TestIssuer issuer;
    private DomainRegistry registry;
    private WebTestClient client;       // dev/test chain (spec public)
    private WebTestClient prodClient;   // prod chain (spec ADMIN-gated)

    @BeforeEach
    void setUp() {
        issuer = new TestIssuer();
        // One-brand trusted registry driving the REAL multi-issuer resolver so the
        // slice gets a working offline decoder without a Spring property context (the
        // forum-bff/path-gate approach). The path policy under test is identical
        // either way (commonRoutes is shared), and the resolver still 401s an
        // unknown iss.
        registry = new DomainRegistry(issuer.issuerUri(),
                issuer.issuerUri() + "=brandx," + issuer.issuerUri() + "/other=brandy");
        ReactiveAuthenticationManagerResolver<ServerWebExchange> resolver =
                TenancyResolvers.tenantResolver(
                        new TenancyResourceServerConfig(registry, "", "", false, 600000L));
        Object[] controllers = {new ForgeStub(), new HealthStub()};
        client = sliceClient(registry, provider(resolver), controllers);
        prodClient = prodSliceClient(registry, provider(resolver), controllers);
    }

    @AfterEach
    void tearDown() {
        issuer.close();
    }

    private String tokenWithRoles(String... roles) {
        return issuer.mint("u", List.of(roles));
    }

    // --- public probe -------------------------------------------------------

    @Test
    void healthProbe_isPublic_noToken() {
        client.get().uri("/actuator/health").exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("UP");
    }

    // --- the floor: /bff/character-forge/** is .authenticated() --------------

    @Test
    void forgeFloor_unauthenticated_401() {
        client.get().uri("/bff/character-forge/whoami").exchange()
                .expectStatus().isUnauthorized();
        client.get().uri("/bff/character-forge/characters").exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void forgeFloor_plainAuthenticatedUser_allowed() {
        // Even a token with NO explicit roles floors to ROLE_USER (the converter) and
        // passes the PATH layer — the surface serves any logged-in user.
        client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(issuer.mint("plain", List.of())))
                .exchange()
                .expectStatus().isOk();
    }

    // --- unknown-iss 401 end-to-end (fail-closed) ---------------------------

    @Test
    void unknownIssuer_failsClosed_401_endToEnd() {
        try (TestIssuer rogue = new TestIssuer()) {
            assertThat(registry.isTrusted(rogue.issuerUri())).isFalse();
            client.get().uri("/bff/character-forge/whoami")
                    .headers(h -> h.setBearerAuth(rogue.mint("attacker", List.of("user", "admin"))))
                    .exchange()
                    .expectStatus().isUnauthorized();
        }
    }

    // --- anyExchange floor: an unmapped path still needs authentication ------

    @Test
    void unmappedPath_unauthenticated_401() {
        client.get().uri("/some/other/path").exchange()
                .expectStatus().isUnauthorized();
    }

    // --- dev/test chain: OpenAPI spec paths are PUBLIC ------------------------

    @Test
    void devChain_specPath_isPublic() {
        // 404 (no springdoc controller bound in this slice) — but NOT 401/403: the
        // dev/test chain permits the spec path without a token.
        client.get().uri("/v3/api-docs").exchange()
                .expectStatus().value(s -> assertThat(s).isNotIn(401, 403));
    }

    // --- prod chain: OpenAPI spec paths require ADMIN/SUPERADMIN -------------

    @Test
    void prodChain_specPath_plainUser_forbidden_403() {
        prodClient.get().uri("/v3/api-docs")
                .headers(h -> h.setBearerAuth(tokenWithRoles("user")))
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    void prodChain_specPath_admin_notForbidden() {
        // ADMIN passes the spec gate (404 here — no springdoc controller in the
        // slice — but the GATE decision is what's under test: not 401/403).
        prodClient.get().uri("/v3/api-docs")
                .headers(h -> h.setBearerAuth(tokenWithRoles("admin")))
                .exchange()
                .expectStatus().value(s -> assertThat(s).isNotIn(401, 403));
    }

    @Test
    void prodChain_specPath_superadmin_notForbidden_viaRole() {
        prodClient.get().uri("/v3/api-docs")
                .headers(h -> h.setBearerAuth(tokenWithRoles("superadmin")))
                .exchange()
                .expectStatus().value(s -> assertThat(s).isNotIn(401, 403));
    }

    @Test
    void prodChain_specPath_unauthenticated_401() {
        prodClient.get().uri("/v3/api-docs").exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void prodChain_forgeFloor_identicalToDevChain() {
        // commonRoutes is SHARED between the two chains — the forge floor must behave
        // identically through the prod chain (authenticated 200 / anonymous 401).
        prodClient.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(tokenWithRoles("user")))
                .exchange()
                .expectStatus().isOk();
        prodClient.get().uri("/bff/character-forge/whoami").exchange()
                .expectStatus().isUnauthorized();
    }
}
