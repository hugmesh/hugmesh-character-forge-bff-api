package net.hugmesh.characterforgebff.config;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Profile;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;
import org.springframework.security.access.hierarchicalroles.RoleHierarchy;
import org.springframework.security.access.hierarchicalroles.RoleHierarchyImpl;
import org.springframework.security.authentication.ReactiveAuthenticationManagerResolver;
import org.springframework.security.config.annotation.method.configuration.EnableReactiveMethodSecurity;
import org.springframework.security.config.core.GrantedAuthorityDefaults;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.header.ReferrerPolicyServerHttpHeadersWriter;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import net.hugmesh.commons.security.CasdoorAuthorities;
import net.hugmesh.commons.security.DomainRegistry;
import net.hugmesh.characterforgebff.security.PrincipalDomain;

/**
 * Casdoor-aware OAuth2 resource-server security for the character-forge BFF (reactive
 * WebFlux). {@code @EnableReactiveMethodSecurity} activates the {@code @PreAuthorize}
 * gates on the controllers. The JWT→authority mapping is delegated to the shared
 * {@link CasdoorAuthorities} converter — the adversarially-verified-safe
 * hugmesh-gateway logic, so the BFF and the gateway emit BYTE-IDENTICAL
 * authorities, including the reserved-prefix injection guard on {@code permissions}
 * and exactly one issuer-derived {@code DOMAIN_<x>} tenant authority.
 *
 * <p><b>Wrap-per-role-and-action.</b> The character-forge surface is gated ROLE_USER
 * at the fe-gateway (route-access). This filter chain is DEFENCE IN DEPTH on top of
 * that:
 * <ul>
 *   <li>{@code /bff/character-forge/**} -> {@code .authenticated()} — the ROLE_USER
 *       floor is enforced at the gateway; the converter adds ROLE_USER to every
 *       principal so {@code .authenticated()} proves authentication. Every controller
 *       method re-asserts {@code hasRole('USER')} via {@code @PreAuthorize} (the
 *       method-gate convention), and ownership (owner == JWT subject, foreign id →
 *       404) lives at the service layer — NOT here.</li>
 * </ul>
 * There is deliberately NO admin sub-path: the surface has no admin seam. That is
 * only defensible because EVERYTHING {@code /lookup} hands to another member is
 * bounded, server-validated data — the {@code definition} (enums, clamped numerics,
 * hex colours, pattern-bounded ids) AND the row {@code name}, which goes through
 * {@code Char3DConfigValidator.displayName}: ≤120 chars, non-blank, and no control,
 * bidirectional-override or invisible-formatting code points. The name is still
 * user-authored text, so word-level abuse remains a PLATFORM moderation concern (the
 * account behind the JWT subject), not a per-row one — this service has no takedown
 * verb by design.
 *
 * <p><b>Domain-scope (multi-brand).</b> Characters are per-domain rows; the
 * service/repo layers add a {@code domain = :domain} predicate derived SERVER-SIDE
 * from the validated issuer ({@link PrincipalDomain}), with SUPERADMIN unscoped.
 * Owner==JWT-subject is enforced independently and UNWEAKENED.
 *
 * <p><b>Multi-issuer is OPT-IN + backward-compatible.</b> When
 * {@code app.tenancy.issuers} carries per-brand issuer=domain pairs
 * ({@code TenancyResourceServerConfig} contributes a resolver AND the registry is
 * {@link DomainRegistry#isMultiIssuer()}), each trusted per-brand Casdoor validates
 * its own tokens (unknown {@code iss} → 401). Otherwise the resource server stays on
 * the existing single {@code o.jwt(...)} issuer-uri path — byte-for-byte unchanged.
 */
@Configuration
@EnableWebFluxSecurity
@EnableReactiveMethodSecurity
// SecurityConfig depends on DomainRegistry (the converter stamps the issuer-derived
// DOMAIN_<x>); PrincipalDomain is the controllers'/service's single domain-resolution
// bean. Importing both here means every @WebFluxTest slice that imports SecurityConfig
// gets them too — the slice context loads without each test re-declaring them.
@Import({DomainRegistry.class, PrincipalDomain.class})
public class SecurityConfig {

    /** Issuer→domain source of truth. Injected so the converter can stamp the
     *  cryptographically-validated {@code iss} as a {@code DOMAIN_<x>} authority.
     *  Single-issuer clusters get a registry that maps the lone issuer (or no issuer
     *  at all) to {@code DOMAIN_default}, so behaviour is unchanged. */
    private final DomainRegistry domainRegistry;

    /** OPTIONAL per-brand multi-issuer resolver. Present (non-null provider value)
     *  ONLY when {@code app.tenancy.issuers} is configured, via
     *  {@code TenancyResourceServerConfig}. When absent the resource server stays on
     *  the single {@code o.jwt(...)} issuer-uri wiring — byte-for-byte the current
     *  single-issuer path. */
    private final ObjectProvider<ReactiveAuthenticationManagerResolver<ServerWebExchange>>
            tenantAuthManagerResolver;

    /** D8 MFA derivation config (ships dark). {@code app.mfa.enabled} default false:
     *  when off the converter emits the byte-identical legacy authority set and the
     *  {@code MFA_SATISFIED} marker is NEVER produced. {@code app.mfa.freshness-window}
     *  default 10m (600000ms). Threaded into {@link CasdoorAuthorities.MfaConfig} so the
     *  single-issuer + multi-issuer paths derive the marker identically. */
    private final boolean mfaEnabled;
    private final long mfaFreshnessWindowMillis;

    public SecurityConfig(DomainRegistry domainRegistry,
                          ObjectProvider<ReactiveAuthenticationManagerResolver<ServerWebExchange>>
                                  tenantAuthManagerResolver,
                          @Value("${app.mfa.enabled:false}") boolean mfaEnabled,
                          @Value("${app.mfa.freshness-window:600000}") long mfaFreshnessWindowMillis) {
        this.domainRegistry = domainRegistry;
        this.tenantAuthManagerResolver = tenantAuthManagerResolver;
        this.mfaEnabled = mfaEnabled;
        this.mfaFreshnessWindowMillis = mfaFreshnessWindowMillis;
    }

    /**
     * SpringDoc OpenAPI spec + Swagger UI surface. {@code /v3/api-docs} is the raw
     * OpenAPI JSON the platform ng-openapi-gen typed clients (the paired in-repo
     * {@code frontend/} remote) + the docs pipeline fetch. Gated per profile (see the
     * two filter-chain beans): public under dev/test so {@code gen:fetch} can curl the
     * spec without a token, ROLE_ADMIN / SUPERADMIN everywhere else (prod) so the API
     * contract is never publicly reachable — matching the forum-bff / user-bff template.
     */
    private static final String[] SPEC_PATHS = {
            "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html", "/webjars/swagger-ui/**"
    };

    /**
     * Shared route rules common to BOTH the dev/test and prod filter chains. The
     * ONLY difference between the two profiles is how {@link #SPEC_PATHS} is gated,
     * so every other route lives here to keep the two chains in lockstep and make
     * it impossible to loosen a non-spec route by editing only one chain.
     */
    private static void commonRoutes(ServerHttpSecurity.AuthorizeExchangeSpec ex) {
        // Probes are public so k8s/Docker healthchecks need no token.
        ex.pathMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll();
        // The whole character-forge surface — the ROLE_USER floor is enforced at the
        // gateway, so .authenticated() proves authentication here. The hasRole('USER')
        // re-check + ownership (owner == JWT subject, foreign id -> 404) live at the
        // method/service level — NOT here.
        ex.pathMatchers("/bff/character-forge/**").authenticated();
    }

    /**
     * Hardened reactive HTTP-security headers — the API-defensive MINIMUM for a
     * pure-JSON resource server that always sits BEHIND the hugmesh-gateway
     * (the single TLS-terminating PEP, NIST 800-228 sec 3-4). The full
     * browser-policy set (HSTS, Permissions-Policy, COOP/CORP, UI-shell CSP) is
     * emitted ONCE at the gateway front door so all brands/BFFs inherit it and the
     * per-BFF configs can't drift; this BFF re-asserts only the defense-in-depth
     * minimum.
     *
     * <p>Applied identically to BOTH the dev/test and prod chains via a shared
     * helper so the two profiles can never drift on header policy.
     *
     * <ul>
     *   <li><b>Content-Security-Policy: {@code default-src 'none'; frame-ancestors
     *       'none'}</b> — this BFF never serves HTML/documents, so the safest CSP is
     *       the deny-everything one (defense in depth, not a document policy). NOT the
     *       UI-shell value — that belongs only at the gateway/UI host.</li>
     *   <li><b>Referrer-Policy: {@code no-referrer}</b> — kept EXPLICIT (also Spring's
     *       default) so it survives a future default change.</li>
     *   <li><b>X-Content-Type-Options: {@code nosniff}</b>, <b>X-Frame-Options:
     *       {@code DENY}</b> and <b>Cache-Control</b> are Spring Security reactive
     *       SECURE DEFAULTS — left implicit and NOT disabled.</li>
     * </ul>
     *
     * <p><b>Deliberately omitted on a JSON BFF:</b> HSTS (meaningless over the
     * plaintext intra-mesh hop — it lives only at the TLS front door) and
     * Permissions-Policy / COOP / CORP (no-document API has no browsing context to
     * police). These are NOT gaps here — the forum-bff header-policy audit applies
     * unchanged.
     */
    private static void hardenedHeaders(ServerHttpSecurity.HeaderSpec headers) {
        headers
                .contentSecurityPolicy(csp -> csp.policyDirectives(
                        "default-src 'none'; frame-ancestors 'none'"))
                .referrerPolicy(rp -> rp.policy(
                        ReferrerPolicyServerHttpHeadersWriter.ReferrerPolicy.NO_REFERRER));
        // X-Frame-Options DENY + X-Content-Type-Options nosniff + Cache-Control are
        // Spring reactive defaults — left implicit (must NOT be disabled).
    }

    /**
     * Dev / test profile: the OpenAPI spec + Swagger UI are PUBLIC so
     * {@code gen:fetch} (ng-openapi-gen) and the docs pipeline can curl
     * {@code /v3/api-docs} locally without a Casdoor token. Activate with
     * {@code SPRING_PROFILES_ACTIVE=dev} (or the {@code test} profile the slice
     * tests use). Every non-spec route is identical to prod.
     */
    @Bean
    @Profile({"dev", "test"})
    SecurityWebFilterChain devFilterChain(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .headers(SecurityConfig::hardenedHeaders)
                .authorizeExchange(ex -> {
                    commonRoutes(ex);
                    ex.pathMatchers(SPEC_PATHS).permitAll();
                    ex.anyExchange().authenticated();
                })
                .oauth2ResourceServer(this::resourceServer)
                .build();
    }

    /**
     * Production profile (default — active whenever neither {@code dev} nor
     * {@code test} is): the OpenAPI spec + Swagger UI require ROLE_ADMIN (or the
     * cross-domain SUPERADMIN super-role) so the API contract is never publicly
     * reachable. Mirrors the forum-bff / user-bff profile split. Every non-spec route
     * is identical to dev/test.
     */
    @Bean
    @Profile("!dev & !test")
    SecurityWebFilterChain filterChain(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .headers(SecurityConfig::hardenedHeaders)
                .authorizeExchange(ex -> {
                    commonRoutes(ex);
                    ex.pathMatchers(SPEC_PATHS).hasAnyRole("ADMIN", "SUPERADMIN");
                    ex.anyExchange().authenticated();
                })
                .oauth2ResourceServer(this::resourceServer)
                .build();
    }

    /**
     * Wire the OAuth2 resource server. Multi-issuer is OPT-IN: swap to the per-issuer
     * authentication-manager resolver ONLY when BOTH a resolver was contributed by
     * {@code TenancyResourceServerConfig} AND the registry is genuinely multi-issuer
     * (more than the single back-compat entry). Gating on {@code isMultiIssuer()} —
     * not merely {@code resolver != null} — keeps a single-issuer cluster on the
     * EXISTING issuer-uri {@code o.jwt(...)} decoder path even if the tenancy
     * conditional ever activates with just the lone back-compat issuer. In true
     * multi-brand mode each trusted per-brand Casdoor validates its own tokens
     * (unknown iss -> 401, fail-closed).
     */
    private void resourceServer(ServerHttpSecurity.OAuth2ResourceServerSpec o) {
        ReactiveAuthenticationManagerResolver<ServerWebExchange> resolver =
                tenantAuthManagerResolver.getIfAvailable();
        if (resolver != null && domainRegistry.isMultiIssuer()) {
            o.authenticationManagerResolver(resolver);
        } else {
            o.jwt(j -> j.jwtAuthenticationConverter(jwtConverter()));
        }
    }

    /**
     * Method-security role hierarchy — SUPERADMIN-only edges (the platform-standard
     * MINIMAL hierarchy: SUPERADMIN is a strict superset of admin/mod/user, while
     * {@code ROLE_ADMIN} and {@code ROLE_MOD} remain documented SIBLINGS with no
     * {@code ADMIN > MOD} edge). For THIS repo the load-bearing consequence is that
     * SUPERADMIN passes the {@code hasRole('USER')} method gates and reaches the
     * prod-chain ADMIN-gated spec surface; the actual per-owner authorization (and
     * the domain-scope) is enforced by the service layer.
     */
    @Bean
    RoleHierarchy roleHierarchy() {
        return RoleHierarchyImpl.fromHierarchy(
                "ROLE_SUPERADMIN > ROLE_ADMIN\n" +
                "ROLE_SUPERADMIN > ROLE_MOD\n" +
                "ROLE_SUPERADMIN > ROLE_USER");
    }

    /**
     * Wire the {@link #roleHierarchy()} into REACTIVE method security so the
     * {@code @PreAuthorize("hasRole('USER')")} gates honour {@code ROLE_SUPERADMIN >
     * ROLE_USER}. (A bare {@code RoleHierarchy} bean is NOT auto-applied to
     * {@code @PreAuthorize} in the reactive method-security path, so the expression
     * handler is set explicitly.)
     */
    // setRoleHierarchy/setDefaultRolePrefix are deprecated (since Spring Security 7.0,
    // not yet forRemoval) in favour of wiring an AuthorizationManagerFactory. That
    // factory-based path changes how @PreAuthorize SpEL expressions resolve
    // hasRole()/role-hierarchy at runtime, so swapping it in here — on the
    // security-critical SUPERADMIN role-hierarchy gate — without a dedicated,
    // adversarially-verified behavioural check would risk a silent authorization
    // regression. Suppressing rather than migrating blind (the forum-bff decision);
    // revisit alongside a focused security-behavior verification pass.
    @SuppressWarnings("deprecation")
    @Bean
    MethodSecurityExpressionHandler characterForgeMethodSecurityExpressionHandler(RoleHierarchy roleHierarchy) {
        DefaultMethodSecurityExpressionHandler handler = new DefaultMethodSecurityExpressionHandler();
        handler.setRoleHierarchy(roleHierarchy);
        // Keep the default ROLE_ prefix explicit so hasRole('USER') maps to ROLE_USER.
        handler.setDefaultRolePrefix(new GrantedAuthorityDefaults("ROLE_").getRolePrefix());
        return handler;
    }

    private ReactiveJwtAuthenticationConverter jwtConverter() {
        ReactiveJwtAuthenticationConverter converter = new ReactiveJwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(casdoorAuthoritiesConverter());
        return converter;
    }

    /**
     * Casdoor JWT → authorities conversion. Delegates to the shared
     * {@link CasdoorAuthorities} so the single-issuer path here and the optional
     * multi-issuer path ({@code TenancyResourceServerConfig}) stay byte-identical —
     * three claim sources ({@code roles} → {@code ROLE_<UPPER>}, {@code permissions}
     * verbatim MINUS reserved-prefix injection, legacy {@code isAdmin} →
     * {@code ROLE_ADMIN}), a {@code ROLE_USER} floor, plus exactly one issuer-derived
     * {@code DOMAIN_<x>} authority (NON-role; {@code DOMAIN_default} for the
     * single-issuer fallback so this cluster is unchanged).
     */
    Converter<Jwt, Flux<GrantedAuthority>> casdoorAuthoritiesConverter() {
        return CasdoorAuthorities.converter(domainRegistry,
                new CasdoorAuthorities.MfaConfig(mfaEnabled, mfaFreshnessWindowMillis));
    }
}
