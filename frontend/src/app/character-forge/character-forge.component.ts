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
    effect(() => {
      const json = this.state.definitionJson();
      if (json !== this.lastEngineJson) {
        this.engine.setConfig(json);
      }
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
