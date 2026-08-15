import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfigEditorComponent } from './config-editor.component';
import { EngineCanvasComponent } from './engine-canvas.component';
import { ImportVnComponent } from './import-vn.component';
import { ForgeStateService } from '../services/forge-state.service';

/**
 * Panel behaviours that carry the DESIGN §4 contract:
 * - the forge page must BOOT FINE without the Godot export and show the honest
 *   "engine bundle not present" panel (the export is baked later);
 * - import-from-VN accepts pasted/stashed VnCharacter JSON and maps it into
 *   the live config via the client-side mirror.
 */
describe('EngineCanvasComponent (engine bundle not present)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [EngineCanvasComponent] });
  });

  it('renders the honest not-present panel when the probe finds no bundle', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('nope', { status: 404 }));
    const fixture = TestBed.createComponent(EngineCanvasComponent);
    fixture.detectChanges(); // ngAfterViewInit fires the probe
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const panel = el.querySelector('[data-testid="cf-engine-absent"]');
    expect(panel).withContext('absent panel must render').not.toBeNull();
    expect(panel!.textContent).toContain('Engine bundle not present');
    // no broken canvas is left behind, and no error is shown (absence ≠ fault)
    expect(el.querySelector('[data-testid="cf-engine-canvas"]')).toBeNull();
    expect(el.querySelector('[data-testid="cf-engine-error"]')).toBeNull();
  });

  it('keeps the canvas + loading note when the bundle probe succeeds', async () => {
    // Probe HEAD ok; the engine script itself is NOT loaded in unit tests, so
    // load() fails — the canvas stays and the failure surfaces in the error
    // region (a real fault, unlike absence).
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 200 }));
    const fixture = TestBed.createComponent(EngineCanvasComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="cf-engine-absent"]')).toBeNull();
    expect(el.querySelector('[data-testid="cf-engine-canvas"]')).not.toBeNull();
  });
});

describe('ImportVnComponent (import-from-VN)', () => {
  const VN_JSON = JSON.stringify({
    schemaVersion: 1,
    packId: 'menagerie-v1',
    name: 'Stashed Wolf',
    slots: { head: 'head_wolf_01', tail: 'tail_wolf_bushy_01' },
    palette: { fur: '#112233' },
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    defaultExpression: 'happy',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImportVnComponent] });
  });

  afterEach(() => {
    window.localStorage.removeItem('cf-spec-vn');
    window.localStorage.removeItem('cf-spec-noise');
  });

  it('previewLocally maps pasted VN JSON into the live config (client mirror)', () => {
    const fixture = TestBed.createComponent(ImportVnComponent);
    const cmp = fixture.componentInstance;
    const state = TestBed.inject(ForgeStateService);
    cmp.text.set(VN_JSON);
    cmp.previewLocally();
    expect(cmp.error()).toBeNull();
    const cfg = state.config();
    expect(cfg.name).toBe('Stashed Wolf');
    expect(cfg.head.family).toBe('canid');
    expect(cfg.parts.tail).toBe('tail_wolf_bushy_01');
    expect(cfg.materials.fur).toBe('#112233');
    expect(cfg.source!.defaultExpression).toBe('happy');
  });

  it('rejects non-VN JSON with a visible error and leaves the config untouched', () => {
    const fixture = TestBed.createComponent(ImportVnComponent);
    const cmp = fixture.componentInstance;
    const state = TestBed.inject(ForgeStateService);
    const before = state.config();
    cmp.text.set('{"hello":"world"}');
    cmp.previewLocally();
    expect(cmp.error()).toContain('not a VN character');
    expect(state.config()).toBe(before);
    cmp.text.set('{not json');
    cmp.previewLocally();
    expect(cmp.error()).toContain('not a VN character');
  });

  it('loadFromBrowser finds a stashed VnCharacter in localStorage (skipping noise)', () => {
    window.localStorage.setItem('cf-spec-noise', 'just a string');
    window.localStorage.setItem('cf-spec-vn', VN_JSON);
    const fixture = TestBed.createComponent(ImportVnComponent);
    const cmp = fixture.componentInstance;
    cmp.loadFromBrowser();
    expect(cmp.text()).toBe(VN_JSON);
    expect(cmp.status()).toContain('cf-spec-vn');
  });

  it('loadFromBrowser reports softly when nothing is stashed', () => {
    const fixture = TestBed.createComponent(ImportVnComponent);
    const cmp = fixture.componentInstance;
    // Only guaranteed-non-VN entries present (none we control): report, no throw.
    cmp.loadFromBrowser();
    if (cmp.text() === '') {
      expect(cmp.status()).toContain('No VN character found');
    }
    expect(cmp.error()).toBeNull();
  });
});

/**
 * The UI half of the body.curve / body.top shape axes.
 *
 * Written because the axes shipped with none: the two `<input>` blocks could
 * have been deleted outright and every spec in the repo would still have gone
 * green, which is the same thing as having no slider. So this asserts the
 * controls EXIST, carry the 0..1 contract the store and the server clamp to,
 * show the live value, and write back on `input` — the four things a user
 * actually depends on.
 */
describe('ConfigEditorComponent (body shape axes)', () => {
  let state: ForgeStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ConfigEditorComponent] });
    state = TestBed.inject(ForgeStateService);
    state.reset();
  });

  function editor(): { fixture: ComponentFixture<ConfigEditorComponent>; el: HTMLElement } {
    const fixture = TestBed.createComponent(ConfigEditorComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const AXES: Array<{ testid: string; label: string; field: 'curve' | 'top' }> = [
    { testid: 'cf-curve', label: 'Curve', field: 'curve' },
    { testid: 'cf-top', label: 'Top', field: 'top' },
  ];

  for (const axis of AXES) {
    it(`renders the ${axis.label} slider over the 0..1 clamp contract`, () => {
      const { el } = editor();
      const input = el.querySelector<HTMLInputElement>(`[data-testid="${axis.testid}"]`);
      expect(input).withContext(`${axis.testid} must render`).not.toBeNull();
      expect(input!.type).toBe('range');
      // The bounds are not cosmetic: they are the range the state mirror and
      // Char3DConfigValidator both clamp to, so a widened slider would silently
      // produce values the server rewrites.
      expect(input!.min).toBe('0');
      expect(input!.max).toBe('1');
      expect(input!.step).toBe('0.05');
      expect(input!.getAttribute('aria-label')).toBeTruthy();
      // The visible name, so the two axes cannot be swapped unnoticed.
      expect(input!.closest('label')!.textContent).toContain(axis.label);
    });

    it(`the ${axis.label} slider shows the live config and writes edits back`, () => {
      const { fixture, el } = editor();
      const input = el.querySelector<HTMLInputElement>(`[data-testid="${axis.testid}"]`)!;
      // Starts at the centred stop — the value defined to reproduce the
      // pre-axis silhouette.
      expect(input.value).toBe('0.5');

      // Config → UI.
      state.applyConfig({ ...state.config(), body: { ...state.config().body, [axis.field]: 0.8 } });
      fixture.detectChanges();
      expect(input.value).toBe('0.8');

      // UI → config, through the store's clamp mirror.
      input.value = '0.25';
      input.dispatchEvent(new Event('input'));
      expect(state.config().body[axis.field]).toBe(0.25);
      // ...and only that axis moved: the other one is still at its default.
      const other = axis.field === 'curve' ? 'top' : 'curve';
      expect(state.config().body[other]).toBe(0.5);
      expect(state.config().body.build).toBe(0.5);
    });
  }
});
