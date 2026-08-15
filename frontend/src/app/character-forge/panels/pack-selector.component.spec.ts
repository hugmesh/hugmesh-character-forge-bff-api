import { TestBed } from '@angular/core/testing';
import { PackSelectorComponent } from './pack-selector.component';
import { EngineBridgeService } from '../services/engine-bridge.service';
import { ForgeStateService } from '../services/forge-state.service';
import { PACK_CATALOG, PACK_ENTRIES } from '../models/pack-catalog.generated';
import { IMPORT_SOURCES } from '../models/import-sources';

/**
 * The character selector: style tabs over the GENERATED catalogue, the honest
 * per-model facts (licence, cost, recolourability), and the BYO-import slot
 * whose whole point is that the bytes never leave the device.
 */
describe('PackSelectorComponent (style tabs + BYO import)', () => {
  let engine: EngineBridgeService;
  let state: ForgeStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PackSelectorComponent] });
    engine = TestBed.inject(EngineBridgeService);
    state = TestBed.inject(ForgeStateService);
    state.reset();
    engine.mountReport.set(null);
  });

  function render() {
    const fixture = TestBed.createComponent(PackSelectorComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one tab per style lane, in the catalogue order', () => {
    const el: HTMLElement = render().nativeElement;
    const tabs = el.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(PACK_CATALOG.length);
    expect(PACK_CATALOG.length).toBe(5);
    expect(Array.from(tabs).map(t => t.textContent!.trim())).toEqual(
      PACK_CATALOG.map(l => l.displayName),
    );
    // The first tab is selected and its models are the ones on screen.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('.grid .card').length)
      .toBe(PACK_CATALOG[0].entries.length + 1); // + the procedural card
  });

  it('shows each model\'s licence, cost and recolour limits', () => {
    const fixture = render();
    const component = fixture.componentInstance;
    component.selectLane('jrpg');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const knight = el.querySelector('[data-testid="cf-pack-jrpg-knight"]')!;
    expect(knight).not.toBeNull();
    expect(knight.textContent).toContain('CC0-1.0');
    // KayKit is one baked atlas — the card has to SAY the colours are fixed
    // rather than silently ignoring the palette.
    expect(knight.textContent).toContain('fixed colours');

    const ubc = el.querySelector('[data-testid="cf-pack-jrpg-ubc-b"]')!;
    expect(ubc.textContent).not.toContain('fixed colours');
    expect(ubc.textContent).toContain('tris');
  });

  it('shows a composed outfit set as one entry with its whole-set cost', () => {
    const fixture = render();
    fixture.componentInstance.selectLane('jrpg');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    const peasant = el.querySelector('[data-testid="cf-pack-jrpg-outfit-peasant-b"]')!;
    expect(peasant).withContext('the modular outfit is offered as one model').not.toBeNull();
    expect(peasant.textContent).toContain('4-piece set');
    // The cost shown is the SUM over the pieces, not just the primary GLB.
    const entry = PACK_ENTRIES.find(e => e.key === 'jrpg-outfit-peasant-b')!;
    expect(entry.pieceCount).toBe(3);
    expect(entry.tris).toBe(12894);
    expect(peasant.textContent).toContain('12,894 tris');
    // Ranger sets really are over budget — the flag is not decorative.
    const ranger = el.querySelector('[data-testid="cf-pack-jrpg-outfit-ranger-a"]')!;
    expect(ranger.textContent).toContain('over Quest budget');
  });

  it('flags the models that blow the Quest-3 budget', () => {
    const fixture = render();
    const component = fixture.componentInstance;
    const heavy = PACK_ENTRIES.find(e => e.joints > 75)!;
    expect(heavy).withContext('the catalogue has an over-budget model').toBeDefined();
    expect(component.overBudget(heavy)).toContain('75-bone');
    const light = PACK_ENTRIES.find(e => e.tris <= 15000 && e.joints <= 75)!;
    expect(component.overBudget(light)).toBeNull();
  });

  it('marks the VRoid bases as whole-model-only (pixiv part-mixer clause)', () => {
    const fixture = render();
    fixture.componentInstance.selectLane('anime');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const vroid = el.querySelector('[data-testid="cf-pack-anime-vroid-a"]')!;
    expect(vroid.textContent).toContain('whole model only');
  });

  it('mounts a chosen model through the bridge and moves the config onto it', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    const dragon = PACK_ENTRIES.find(e => e.key === 'monster-dragon')!;

    await component.choose(dragon);
    fixture.detectChanges();

    // The basis registry is keyed by family, so the config HAS to follow the
    // model or the engine would resolve a procedural basis and ignore it.
    expect(state.config().head.family).toBe('dragon');
    expect(state.config().body.archetype).toBe('dragon');
    expect(engine.pendingMessages()).toContain({ v: 1, t: 'setPack', key: 'monster-dragon' });
    expect(component.selectedKey()).toBe('monster-dragon');
    expect(component.status()).toContain('CC0-1.0');
  });

  it('takes only the ARCHETYPE from a body-mount model so the beast head survives', async () => {
    const fixture = render();
    const component = fixture.componentInstance;
    state.setFamily('canid');
    const hybrid = PACK_ENTRIES.find(e => e.mount === 'body')!;

    await component.choose(hybrid);

    expect(state.config().body.archetype).toBe('humanoid');
    expect(state.config().head.family)
      .withContext('the procedural beast head is the point of the hybrid')
      .toBe('canid');
  });

  it('returns to the procedural avatar', () => {
    const fixture = render();
    const component = fixture.componentInstance;
    component.clearPack();
    expect(engine.pendingMessages()).toContain({ v: 1, t: 'setPack', key: '' });
    expect(component.selectedKey()).toBe('');
  });

  it('lists the recorded capability gaps instead of hiding them', () => {
    const el: HTMLElement = render().nativeElement;
    const gaps = el.querySelector('[data-testid="cf-pack-gaps"]')!;
    expect(gaps.textContent).toContain('NOT POSSIBLE AT RUNTIME');
  });

  it('shows the engine mount report when a model is on stage', () => {
    engine.mountReport.set({
      key: 'jrpg-knight', kind: 'head', displayName: 'Knight (KayKit)', lane: 'jrpg',
      mounted: true, recolorable: false, surfacesRebound: 0, meshesHidden: 7,
      heightScale: 1.2, lipSyncChannels: ['strip'], visemes: false,
      licenseSpdx: 'CC0-1.0', attribution: 'Kay Lousberg', sourceUrl: 'https://kaylousberg.com',
      imported: false, error: '',
    });
    const el: HTMLElement = render().nativeElement;
    const note = el.querySelector('[data-testid="cf-pack-report"]')!;
    expect(note.textContent).toContain('no (baked atlas)');
    expect(note.textContent).toContain('strip');
    expect(note.textContent).toContain('7 props hidden');
  });

  describe('import tab', () => {
    function importTab() {
      const fixture = render();
      fixture.componentInstance.selectLane('import');
      fixture.detectChanges();
      return fixture;
    }

    it('says plainly that imported bytes never leave the device', () => {
      const el: HTMLElement = importTab().nativeElement;
      const slot = el.querySelector('[data-testid="cf-import-slot"]')!;
      expect(slot.textContent).toContain('never uploaded');
      expect(el.querySelector('[data-testid="cf-import-file"]')!.getAttribute('accept'))
        .toBe('.vrm,.glb,.gltf');
    });

    it('LINKS the non-redistributable bases instead of shipping them', () => {
      const el: HTMLElement = importTab().nativeElement;
      const userOnly = IMPORT_SOURCES.filter(s => !s.redistributable);
      expect(userOnly.length).withContext('kemono.md: the good kemono bases are not ours to ship')
        .toBeGreaterThan(0);
      for (const source of userOnly) {
        const link = Array.from(el.querySelectorAll('a')).find(a => a.textContent === source.name);
        expect(link).withContext(`${source.name} is linked`).toBeDefined();
        expect(link!.getAttribute('href')).toBe(source.url);
        expect(link!.getAttribute('rel')).toContain('noopener');
      }
      expect(el.querySelectorAll('.sources .user-only').length).toBe(userOnly.length);
    });

    it('tells the user why importing is unavailable without the engine', () => {
      const el: HTMLElement = importTab().nativeElement;
      expect(el.querySelector('[data-testid="cf-import-engine-hint"]')).not.toBeNull();
    });

    it('refuses an oversize file before it is ever read into memory', async () => {
      const fixture = importTab();
      const component = fixture.componentInstance;
      const readSpy = jasmine.createSpy('arrayBuffer');
      const huge = {
        name: 'huge.vrm',
        size: 64 * 1024 * 1024,
        arrayBuffer: readSpy,
      } as unknown as File;
      await component.onImportFile({
        target: { files: [huge], value: '' },
      } as unknown as Event);

      expect(readSpy).not.toHaveBeenCalled();
      expect(component.importError()).toContain('caps');
    });

    it('surfaces the imported file\'s OWN licence terms', async () => {
      const fixture = importTab();
      const component = fixture.componentInstance;
      engine.ready.set(true);
      spyOn(engine, 'importModel').and.resolveTo({
        key: 'import:mine.vrm', kind: 'head', displayName: 'Mine', lane: 'import',
        mounted: true, recolorable: false, surfacesRebound: 0, meshesHidden: 0,
        heightScale: 1, lipSyncChannels: ['visemes'], visemes: true,
        licenseSpdx: '', attribution: 'SomeAuthor', sourceUrl: '', imported: true, error: '',
        ok: true,
        license: {
          title: 'My Avatar', authors: 'SomeAuthor', licenseName: 'CC_BY',
          allowRedistribution: 'Disallow', creditNotation: 'Required',
          redistributionDisallowed: true, creditRequired: true,
        },
      });

      const bytes = new ArrayBuffer(8);
      const file = {
        name: 'mine.vrm',
        size: 8,
        arrayBuffer: () => Promise.resolve(bytes),
      } as unknown as File;
      await component.onImportFile({ target: { files: [file], value: '' } } as unknown as Event);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      const block = el.querySelector('[data-testid="cf-import-license"]')!;
      expect(block).withContext('the licence block renders').not.toBeNull();
      expect(block.textContent).toContain('SomeAuthor');
      expect(block.textContent).toContain('CC_BY');
      expect(block.textContent).toContain('Disallow');
      expect(component.importError()).toBeNull();
      expect(component.status()).toContain('never uploads');
    });

    it('reports an engine-side refusal instead of pretending it loaded', async () => {
      const fixture = importTab();
      const component = fixture.componentInstance;
      engine.ready.set(true);
      spyOn(engine, 'importModel').and.rejectWith(new Error('could not parse mine.glb as glTF'));
      const file = {
        name: 'mine.glb', size: 8, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      } as unknown as File;

      await component.onImportFile({ target: { files: [file], value: '' } } as unknown as Event);

      expect(component.importError()).toContain('could not parse');
      expect(component.importBusy()).toBeFalse();
    });
  });
});
