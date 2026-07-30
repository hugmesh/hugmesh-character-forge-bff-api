import { mapVnToChar3d } from './map-vn';
import { VnCharacter } from '../models/vn-character';
import { PartManifest } from '../models/vn-manifest';

/** Minimal valid VnCharacter builder (the studio's replayable definition). */
function vn(overrides: Partial<VnCharacter>): VnCharacter {
  return {
    schemaVersion: 1,
    packId: 'menagerie-v1',
    name: 'Test Subject',
    slots: {},
    palette: {},
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    defaultExpression: 'neutral',
    ...overrides,
  };
}

/**
 * Client mirror of the BFF `/map` pure function (§2 mapping rules): family
 * from the head partId's archetype, parts passthrough, palette→materials 1:1,
 * pack→style, kemonomimi→humanoid — with clamped output guaranteed.
 */
describe('mapVnToChar3d (§2 map mirror)', () => {
  it('maps a menagerie head partId → its headArchetype (vendored index) + variant', () => {
    const cfg = mapVnToChar3d(vn({
      slots: { head: 'head_wolf_01', body: 'body_canid_lean_01' },
    }));
    expect(cfg.head.family).toBe('canid');
    expect(cfg.head.variant).toBe('head_wolf_01');
    expect(cfg.style).toBe('toon');
  });

  it('maps slots.body → body.archetype independently of the head', () => {
    const cfg = mapVnToChar3d(vn({
      slots: { head: 'head_shark_01', body: 'body_dragon_plated_01' },
    }));
    expect(cfg.head.family).toBe('aquatic');
    expect(cfg.body.archetype).toBe('dragon');
  });

  it('anime-v1 (kemonomimi) → humanoid family + anime style, ears/tail carried as parts', () => {
    const cfg = mapVnToChar3d(vn({
      packId: 'anime-v1',
      slots: { head: 'head_anime_oval_01', body: 'body_anime_a_01', ears: 'ears_neko_01', tail: 'tail_kitsune_01' },
    }));
    expect(cfg.head.family).toBe('humanoid');
    expect(cfg.body.archetype).toBe('humanoid');
    expect(cfg.style).toBe('anime');
    expect(cfg.parts.ears).toBe('ears_neko_01');
    expect(cfg.parts.tail).toBe('tail_kitsune_01');
    expect(cfg.head.earStyle).toBe('ears_neko_01');
  });

  it('srd-taxonomy-v1 → classic style, archetype via the partId token scan too', () => {
    const cfg = mapVnToChar3d(vn({
      packId: 'srd-taxonomy-v1',
      slots: { head: 'head_dragonborn_01', body: 'body_dragonborn_01' },
    }));
    expect(cfg.style).toBe('classic');
    // dragonborn is indexed as reptile in the srd pack
    expect(cfg.head.family).toBe('reptile');
    expect(cfg.body.archetype).toBe('reptile');
  });

  it('passes the seven part slots through as partIds (missing → null)', () => {
    const cfg = mapVnToChar3d(vn({
      slots: {
        head: 'head_wolf_01',
        tail: 'tail_wolf_bushy_01',
        wings: 'wings_feathered_01',
        markings: 'marking_mask_01',
        feature: 'feature_mane_01',
        // ears / accessory / hair left unset
      },
    }));
    expect(cfg.parts.tail).toBe('tail_wolf_bushy_01');
    expect(cfg.parts.wings).toBe('wings_feathered_01');
    expect(cfg.parts.markings).toBe('marking_mask_01');
    expect(cfg.parts.feature).toBe('feature_mane_01');
    expect(cfg.parts.ears).toBeNull();
    expect(cfg.parts.accessory).toBeNull();
    expect(cfg.parts.hair).toBeNull();
  });

  it('maps palette regions → materials 1:1, keeping defaults for missing/invalid regions', () => {
    const cfg = mapVnToChar3d(vn({
      palette: { fur: '#112233', iris: '#abcdef', line: 'not-a-hex', unknown_region: '#ff0000' },
    }));
    expect(cfg.materials.fur).toBe('#112233');
    expect(cfg.materials.iris).toBe('#abcdef');
    // invalid hex → per-region default (never the raw value)
    expect(cfg.materials.line).not.toBe('not-a-hex');
    expect(cfg.materials.line).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    // unknown regions never leak into materials
    expect('unknown_region' in cfg.materials).toBeFalse();
  });

  it('echoes the VN source (packId/slots/palette/expression) for round-tripping', () => {
    const cfg = mapVnToChar3d(vn({
      slots: { head: 'head_wolf_01' },
      palette: { fur: '#8b5a2b' },
      defaultExpression: 'smug',
    }));
    expect(cfg.source).toBeDefined();
    expect(cfg.source!.packId).toBe('menagerie-v1');
    expect(cfg.source!.slots['head']).toBe('head_wolf_01');
    expect(cfg.source!.palette['fur']).toBe('#8b5a2b');
    expect(cfg.source!.defaultExpression).toBe('smug');
    // a non-canonical expression clamps to neutral
    expect(mapVnToChar3d(vn({ defaultExpression: 'rage' })).source!.defaultExpression).toBe('neutral');
  });

  it('prefers a supplied pack manifest over the vendored index (authoritative lookup)', () => {
    const manifest: PartManifest = {
      packId: 'custom-pack-v1',
      version: '1',
      displayName: 'Custom',
      canvas: { width: 10, height: 10 },
      slots: [
        {
          slot: 'head',
          zOrder: 60,
          required: true,
          anchor: { x: 0.5, y: 0.5 },
          parts: [{ id: 'head_mystery_01', displayName: 'Mystery', file: 'h.svg', headArchetype: 'moth' }],
        },
      ],
    };
    const cfg = mapVnToChar3d(
      vn({ packId: 'custom-pack-v1', slots: { head: 'head_mystery_01' } }),
      manifest,
    );
    expect(cfg.head.family).toBe('moth');
    // ...but the source echo is DROPPED: source.packId is a four-value enum
    // server-side, so echoing 'custom-pack-v1' would make the config unsaveable.
    expect(cfg.source).toBeUndefined();
  });

  it('unknown head partId → humanoid fallback; snout from the SERVER per-family table', () => {
    const cfg = mapVnToChar3d(vn({ packId: 'unknown-pack', slots: { head: 'head_zzz_99' } }));
    expect(cfg.head.family).toBe('humanoid');
    // VnMapService.SNOUT_BY_FAMILY — humanoid 0.05, canid 0.55. The mirror used to
    // carry a two-value constant (0.1 / 0.5), so every mapped character had a
    // different muzzle locally than on the server.
    expect(cfg.head.snoutLength).toBe(0.05);
    const beast = mapVnToChar3d(vn({ slots: { head: 'head_wolf_01' } }));
    expect(beast.head.snoutLength).toBe(0.55);
  });

  it('echoes the ears partId as earStyle for EVERY pack, not just anime-v1', () => {
    // The server (VnMapService:152) sets earStyle unconditionally; the mirror used
    // to null it for every non-anime pack, so menagerie imports lost their ears.
    const cfg = mapVnToChar3d(vn({ slots: { head: 'head_wolf_01', ears: 'ears_lop_01' } }));
    expect(cfg.head.earStyle).toBe('ears_lop_01');
  });

  it('echoes a horn/antler feature partId as hornStyle (VnMapService#hornFeature)', () => {
    const antlers = mapVnToChar3d(vn({ slots: { feature: 'feature_antlers_01' } }));
    expect(antlers.head.hornStyle).toBe('feature_antlers_01');
    const horns = mapVnToChar3d(vn({ slots: { feature: 'feature_ram_horns_01' } }));
    expect(horns.head.hornStyle).toBe('feature_ram_horns_01');
    // a non-horn feature is NOT a horn style
    const mane = mapVnToChar3d(vn({ slots: { feature: 'feature_mane_01' } }));
    expect(mane.head.hornStyle).toBeNull();
  });

  it('body.archetype falls back to the RESOLVED HEAD FAMILY, not to humanoid', () => {
    // No body slot at all: the server answers with the head family (VnMapService:124-127).
    // The mirror answered 'humanoid', so every bodyless VN import got a human body.
    const cfg = mapVnToChar3d(vn({ slots: { head: 'head_wolf_01' } }));
    expect(cfg.head.family).toBe('canid');
    expect(cfg.body.archetype).toBe('canid');
  });

  it('an unknown head part resolves the family from the BODY part (server fallback chain)', () => {
    const cfg = mapVnToChar3d(vn({
      slots: { head: 'head_not_in_pack_01', body: 'body_dragon_plated_01' },
    }));
    expect(cfg.head.family).toBe('dragon');
    expect(cfg.body.archetype).toBe('dragon');
  });

  it('always returns a CLAMPED config even for a hostile VnCharacter', () => {
    const cfg = mapVnToChar3d(vn({
      name: 'x'.repeat(1000),
      slots: { head: 'head_wolf_01', tail: '<script>' },
      palette: { fur: 'javascript:alert(1)' },
    }));
    expect(cfg.name.length).toBe(120);
    expect(cfg.parts.tail).toBeNull();
    expect(cfg.materials.fur).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });
});
