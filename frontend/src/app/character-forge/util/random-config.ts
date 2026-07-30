import {
  BODY_ARCHETYPES,
  BodyArchetype,
  Char3dConfig,
  FORGE_STYLES,
  HEAD_FAMILIES,
  MATERIAL_REGIONS,
  PART_SLOTS,
  normalizeChar3dConfig,
} from '../models/char3d-config';
import { PART_SLOT_IDS } from '../models/part-archetypes';

/**
 * Curated palette the randomizer draws material colours from — VENDORED from
 * hugmesh-character-studio-ui src/app/character-studio/util/randomize.ts
 * (CURATED_COLORS) so 2D and 3D "surprise me" characters share one colour
 * language. All `#rrggbb`, so every value passes the §3 SAFE_HEX check.
 */
export const CURATED_COLORS: readonly string[] = [
  // natural fur tones
  '#8b5a2b', '#a0522d', '#6b4423', '#d2b48c', '#b8860b', '#c0c0c0', '#f5f5dc',
  '#4a3728', '#2f2f2f',
  // vivid accents
  '#ff4f79', '#00bcd4', '#7c4dff', '#76ff03', '#ff9100', '#00e5a0',
  // skin tones
  '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524',
  // hair colours
  '#090806', '#71635a', '#b7a69e', '#fff5e1', '#e6cea8', '#563d2d', '#dc4b3e',
];

/** Chance an optional part slot gets a part at all (studio randomizer twin). */
const OPTIONAL_PART_PROBABILITY = 0.6;

/**
 * mulberry32 — tiny deterministic PRNG. Same 32-bit seed ⇒ same sequence, so a
 * "seed" the user types reproduces the exact character (and the same seed can
 * be handed to the engine bridge's `randomize(seed)` for the in-engine twin).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform pick from a non-empty list (clamped so an rng returning 1 stays in range). */
function pickFrom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/**
 * Build a random-but-valid Char3DConfig from a numeric seed ("Surprise me",
 * DESIGN §4 seeded randomizer). Deterministic: the same seed always produces
 * the same config. Draws REAL VN part ids from the vendored per-slot lists
 * (menagerie for beast families, anime-v1 kemonomimi for humanoid) so the
 * result round-trips through the VN packs, and seeds every material region
 * from {@link CURATED_COLORS}. The output goes through
 * {@link normalizeChar3dConfig}, so it is valid by construction.
 */
export function randomChar3dConfig(seed: number): Char3dConfig {
  const rng = mulberry32(seed);
  const family = pickFrom(HEAD_FAMILIES, rng);
  // kobold has no menagerie body of its own — a kobold head rides a reptile body.
  const archetype: BodyArchetype =
    family === 'kobold'
      ? 'reptile'
      : (BODY_ARCHETYPES as readonly string[]).includes(family)
        ? (family as BodyArchetype)
        : 'humanoid';
  const partsPack = family === 'humanoid' ? 'anime-v1' : 'menagerie-v1';
  const slotIds = PART_SLOT_IDS[partsPack] ?? {};

  const parts: Record<string, string | null> = {};
  for (const slot of PART_SLOTS) {
    const candidates = slotIds[slot];
    parts[slot] =
      candidates && candidates.length > 0 && rng() < OPTIONAL_PART_PROBABILITY
        ? pickFrom(candidates, rng)
        : null;
  }

  const materials: Record<string, string> = {};
  for (const region of MATERIAL_REGIONS) {
    materials[region] = pickFrom(CURATED_COLORS, rng);
  }

  return normalizeChar3dConfig({
    schemaVersion: 1,
    name: `Forged #${seed >>> 0}`,
    body: {
      archetype,
      build: rng(),
      height: 0.5 + rng(),
    },
    head: {
      family,
      variant: '',
      snoutLength: family === 'humanoid' ? 0.1 : rng(),
      earStyle: null,
      hornStyle: null,
    },
    parts,
    materials,
    style: family === 'humanoid' ? 'anime' : pickFrom(FORGE_STYLES, rng),
  });
}
