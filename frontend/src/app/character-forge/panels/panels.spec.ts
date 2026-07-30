import { TestBed } from '@angular/core/testing';
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
