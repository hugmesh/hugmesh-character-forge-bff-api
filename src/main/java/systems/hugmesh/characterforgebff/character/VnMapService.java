package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import systems.hugmesh.commons.web.ApiException;

import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The PURE VnCharacter → Char3DConfig mapping function behind
 * {@code POST /bff/character-forge/map} (DESIGN §2), mirrored client-side in the
 * Godot maker's {@code char3d_config.gd}. No I/O, no persistence — the endpoint is a
 * stateless transform over the STABLE VN parameterization (packId, partId,
 * headArchetype, palette regions), never the SVG geometry.
 *
 * <p>The rules (each pinned by {@code VnMapServiceTest}):
 * <ul>
 *   <li>{@code slots.head}'s partId → its {@code headArchetype} in the VENDORED pack
 *       manifest ({@link VnPackManifests}) → {@code head.family}, with the partId
 *       itself as {@code head.variant}. Fallback chain for an unknown part:
 *       head-part lookup → body-part lookup → {@code humanoid}. Kemonomimi
 *       (anime-v1) heads carry {@code headArchetype: humanoid} in the manifest, so
 *       they land on the humanoid family with ears/tail as parts — no special
 *       case.</li>
 *   <li>{@code slots.body} → {@code body.archetype} (same lookup; falls back to the
 *       resolved head family).</li>
 *   <li>{@code slots.{tail,wings,ears,markings,feature,accessory,hair}} →
 *       {@code parts.*} partId passthrough (invalid/oversized ids dropped — the map
 *       is tolerant; the trailing validation still guarantees a well-formed
 *       output).</li>
 *   <li>palette regions → {@code materials} 1:1 for the seven known region names
 *       (menagerie: fur/accent/detail/line/iris; anime adds skin/hair); non-hex
 *       values and unknown regions dropped.</li>
 *   <li>style: {@code anime-v1} → {@code anime}; {@code srd-taxonomy-v1} →
 *       {@code classic}; else {@code toon}.</li>
 *   <li>{@code head.snoutLength} defaults from a per-family stylized table
 *       ({@link #SNOUT_BY_FAMILY}); {@code earStyle} echoes the ears partId;
 *       {@code hornStyle} echoes a horn/antler feature partId.</li>
 *   <li>the {@code source} block echoes the sanitized VN inputs (packId, slots,
 *       palette, defaultExpression) so the maker can round-trip back to the
 *       studio.</li>
 * </ul>
 *
 * <p>The assembled config is passed through {@link Char3DConfigValidator#validate}
 * before returning, so {@code /map} can NEVER emit a config the create/update
 * surface would reject (pinned by test).
 */
@Service
public class VnMapService {

    /** Input cap — same bound as a stored definition. */
    public static final int MAX_INPUT_BYTES = Char3DConfigValidator.MAX_DEFINITION_BYTES;

    /** Stylized per-family default snout lengths (0..1, jaw-forward feel; clamped by
     *  the validator either way). Families absent here fall back to 0.5. */
    static final Map<String, Double> SNOUT_BY_FAMILY = Map.ofEntries(
            Map.entry("humanoid", 0.05), Map.entry("slime", 0.15), Map.entry("moth", 0.2),
            Map.entry("insect", 0.25), Map.entry("robot", 0.3), Map.entry("synth", 0.3),
            Map.entry("amphibian", 0.3), Map.entry("bat", 0.35), Map.entry("felid", 0.35),
            Map.entry("lapine", 0.35), Map.entry("rodent", 0.4), Map.entry("suid", 0.45),
            Map.entry("procyonid", 0.45), Map.entry("ursine", 0.45), Map.entry("canid", 0.55),
            Map.entry("caprine", 0.55), Map.entry("hyena", 0.5), Map.entry("mustelid", 0.5),
            Map.entry("macropod", 0.5), Map.entry("aquatic", 0.5), Map.entry("avian", 0.6),
            Map.entry("gryphon", 0.55), Map.entry("kobold", 0.5), Map.entry("reptile", 0.5),
            Map.entry("cervine", 0.6), Map.entry("bovine", 0.6), Map.entry("dino", 0.6),
            Map.entry("dragon", 0.6), Map.entry("equine", 0.7));

    private static final Pattern PART_ID = Pattern.compile(Char3DConfigValidator.PART_ID_PATTERN);
    private static final Pattern HEX = Pattern.compile(Char3DConfigValidator.HEX_PATTERN);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** The VN slots that pass through to {@code parts.*} 1:1 (same names both sides). */
    private static final java.util.List<String> PASSTHROUGH_SLOTS = java.util.List.of(
            "tail", "wings", "ears", "feature", "accessory", "markings", "hair");

    private final VnPackManifests packs;

    public VnMapService(VnPackManifests packs) {
        this.packs = packs;
    }

    /**
     * Map a VnCharacter JSON to its canonical Char3DConfig.
     *
     * @param vnCharacter the studio's VnCharacter JSON ({@code packId} required and
     *                    must be one of the four shipped packs; unknown EXTRA fields
     *                    — {@code transform}, {@code userParts}, … — are ignored, the
     *                    input is the established VN wire shape, not ours to police)
     * @return the canonical, fully validated Char3DConfig
     * @throws ApiException 400 on a non-object body, an unknown/missing packId, or
     *                      an oversized input
     */
    public ObjectNode map(JsonNode vnCharacter) {
        if (vnCharacter == null || vnCharacter.isNull() || !vnCharacter.isObject()) {
            throw ApiException.badRequest("vnCharacter must be a JSON object");
        }
        if (vnCharacter.toString().getBytes(StandardCharsets.UTF_8).length > MAX_INPUT_BYTES) {
            throw ApiException.badRequest("vnCharacter exceeds the " + MAX_INPUT_BYTES + "-byte cap");
        }
        String packId = vnCharacter.path("packId").asText("");
        if (!packs.isKnownPack(packId)) {
            throw ApiException.badRequest("vnCharacter.packId must be one of "
                    + Char3DConfigValidator.PACK_IDS);
        }

        JsonNode slots = vnCharacter.path("slots");
        String headPart = sanitizedPartId(slots.path("head"));
        String bodyPart = sanitizedPartId(slots.path("body"));

        // head.family: head-part manifest lookup → body-part lookup → humanoid.
        String family = packs.headArchetype(packId, headPart);
        if (family == null) {
            family = packs.bodyArchetype(packId, bodyPart);
        }
        if (family == null || !Char3DConfigValidator.FAMILIES.contains(family)) {
            family = "humanoid";
        }
        // body.archetype: body-part lookup → the resolved head family.
        String archetype = packs.bodyArchetype(packId, bodyPart);
        if (archetype == null || !Char3DConfigValidator.FAMILIES.contains(archetype)) {
            archetype = family;
        }

        ObjectNode out = MAPPER.createObjectNode();
        out.put("schemaVersion", 1);

        String name = sanitizedName(vnCharacter.path("name"));
        if (name != null) {
            out.put("name", name);
        }

        out.set("source", buildSource(packId, slots, vnCharacter.path("palette"),
                vnCharacter.path("defaultExpression")));

        ObjectNode body = out.putObject("body");
        body.put("archetype", archetype);
        body.put("build", 0.5);
        body.put("height", 1.0);

        ObjectNode head = out.putObject("head");
        head.put("family", family);
        String variant = shortened(headPart);
        if (variant != null) {
            head.put("variant", variant);
        }
        head.put("snoutLength", SNOUT_BY_FAMILY.getOrDefault(family, 0.5));
        head.put("earStyle", shortened(sanitizedPartId(slots.path("ears"))));
        head.put("hornStyle", shortened(hornFeature(sanitizedPartId(slots.path("feature")))));

        ObjectNode parts = out.putObject("parts");
        for (String slot : PASSTHROUGH_SLOTS) {
            String partId = sanitizedPartId(slots.path(slot));
            if (partId == null) {
                parts.putNull(slot);
            } else {
                parts.put(slot, partId);
            }
        }

        // palette regions → materials 1:1; a region the VN palette does not name gets
        // the CANONICAL default (DESIGN §2 spells the mapping output's materials as
        // seven plain "#hex" values — no nulls). Emitting null here made the client
        // mirror unmatchable: util/map-vn.ts runs its result through
        // normalizeChar3dConfig, which fills the same defaults, so "Preview locally"
        // and "Map on server" produced two different characters from one VN source.
        ObjectNode materials = out.putObject("materials");
        JsonNode palette = vnCharacter.path("palette");
        for (String region : Char3DConfigValidator.MATERIAL_KEYS) {
            String hex = sanitizedHex(palette.path(region));
            materials.put(region, hex == null
                    ? Char3DConfigValidator.DEFAULT_MATERIALS.get(region)
                    : hex);
        }

        out.put("style", styleOf(packId));

        // GUARANTEE: /map can never emit a config the create/update surface rejects.
        return Char3DConfigValidator.validate(out);
    }

    /** anime-v1 → anime; srd-taxonomy-v1 → classic; else toon (DESIGN §2). */
    static String styleOf(String packId) {
        return switch (packId) {
            case "anime-v1" -> "anime";
            case "srd-taxonomy-v1" -> "classic";
            default -> "toon";
        };
    }

    /**
     * The {@code source} echo. Shape is UNCONDITIONAL — {@code packId}, a
     * {@code slots} object, a {@code palette} object and a {@code defaultExpression}
     * are always present (empty objects / {@code "neutral"} when the VN character
     * carries nothing usable). The client mirror ({@code util/map-vn.ts}) cannot
     * reproduce a shape whose KEYS depend on the input, and an echo that sometimes
     * omits {@code defaultExpression} forced every consumer to re-derive the default
     * anyway.
     */
    private ObjectNode buildSource(String packId, JsonNode slots, JsonNode palette,
                                   JsonNode defaultExpression) {
        ObjectNode source = MAPPER.createObjectNode();
        source.put("packId", packId);

        ObjectNode outSlots = source.putObject("slots");
        if (slots.isObject()) {
            int kept = 0;
            for (Iterator<String> it = slots.fieldNames(); it.hasNext(); ) {
                String slot = it.next();
                if (kept >= Char3DConfigValidator.MAX_SOURCE_SLOTS) {
                    break;
                }
                if (!slot.matches(Char3DConfigValidator.KEY_PATTERN)) {
                    continue;                              // tolerant: drop odd keys
                }
                JsonNode v = slots.get(slot);
                if (v.isNull()) {
                    outSlots.putNull(slot);
                    kept++;
                } else {
                    String partId = sanitizedPartId(v);
                    if (partId != null) {
                        outSlots.put(slot, partId);
                        kept++;
                    }
                }
            }
        }

        ObjectNode outPalette = source.putObject("palette");
        if (palette.isObject()) {
            int kept = 0;
            for (Iterator<String> it = palette.fieldNames(); it.hasNext(); ) {
                String region = it.next();
                if (kept >= Char3DConfigValidator.MAX_SOURCE_PALETTE) {
                    break;
                }
                if (!region.matches(Char3DConfigValidator.KEY_PATTERN)) {
                    continue;
                }
                String hex = sanitizedHex(palette.get(region));
                if (hex != null) {
                    outPalette.put(region, hex);
                    kept++;
                }
            }
        }

        String expr = defaultExpression.isTextual() ? defaultExpression.textValue() : null;
        source.put("defaultExpression",
                expr != null && Char3DConfigValidator.EXPRESSIONS.contains(expr)
                        ? expr : "neutral");
        return source;
    }

    /** A well-formed bounded partId or null (tolerant drop — never a 400). */
    private static String sanitizedPartId(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return null;
        }
        String s = node.textValue();
        return PART_ID.matcher(s).matches() ? s : null;
    }

    private static String sanitizedHex(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return null;
        }
        String s = node.textValue();
        return HEX.matcher(s).matches() ? s : null;
    }

    /** Truncate a partId to the ≤40 short-string bound (variant/earStyle/hornStyle). */
    private static String shortened(String partId) {
        if (partId == null) {
            return null;
        }
        return partId.length() <= 40 ? partId : partId.substring(0, 40);
    }

    /** A feature partId counts as a horn style iff it names a horn/antler. */
    private static String hornFeature(String featurePartId) {
        if (featurePartId == null) {
            return null;
        }
        String lower = featurePartId.toLowerCase(java.util.Locale.ROOT);
        return (lower.contains("horn") || lower.contains("antler")) ? featurePartId : null;
    }

    /**
     * Display name truncated to the 120-char cap with every code point the validator
     * forbids STRIPPED — controls, bidi overrides and the other invisible formatting
     * characters (mapping is tolerant and must never 400 on a hostile VN name; the
     * trailing {@link Char3DConfigValidator#validate} would otherwise reject the
     * config this service just built).
     */
    private static String sanitizedName(JsonNode node) {
        if (node == null || !node.isTextual()) {
            return null;
        }
        String raw = node.textValue();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < raw.length() && sb.length() < Char3DConfigValidator.MAX_NAME_LENGTH; ) {
            int cp = raw.codePointAt(i);
            if (!Char3DConfigValidator.isForbiddenNameCodePoint(cp)) {
                sb.appendCodePoint(cp);
            }
            i += Character.charCount(cp);
        }
        String cleaned = sb.toString().strip();
        return cleaned.isEmpty() ? null : cleaned;
    }
}
