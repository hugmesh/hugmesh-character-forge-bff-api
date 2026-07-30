package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import systems.hugmesh.commons.security.DomainRegistry;
import systems.hugmesh.commons.web.ApiException;
import systems.hugmesh.characterforgebff.security.PrincipalDomain;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The character-forge domain service — owns the {@code character_forge_character}
 * read/write rules behind {@link CharacterForgeController}:
 *
 * <ul>
 *   <li><b>Owner binding</b> — every row is keyed by the caller's immutable Casdoor
 *       {@code sub} taken ONLY from the validated JWT ({@link #subject}); an owner is
 *       NEVER accepted from a request body, so a caller cannot read-as or write-as
 *       another user.</li>
 *   <li><b>Foreign id → 404, never 403</b> — the single-row reads always include the
 *       owner predicate, so another user's (or a nonexistent) id is
 *       indistinguishable: {@code character not found}. No existence oracle.</li>
 *   <li><b>Full definition validation</b> — every definition write passes
 *       {@link Char3DConfigValidator#validate} (unknown keys rejected, numerics
 *       clamped, hex/enum checks, 16KB cap) and only the CANONICAL form is stored —
 *       the reason the cross-user {@code /lookup} needs no moderation pass.</li>
 *   <li><b>Display-name gate</b> — the row {@code name} is served to OTHER members by
 *       {@code /lookup} next to the definition, so it goes through the SAME
 *       {@link Char3DConfigValidator#displayName} rule as {@code definition.name}:
 *       ≤120 chars, non-blank, and no control / bidirectional-override / invisible
 *       formatting code points (bean validation can only express the length).</li>
 *   <li><b>Creation cap</b> — at most
 *       {@value CharacterForgeDto#MAX_CHARACTERS_PER_OWNER} characters per owner
 *       (+domain); the 33rd create is a 409.</li>
 *   <li><b>Single active</b> — {@code setActive} runs the repository's
 *       clear-then-set swap in the target row's OWN brand; the partial unique index
 *       backstops races.</li>
 *   <li><b>Bounded, deduped lookup</b> — the batched avatar resolve dedups the
 *       requested subjects (bean validation already caps the raw list at
 *       {@value CharacterForgeDto#LOOKUP_MAX_SUBJECTS}) and returns ONLY subjects
 *       with an ACTIVE character — absent subjects are absent keys, never nulls.</li>
 *   <li><b>Domain-scope</b> — rows are per-brand: the caller's {@code domain} is
 *       derived SERVER-SIDE from the validated issuer ({@link PrincipalDomain}) and
 *       stamps/scopes every read + write; SUPERADMIN is unscoped. NEVER a request
 *       field.</li>
 * </ul>
 *
 * @see CharacterForgeCharacterRepository
 * @see Char3DConfigValidator
 * @see PrincipalDomain
 */
@Service
public class CharacterForgeService {

    /** Jackson-2 mapper for the VALIDATOR side of the boundary bridge (the
     *  {@link Char3DConfigValidator} internals are Jackson 2; thread-safe as
     *  configured). */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** Jackson-3 mapper for the WEB side: Boot 4's reactive JSON codec is Jackson 3
     *  (tools.jackson), which cannot encode/decode the Jackson-2 node types — so the
     *  DTO {@code definition} fields are Jackson-3 {@link tools.jackson.databind.JsonNode}
     *  and this mapper parses the stored canonical text back into them for responses
     *  (the user-bff "keep Jackson-2 OFF the codec path" precedent). */
    private static final tools.jackson.databind.ObjectMapper WEB_MAPPER =
            new tools.jackson.databind.ObjectMapper();

    private final CharacterForgeCharacterRepository characters;
    private final PrincipalDomain principalDomain;

    public CharacterForgeService(CharacterForgeCharacterRepository characters,
                                 PrincipalDomain principalDomain) {
        this.characters = characters;
        this.principalDomain = principalDomain;
    }

    /** The caller's immutable Casdoor {@code sub} — ONLY from the validated
     *  {@link Authentication} (the JWT {@code sub}), never a request field.
     *  Fail-closed: an absent/blank principal is a 401. */
    static String subject(Authentication auth) {
        String name = auth == null ? null : auth.getName();
        if (name == null || name.isBlank()) {
            throw ApiException.unauthorized("no authenticated subject");
        }
        return name;
    }

    /**
     * The caller's effective domain-scope, derived SERVER-SIDE from the validated JWT
     * issuer ({@link PrincipalDomain}): {@code null} for SUPERADMIN (cross-domain
     * bypass), else the concrete brand ({@code __deny__} for an unresolvable
     * non-SUPERADMIN issuer — fail-closed). Non-JWT principals (test stubs) fall back
     * to the platform {@code default} domain. NEVER read from a request field.
     */
    private String scopeOf(Authentication auth) {
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
            return principalDomain.forScope(jwt);
        }
        return DomainRegistry.DEFAULT_DOMAIN;
    }

    /** The caller's own characters, oldest first (bounded by the creation cap; the
     *  {@code take} is belt-and-braces). */
    public Mono<List<CharacterForgeDto.CharacterView>> list(Authentication auth) {
        return characters.findAllByOwner(subject(auth), scopeOf(auth))
                .take(CharacterForgeDto.MAX_CHARACTERS_PER_OWNER)
                .map(CharacterForgeService::toView)
                .collectList();
    }

    /**
     * Create a character: validate + canonicalize the definition, enforce the
     * per-owner cap, stamp the server-derived domain, and store — never active on
     * creation.
     *
     * @throws ApiException 400 on an invalid definition, 409 at the cap
     */
    public Mono<CharacterForgeDto.CharacterView> create(Authentication auth,
                                                        CharacterForgeDto.CreateCharacter body) {
        String owner = subject(auth);
        String scope = scopeOf(auth);
        String name = Char3DConfigValidator.displayName(body.name(), "name");
        ObjectNode canonical = Char3DConfigValidator.validate(toValidatorTree(body.definition()));
        String canonicalJson = Char3DConfigValidator.canonicalJson(canonical);
        return characters.countByOwner(owner, scope)
                .flatMap(count -> {
                    if (count >= CharacterForgeDto.MAX_CHARACTERS_PER_OWNER) {
                        return Mono.error(ApiException.conflict("character limit reached (max "
                                + CharacterForgeDto.MAX_CHARACTERS_PER_OWNER + " per owner)"));
                    }
                    return characters.create(owner, scope, name, canonicalJson);
                })
                .map(CharacterForgeService::toView);
    }

    /** One of the caller's characters by id — a foreign/missing/unparseable id is a
     *  404 ({@code character not found}), never a 403. */
    public Mono<CharacterForgeDto.CharacterView> get(Authentication auth, String id) {
        return owned(auth, id).map(CharacterForgeService::toView);
    }

    /** Replace name + definition of one of the caller's characters (re-validated,
     *  canonical form stored). Foreign id → 404. */
    public Mono<CharacterForgeDto.CharacterView> update(Authentication auth, String id,
                                                        CharacterForgeDto.UpdateCharacter body) {
        String name = Char3DConfigValidator.displayName(body.name(), "name");
        ObjectNode canonical = Char3DConfigValidator.validate(toValidatorTree(body.definition()));
        String canonicalJson = Char3DConfigValidator.canonicalJson(canonical);
        return owned(auth, id)
                .flatMap(row -> characters.update(row.id(), name, canonicalJson))
                .map(CharacterForgeService::toView);
    }

    /** Delete one of the caller's characters. Foreign id → 404. */
    public Mono<Void> delete(Authentication auth, String id) {
        return owned(auth, id).flatMap(row -> characters.delete(row.id()));
    }

    /** Mark one of the caller's characters as THE active one (single active per
     *  owner+brand — the repository swap clears the sibling in the row's own brand;
     *  the partial unique index backstops races). Foreign id → 404. */
    public Mono<CharacterForgeDto.CharacterView> setActive(Authentication auth, String id) {
        return owned(auth, id)
                .flatMap(characters::swapActive)
                .map(CharacterForgeService::toView);
    }

    /** The caller's active character — 404 when none is marked. */
    public Mono<CharacterForgeDto.CharacterView> active(Authentication auth) {
        return characters.findActiveByOwner(subject(auth), scopeOf(auth))
                .map(CharacterForgeService::toView)
                .switchIfEmpty(Mono.error(ApiException.notFound("no active character")));
    }

    /**
     * Batched subject → ACTIVE-config resolve ({@code POST /characters/lookup}) —
     * the XR room dresses every participant in ONE call. The raw list is capped at
     * {@value CharacterForgeDto#LOOKUP_MAX_SUBJECTS} by bean validation; here it is
     * DEDUPED (order-preserving) so duplicates cannot widen the scan. Subjects with
     * no active character are simply ABSENT from the returned map. Serving foreign
     * users' configs is THE POINT of this surface and is safe without moderation
     * because every stored definition is fully server-validated parametric data.
     */
    public Mono<CharacterForgeDto.LookupResponse> lookup(Authentication auth,
                                                         CharacterForgeDto.LookupRequest body) {
        subject(auth);                                     // authenticated callers only
        Set<String> deduped = new LinkedHashSet<>(body.subjects());
        return characters.findActiveBySubjects(deduped, scopeOf(auth))
                .collectMap(CharacterForgeCharacter::ownerSubject, CharacterForgeService::toEntry)
                .map(CharacterForgeDto.LookupResponse::new);
    }

    /** The owner-scoped single-row read behind every id-addressed verb — resolves to
     *  empty (→ 404) for a foreign owner, a foreign brand, or a malformed uuid. */
    private Mono<CharacterForgeCharacter> owned(Authentication auth, String id) {
        String owner = subject(auth);
        String scope = scopeOf(auth);
        UUID uuid = parseId(id);
        Mono<CharacterForgeCharacter> read = uuid == null
                ? Mono.empty()
                : characters.findByIdAndOwner(uuid, owner, scope);
        return read.switchIfEmpty(Mono.error(ApiException.notFound("character not found")));
    }

    /** A malformed id names nothing — treated exactly like a missing row (404), so
     *  the error shape leaks nothing about id syntax vs existence. */
    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static CharacterForgeDto.CharacterView toView(CharacterForgeCharacter row) {
        return new CharacterForgeDto.CharacterView(
                row.id() == null ? null : row.id().toString(),
                row.name(), row.active(), parseDefinition(row.definition()),
                row.createdAt(), row.updatedAt());
    }

    private static CharacterForgeDto.LookupEntry toEntry(CharacterForgeCharacter row) {
        return new CharacterForgeDto.LookupEntry(row.name(), parseDefinition(row.definition()));
    }

    /** The WEB→VALIDATOR half of the Jackson-3/Jackson-2 boundary bridge: re-parse
     *  the codec-decoded Jackson-3 definition into the Jackson-2 tree the validator
     *  consumes. A Jackson-3 node's {@code toString()} is always valid JSON, so the
     *  re-parse cannot fail on real input; {@code null} passes through so the
     *  validator's own "definition must be a JSON object" 400 stays the single
     *  error seam. */
    private static com.fasterxml.jackson.databind.JsonNode toValidatorTree(
            tools.jackson.databind.JsonNode definition) {
        if (definition == null || definition.isNull()) {
            return null;
        }
        try {
            return MAPPER.readTree(definition.toString());
        } catch (JsonProcessingException e) {
            throw ApiException.badRequest("definition must be valid JSON");
        }
    }

    /** The stored text is ALWAYS the validator's canonical output, so a parse
     *  failure is a data-integrity defect, not a request error. (Jackson-3 output —
     *  the type the Boot 4 WebFlux codec can encode; see {@link #WEB_MAPPER}.) */
    private static tools.jackson.databind.JsonNode parseDefinition(String canonicalJson) {
        try {
            return WEB_MAPPER.readTree(canonicalJson);
        } catch (tools.jackson.core.JacksonException e) {
            throw new IllegalStateException("stored definition is not valid JSON", e);
        }
    }
}
