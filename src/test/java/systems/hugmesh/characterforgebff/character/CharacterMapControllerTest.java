package systems.hugmesh.characterforgebff.character;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webflux.test.autoconfigure.WebFluxTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import systems.hugmesh.characterforgebff.config.SecurityConfig;
import systems.hugmesh.characterforgebff.web.ApiExceptionHandler;

import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.mockJwt;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.springSecurity;

/**
 * {@code POST /bff/character-forge/map} through real HTTP semantics — the REAL
 * {@link VnMapService} over the REAL vendored pack manifests (nothing mocked but the
 * JWT decoder): gating (401 anonymous / 200 plain user), the happy mapping path, the
 * 400 rejections, and the response being a directly-createable canonical config.
 * The full per-rule mapping matrix lives in {@link VnMapServiceTest}.
 */
@WebFluxTest(controllers = CharacterMapController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, VnMapService.class, VnPackManifests.class})
class CharacterMapControllerTest {

    @Autowired ApplicationContext context;
    WebTestClient web;

    @MockitoBean ReactiveJwtDecoder jwtDecoder;

    @BeforeEach
    void setUpClient() {
        web = WebTestClient.bindToApplicationContext(context).apply(springSecurity()).build();
    }

    private WebTestClient asUser() {
        return web.mutateWith(mockJwt()
                .jwt(jwt -> jwt.subject("sub-me"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER")));
    }

    @Test
    void anonymous_isUnauthorized() {
        web.post().uri("/bff/character-forge/map").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"packId\":\"menagerie-v1\"}")
                .exchange().expectStatus().isUnauthorized();
    }

    @Test
    void mapsARealMenagerieWolf_endToEnd() {
        asUser().post().uri("/bff/character-forge/map").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"packId\":\"menagerie-v1\","
                        + "\"slots\":{\"head\":\"head_wolf_01\",\"tail\":\"tail_wolf_bushy_01\"},"
                        + "\"palette\":{\"fur\":\"#8a5a2b\",\"iris\":\"#3366ff\"},"
                        + "\"defaultExpression\":\"happy\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.schemaVersion").isEqualTo(1)
                .jsonPath("$.head.family").isEqualTo("canid")
                .jsonPath("$.head.variant").isEqualTo("head_wolf_01")
                .jsonPath("$.parts.tail").isEqualTo("tail_wolf_bushy_01")
                .jsonPath("$.materials.fur").isEqualTo("#8a5a2b")
                .jsonPath("$.materials.iris").isEqualTo("#3366ff")
                .jsonPath("$.style").isEqualTo("toon")
                .jsonPath("$.source.packId").isEqualTo("menagerie-v1")
                .jsonPath("$.source.defaultExpression").isEqualTo("happy");
    }

    @Test
    void unknownPackId_400() {
        asUser().post().uri("/bff/character-forge/map").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"packId\":\"hacked-v9\"}")
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody().jsonPath("$.error").exists();
    }

    @Test
    void nonObjectBody_400() {
        asUser().post().uri("/bff/character-forge/map").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("[1,2,3]")
                .exchange()
                .expectStatus().isBadRequest();
    }
}
