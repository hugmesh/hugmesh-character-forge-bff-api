import {
  EXTENDED_MATERIAL_REGIONS,
  effectiveRegionColor,
  DEFAULT_MATERIALS,
  MAX_DEFINITION_BYTES,
  defaultChar3dConfig,
  definitionByteSize,
  definitionWithinCap,
  normalizeChar3dConfig,
} from './char3d-config';

/**
 * The §3 validation MIRROR: normalizeChar3dConfig must clamp/coerce exactly
 * like the BFF (reject unknown keys, clamp numerics, regex hexes, enum-check
 * families/styles, length-cap strings) so what the editor previews is what the
 * server stores.
 */
describe('normalizeChar3dConfig (§3 clamp mirror)', () => {
  it('returns a deterministic valid config for garbage input (never throws)', () => {
    for (const bad of [null, undefined, 42, 'nope', [], true]) {
      const cfg = normalizeChar3dConfig(bad);
      // Absent enums fall back CONSERVATIVELY to humanoid (unlike the editor's
      // canid starting character, which is a product choice, not a clamp).
      expect(cfg.schemaVersion).toBe(1);
      expect(cfg.name).toBe('Untitled');
      // EVERY shape axis lands on the CENTRED 0.5 — the value defined to
      // reproduce the pre-axis silhouette, so garbage input degrades to today's
      // character rather than to a reshaped one. It is also what makes the
      // default body androgynous by construction: there is no body-type preset
      // to start from, only proportions parked at their midpoints.
      expect(cfg.body).toEqual({
        archetype: 'humanoid', build: 0.5, height: 1.0,
        curve: 0.5, top: 0.5, legs: 0.5, arms: 0.5, limb: 0.5,
      });
      expect(cfg.head).toEqual({
        family: 'humanoid', variant: '', snoutLength: 0.5, earStyle: null, hornStyle: null,
      });
      expect(Object.values(cfg.parts)).toEqual([null, null, null, null, null, null, null]);
      expect(cfg.materials).toEqual(DEFAULT_MATERIALS);
      expect(cfg.style).toBe('toon');
      expect(cfg.source).toBeUndefined();
    }
  });

  it('DROPS unknown top-level and nested keys (output rebuilt field-by-field)', () => {
    const cfg = normalizeChar3dConfig({
      ...defaultChar3dConfig(),
      evil: 'injected',
      body: { archetype: 'canid', build: 0.5, height: 1, extra: 'x' },
      parts: { tail: null, wings: null, ears: null, feature: null, accessory: null, markings: null, hair: null, sneaky: 'part' },
    }) as unknown as Record<string, unknown>;
    expect('evil' in cfg).toBeFalse();
    expect('extra' in (cfg['body'] as object)).toBeFalse();
    expect('sneaky' in (cfg['parts'] as object)).toBeFalse();
  });

  it('clamps numerics to their §2 ranges and defaults non-finite values', () => {
    const cfg = normalizeChar3dConfig({
      body: { archetype: 'felid', build: 7, height: -3 },
      head: { family: 'felid', snoutLength: Number.NaN },
    });
    expect(cfg.body.build).toBe(1);
    expect(cfg.body.height).toBe(0.5);
    expect(cfg.head.snoutLength).toBe(0.5); // NaN → default, not 0
    expect(normalizeChar3dConfig({ body: { height: 99 } }).body.height).toBe(1.5);
  });

  it('enum-checks family/archetype/style with humanoid/toon fallbacks', () => {
    const cfg = normalizeChar3dConfig({
      body: { archetype: 'xenomorph' },
      head: { family: 'eldritch' },
      style: 'photoreal',
    });
    expect(cfg.body.archetype).toBe('humanoid');
    expect(cfg.head.family).toBe('humanoid');
    expect(cfg.style).toBe('toon');
    // valid values pass through untouched
    const ok = normalizeChar3dConfig({ body: { archetype: 'dragon' }, head: { family: 'kobold' }, style: 'anime' });
    expect(ok.body.archetype).toBe('dragon');
    expect(ok.head.family).toBe('kobold');
    expect(ok.style).toBe('anime');
  });

  it('regex-checks material hexes (^#[0-9a-fA-F]{3,8}$) and falls back per-region', () => {
    const cfg = normalizeChar3dConfig({
      materials: {
        fur: '#abc',                       // 3-digit ok
        accent: '#AABBCCDD',               // 8-digit ok
        detail: 'red',                     // named colour rejected
        line: '#12345g',                   // bad digit rejected
        iris: 'javascript:alert(1)',       // hostile rejected
      },
    });
    expect(cfg.materials.fur).toBe('#abc');
    expect(cfg.materials.accent).toBe('#AABBCCDD');
    expect(cfg.materials.detail).toBe(DEFAULT_MATERIALS.detail);
    expect(cfg.materials.line).toBe(DEFAULT_MATERIALS.line);
    expect(cfg.materials.iris).toBe(DEFAULT_MATERIALS.iris);
  });

  it('length-caps name (120) / variant (40) / ear+horn styles (40)', () => {
    const cfg = normalizeChar3dConfig({
      name: 'n'.repeat(500),
      head: { family: 'canid', variant: 'v'.repeat(100), earStyle: 'e'.repeat(100), hornStyle: '' },
    });
    expect(cfg.name.length).toBe(120);
    expect(cfg.head.variant.length).toBe(40);
    expect(cfg.head.earStyle!.length).toBe(40);
    expect(cfg.head.hornStyle).toBeNull(); // empty string folds to null
  });

  it('token-checks part ids — hostile/malformed ids become null, valid pass', () => {
    const cfg = normalizeChar3dConfig({
      parts: {
        tail: 'tail_fox_01',
        wings: '<script>alert(1)</script>',
        ears: 'x'.repeat(65),
        feature: 42,
        accessory: '',
        markings: 'marks-ok_2',
        hair: null,
      },
    });
    expect(cfg.parts.tail).toBe('tail_fox_01');
    expect(cfg.parts.wings).toBeNull();
    expect(cfg.parts.ears).toBeNull();
    expect(cfg.parts.feature).toBeNull();
    expect(cfg.parts.accessory).toBeNull();
    expect(cfg.parts.markings).toBe('marks-ok_2');
    expect(cfg.parts.hair).toBeNull();
  });

  it('normalizes the optional source echo exactly as the server validates it', () => {
    expect(normalizeChar3dConfig({ source: { slots: {} } }).source).toBeUndefined();
    // packId is an ENUM server-side: an echo naming any other pack is a hard 400
    // ("definition.source.packId must be one of [...]") with no way to clear it from
    // the UI, so the mirror drops the whole echo rather than emitting it.
    expect(normalizeChar3dConfig({ source: { packId: 'custom-pack-v1', slots: {} } }).source)
      .toBeUndefined();
    const cfg = normalizeChar3dConfig({
      source: {
        packId: 'menagerie-v1',
        slots: { head: 'head_wolf_01', bad: '<x>', Ears: 'ears_lop_01', wings: null },
        palette: { fur: '#8b5a2b', line: 'not-a-hex', Accent: '#ff0000' },
        defaultExpression: 'rage',
      },
    });
    expect(cfg.source).toBeDefined();
    expect(cfg.source!.packId).toBe('menagerie-v1');
    expect(cfg.source!.slots['head']).toBe('head_wolf_01');
    // an invalid VALUE drops the ENTRY (the server never echoes it back); an explicit
    // null is preserved (the server accepts null as "slot cleared")
    expect('bad' in cfg.source!.slots).toBeFalse();
    expect(cfg.source!.slots['wings']).toBeNull();
    // KEY_PATTERN is lower-slug only: 'Ears' is a 400 server-side, so it is dropped
    expect('Ears' in cfg.source!.slots).toBeFalse();
    expect(cfg.source!.palette['fur']).toBe('#8b5a2b');
    expect('line' in cfg.source!.palette).toBeFalse();
    expect('Accent' in cfg.source!.palette).toBeFalse();
    expect(cfg.source!.defaultExpression).toBe('neutral');
  });

  it('is idempotent: normalize(normalize(x)) === normalize(x) (fixed point)', () => {
    const once = normalizeChar3dConfig({ name: 'x'.repeat(500), style: 'bogus', body: { build: 9 } });
    expect(normalizeChar3dConfig(once)).toEqual(once);
  });
});

describe('definition size cap (16KB, §3)', () => {
  it('a default config is comfortably within the cap', () => {
    const cfg = defaultChar3dConfig();
    expect(definitionByteSize(cfg)).toBeLessThan(MAX_DEFINITION_BYTES);
    expect(definitionWithinCap(cfg)).toBeTrue();
  });

  it('a config ballooned past 16KB fails the cap check', () => {
    const cfg = defaultChar3dConfig();
    // The name caps at 120 chars, so inflate via a big (clamped-valid) source echo.
    const slots: Record<string, string | null> = {};
    for (let i = 0; i < 400; i++) {
      slots[`slot_${i}`] = 'part_' + 'x'.repeat(50) + `_${i}`;
    }
    cfg.source = { packId: 'menagerie-v1', slots, palette: {}, defaultExpression: 'neutral' };
    expect(definitionByteSize(cfg)).toBeGreaterThan(MAX_DEFINITION_BYTES);
    expect(definitionWithinCap(cfg)).toBeFalse();
  });

  it('measures BYTES not chars (multi-byte names count fully)', () => {
    const ascii = defaultChar3dConfig();
    ascii.name = 'a'.repeat(100); // 100 chars, 100 UTF-8 bytes
    const multi = defaultChar3dConfig();
    multi.name = '🐉'.repeat(25); // 50 UTF-16 chars, but 25 × 4 = 100 UTF-8 bytes
    expect(multi.name.length).toBe(50);
    expect(ascii.name.length).toBe(100);
    expect(definitionByteSize(multi)).toBe(definitionByteSize(ascii));
  });

  it('keeps the four EXTENDED coat blocks only when they are supplied', () => {
    // Absent means "the maker derives it" — materializing a default here would
    // freeze today's derivation into every character.
    const bare = normalizeChar3dConfig({});
    for (const region of EXTENDED_MATERIAL_REGIONS) {
      expect(region in bare.materials).withContext(`${region} absent by default`).toBeFalse();
    }

    const pinned = normalizeChar3dConfig({
      materials: { fur: '#804000', innerMuzzle: '#ffd9c0', socks: 'not-a-colour' },
    });
    expect(pinned.materials.innerMuzzle).toBe('#ffd9c0');
    expect('socks' in pinned.materials)
      .withContext('an invalid extended hex is DROPPED, not defaulted')
      .toBeFalse();
  });

  it('effectiveRegionColor shows what the maker will actually render', () => {
    const cfg = normalizeChar3dConfig({ materials: { fur: '#804000', accent: '#123456' } });

    // Pinned wins.
    const withPin = normalizeChar3dConfig({ materials: { tailTip: '#abcdef' } });
    expect(effectiveRegionColor(withPin, 'tailTip')).toBe('#abcdef');

    // Derived: socks←accent, innerEar←skin, tailTip←accent (palette.gd twin).
    expect(effectiveRegionColor(cfg, 'socks')).toBe('#123456');
    expect(effectiveRegionColor(cfg, 'tailTip')).toBe('#123456');
    expect(effectiveRegionColor(cfg, 'innerEar')).toBe(cfg.materials.skin);

    // innerMuzzle←fur LIGHTENED by 0.45, exactly like Color.lightened():
    // 0x80 + (255-0x80)*0.45 = 185 = 0xb9; 0x40 + (255-0x40)*0.45 = 150 = 0x96;
    // 0x00 + 255*0.45 = 115 = 0x73.
    expect(effectiveRegionColor(cfg, 'innerMuzzle')).toBe('#b99673');

    // A canonical region is just itself.
    expect(effectiveRegionColor(cfg, 'fur')).toBe('#804000');
  });
});
