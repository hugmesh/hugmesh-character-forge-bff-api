package systems.hugmesh.characterforgebff.character;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import systems.hugmesh.commons.web.ApiException;

import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The FULL server-side Char3DConfig v1 validator — the single reason the cross-user
 * {@code /lookup} surface needs no moderation pass: every definition that ever
 * reaches the {@code jsonb} column (create, update, and the {@code /map} output)
 * passed this first, so stored characters are pure bounded parametric data (enums,
 * clamped numbers, hex colours, bounded ids) and NOTHING free-form beyond the
 * length-capped display strings.
 *
 * <p>Contract (DESIGN §2/§3, mirrored client-side in the Godot maker's
 * {@code char3d_config.gd}):
 * <ul>
 *   <li><b>unknown keys → 400</b> at EVERY level (root, source, body, head, parts,
 *       materials) — a definition cannot smuggle payload fields;</li>
 *   <li><b>numerics CLAMP</b> into their documented ranges ({@code build} 0..1,
 *       {@code height} 0.5..1.5, {@code snoutLength} 0..1) — wrong TYPE still
 *       rejects;</li>
 *   <li><b>hex colours</b> match {@value #HEX_PATTERN};</li>
 *   <li><b>families/archetypes/styles/pack ids/expressions are ENUM-checked</b>
 *       against the locked vocabularies below;</li>
 *   <li><b>ids and short strings are pattern-bounded</b> ({@value #PART_ID_PATTERN},
 *       {@value #SHORT_STR_PATTERN});</li>
 *   <li><b>the whole definition is capped at {@value #MAX_DEFINITION_BYTES} bytes</b>
 *       (UTF-8, serialized).</li>
 * </ul>
 *
 * <p>The output is the CANONICAL form: fixed key order (schemaVersion, name?,
 * source?, body, head, parts, materials, style), all seven {@code parts} and the
 * seven canonical {@code materials} keys always present ({@code null} = unset),
 * numeric defaults applied ({@code build} 0.5, {@code height} 1.0,
 * {@code snoutLength} 0.5). The four EXTENDED coat-block regions
 * ({@link #EXTENDED_MATERIAL_KEYS}) are the one exception — stored only when
 * supplied, because absent means "let the maker derive it". Feeding
 * a canonical form back through the validator is IDEMPOTENT (pinned by
 * {@code Char3DConfigValidatorTest}).
 */
public final class Char3DConfigValidator {

    private Char3DConfigValidator() {}

    // ── the locked vocabularies (DESIGN §1/§2) ──────────────────────────

    /** The head families = the menagerie headArchetype vocabulary + {@code humanoid}
     *  (kemonomimi/anime and the SRD humanoid races land on {@code humanoid} with
     *  ears/tail as parts). Shared with {@code body.archetype}. */
    public static final List<String> FAMILIES = List.of(
            "canid", "felid", "avian", "reptile", "dragon", "dino", "kobold", "gryphon",
            "equine", "cervine", "bovine", "caprine", "suid", "hyena", "lapine", "rodent",
            "macropod", "moth", "insect", "bat", "ursine", "mustelid", "procyonid",
            "amphibian", "aquatic", "slime", "robot", "synth", "humanoid");

    /** The 3D render styles. */
    public static final List<String> STYLES = List.of("anime", "toon", "classic");

    /** The canonical 10 expression labels — the StickerExpression twin (2D stickers
     *  and 3D expression presets stay ONE contract). */
    public static final List<String> EXPRESSIONS = List.of(
            "neutral", "happy", "sad", "angry", "surprised",
            "embarrassed", "thinking", "wink", "sleepy", "smug");

    /** The four shipped VN pack ids a {@code source} echo may reference. */
    public static final List<String> PACK_IDS = List.of(
            "menagerie-v1", "anime-v1", "base-anthro-v1", "srd-taxonomy-v1");

    /** The seven part attachment slots. */
    public static final List<String> PART_KEYS = List.of(
            "tail", "wings", "ears", "feature", "accessory", "markings", "hair");

    /** The seven material regions — the SVG palette region names 1:1. */
    public static final List<String> MATERIAL_KEYS = List.of(
            "fur", "accent", "detail", "line", "iris", "skin", "hair");

    /**
     * The four EXTENDED coat-block regions (kemono.md's colour masks: base coat,
     * lighter inner-muzzle, socks/gloves, inner ear, tail tip). They are OPTIONAL
     * on the wire and, unlike {@link #MATERIAL_KEYS}, are NOT forced into the
     * canonical form: an absent one means "derive it" and the maker derives it
     * (innerMuzzle←fur lightened, socks←accent, innerEar←skin, tailTip←accent),
     * which is exactly the appearance a definition written before these regions
     * existed produces. Emitting nulls instead would freeze that derivation into
     * every stored character.
     *
     * <p>Twin of {@code char3d_config.gd}'s EXTENDED_MATERIAL_REGIONS and the
     * frontend's EXTENDED_MATERIAL_REGIONS — keep the three in lockstep.
     */
    public static final List<String> EXTENDED_MATERIAL_KEYS = List.of(
            "innerMuzzle", "socks", "innerEar", "tailTip");

    /**
     * The ONE canonical palette for a material region a definition never set. A
     * stored definition may legitimately carry {@code null} for a region (unset),
     * and every renderer resolves that against its own copy of this table — the
     * Angular editor ({@code char3d-config.ts} {@code DEFAULT_MATERIALS}), the Godot
     * maker ({@code char3d_config.gd} {@code DEFAULT_MATERIALS}) and the XR room.
     * The three copies disagreed on {@code accent}/{@code detail}/{@code iris}, so ONE
     * character rendered in three different colour schemes depending on which surface
     * drew it; they are now pinned equal by the shared contract fixture
     * ({@code frontend/src/app/character-forge/contract/server-contract.fixtures.json},
     * asserted from {@code ClientContractFixturesTest}, the karma
     * {@code server-contract.spec.ts} and the Godot {@code run_tests.gd}).
     *
     * <p>{@link VnMapService} fills these in so {@code /map} output always carries the
     * full seven-region palette DESIGN §2 specifies ({@code "materials": {"fur":
     * "#hex", …}} — no nulls in the mapping surface).
     */
    public static final java.util.Map<String, String> DEFAULT_MATERIALS = java.util.Map.of(
            "fur", "#8b5a2b", "accent", "#d2b48c", "detail", "#4a3728", "line", "#2f2f2f",
            "iris", "#00bcd4", "skin", "#ffdbac", "hair", "#563d2d");

    // ── bounds ──────────────────────────────────────────────────────────

    /** Hex colour allowlist (3-8 hex digits — #rgb/#rgba/#rrggbb/#rrggbbaa). */
    public static final String HEX_PATTERN = "^#[0-9a-fA-F]{3,8}$";

    /** Bounded part/slot id (the studio asset-CI caps ids at 64 chars). */
    public static final String PART_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";

    /** Bounded short descriptor (head.variant / earStyle / hornStyle, ≤40). */
    public static final String SHORT_STR_PATTERN = "^[A-Za-z0-9 _-]{1,40}$";

    /** Bounded lower-slug key (source slot / palette region names, ≤40). */
    public static final String KEY_PATTERN = "^[a-z0-9_-]{1,40}$";

    /** Display-name cap (matches the VN character name cap). */
    public static final int MAX_NAME_LENGTH = 120;

    /** Whole-definition serialized-size cap (bytes, UTF-8). */
    public static final int MAX_DEFINITION_BYTES = 16 * 1024;

    /** Source-echo caps (the studio pack caps: ≤24 slots/pack, small palettes). */
    public static final int MAX_SOURCE_SLOTS = 24;
    public static final int MAX_SOURCE_PALETTE = 16;

    private static final Pattern HEX = Pattern.compile(HEX_PATTERN);
    private static final Pattern PART_ID = Pattern.compile(PART_ID_PATTERN);
    private static final Pattern SHORT_STR = Pattern.compile(SHORT_STR_PATTERN);
    private static final Pattern KEY = Pattern.compile(KEY_PATTERN);

    private static final Set<String> ROOT_KEYS = Set.of(
            "schemaVersion", "name", "source", "body", "head", "parts", "materials", "style");
    private static final Set<String> SOURCE_KEYS = Set.of(
            "packId", "slots", "palette", "defaultExpression");
    private static final Set<String> BODY_KEYS = Set.of("archetype", "build", "height");
    private static final Set<String> HEAD_KEYS = Set.of(
            "family", "variant", "snoutLength", "earStyle", "hornStyle");
    /** Every admissible materials key: the seven canonical + the four extended. */
    private static final Set<String> ALL_MATERIAL_KEYS = Set.copyOf(
            java.util.stream.Stream.concat(MATERIAL_KEYS.stream(), EXTENDED_MATERIAL_KEYS.stream())
                    .toList());

    /** Plain shared mapper — used ONLY for node building/serialization (thread-safe). */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Validate + canonicalize a Char3DConfig definition. This is the ONLY path to the
     * stored {@code definition} column.
     *
     * @param root the client-supplied definition JSON
     * @return the canonical, clamped, defaults-applied form (see class doc)
     * @throws ApiException 400 with a field-precise message on any violation
     */
    public static ObjectNode validate(JsonNode root) {
        if (root == null || root.isNull() || !root.isObject()) {
            throw bad("definition must be a JSON object");
        }
        byte[] raw = root.toString().getBytes(StandardCharsets.UTF_8);
        if (raw.length > MAX_DEFINITION_BYTES) {
            throw bad("definition exceeds the " + MAX_DEFINITION_BYTES + "-byte cap");
        }
        rejectUnknownKeys(root, ROOT_KEYS, "definition");

        ObjectNode out = MAPPER.createObjectNode();

        // schemaVersion — required, must be the integer 1.
        JsonNode sv = root.get("schemaVersion");
        if (sv == null || !sv.isInt() || sv.intValue() != 1) {
            throw bad("definition.schemaVersion must be the integer 1");
        }
        out.put("schemaVersion", 1);

        // name — optional display string ≤120 (control characters rejected).
        String name = optionalName(root.get("name"), "definition.name");
        if (name != null) {
            out.put("name", name);
        }

        // source — the optional VN-character echo.
        JsonNode source = root.get("source");
        if (source != null && !source.isNull()) {
            out.set("source", validateSource(source));
        }

        // body — required.
        out.set("body", validateBody(requireObject(root.get("body"), "definition.body")));

        // head — required.
        out.set("head", validateHead(requireObject(root.get("head"), "definition.head")));

        // parts — optional; canonical form always carries all seven keys.
        out.set("parts", validateParts(root.get("parts")));

        // materials — optional; canonical form always carries all seven keys.
        out.set("materials", validateMaterials(root.get("materials")));

        // style — required enum.
        out.put("style", requireEnum(root.get("style"), STYLES, "definition.style"));

        return out;
    }

    /** The canonical serialized text of a validated definition — what the
     *  {@code jsonb} column stores (compact, fixed key order → deterministic). */
    public static String canonicalJson(ObjectNode canonical) {
        return canonical.toString();
    }

    // ── section validators ──────────────────────────────────────────────

    private static ObjectNode validateSource(JsonNode source) {
        if (!source.isObject()) {
            throw bad("definition.source must be a JSON object");
        }
        rejectUnknownKeys(source, SOURCE_KEYS, "definition.source");
        ObjectNode out = MAPPER.createObjectNode();

        // packId — required inside a source echo, one of the shipped packs.
        out.put("packId", requireEnum(source.get("packId"), PACK_IDS, "definition.source.packId"));

        JsonNode slots = source.get("slots");
        if (slots != null && !slots.isNull()) {
            if (!slots.isObject()) {
                throw bad("definition.source.slots must be a JSON object");
            }
            if (slots.size() > MAX_SOURCE_SLOTS) {
                throw bad("definition.source.slots exceeds " + MAX_SOURCE_SLOTS + " entries");
            }
            ObjectNode outSlots = MAPPER.createObjectNode();
            for (Iterator<String> it = slots.fieldNames(); it.hasNext(); ) {
                String slot = it.next();
                if (!KEY.matcher(slot).matches()) {
                    throw bad("definition.source.slots key '" + slot + "' is not a valid slot name");
                }
                JsonNode v = slots.get(slot);
                if (v.isNull()) {
                    outSlots.putNull(slot);
                } else if (v.isTextual() && PART_ID.matcher(v.textValue()).matches()) {
                    outSlots.put(slot, v.textValue());
                } else {
                    throw bad("definition.source.slots['" + slot + "'] must be a part id or null");
                }
            }
            out.set("slots", outSlots);
        }

        JsonNode palette = source.get("palette");
        if (palette != null && !palette.isNull()) {
            if (!palette.isObject()) {
                throw bad("definition.source.palette must be a JSON object");
            }
            if (palette.size() > MAX_SOURCE_PALETTE) {
                throw bad("definition.source.palette exceeds " + MAX_SOURCE_PALETTE + " entries");
            }
            ObjectNode outPalette = MAPPER.createObjectNode();
            for (Iterator<String> it = palette.fieldNames(); it.hasNext(); ) {
                String region = it.next();
                if (!KEY.matcher(region).matches()) {
                    throw bad("definition.source.palette key '" + region + "' is not a valid region name");
                }
                JsonNode v = palette.get(region);
                if (!v.isTextual() || !HEX.matcher(v.textValue()).matches()) {
                    throw bad("definition.source.palette['" + region + "'] must match " + HEX_PATTERN);
                }
                outPalette.put(region, v.textValue());
            }
            out.set("palette", outPalette);
        }

        JsonNode expr = source.get("defaultExpression");
        if (expr != null && !expr.isNull()) {
            out.put("defaultExpression",
                    requireEnum(expr, EXPRESSIONS, "definition.source.defaultExpression"));
        }
        return out;
    }

    private static ObjectNode validateBody(JsonNode body) {
        rejectUnknownKeys(body, BODY_KEYS, "definition.body");
        ObjectNode out = MAPPER.createObjectNode();
        out.put("archetype", requireEnum(body.get("archetype"), FAMILIES, "definition.body.archetype"));
        out.put("build", clampedNumber(body.get("build"), 0.0, 1.0, 0.5, "definition.body.build"));
        out.put("height", clampedNumber(body.get("height"), 0.5, 1.5, 1.0, "definition.body.height"));
        return out;
    }

    private static ObjectNode validateHead(JsonNode head) {
        rejectUnknownKeys(head, HEAD_KEYS, "definition.head");
        ObjectNode out = MAPPER.createObjectNode();
        out.put("family", requireEnum(head.get("family"), FAMILIES, "definition.head.family"));
        // variant is ALWAYS present, "" = unset (DESIGN §2 declares it a plain
        // "str ≤40", and all three client mirrors carry the key unconditionally).
        // Omitting it made head's key set input-dependent, so no client could produce
        // the canonical form byte-for-byte. Idempotent: "" re-validates to "".
        String variant = optionalShortStr(head.get("variant"), "definition.head.variant");
        out.put("variant", variant == null ? "" : variant);
        out.put("snoutLength",
                clampedNumber(head.get("snoutLength"), 0.0, 1.0, 0.5, "definition.head.snoutLength"));
        String earStyle = optionalShortStr(head.get("earStyle"), "definition.head.earStyle");
        out.put("earStyle", earStyle);         // null stays null (unset)
        String hornStyle = optionalShortStr(head.get("hornStyle"), "definition.head.hornStyle");
        out.put("hornStyle", hornStyle);
        return out;
    }

    private static ObjectNode validateParts(JsonNode parts) {
        ObjectNode out = MAPPER.createObjectNode();
        if (parts != null && !parts.isNull()) {
            if (!parts.isObject()) {
                throw bad("definition.parts must be a JSON object");
            }
            rejectUnknownKeys(parts, Set.copyOf(PART_KEYS), "definition.parts");
        }
        for (String key : PART_KEYS) {
            JsonNode v = parts == null || parts.isNull() ? null : parts.get(key);
            if (v == null || v.isNull()) {
                out.putNull(key);
            } else if (v.isTextual() && PART_ID.matcher(v.textValue()).matches()) {
                out.put(key, v.textValue());
            } else {
                throw bad("definition.parts." + key + " must be a part id matching "
                        + PART_ID_PATTERN + " or null");
            }
        }
        return out;
    }

    private static ObjectNode validateMaterials(JsonNode materials) {
        ObjectNode out = MAPPER.createObjectNode();
        boolean present = materials != null && !materials.isNull();
        if (present) {
            if (!materials.isObject()) {
                throw bad("definition.materials must be a JSON object");
            }
            rejectUnknownKeys(materials, ALL_MATERIAL_KEYS, "definition.materials");
        }
        for (String key : MATERIAL_KEYS) {
            JsonNode v = present ? materials.get(key) : null;
            if (v == null || v.isNull()) {
                out.putNull(key);
            } else if (v.isTextual() && HEX.matcher(v.textValue()).matches()) {
                out.put(key, v.textValue());
            } else {
                throw bad("definition.materials." + key + " must match " + HEX_PATTERN + " or be null");
            }
        }
        // Extended coat blocks are validated identically but kept OPTIONAL: only a
        // supplied one is stored, so "unset" stays distinguishable from "black".
        for (String key : EXTENDED_MATERIAL_KEYS) {
            JsonNode v = present ? materials.get(key) : null;
            if (v == null || v.isNull()) {
                continue;
            }
            if (v.isTextual() && HEX.matcher(v.textValue()).matches()) {
                out.put(key, v.textValue());
            } else {
                throw bad("definition.materials." + key + " must match " + HEX_PATTERN + " or be null");
            }
        }
        return out;
    }

    // ── primitives ──────────────────────────────────────────────────────

    private static void rejectUnknownKeys(JsonNode node, Set<String> allowed, String path) {
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            String key = it.next();
            if (!allowed.contains(key)) {
                throw bad(path + " carries unknown key '" + key + "'");
            }
        }
    }

    private static JsonNode requireObject(JsonNode node, String path) {
        if (node == null || node.isNull() || !node.isObject()) {
            throw bad(path + " is required and must be a JSON object");
        }
        return node;
    }

    private static String requireEnum(JsonNode node, List<String> allowed, String path) {
        if (node == null || !node.isTextual() || !allowed.contains(node.textValue())) {
            throw bad(path + " must be one of " + allowed);
        }
        return node.textValue();
    }

    /** Numeric field: absent/null → the default; a NUMBER clamps into [min, max];
     *  any other type → 400 (clamping is for range, never for type confusion). */
    private static double clampedNumber(JsonNode node, double min, double max,
                                        double dflt, String path) {
        if (node == null || node.isNull()) {
            return dflt;
        }
        if (!node.isNumber()) {
            throw bad(path + " must be a number");
        }
        double v = node.doubleValue();
        if (Double.isNaN(v)) {
            throw bad(path + " must be a number");
        }
        return Math.min(max, Math.max(min, v));
    }

    private static String optionalName(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw bad(path + " must be a string");
        }
        return displayName(node.textValue(), path);
    }

    /**
     * The display-name rule for EVERY user-authored name this service stores — the
     * {@code definition.name} inside a config AND the row-level {@code name} column
     * ({@code CharacterForgeService.create/update}).
     *
     * <p><b>Why the row name goes through the same gate.</b> {@code POST
     * /characters/lookup} hands one member's row {@code name} to every other member of
     * the brand alongside the config ({@code CharacterForgeService#toEntry}), and this
     * surface deliberately has NO admin/moderation seam — the stated justification
     * (DESIGN §3, {@code SecurityConfig}) is that everything served here is bounded,
     * server-validated data. That justification only held for {@code definition}: the
     * row name was {@code @NotBlank @Size(max=120)} and nothing else, so it could carry
     * a U+202E RIGHT-TO-LEFT OVERRIDE (visually reversing a neighbouring participant's
     * handle in a shared XR roster), zero-width joiners, or embedded line breaks, with
     * no takedown path. Both names now reject the invisible/bidi/control set outright.
     *
     * @throws ApiException 400 when the value is over-long, blank, or carries a
     *                      forbidden code point
     */
    public static String displayName(String raw, String path) {
        if (raw == null) {
            throw bad(path + " is required");
        }
        if (raw.length() > MAX_NAME_LENGTH) {
            throw bad(path + " exceeds " + MAX_NAME_LENGTH + " characters");
        }
        for (int i = 0; i < raw.length(); ) {
            int cp = raw.codePointAt(i);
            if (isForbiddenNameCodePoint(cp)) {
                throw bad(path + " must not contain control, bidirectional-override or "
                        + "other invisible formatting characters (U+"
                        + String.format("%04X", cp) + ")");
            }
            i += Character.charCount(cp);
        }
        if (raw.isBlank()) {
            throw bad(path + " must not be blank");
        }
        return raw;
    }

    /**
     * True for a code point no display name may carry: C0/C1 controls ({@code Cc}),
     * every Unicode FORMAT code point ({@code Cf} — U+202E RIGHT-TO-LEFT OVERRIDE, the
     * U+2066..U+2069 isolates, U+200B..U+200F, U+FEFF, the tag block, …) and the line /
     * paragraph separators ({@code Zl}/{@code Zp}). Mirrored character-for-character by
     * {@code char3d-config.ts} {@code FORBIDDEN_NAME_CHARS} and
     * {@code char3d_config.gd} {@code is_forbidden_name_char}; the sample set is pinned
     * cross-language in the shared contract fixture
     * ({@code serverContract.forbiddenNameCodePoints}).
     */
    static boolean isForbiddenNameCodePoint(int cp) {
        int type = Character.getType(cp);
        return type == Character.CONTROL
                || type == Character.FORMAT
                || type == Character.LINE_SEPARATOR
                || type == Character.PARAGRAPH_SEPARATOR;
    }

    /**
     * Optional short descriptor ({@code head.variant} / {@code earStyle} /
     * {@code hornStyle}): absent, {@code null} <b>or BLANK</b> → unset.
     *
     * <p>Blank-is-unset is load-bearing, not leniency. All three shipped clients
     * encode "no variant" as the empty string — the Angular editor's free-text box
     * ({@code char3d-config.ts} {@code variant: ''}), the Godot maker
     * ({@code char3d_config.gd} {@code defaults()}), and anything built on either.
     * {@value #SHORT_STR_PATTERN} has a minimum length of 1, so rejecting {@code ""}
     * made the primary save path ({@code POST /characters} with the frontend's own
     * {@code defaultChar3dConfig()}) a guaranteed 400 and nothing could ever be
     * stored, activated or looked up. The value is stripped and dropped when empty,
     * which matches the Godot mirror's {@code _opt_str} exactly; a non-blank value
     * still has to match the pattern, so the vocabulary stays as bounded as before.
     */
    private static String optionalShortStr(JsonNode node, String path) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isTextual()) {
            throw bad(path + " must match " + SHORT_STR_PATTERN + " or be null");
        }
        String s = node.textValue().strip();
        if (s.isEmpty()) {
            return null;                       // "" / blank = UNSET (all three clients' encoding)
        }
        if (!SHORT_STR.matcher(s).matches()) {
            throw bad(path + " must match " + SHORT_STR_PATTERN + " or be null");
        }
        return s;
    }

    private static ApiException bad(String message) {
        return ApiException.badRequest(message);
    }
}
