import { AfterViewInit, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { EngineBridgeService } from '../services/engine-bridge.service';

/**
 * Hosts the Godot studio canvas (godot/character-forge web export, loaded via
 * the Engine JS API from same-origin assets/game/ — DESIGN §4). The export is
 * baked into assets/game/ AFTER this frontend is authored, so the component
 * probes first and renders an honest "engine bundle not present" panel when
 * the bundle is missing (matrix-ui `turnAvailable` capability-note precedent)
 * — the page always boots fine either way.
 */
@Component({
  selector: 'snap-engine-canvas',
  standalone: true,
  imports: [],
  templateUrl: './engine-canvas.component.html',
  styleUrl: './engine-canvas.component.scss',
})
export class EngineCanvasComponent implements AfterViewInit {
  protected readonly engine = inject(EngineBridgeService);

  @ViewChild('gameCanvas') private canvasRef?: ElementRef<HTMLCanvasElement>;

  async ngAfterViewInit(): Promise<void> {
    const present = await this.engine.probe();
    const canvas = this.canvasRef?.nativeElement;
    if (!present || !canvas) {
      return;
    }
    try {
      await this.engine.load(canvas);
    } catch {
      // engine.status/error already carry the failure for the template.
    }
  }
}
