import { Injectable, NgZone, signal } from '@angular/core';
import { EXPRESSIONS, ForgeExpression } from '../models/char3d-config';
import { resolveAssetsBase } from './assets-base';

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
  /** Replace the rig adjustments live (no rebuild); the engine echoes onConfigChanged. */
  setRig?(json: string): void;
  /** Fit the rig to the built head; the engine echoes the result via onConfigChanged. */
  autoAdjustRig?(): void;
  /** Turntable spin — a preview control, so it lives in the host like every other. */
  setAutoRotate?(on: boolean): void;
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
  /**
   * Single-atlas characters (the KayKit lines) recolour PER MESH NODE through
   * their baked atlas rather than by rebinding material slots. These say how
   * much of the character that actually reached: `atlasRegions` is what
   * recoloured, `atlasSkipped` the parts deliberately left on vendor colours
   * because they mix two materials and no single region colour would be right.
   */
  atlasRegionsBound?: number;
  atlasRegions?: { node: string; region: string; coverage: number; source: string }[];
  atlasSkipped?: string[];
  /**
   * For a model with NO per-part boundary (the 100Avatars line): the base
   * colours measured out of its atlas and the region each one drives. `share`
   * is the fraction of texels that classify to it, so these sum to 1.
   */
  atlasClusters?: { color: string; region: string; share: number }[];
  /**
   * Set when a SECOND vendored model's head was split off by bone weight and
   * grafted onto this body. It carries its own licence because it is a separate
   * third-party asset visible in the same avatar — crediting only the body
   * would under-report what is on screen.
   */
  headDonor?: {
    key: string;
    displayName: string;
    packId: string;
    triangles: number;
    vertices: number;
    seamTriangles: number;
    joints: string[];
    alignedTo: string;
    lateralPairs: number;
    heightScale: number;
    licenseSpdx: string;
    attribution: string;
    sourceUrl: string;
    retrievedAt: string;
  };
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
  | { v: 1; t: 'setPack'; key: string }
  | { v: 1; t: 'setRig'; json: string }
  | { v: 1; t: 'autoAdjustRig' }
  | { v: 1; t: 'setAutoRotate'; on: boolean };

/**
 * Where the Godot web export is baked, as an ABSOLUTE URL anchored on THIS
 * remote's own module chunk (DESIGN §4).
 *
 * It was the bare relative string `'assets/game/'` until it was measured under
 * the host shell: a relative asset URL resolves against the DOCUMENT, which when
 * federated is the SHELL at `/character-forge` (no trailing slash), so every
 * engine asset was requested from the shell root and 404'd. probe() then
 * reported the bundle absent and the page rendered the "engine bundle not
 * present" panel — the 3D preview simply missing, with no error to find. See
 * ./assets-base for the full derivation, including why fixing the `<script src>`
 * alone would NOT have been enough (the Engine's locateFile override routes the
 * .pck/.wasm/.side.wasm and both audio worklets through `executable`, never
 * through the script's directory).
 */
export const ENGINE_BASE = resolveAssetsBase('assets/game/');
/** Export basename — `index.{js,pck,wasm,side.wasm}` (games-repo convention). */
export const ENGINE_EXECUTABLE = 'index';

export type EngineStatus = 'unknown' | 'absent' | 'loading' | 'running' | 'error';

/** How long to wait for the game to register window.CharForge after boot. */
const BRIDGE_POLL_INTERVAL_MS = 250;
const BRIDGE_POLL_TIMEOUT_MS = 60_000;
/** How long an importModel may take before the UI stops waiting on it. */
const IMPORT_TIMEOUT_MS = 30_000;
/** Drawing-buffer ceiling per side — see {@link EngineBridgeService.sizeCanvas}. */
const MAX_BUFFER_PX = 2048;
/** Buffer side used when the canvas is measured before layout (box still 0). */
const FALLBACK_CANVAS_PX = 512;
/** How long to wait for the engine's verdict on a setPack before giving up. */
const PACK_TIMEOUT_MS = 15_000;

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
  private resizeObserver: ResizeObserver | null = null;
  private importResolve: ((report: PackMountReport) => void) | null = null;
  private packResolve: ((report: PackMountReport) => void) | null = null;

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
      // The drawing buffer is OURS to size, because the policy below tells Godot
      // not to touch it. Done before startGame so the first frame is already the
      // right shape rather than a 300x150 default that pops on the first resize.
      this.sizeCanvas(canvas);
      this.observeCanvasSize(canvas);
      // Threads OFF (DESIGN §0 web preset) — no COOP/COEP needed in the host.
      const engine = new engineCtor({
        executable: `${ENGINE_BASE}${ENGINE_EXECUTABLE}`,
        canvas,
        // POLICY 0 — "Godot won't do any resizing" (the web glue's own wording;
        // it is the setting for a canvas whose size the page controls).
        //
        // It was 2, which is "adapt the canvas size to match the WHOLE BROWSER
        // WINDOW" — the full-page-game setting. On an embedded preview panel
        // that is not merely wrong-sized, it is invisible: Godot stamps
        //     position: absolute; top: 0; left: 0; width: 1280px; height: 720px
        // onto the canvas, which takes it OUT OF FLOW, so .engine-host collapses
        // to the 2px of its own top+bottom border — and because .engine-host is
        // `overflow: hidden`, the (correctly rendered) canvas is then clipped
        // away entirely. Measured in the browser, not inferred: the canvas box
        // was 1280x504 while its parent was 616x2.
        //
        // That is the whole of "the WebGL window doesn't load": the engine boots
        // fine, WebGL2 is fine, the bridge registers, and the picture is clipped
        // to a 2-pixel strip. There is no error anywhere, which is why it read
        // as a load failure rather than a layout one.
        canvasResizePolicy: 0,
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
      this.zone.run(() => {
        const report = parseReport(json);
        this.mountReport.set(report);
        const resolve = this.packResolve;
        this.packResolve = null;
        if (report) {
          resolve?.(report);
        }
      });
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

  /** Push only the rig — the engine re-poses without rebuilding, so a slider is live. */
  setRig(rig: unknown): void {
    this.send({ v: 1, t: 'setRig', json: JSON.stringify(rig ?? {}) });
  }

  /** Ask the engine to fit the rig to the head it built; the result comes back as a config change. */
  autoAdjustRig(): void {
    this.send({ v: 1, t: 'autoAdjustRig' });
  }

  setAutoRotate(on: boolean): void {
    this.send({ v: 1, t: 'setAutoRotate', on: !!on });
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
   * The engine's VERDICT on the pack just requested — resolves with the mount
   * report, or null when there is no live bridge to answer.
   *
   * setPack is fire-and-forget by design (it is queued before the engine even
   * boots), which meant the page had no way to learn that a mount FAILED and so
   * asserted success the moment the message was queued. That is precisely how a
   * key the engine did not recognise produced a cheerful licence line.
   *
   * Time-boxed: a wedged engine resolves null rather than leaving the selector
   * spinning forever, which is the same bargain importModel already makes.
   */
  async waitForPack(): Promise<PackMountReport | null> {
    if (!this.bridge) {
      return null;
    }
    return new Promise<PackMountReport | null>(resolve => {
      const timer = setTimeout(() => {
        if (this.packResolve) {
          this.packResolve = null;
          resolve(null);
        }
      }, PACK_TIMEOUT_MS);
      this.packResolve = report => {
        clearTimeout(timer);
        resolve(report);
      };
    });
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
      case 'setRig':
        bridge.setRig?.(msg.json);
        break;
      case 'autoAdjustRig':
        bridge.autoAdjustRig?.();
        break;
      case 'setAutoRotate':
        bridge.setAutoRotate?.(msg.on);
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

  /**
   * Match the canvas DRAWING BUFFER to the box CSS gave it.
   *
   * With `canvasResizePolicy: 0` Godot never touches width/height, and an
   * unsized canvas defaults to 300x150 — so the preview would render at a
   * sixth of its box and be stretched back up, looking like a blurry
   * screenshot of itself. The CSS box is the source of truth (`width: 100%`
   * + `aspect-ratio: 1 / 1`); this only mirrors it into the buffer.
   *
   * devicePixelRatio is applied so the render is crisp on a HiDPI screen, but
   * CAPPED at 2 and at MAX_BUFFER_PX: this is a single-threaded WASM renderer
   * and a 4x buffer on a large monitor costs fill rate the preview does not
   * need. Writing the same value again would reset the GL surface and flicker,
   * so both dimensions are compared first.
   */
  private sizeCanvas(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    // Before layout (or while hidden) the box can be 0 — fall back rather than
    // creating a zero-sized GL surface, which some drivers refuse outright.
    const cssW = rect.width || canvas.clientWidth || FALLBACK_CANVAS_PX;
    const cssH = rect.height || canvas.clientHeight || FALLBACK_CANVAS_PX;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.min(MAX_BUFFER_PX, Math.round(cssW * dpr)));
    const h = Math.max(1, Math.min(MAX_BUFFER_PX, Math.round(cssH * dpr)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /**
   * Keep the buffer in step with the box for the rest of the session (panel
   * reflow, window resize, zoom). Outside Angular's zone: a ResizeObserver that
   * fires inside it would run change detection on every animation frame of a
   * drag-resize. Ignored where ResizeObserver is absent — the initial sizing
   * has already happened, so the preview still renders, just fixed.
   */
  private observeCanvasSize(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined' || this.resizeObserver) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => this.sizeCanvas(canvas));
      this.resizeObserver.observe(canvas);
    });
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
