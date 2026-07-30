import { Component, inject, signal } from '@angular/core';
import { ForgeBffService } from '../services/forge-bff.service';
import { ForgeStateService } from '../services/forge-state.service';
import { mapVnToChar3d } from '../util/map-vn';
import { VnCharacter } from '../models/vn-character';

/**
 * Import-from-VN (DESIGN §4): paste a VnCharacter JSON (the character-studio
 * replayable definition) — or pick one up from this browser's localStorage —
 * and map it to a Char3DConfig. "Map on server" uses the authoritative BFF
 * `/map`; "Preview locally" runs the client-side mirror (util/map-vn.ts) so
 * the flow works signed-out/offline too. Either way the result replaces the
 * live config through the §3 clamp mirror.
 */
@Component({
  selector: 'snap-import-vn',
  standalone: true,
  imports: [],
  templateUrl: './import-vn.component.html',
  styleUrl: './import-vn.component.scss',
})
export class ImportVnComponent {
  private readonly bff = inject(ForgeBffService);
  private readonly state = inject(ForgeStateService);

  readonly text = signal('');
  readonly status = signal('');
  readonly error = signal<string | null>(null);

  onText(ev: Event): void {
    this.text.set((ev.target as HTMLTextAreaElement).value);
  }

  /**
   * Scan localStorage for a stashed VnCharacter (anything that JSON-parses to
   * an object with a string packId + a slots object). The studio keeps the
   * definition session-local today, so this is a best-effort convenience —
   * absence is normal and reported softly.
   */
  loadFromBrowser(): void {
    this.error.set(null);
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      if (!raw || raw.length > 65536) {
        continue;
      }
      const vn = this.parseVn(raw);
      if (vn) {
        this.text.set(raw);
        this.status.set(`Loaded a VN character from this browser ("${key}").`);
        return;
      }
    }
    this.status.set('No VN character found in this browser — paste one instead.');
  }

  /** Map with the client-side mirror (works offline / signed-out). */
  previewLocally(): void {
    const vn = this.requireVn();
    if (!vn) {
      return;
    }
    this.state.applyConfig(mapVnToChar3d(vn));
    this.status.set('Mapped locally — the server /map stays authoritative on save.');
  }

  /** Map via the BFF's authoritative `POST /bff/character-forge/map`. */
  async mapOnServer(): Promise<void> {
    const vn = this.requireVn();
    if (!vn) {
      return;
    }
    try {
      const config = await this.bff.map(vn);
      this.state.applyConfig(config);
      this.status.set('Mapped on the server.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error.set(`Server map failed (${msg}) — try "Preview locally".`);
    }
  }

  private requireVn(): VnCharacter | null {
    this.error.set(null);
    this.status.set('');
    const vn = this.parseVn(this.text());
    if (!vn) {
      this.error.set('That is not a VN character JSON (expected packId + slots).');
    }
    return vn;
  }

  private parseVn(raw: string): VnCharacter | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof (parsed as VnCharacter).packId === 'string' &&
        (parsed as VnCharacter).slots !== null &&
        typeof (parsed as VnCharacter).slots === 'object'
      ) {
        return parsed as VnCharacter;
      }
      return null;
    } catch {
      return null;
    }
  }
}
