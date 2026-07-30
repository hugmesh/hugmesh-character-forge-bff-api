import { ForgeStateService } from './forge-state.service';
import { defaultChar3dConfig } from '../models/char3d-config';

/**
 * The parameter-editor state store: immutable signal updates, with EVERY
 * mutation funnelled through the §3 clamp mirror so the store never holds an
 * out-of-contract config.
 */
describe('ForgeStateService (config editor state)', () => {
  let svc: ForgeStateService;

  beforeEach(() => {
    svc = new ForgeStateService();
  });

  it('starts with the valid default config', () => {
    expect(svc.config()).toEqual(defaultChar3dConfig());
    expect(svc.withinSizeCap()).toBeTrue();
  });

  it('field setters update ONLY their field, immutably (new object identity)', () => {
    const before = svc.config();
    svc.setMaterial('iris', '#123456');
    const after = svc.config();
    expect(after).not.toBe(before);
    expect(after.materials.iris).toBe('#123456');
    // everything else untouched
    expect(after.materials.fur).toBe(before.materials.fur);
    expect(after.body).toEqual(before.body);
    expect(before.materials.iris).toBe(defaultChar3dConfig().materials.iris);
  });

  it('setPart chooses and clears (null) a slot without disturbing the others', () => {
    svc.setPart('tail', 'tail_wolf_bushy_01');
    svc.setPart('wings', 'wings_feathered_01');
    expect(svc.config().parts.tail).toBe('tail_wolf_bushy_01');
    expect(svc.config().parts.wings).toBe('wings_feathered_01');
    svc.setPart('tail', null);
    expect(svc.config().parts.tail).toBeNull();
    expect(svc.config().parts.wings).toBe('wings_feathered_01');
  });

  it('out-of-range edits land CLAMPED (the store never holds invalid state)', () => {
    svc.setBuild(42);
    expect(svc.config().body.build).toBe(1);
    svc.setHeight(0.01);
    expect(svc.config().body.height).toBe(0.5);
    svc.setSnoutLength(-5);
    expect(svc.config().head.snoutLength).toBe(0);
    svc.setName('n'.repeat(500));
    expect(svc.config().name.length).toBe(120);
    svc.setMaterial('fur', 'not-a-hex');
    expect(svc.config().materials.fur).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it('head/body/style setters accept valid enum values', () => {
    svc.setFamily('dragon');
    svc.setBodyArchetype('dragon');
    svc.setStyle('anime');
    svc.setVariant('head_dragon_01');
    svc.setEarStyle('tufted');
    svc.setHornStyle(null);
    const c = svc.config();
    expect(c.head.family).toBe('dragon');
    expect(c.body.archetype).toBe('dragon');
    expect(c.style).toBe('anime');
    expect(c.head.variant).toBe('head_dragon_01');
    expect(c.head.earStyle).toBe('tufted');
    expect(c.head.hornStyle).toBeNull();
  });

  it('applyConfig replaces the WHOLE config through the clamp mirror', () => {
    svc.setPart('tail', 'tail_wolf_bushy_01');
    svc.applyConfig({
      name: 'Imported',
      body: { archetype: 'felid', build: 9, height: 1.2 },
      head: { family: 'felid', variant: '', snoutLength: 0.3, earStyle: null, hornStyle: null },
      style: 'classic',
      bogus: true,
    });
    const c = svc.config();
    expect(c.name).toBe('Imported');
    expect(c.body.archetype).toBe('felid');
    expect(c.body.build).toBe(1); // clamped on entry
    expect(c.parts.tail).toBeNull(); // replacement, not merge
    expect('bogus' in (c as unknown as Record<string, unknown>)).toBeFalse();
  });

  it('definitionJson mirrors the live config; reset restores the default', () => {
    svc.setName('Roundtrip');
    expect(JSON.parse(svc.definitionJson()).name).toBe('Roundtrip');
    svc.reset();
    expect(svc.config()).toEqual(defaultChar3dConfig());
  });

  it('pins and un-pins the extended coat blocks', () => {
    expect(svc.isMaterialPinned('socks')).toBeFalse();

    svc.setMaterial('socks', '#101820');
    expect(svc.isMaterialPinned('socks')).toBeTrue();
    expect(svc.config().materials.socks).toBe('#101820');
    // It really is in the definition the server would receive.
    expect(JSON.parse(svc.definitionJson()).materials.socks).toBe('#101820');

    svc.clearMaterial('socks');
    expect(svc.isMaterialPinned('socks')).toBeFalse();
    expect('socks' in svc.config().materials)
      .withContext('deriving means ABSENT, not black')
      .toBeFalse();
    // Un-pinning one block leaves the others and the canonical seven alone.
    expect(svc.config().materials.fur).toBeDefined();
  });
});
