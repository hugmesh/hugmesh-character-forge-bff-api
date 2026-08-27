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

  /**
   * The two shape axes, which the store treats exactly like build/height. Kept
   * as its own spec because the axes shipped with NO state-service coverage at
   * all: deleting setCurve/setTop left the suite green, so nothing said whether
   * the sliders wrote anywhere.
   */
  it('setCurve/setTop write their own field and nothing else', () => {
    const before = svc.config();
    svc.setCurve(0.25);
    svc.setTop(0.9);
    const after = svc.config();
    expect(after.body.curve).toBe(0.25);
    expect(after.body.top).toBe(0.9);
    // Orthogonal to `build`/`height` in the store as well as in the assembler.
    expect(after.body.build).toBe(before.body.build);
    expect(after.body.height).toBe(before.body.height);
    expect(after.body.archetype).toBe(before.body.archetype);
    expect(after.head).toEqual(before.head);
    // Immutable update, and it really reaches the definition the server sees.
    expect(after).not.toBe(before);
    expect(before.body.curve).toBe(0.5);
    const sent = JSON.parse(svc.definitionJson()) as { body: Record<string, number> };
    expect(sent.body['curve']).toBe(0.25);
    expect(sent.body['top']).toBe(0.9);
  });

  it('the default character sits at the CENTRED stop on both shape axes', () => {
    // 0.5 is the value defined to reproduce the pre-axis silhouette exactly, so
    // a default character must never start anywhere else.
    expect(svc.config().body.curve).toBe(0.5);
    expect(svc.config().body.top).toBe(0.5);
  });

  it('out-of-range edits land CLAMPED (the store never holds invalid state)', () => {
    svc.setBuild(42);
    expect(svc.config().body.build).toBe(1);
    svc.setHeight(0.01);
    expect(svc.config().body.height).toBe(0.5);
    svc.setCurve(42);
    expect(svc.config().body.curve).toBe(1);
    svc.setTop(-5);
    expect(svc.config().body.top).toBe(0);
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

  describe('rig adjustments', () => {
    it('setRigJoint stores a clamped, sparse rig and drops identity joints', () => {
      svc.setRigJoint('eye_l', { offset: [0.5, -0.5, 0.01], scale: [3, 0.1, 1] });
      expect(svc.config().rig).toEqual({ eye_l: { offset: [0.12, -0.12, 0.01], scale: [1.8, 0.5, 1] } });
      svc.setRigJoint('jaw', { offset: [0, 0, 0] });
      expect(svc.config().rig).toEqual({ eye_l: { offset: [0.12, -0.12, 0.01], scale: [1.8, 0.5, 1] } });
      svc.setRigJoint('eye_l', {});
      expect(svc.config().rig).withContext('no adjusted joints left → no rig key').toBeUndefined();
      expect('rig' in svc.config()).toBeFalse();
    });

    it('setRig replaces the whole rig (what auto-adjust hands back) and clearRig removes it', () => {
      svc.setRigJoint('brow_l', { scale: [1, 1.2, 1] });
      svc.setRig({ jaw: { offset: [0, -0.03, 0] }, nose: { offset: [1, 1, 1] } });
      expect(svc.config().rig).toEqual({ jaw: { offset: [0, -0.03, 0] } });
      svc.clearRig();
      expect('rig' in svc.config()).toBeFalse();
      expect(svc.definitionJson()).not.toContain('rig');
    });
  });
});
