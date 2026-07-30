import { Component, OnInit, inject, signal } from '@angular/core';
import { ForgeBffService, ForgeCharacter } from '../services/forge-bff.service';
import { ForgeStateService } from '../services/forge-state.service';

/**
 * Save/load/list/active for forge characters (DESIGN §3 API) via the BFF's
 * HttpOnly `bff_` cookie. Standalone/dev without the cookie the BFF answers
 * 401 and the panel degrades to an honest "sign in to save" note (the
 * session.service convention) — everything else on the page keeps working.
 */
@Component({
  selector: 'snap-save-panel',
  standalone: true,
  imports: [],
  templateUrl: './save-panel.component.html',
  styleUrl: './save-panel.component.scss',
})
export class SavePanelComponent implements OnInit {
  private readonly bff = inject(ForgeBffService);
  protected readonly state = inject(ForgeStateService);

  readonly characters = signal<ForgeCharacter[]>([]);
  readonly busy = signal(false);
  readonly status = signal('');
  readonly error = signal<string | null>(null);
  /** The id whose definition is currently loaded in the editor (null = new). */
  readonly loadedId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.run(async () => {
      this.characters.set(await this.bff.list());
      this.status.set(`${this.characters().length} saved character(s).`);
    }, 'Sign in to list and save characters.');
  }

  /** Create a new saved character from the live config. */
  async saveNew(): Promise<void> {
    if (!this.state.withinSizeCap()) {
      this.error.set('Definition exceeds the 16KB cap — trim it before saving.');
      return;
    }
    await this.run(async () => {
      const created = await this.bff.create(this.state.config().name, this.state.config());
      this.loadedId.set(created.id);
      this.characters.set(await this.bff.list());
      this.status.set(`Saved "${created.name}".`);
    }, 'Sign in to save characters.');
  }

  /** Overwrite the loaded save with the live config. */
  async saveOver(): Promise<void> {
    const id = this.loadedId();
    if (!id) {
      await this.saveNew();
      return;
    }
    if (!this.state.withinSizeCap()) {
      this.error.set('Definition exceeds the 16KB cap — trim it before saving.');
      return;
    }
    await this.run(async () => {
      const updated = await this.bff.update(id, this.state.config().name, this.state.config());
      this.characters.set(await this.bff.list());
      this.status.set(`Updated "${updated.name}".`);
    }, 'Sign in to save characters.');
  }

  /** Load a save into the editor (through the §3 clamp mirror). */
  load(c: ForgeCharacter): void {
    this.state.applyConfig(c.definition);
    this.loadedId.set(c.id);
    this.status.set(`Loaded "${c.name}".`);
    this.error.set(null);
  }

  async setActive(c: ForgeCharacter): Promise<void> {
    await this.run(async () => {
      await this.bff.setActive(c.id);
      this.characters.set(await this.bff.list());
      this.status.set(`"${c.name}" is now your active character.`);
    }, 'Sign in to choose an active character.');
  }

  async remove(c: ForgeCharacter): Promise<void> {
    await this.run(async () => {
      await this.bff.remove(c.id);
      if (this.loadedId() === c.id) {
        this.loadedId.set(null);
      }
      this.characters.set(await this.bff.list());
      this.status.set(`Deleted "${c.name}".`);
    }, 'Sign in to delete characters.');
  }

  /** Load my ACTIVE character (used by the room join flows) into the editor. */
  async loadActive(): Promise<void> {
    await this.run(async () => {
      const active = await this.bff.active();
      if (!active) {
        this.status.set('No active character yet — save one and mark it active.');
        return;
      }
      this.load(active);
    }, 'Sign in to load your active character.');
  }

  private async run(op: () => Promise<void>, unauthorizedHint: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await op();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The template's degrade convention: a 401 (absent bff_ cookie) is an
      // expected standalone/dev state, not a fault.
      this.error.set(msg.endsWith('401') ? unauthorizedHint : msg);
    } finally {
      this.busy.set(false);
    }
  }
}
