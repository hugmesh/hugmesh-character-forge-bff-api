package net.hugmesh.characterforgebff.character;

import org.springframework.data.r2dbc.repository.Modifying;
import org.springframework.data.r2dbc.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.repository.reactive.ReactiveCrudRepository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.Collection;
import java.util.UUID;

/**
 * Reactive (R2DBC) Spring Data store for the {@code character_forge_character} table
 * (Liquibase {@code 001}), DB-generated {@code uuid} PK. Mirrors the forum-bff
 * repository idiom exactly: DERIVED, ordering-exact finders for the reads, and
 * {@code @Query} static-final constants ONLY for the statements no derived method can
 * express — the {@code now()}-stamping INSERT/UPDATE legs and the jsonb
 * {@code CAST(:def AS jsonb)} binding (the WRITE half of the jsonb mapping; the READ
 * half is the {@code PgJsonToStringConverter}).
 *
 * <p>The {@link CharacterForgeCharacterRepository} facade keeps the public method
 * shape (the {@code null}-domain SUPERADMIN bypass + the concrete-domain overloads);
 * this interface is the data-access layer it delegates to.
 *
 * <p>DB-GENERATED UUID PK (the org-wide migration; forum-bff changelog-004 shape,
 * except the column here is a NATIVE {@code uuid}): the {@code id} is NOT minted in
 * Java. The column carries {@code DEFAULT gen_random_uuid()} (pgcrypto, changelog
 * 001), so the INSERT OMITS {@code id} and appends {@code RETURNING id} to read the
 * database-generated key back. The INSERT is therefore a plain {@code @Query} (NOT
 * {@code @Modifying}) returning {@code Mono<UUID>} — the generated id the facade then
 * reads the persisted row back by.
 */
public interface CharacterForgeCharacterR2dbcRepository
        extends ReactiveCrudRepository<CharacterForgeCharacter, UUID> {

    // ── owner list reads (oldest first — stable creation order for the picker) ──

    /** SUPERADMIN cross-domain bypass: one owner's characters across every brand,
     *  oldest first. Equivalent to {@code SELECT ... WHERE owner_subject = :owner
     *  ORDER BY created_at, id}. */
    Flux<CharacterForgeCharacter> findAllByOwnerSubjectOrderByCreatedAtAscIdAsc(String ownerSubject);

    /** Domain-scoped: one owner's characters within one brand, oldest first.
     *  Equivalent to {@code ... WHERE owner_subject = :owner AND domain = :domain
     *  ORDER BY created_at, id}. */
    Flux<CharacterForgeCharacter> findAllByOwnerSubjectAndDomainOrderByCreatedAtAscIdAsc(
            String ownerSubject, String domain);

    // ── single-row owner reads (the foreign-id → empty → 404 seam) ──────

    /** SUPERADMIN cross-domain bypass: one character by id IFF owned by the subject.
     *  Equivalent to {@code SELECT ... WHERE id = :id AND owner_subject = :owner}. */
    Mono<CharacterForgeCharacter> findByIdAndOwnerSubject(UUID id, String ownerSubject);

    /** Domain-scoped: one character by id IFF owned by the subject within the brand.
     *  Equivalent to {@code ... WHERE id = :id AND owner_subject = :owner AND domain = :domain}. */
    Mono<CharacterForgeCharacter> findByIdAndOwnerSubjectAndDomain(UUID id, String ownerSubject, String domain);

    // ── the ACTIVE character ────────────────────────────────────────────

    /** SUPERADMIN cross-domain bypass: an owner's active characters across brands
     *  (at most one PER brand — the partial unique index; a Flux because a
     *  cross-brand owner may hold several). */
    Flux<CharacterForgeCharacter> findAllByOwnerSubjectAndActiveTrue(String ownerSubject);

    /** Domain-scoped: the owner's single active character within one brand (the
     *  partial unique index {@code ux_character_forge_one_active} guarantees at most
     *  one row). Equivalent to {@code ... WHERE owner_subject = :owner AND domain =
     *  :domain AND active}. */
    Mono<CharacterForgeCharacter> findByOwnerSubjectAndDomainAndActiveTrue(String ownerSubject, String domain);

    /** SUPERADMIN cross-domain bypass batch read (the XR-room avatar resolve): every
     *  ACTIVE character whose owner is in the set, any brand. */
    Flux<CharacterForgeCharacter> findAllByOwnerSubjectInAndActiveTrue(Collection<String> ownerSubjects);

    /** Domain-scoped batch read: the ACTIVE characters for an owner-set WITHIN one
     *  brand. Subjects with no active character are simply absent. */
    Flux<CharacterForgeCharacter> findAllByOwnerSubjectInAndDomainAndActiveTrue(
            Collection<String> ownerSubjects, String domain);

    // ── the per-owner cap ───────────────────────────────────────────────

    /** SUPERADMIN cross-domain bypass count (an owner's characters across brands). */
    Mono<Long> countByOwnerSubject(String ownerSubject);

    /** Domain-scoped count — the {@code MAX_CHARACTERS_PER_OWNER} (32) creation-cap
     *  read. */
    Mono<Long> countByOwnerSubjectAndDomain(String ownerSubject, String domain);

    // ── write legs (@Query constants — now() stamps + the jsonb CAST) ───

    /**
     * Insert a character, stamping {@code created_at}/{@code updated_at} to
     * {@code now()} and binding the canonical Char3DConfig text through
     * {@code CAST(:def AS jsonb)} (the write half of the jsonb mapping — never entity
     * mapping, see {@code R2dbcConvertersConfig}). The {@code id} is OMITTED —
     * Postgres fills it from the {@code gen_random_uuid()} column DEFAULT (changelog
     * 001) — and {@code RETURNING id} reads the generated key back so the facade
     * re-reads the persisted row by it. New rows are NEVER active ({@code false}) —
     * activation is the explicit {@code /active} flow.
     */
    @Query(INSERT_CHARACTER_RETURNING_ID)
    Mono<UUID> insertCharacter(@Param("owner") String ownerSubject,
                               @Param("dom") String domain,
                               @Param("name") String name,
                               @Param("def") String definitionJson);

    /** Update a character's name + definition (re-validated canonical JSON), bumping
     *  {@code updated_at}. Ownership is checked by the facade/service BEFORE this
     *  runs (the leg itself keys on the already-authorized id). */
    @Modifying
    @Query(UPDATE_CHARACTER)
    Mono<Long> updateCharacter(@Param("id") UUID id,
                               @Param("name") String name,
                               @Param("def") String definitionJson);

    /** The CLEAR half of the single-active swap: deactivate the owner's currently
     *  active character(s) within ONE brand. Run before {@link #setActive} so the
     *  partial unique index never trips on the happy path (and trips LOUDLY on a
     *  concurrent race — fail-closed, never two actives). */
    @Modifying
    @Query(CLEAR_ACTIVE)
    Mono<Long> clearActive(@Param("owner") String ownerSubject, @Param("dom") String domain);

    /** The SET half of the single-active swap: activate one (already
     *  ownership-checked) character. */
    @Modifying
    @Query(SET_ACTIVE)
    Mono<Long> setActive(@Param("id") UUID id);

    /** The ({@code now()}-stamping, jsonb-casting) INSERT — id OMITTED (filled from
     *  the {@code gen_random_uuid()} DEFAULT), {@code RETURNING id} yields the
     *  DB-generated uuid. */
    String INSERT_CHARACTER_RETURNING_ID =
            "INSERT INTO character_forge_character (owner_subject, domain, name, active, definition, "
                    + "created_at, updated_at) "
                    + "VALUES (:owner, :dom, :name, false, CAST(:def AS jsonb), now(), now()) "
                    + "RETURNING id";

    /** The name+definition UPDATE leg ({@code now()} bump + jsonb CAST). */
    String UPDATE_CHARACTER =
            "UPDATE character_forge_character SET name = :name, definition = CAST(:def AS jsonb), "
                    + "updated_at = now() WHERE id = :id";

    /** The single-active CLEAR leg (per owner+brand — the partial-index scope). */
    String CLEAR_ACTIVE =
            "UPDATE character_forge_character SET active = false, updated_at = now() "
                    + "WHERE owner_subject = :owner AND domain = :dom AND active";

    /** The single-active SET leg. */
    String SET_ACTIVE =
            "UPDATE character_forge_character SET active = true, updated_at = now() WHERE id = :id";
}
