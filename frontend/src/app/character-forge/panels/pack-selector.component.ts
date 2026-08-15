import { Component, computed, inject, signal } from '@angular/core';
import { EngineBridgeService, PackMountReport } from '../services/engine-bridge.service';
import { ForgeStateService } from '../services/forge-state.service';
import {
  PACK_BLOCKED,
  PACK_CATALOG,
  PackCatalogEntry,
} from '../models/pack-catalog.generated';
import {
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  IMPORT_SOURCES,
} from '../models/import-sources';
import { BodyArchetype, HeadFamily } from '../models/char3d-config';

/**
 * The character selector: one tab per style lane (Anime / JRPG / Kemono-Furry /
 * Monsters) plus Import, the models each lane can actually render, and the
 * honest facts about each — licence, credit, triangle and bone cost, and
 * whether it can be recoloured at all.
 *
 * The catalogue is GENERATED (pack-catalog.generated.ts) from the same lanes
 * file the engine reads, so the selector can never offer a model the engine
 * cannot load. Choosing one calls setPack on the bridge; the engine mounts it
 * and answers with a report that becomes the capability note under the grid.
 *
 * THUMBNAILS are captured at runtime, not shipped: after a model mounts, the
 * page asks the engine for a snapshot and caches the PNG under that model's key
 * for the rest of the session. No thumbnail assets exist in the repo, and none
 * are fetched from anywhere.
 *
 * IMPORT is deliberately the last tab and behaves differently from every other
 * one: the file is read in the browser and handed to the engine as bytes. It is
 * never uploaded to the BFF, never written to disk, and never saved — only the
 * parametric Char3DConfig can be persisted, and it contains no geometry.
 */
@Component({
  selector: 'snap-pack-selector',
  standalone: true,
  imports: [],
  templateUrl: './pack-selector.component.html',
  styleUrl: './pack-selector.component.scss',
})
export class PackSelectorComponent {
  protected readonly engine = inject(EngineBridgeService);
  private readonly state = inject(ForgeStateService);

  readonly lanes = PACK_CATALOG;
  readonly blocked = PACK_BLOCKED;
  readonly importSources = IMPORT_SOURCES;
  readonly importAccept = IMPORT_ACCEPT;

  /** Tab ids: the lane ids plus the synthetic 'import' one the catalogue has. */
  readonly activeLane = signal<string>(PACK_CATALOG[0]?.id ?? 'anime');
  /** Catalogue key currently mounted ('' = the procedural avatar). */
  readonly selectedKey = signal<string>('');
  readonly status = signal('');
  readonly importError = signal<string | null>(null);
  readonly importBusy = signal(false);
  /** The imported file's own in-file licence terms (VRM metadata), if any. */
  readonly importedLicense = signal<Record<string, string | boolean> | null>(null);
  readonly importedName = signal('');

  /** key → data: PNG captured from the engine after that model mounted. */
  private readonly thumbnails = signal<Record<string, string>>({});

  readonly currentLane = computed(
    () => this.lanes.find(l => l.id === this.activeLane()) ?? this.lanes[0],
  );

  /** The active lane's one-line honesty note (empty before the catalogue loads). */
  readonly laneSummary = computed(() => this.currentLane().summary);

  readonly entries = computed<readonly PackCatalogEntry[]>(
    () => this.currentLane().entries,
  );

  /** The engine's report for whatever is on stage (null before any mount). */
  readonly report = computed(() => this.engine.mountReport());

  selectLane(id: string): void {
    this.activeLane.set(id);
  }

  thumbnailFor(key: string): string | null {
    return this.thumbnails()[key] ?? null;
  }

  /** Two-letter tile stand-in while a model has never been on stage. */
  initialsFor(entry: PackCatalogEntry): string {
    return entry.displayName
      .split(/[\s—-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  /**
   * How much of a mounted model actually recolours.
   *
   * "yes"/"no" was accurate while a single-atlas character could not recolour
   * at all. Those characters now recolour PER MESH NODE through their atlas,
   * and how many nodes clear the measurement varies by model (the Knight: 13 of
   * 15; the Mage: 4 of 12, because his robe and face share one mesh node). A
   * bare "yes" would over-claim that, so the count is shown instead.
   */
  recolourNote(report: PackMountReport): string {
    if (!report.recolorable) return 'no (baked atlas)';
    // A model with no per-part boundary recolours by atlas base colour instead,
    // so "N of M parts" would be meaningless for it — it has one part.
    const clusters = report.atlasClusters?.length ?? 0;
    if (clusters) return `yes, ${clusters} colours from the atlas`;
    const bound = report.atlasRegionsBound ?? 0;
    if (!bound) return 'yes';
    const skipped = report.atlasSkipped?.length ?? 0;
    return `yes, ${bound} of ${bound + skipped} parts`;
  }

  /** Whole-percent share, so the template needs no DecimalPipe import. */
  sharePct(share: number): number {
    return Math.round(share * 100);
  }

  /** Human-readable cost, so a 166-joint VRoid base is not a surprise in VR. */
  costFor(entry: PackCatalogEntry): string {
    const mb = (entry.bytes / (1024 * 1024)).toFixed(1);
    return `${entry.tris.toLocaleString()} tris · ${entry.joints} joints · ${mb} MB`;
  }

  /** Quest-3 budget flags (technique.md: ~5-15k tris, ≤ ~75 bones). */
  overBudget(entry: PackCatalogEntry): string | null {
    const problems: string[] = [];
    if (entry.tris > 15000) {
      problems.push(`${entry.tris.toLocaleString()} triangles is over the 15k Quest-3 budget`);
    }
    if (entry.joints > 75) {
      problems.push(`${entry.joints} joints is over the ~75-bone Quest-3 budget`);
    }
    return problems.length ? problems.join('; ') : null;
  }

  /**
   * Mount a model. The config moves onto it too — the basis registry is keyed
   * by family, so a model only renders when the character is on its family
   * (an "avatar" model takes head+body; a "body" model takes only the body, so
   * the beast head the user chose survives on top of it).
   */
  async choose(entry: PackCatalogEntry): Promise<void> {
    this.selectedKey.set(entry.key);
    if (entry.mount === 'body') {
      this.state.setBodyArchetype(entry.archetype as BodyArchetype);
    } else {
      this.state.setFamily(entry.family as HeadFamily);
      this.state.setBodyArchetype(entry.archetype as BodyArchetype);
    }
    this.engine.setPack(entry.key);
    // "Loading", NOT the licence line. This used to assert success the instant
    // the message was QUEUED — before the engine had even seen the key — so a
    // refused mount still read as "<model> — CC0-1.0, <author>". The credit line
    // is written below, once the engine confirms it actually mounted.
    this.status.set(`Loading ${entry.displayName}…`);

    const report = await this.engine.waitForPack();
    if (report && !report.mounted) {
      this.status.set(`${entry.displayName} did not load: ${report.error || 'the engine refused it'}`);
      return;
    }
    if (!report) {
      // No engine (dev / bundle absent): the selector still works as a picker,
      // so say what is true rather than claiming a mount that cannot happen.
      this.status.set(`${entry.displayName} selected — the 3D engine is not running.`);
      return;
    }
    this.status.set(
      `${entry.displayName} — ${entry.licenseSpdx}, ${entry.attribution}`
      + (entry.recolorable ? '' : '. Fixed colours: this model is one baked atlas.'),
    );
    // Only snapshot AFTER a confirmed mount — thumbnailing a refused mount
    // caches a picture of whatever was previously on stage under the new key.
    await this.captureThumbnail(entry.key);
  }

  /** Back to the parametric avatar (the only basis most families have). */
  clearPack(): void {
    this.selectedKey.set('');
    this.engine.setPack('');
    this.status.set('Procedural avatar — every parameter below drives the mesh directly.');
  }

  /**
   * Read a user-picked file and hand its BYTES to the engine. Nothing is
   * uploaded: this method never touches the BFF, and the resulting avatar is
   * session-only.
   */
  async onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    this.importError.set(null);
    this.importedLicense.set(null);
    if (!file) {
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      this.importError.set(
        `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the engine caps `
        + `imports at ${IMPORT_MAX_BYTES / (1024 * 1024)} MB so a parse cannot freeze the page.`,
      );
      return;
    }
    if (!this.engine.ready()) {
      this.importError.set('The 3D engine is not running, so there is nothing to import into.');
      return;
    }
    this.importBusy.set(true);
    this.importedName.set(file.name);
    try {
      const bytes = await file.arrayBuffer();
      const report = await this.engine.importModel(bytes, file.name);
      if (report.ok === false) {
        this.importError.set(report.reason ?? 'the engine could not read that file');
        return;
      }
      this.selectedKey.set('');
      this.importedLicense.set(report.license ?? null);
      this.status.set(
        `${file.name} loaded locally. It stays on this device — importing never uploads it.`,
      );
    } catch (e) {
      this.importError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.importBusy.set(false);
      input.value = '';
    }
  }

  /** Licence rows of an imported VRM, in the order a user cares about. */
  licenseRows(): { label: string; value: string }[] {
    const license = this.importedLicense();
    if (!license) {
      return [];
    }
    const labels: [string, string][] = [
      ['title', 'Title'],
      ['authors', 'Author'],
      ['licenseName', 'Licence'],
      ['otherLicenseUrl', 'Licence URL'],
      ['allowedUser', 'Allowed users'],
      ['commercialUsage', 'Commercial use'],
      ['creditNotation', 'Credit'],
      ['allowRedistribution', 'Redistribution'],
      ['modification', 'Modification'],
      ['specVersion', 'VRM spec'],
    ];
    return labels
      .map(([key, label]) => ({ label, value: String(license[key] ?? '') }))
      .filter(row => row.value !== '' && row.value !== 'false');
  }

  /**
   * Ask the engine for a PNG of what it just mounted and keep it as that
   * model's tile. Failure is silent by design — a missing thumbnail is a
   * cosmetic gap, and the engine bundle is absent in dev.
   */
  private async captureThumbnail(key: string): Promise<void> {
    if (!this.engine.ready() || this.thumbnails()[key]) {
      return;
    }
    try {
      const base64 = await this.engine.snapshot(192, 192);
      if (base64) {
        this.thumbnails.update(map => ({ ...map, [key]: `data:image/png;base64,${base64}` }));
      }
    } catch {
      // no thumbnail this time; the initials tile stays.
    }
  }
}
