import { TestBed } from '@angular/core/testing';
import { CharacterForgeComponent } from './character-forge.component';
import { EngineBridgeService } from './services/engine-bridge.service';
import { ForgeStateService } from './services/forge-state.service';
import { randomChar3dConfig } from './util/random-config';

/**
 * The forge page: editor state flows to the engine bridge as setConfig
 * envelopes (queued while the export is absent), in-engine edits flow back
 * without ping-ponging, and the seeded randomizer is reproducible end-to-end.
 */
describe('CharacterForgeComponent (forge studio page)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CharacterForgeComponent] });
    // Standalone/dev network state: no engine bundle (404) and no bff_ cookie
    // (401) — the page must boot fine anyway (DESIGN §4).
    spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.startsWith('/bff/')
        ? new Response('unauthorized', { status: 401 })
        : new Response('absent', { status: 404 });
    });
  });

  it('boots without the engine bundle and queues the config for the bridge', async () => {
    const fixture = TestBed.createComponent(CharacterForgeComponent);
    fixture.detectChanges(); // runs effects → pushes the initial config
    await fixture.whenStable();
    fixture.detectChanges();
    const engine = TestBed.inject(EngineBridgeService);
    const state = TestBed.inject(ForgeStateService);
    const pending = engine.pendingMessages();
    expect(pending.length).toBeGreaterThan(0);
    const last = pending[pending.length - 1];
    expect(last.t).toBe('setConfig');
    expect(last.v).toBe(1);
    expect((last as { json: string }).json).toBe(state.definitionJson());
    // the page rendered its panels despite 404 engine + 401 BFF
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="cf-engine-absent"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cf-editor"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cf-saves"]')).not.toBeNull();
  });

  it('randomize() forges the exact config the seed dictates (shareable seeds)', () => {
    const fixture = TestBed.createComponent(CharacterForgeComponent);
    const cmp = fixture.componentInstance;
    const state = TestBed.inject(ForgeStateService);
    cmp.seed.set(777);
    cmp.randomize();
    expect(state.config()).toEqual(randomChar3dConfig(777));
    expect(cmp.status()).toContain('777');
  });

  it('engine → editor: configChanged applies WITHOUT echoing setConfig back', async () => {
    const fixture = TestBed.createComponent(CharacterForgeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const engine = TestBed.inject(EngineBridgeService);
    const state = TestBed.inject(ForgeStateService);
    // The game registers its bridge (fake) — queued messages flush.
    const calls: Array<{ method: string; args: unknown[] }> = [];
    engine.registerBridge({
      setConfig: (json: string) => calls.push({ method: 'setConfig', args: [json] }),
      setExpression: () => void 0,
      setOpenness: () => void 0,
      randomize: () => void 0,
      snapshot: () => '',
    });
    const flushed = calls.length;
    // In-engine edit comes back — canonical JSON identical to what the state
    // will hold after normalize (a stable fixed point).
    const engineConfig = state.config();
    const engineJson = JSON.stringify({ ...engineConfig, name: 'Edited In Engine' });
    const bridge = engine as unknown as { configListener: ((json: string) => void) | null };
    expect(bridge.configListener).not.toBeNull();
    bridge.configListener!(engineJson);
    expect(state.config().name).toBe('Edited In Engine');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // no echo: the effect saw the engine's own JSON and skipped the push-back
    expect(calls.length).toBe(flushed);
  });
});
