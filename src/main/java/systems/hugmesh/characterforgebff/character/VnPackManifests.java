package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Startup-parsed index over the VENDORED VN pack manifests
 * ({@code src/main/resources/vn/packs/<packId>/pack.json} — byte-faithful copies of
 * {@code hugmesh-character-studio-ui/src/assets/vn/packs/<packId>/pack.json}; see
 * {@code vn/packs/PROVENANCE.md}).
 *
 * <p>Only the STABLE parameterization is read: for the {@code head} and {@code body}
 * slots, the {@code partId → headArchetype} lookup the {@code /map} mapping rule
 * needs ("VnCharacter.slots.head's partId → look up its headArchetype in the pack
 * manifest → head.family", DESIGN §2). The SVG file paths / anchors / z-orders are
 * deliberately ignored — mapping keys off the parameterization, never the SVG
 * geometry.
 *
 * <p>Fail-fast: a missing/unparseable vendored manifest breaks context start (the
 * copies are committed resources — absence is a build defect, not a runtime
 * condition).
 */
@Component
public class VnPackManifests {

    /** packId → slot ("head"/"body") → partId → headArchetype. */
    private final Map<String, Map<String, Map<String, String>>> index;

    public VnPackManifests() {
        this(new ObjectMapper());
    }

    VnPackManifests(ObjectMapper mapper) {
        Map<String, Map<String, Map<String, String>>> built = new HashMap<>();
        for (String packId : Char3DConfigValidator.PACK_IDS) {
            built.put(packId, parsePack(mapper, packId));
        }
        this.index = Map.copyOf(built);
    }

    private static Map<String, Map<String, String>> parsePack(ObjectMapper mapper, String packId) {
        String path = "vn/packs/" + packId + "/pack.json";
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            JsonNode manifest = mapper.readTree(in);
            Map<String, Map<String, String>> slots = new HashMap<>();
            for (JsonNode slotDef : manifest.path("slots")) {
                String slot = slotDef.path("slot").asText("");
                if (!"head".equals(slot) && !"body".equals(slot)) {
                    continue;                    // only the archetype-establishing slots
                }
                Map<String, String> parts = new HashMap<>();
                for (JsonNode part : slotDef.path("parts")) {
                    String id = part.path("id").asText("");
                    String archetype = part.path("headArchetype").asText("");
                    if (!id.isEmpty() && !archetype.isEmpty()) {
                        parts.put(id, archetype);
                    }
                }
                slots.put(slot, Map.copyOf(parts));
            }
            return Map.copyOf(slots);
        } catch (IOException e) {
            throw new IllegalStateException("vendored VN pack manifest unreadable: " + path, e);
        }
    }

    /** True iff {@code packId} is one of the four vendored packs. */
    public boolean isKnownPack(String packId) {
        return packId != null && index.containsKey(packId);
    }

    /** The {@code headArchetype} of a pack's HEAD part, or {@code null} when the
     *  pack/part is unknown (the mapper then falls back per its documented chain). */
    public String headArchetype(String packId, String partId) {
        return archetypeOf(packId, "head", partId);
    }

    /** The {@code headArchetype} of a pack's BODY part, or {@code null} when unknown. */
    public String bodyArchetype(String packId, String partId) {
        return archetypeOf(packId, "body", partId);
    }

    private String archetypeOf(String packId, String slot, String partId) {
        if (packId == null || partId == null) {
            return null;
        }
        Map<String, Map<String, String>> pack = index.get(packId);
        if (pack == null) {
            return null;
        }
        Map<String, String> parts = pack.get(slot);
        return parts == null ? null : parts.get(partId);
    }
}
