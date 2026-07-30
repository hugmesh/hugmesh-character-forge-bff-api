import { mulberry32, randomChar3dConfig } from './random-config';
import { normalizeChar3dConfig } from '../models/char3d-config';
import { PART_ARCHETYPE_INDEX, PART_SLOT_IDS } from '../models/part-archetypes';

describe('mulberry32 (seeded PRNG)', () => {
  it('is deterministic per seed and diverges across seeds', () => {
    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const b = mulberry32(43);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
  });

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randomChar3dConfig (seeded randomizer)', () => {
  it('same seed ⇒ identical config; different seeds ⇒ different configs', () => {
    expect(randomChar3dConfig(1234)).toEqual(randomChar3dConfig(1234));
    const distinct = new Set(
      [1, 2, 3, 4, 5].map(s => JSON.stringify(randomChar3dConfig(s))),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('every seed produces an ALREADY-VALID config (normalize is a no-op)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const cfg = randomChar3dConfig(seed);
      expect(normalizeChar3dConfig(cfg)).toEqual(cfg);
      expect(cfg.body.build).toBeGreaterThanOrEqual(0);
      expect(cfg.body.build).toBeLessThanOrEqual(1);
      expect(cfg.body.height).toBeGreaterThanOrEqual(0.5);
      expect(cfg.body.height).toBeLessThanOrEqual(1.5);
    }
  });

  it('draws part ids from the REAL vendored pack lists (or leaves slots empty)', () => {
    const knownIds = new Set<string>();
    for (const pack of Object.keys(PART_SLOT_IDS)) {
      for (const ids of Object.values(PART_SLOT_IDS[pack])) {
        for (const id of ids) {
          knownIds.add(id);
        }
      }
    }
    for (let seed = 0; seed < 50; seed++) {
      const cfg = randomChar3dConfig(seed);
      for (const id of Object.values(cfg.parts)) {
        if (id !== null) {
          expect(knownIds.has(id)).withContext(`seed ${seed} produced ${id}`).toBeTrue();
        }
      }
    }
  });

  it('kobold heads ride a reptile body; humanoid forges style anime', () => {
    let sawKobold = false;
    let sawHumanoid = false;
    for (let seed = 0; seed < 300 && !(sawKobold && sawHumanoid); seed++) {
      const cfg = randomChar3dConfig(seed);
      if (cfg.head.family === 'kobold') {
        sawKobold = true;
        expect(cfg.body.archetype).toBe('reptile');
      }
      if (cfg.head.family === 'humanoid') {
        sawHumanoid = true;
        expect(cfg.style).toBe('anime');
        expect(cfg.head.snoutLength).toBe(0.1);
      }
    }
    // 300 seeds over 29 families make missing either statistically impossible;
    // if this ever trips the family picker itself is broken.
    expect(sawKobold).toBeTrue();
    expect(sawHumanoid).toBeTrue();
  });
});

describe('vendored pack data (the mapping surface the mirror keys off)', () => {
  it('carries the studio pack ids with head/body archetype entries', () => {
    expect(Object.keys(PART_ARCHETYPE_INDEX)).toEqual(
      jasmine.arrayContaining(['menagerie-v1', 'anime-v1', 'srd-taxonomy-v1', 'base-anthro-v1']),
    );
    // spot-check stable anchors of the studio catalog
    expect(PART_ARCHETYPE_INDEX['menagerie-v1']['head']['head_wolf_01']).toBe('canid');
    expect(PART_ARCHETYPE_INDEX['srd-taxonomy-v1']['head']['head_dragonborn_01']).toBe('reptile');
    expect(Object.keys(PART_ARCHETYPE_INDEX['menagerie-v1']['head']).length).toBeGreaterThan(50);
  });
});
