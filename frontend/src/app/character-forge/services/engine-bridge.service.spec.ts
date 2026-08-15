import { NgZone } from '@angular/core';
import {
  CharForgeBridge,
  ENGINE_BASE,
  EngineBridgeService,
  base64FromBytes,
} from './engine-bridge.service';

/** Recording fake of the Godot-side CharForge singleton. */
class FakeCharForge implements CharForgeBridge {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  snapshotResult = 'UEZha2VQbmc='; // base64 the engine would return
  onConfigChanged?: (json: string) => void;

  setConfig(json: string): void {
    this.calls.push({ method: 'setConfig', args: [json] });
  }
  setExpression(label: string): void {
    this.calls.push({ method: 'setExpression', args: [label] });
  }
  setOpenness(value: number): void {
    this.calls.push({ method: 'setOpenness', args: [value] });
  }
  randomize(seed: number): void {
    this.calls.push({ method: 'randomize', args: [seed] });
  }
  snapshot(width: number, height: number): string {
    this.calls.push({ method: 'snapshot', args: [width, height] });
    return this.snapshotResult;
  }
  setPack(key: string): void {
    this.calls.push({ method: 'setPack', args: [key] });
  }
  /** Ack now, answer later — exactly how the engine behaves. */
  importModel(base64: string, fileName: string): string {
    this.calls.push({ method: 'importModel', args: [base64, fileName] });
    return this.importAck;
  }
  listPacks(): string {
    this.calls.push({ method: 'listPacks', args: [] });
    return this.packsJson;
  }
  importAck = JSON.stringify({ ok: true, queued: true });
  packsJson = JSON.stringify({ available: true, lanes: [], totals: { entries: 0 } });
  onPackChanged?: (json: string) => void;
  onImportResult?: (json: string) => void;
}

function makeService(): EngineBridgeService {
  return new EngineBridgeService(new NgZone({ enableLongStackTrace: false }));
}

/**
 * The CharForge bridge contract (DESIGN §4): versioned {v:1,t:...} message
 * envelopes, queue-until-ready + FIFO flush, clamped inputs, and the
 * config-changed callback out of the engine.
 */
describe('EngineBridgeService (CharForge bridge)', () => {
  it('queues calls made before the bridge is up as versioned envelopes', () => {
    const svc = makeService();
    svc.setConfig('{"name":"a"}');
    svc.setExpression('smug');
    svc.setOpenness(0.4);
    svc.randomize(1234);
    expect(svc.ready()).toBeFalse();
    expect(svc.pendingMessages()).toEqual([
      { v: 1, t: 'setConfig', json: '{"name":"a"}' },
      { v: 1, t: 'setExpression', label: 'smug' },
      { v: 1, t: 'setOpenness', value: 0.4 },
      { v: 1, t: 'randomize', seed: 1234 },
    ]);
  });

  it('flushes the queue FIFO on registerBridge and marks ready', () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.setConfig('one');
    svc.setExpression('happy');
    svc.setOpenness(1);
    svc.registerBridge(fake);
    expect(svc.ready()).toBeTrue();
    expect(svc.pendingMessages()).toEqual([]);
    expect(fake.calls.map(c => c.method)).toEqual(['setConfig', 'setExpression', 'setOpenness']);
    expect(fake.calls[0].args).toEqual(['one']);
    // post-ready calls go straight through (no re-queue)
    svc.setConfig('two');
    expect(fake.calls[3]).toEqual({ method: 'setConfig', args: ['two'] });
    expect(svc.pendingMessages()).toEqual([]);
  });

  it('clamps openness to the 0..1 amplitude contract (NaN → 0)', () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    svc.setOpenness(7);
    svc.setOpenness(-2);
    svc.setOpenness(Number.NaN);
    svc.setOpenness(0.35);
    expect(fake.calls.map(c => c.args[0])).toEqual([1, 0, 0, 0.35]);
  });

  it("coerces unknown expression labels to 'neutral' (10-label vocabulary)", () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    svc.setExpression('rage');
    svc.setExpression('sleepy');
    expect(fake.calls.map(c => c.args[0])).toEqual(['neutral', 'sleepy']);
  });

  it('coerces the randomize seed to uint32', () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    svc.randomize(-1);
    expect(fake.calls[0].args).toEqual([0xffffffff]);
  });

  it('snapshot REJECTS while the bridge is absent and resolves through it once up', async () => {
    const svc = makeService();
    await expectAsync(svc.snapshot(512, 512)).toBeRejectedWithError(/not ready/);
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    await expectAsync(svc.snapshot(512, 256)).toBeResolvedTo('UEZha2VQbmc=');
    expect(fake.calls[0]).toEqual({ method: 'snapshot', args: [512, 256] });
  });

  it('wires onConfigChanged: the engine calling in reaches the page listener', () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    const received: string[] = [];
    svc.onConfigChanged(json => received.push(json));
    svc.registerBridge(fake);
    expect(fake.onConfigChanged).toBeDefined();
    fake.onConfigChanged!('{"name":"from-engine"}');
    expect(received).toEqual(['{"name":"from-engine"}']);
  });

  it('probe(): absent bundle → status absent (the honest not-present panel state)', async () => {
    const svc = makeService();
    spyOn(window, 'fetch').and.resolveTo(new Response('nope', { status: 404 }));
    await expectAsync(svc.probe()).toBeResolvedTo(false);
    expect(svc.status()).toBe('absent');
    // ABSOLUTE, anchored on this remote's own module chunk — never the bare
    // 'assets/game/index.js', which resolves against the SHELL document when
    // federated and 404s at the shell root. See ./assets-base.
    expect(window.fetch).toHaveBeenCalledWith(`${ENGINE_BASE}index.js`, {
      method: 'HEAD',
      cache: 'no-cache',
    });
    expect(ENGINE_BASE).not.toBe('assets/game/');
    expect(ENGINE_BASE).toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
  });

  it('probe(): present bundle → status loading', async () => {
    const svc = makeService();
    spyOn(window, 'fetch').and.resolveTo(new Response('', { status: 200 }));
    await expectAsync(svc.probe()).toBeResolvedTo(true);
    expect(svc.status()).toBe('loading');
  });

  it('probe(): network failure degrades to absent (never throws)', async () => {
    const svc = makeService();
    spyOn(window, 'fetch').and.rejectWith(new TypeError('offline'));
    await expectAsync(svc.probe()).toBeResolvedTo(false);
    expect(svc.status()).toBe('absent');
  });
});

/**
 * The pack + BYO-import half of the bridge (DESIGN §4 additions): mounting a
 * catalogue model, and handing the engine a user's own file without it ever
 * touching the network.
 */
describe('EngineBridgeService (packs + BYO import)', () => {
  const REPORT = {
    key: 'monster-dragon', kind: 'head', displayName: 'Dragon', lane: 'monsters',
    mounted: true, recolorable: true, surfacesRebound: 3, meshesHidden: 0,
    heightScale: 1.1, lipSyncChannels: ['strip'], visemes: false,
    licenseSpdx: 'CC0-1.0', attribution: 'Quaternius', sourceUrl: 'https://quaternius.com',
    imported: false, error: '',
  };

  it('queues setPack before the bridge is up and flushes it in order', () => {
    const svc = makeService();
    svc.setPack('monster-dragon');
    expect(svc.pendingMessages()).toEqual([{ v: 1, t: 'setPack', key: 'monster-dragon' }]);

    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    expect(fake.calls).toEqual([{ method: 'setPack', args: ['monster-dragon'] }]);
  });

  it('publishes the engine mount report as a signal', () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    expect(svc.mountReport()).toBeNull();

    fake.onPackChanged!(JSON.stringify(REPORT));
    expect(svc.mountReport()!.displayName).toBe('Dragon');
    expect(svc.mountReport()!.recolorable).toBeTrue();

    // A malformed payload must not poison the signal.
    fake.onPackChanged!('not json');
    expect(svc.mountReport()).toBeNull();
  });

  it('importModel hands over BYTES and resolves on the engine callback', async () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);

    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer; // "glTF"
    const pending = svc.importModel(bytes, 'mine.vrm');
    const call = fake.calls.find(c => c.method === 'importModel')!;
    expect(call).withContext('the engine was called').toBeDefined();
    expect(call.args[0]).toBe('Z2xURg==');
    expect(call.args[1]).toBe('mine.vrm');

    fake.onImportResult!(JSON.stringify({ ...REPORT, ok: true, imported: true,
      license: { authors: 'Someone' } }));
    const report = await pending;
    expect(report.imported).toBeTrue();
    expect(report.license!['authors']).toBe('Someone');
    expect(svc.mountReport()!.imported).toBeTrue();
  });

  it('importModel rejects when the engine refuses the ACK outright', async () => {
    const svc = makeService();
    const fake = new FakeCharForge();
    fake.importAck = JSON.stringify({ ok: false, reason: 'over the 25165824-byte runtime cap' });
    svc.registerBridge(fake);
    await expectAsync(svc.importModel(new ArrayBuffer(4), 'huge.vrm'))
      .toBeRejectedWithError(/runtime cap/);
  });

  it('importModel rejects without a live bridge (nothing to import into)', async () => {
    const svc = makeService();
    await expectAsync(svc.importModel(new ArrayBuffer(4), 'mine.vrm'))
      .toBeRejectedWithError('engine bridge not ready');
  });

  it('base64FromBytes survives a payload far past the call-argument limit', () => {
    // String.fromCharCode(...bytes) throws RangeError around 100k arguments;
    // a 20 MB avatar is 20 million. The chunked encoder must not.
    const size = 300_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = i & 0xff;
    }
    const encoded = base64FromBytes(bytes.buffer);
    expect(encoded.length).toBe(Math.ceil(size / 3) * 4);
    // Round-trips to the same bytes.
    const decoded = atob(encoded);
    expect(decoded.length).toBe(size);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(size - 1)).toBe((size - 1) & 0xff);
  });

  it('listPacks returns the engine catalogue, or null when the bridge is down', () => {
    const svc = makeService();
    expect(svc.listPacks()).toBeNull();
    const fake = new FakeCharForge();
    svc.registerBridge(fake);
    expect((svc.listPacks() as Record<string, unknown>)['available']).toBeTrue();
  });
});
