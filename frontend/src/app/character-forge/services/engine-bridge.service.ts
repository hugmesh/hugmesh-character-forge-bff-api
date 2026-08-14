import { Injectable, NgZone, signal } from '@angular/core';
import { EXPRESSIONS, ForgeExpression } from '../models/char3d-config';

/**
 * The JS surface the Godot game registers on `window` via its JavaScriptBridge
 * glue (godot/character-forge — singleton `CharForge`, DESIGN §4):
 * in: setConfig(json), setExpression(label), setOpenness(float),
 * randomize(seed), snapshot(w,h) → base64 PNG; out: the game invokes
 * `onConfigChanged(json)` (assigned by this page) whenever the in-engine
 * editor mutates the config.
 */
export interface CharForgeBridge {
  setConfig(json: string): void;
  setExpression(label: string): void;
  setOpenness(value: number): void;
  randomize(seed: number): void;
  snapshot(width: number, height: number): string;
  /** Mount a catalogue entry by key; '' returns to the procedural avatar. */
  setPack?(key: string): void;
  /**
   * Load a user's own VRM/GLB from base64 bytes. The bytes go straight into
   * WASM memory — they are never uploaded, and the outcome (with the file's own
   * licence metadata) comes back through onImportResult.
   */
  importModel?(base64: string, fileName: string): string;
  /** The engine's view of the vendored catalogue, as JSON. */
  listPacks?(): string;
  /** Assigned by the page; the engine calls it with the updated config JSON. */
  onConfigChanged?: (json: string) => void;
  /** Assigned by the page; the mount report after setPack. */
  onPackChanged?: (json: string) => void;
  /** Assigned by the page; the mount report (+ licence) after importModel. */
  onImportResult?: (json: string) => void;
}

/**
 * What the engine reports after mounting a model — the honest capability note
 * the selector shows: can this model be recoloured at all, which lip-sync
 * channel did it land on, and whose work is it.
 */
export interface PackMountReport {
  key: string;
  kind: string;
  displayName: string;
  lane: string;
  mounted: boolean;
  recolorable: boolean;
  surfacesRebound: number;
  meshesHidden: number;
  heightScale: number;
  lipSyncChannels: string[];
  visemes: boolean;
  licenseSpdx: string;
  attribution: string;
  sourceUrl: string;
  imported: boolean;
  error: string;
  /** Only on an import: the file's OWN in-file terms (VRM metadata). */
  license?: Record<string, string | boolean>;
  ok?: boolean;
  reason?: string;
  fileName?: string;
  bytes?: number;
}

/**
 * Versioned message envelope for calls INTO the engine. Calls made before the
 * bridge is up are queued as envelopes and flushed FIFO once the game registers
 * `window.CharForge` — so the editor can drive the preview from first paint
 * without racing the 30s+ WASM boot. (Same {v:1,t:...} envelope convention as
 * the matrix-ui Chat3D postMessage protocol.)
 */
export type ForgeBridgeMessage =
  | { v: 1; t: 'setConfig'; json: string }
  | { v: 1; t: 'setExpression'; label: ForgeExpression }
  | { v: 1; t: 'setOpenness'; value: number }
  | { v: 1; t: 'randomize'; seed: number }
  | { v: 1; t: 'setPack'; key: string };

/** Where the Godot web export is baked (same-origin remote asset, DESIGN §4). */
export const ENGINE_BASE = 'assets/game/';
/** Export basename — `index.{js,pck,wasm,side.wasm}` (games-repo convention). */
export const ENGINE_EXECUTABLE = 'index';

export type EngineStatus = 'unknown' | 'absent' | 'loading' | 'running' | 'error';

/** How long to wait for the game to register window.CharForge after boot. */
const BRIDGE_POLL_INTERVAL_MS = 250;
const BRIDGE_POLL_TIMEOUT_MS = 60_000;
/** How long an importModel may take before the UI stops waiting on it. */
const IMPORT_TIMEOUT_MS = 30_000;

function safeJson(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseReport(json: string): PackMountReport | null {
  const raw = safeJson(json);
  return raw === null ? null : (raw as unknown as PackMountReport);
}

/**
 * ArrayBuffer → base64 without blowing the argument limit on a 20 MB avatar
 * (String.fromCharCode(...bytes) throws RangeError well below that).
 */
export function base64FromBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Loads the Godot web export via the Engine JS API (same-origin
 * `assets/game/index.js`, threads OFF so no COOP/COEP is needed inside the
 * host) and speaks the `CharForge` JavaScriptBridge contract. The engine
 * bundle is baked into assets/game/ by the export step AFTER this frontend is
 * authored — {@link probe} detects its absence so the page renders the honest
 * "engine bundle not present" panel instead of a broken canvas (the
 * matrix-ui `turnAvailable` capability-note precedent).
 */
@Injectable({ providedIn: 'root' })
export class EngineBridgeService {
  readonly status = signal<EngineStatus>('unknown');
  /** True once window.CharForge is registered and queued messages flushed. */
  readonly ready = signal(false);
  /** Human-readable boot error for the status region (null when none). */
  readonly error = signal<string | null>(null);

  /** The mount report for whatever the engine last put on stage (null = none). */
  readonly mountReport = signal<PackMountReport | null>(null);

  private bridge: CharForgeBridge | null = null;
  private readonly queue: ForgeBridgeMessage[] = [];
  private configListener: ((json: string) => void) | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private importResolve: ((report: PackMountReport) => void) | null = null;

  constructor(private readonly zone: NgZone) {}

  /**
   * HEAD-probe the engine bundle. False ⇒ the export is not baked (dev /
   * pre-export image) and the caller shows the "engine bundle not present"
   * panel; nothing else is attempted so the page still boots fine.
   */
  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${ENGINE_BASE}${ENGINE_EXECUTABLE}.js`, {
        method: 'HEAD',
        cache: 'no-cache',
      });
      const present = res.ok;
      this.status.set(present ? 'loading' : 'absent');
      return present;
    } catch {
      this.status.set('absent');
      return false;
    }
  }

  /**
   * Boot the engine into `canvas`: inject the export's `index.js` (defines the
   * global `Engine` class), start the game single-threaded, then poll for the
   * game's `window.CharForge` registration and flush the queued envelopes.
   * Resolves once the game is RUNNING (bridge readiness continues async).
   */
  async load(canvas: HTMLCanvasElement): Promise<void> {
    try {
      // The canvas MUST carry a non-empty id before startGame().
      //
      // Godot's web glue builds its lookup as `document.querySelector('#' +
      // config.canvas.id)`. With an id-less canvas that is the bare string '#',
      // which is not a valid selector: querySelector THROWS SyntaxError, the
      // startGame() promise rejects, window.CharForge is never defined, and
      // engine.ready() stays false — so the 3D preview never appears and
      // "Snapshot PNG" stays disabled. Live symptom (operator report
      // 2026-08-14, "the webgl isn't working"): [data-testid=cf-engine-error]
      // reading "'#' is not a valid selector" with the WASM already fetched
      // 200. Stamped here rather than in the template so the guarantee sits on
      // the boot path itself and cannot be lost to a template edit.
      if (!canvas.id) {
        canvas.id = 'cf-engine-canvas';
      }
      await this.injectScript(`${ENGINE_BASE}${ENGINE_EXECUTABLE}.js`);
      const engineCtor = (window as unknown as Record<string, unknown>)['Engine'] as
        | (new (cfg: Record<string, unknown>) => { startGame(opts?: Record<string, unknown>): Promise<void> })
        | undefined;
      if (!engineCtor) {
        throw new Error('engine script loaded but no Engine global');
      }
      // Threads OFF (DESIGN §0 web preset) — no COOP/COEP needed in the host.
      const engine = new engineCtor({
        executable: `${ENGINE_BASE}${ENGINE_EXECUTABLE}`,
        canvas,
        canvasResizePolicy: 2,
        focusCanvas: false,
        args: [],
      });
      // Long WASM compiles happen outside Angular's zone (no CD churn).
      await this.zone.runOutsideAngular(() => engine.startGame());
      this.status.set('running');
      this.pollForBridge();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.zone.run(() => {
        this.status.set('error');
        this.error.set(`Engine failed to start: ${msg}`);
      });
      throw e;
    }
  }

  /**
   * Register the live bridge (called by the poller when the game publishes
   * `window.CharForge`; tests call it directly with a fake). Wires the
   * config-changed callback and flushes the queued envelopes FIFO.
   */
  registerBridge(bridge: CharForgeBridge): void {
    this.stopPolling();
    this.bridge = bridge;
    bridge.onConfigChanged = (json: string) => {
      // The engine calls in from outside Angular — re-enter the zone.
      this.zone.run(() => this.configListener?.(json));
    };
    bridge.onPackChanged = (json: string) => {
      this.zone.run(() => this.mountReport.set(parseReport(json)));
    };
    bridge.onImportResult = (json: string) => {
      this.zone.run(() => {
        const report = parseReport(json);
        this.mountReport.set(report);
        const resolve = this.importResolve;
        this.importResolve = null;
        if (report) {
          resolve?.(report);
        }
      });
    };
    const pending = this.queue.splice(0, this.queue.length);
    for (const msg of pending) {
      this.dispatch(msg);
    }
    this.ready.set(true);
  }

  /** Subscribe to in-engine edits (config JSON out of the game). */
  onConfigChanged(listener: (json: string) => void): void {
    this.configListener = listener;
  }

  /** Snapshot of the envelopes queued while the bridge is down (diagnostics/tests). */
  pendingMessages(): readonly ForgeBridgeMessage[] {
    return [...this.queue];
  }

  /** Push the full Char3DConfig JSON into the engine (queued until ready). */
  setConfig(json: string): void {
    this.send({ v: 1, t: 'setConfig', json });
  }

  /** Preview one of the 10 canonical expressions; unknown labels → 'neutral'. */
  setExpression(label: string): void {
    const safe: ForgeExpression = (EXPRESSIONS as readonly string[]).includes(label)
      ? (label as ForgeExpression)
      : 'neutral';
    this.send({ v: 1, t: 'setExpression', label: safe });
  }

  /** Drive the jaw with mouth openness, clamped to the 0..1 amplitude contract. */
  setOpenness(value: number): void {
    const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    this.send({ v: 1, t: 'setOpenness', value: clamped });
  }

  /** In-engine seeded randomize (same seed as the local mirror for parity). */
  randomize(seed: number): void {
    this.send({ v: 1, t: 'randomize', seed: seed >>> 0 });
  }

  /**
   * Mount a catalogue model by key ('' returns to the procedural avatar).
   * Queued like every other setter, so the selector works from first paint.
   */
  setPack(key: string): void {
    this.send({ v: 1, t: 'setPack', key });
  }

  /**
   * BYO avatar: hand the engine the bytes of a file the USER picked.
   *
   * The bytes are read in the browser, base64'd, and passed into WASM memory.
   * They are never sent to the BFF and never persisted — the only thing that
   * can be saved is the parametric Char3DConfig, which contains no geometry.
   * Requires a live bridge (rejects when the engine bundle is absent), and
   * resolves with the engine's report including the file's own licence block.
   */
  async importModel(bytes: ArrayBuffer, fileName: string): Promise<PackMountReport> {
    const bridge = this.bridge;
    if (!bridge || typeof bridge.importModel !== 'function') {
      throw new Error('engine bridge not ready');
    }
    const ack = bridge.importModel(base64FromBytes(bytes), fileName);
    const parsedAck = safeJson(ack);
    if (parsedAck && parsedAck['ok'] === false) {
      throw new Error(String(parsedAck['reason'] ?? 'import refused'));
    }
    // The parse itself is asynchronous inside the engine; onImportResult is the
    // completion. Time-boxed so a wedged engine cannot leave the UI spinning.
    return new Promise<PackMountReport>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.importResolve) {
          this.importResolve = null;
          reject(new Error('the engine did not answer the import in time'));
        }
      }, IMPORT_TIMEOUT_MS);
      this.importResolve = report => {
        clearTimeout(timer);
        resolve(report);
      };
    });
  }

  /** The engine's own catalogue view (null when the bridge is down). */
  listPacks(): unknown | null {
    const bridge = this.bridge;
    if (!bridge || typeof bridge.listPacks !== 'function') {
      return null;
    }
    return safeJson(bridge.listPacks());
  }

  /**
   * Snapshot the current character as PNG bytes (base64) for avatar/sticker
   * reuse. Unlike the fire-and-forget setters this REQUIRES a live bridge —
   * rejects when the engine is absent/not ready.
   */
  async snapshot(width: number, height: number): Promise<string> {
    if (!this.bridge) {
      throw new Error('engine bridge not ready');
    }
    return this.bridge.snapshot(width, height);
  }

  private send(msg: ForgeBridgeMessage): void {
    if (this.bridge) {
      this.dispatch(msg);
    } else {
      this.queue.push(msg);
    }
  }

  private dispatch(msg: ForgeBridgeMessage): void {
    const bridge = this.bridge;
    if (!bridge) {
      return;
    }
    switch (msg.t) {
      case 'setConfig':
        bridge.setConfig(msg.json);
        break;
      case 'setExpression':
        bridge.setExpression(msg.label);
        break;
      case 'setOpenness':
        bridge.setOpenness(msg.value);
        break;
      case 'randomize':
        bridge.randomize(msg.seed);
        break;
      case 'setPack':
        bridge.setPack?.(msg.key);
        break;
    }
  }

  private pollForBridge(): void {
    const startedAt = Date.now();
    this.stopPolling();
    this.zone.runOutsideAngular(() => {
      this.pollHandle = setInterval(() => {
        const candidate = (window as unknown as Record<string, unknown>)['CharForge'] as
          | CharForgeBridge
          | undefined;
        if (candidate && typeof candidate.setConfig === 'function') {
          this.zone.run(() => this.registerBridge(candidate));
        } else if (Date.now() - startedAt > BRIDGE_POLL_TIMEOUT_MS) {
          this.stopPolling();
          this.zone.run(() =>
            this.error.set('Engine started but the CharForge bridge never registered.'),
          );
        }
      }, BRIDGE_POLL_INTERVAL_MS);
    });
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private injectScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`failed to load ${src}`));
      document.body.appendChild(script);
    });
  }
}
