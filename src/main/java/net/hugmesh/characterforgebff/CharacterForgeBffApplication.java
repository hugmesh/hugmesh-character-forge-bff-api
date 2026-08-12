package net.hugmesh.characterforgebff;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Character-forge BFF — the backend for the 3D character forge, paired with the
 * (in-repo, separately-built) {@code frontend/} Angular remote mounted at
 * {@code /character-forge} and the {@code godot/character-forge} 3D maker game. The
 * only browser path is
 *
 * <pre>browser -> fe-gateway /bff/character-forge/** -> THIS BFF -> its own Postgres</pre>
 *
 * <p>The surface (all under {@code /bff/character-forge}, ROLE_USER floor at the
 * gateway route-access, {@code .authenticated()} at the filter chain,
 * {@code hasRole('USER')} re-asserted per method):
 *
 * <ul>
 *   <li>{@code /characters} — owner-scoped Char3DConfig CRUD (owner ALWAYS the JWT
 *       {@code sub}; foreign id → 404, never 403; max 32 per owner);</li>
 *   <li>{@code /characters/{id}/active} + {@code /characters/active} — the single
 *       ACTIVE character per owner+domain (partial-unique-index-backed);</li>
 *   <li>{@code /characters/lookup} — the batched subject → ACTIVE-config resolve the
 *       XR chat room uses to dress other participants (parametric data only: every
 *       stored definition passed full server-side {@code Char3DConfigValidator}
 *       validation — unknown keys rejected, numerics clamped, hexes/enums checked,
 *       16KB cap — so no moderation pass is needed);</li>
 *   <li>{@code /map} — the PURE VnCharacter → Char3DConfig mapping function
 *       (DESIGN §2), keyed off the stable VN parameterization via the vendored pack
 *       manifests, mirrored client-side in the Godot maker.</li>
 * </ul>
 */
@SuppressWarnings("checkstyle:HideUtilityClassConstructor")
@SpringBootApplication
public class CharacterForgeBffApplication {
    public static void main(String[] args) {
        SpringApplication.run(CharacterForgeBffApplication.class, args);
    }
}
