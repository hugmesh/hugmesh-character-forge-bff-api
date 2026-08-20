package net.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
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
 * <p>The pack-level CREDIT block ({@code displayName}/{@code licenseSpdx}/
 * {@code attribution}) is read too — see {@link #credits()}. It is not used by the
 * mapping; it exists because a CC-BY pack's attribution has to reach an in-app
 * credits view, not merely the repo metadata, and this class is the only place the
 * vendored manifests are parsed.
 *
 * <p>Fail-fast: a missing/unparseable vendored manifest breaks context start (the
 * copies are committed resources — absence is a build defect, not a runtime
 * condition).
 */
@Component
public class VnPackManifests {

    /**
     * One vendored pack's credit block, exactly as its manifest declares it.
     * {@code attribution} is {@code null} for a pack that carries none — the field
     * is optional, and only a pack with SOURCED parts (srd-taxonomy-v1's SRD 5.1
     * material) is required to carry the verbatim string.
     */
    public record VnPackCredit(String packId, String displayName, String licenseSpdx,
                               String attribution) {
    }

    /** packId → slot ("head"/"body") → partId → headArchetype. */
    private final Map<String, Map<String, Map<String, String>>> index;

    /** One entry per vendored pack, in {@code Char3DConfigValidator.PACK_IDS} order. */
    private final List<VnPackCredit> credits;

    public VnPackManifests() {
        this(new ObjectMapper());
    }

    VnPackManifests(ObjectMapper mapper) {
        Map<String, Map<String, Map<String, String>>> built = new HashMap<>();
        List<VnPackCredit> builtCredits = new ArrayList<>();
        for (String packId : Char3DConfigValidator.PACK_IDS) {
            JsonNode manifest = readManifest(mapper, packId);
            built.put(packId, parseArchetypes(manifest));
            builtCredits.add(parseCredit(manifest, packId));
        }
        this.index = Map.copyOf(built);
        this.credits = List.copyOf(builtCredits);
    }

    private static JsonNode readManifest(ObjectMapper mapper, String packId) {
        String path = "vn/packs/" + packId + "/pack.json";
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return mapper.readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException("vendored VN pack manifest unreadable: " + path, e);
        }
    }

    private static Map<String, Map<String, String>> parseArchetypes(JsonNode manifest) {
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
    }

    /** The credit block, VERBATIM — an attribution string is a licence term, so it is
     *  never reflowed, truncated or reworded on the way out. */
    private static VnPackCredit parseCredit(JsonNode manifest, String packId) {
        JsonNode attribution = manifest.path("attribution");
        return new VnPackCredit(
                packId,
                manifest.path("displayName").asText(packId),
                manifest.path("licenseSpdx").asText(""),
                attribution.isTextual() ? attribution.textValue() : null);
    }

    /**
     * The pack-level credit blocks of every vendored pack, in
     * {@code Char3DConfigValidator.PACK_IDS} order.
     *
     * <p>The SHARED cross-language fixture pins this against the Angular remote's
     * vendored copy (see {@code ClientContractFixturesTest}), so the credits the
     * in-app view renders cannot drift from the manifests the server parses.
     */
    public List<VnPackCredit> credits() {
        return credits;
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
