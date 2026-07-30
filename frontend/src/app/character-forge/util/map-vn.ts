import { VnCharacter } from '../models/vn-character';
import { PartManifest } from '../models/vn-manifest';
import {
  BODY_ARCHETYPES,
  BodyArchetype,
  Char3dConfig,
  EXPRESSIONS,
  HEAD_FAMILIES,
  HeadFamily,
  MATERIAL_REGIONS,
  PART_SLOTS,
  SAFE_ID,
  SOURCE_PACK_IDS,
  normalizeChar3dConfig,
} from '../models/char3d-config';
import { PART_ARCHETYPE_INDEX } from '../models/part-archetypes';

/** The anime pack maps to humanoid + 'anime' style (kemonomimi rule, §2). */
const ANIME_PACK = 'anime-v1';
/** SRD taxonomy pack maps to the 'classic' style (§2). */
const SRD_PACK = 'srd-taxonomy-v1';

/**
 * Per-family default snout length — a VERBATIM mirror of the BFF's
 * `VnMapService.SNOUT_BY_FAMILY` (29 entries). It used to be a two-value constant
 * (`humanoid ? 0.1 : 0.5`), so the same wolf came out mid-snouted locally and
 * long-snouted from the server. Families absent here fall back to 0.5 on BOTH
 * sides. Pinned equal by `contract/server-contract.spec.ts` against the shared
 * fixture.
 */
export const SNOUT_BY_FAMILY: Readonly<Record<string, number>> = {
  humanoid: 0.05, slime: 0.15, moth: 0.2, insect: 0.25, robot: 0.3, synth: 0.3,
  amphibian: 0.3, bat: 0.35, felid: 0.35, lapine: 0.35, rodent: 0.4, suid: 0.45,
  procyonid: 0.45, ursine: 0.45, canid: 0.55, caprine: 0.55, hyena: 0.5,
  mustelid: 0.5, macropod: 0.5, aquatic: 0.5, avian: 0.6, gryphon: 0.55,
  kobold: 0.5, reptile: 0.5, cervine: 0.6, bovine: 0.6, dino: 0.6, dragon: 0.6,
  equine: 0.7,
};

/** The BFF's `VnMapService#sanitizedPartId` — a well-formed bounded partId or null
 *  (tolerant drop, never an error). Without this the mirror would carry e.g.
 *  `"ears lop"` into `head.earStyle`, which the space-tolerant short-string pattern
 *  accepts but the server's part-id gate drops to null. */
function sanitizedPartId(v: unknown): string | null {
  return typeof v === 'string' && SAFE_ID.test(v) ? v : null;
}

/** The BFF's `VnMapService#shortened` — the ≤40 short-string bound. */
function shortened(partId: string | null): string | null {
  if (partId === null) {
    return null;
  }
  return partId.length <= 40 ? partId : partId.slice(0, 40);
}

/** The BFF's `VnMapService#hornFeature` — a feature partId is a horn style iff it
 *  names a horn or an antler. */
function hornFeature(featurePartId: string | null): string | null {
  if (featurePartId === null) {
    return null;
  }
  const lower = featurePartId.toLowerCase();
  return lower.includes('horn') || lower.includes('antler') ? featurePartId : null;
}

/**
 * Look up a head/body part's headArchetype the way the BFF does: (1) a
 * caller-supplied pack manifest (authoritative — the offline stand-in for the
 * server's vendored manifest), (2) the vendored {@link PART_ARCHETYPE_INDEX}
 * extracted from the four shipped studio packs — the SAME data the BFF's
 * `VnPackManifests` parses.
 *
 * A partId token scan is used ONLY for a pack neither source knows. The server
 * REJECTS an unknown packId outright (400), so there is no server behaviour to
 * mirror there; the scan keeps the offline "preview a custom pack" path useful
 * without making the four shipped packs disagree with `/map`.
 */
function archetypeOf(
  packId: string,
  partId: string | null | undefined,
  slot: 'head' | 'body',
  manifest?: PartManifest,
): string | null {
  if (!partId) {
    return null;
  }
  if (manifest && manifest.packId === packId) {
    const fromManifest = manifest.slots
      .find(s => s.slot === slot)
      ?.parts.find(p => p.id === partId)?.headArchetype;
    if (fromManifest) {
      return fromManifest;
    }
  }
  const pack = PART_ARCHETYPE_INDEX[packId];
  const fromIndex = pack?.[slot]?.[partId];
  if (fromIndex) {
    return fromIndex;
  }
  if (pack) {
    // A KNOWN pack: the vendored index is complete, and so is the server's
    // manifest — an id it does not carry resolves to nothing on both sides.
    return null;
  }
  const tokens = partId.toLowerCase().split(/[^a-z]+/);
  for (const candidate of [...BODY_ARCHETYPES, 'humanoid', 'kobold']) {
    if (tokens.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function asHeadFamily(archetype: string | null): HeadFamily | null {
  return archetype && (HEAD_FAMILIES as readonly string[]).includes(archetype)
    ? (archetype as HeadFamily)
    : null;
}

function asBodyArchetype(archetype: string | null): BodyArchetype | null {
  return archetype && (BODY_ARCHETYPES as readonly string[]).includes(archetype)
    ? (archetype as BodyArchetype)
    : null;
}

/**
 * Map a VN character (the studio's replayable definition) to a Char3DConfig —
 * the CLIENT-SIDE MIRROR of the BFF's `POST /bff/character-forge/map` pure
 * function (§2 mapping rules; the server stays authoritative). For any of the four
 * shipped packs the two implementations must return the SAME config; that equality
 * is pinned case-by-case by the shared fixture (`contract/server-contract.fixtures.json`
 * → `vnMapCases`), asserted from `contract/server-contract.spec.ts` here and from
 * `VnMapServiceTest` on the server.
 *
 * Keys off the stable VN parameterization only (packId, partId, headArchetype,
 * palette regions) — never SVG geometry:
 *
 * - `slots.head`'s partId → its headArchetype → `head.family` (+ the partId as
 *   `head.variant`); the fallback chain is head-part lookup → BODY-part lookup →
 *   `humanoid`. Kemonomimi heads carry `headArchetype: humanoid` in the anime-v1
 *   manifest, so they land on humanoid with ears/tail as parts — no special case.
 * - `slots.body` → `body.archetype`, falling back to the RESOLVED HEAD FAMILY (not
 *   to `humanoid`, which used to give every VN import a human body).
 * - `slots.{tail,wings,ears,markings,feature,accessory,hair}` → `parts.*`.
 * - palette regions → materials 1:1; a region the palette does not name gets the
 *   canonical default (DESIGN §2 materials are seven plain hexes).
 * - `head.snoutLength` from {@link SNOUT_BY_FAMILY}; `earStyle` echoes the ears
 *   partId for EVERY pack; `hornStyle` echoes a horn/antler feature partId.
 * - anime-v1 → style 'anime'; srd-taxonomy → 'classic'; else 'toon'.
 *
 * The result is passed through {@link normalizeChar3dConfig} so the output is
 * ALWAYS a valid, clamped config regardless of how hostile the input was.
 */
export function mapVnToChar3d(vn: VnCharacter, manifest?: PartManifest): Char3dConfig {
  const packId = typeof vn?.packId === 'string' ? vn.packId : '';
  const slots = vn?.slots ?? {};
  const palette = vn?.palette ?? {};

  const headPartId = sanitizedPartId(slots['head']);
  const bodyPartId = sanitizedPartId(slots['body']);

  // head.family: head-part lookup → body-part lookup → humanoid (the BFF's chain).
  const family: HeadFamily =
    asHeadFamily(archetypeOf(packId, headPartId, 'head', manifest))
    ?? asHeadFamily(archetypeOf(packId, bodyPartId, 'body', manifest))
    ?? 'humanoid';
  // body.archetype: body-part lookup → the RESOLVED head family.
  const bodyArchetype: BodyArchetype =
    asBodyArchetype(archetypeOf(packId, bodyPartId, 'body', manifest))
    ?? (family as string as BodyArchetype);

  const parts: Record<string, string | null> = {};
  for (const slot of PART_SLOTS) {
    parts[slot] = slots[slot] ?? null;
  }

  const materials: Record<string, unknown> = {};
  for (const region of MATERIAL_REGIONS) {
    if (typeof palette[region] === 'string') {
      materials[region] = palette[region];
    }
  }

  const defaultExpression = (EXPRESSIONS as readonly string[]).includes(vn?.defaultExpression ?? '')
    ? vn.defaultExpression
    : 'neutral';

  // The source echo only survives for a pack the SERVER would accept; for anything
  // else normalizeChar3dConfig drops it (an echo with a foreign packId is a 400).
  const source = (SOURCE_PACK_IDS as readonly string[]).includes(packId)
    ? { packId, slots: { ...slots }, palette: { ...palette }, defaultExpression }
    : undefined;

  return normalizeChar3dConfig({
    schemaVersion: 1,
    name: vn?.name ?? 'Untitled',
    ...(source ? { source } : {}),
    body: {
      archetype: bodyArchetype,
      build: 0.5,
      height: 1.0,
    },
    head: {
      family,
      variant: shortened(headPartId) ?? '',
      snoutLength: SNOUT_BY_FAMILY[family] ?? 0.5,
      earStyle: shortened(sanitizedPartId(slots['ears'])),
      hornStyle: shortened(hornFeature(sanitizedPartId(slots['feature']))),
    },
    parts,
    materials,
    style: packId === ANIME_PACK ? 'anime' : packId === SRD_PACK ? 'classic' : 'toon',
  });
}
