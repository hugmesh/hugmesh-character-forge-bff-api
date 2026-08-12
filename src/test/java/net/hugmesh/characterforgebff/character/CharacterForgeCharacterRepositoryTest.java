package net.hugmesh.characterforgebff.character;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.r2dbc.test.autoconfigure.DataR2dbcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;
import net.hugmesh.commons.testsupport.PostgresTestSupport;
import net.hugmesh.characterforgebff.support.PostgresSliceTestConfig;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * R2DBC slice test for {@link CharacterForgeCharacterRepository} over a
 * Testcontainers-Postgres store that Liquibase applies the REAL production changelog
 * over (the {@link PostgresSliceTestConfig} pattern — copied from forum-bff's
 * {@code ForumActionRepositoryTest}). A REAL Postgres is REQUIRED: changelog 001's
 * {@code jsonb} definition column, the {@code gen_random_uuid()} PK DEFAULT +
 * {@code INSERT ... RETURNING id}, and the partial unique index
 * {@code ux_character_forge_one_active} are all Postgres features H2's compat mode
 * cannot honour.
 *
 * <p>Verifies, against the real schema:
 * <ul>
 *   <li>the create round-trip — DB-generated uuid, {@code now()} stamps, NEVER active
 *       on insert, jsonb write/read through the converter pair, and the null-scope
 *       (SUPERADMIN) concretization to the {@code default} domain;</li>
 *   <li>the OWNER floor at the data layer (foreign owner → empty — the 404 seam);</li>
 *   <li>multi-brand DATA-LAYER isolation: a brand-scoped read never crosses brands,
 *       {@code null} domain (SUPERADMIN) bypasses, and the fail-closed
 *       {@code __deny__} sentinel matches NOTHING;</li>
 *   <li>the single-active swap (clear-then-set) + the partial-index BACKSTOP: a raw
 *       double-activate in one (owner, domain) trips the unique index LOUDLY;</li>
 *   <li>the batched active-by-subjects resolve the XR room rides on.</li>
 * </ul>
 *
 * <p>Every test uses UNIQUE owner/domain names so the shared per-class container db's
 * rows never bleed across methods.
 */
@DataR2dbcTest
@ActiveProfiles("test")
@Import({PostgresSliceTestConfig.class, CharacterForgeCharacterRepository.class})
class CharacterForgeCharacterRepositoryTest extends PostgresTestSupport {

    private static final String DEF =
            "{\"schemaVersion\":1,\"body\":{\"archetype\":\"canid\",\"build\":0.5,\"height\":1.0},"
                    + "\"head\":{\"family\":\"canid\",\"snoutLength\":0.5,\"earStyle\":null,\"hornStyle\":null},"
                    + "\"parts\":{\"tail\":null,\"wings\":null,\"ears\":null,\"feature\":null,"
                    + "\"accessory\":null,\"markings\":null,\"hair\":null},"
                    + "\"materials\":{\"fur\":\"#a86f32\",\"accent\":null,\"detail\":null,\"line\":null,"
                    + "\"iris\":null,\"skin\":null,\"hair\":null},\"style\":\"toon\"}";

    @Autowired CharacterForgeCharacterRepository repo;

    /** The raw Spring Data repo — used ONLY to drive the partial-index race backstop
     *  (a direct double-SET that skips the facade's clear-then-set discipline). */
    @Autowired CharacterForgeCharacterR2dbcRepository raw;

    /** Jackson-2 parse of a stored jsonb rendering (format-insensitive assertions). */
    private static com.fasterxml.jackson.databind.JsonNode parse(String json) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("stored definition is not valid JSON", e);
        }
    }

    private CharacterForgeCharacter create(String owner, String domain, String name) {
        return repo.create(owner, domain, name, DEF).block();
    }

    // ── create round-trip ───────────────────────────────────────────────

    @Test
    void create_roundTrip_dbGeneratedId_stamps_neverActive_jsonbIntact() {
        CharacterForgeCharacter saved = create("rt-owner", "rt-brand", "Rex");

        assertThat(saved.id()).as("id is DB-generated (gen_random_uuid) and read back").isNotNull();
        assertThat(saved.ownerSubject()).isEqualTo("rt-owner");
        assertThat(saved.domain()).isEqualTo("rt-brand");
        assertThat(saved.name()).isEqualTo("Rex");
        assertThat(saved.active()).as("a new character is NEVER active on insert").isFalse();
        assertThat(saved.createdAt()).isNotNull();
        assertThat(saved.updatedAt()).isNotNull();
        // The jsonb column round-trips SEMANTICALLY intact through the
        // PgJson→String read converter. Postgres re-renders jsonb in its own
        // format (spaces after colons, physical key reorder), so compare as
        // parsed trees, never as text.
        com.fasterxml.jackson.databind.JsonNode tree = parse(saved.definition());
        assertThat(tree.path("body").path("archetype").asText()).isEqualTo("canid");
        assertThat(tree.path("style").asText()).isEqualTo("toon");
        assertThat(tree.path("materials").path("fur").asText()).isEqualTo("#a86f32");
        assertThat(tree.path("schemaVersion").asInt()).isEqualTo(1);
    }

    @Test
    void create_nullScope_concretizesToDefaultDomain() {
        // A SUPERADMIN's unscoped (null) create still stamps a CONCRETE brand: the
        // platform default — a stored row always names a domain.
        CharacterForgeCharacter saved = repo.create("nullscope-owner", null, "Su", DEF).block();
        assertThat(saved.domain()).isEqualTo("default");
    }

    // ── the OWNER floor (the 404 seam) ──────────────────────────────────

    @Test
    void findByIdAndOwner_foreignOwner_isEmpty_ownRead_resolves() {
        CharacterForgeCharacter saved = create("owner-floor-a", "of-brand", "Mine");

        assertThat(repo.findByIdAndOwner(saved.id(), "owner-floor-a", "of-brand").block())
                .as("the owner reads their own row").isNotNull();
        assertThat(repo.findByIdAndOwner(saved.id(), "owner-floor-INTRUDER", "of-brand").block())
                .as("a foreign owner's read is EMPTY — the service's 404-not-403 seam")
                .isNull();
        assertThat(repo.findByIdAndOwner(UUID.randomUUID(), "owner-floor-a", "of-brand").block())
                .as("a nonexistent id is indistinguishable from a foreign one")
                .isNull();
    }

    // ── multi-brand isolation ───────────────────────────────────────────

    @Test
    void domainScopedReads_neverCrossBrands_nullDomainBypasses_denySentinelReadsNothing() {
        String owner = "iso-owner";
        CharacterForgeCharacter inX = create(owner, "iso-bx", "InX");
        create(owner, "iso-by", "InY");

        // Brand-scoped list: each brand sees ONLY its own row.
        List<CharacterForgeCharacter> xs = repo.findAllByOwner(owner, "iso-bx").collectList().block();
        assertThat(xs).hasSize(1);
        assertThat(xs.get(0).domain()).isEqualTo("iso-bx");

        // The SAME owner's brand-X row is invisible when id-addressed from brand Y.
        assertThat(repo.findByIdAndOwner(inX.id(), owner, "iso-by").block()).isNull();

        // SUPERADMIN (null domain) reads across brands.
        assertThat(repo.findAllByOwner(owner, null).collectList().block()).hasSize(2);

        // The fail-closed __deny__ sentinel (unresolvable non-SUPERADMIN issuer)
        // matches NO real row.
        assertThat(repo.findAllByOwner(owner, "__deny__").collectList().block()).isEmpty();
        assertThat(repo.countByOwner(owner, "__deny__").block()).isZero();
    }

    @Test
    void countByOwner_isDomainScoped() {
        String owner = "count-owner";
        create(owner, "count-bx", "a");
        create(owner, "count-bx", "b");
        create(owner, "count-by", "c");

        assertThat(repo.countByOwner(owner, "count-bx").block()).isEqualTo(2);
        assertThat(repo.countByOwner(owner, "count-by").block()).isEqualTo(1);
        assertThat(repo.countByOwner(owner, null).block())
                .as("null scope (SUPERADMIN) counts across brands").isEqualTo(3);
    }

    @Test
    void list_isOldestFirst() {
        String owner = "order-owner";
        CharacterForgeCharacter first = create(owner, "order-b", "first");
        CharacterForgeCharacter second = create(owner, "order-b", "second");

        List<CharacterForgeCharacter> rows = repo.findAllByOwner(owner, "order-b").collectList().block();
        assertThat(rows).extracting(CharacterForgeCharacter::id)
                .containsExactly(first.id(), second.id());
    }

    // ── the single-active swap + the partial-index backstop ─────────────

    @Test
    void swapActive_clearsTheSibling_singleActivePerOwnerAndBrand() {
        String owner = "swap-owner";
        CharacterForgeCharacter a = create(owner, "swap-b", "a");
        CharacterForgeCharacter b = create(owner, "swap-b", "b");

        assertThat(repo.swapActive(a).block().active()).isTrue();
        assertThat(repo.findActiveByOwner(owner, "swap-b").block().id()).isEqualTo(a.id());

        // Swapping to b clears a — never two actives in one (owner, brand).
        assertThat(repo.swapActive(b).block().active()).isTrue();
        assertThat(repo.findActiveByOwner(owner, "swap-b").block().id()).isEqualTo(b.id());
        assertThat(repo.findByIdAndOwner(a.id(), owner, "swap-b").block().active()).isFalse();
    }

    @Test
    void swapActive_crossBrandActives_coexist_swapScopesToTheRowsOwnBrand() {
        // One owner may hold ONE active per brand — activating in brand Y must not
        // clear the brand-X active (the swap scopes to the ROW's own domain).
        String owner = "xbrand-active-owner";
        CharacterForgeCharacter inX = create(owner, "xa-bx", "x");
        CharacterForgeCharacter inY = create(owner, "xa-by", "y");

        repo.swapActive(inX).block();
        repo.swapActive(inY).block();

        assertThat(repo.findActiveByOwner(owner, "xa-bx").block().id()).isEqualTo(inX.id());
        assertThat(repo.findActiveByOwner(owner, "xa-by").block().id()).isEqualTo(inY.id());
    }

    @Test
    void partialUniqueIndex_backstopsARawDoubleActivate_failClosed() {
        // Simulate the CONCURRENT-race interleaving the facade's clear-then-set cannot
        // prevent: two raw SET legs in one (owner, domain) with no clear between. The
        // partial unique index ux_character_forge_one_active must trip LOUDLY — never
        // two persisted actives.
        String owner = "race-owner";
        CharacterForgeCharacter a = create(owner, "race-b", "a");
        CharacterForgeCharacter b = create(owner, "race-b", "b");

        raw.setActive(a.id()).block();
        assertThatThrownBy(() -> raw.setActive(b.id()).block())
                .as("the second raw activate violates ux_character_forge_one_active")
                .isInstanceOf(DataIntegrityViolationException.class);

        // And the store still holds exactly ONE active for the pair.
        assertThat(repo.findActiveByOwner(owner, "race-b").block().id()).isEqualTo(a.id());
    }

    // ── the batched active-by-subjects resolve (the XR room read) ───────

    @Test
    void findActiveBySubjects_domainScoped_absentWhenNoActive_emptyInputEmptyOutput() {
        String s1 = "batch-owner-1";
        String s2 = "batch-owner-2";
        String s3 = "batch-owner-3";              // has a character but never activates
        CharacterForgeCharacter c1 = create(s1, "batch-b", "one");
        CharacterForgeCharacter c2 = create(s2, "batch-b", "two");
        create(s3, "batch-b", "three");
        repo.swapActive(c1).block();
        repo.swapActive(c2).block();

        List<CharacterForgeCharacter> got = repo
                .findActiveBySubjects(Set.of(s1, s2, s3, "batch-nobody"), "batch-b")
                .collectList().block();
        assertThat(got).extracting(CharacterForgeCharacter::ownerSubject)
                .containsExactlyInAnyOrder(s1, s2);

        // Brand wall: the same resolve from another brand returns nothing.
        assertThat(repo.findActiveBySubjects(Set.of(s1, s2), "batch-OTHER")
                .collectList().block()).isEmpty();

        // Null scope (SUPERADMIN) crosses brands.
        assertThat(repo.findActiveBySubjects(Set.of(s1, s2), null)
                .collectList().block()).hasSize(2);

        // Degenerate input short-circuits.
        assertThat(repo.findActiveBySubjects(List.of(), "batch-b").collectList().block()).isEmpty();
        assertThat(repo.findActiveBySubjects(null, "batch-b").collectList().block()).isEmpty();
    }

    // ── update + delete legs ────────────────────────────────────────────

    @Test
    void update_replacesNameAndDefinition_bumpsUpdatedAt() {
        CharacterForgeCharacter saved = create("upd-owner", "upd-b", "before");
        String newDef = DEF.replace("\"style\":\"toon\"", "\"style\":\"anime\"");

        CharacterForgeCharacter updated = repo.update(saved.id(), "after", newDef).block();
        assertThat(updated.name()).isEqualTo("after");
        // jsonb re-renders — compare parsed, not textually.
        assertThat(parse(updated.definition()).path("style").asText()).isEqualTo("anime");
        assertThat(updated.updatedAt()).isAfterOrEqualTo(saved.updatedAt());
        // created_at is untouched by the update leg.
        assertThat(updated.createdAt()).isEqualTo(saved.createdAt());
    }

    @Test
    void delete_removesTheRow() {
        CharacterForgeCharacter saved = create("del-owner", "del-b", "doomed");
        repo.delete(saved.id()).block();
        assertThat(repo.findByIdAndOwner(saved.id(), "del-owner", "del-b").block()).isNull();
    }
}
