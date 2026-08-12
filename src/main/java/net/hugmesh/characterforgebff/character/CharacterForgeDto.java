package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
// Boot 4's reactive WebFlux JSON codec is Jackson 3 (tools.jackson) and CANNOT
// decode into / encode from the Jackson-2 com.fasterxml JsonNode type (500
// CodecException "Type definition error"). The HTTP-boundary definition fields
// therefore use the Jackson-3 JsonNode; the service bridges to the Jackson-2
// internals (Char3DConfigValidator / VnMapService) by string round-trip — the
// user-bff ServiceTokenBroker "keep Jackson-2 types OFF the codec path" precedent.
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * The JSON shapes crossing the {@code /bff/character-forge/**} HTTP boundary. Plain
 * records ({@code @JsonIgnoreProperties(ignoreUnknown)} so an evolving client never
 * breaks deserialization — and so a smuggled {@code "ownerSubject"} field in a write
 * body is silently DROPPED: the owner comes ONLY from the JWT). The request bodies
 * carry jakarta validation for the OUTER shape; the {@code definition} payload gets
 * the full {@link Char3DConfigValidator} treatment in the service (unknown keys
 * rejected, numerics clamped, hexes/enums checked, 16KB cap) — bean validation
 * cannot express that contract, so it deliberately does not try.
 */
public final class CharacterForgeDto {

    private CharacterForgeDto() {}

    // ── server-enforced caps (the pinned contract; clients mirror) ──────

    /** Max saved characters per owner (create returns 409 beyond it; list is bounded
     *  by construction). */
    public static final int MAX_CHARACTERS_PER_OWNER = 32;

    /** The maximum number of subjects one lookup may resolve. */
    public static final int LOOKUP_MAX_SUBJECTS = 50;

    /** Display-name cap (matches {@link Char3DConfigValidator#MAX_NAME_LENGTH}). */
    public static final int NAME_MAX = 120;

    // ── responses ───────────────────────────────────────────────────────

    /**
     * One saved character as the owner sees it. {@code definition} is the CANONICAL
     * Char3DConfig (fixed key order, clamps/defaults applied — exactly what the
     * {@code jsonb} column stores). {@code id} is the DB-generated uuid in its
     * 36-char string form.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CharacterView(String id, String name, boolean active,
                                JsonNode definition, Instant createdAt, Instant updatedAt) {}

    /** One subject's active character inside the lookup response map (the subject is
     *  the map KEY, so it is not repeated here). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LookupEntry(String name, JsonNode definition) {}

    /** {@code POST /bff/character-forge/characters/lookup} response — subject →
     *  {name, definition}; subjects with no ACTIVE character are simply ABSENT
     *  (never a 404, never a null value — no existence signal beyond the config). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LookupResponse(Map<String, LookupEntry> configs) {

        /** Returns a defensive copy so callers cannot mutate the internal map. */
        @Override
        public Map<String, LookupEntry> configs() {
            return configs == null ? Map.of() : Map.copyOf(configs);
        }
    }

    // ── request bodies ──────────────────────────────────────────────────

    /**
     * {@code POST /bff/character-forge/characters}. Carries NO owner field — the
     * owner comes ONLY from the JWT ({@code Authentication.getName()}); a smuggled
     * {@code "ownerSubject"} JSON field is dropped by {@code ignoreUnknown}. The
     * {@code definition} is validated + canonicalized by
     * {@link Char3DConfigValidator} before anything is written.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CreateCharacter(
            @NotBlank(message = "name is required")
            @Size(max = NAME_MAX, message = "name exceeds " + NAME_MAX + " characters")
            String name,
            @NotNull(message = "definition is required")
            JsonNode definition) {}

    /** {@code PUT /bff/character-forge/characters/{id}} — full replace of name +
     *  definition (same shape/validation as create; {@code active} is NOT settable
     *  here — activation is the explicit {@code /active} flow). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record UpdateCharacter(
            @NotBlank(message = "name is required")
            @Size(max = NAME_MAX, message = "name exceeds " + NAME_MAX + " characters")
            String name,
            @NotNull(message = "definition is required")
            JsonNode definition) {}

    /**
     * {@code POST /bff/character-forge/characters/lookup} — the XR room's batched
     * avatar resolve. 1..{@value #LOOKUP_MAX_SUBJECTS} subjects (an empty or
     * oversized list is a 400 via bean validation); the service DEDUPS before
     * querying so duplicates cannot widen the scan.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LookupRequest(
            @NotNull(message = "subjects is required")
            @Size(min = 1, max = LOOKUP_MAX_SUBJECTS,
                    message = "subjects must contain between 1 and " + LOOKUP_MAX_SUBJECTS + " entries")
            List<@NotBlank(message = "subject must not be blank")
                 @Size(max = 255, message = "subject is too long") String> subjects) {

        /** Returns a defensive copy so callers cannot mutate the internal list. */
        @Override
        public List<String> subjects() {
            return subjects == null ? List.of() : List.copyOf(subjects);
        }
    }
}
