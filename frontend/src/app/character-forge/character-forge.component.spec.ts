import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  CharacterForgeComponent,
  SET_CONFIG_DEBOUNCE_MS,
} from './character-forge.component';
import { CharForgeBridge, EngineBridgeService } from './services/engine-bridge.service';
import { ForgeStateService } from './services/forge-state.service';
import { randomChar3dConfig } from './util/random-config';

/**
 * A fake CharForge bridge that records, in order, everything the page asks the
 * engine to do — and, for a snapshot, WHICH CONFIG the engine was holding when
 * it was asked. That last part is the whole point: a snapshot taken while an
 * edit is still sitting in the debounce window captures the character as it was
 * before the edit, and only the engine's own view can prove otherwise.
 */
function recordingBridge(log: string[]): CharForgeBridge {
  let held: string | null = null;
  const axes = (json: string | null): string => {
    if (json === null) {
      return 'nothing';
    }
    const body = (JSON.parse(json) as { body: { curve: number; top: number } }).body;
    return `curve=${body.curve} top=${body.top}`;
  };
  return {
    setConfig: (json: string) => {
      held = json;
      log.push(`setConfig[${axes(json)}]`);
    },
    setExpression: () => void 0,
    setOpenness: () => void 0,
    randomize: () => void 0,
    snapshot: () => {
      log.push(`snapshot[${axes(held)}]`);
      return ''; // not a PNG — useEverywhere()/snapshot() fail closed on it
    },
  };
}

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

/**
 * The 80ms trailing debounce on the editor → engine push, and its two edges.
 *
 * The debounce itself is a real requirement — `setConfig` tears down and
 * rebuilds 40-60 primitives, so one push per slider tick is unusable — but it
 * shipped untested, and a trailing debounce has a nasty failure mode: the
 * pending push is CANCELLED on component destroy, so an edit made within 80ms
 * of navigating away used to vanish (the engine bridge is a root singleton and
 * keeps rendering the stale character), and a snapshot taken inside the same
 * window captured a config one edit behind what the page was showing.
 *
 * The decision was to FLUSH rather than drop, on destroy and before every
 * capture. A dropped edit has no upside: the work is already done, the value is
 * already clamped, and the only thing cancelling saves is one rebuild of a rig
 * nobody is looking at any more.
 */
describe('CharacterForgeComponent (setConfig debounce + flush edges)', () => {
  let log: string[];
  let state: ForgeStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CharacterForgeComponent] });
    spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) =>
      String(input).startsWith('/bff/')
        ? new Response('unauthorized', { status: 401 })
        : new Response('absent', { status: 404 }));
    log = [];
    state = TestBed.inject(ForgeStateService);
    state.reset();
    // A live bridge from the start, so every push lands synchronously in `log`
    // instead of in the pre-boot queue.
    TestBed.inject(EngineBridgeService).registerBridge(recordingBridge(log));
  });

  /** A page with its initial config already pushed and the log cleared. */
  function settledPage() {
    const fixture = TestBed.createComponent(CharacterForgeComponent);
    fixture.detectChanges();              // first effect run arms the initial push
    tick(SET_CONFIG_DEBOUNCE_MS);
    log.length = 0;
    return fixture;
  }

  it('coalesces a slider DRAG into exactly one push, carrying the last value', fakeAsync(() => {
    const fixture = settledPage();

    // Five ticks of a Curve drag, each well inside the window.
    for (const v of [0.55, 0.6, 0.65, 0.7, 0.75]) {
      state.setCurve(v);
      fixture.detectChanges();
      tick(10);
    }
    expect(log).withContext('nothing is pushed mid-drag').toEqual([]);

    tick(SET_CONFIG_DEBOUNCE_MS);
    expect(log).toEqual(['setConfig[curve=0.75 top=0.5]']);

    fixture.destroy();
  }));

  it('FLUSHES an edit made inside the window when the page is destroyed', fakeAsync(() => {
    const fixture = settledPage();

    state.setTop(0.9);
    state.setCurve(0.2);
    fixture.detectChanges();
    tick(10);                              // still inside the debounce window
    expect(log).withContext('the push is still pending').toEqual([]);

    fixture.destroy();                     // the user navigates away

    // Both edits, in the shape the state store settled on — not the pre-edit
    // config, and not nothing at all.
    expect(log).withContext('the pending edit is delivered, not dropped').toEqual(
      ['setConfig[curve=0.2 top=0.9]']);
    // No timer outlives the page either — fakeAsync fails the spec if one does.
  }));

  it('destroying a SETTLED page pushes nothing (the flush is not a re-push)', fakeAsync(() => {
    const fixture = settledPage();
    state.setCurve(0.35);
    fixture.detectChanges();
    tick(SET_CONFIG_DEBOUNCE_MS);
    expect(log).toEqual(['setConfig[curve=0.35 top=0.5]']);

    fixture.destroy();
    expect(log).toEqual(['setConfig[curve=0.35 top=0.5]']);
  }));

  it('a capture is never one edit stale: the flush precedes engine.snapshot()', fakeAsync(() => {
    const fixture = settledPage();
    const cmp = fixture.componentInstance;

    state.setCurve(0.15);
    fixture.detectChanges();
    tick(10);                              // "adjust the slider, click immediately"
    expect(log).toEqual([]);

    // Fire and forget: useEverywhere() runs synchronously as far as the engine
    // call, which is all this assertion is about (its async tail fails closed on
    // the fake's empty frame and is not what is under test).
    void cmp.useEverywhere();

    expect(log).toEqual([
      'setConfig[curve=0.15 top=0.5]',
      'snapshot[curve=0.15 top=0.5]',
    ]);
    // Before the flush existed the engine still held curve=0.5 at capture time,
    // so the avatar the mesh received was not the character on screen.

    fixture.destroy();
  }));

  it('the same flush guards the PNG download path', fakeAsync(() => {
    const fixture = settledPage();
    const cmp = fixture.componentInstance;
    state.setCurve(0.45);
    fixture.detectChanges();
    tick(10);

    void cmp.snapshot();

    expect(log).toEqual([
      'setConfig[curve=0.45 top=0.5]',
      'snapshot[curve=0.45 top=0.5]',
    ]);
    fixture.destroy();
  }));
});
