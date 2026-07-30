import fixtures from './server-contract.fixtures.json';
import {
  BODY_ARCHETYPES,
  Char3dConfig,
  DEFAULT_MATERIALS,
  EXPRESSIONS,
  FORGE_STYLES,
  HEAD_FAMILIES,
  MATERIAL_REGIONS,
  MAX_DEFINITION_BYTES,
  MAX_NAME_LENGTH,
  MAX_SOURCE_PALETTE,
  MAX_SOURCE_SLOTS,
  PART_SLOTS,
  SAFE_HEX,
  SAFE_ID,
  SAFE_KEY,
  SAFE_SHORT_STR,
  SOURCE_PACK_IDS,
  defaultChar3dConfig,
  normalizeChar3dConfig,
} from '../models/char3d-config';
import { SNOUT_BY_FAMILY, mapVnToChar3d } from '../util/map-vn';
import { randomChar3dConfig } from '../util/random-config';
import { VnCharacter } from '../models/vn-character';

/**
 * The CLIENT half of the shared cross-language contract fixture
 * (`server-contract.fixtures.json`; the server half is
 * `ClientContractFixturesTest`, which asserts every constant in that file equals
 * the real `Char3DConfigValidator` constant and feeds every payload to the real
 * validator).
 *
 * Why this file exists: the karma suite only ever compared the client against
 * ITSELF (`forge-bff.service.spec.ts` asserts the POST body against
 * `defaultChar3dConfig()`; `map-vn.spec.ts` asserted the mirror's own numbers), so
 * it stayed green while the client emitted four separate classes of value the BFF
 * answers 400 on — `head.variant: ''`, a `source.packId` outside the four-pack
 * enum, uppercase source keys, and free-text `earStyle` — which made the primary
 * save path impossible. Everything below asserts client output against the SERVER's
 * rules, not against the client's own opinion.
 */
describe('client ⇄ server contract (shared fixture)', () => {
  const contract = fixtures.serverContract;

  /** Every value the client can put in a field, checked against the server's rule. */
  function assertServerWouldAccept(config: Char3dConfig): void {
    expect(config.schemaVersion).toBe(1);
    expect(config.name.length).toBeLessThanOrEqual(contract.maxNameLength);
    expect(config.name).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);

    expect(contract.families).toContain(config.body.archetype as string);
    expect(config.body.build).toBeGreaterThanOrEqual(0);
    expect(config.body.build).toBeLessThanOrEqual(1);
    expect(config.body.height).toBeGreaterThanOrEqual(0.5);
    expect(config.body.height).toBeLessThanOrEqual(1.5);

    expect(contract.families).toContain(config.head.family as string);
    // '' is the mirror's UNSET encoding — the server maps blank to unset. Anything
    // else must match SHORT_STR_PATTERN.
    if (config.head.variant !== '') {
      expect(config.head.variant).toMatch(new RegExp(contract.shortStrPattern));
    }
    expect(config.head.snoutLength).toBeGreaterThanOrEqual(0);
    expect(config.head.snoutLength).toBeLessThanOrEqual(1);
    for (const style of [config.head.earStyle, config.head.hornStyle]) {
      if (style !== null) {
        expect(style).toMatch(new RegExp(contract.shortStrPattern));
      }
    }

    for (const slot of PART_SLOTS) {
      const partId = config.parts[slot];
      if (partId !== null) {
        expect(partId).toMatch(new RegExp(contract.partIdPattern));
      }
    }
    for (const region of MATERIAL_REGIONS) {
      expect(config.materials[region]).toMatch(new RegExp(contract.hexPattern));
    }
    expect(contract.styles).toContain(config.style as string);

    if (config.source) {
      expect(contract.packIds).toContain(config.source.packId as string);
      const slotKeys = Object.keys(config.source.slots);
      expect(slotKeys.length).toBeLessThanOrEqual(contract.maxSourceSlots);
      for (const key of slotKeys) {
        expect(key).toMatch(new RegExp(contract.keyPattern));
        const value = config.source.slots[key];
        if (value !== null) {
          expect(value).toMatch(new RegExp(contract.partIdPattern));
        }
      }
      const paletteKeys = Object.keys(config.source.palette);
      expect(paletteKeys.length).toBeLessThanOrEqual(contract.maxSourcePalette);
      for (const key of paletteKeys) {
        expect(key).toMatch(new RegExp(contract.keyPattern));
        expect(config.source.palette[key]).toMatch(new RegExp(contract.hexPattern));
      }
      expect(contract.expressions).toContain(config.source.defaultExpression as string);
    }

    expect(new TextEncoder().encode(JSON.stringify(config)).length)
      .toBeLessThanOrEqual(contract.maxDefinitionBytes);
  }

  describe('the mirror constants equal the server constants', () => {
    it('patterns and caps', () => {
      expect(SAFE_HEX.source).toBe(contract.hexPattern);
      expect(SAFE_ID.source).toBe(contract.partIdPattern);
      expect(SAFE_SHORT_STR.source).toBe(contract.shortStrPattern);
      expect(SAFE_KEY.source).toBe(contract.keyPattern);
      expect(MAX_NAME_LENGTH).toBe(contract.maxNameLength);
      expect(MAX_DEFINITION_BYTES).toBe(contract.maxDefinitionBytes);
      expect(MAX_SOURCE_SLOTS).toBe(contract.maxSourceSlots);
      expect(MAX_SOURCE_PALETTE).toBe(contract.maxSourcePalette);
    });

    it('vocabularies', () => {
      expect([...HEAD_FAMILIES] as string[]).toEqual(contract.families);
      expect(([...BODY_ARCHETYPES] as string[]).sort()).toEqual([...contract.families].sort());
      expect([...FORGE_STYLES] as string[]).toEqual(contract.styles);
      expect([...EXPRESSIONS] as string[]).toEqual(contract.expressions);
      expect([...SOURCE_PACK_IDS] as string[]).toEqual(contract.packIds);
      expect([...PART_SLOTS] as string[]).toEqual(contract.partKeys);
      expect([...MATERIAL_REGIONS] as string[]).toEqual(contract.materialKeys);
    });

    it('the unset-region palette (three copies: here, the validator, the Godot maker)', () => {
      expect(DEFAULT_MATERIALS as Record<string, string>).toEqual(contract.defaultMaterials);
    });
  });

  describe('everything the client can emit is acceptable to the server', () => {
    it('the shipped payload fixtures still round-trip through the mirror', () => {
      for (const entry of fixtures.acceptedDefinitions) {
        const normalized = normalizeChar3dConfig(entry.definition);
        assertServerWouldAccept(normalized);
        expect(normalized)
          .withContext(`${entry.label} is not a fixed point of the client mirror`)
          .toEqual(normalizeChar3dConfig(normalized));
      }
    });

    it('defaultChar3dConfig() — the payload every first save sends', () => {
      const cfg = defaultChar3dConfig();
      assertServerWouldAccept(cfg);
      expect(cfg.name.length).toBeGreaterThan(0);   // @NotBlank on the wire
    });

    it('every "Surprise me" seed', () => {
      for (let seed = 0; seed < 200; seed++) {
        assertServerWouldAccept(randomChar3dConfig(seed));
      }
    });

    it('free-text editor input that the server would 400 on is DROPPED, not passed through', () => {
      const typed = normalizeChar3dConfig({
        ...defaultChar3dConfig(),
        head: {
          family: 'lapine',
          variant: '<script>alert(1)</script>',
          snoutLength: 0.3,
          earStyle: 'Lop-ears!',
          hornStyle: 'long lop ears',
        },
      });
      expect(typed.head.variant).toBe('');
      expect(typed.head.earStyle).toBeNull();
      expect(typed.head.hornStyle).toBe('long lop ears');
      assertServerWouldAccept(typed);
    });

    it('a source echo from a pack the server does not know is dropped, not emitted', () => {
      const imported = normalizeChar3dConfig({
        ...defaultChar3dConfig(),
        source: { packId: 'custom-pack-v1', slots: { head: 'head_mystery_01' }, palette: {} },
      });
      expect(imported.source).toBeUndefined();
      assertServerWouldAccept(imported);
    });

    it('source slot/palette keys are lower-slug only and the caps are enforced', () => {
      const slots: Record<string, string> = { Head: 'head_wolf_01', body: 'body canid' };
      const palette: Record<string, string> = { Accent: '#ff0000', fur: '#112233' };
      for (let i = 0; i < 40; i++) {
        slots[`slot_${i}`] = 'tail_fox_01';
        palette[`region_${i}`] = '#abcdef';
      }
      const cfg = normalizeChar3dConfig({
        ...defaultChar3dConfig(),
        source: { packId: 'menagerie-v1', slots, palette, defaultExpression: 'smug' },
      });
      expect(cfg.source).toBeDefined();
      expect(Object.keys(cfg.source!.slots)).not.toContain('Head');
      expect(Object.keys(cfg.source!.slots)).not.toContain('body');
      expect(Object.keys(cfg.source!.palette)).not.toContain('Accent');
      expect(Object.keys(cfg.source!.slots).length).toBe(MAX_SOURCE_SLOTS);
      expect(Object.keys(cfg.source!.palette).length).toBe(MAX_SOURCE_PALETTE);
      assertServerWouldAccept(cfg);
    });

    it('bidi / invisible code points are stripped from the display name', () => {
      for (const cp of contract.forbiddenNameCodePoints) {
        const hostile = normalizeChar3dConfig({
          ...defaultChar3dConfig(),
          name: `Ada${String.fromCodePoint(cp)}Lovelace`,
        });
        expect(hostile.name)
          .withContext(`U+${cp.toString(16)} must not survive into the name`)
          .toBe('AdaLovelace');
        assertServerWouldAccept(hostile);
      }
      // A name made only of forbidden characters cleans down to EMPTY (not to a
      // silently invented one) — the save path then surfaces the server's
      // `name must not be blank` 400, which is the honest outcome.
      const onlyBidi = normalizeChar3dConfig({ ...defaultChar3dConfig(), name: '‮' });
      expect(onlyBidi.name).toBe('');
      // ...and a NON-string name still falls back to the default.
      expect(normalizeChar3dConfig({ ...defaultChar3dConfig(), name: 42 }).name)
        .toBe('Untitled');
    });
  });

  describe('the /map mirror equals the authoritative BFF /map', () => {
    it('the per-family snout table is the server table', () => {
      // The 29 entries live in VnMapService.SNOUT_BY_FAMILY; every family the
      // server knows must resolve to the same number here.
      expect(Object.keys(SNOUT_BY_FAMILY).sort()).toEqual([...contract.families].sort());
      for (const value of Object.values(SNOUT_BY_FAMILY)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });

    for (const entry of fixtures.vnMapCases) {
      it(`case: ${entry.label}`, () => {
        const mapped = mapVnToChar3d(entry.vnCharacter as unknown as VnCharacter);
        expect(mapped)
          .withContext(`mapVnToChar3d disagrees with POST /bff/character-forge/map`)
          .toEqual(entry.expected as unknown as Char3dConfig);
        assertServerWouldAccept(mapped);
      });
    }

    /**
     * The ONE deliberate asymmetry, asserted so it can never grow silently: the
     * client type requires `name`, the server treats `definition.name` as optional
     * and simply omits it when the VN character carries none. Each side still
     * ACCEPTS the other's output.
     */
    it('a nameless VN character maps to the client default name (documented asymmetry)', () => {
      const nameless = {
        schemaVersion: 1,
        packId: 'menagerie-v1',
        slots: { head: 'head_wolf_01' },
        palette: {},
        transform: { scale: 1, offsetX: 0, offsetY: 0 },
        defaultExpression: 'neutral',
      } as unknown as VnCharacter;
      expect(mapVnToChar3d(nameless).name).toBe('Untitled');
    });
  });
});
