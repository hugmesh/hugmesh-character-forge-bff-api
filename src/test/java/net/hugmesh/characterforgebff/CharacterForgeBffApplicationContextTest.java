package net.hugmesh.characterforgebff;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import net.hugmesh.commons.testsupport.PostgresTestSupport;

/**
 * Context-load smoke test: the full Spring context boots under the {@code test}
 * profile. The DB is a REAL Testcontainers Postgres wired by
 * {@link PostgresTestSupport} (the shared commons base auto-registers the r2dbc URL +
 * the Liquibase JDBC URL onto a fresh per-class database), so Liquibase applies
 * changelog 001 — the {@code jsonb} definition column, the {@code gen_random_uuid()}
 * PK DEFAULT and the partial unique index — and the repositories + jsonb
 * r2dbc-converters wire over the real schema. The reactive JWT decoder is mocked so
 * no live Casdoor issuer is contacted. This proves the controllers, service,
 * repositories, the vendored VN pack manifests ({@code VnPackManifests} parses all
 * four packs at startup) and the security + native-hints config wire together.
 * Mirrors the forum-bff {@code ForumBffApplicationContextTest}.
 */
@SpringBootTest
@ActiveProfiles("test")
class CharacterForgeBffApplicationContextTest extends PostgresTestSupport {

    /** No live Casdoor issuer in CI — mock the reactive JWT decoder so the
     *  oauth2 resource-server wiring is satisfied without a network call. */
    @MockitoBean ReactiveJwtDecoder reactiveJwtDecoder;

    @Test
    void contextLoads() {
        // success = the application context started with every bean wired.
    }
}
