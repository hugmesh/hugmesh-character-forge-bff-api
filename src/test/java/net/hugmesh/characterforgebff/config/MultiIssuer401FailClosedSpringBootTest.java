package net.hugmesh.characterforgebff.config;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.security.authentication.ReactiveAuthenticationManagerResolver;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import net.hugmesh.commons.security.DomainRegistry;
import net.hugmesh.commons.testsupport.PostgresTestSupport;
import net.hugmesh.characterforgebff.testsupport.TestIssuer;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * FULL-CONTEXT multi-issuer 401 fail-closed coverage — copy-adapted from the
 * hugmesh-forum-bff-api {@code MultiIssuer401FailClosedSpringBootTest} (route +
 * package adjusted; the mechanism is identical).
 *
 * <p><b>Why this is distinct from the existing slices.</b>
 * {@link MultiIssuerSecuritySliceTest} and {@link SecurityConfigPathGateSliceTest}
 * build {@link SecurityConfig} + the tenancy config BY HAND. They prove the
 * resolver's logic, but NOT the production WIRING that decides whether the
 * multi-issuer resolver is used at all: the
 * {@code @ConditionalOnExpression} activation of the commons
 * {@code TenancyResourceServerConfig}, {@link SecurityConfig}'s
 * {@code resolver != null && isMultiIssuer()} path choice, and the
 * {@link DomainRegistry} built from the REAL {@code app.tenancy.issuers} property at
 * context start. This test boots the WHOLE application with two in-process
 * {@link TestIssuer}s configured, then drives real RS256 tokens through the booted
 * chain.
 *
 * <p><b>The fail-closed assertions:</b> (a) a token from a configured issuer is
 * ACCEPTED and stamped its OWN {@code DOMAIN_<x>} only; (b) a correctly-signed token
 * from a FOREIGN (unlisted) issuer is 401 — never silently accepted, never treated as
 * anonymous-allowed; (c) a tampered-signature token and a wrong-{@code kid} token
 * both 401 — the platform refuses any token it cannot cryptographically verify.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
@ActiveProfiles("test")
@Import(MultiIssuer401FailClosedSpringBootTest.WhoAmITestConfig.class)
class MultiIssuer401FailClosedSpringBootTest extends PostgresTestSupport {

    /** Two trusted brands + one foreign (unlisted) issuer. STATIC so they exist before
     *  the {@code @DynamicPropertySource} runs and every method shares the URIs the
     *  booted context was wired with. */
    private static final TestIssuer BRAND_X = new TestIssuer();
    private static final TestIssuer BRAND_Y = new TestIssuer();
    private static final TestIssuer FOREIGN = new TestIssuer();   // correctly-signed, but NOT configured

    @DynamicPropertySource
    static void tenancyIssuers(DynamicPropertyRegistry registry) {
        registry.add("app.tenancy.issuers",
                () -> BRAND_X.issuerUri() + "=brandx," + BRAND_Y.issuerUri() + "=brandy");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", BRAND_X::issuerUri);
    }

    @AfterAll
    static void stopIssuers() {
        BRAND_X.close();
        BRAND_Y.close();
        FOREIGN.close();
    }

    @Autowired WebTestClient webTestClient;

    // Sanity: the production wiring really did take the multi-issuer path in the
    // booted context. If this ever regresses to the single-issuer o.jwt(...) path,
    // the fail-closed semantics below would no longer be the resolver's — so pin it.
    @Autowired DomainRegistry domainRegistry;
    @Autowired(required = false)
    ReactiveAuthenticationManagerResolver<ServerWebExchange> tenantAuthManagerResolver;

    private static final String WHOAMI = "/bff/character-forge/whoami";

    @Test
    void productionWiring_tookTheMultiIssuerPath() {
        assertThat(domainRegistry.isMultiIssuer())
                .as("two configured issuers => the registry is multi-issuer in the booted context")
                .isTrue();
        assertThat(tenantAuthManagerResolver)
                .as("the @ConditionalOnExpression tenancy resolver bean is present (issuers contains '=')")
                .isNotNull();
        assertThat(domainRegistry.isTrusted(FOREIGN.issuerUri()))
                .as("the foreign issuer is NOT in the configured allowlist")
                .isFalse();
    }

    // (a) VALID configured issuer => ACCEPTED (200), stamped its OWN domain only.
    @Test
    void validConfiguredIssuerToken_isAccepted_andStampedItsOwnDomain() {
        String token = BRAND_X.mint("user-x", List.of());
        List<String> authorities = whoami(token);
        assertThat(authorities)
                .as("brand-X token validated by brand-X's manager; stamped DOMAIN_brandx, not another brand")
                .contains("DOMAIN_brandx", "ROLE_USER")
                .doesNotContain("DOMAIN_brandy", "DOMAIN_default");
    }

    // (a') the OTHER configured issuer is likewise accepted and isolated to its own
    // domain — acceptance is per-issuer, not a blanket "any signed token" accept.
    @Test
    void otherConfiguredIssuerToken_isAccepted_andIsolatedToItsOwnDomain() {
        String token = BRAND_Y.mint("user-y", List.of("user"));
        List<String> authorities = whoami(token);
        assertThat(authorities)
                .as("brand-Y token is stamped DOMAIN_brandy and NEVER DOMAIN_brandx (cross-brand isolation)")
                .contains("DOMAIN_brandy", "ROLE_USER")
                .doesNotContain("DOMAIN_brandx", "DOMAIN_default");
    }

    // (b) FOREIGN / unconfigured issuer => 401 fail-closed. Well-formed, correctly
    // signed by its OWN key — rejected purely because its iss is not allowlisted.
    @Test
    void foreignUnconfiguredIssuerToken_isRejected_401_failClosed() {
        String token = FOREIGN.mint("attacker", List.of("user", "admin", "superadmin"));
        webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth(token))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // (b') the foreign-issuer 401 is a HARD reject, never a silent fall-through to an
    // unauthenticated-but-allowed response (a fail-OPEN bug would surface a 2xx body).
    @Test
    void foreignUnconfiguredIssuerToken_isNeverTreatedAsAnonymousAllowed() {
        String token = FOREIGN.mint("attacker", List.of("user"));
        webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth(token))
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody().isEmpty();
    }

    // (c) tampered-signature token => 401.
    @Test
    void tamperedSignatureToken_isRejected_401() {
        String tampered = tamperPayload(BRAND_X.mint("user-x", List.of("user")));
        webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth(tampered))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // (c') wrong-kid token => 401. Genuinely signed by brand-X's private key under a
    // kid absent from brand-X's published JWKS — no verification key resolvable.
    @Test
    void wrongKidToken_isRejected_401() {
        String wrongKid = BRAND_X.mintWithWrongKid("user-x", List.of("user"));
        webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth(wrongKid))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // Fail-closed neighbour — a garbage (non-JWT) bearer => 401.
    @Test
    void garbageBearer_isRejected_401() {
        webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth("not-a-jwt"))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // No bearer at all => 401 (the /bff/character-forge/** floor is .authenticated()).
    // Confirms the path is genuinely guarded, so the 200s above are real
    // authentications, not a public endpoint.
    @Test
    void noBearer_isRejected_401() {
        webTestClient.get().uri(WHOAMI)
                .exchange()
                .expectStatus().isUnauthorized();
    }

    private List<String> whoami(String bearer) {
        return webTestClient.get().uri(WHOAMI)
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody(new ParameterizedTypeReference<List<String>>() {})
                .returnResult()
                .getResponseBody();
    }

    /** Flip one base64url char in the JWT payload segment so the RS256 signature no
     *  longer verifies (header.PAYLOAD.signature). */
    private static String tamperPayload(String jwt) {
        String[] parts = jwt.split("\\.");
        char[] payload = parts[1].toCharArray();
        payload[0] = payload[0] == 'A' ? 'B' : 'A';
        parts[1] = new String(payload);
        return parts[0] + "." + parts[1] + "." + parts[2];
    }

    /**
     * A trivial authenticated endpoint under {@code /bff/character-forge/**} that
     * echoes the authenticated principal's authorities. It carries NO method
     * {@code @PreAuthorize}, so the only gate it hits is the resource server + the
     * {@code .authenticated()} path floor — isolating the JWT-VALIDATION decision
     * (the thing under test) from character-forge business logic.
     */
    @TestConfiguration
    static class WhoAmITestConfig {
        @Bean
        WhoAmIController whoAmIController() {
            return new WhoAmIController();
        }
    }

    @RestController
    static class WhoAmIController {
        @GetMapping("/bff/character-forge/whoami")
        Mono<List<String>> whoami() {
            return ReactiveSecurityContextHolder.getContext()
                    .map(ctx -> ctx.getAuthentication().getAuthorities().stream()
                            .map(GrantedAuthority::getAuthority)
                            .sorted()
                            .toList());
        }
    }
}
