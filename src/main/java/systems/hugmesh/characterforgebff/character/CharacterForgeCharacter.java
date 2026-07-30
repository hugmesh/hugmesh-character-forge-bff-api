package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Column;
import org.springframework.data.relational.core.mapping.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of the {@code character_forge_character} table (Liquibase {@code 001}) —
 * one saved 3D character. Owner-scoped by the IMMUTABLE Casdoor {@code sub} (the
 * platform decision: NEVER localpart — {@code sub} is the only collision-safe key),
 * with a DB-GENERATED {@code uuid} primary key ({@code gen_random_uuid()} column
 * DEFAULT — the org-wide mod-bff #36 / admin-bff #133 / forum-bff 004 pattern: the
 * INSERT omits {@code id} and {@code RETURNING id} reads it back).
 *
 * <p>The {@code domain} follows the forum-bff changelog-003 treatment exactly: the
 * brand/tenant the row belongs to, stamped SERVER-SIDE from the owner's
 * validated-issuer brand (NEVER a request field), {@code DEFAULT 'default'} so
 * single-tenant clusters are unchanged; SUPERADMIN (null scope) is unscoped.
 *
 * <p>{@code definition} is the character's Char3DConfig as CANONICAL JSON text in a
 * {@code jsonb} column. Every write passes {@link Char3DConfigValidator} first
 * (unknown keys rejected, numerics clamped, hexes/enums checked, ≤16KB), so the
 * column only ever holds fully server-validated parametric data — which is why the
 * cross-user {@code /lookup} surface needs no moderation pass. Reads surface the
 * driver's {@code Json} codec value as this record's {@code String} via the
 * {@code PgJsonToStringConverter}; writes go through explicit
 * {@code CAST(:def AS jsonb)} repository legs, never entity mapping.
 *
 * <p>{@code active} marks the owner's SINGLE active character per (owner, domain) —
 * the one the XR chat room dresses the owner with. Enforced by the service's
 * clear-then-set flow AND backstopped by the partial unique index
 * {@code ux_character_forge_one_active} (changelog 001).
 *
 * @param id           DB-generated uuid primary key
 * @param ownerSubject the owner's immutable Casdoor {@code sub} — ALWAYS the JWT subject
 * @param domain       the brand/tenant the row belongs to (server-derived; {@code default} single-tenant)
 * @param name         the display name (≤120, server-validated)
 * @param active       whether this is the owner's single active character in its domain
 * @param definition   the canonical Char3DConfig JSON (jsonb column; ≤16KB, fully validated)
 * @param createdAt    row creation timestamp (DB {@code now()})
 * @param updatedAt    last write timestamp (DB {@code now()})
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@Table("character_forge_character")
public record CharacterForgeCharacter(
        @Id @Column("id") UUID id,
        @Column("owner_subject") String ownerSubject,
        @Column("domain") String domain,
        @Column("name") String name,
        @Column("active") boolean active,
        @Column("definition") String definition,
        @Column("created_at") Instant createdAt,
        @Column("updated_at") Instant updatedAt) {
}
