/**
 * Char3DConfig v1 — the SVG→3D mapping surface (DESIGN CONTRACT §2). This is
 * the client-side MIRROR of the server-side validation the character-forge BFF
 * applies to every stored/looked-up definition: reject unknown keys, clamp
 * numerics, regex hexes, enum-check families/styles, cap the definition JSON at
 * 16KB. The BFF is authoritative; this mirror keeps the editor honest (what you
 * preview is what the server will accept) and lets the import-from-VN flow work
 * offline. Twin of the BFF's Char3dConfig validator — keep the two in lockstep.
 *
 * "What you preview is what the server will accept" is a TESTED claim, not a
 * comment: every pattern/cap/vocabulary below is asserted equal to the real
 * `Char3DConfigValidator` constant, and every payload this file can produce is fed
 * to the real validator, through the shared cross-language fixture
 * `contract/server-contract.fixtures.json` (karma half: `contract/server-contract.spec.ts`;
 * Java half: `ClientContractFixturesTest`). It shipped false once — the mirror
 * emitted `head.variant: ''`, `source.packId` outside the four-pack enum, uppercase
 * source keys and free-text `earStyle`, all of which the server 400s on, so the
 * primary save path could not succeed at all.
 */

/** The 27 menagerie head archetypes (extracted from menagerie-v1/pack.json). */
export const MENAGERIE_ARCHETYPES = [
  'amphibian', 'aquatic', 'avian', 'bat', 'bovine', 'canid', 'caprine',
  'cervine', 'dino', 'dragon', 'equine', 'felid', 'gryphon', 'hyena', 'insect',
  'lapine', 'macropod', 'moth', 'mustelid', 'procyonid', 'reptile', 'robot',
  'rodent', 'slime', 'suid', 'synth', 'ursine',
] as const;

/** head.family — the §2 enum (27 menagerie archetypes + kobold + humanoid). */
export const HEAD_FAMILIES = [
  'canid', 'felid', 'avian', 'reptile', 'dragon', 'dino', 'kobold', 'gryphon',
  'equine', 'cervine', 'bovine', 'caprine', 'suid', 'hyena', 'lapine',
  'rodent', 'macropod', 'moth', 'insect', 'bat', 'ursine', 'mustelid',
  'procyonid', 'amphibian', 'aquatic', 'slime', 'robot', 'synth', 'humanoid',
] as const;
export type HeadFamily = (typeof HEAD_FAMILIES)[number];

/**
 * body.archetype — the SAME 29-value vocabulary as `head.family`. The server
 * enum-checks both against one list (`Char3DConfigValidator.FAMILIES`), so a
 * 28-value client list that omitted `kobold` silently rewrote a legitimate
 * `body.archetype: 'kobold'` (which `/map` emits whenever a kobold head has no
 * body part) to `humanoid` on load.
 */
export const BODY_ARCHETYPES = HEAD_FAMILIES;
export type BodyArchetype = (typeof BODY_ARCHETYPES)[number];

export const FORGE_STYLES = ['anime', 'toon', 'classic'] as const;
export type ForgeStyle = (typeof FORGE_STYLES)[number];

/** The seven §2 part attachment slots (VN partId passthrough, id|null). */
export const PART_SLOTS = [
  'tail', 'wings', 'ears', 'feature', 'accessory', 'markings', 'hair',
] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

/** The seven §2 material regions — same region names as the SVG palette, 1:1. */
export const MATERIAL_REGIONS = [
  'fur', 'accent', 'detail', 'line', 'iris', 'skin', 'hair',
] as const;
export type MaterialRegion = (typeof MATERIAL_REGIONS)[number];

/**
 * The four EXTENDED coat-block regions (kemono.md's colour masks: lighter
 * inner-muzzle + chest, socks/gloves, inner ear, tail tip). The maker renders
 * all eleven regions and the BFF accepts these four as OPTIONAL keys.
 *
 * Optional is load-bearing: an absent region means "derive it" and the maker
 * derives it (innerMuzzle←fur lightened, socks←accent, innerEar←skin,
 * tailTip←accent). Writing a value here pins it; clearing it hands the region
 * back to the derivation. Twin of char3d_config.gd's EXTENDED_MATERIAL_REGIONS
 * and Char3DConfigValidator.EXTENDED_MATERIAL_KEYS.
 */
export const EXTENDED_MATERIAL_REGIONS = [
  'innerMuzzle', 'socks', 'innerEar', 'tailTip',
] as const;
export type ExtendedMaterialRegion = (typeof EXTENDED_MATERIAL_REGIONS)[number];

/** Every region the palette strip has a cell for (canonical + extended). */
export const ALL_MATERIAL_REGIONS = [
  ...MATERIAL_REGIONS, ...EXTENDED_MATERIAL_REGIONS,
] as const;
export type AnyMaterialRegion = MaterialRegion | ExtendedMaterialRegion;

/**
 * Which canonical region an unset extended block derives from — mirrors
 * CharForgePalette.DERIVED_FROM so the UI can show the colour the maker will
 * actually use instead of an empty swatch.
 */
export const EXTENDED_DERIVED_FROM: Readonly<Record<ExtendedMaterialRegion, MaterialRegion>> = {
  innerMuzzle: 'fur',
  socks: 'accent',
  innerEar: 'skin',
  tailTip: 'accent',
};

/**
 * The canonical 10-expression vocabulary — twin of user-bff's
 * StickerExpression.java / matrix-ui's vn/expression.ts (MSC2545 shortcodes).
 */
export const EXPRESSIONS = [
  'neutral', 'happy', 'sad', 'angry', 'surprised', 'embarrassed', 'thinking',
  'wink', 'sleepy', 'smug',
] as const;
export type ForgeExpression = (typeof EXPRESSIONS)[number];

/** The four VN packs a `source` echo may reference — `Char3DConfigValidator.PACK_IDS`.
 *  The server ENUM-checks this, so a mirror that admits any token produces configs
 *  that 400 on save. */
export const SOURCE_PACK_IDS = [
  'menagerie-v1', 'anime-v1', 'base-anthro-v1', 'srd-taxonomy-v1',
] as const;
export type SourcePackId = (typeof SOURCE_PACK_IDS)[number];

/** Server-side hex validation regex (§3): `^#[0-9a-fA-F]{3,8}$`. */
export const SAFE_HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Server-side cap on the definition JSON (§3): 16KB. */
export const MAX_DEFINITION_BYTES = 16384;

export const MAX_NAME_LENGTH = 120;
export const MAX_VARIANT_LENGTH = 40;
export const MAX_STYLE_STRING_LENGTH = 40;
/** Part ids are pack asset ids — the studio's asset gate caps ids at 64 chars. */
export const MAX_PART_ID_LENGTH = 64;
/** `Char3DConfigValidator.PART_ID_PATTERN` — `parts.*` and `source.slots` VALUES. */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** `Char3DConfigValidator.SHORT_STR_PATTERN` — `head.variant`/`earStyle`/`hornStyle`.
 *  NOTE the space: these are short descriptors, not ids. Anything else (punctuation,
 *  markup, newlines) is a hard 400 server-side. */
export const SAFE_SHORT_STR = /^[A-Za-z0-9 _-]{1,40}$/;
/** `Char3DConfigValidator.KEY_PATTERN` — `source.slots`/`source.palette` KEY names.
 *  Lower-slug ONLY: an uppercase key is a 400, not a clamp. */
export const SAFE_KEY = /^[a-z0-9_-]{1,40}$/;
/** `Char3DConfigValidator.MAX_SOURCE_SLOTS` / `MAX_SOURCE_PALETTE`. */
export const MAX_SOURCE_SLOTS = 24;
export const MAX_SOURCE_PALETTE = 16;

/**
 * Code points no display name may carry — `Cc` (controls), `Cf` (formatting: U+202E
 * RIGHT-TO-LEFT OVERRIDE, the U+2066..U+2069 isolates, U+200B..U+200F, U+FEFF, the
 * tag block …) and the `Zl`/`Zp` separators. The server REJECTS them outright
 * (`Char3DConfigValidator.isForbiddenNameCodePoint`), so the mirror strips them
 * before anything is sent; they are also the characters that let one member's name
 * visually rewrite a neighbour's handle in a shared XR roster.
 */
export const FORBIDDEN_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Optional echo of the VN character a config was mapped from (§2 source). */
export interface Char3dSource {
  packId: SourcePackId;
  slots: Record<string, string | null>;
  palette: Record<string, string>;
  defaultExpression: ForgeExpression;
}

export interface Char3dBody {
  archetype: BodyArchetype;
  /** 0.0–1.0 */
  build: number;
  /** 0.5–1.5 */
  height: number;
  /**
   * 0.0–1.0 — hip-to-waist ratio, ORTHOGONAL to `build` (which is overall
   * mass/width). 0.5 is not merely the default: it is defined to reproduce the
   * pre-axis silhouette exactly, because every already-stored definition
   * predates this key and this service has no migration mechanism (Liquibase
   * 001 only, definition is jsonb) — absent → 0.5 → unchanged rendering.
   */
  curve: number;
  /** 0.0–1.0 — chest volume. Same centring contract as {@link curve}. */
  top: number;
  /**
   * 0.0–1.0 — leg LENGTH. Same centring contract as {@link curve}: 0.5 is the
   * pre-axis silhouette exactly. The assembler keeps the foot on the ground and
   * lifts the hips (and everything above them) by the difference, so a longer
   * leg makes a taller character rather than one sunk into the floor.
   */
  legs: number;
  /** 0.0–1.0 — arm LENGTH. Grows downward from a fixed shoulder. */
  arms: number;
  /** 0.0–1.0 — limb GIRTH (arm/leg thickness), orthogonal to both lengths. */
  limb: number;
}

export interface Char3dHead {
  family: HeadFamily;
  /** ≤40 chars — typically the VN head partId the family was mapped from. */
  variant: string;
  /** 0.0–1.0 — drives snout scaling in the assembler. */
  snoutLength: number;
  earStyle: string | null;
  hornStyle: string | null;
}

export type Char3dParts = Record<PartSlot, string | null>;
/**
 * The seven canonical regions are always present; the four extended coat
 * blocks appear only when the character pins one (absent = maker-derived).
 */
export type Char3dMaterials = Record<MaterialRegion, string>
  & Partial<Record<ExtendedMaterialRegion, string>>;

/** Char3DConfig v1 (§2) — all fields server-validated/clamped. */
export interface Char3dConfig {
  schemaVersion: 1;
  name: string;
  source?: Char3dSource;
  body: Char3dBody;
  head: Char3dHead;
  parts: Char3dParts;
  materials: Char3dMaterials;
  style: ForgeStyle;
}

/** Default material hexes — the studio's neutral fur/accent scheme. */
export const DEFAULT_MATERIALS: Char3dMaterials = {
  fur: '#8b5a2b',
  accent: '#d2b48c',
  detail: '#4a3728',
  line: '#2f2f2f',
  iris: '#00bcd4',
  skin: '#ffdbac',
  hair: '#563d2d',
};

/** A fresh, valid default config (a plain toon canid). */
export function defaultChar3dConfig(): Char3dConfig {
  return {
    schemaVersion: 1,
    name: 'Untitled',
    body: {
      archetype: 'canid', build: 0.5, height: 1.0,
      // Every shape axis starts at its centred stop — the default body is
      // deliberately androgynous, and is a proportion set rather than a preset.
      curve: 0.5, top: 0.5, legs: 0.5, arms: 0.5, limb: 0.5,
    },
    head: { family: 'canid', variant: '', snoutLength: 0.5, earStyle: null, hornStyle: null },
    parts: { tail: null, wings: null, ears: null, feature: null, accessory: null, markings: null, hair: null },
    materials: { ...DEFAULT_MATERIALS },
    style: 'toon',
  };
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

/**
 * Display name clamped the way the server validates it: forbidden code points
 * STRIPPED (the server answers 400 on them), trimmed, capped at 120. A non-string
 * becomes the fallback; a string that cleans down to EMPTY stays empty — an empty
 * name box is a legitimate in-progress editor state, and the save path already
 * surfaces the server's `name must not be blank` rather than silently renaming the
 * user's character mid-keystroke.
 */
export function clampDisplayName(v: unknown, fallback = 'Untitled'): string {
  if (typeof v !== 'string') {
    return fallback;
  }
  return v.replace(FORBIDDEN_NAME_CHARS, '').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Optional SHORT descriptor (`head.variant` / `earStyle` / `hornStyle`). Truncate
 * FIRST (the server rejects >40) then require the whole remainder to match
 * `SAFE_SHORT_STR`; anything else is DROPPED rather than passed through, because the
 * server answers 400 — `"Lop-ears!"` typed into the free-text Ear style box used to
 * reach `POST /characters` verbatim and made the save impossible.
 */
function clampNullableStyleString(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const candidate = v.trim().slice(0, MAX_STYLE_STRING_LENGTH);
  return SAFE_SHORT_STR.test(candidate) ? candidate : null;
}

function clampPartId(v: unknown): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const candidate = v.trim();
  return SAFE_ID.test(candidate) ? candidate : null;
}

function clampEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function clampHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && SAFE_HEX.test(v) ? v : fallback;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * The `source` echo, clamped to what the server ACCEPTS (not merely to what looks
 * id-shaped):
 *
 * - `packId` is an **enum** server-side. An echo naming any other pack made the whole
 *   definition unsaveable (`definition.source.packId must be one of [...]` 400) with
 *   no way to clear it from the UI — such an echo is now DROPPED, so a config imported
 *   from an unknown/custom pack still saves, just without the round-trip echo.
 * - slot / palette KEYS must match the lower-slug `SAFE_KEY`; an uppercase key like
 *   `Head` is a 400, so it is dropped rather than echoed.
 * - a slot VALUE that is not a valid part id is dropped (an explicit `null` is kept —
 *   the server accepts null as "slot cleared").
 * - the `MAX_SOURCE_SLOTS` / `MAX_SOURCE_PALETTE` caps are enforced here too; the
 *   server 400s past them.
 */
function normalizeSource(v: unknown): Char3dSource | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  const src = asRecord(v);
  const rawPack = src['packId'];
  if (typeof rawPack !== 'string'
      || !(SOURCE_PACK_IDS as readonly string[]).includes(rawPack)) {
    return undefined;
  }
  const slots: Record<string, string | null> = {};
  const rawSlots = asRecord(src['slots']);
  for (const key of Object.keys(rawSlots)) {
    if (Object.keys(slots).length >= MAX_SOURCE_SLOTS || !SAFE_KEY.test(key)) {
      continue;
    }
    const rawValue = rawSlots[key];
    if (rawValue === null) {
      slots[key] = null;
      continue;
    }
    const partId = clampPartId(rawValue);
    if (partId !== null) {
      slots[key] = partId;
    }
  }
  const palette: Record<string, string> = {};
  const rawPalette = asRecord(src['palette']);
  for (const key of Object.keys(rawPalette)) {
    const hex = rawPalette[key];
    if (Object.keys(palette).length < MAX_SOURCE_PALETTE && SAFE_KEY.test(key)
        && typeof hex === 'string' && SAFE_HEX.test(hex)) {
      palette[key] = hex;
    }
  }
  return {
    packId: rawPack as SourcePackId,
    slots,
    palette,
    defaultExpression: clampEnum(src['defaultExpression'], EXPRESSIONS, 'neutral'),
  };
}

/**
 * Normalize an arbitrary (possibly hostile / hand-pasted) value into a valid
 * Char3DConfig — the client mirror of the BFF's server-side validation (§3):
 * unknown keys are DROPPED (the output is rebuilt field-by-field), numerics
 * clamped to their §2 ranges, hexes regex-checked (invalid → per-region
 * default), families/styles enum-checked, strings length-capped, part ids
 * token-checked (invalid → null). Never throws.
 */
export function normalizeChar3dConfig(input: unknown): Char3dConfig {
  const raw = asRecord(input);
  const rawBody = asRecord(raw['body']);
  const rawHead = asRecord(raw['head']);
  const rawParts = asRecord(raw['parts']);
  const rawMaterials = asRecord(raw['materials']);

  const parts = {} as Char3dParts;
  for (const slot of PART_SLOTS) {
    parts[slot] = clampPartId(rawParts[slot]);
  }
  const materials = {} as Char3dMaterials;
  for (const region of MATERIAL_REGIONS) {
    materials[region] = clampHex(rawMaterials[region], DEFAULT_MATERIALS[region]);
  }
  // Extended coat blocks: kept ONLY when supplied and valid. An invalid or
  // absent one is dropped rather than defaulted, so the maker keeps deriving it
  // (and the definition stays byte-identical to a pre-extension character).
  for (const region of EXTENDED_MATERIAL_REGIONS) {
    const raw = rawMaterials[region];
    if (typeof raw === 'string' && SAFE_HEX.test(raw)) {
      materials[region] = raw;
    }
  }

  const config: Char3dConfig = {
    schemaVersion: 1,
    name: clampDisplayName(raw['name']),
    body: {
      archetype: clampEnum(rawBody['archetype'], BODY_ARCHETYPES, 'humanoid'),
      build: clampNumber(rawBody['build'], 0, 1, 0.5),
      height: clampNumber(rawBody['height'], 0.5, 1.5, 1.0),
      // This function rebuilds the output FIELD BY FIELD, so a key that is not
      // listed here is silently dropped — that is exactly how a new axis
      // reaches the engine as `undefined` and reads as "the user never touched
      // it" while the editor shows a moved slider.
      curve: clampNumber(rawBody['curve'], 0, 1, 0.5),
      top: clampNumber(rawBody['top'], 0, 1, 0.5),
      legs: clampNumber(rawBody['legs'], 0, 1, 0.5),
      arms: clampNumber(rawBody['arms'], 0, 1, 0.5),
      limb: clampNumber(rawBody['limb'], 0, 1, 0.5),
    },
    head: {
      family: clampEnum(rawHead['family'], HEAD_FAMILIES, 'humanoid'),
      // '' is the mirror's UNSET encoding; the server treats blank as unset too.
      variant: clampNullableStyleString(rawHead['variant']) ?? '',
      snoutLength: clampNumber(rawHead['snoutLength'], 0, 1, 0.5),
      earStyle: clampNullableStyleString(rawHead['earStyle']),
      hornStyle: clampNullableStyleString(rawHead['hornStyle']),
    },
    parts,
    materials,
    style: clampEnum(raw['style'], FORGE_STYLES, 'toon'),
  };
  const source = normalizeSource(raw['source']);
  if (source) {
    config.source = source;
  }
  return config;
}

/**
 * The colour a region will actually RENDER as: the pinned hex when the config
 * has one, otherwise the maker's derivation (CharForgePalette.region_color).
 * innerMuzzle additionally lightens its base, matching the engine's
 * INNER_MUZZLE_LIGHTEN — the swatch has to show what the avatar shows.
 */
export function effectiveRegionColor(config: Char3dConfig, region: AnyMaterialRegion): string {
  const pinned = (config.materials as Record<string, string | undefined>)[region];
  if (typeof pinned === 'string' && SAFE_HEX.test(pinned)) {
    return pinned;
  }
  const base = EXTENDED_DERIVED_FROM[region as ExtendedMaterialRegion];
  if (!base) {
    return DEFAULT_MATERIALS[region as MaterialRegion] ?? '#ffffff';
  }
  const source = config.materials[base] ?? DEFAULT_MATERIALS[base];
  return region === 'innerMuzzle' ? lighten(source, INNER_MUZZLE_LIGHTEN) : source;
}

/** Engine twin: CharForgePalette.INNER_MUZZLE_LIGHTEN (palette.gd). */
export const INNER_MUZZLE_LIGHTEN = 0.45;

/** Godot's Color.lightened(amount): channel + (1 - channel) * amount. */
function lighten(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) {
    return hex;
  }
  const n = Number.parseInt(m[1], 16);
  const out = [16, 8, 0]
    .map(shift => (n >> shift) & 0xff)
    .map(c => Math.round(c + (255 - c) * amount))
    .map(c => c.toString(16).padStart(2, '0'))
    .join('');
  return `#${out}`;
}

/** UTF-8 byte size of the definition JSON (the §3 16KB cap's unit). */
export function definitionByteSize(config: Char3dConfig): number {
  return new TextEncoder().encode(JSON.stringify(config)).length;
}

/** True when the definition JSON fits the server's 16KB cap. */
export function definitionWithinCap(config: Char3dConfig): boolean {
  return definitionByteSize(config) <= MAX_DEFINITION_BYTES;
}
