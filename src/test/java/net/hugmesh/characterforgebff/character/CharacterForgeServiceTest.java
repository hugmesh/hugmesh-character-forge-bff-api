package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import net.hugmesh.commons.security.DomainRegistry;
import net.hugmesh.commons.web.ApiException;
import net.hugmesh.characterforgebff.security.PrincipalDomain;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link CharacterForgeService} unit contract over a mocked repository facade — the
 * rules that live in the SERVICE layer, isolated from HTTP and SQL:
 *
 * <ul>
 *   <li><b>owner == JWT subject</b> — every verb keys on {@code Authentication.getName()};
 *       a null/blank principal is a fail-closed 401;</li>
 *   <li><b>foreign/missing/malformed id → 404</b> — one indistinguishable
 *       {@code character not found}, never a 403, never an id-syntax oracle;</li>
 *   <li><b>the 32-cap</b> — the 33rd create is a 409 and the INSERT never runs;</li>
 *   <li><b>definitions are validated + canonicalized BEFORE any write</b> — an invalid
 *       definition 400s with zero repository interaction;</li>
 *   <li><b>lookup DEDUPS</b> (order-preserving) and returns only owners with an ACTIVE
 *       character — absent subjects are absent keys;</li>
 *   <li><b>active</b> — empty repo read → 404 {@code no active character}.</li>
 * </ul>
 *
 * <p>Domain derivation: a non-JWT {@link TestingAuthenticationToken} principal falls
 * back to the platform default domain (the documented test-stub path), so the mocks
 * expect {@code DomainRegistry.DEFAULT_DOMAIN}. The issuer→domain derivation itself is
 * proven in {@code PrincipalDomainTest} + the full-context HTTP tests.
 */
@ExtendWith(MockitoExtension.class)
class CharacterForgeServiceTest {

    private static final ObjectMapper M = new ObjectMapper();

    /** Jackson-3 mapper for building the DTO {@code definition} fields — the DTOs
     *  carry the Boot-4 codec type ({@code tools.jackson.databind.JsonNode}); the
     *  validator internals stay Jackson 2 (see the service's boundary bridge). */
    private static final tools.jackson.databind.ObjectMapper W =
            new tools.jackson.databind.ObjectMapper();

    private static final String OWNER = "sub-owner";
    private static final String DOM = DomainRegistry.DEFAULT_DOMAIN;

    @Mock CharacterForgeCharacterRepository repo;

    CharacterForgeService svc;

    @BeforeEach
    void setUp() {
        svc = new CharacterForgeService(repo, new PrincipalDomain(new DomainRegistry("", "")));
    }

    private static Authentication auth() {
        return new TestingAuthenticationToken(OWNER, "n/a", "ROLE_USER");
    }

    private static ObjectNode definition() {
        ObjectNode root = M.createObjectNode();
        root.put("schemaVersion", 1);
        root.putObject("body").put("archetype", "canid");
        root.putObject("head").put("family", "canid");
        root.put("style", "toon");
        return root;
    }

    /** Bridge a Jackson-2 test definition into the Jackson-3 node the DTOs carry
     *  (exactly what the WebFlux codec would have decoded from the same JSON). */
    private static tools.jackson.databind.JsonNode web(ObjectNode def) {
        return W.readTree(def.toString());
    }

    private static CharacterForgeCharacter row(UUID id, String owner, boolean active) {
        return new CharacterForgeCharacter(id, owner, DOM, "Fen", active,
                Char3DConfigValidator.canonicalJson(Char3DConfigValidator.validate(definition())),
                Instant.parse("2026-07-19T00:00:00Z"), Instant.parse("2026-07-19T00:00:00Z"));
    }

    // ── owner binding / fail-closed subject ─────────────────────────────

    @Test
    void nullAuthentication_failsClosed401_beforeAnyRepoCall() {
        StepVerifier.create(Mono.defer(() -> svc.list(null)))
                .expectErrorSatisfies(e -> {
                    assertThat(e).isInstanceOf(ApiException.class);
                    assertThat(((ApiException) e).status().value()).isEqualTo(401);
                })
                .verify();
        verifyNoInteractions(repo);
    }

    @Test
    void blankPrincipal_failsClosed401() {
        Authentication blank = new TestingAuthenticationToken("", "n/a", "ROLE_USER");
        StepVerifier.create(Mono.defer(() -> svc.active(blank)))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(401))
                .verify();
        verifyNoInteractions(repo);
    }

    @Test
    void list_keysOnTheAuthenticatedSubject() {
        when(repo.findAllByOwner(OWNER, DOM)).thenReturn(Flux.just(
                row(UUID.randomUUID(), OWNER, false)));
        StepVerifier.create(svc.list(auth()))
                .assertNext(views -> {
                    assertThat(views).hasSize(1);
                    assertThat(views.get(0).name()).isEqualTo("Fen");
                    assertThat(views.get(0).definition().get("style").textValue()).isEqualTo("toon");
                })
                .verifyComplete();
        verify(repo).findAllByOwner(OWNER, DOM);
    }

    // ── create: validate-then-cap-then-insert ───────────────────────────

    @Test
    void create_validatesAndCanonicalizes_beforeInsert() {
        UUID id = UUID.randomUUID();
        when(repo.countByOwner(OWNER, DOM)).thenReturn(Mono.just(0L));
        when(repo.create(eq(OWNER), eq(DOM), eq("Fen"), anyString()))
                .thenReturn(Mono.just(row(id, OWNER, false)));

        ObjectNode def = definition();
        ((ObjectNode) def.get("body")).put("build", 42.0);      // clamps to 1.0
        StepVerifier.create(svc.create(auth(),
                        new CharacterForgeDto.CreateCharacter("Fen", web(def))))
                .assertNext(v -> assertThat(v.id()).isEqualTo(id.toString()))
                .verifyComplete();

        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(repo).create(eq(OWNER), eq(DOM), eq("Fen"), stored.capture());
        // The stored text is the CANONICAL clamped form, not the raw input.
        assertThat(stored.getValue()).contains("\"build\":1.0");
        assertThat(stored.getValue()).startsWith("{\"schemaVersion\":1");
    }

    @Test
    void create_invalidDefinition_400_withZeroRepoInteraction() {
        ObjectNode bad = definition();
        bad.put("payload", "smuggled");
        StepVerifier.create(Mono.defer(() -> svc.create(auth(),
                        new CharacterForgeDto.CreateCharacter("Fen", web(bad)))))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(400))
                .verify();
        verifyNoInteractions(repo);
    }

    /**
     * REGRESSION — the cross-user surface served an UNMODERATED free-text field.
     * {@code POST /characters/lookup} hands the row {@code name} to every other
     * authenticated member of the brand next to the definition, and this service has
     * no admin seam / no takedown verb by design. The row name used to carry only
     * {@code @NotBlank @Size(max = 120)}, so a U+202E RIGHT-TO-LEFT OVERRIDE (or an
     * isolate, a zero-width, a raw newline) reached every other participant's roster
     * verbatim and could visually rewrite a NEIGHBOURING member's handle. The
     * definition's own name was already swept for control characters — the name
     * served alongside it was not.
     */
    @Test
    void create_bidiOrControlCharsInTheRowName_400_withZeroRepoInteraction() {
        for (String hostile : List.of(
                "Alice\u202Ehcaerb",             // RIGHT-TO-LEFT OVERRIDE
                "Bob\u2066\u2069",              // isolates
                "Zero\u200BWidth",              // zero-width space
                "Line\nBreak",                  // C0 control
                "\uFEFFByteOrderMark")) {
            StepVerifier.create(Mono.defer(() -> svc.create(auth(),
                            new CharacterForgeDto.CreateCharacter(hostile, web(definition())))))
                    .expectErrorSatisfies(e -> {
                        assertThat(((ApiException) e).status().value()).isEqualTo(400);
                        assertThat(e.getMessage()).contains("name");
                    })
                    .verify();
        }
        verifyNoInteractions(repo);
    }

    @Test
    void update_bidiCharsInTheRowName_400_beforeTheRowIsEvenRead() {
        StepVerifier.create(Mono.defer(() -> svc.update(auth(), UUID.randomUUID().toString(),
                        new CharacterForgeDto.UpdateCharacter("Eve\u202Eevil", web(definition())))))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(400))
                .verify();
        verifyNoInteractions(repo);
    }

    @Test
    void create_ordinaryUnicodeName_isStillAccepted() {
        // The gate bans invisible/bidi FORMATTING, not non-Latin scripts.
        ArgumentCaptor<String> storedName = ArgumentCaptor.forClass(String.class);
        when(repo.countByOwner(OWNER, DOM)).thenReturn(Mono.just(0L));
        when(repo.create(eq(OWNER), eq(DOM), storedName.capture(), anyString()))
                .thenReturn(Mono.just(row(UUID.randomUUID(), OWNER, false)));
        StepVerifier.create(svc.create(auth(),
                        new CharacterForgeDto.CreateCharacter("\u30ad\u30c4\u30cd", web(definition()))))
                .expectNextCount(1)
                .verifyComplete();
        assertThat(storedName.getValue()).isEqualTo("\u30ad\u30c4\u30cd");
    }

    @Test
    void create_atThe32Cap_isA409_andNeverInserts() {
        when(repo.countByOwner(OWNER, DOM))
                .thenReturn(Mono.just((long) CharacterForgeDto.MAX_CHARACTERS_PER_OWNER));
        StepVerifier.create(svc.create(auth(),
                        new CharacterForgeDto.CreateCharacter("Fen", web(definition()))))
                .expectErrorSatisfies(e -> {
                    assertThat(((ApiException) e).status().value()).isEqualTo(409);
                    assertThat(e.getMessage()).contains("32");
                })
                .verify();
        verify(repo, never()).create(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void create_justUnderTheCap_succeeds() {
        UUID id = UUID.randomUUID();
        when(repo.countByOwner(OWNER, DOM))
                .thenReturn(Mono.just((long) CharacterForgeDto.MAX_CHARACTERS_PER_OWNER - 1));
        when(repo.create(eq(OWNER), eq(DOM), anyString(), anyString()))
                .thenReturn(Mono.just(row(id, OWNER, false)));
        StepVerifier.create(svc.create(auth(),
                        new CharacterForgeDto.CreateCharacter("Fen", web(definition()))))
                .expectNextCount(1)
                .verifyComplete();
    }

    // ── foreign/missing/malformed id → 404 (never 403, no syntax oracle) ─

    @Test
    void get_foreignOrMissingId_is404() {
        UUID id = UUID.randomUUID();
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.empty());
        StepVerifier.create(svc.get(auth(), id.toString()))
                .expectErrorSatisfies(e -> {
                    assertThat(((ApiException) e).status().value()).isEqualTo(404);
                    assertThat(e.getMessage()).isEqualTo("character not found");
                })
                .verify();
    }

    @Test
    void get_malformedUuid_isTheSame404_neverA400SyntaxOracle() {
        StepVerifier.create(svc.get(auth(), "not-a-uuid"))
                .expectErrorSatisfies(e -> {
                    assertThat(((ApiException) e).status().value()).isEqualTo(404);
                    assertThat(e.getMessage()).isEqualTo("character not found");
                })
                .verify();
        // The repo is never asked about a malformed id (nothing to ask about).
        verify(repo, never()).findByIdAndOwner(any(), anyString(), anyString());
    }

    @Test
    void update_foreignId_404_andNoWriteHappens() {
        UUID id = UUID.randomUUID();
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.empty());
        StepVerifier.create(svc.update(auth(), id.toString(),
                        new CharacterForgeDto.UpdateCharacter("New", web(definition()))))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(404))
                .verify();
        verify(repo, never()).update(any(), anyString(), anyString());
    }

    @Test
    void update_ownedId_revalidatesAndStoresCanonicalForm() {
        UUID id = UUID.randomUUID();
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.just(row(id, OWNER, false)));
        when(repo.update(eq(id), eq("New"), anyString())).thenReturn(Mono.just(row(id, OWNER, false)));
        StepVerifier.create(svc.update(auth(), id.toString(),
                        new CharacterForgeDto.UpdateCharacter("New", web(definition()))))
                .expectNextCount(1)
                .verifyComplete();
        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(repo).update(eq(id), eq("New"), stored.capture());
        assertThat(stored.getValue()).startsWith("{\"schemaVersion\":1");
    }

    @Test
    void delete_foreignId_404_andNoDeleteHappens() {
        UUID id = UUID.randomUUID();
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.empty());
        StepVerifier.create(svc.delete(auth(), id.toString()))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(404))
                .verify();
        verify(repo, never()).delete(any());
    }

    @Test
    void setActive_ownedId_runsTheSwap() {
        UUID id = UUID.randomUUID();
        CharacterForgeCharacter owned = row(id, OWNER, false);
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.just(owned));
        when(repo.swapActive(owned)).thenReturn(Mono.just(row(id, OWNER, true)));
        StepVerifier.create(svc.setActive(auth(), id.toString()))
                .assertNext(v -> assertThat(v.active()).isTrue())
                .verifyComplete();
        verify(repo).swapActive(owned);
    }

    @Test
    void setActive_foreignId_404_andNoSwapHappens() {
        UUID id = UUID.randomUUID();
        when(repo.findByIdAndOwner(id, OWNER, DOM)).thenReturn(Mono.empty());
        StepVerifier.create(svc.setActive(auth(), id.toString()))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(404))
                .verify();
        verify(repo, never()).swapActive(any());
    }

    // ── active ──────────────────────────────────────────────────────────

    @Test
    void active_noneMarked_is404() {
        when(repo.findActiveByOwner(OWNER, DOM)).thenReturn(Mono.empty());
        StepVerifier.create(svc.active(auth()))
                .expectErrorSatisfies(e -> {
                    assertThat(((ApiException) e).status().value()).isEqualTo(404);
                    assertThat(e.getMessage()).isEqualTo("no active character");
                })
                .verify();
    }

    @Test
    void active_returnsTheMarkedRow() {
        UUID id = UUID.randomUUID();
        when(repo.findActiveByOwner(OWNER, DOM)).thenReturn(Mono.just(row(id, OWNER, true)));
        StepVerifier.create(svc.active(auth()))
                .assertNext(v -> {
                    assertThat(v.id()).isEqualTo(id.toString());
                    assertThat(v.active()).isTrue();
                })
                .verifyComplete();
    }

    // ── lookup: dedup + absent-key semantics ────────────────────────────

    @Test
    @SuppressWarnings("unchecked")
    void lookup_dedupsOrderPreserving_beforeQuerying() {
        when(repo.findActiveBySubjects(anyCollection(), eq(DOM))).thenReturn(Flux.empty());
        StepVerifier.create(svc.lookup(auth(), new CharacterForgeDto.LookupRequest(
                        List.of("sub-a", "sub-b", "sub-a", "sub-c", "sub-b"))))
                .assertNext(resp -> assertThat(resp.configs()).isEmpty())
                .verifyComplete();
        ArgumentCaptor<Collection<String>> captor = ArgumentCaptor.forClass(Collection.class);
        verify(repo).findActiveBySubjects(captor.capture(), eq(DOM));
        assertThat(captor.getValue()).containsExactly("sub-a", "sub-b", "sub-c");
    }

    @Test
    void lookup_mapsOwnersToEntries_absentSubjectsAbsent() {
        UUID id = UUID.randomUUID();
        when(repo.findActiveBySubjects(anyCollection(), eq(DOM)))
                .thenReturn(Flux.just(row(id, "sub-a", true)));
        StepVerifier.create(svc.lookup(auth(), new CharacterForgeDto.LookupRequest(
                        List.of("sub-a", "sub-missing"))))
                .assertNext(resp -> {
                    assertThat(resp.configs()).containsOnlyKeys("sub-a");
                    assertThat(resp.configs().get("sub-a").name()).isEqualTo("Fen");
                    assertThat(resp.configs().get("sub-a").definition()
                            .get("style").textValue()).isEqualTo("toon");
                })
                .verifyComplete();
    }

    @Test
    void lookup_unauthenticated_failsClosed401() {
        StepVerifier.create(Mono.defer(() -> svc.lookup(null,
                        new CharacterForgeDto.LookupRequest(List.of("sub-a")))))
                .expectErrorSatisfies(e ->
                        assertThat(((ApiException) e).status().value()).isEqualTo(401))
                .verify();
        verifyNoInteractions(repo);
    }
}
