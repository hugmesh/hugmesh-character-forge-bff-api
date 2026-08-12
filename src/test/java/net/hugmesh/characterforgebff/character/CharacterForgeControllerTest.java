package net.hugmesh.characterforgebff.character;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webflux.test.autoconfigure.WebFluxTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import net.hugmesh.characterforgebff.config.SecurityConfig;
import net.hugmesh.characterforgebff.web.ApiExceptionHandler;

import java.time.Instant;
import java.util.Collection;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.mockJwt;
import static org.springframework.security.test.web.reactive.server.SecurityMockServerConfigurers.springSecurity;

/**
 * Character-surface contract + gating (reactive {@code @WebFluxTest}, the
 * {@code VnProfileControllerTest} pattern). The REAL {@link CharacterForgeService} —
 * including the REAL {@link Char3DConfigValidator} pass — is imported over a mocked
 * {@link CharacterForgeCharacterRepository} facade, so the stories under test are the
 * service-level contract driven through real HTTP semantics, not mock echoes:
 *
 * <ul>
 *   <li>an anonymous caller is 401 on EVERY endpoint (the {@code .authenticated()}
 *       floor); a plain ROLE_USER principal uses the whole surface;</li>
 *   <li>writes key on the JWT {@code sub} ONLY — a smuggled body owner field is
 *       dropped by {@code ignoreUnknown};</li>
 *   <li>the pinned validation contract rejects with 400 (missing name/definition by
 *       bean validation; unknown definition keys / bad enums by the validator) and the
 *       repo is NEVER touched on a reject;</li>
 *   <li>create → 201 with the canonical definition; delete → 204; foreign id → 404;
 *       {@code /active} 404s when nothing is marked;</li>
 *   <li>the lookup cap boundary (50 ok, 51/empty → 400) and dedup.</li>
 * </ul>
 */
@WebFluxTest(controllers = CharacterForgeController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CharacterForgeService.class})
class CharacterForgeControllerTest {

    // Spring Security 7: mockJwt()'s SecurityContext is only honoured when the
    // springSecurity() configurer's MutatorFilter is in the chain.
    @Autowired ApplicationContext context;
    WebTestClient web;

    @MockitoBean CharacterForgeCharacterRepository characters;
    @MockitoBean ReactiveJwtDecoder jwtDecoder;

    private static final String BASE = "/bff/character-forge/characters";

    private static final String VALID_DEFINITION = """
            {"schemaVersion":1,
             "body":{"archetype":"canid","build":0.5,"height":1.0},
             "head":{"family":"canid"},
             "materials":{"fur":"#8a5a2b"},
             "style":"toon"}""";

    @BeforeEach
    void setUpClient() {
        web = WebTestClient.bindToApplicationContext(context).apply(springSecurity()).build();
    }

    /** A plain authenticated user (the converter's ROLE_USER floor), subject sub-me. */
    private WebTestClient asUser() {
        return web.mutateWith(mockJwt()
                .jwt(jwt -> jwt.subject("sub-me"))
                .authorities(new SimpleGrantedAuthority("ROLE_USER")));
    }

    private static CharacterForgeCharacter row(UUID id, String owner, boolean active) {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var def = mapper.createObjectNode();
        def.put("schemaVersion", 1);
        def.putObject("body").put("archetype", "canid");
        def.putObject("head").put("family", "canid");
        def.put("style", "toon");
        String canonical = Char3DConfigValidator.canonicalJson(Char3DConfigValidator.validate(def));
        return new CharacterForgeCharacter(id, owner, "default", "Fen", active, canonical,
                Instant.parse("2026-07-19T00:00:00Z"), Instant.parse("2026-07-19T00:00:00Z"));
    }

    // ── gating: every endpoint is authenticated-only ────────────────────

    @Test
    void anonymous_isUnauthorized_onEveryEndpoint() {
        web.get().uri(BASE).exchange().expectStatus().isUnauthorized();
        web.post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\",\"definition\":" + VALID_DEFINITION + "}")
                .exchange().expectStatus().isUnauthorized();
        web.get().uri(BASE + "/active").exchange().expectStatus().isUnauthorized();
        web.post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[\"sub-a\"]}")
                .exchange().expectStatus().isUnauthorized();
        String id = UUID.randomUUID().toString();
        web.get().uri(BASE + "/" + id).exchange().expectStatus().isUnauthorized();
        web.put().uri(BASE + "/" + id).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\",\"definition\":" + VALID_DEFINITION + "}")
                .exchange().expectStatus().isUnauthorized();
        web.delete().uri(BASE + "/" + id).exchange().expectStatus().isUnauthorized();
        web.put().uri(BASE + "/" + id + "/active").exchange().expectStatus().isUnauthorized();
    }

    // ── list ────────────────────────────────────────────────────────────

    @Test
    void list_returnsTheCallersCharacters() {
        UUID id = UUID.randomUUID();
        when(characters.findAllByOwner(eq("sub-me"), any()))
                .thenReturn(Flux.just(row(id, "sub-me", false)));
        asUser().get().uri(BASE).exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$[0].id").isEqualTo(id.toString())
                .jsonPath("$[0].name").isEqualTo("Fen")
                .jsonPath("$[0].active").isEqualTo(false)
                .jsonPath("$[0].definition.schemaVersion").isEqualTo(1)
                .jsonPath("$[0].definition.style").isEqualTo("toon");
    }

    // ── create ──────────────────────────────────────────────────────────

    @Test
    void create_201_storesCanonicalDefinition_ownerFromJwt() {
        UUID id = UUID.randomUUID();
        when(characters.countByOwner(eq("sub-me"), any())).thenReturn(Mono.just(0L));
        when(characters.create(eq("sub-me"), any(), eq("Fen"), anyString()))
                .thenReturn(Mono.just(row(id, "sub-me", false)));

        // The body SMUGGLES an ownerSubject — ignoreUnknown drops it; the write keys
        // on the JWT sub only.
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"ownerSubject\":\"sub-victim\",\"name\":\"Fen\","
                        + "\"definition\":" + VALID_DEFINITION + "}")
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.id").isEqualTo(id.toString())
                .jsonPath("$.name").isEqualTo("Fen")
                .jsonPath("$.active").isEqualTo(false);

        verify(characters).create(eq("sub-me"), any(), eq("Fen"), anyString());
        verify(characters, never()).create(eq("sub-victim"), any(), anyString(), anyString());
    }

    @Test
    void create_missingName_orMissingDefinition_400_beanValidation() {
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"definition\":" + VALID_DEFINITION + "}")
                .exchange().expectStatus().isBadRequest()
                .expectBody().jsonPath("$.fields.name").exists();
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\"}")
                .exchange().expectStatus().isBadRequest()
                .expectBody().jsonPath("$.fields.definition").exists();
        verify(characters, never()).create(anyString(), any(), anyString(), anyString());
    }

    @Test
    void create_unknownDefinitionKey_400_repoNeverTouched() {
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\",\"definition\":{\"schemaVersion\":1,"
                        + "\"body\":{\"archetype\":\"canid\"},\"head\":{\"family\":\"canid\"},"
                        + "\"style\":\"toon\",\"exploit\":\"<script>\"}}")
                .exchange().expectStatus().isBadRequest()
                .expectBody().jsonPath("$.error").value(e ->
                        assertThat(e.toString()).contains("exploit"));
        verify(characters, never()).countByOwner(anyString(), any());
        verify(characters, never()).create(anyString(), any(), anyString(), anyString());
    }

    @Test
    void create_badFamilyEnum_400() {
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\",\"definition\":{\"schemaVersion\":1,"
                        + "\"body\":{\"archetype\":\"canid\"},\"head\":{\"family\":\"xenomorph\"},"
                        + "\"style\":\"toon\"}}")
                .exchange().expectStatus().isBadRequest();
        verify(characters, never()).create(anyString(), any(), anyString(), anyString());
    }

    @Test
    void create_atTheCap_409() {
        when(characters.countByOwner(eq("sub-me"), any()))
                .thenReturn(Mono.just((long) CharacterForgeDto.MAX_CHARACTERS_PER_OWNER));
        asUser().post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Fen\",\"definition\":" + VALID_DEFINITION + "}")
                .exchange()
                .expectStatus().isEqualTo(409)
                .expectBody().jsonPath("$.error").value(e ->
                        assertThat(e.toString()).contains("limit"));
        verify(characters, never()).create(anyString(), any(), anyString(), anyString());
    }

    // ── get / update / delete by id ─────────────────────────────────────

    @Test
    void get_ownedId_returnsIt_foreignId_404() {
        UUID mine = UUID.randomUUID();
        UUID foreign = UUID.randomUUID();
        when(characters.findByIdAndOwner(eq(mine), eq("sub-me"), any()))
                .thenReturn(Mono.just(row(mine, "sub-me", false)));
        when(characters.findByIdAndOwner(eq(foreign), eq("sub-me"), any()))
                .thenReturn(Mono.empty());

        asUser().get().uri(BASE + "/" + mine).exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.id").isEqualTo(mine.toString());

        asUser().get().uri(BASE + "/" + foreign).exchange()
                .expectStatus().isNotFound()
                .expectBody().jsonPath("$.error").isEqualTo("character not found");
    }

    @Test
    void get_malformedId_isTheSame404() {
        asUser().get().uri(BASE + "/definitely-not-a-uuid").exchange()
                .expectStatus().isNotFound()
                .expectBody().jsonPath("$.error").isEqualTo("character not found");
    }

    @Test
    void update_replacesNameAndDefinition_activeNotSettableHere() {
        UUID id = UUID.randomUUID();
        when(characters.findByIdAndOwner(eq(id), eq("sub-me"), any()))
                .thenReturn(Mono.just(row(id, "sub-me", false)));
        when(characters.update(eq(id), eq("Renamed"), anyString()))
                .thenReturn(Mono.just(row(id, "sub-me", false)));

        // The body tries to smuggle "active":true — UpdateCharacter has no such field
        // (ignoreUnknown), so activation stays the explicit /active flow.
        asUser().put().uri(BASE + "/" + id).contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Renamed\",\"active\":true,"
                        + "\"definition\":" + VALID_DEFINITION + "}")
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.active").isEqualTo(false);
        verify(characters).update(eq(id), eq("Renamed"), anyString());
    }

    @Test
    void delete_ownedId_204_foreignId_404() {
        UUID mine = UUID.randomUUID();
        UUID foreign = UUID.randomUUID();
        when(characters.findByIdAndOwner(eq(mine), eq("sub-me"), any()))
                .thenReturn(Mono.just(row(mine, "sub-me", false)));
        when(characters.delete(mine)).thenReturn(Mono.empty());
        when(characters.findByIdAndOwner(eq(foreign), eq("sub-me"), any()))
                .thenReturn(Mono.empty());

        asUser().delete().uri(BASE + "/" + mine).exchange().expectStatus().isNoContent();
        verify(characters).delete(mine);

        asUser().delete().uri(BASE + "/" + foreign).exchange().expectStatus().isNotFound();
        verify(characters, never()).delete(foreign);
    }

    // ── active ──────────────────────────────────────────────────────────

    @Test
    void active_noneMarked_404_marked_returnsIt() {
        when(characters.findActiveByOwner(eq("sub-me"), any())).thenReturn(Mono.empty());
        asUser().get().uri(BASE + "/active").exchange()
                .expectStatus().isNotFound()
                .expectBody().jsonPath("$.error").isEqualTo("no active character");

        UUID id = UUID.randomUUID();
        when(characters.findActiveByOwner(eq("sub-me"), any()))
                .thenReturn(Mono.just(row(id, "sub-me", true)));
        asUser().get().uri(BASE + "/active").exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.id").isEqualTo(id.toString())
                .jsonPath("$.active").isEqualTo(true);
    }

    @Test
    void setActive_runsTheSwap_and404sOnForeignId() {
        UUID id = UUID.randomUUID();
        CharacterForgeCharacter mine = row(id, "sub-me", false);
        when(characters.findByIdAndOwner(eq(id), eq("sub-me"), any())).thenReturn(Mono.just(mine));
        when(characters.swapActive(mine)).thenReturn(Mono.just(row(id, "sub-me", true)));
        asUser().put().uri(BASE + "/" + id + "/active").exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.active").isEqualTo(true);

        UUID foreign = UUID.randomUUID();
        when(characters.findByIdAndOwner(eq(foreign), eq("sub-me"), any())).thenReturn(Mono.empty());
        asUser().put().uri(BASE + "/" + foreign + "/active").exchange()
                .expectStatus().isNotFound();
        // The swap ran exactly ONCE (the owned id) — the foreign 404 never reached it.
        verify(characters, org.mockito.Mockito.times(1)).swapActive(any());
    }

    // ── lookup ──────────────────────────────────────────────────────────

    @Test
    void lookup_returnsOnlyActiveSubjects_absentKeysForTheRest() {
        UUID id = UUID.randomUUID();
        when(characters.findActiveBySubjects(anyCollection(), any()))
                .thenReturn(Flux.just(row(id, "sub-a", true)));
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[\"sub-a\",\"sub-missing\"]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.configs['sub-a'].name").isEqualTo("Fen")
                .jsonPath("$.configs['sub-a'].definition.style").isEqualTo("toon")
                .jsonPath("$.configs['sub-missing']").doesNotExist();
    }

    @Test
    @SuppressWarnings("unchecked")
    void lookup_dedupsBeforeQuerying() {
        when(characters.findActiveBySubjects(anyCollection(), any())).thenReturn(Flux.empty());
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[\"sub-a\",\"sub-a\",\"sub-b\",\"sub-a\"]}")
                .exchange().expectStatus().isOk()
                .expectBody().jsonPath("$.configs").isEmpty();
        ArgumentCaptor<Collection<String>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(characters).findActiveBySubjects(captor.capture(), any());
        assertThat(captor.getValue()).containsExactly("sub-a", "sub-b");
    }

    @Test
    void lookup_400_onEmpty_missing_orOversizedSubjects() {
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[]}")
                .exchange().expectStatus().isBadRequest()
                .expectBody().jsonPath("$.fields.subjects").exists();
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange().expectStatus().isBadRequest();
        String oversized = IntStream.rangeClosed(1, CharacterForgeDto.LOOKUP_MAX_SUBJECTS + 1)
                .mapToObj(i -> "\"sub-" + i + "\"")
                .collect(Collectors.joining(","));
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[" + oversized + "]}")
                .exchange().expectStatus().isBadRequest();
        verify(characters, never()).findActiveBySubjects(anyCollection(), any());
    }

    @Test
    void lookup_allowsExactly50Subjects() {
        when(characters.findActiveBySubjects(anyCollection(), any())).thenReturn(Flux.empty());
        String subjects = IntStream.rangeClosed(1, CharacterForgeDto.LOOKUP_MAX_SUBJECTS)
                .mapToObj(i -> "\"sub-" + i + "\"")
                .collect(Collectors.joining(","));
        asUser().post().uri(BASE + "/lookup").contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"subjects\":[" + subjects + "]}")
                .exchange().expectStatus().isOk();
    }
}
