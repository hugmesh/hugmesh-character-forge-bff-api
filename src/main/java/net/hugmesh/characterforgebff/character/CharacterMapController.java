package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
// The HTTP boundary speaks Jackson 3 (Boot 4's reactive codec); VnMapService's
// internals stay Jackson 2 — bridged below by string round-trip (see
// CharacterForgeDto's boundary note).
import tools.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * The PURE mapping endpoint ({@code POST /bff/character-forge/map}) — VnCharacter
 * JSON in, canonical Char3DConfig out (DESIGN §2). Stateless: nothing is read from
 * or written to the database; the transform is deterministic over the vendored pack
 * manifests, and its output is guaranteed valid against
 * {@link Char3DConfigValidator} (so a client can feed it straight into
 * {@code POST /characters}).
 *
 * <p>Gated like the rest of the surface: {@code .authenticated()} at the filter
 * chain + the {@code hasRole('USER')} method gate — the function is cheap but not
 * anonymous (it rides the same ROLE_USER floor as the rest of the forge).
 */
@Tag(name = "CharacterForgeMap", description = "Pure VnCharacter→Char3DConfig mapping (no "
        + "persistence): the SVG VN parameterization (packId, slots, palette, defaultExpression) "
        + "mapped onto the 3D config vocabulary via the vendored pack manifests. The output is "
        + "always a valid, canonical Char3DConfig.")
@RestController
@RequestMapping("/bff/character-forge")
public class CharacterMapController {

    /** Same method gate as the character surface (see {@code CharacterForgeController}). */
    private static final String USER_GATE = "hasRole('USER')";

    /** Jackson-2 mapper — the VnMapService/validator side of the boundary bridge. */
    private static final ObjectMapper J2 = new ObjectMapper();

    /** Jackson-3 mapper — the WebFlux-codec side of the boundary bridge. */
    private static final tools.jackson.databind.ObjectMapper J3 =
            new tools.jackson.databind.ObjectMapper();

    private final VnMapService mapper;

    public CharacterMapController(VnMapService mapper) {
        this.mapper = mapper;
    }

    @Operation(operationId = "mapVnCharacterToChar3d", summary = "Map a VnCharacter JSON to its "
            + "canonical Char3DConfig (pure function; 400 on a non-object body or unknown packId).")
    @PreAuthorize(USER_GATE)
    @PostMapping("/map")
    public Mono<JsonNode> map(@RequestBody JsonNode vnCharacter) {
        // Boundary bridge: the codec decodes a Jackson-3 node (ANY JSON shape — a
        // non-object still reaches VnMapService, which owns the 400); the pure
        // Jackson-2 transform runs in between; the canonical output is re-parsed to
        // Jackson 3 so the codec can encode the response.
        return Mono.fromCallable(() -> J3.readTree(mapper.map(toJackson2(vnCharacter)).toString()));
    }

    /** Jackson-3 → Jackson-2 (a Jackson-3 node's {@code toString()} is always valid
     *  JSON, so the re-parse cannot fail on real input; belt-and-braces 400). */
    private static com.fasterxml.jackson.databind.JsonNode toJackson2(JsonNode node) {
        if (node == null) {
            return null;
        }
        try {
            return J2.readTree(node.toString());
        } catch (JsonProcessingException e) {
            throw net.hugmesh.commons.web.ApiException.badRequest("body must be valid JSON");
        }
    }
}
