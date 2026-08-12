/**
 * The character-forge feature: owner-scoped Char3DConfig persistence
 * (entity/repositories/service/controller), the full server-side
 * {@code Char3DConfigValidator}, and the pure VnCharacter→Char3DConfig mapping
 * ({@code VnMapService} over the vendored VN pack manifests). All endpoints are
 * guarded by Casdoor JWT authentication + the {@code hasRole('USER')} method gate;
 * owner == JWT subject with foreign id → 404; rows are domain-scoped.
 */
package net.hugmesh.characterforgebff.character;
