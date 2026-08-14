import { Component, effect, inject, signal } from '@angular/core';
import { EngineCanvasComponent } from './panels/engine-canvas.component';
import { ConfigEditorComponent } from './panels/config-editor.component';
import { ImportVnComponent } from './panels/import-vn.component';
import { PackSelectorComponent } from './panels/pack-selector.component';
import { SavePanelComponent } from './panels/save-panel.component';
import { ForgeStateService } from './services/forge-state.service';
import { EngineBridgeService } from './services/engine-bridge.service';
import { EXPRESSIONS } from './models/char3d-config';
import { randomChar3dConfig } from './util/random-config';
import { AvatarFanoutService, PlatformResult } from './services/avatar-fanout.service';

/**
 * How long the editor waits after the last edit before pushing the config at
 * the engine. Short enough to still feel immediate (well under the ~100ms
 * "instant" threshold), long enough that a slider drag coalesces into one
 * assembler rebuild instead of one per tick.
 */
const SET_CONFIG_DEBOUNCE_MS = 80;

/**
 * The forge studio page (route '' of the character-forge remote): the Godot
 * turntable canvas beside the Char3DConfig parameter editor, import-from-VN,
 * the seeded randomizer, and save/load via the character-forge BFF. The page
 * and the engine stay in sync both ways over the CharForge bridge — editor
 * edits push `setConfig`, in-engine edits come back via `configChanged` (the
 * echo guard below keeps that from ping-ponging).
 */
@Component({
  selector: 'snap-character-forge',
  standalone: true,
  imports: [
    EngineCanvasComponent,
    PackSelectorComponent,
    ConfigEditorComponent,
    ImportVnComponent,
    SavePanelComponent,
  ],
  templateUrl: './character-forge.component.html',
  styleUrl: './character-forge.component.scss',
})
export class CharacterForgeComponent {
  private readonly fanout = inject(AvatarFanoutService);
  /** Per-platform outcomes of the last cross-platform apply. */
  readonly platformResults = signal<PlatformResult[]>([]);
  protected readonly state = inject(ForgeStateService);
  protected readonly engine = inject(EngineBridgeService);

  readonly expressions = EXPRESSIONS;
  /** The randomizer seed — editable so a shared seed reproduces a character. */
  readonly seed = signal<number>(Math.floor(Math.random() * 0xffffffff));
  readonly status = signal('');

  /** Last config JSON the ENGINE sent us — suppresses the setConfig echo. */
  private lastEngineJson: string | null = null;

  constructor() {
    // Editor → engine: push every (clamped) config change; the bridge queues
    // until the game registers CharForge, so this is safe from first paint.
    //
    // TRAILING-DEBOUNCED on purpose. `setConfig` is not a cheap property
    // write: the engine re-runs the whole assembler, which tears down and
    // rebuilds the 40-60 primitives of the rig. An undebounced push meant one
    // full rebuild per `input` event, i.e. per SLIDER TICK — a single drag of
    // the build slider fires dozens. The effect's cleanup cancels the pending
    // push, so a drag costs exactly one rebuild, ~80ms after the user stops.
    // Cleanup also runs on destroy, so no timer outlives the page.
    effect(onCleanup => {
      const json = this.state.definitionJson();
      if (json === this.lastEngineJson) {
        return;
      }
      const timer = setTimeout(() => this.engine.setConfig(json), SET_CONFIG_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
    // Engine → editor: in-engine edits replace the live config (normalized).
    // The echo guard pins the NORMALIZED form, so the effect above skips the
    // push-back regardless of the engine's JSON key order.
    this.engine.onConfigChanged(json => {
      try {
        this.state.applyConfig(JSON.parse(json));
      } catch {
        return; // a malformed engine payload never corrupts the editor state
      }
      this.lastEngineJson = this.state.definitionJson();
    });
  }

  onSeed(ev: Event): void {
    const n = Number((ev.target as HTMLInputElement).value);
    this.seed.set(Number.isFinite(n) ? n >>> 0 : 0);
  }

  /** Seeded "Surprise me" — deterministic: the same seed forges the same character. */
  randomize(): void {
    this.state.applyConfig(randomChar3dConfig(this.seed()));
    this.status.set(`Forged from seed ${this.seed()}. Adjust anything below.`);
  }

  onExpression(ev: Event): void {
    this.engine.setExpression((ev.target as HTMLSelectElement).value);
  }

  onOpenness(ev: Event): void {
    this.engine.setOpenness(Number((ev.target as HTMLInputElement).value));
  }

  /**
   * Apply the POSED snapshot as this account's avatar everywhere it can go.
   *
   * The snapshot is genuinely posed: the engine mirrors the live orbit camera
   * onto a transparent-background viewport sharing the same world, so the
   * current rotation, expression and jaw openness are what gets captured — the
   * operator asked for exactly that ("at least give a posed snapshot across
   * platforms"). Same three mechanisms the 2D studio uses.
   */
  async useEverywhere(): Promise<void> {
    if (!this.engine.ready()) {
      return; // aria-disabled control; the hint explains why.
    }
    this.platformResults.set([]);
    this.status.set('Applying the posed snapshot across platforms…');
    try {
      const base64 = await this.engine.snapshot(512, 512);
      // Decode in-process rather than fetch('data:…'): this app's CSP
      // connect-src is 'self' blob: https: wss: — no data:, so fetching a data
      // URL is REFUSED ("Failed to fetch", hit live). atob has no such gate.
      const png = base64ToPng(base64);
      // FAIL CLOSED on a bad frame. The engine can hand back null/empty when no
      // frame has rendered yet (observed live under software GL): decoding that
      // yields junk which the mesh's magic-byte sniff rejects with 400 — while
      // Matrix, which does not sniff, would happily store the junk as your
      // avatar. Verify the PNG signature HERE so nothing is ever uploaded
      // anywhere unless it is genuinely a PNG.
      if (!(await isPng(png))) {
        this.status.set(
          'The 3D preview has not produced a frame yet — rotate or adjust the '
          + 'character so it renders, then try again. Nothing was uploaded.');
        return;
      }
      const results = await this.fanout.applyEverywhere(png);
      this.platformResults.set(results);
      const applied = results.filter(r => r.outcome === 'applied').length;
      const failed = results.filter(r => r.outcome === 'failed').length;
      this.status.set(
        failed === 0
          ? `Applied on ${applied} platform${applied === 1 ? '' : 's'}.`
          : `Applied on ${applied}; ${failed} failed — see below.`);
    } catch (e) {
      this.status.set(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Snapshot the engine view as a PNG download (avatar/sticker reuse). */
  async snapshot(): Promise<void> {
    if (!this.engine.ready()) {
      return; // aria-disabled control; the hint below explains why.
    }
    try {
      const base64 = await this.engine.snapshot(512, 512);
      const a = document.createElement('a');
      a.href = `data:image/png;base64,${base64}`;
      a.download = `${this.state.config().name || 'character'}.png`;
      a.click();
      this.status.set('Snapshot downloaded.');
    } catch (e) {
      this.status.set(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** base64 -> PNG Blob, without a data: fetch (see the CSP note at the call site). */
function base64ToPng(base64: string | null | undefined): Blob {
  if (!base64) {
    return new Blob([], { type: 'image/png' });   // caller's isPng() rejects it
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}

/** True when the blob really starts with the 8-byte PNG signature. */
async function isPng(blob: Blob): Promise<boolean> {
  if (blob.size < 8) {
    return false;
  }
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => head[i] === b);
}
