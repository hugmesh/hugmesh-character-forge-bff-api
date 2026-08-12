package net.hugmesh.characterforgebff.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.ReactiveAuthenticationManagerResolver;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import net.hugmesh.commons.config.TenancyResolvers;
import net.hugmesh.commons.config.TenancyResourceServerConfig;
import net.hugmesh.commons.security.DomainRegistry;
import net.hugmesh.characterforgebff.testsupport.TestIssuer;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The MULTI-ISSUER security slice — replicated (pattern) from the forum-bff /
 * hugmesh-gateway reference (see {@code docs/testing/MULTI-ISSUER-SLICE.md}).
 * Proves this BFF's {@link TenancyResourceServerConfig} per-issuer resolver, wired
 * into the REAL {@link SecurityConfig} filter chain, correctly handles per-brand
 * (multi-issuer) Casdoor tokens with the security property that matters: an UNKNOWN
 * issuer fails CLOSED (401), and a token from one brand can NEVER authenticate as
 * another — which for this repo is what keeps one brand's saved characters invisible
 * to another brand's users.
 *
 * <p>Determinism with NO network and NO live Casdoor: each brand's JWKS + OIDC
 * discovery is served by an in-process {@link TestIssuer} on {@code 127.0.0.1}, so
 * {@code ReactiveJwtDecoders.fromIssuerLocation(...)} validates real RSA-signed
 * tokens offline.
 */
class MultiIssuerSecuritySliceTest extends SecuritySliceSupport {

    /**
     * Trivial controller that echoes the authenticated principal's authorities from the
     * {@link ReactiveSecurityContextHolder}. {@code /whoami} sits under
     * {@code /bff/character-forge/**} so the path-policy floor ({@code .authenticated()})
     * lets any authenticated token through and we can inspect the emitted authorities
     * (including {@code DOMAIN_<x>}).
     */
    @RestController
    static class AuthoritiesController {
        @GetMapping("/bff/character-forge/whoami")
        Mono<List<String>> whoami() {
            return ReactiveSecurityContextHolder.getContext()
                    .map(ctx -> ctx.getAuthentication().getAuthorities().stream()
                            .map(GrantedAuthority::getAuthority)
                            .sorted()
                            .toList());
        }
    }

    private TestIssuer brandX;
    private TestIssuer brandY;
    private TestIssuer rogue;       // a correctly-signed but UNLISTED issuer
    private WebTestClient client;

    @BeforeEach
    void setUp() {
        brandX = new TestIssuer();
        brandY = new TestIssuer();
        rogue = new TestIssuer();

        // Trusted set = brandX + brandY. rogue is deliberately ABSENT.
        DomainRegistry registry = new DomainRegistry(
                brandX.issuerUri(),
                brandX.issuerUri() + "=brandx," + brandY.issuerUri() + "=brandy");
        assertThat(registry.isMultiIssuer())
                .as("two trusted issuers => multi-issuer mode active (swaps onto the resolver)")
                .isTrue();
        assertThat(registry.isTrusted(rogue.issuerUri()))
                .as("the rogue issuer must NOT be trusted")
                .isFalse();

        // Build the multi-issuer resolver exactly the way the tenancy config contributes
        // it (no back-compat jwk-set-uri => discovery from each iss, which the in-process
        // TestIssuer serves). This is the REAL production resolver bean.
        ReactiveAuthenticationManagerResolver<ServerWebExchange> resolver =
                TenancyResolvers.tenantResolver(
                        new TenancyResourceServerConfig(registry, "", "", false, 600000L));

        client = sliceClient(registry, provider(resolver), new AuthoritiesController());
    }

    @AfterEach
    void tearDown() {
        brandX.close();
        brandY.close();
        rogue.close();
    }

    private List<String> authoritiesFor(String bearer) {
        return client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(bearer))
                .exchange()
                .expectStatus().isOk()
                .expectBody(new org.springframework.core.ParameterizedTypeReference<List<String>>() {})
                .returnResult()
                .getResponseBody();
    }

    // (a) USER-SITUATIONAL — a trusted brand-X token authenticates and gets DOMAIN_brandx.
    @Test
    void brandXToken_authenticatesAndGetsBrandXDomainAuthority() {
        String token = brandX.mint("user-x", List.of("user"));
        List<String> authorities = authoritiesFor(token);
        assertThat(authorities)
                .as("brand-X token resolves to brand-X's manager and is stamped DOMAIN_brandx")
                .contains("DOMAIN_brandx", "ROLE_USER")
                .doesNotContain("DOMAIN_brandy", "DOMAIN_default");
    }

    // (b) CROSS-USER DENY — an UNLISTED issuer fails CLOSED (401). The resolver returns
    // Mono.empty() for an untrusted iss; there is NO default-accept manager.
    @Test
    void unknownIssuerToken_failsClosed_401() {
        String token = rogue.mint("attacker", List.of("user", "admin"));
        client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(token))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // (c) CROSS-USER DENY — a brand-Y token is scoped to brand-Y; it can NEVER become brand-X.
    @Test
    void brandYToken_isScopedToBrandY_neverBrandX() {
        String token = brandY.mint("user-y", List.of("user"));
        List<String> authorities = authoritiesFor(token);
        assertThat(authorities)
                .as("brand-Y token is stamped DOMAIN_brandy and NEVER DOMAIN_brandx (cross-brand isolation)")
                .contains("DOMAIN_brandy", "ROLE_USER")
                .doesNotContain("DOMAIN_brandx", "DOMAIN_default");
    }

    // Fail-closed neighbour — a tampered payload (signature no longer verifies) → 401.
    @Test
    void tokenWithMismatchedSignature_failsClosed_401() {
        String valid = brandX.mint("user-x", List.of("user"));
        String tampered = tamperPayload(valid);
        client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(tampered))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // Fail-closed neighbour — a wrong-KID token: genuinely signed by brand-X's private
    // key and stamped brand-X's iss, but its JWS header kid is NOT in brand-X's published
    // JWK set, so the decoder cannot locate a verification key for it → 401. Distinct from
    // the tampered-payload case (which fails the signature check) and from the unknown-iss
    // case (which is rejected by the allowlist before any key lookup).
    @Test
    void tokenWithWrongKid_failsClosed_401() {
        String wrongKid = brandX.mintWithWrongKid("user-x", List.of("user"));
        client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth(wrongKid))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // Fail-closed neighbour — a garbage (non-JWT) bearer → 401.
    @Test
    void garbageBearer_failsClosed_401() {
        client.get().uri("/bff/character-forge/whoami")
                .headers(h -> h.setBearerAuth("not-a-jwt"))
                .exchange()
                .expectStatus().isUnauthorized();
    }

    /** Flip one base64url char in the JWT payload segment so the RS256 signature no
     *  longer verifies (header.PAYLOAD.signature). */
    private static String tamperPayload(String jwt) {
        String[] parts = jwt.split("\\.");
        char[] payload = parts[1].toCharArray();
        // flip the first char to a different valid base64url char
        payload[0] = payload[0] == 'A' ? 'B' : 'A';
        parts[1] = new String(payload);
        return parts[0] + "." + parts[1] + "." + parts[2];
    }
}
