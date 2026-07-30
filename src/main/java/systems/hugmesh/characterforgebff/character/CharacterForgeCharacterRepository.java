package systems.hugmesh.characterforgebff.character;

import org.springframework.stereotype.Repository;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import systems.hugmesh.commons.security.DomainRegistry;
import systems.hugmesh.commons.tenancy.DomainScope;

import java.util.Collection;
import java.util.UUID;

/**
 * Reactive (R2DBC) store facade for {@code character_forge_character} — the saved 3D
 * characters, owner-scoped by the immutable Casdoor {@code sub}. Read on the owner's
 * own CRUD surface and the XR room's batched active-config lookup; written only by
 * the owner (the service derives the subject from the JWT, NEVER the body).
 *
 * <p><b>Domain-scoped (Liquibase {@code 001}, following the forum-bff 003
 * treatment).</b> Each row carries the brand/tenant {@code domain} (stamped
 * SERVER-SIDE from the owner's validated-issuer brand). The reads take an optional
 * {@code domain} predicate ({@link DomainScope}); a {@code null} domain is the
 * SUPERADMIN cross-domain bypass. Writes always stamp a CONCRETE domain (a
 * SUPERADMIN's null scope concretizes to the platform {@code default} domain so a
 * stored row always names a brand) — the same semantics as the forum-bff
 * {@code ForumVnProfileRepository}.
 *
 * <p><b>Single active per (owner, domain).</b> {@link #swapActive} runs the
 * CLEAR-then-SET pair; the partial unique index {@code ux_character_forge_one_active}
 * (changelog 001) backstops the race — a concurrent double-activate fails LOUDLY with
 * a duplicate-key error rather than ever persisting two actives.
 *
 * <p>This is a thin facade over {@link CharacterForgeCharacterR2dbcRepository}
 * (Spring Data reactive repository) — the actual data access goes through derived
 * finders + the {@code @Query} constants (the {@code now()} stamps + jsonb CASTs).
 */
@Repository
public class CharacterForgeCharacterRepository {

    private final CharacterForgeCharacterR2dbcRepository repo;

    public CharacterForgeCharacterRepository(CharacterForgeCharacterR2dbcRepository repo) {
        this.repo = repo;
    }

    /** One owner's characters (oldest first); {@code null} domain = SUPERADMIN
     *  cross-domain bypass. */
    public Flux<CharacterForgeCharacter> findAllByOwner(String ownerSubject, String domain) {
        return DomainScope.isUnscoped(domain)
                ? repo.findAllByOwnerSubjectOrderByCreatedAtAscIdAsc(ownerSubject)
                : repo.findAllByOwnerSubjectAndDomainOrderByCreatedAtAscIdAsc(ownerSubject, domain);
    }

    /** One character by id IFF owned by the subject (within the brand unless
     *  unscoped). Empty for a foreign/missing id — the service's 404-not-403 seam. */
    public Mono<CharacterForgeCharacter> findByIdAndOwner(UUID id, String ownerSubject, String domain) {
        return DomainScope.isUnscoped(domain)
                ? repo.findByIdAndOwnerSubject(id, ownerSubject)
                : repo.findByIdAndOwnerSubjectAndDomain(id, ownerSubject, domain);
    }

    /** The owner's ACTIVE character, if any. Unscoped (SUPERADMIN) picks the first
     *  across brands (at most one per brand exists — the partial index). */
    public Mono<CharacterForgeCharacter> findActiveByOwner(String ownerSubject, String domain) {
        return DomainScope.isUnscoped(domain)
                ? repo.findAllByOwnerSubjectAndActiveTrue(ownerSubject).next()
                : repo.findByOwnerSubjectAndDomainAndActiveTrue(ownerSubject, domain);
    }

    /** The ACTIVE characters for an owner-set (the XR-room avatar resolve); owners
     *  with no active character are simply absent. A {@code null} domain is the
     *  SUPERADMIN cross-domain bypass. */
    public Flux<CharacterForgeCharacter> findActiveBySubjects(Collection<String> ownerSubjects, String domain) {
        if (ownerSubjects == null || ownerSubjects.isEmpty()) {
            return Flux.empty();
        }
        return DomainScope.isUnscoped(domain)
                ? repo.findAllByOwnerSubjectInAndActiveTrue(ownerSubjects)
                : repo.findAllByOwnerSubjectInAndDomainAndActiveTrue(ownerSubjects, domain);
    }

    /** The owner's character count — the {@code MAX_CHARACTERS_PER_OWNER} cap read. */
    public Mono<Long> countByOwner(String ownerSubject, String domain) {
        return DomainScope.isUnscoped(domain)
                ? repo.countByOwnerSubject(ownerSubject)
                : repo.countByOwnerSubjectAndDomain(ownerSubject, domain);
    }

    /**
     * Insert a new (never-active) character for an owner, STAMPING a CONCRETE brand
     * domain (a SUPERADMIN's null/blank scope concretizes to the platform
     * {@code default} domain) and reading the DB-generated row back by its
     * {@code RETURNING id}.
     */
    public Mono<CharacterForgeCharacter> create(String ownerSubject, String domain,
                                                String name, String definitionJson) {
        String dom = DomainScope.isUnscoped(domain) ? DomainRegistry.DEFAULT_DOMAIN : domain;
        return repo.insertCharacter(ownerSubject, dom, name, definitionJson)
                .flatMap(repo::findById);
    }

    /** Update an (already ownership-checked) character's name + canonical definition,
     *  then read the persisted row back. */
    public Mono<CharacterForgeCharacter> update(UUID id, String name, String definitionJson) {
        return repo.updateCharacter(id, name, definitionJson)
                .then(repo.findById(id));
    }

    /**
     * The single-active swap for an (already ownership-checked) row: CLEAR the
     * owner's current active in the ROW's OWN brand, then SET this row. Sequential —
     * the partial unique index {@code ux_character_forge_one_active} backstops any
     * concurrent interleaving (duplicate-key error, fail-closed, never two actives).
     * The clear scopes to {@code row.domain()} (not the caller's scope) so a
     * SUPERADMIN activating a brand row swaps within that brand only.
     */
    public Mono<CharacterForgeCharacter> swapActive(CharacterForgeCharacter row) {
        return repo.clearActive(row.ownerSubject(), row.domain())
                .then(repo.setActive(row.id()))
                .then(repo.findById(row.id()));
    }

    /** Delete an (already ownership-checked) character by id. */
    public Mono<Void> delete(UUID id) {
        return repo.deleteById(id);
    }
}
