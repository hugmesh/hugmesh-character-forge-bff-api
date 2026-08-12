package net.hugmesh.characterforgebff.character;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.List;

/**
 * The character surface ({@code /bff/character-forge/characters/**}) — owner-scoped
 * Char3DConfig CRUD, the single ACTIVE character, and the batched cross-user
 * active-config lookup.
 *
 * <p><b>Gating.</b> SecurityConfig floors the whole {@code /bff/character-forge/**}
 * path {@code .authenticated()} (the gateway route-access ROLE_USER floor is the
 * outer gate); every method here re-asserts {@code hasRole('USER')} (satisfied by
 * the converter's ROLE_USER floor — defence-in-depth proof of authentication, the
 * DESIGN-pinned method gate). Ownership is NOT a role: the service keys every
 * id-addressed read/write on {@code owner == JWT sub} and surfaces a foreign id as
 * <b>404</b>, never 403.
 *
 * <p><b>Owner never from the body.</b> All verbs key on
 * {@code Authentication.getName()} (the validated JWT {@code sub}) inside
 * {@link CharacterForgeService}; the write DTOs have no owner field and a smuggled
 * one is dropped at deserialization.
 *
 * <p><b>Route note:</b> the literal {@code /active} and {@code /lookup} routes are
 * matched BEFORE the {@code /{id}} template (Spring WebFlux prefers exact literals),
 * so those names are effectively reserved ids — which is fine: real ids are uuids.
 */
@Tag(name = "CharacterForge", description = "Owner-scoped 3D character (Char3DConfig) CRUD with "
        + "full server-side schema validation, the single ACTIVE character per owner, and the "
        + "batched subject→active-config lookup (1..50 subjects) the XR chat room resolves "
        + "avatars with. Authenticated + ROLE_USER; owner always the JWT subject; foreign id → 404.")
@RestController
@RequestMapping("/bff/character-forge/characters")
@Validated
public class CharacterForgeController {

    /** The DESIGN-pinned method gate. The converter floors every authenticated
     *  principal to ROLE_USER, so this proves authentication (and lets SUPERADMIN
     *  through via the role hierarchy) — ownership is enforced separately in the
     *  service. */
    private static final String USER_GATE = "hasRole('USER')";

    private final CharacterForgeService service;

    public CharacterForgeController(CharacterForgeService service) {
        this.service = service;
    }

    @Operation(operationId = "listMyCharacters", summary = "List the caller's characters "
            + "(oldest first, bounded by the 32-per-owner cap).")
    @PreAuthorize(USER_GATE)
    @GetMapping
    public Mono<List<CharacterForgeDto.CharacterView>> list(Authentication auth) {
        return service.list(auth);
    }

    @Operation(operationId = "createCharacter", summary = "Create a character "
            + "{name, definition:Char3DConfig} → 201. The definition is fully server-validated "
            + "and stored in canonical form; the 33rd character per owner is a 409.")
    @PreAuthorize(USER_GATE)
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<CharacterForgeDto.CharacterView> create(
            @Valid @RequestBody CharacterForgeDto.CreateCharacter body, Authentication auth) {
        return service.create(auth, body);
    }

    @Operation(operationId = "getMyActiveCharacter", summary = "The caller's ACTIVE character "
            + "(404 when none is marked active).")
    @PreAuthorize(USER_GATE)
    @GetMapping("/active")
    public Mono<CharacterForgeDto.CharacterView> active(Authentication auth) {
        return service.active(auth);
    }

    @Operation(operationId = "lookupActiveCharacters", summary = "Batch-resolve the ACTIVE "
            + "character configs for up to 50 subjects → {configs:{subject:{name,definition}}}; "
            + "subjects with no active character are absent from the map.")
    @PreAuthorize(USER_GATE)
    @PostMapping("/lookup")
    public Mono<CharacterForgeDto.LookupResponse> lookup(
            @Valid @RequestBody CharacterForgeDto.LookupRequest body, Authentication auth) {
        return service.lookup(auth, body);
    }

    @Operation(operationId = "getCharacter", summary = "One of the caller's characters by id "
            + "(owner-only; a foreign or unknown id is a 404, never a 403).")
    @PreAuthorize(USER_GATE)
    @GetMapping("/{id}")
    public Mono<CharacterForgeDto.CharacterView> get(@PathVariable String id, Authentication auth) {
        return service.get(auth, id);
    }

    @Operation(operationId = "updateCharacter", summary = "Replace name + definition of one of "
            + "the caller's characters (re-validated; canonical form stored; owner-only, foreign "
            + "id → 404). Activation is NOT settable here — use /active.")
    @PreAuthorize(USER_GATE)
    @PutMapping("/{id}")
    public Mono<CharacterForgeDto.CharacterView> update(
            @PathVariable String id,
            @Valid @RequestBody CharacterForgeDto.UpdateCharacter body, Authentication auth) {
        return service.update(auth, id, body);
    }

    @Operation(operationId = "deleteCharacter", summary = "Delete one of the caller's characters "
            + "(owner-only, foreign id → 404) → 204.")
    @PreAuthorize(USER_GATE)
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public Mono<Void> delete(@PathVariable String id, Authentication auth) {
        return service.delete(auth, id);
    }

    @Operation(operationId = "activateCharacter", summary = "Mark one of the caller's characters "
            + "as THE active one (single active per owner+brand — the previous active is cleared "
            + "atomically-enough, with a partial unique index backstopping races).")
    @PreAuthorize(USER_GATE)
    @PutMapping("/{id}/active")
    public Mono<CharacterForgeDto.CharacterView> setActive(@PathVariable String id, Authentication auth) {
        return service.setActive(auth, id);
    }
}
