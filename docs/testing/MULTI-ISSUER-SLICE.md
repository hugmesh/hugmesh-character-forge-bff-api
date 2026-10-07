# Multi-issuer security slice — as replicated in hugmesh-character-forge-bff-api

This repo replicates the **reference multi-issuer security-slice pattern** first
built for [`hugmesh-gateway`](https://github.com/hugmesh/hugmesh-gateway) (see
that repo's own `docs/testing/MULTI-ISSUER-SLICE.md`) and since rolled out across
the whole BFF family, with `hugmesh-forum-bff-api` as the exemplar. The slice
proves this WebFlux OAuth2 resource server correctly handles **per-brand
(multi-issuer) Casdoor tokens**, with the security property that matters most: an
**unknown issuer fails CLOSED (401)**, and a token from one brand can **never**
authenticate as another.

Determinism with **no network and no live Casdoor**: each brand's JWKS + OIDC
discovery doc is served by a tiny in-process JDK `HttpServer` bound to `127.0.0.1`, so
`ReactiveJwtDecoders.fromIssuerLocation(...)` validates real RSA-signed tokens offline.

## The two reusable seams (copied; only this repo's package + ctor shape adapted)

- `src/test/java/net/hugmesh/characterforgebff/testsupport/TestIssuer.java` —
  mints issuer-specific RS256 JWTs against an in-process JWKS. Copied from the
  gateway with only the `package` line changed; the two files have since diverged.
  The gateway's copy adds `mintExpired`, and this copy adds `mintWithWrongKid`.
  Only dependency: `nimbus-jose-jwt`, transitive via
  `spring-boot-starter-oauth2-resource-server`.
- `src/test/java/net/hugmesh/characterforgebff/config/SecuritySliceSupport.java` —
  builds this repo's REAL `SecurityConfig` filter chain into a `WebTestClient`, no full
  Spring Boot context. Adapted to this repo's `SecurityConfig(DomainRegistry,
  ObjectProvider<...>, mfaEnabled, mfaFreshnessWindowMillis)` ctor (the slices pass
  `false` and `600000L`; the gateway's ctor also takes the application name) and its
  **profile-split** chain beans: `devFilterChain` (`@Profile({"dev","test"})`, spec public) via
  `sliceClient(...)` and `filterChain` (`@Profile("!dev & !test")`, spec ADMIN-gated)
  via `prodSliceClient(...)`.

## The tests

### `MultiIssuerSecuritySliceTest` (the three core scenarios + fail-closed neighbours)

| # | Scenario | Expectation |
|---|----------|-------------|
| (a) | trusted brand-X JWT | authenticated; `DOMAIN_brandx` emitted, not `DOMAIN_brandy`/`DOMAIN_default` |
| (b) | UNLISTED issuer JWT (well-formed, correctly signed) | **401 fail-closed** — resolver returns `Mono.empty()`, no default-accept |
| (c) | brand-Y JWT | scoped to `DOMAIN_brandy`; never `DOMAIN_brandx` |
| + | tampered signature / **wrong-kid** / garbage bearer | 401 |

### `MultiIssuer401FailClosedSpringBootTest` (the **full-context** fail-closed coverage)

A `@SpringBootTest(webEnvironment = RANDOM_PORT)` that boots the WHOLE application (the
`test` profile + real auto-config) with `app.tenancy.issuers` wired from two in-process
`TestIssuer`s via `@DynamicPropertySource`. Unlike the slices above — which build
`SecurityConfig`/`TenancyResourceServerConfig` **by hand** — this exercises the production
WIRING end-to-end: the `@ConditionalOnExpression("…issuers…contains('=')")` activation of
the tenancy resolver bean, the `DomainRegistry` built from the real property, and
`SecurityConfig.resourceServer` choosing the resolver path only when
`resolver != null && domainRegistry.isMultiIssuer()`. A `productionWiring_…` assertion
pins that the multi-issuer path was actually taken in the booted context (so the
fail-closed semantics below are genuinely the resolver's). The back-compat
`issuer-uri` and `jwk-set-uri` are both pointed at brand X's in-process issuer and
JWKS. `application.yml` takes `jwk-set-uri` from the `CASDOOR_*` variables, not from
the overridden `issuer-uri`, so without the override brand X's tokens would be checked
against `https://id.hugmesh.net` over the network.

| # | Scenario | Expectation |
|---|----------|-------------|
| (a) | token from a VALID configured issuer (brand X / brand Y) | **200**; stamped its OWN `DOMAIN_<brand>` only, never another's |
| (b) | token from a FOREIGN / unconfigured issuer (well-formed, correctly signed) | **401 fail-closed**; never silently accepted, never anonymous-allowed (empty body) |
| (c) | tampered-signature / wrong-kid token | **401** — the platform refuses any token it cannot cryptographically verify |
| + | garbage bearer / no bearer | 401 |

`TestIssuer.mintWithWrongKid(...)` mints a token genuinely signed by the issuer's private
key and stamped its real `iss`, but under a JWS-header `kid` absent from the published
JWK set — so the decoder cannot locate a verification key and rejects. This is distinct
from a tampered payload (fails the signature check) and from a foreign issuer (rejected by
the allowlist before any key lookup).

### `SecurityConfigPathGateSliceTest` (coarse `authorizeExchange`, real tokens)

- `/actuator/health` public (no token);
- `/bff/character-forge/**` floor `.authenticated()` (401 unauthenticated, allowed
  authenticated — the converter floors every principal to `ROLE_USER`, so
  `.authenticated()` proves authentication);
- unknown-iss **401 end-to-end**;
- prod chain: `/v3/api-docs` requires ADMIN or SUPERADMIN (plain user 403,
  unauthenticated 401).

## Where the `ROLE_USER` gate lives

This BFF has NO admin sub-path: the whole `/bff/character-forge/**` surface is
`.authenticated()` at the filter chain (the gateway's route-access `ROLE_USER` floor is
the outer gate), and every controller method re-asserts `hasRole('USER')` via
`@PreAuthorize` (satisfied by the converter's `ROLE_USER` floor — the method gate is
defence-in-depth proof of authentication, mirroring the forum-bff VN-profile posture).
Ownership (owner == JWT subject, foreign id → **404**) and domain-scope are enforced at
the service/repository layer and covered by `CharacterForgeControllerTest`,
`CharacterForgeCharacterRepositoryTest` and `CharacterForgeRoleMatrixHttpTest`.

## Why fail-closed is the load-bearing assertion

The per-issuer resolver's allowlist is exactly `DomainRegistry.trustedIssuers()`. An
`iss` outside that set yields **no** authentication manager, so the
`JwtIssuerReactiveAuthenticationManagerResolver` surfaces a 401 **before any authority
is emitted** — there is no fallback "default" manager that could accept an unlisted
brand. Scenario (b) is the regression guard that keeps it that way.
