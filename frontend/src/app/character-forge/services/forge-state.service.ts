import { Injectable, computed, signal } from '@angular/core';
import {
  AnyMaterialRegion,
  BodyArchetype,
  Char3dConfig,
  ExtendedMaterialRegion,
  ForgeStyle,
  HeadFamily,
  PartSlot,
  defaultChar3dConfig,
  definitionWithinCap,
  normalizeChar3dConfig,
} from '../models/char3d-config';

/**
 * The single source of truth for the Char3DConfig being edited (the forge twin
 * of the studio's CharacterStateService): a signal store the parameter-editor
 * panels mutate and the engine canvas reads. Mutations are immutable updates so
 * the {@link config} signal fires exactly one downstream push per edit, and
 * every whole-config replacement goes through {@link normalizeChar3dConfig} so
 * the store NEVER holds an out-of-contract value (what you edit is what the
 * server will accept).
 */
@Injectable({ providedIn: 'root' })
export class ForgeStateService {
  private readonly _config = signal<Char3dConfig>(defaultChar3dConfig());

  /** The live (always-valid) config. */
  readonly config = this._config.asReadonly();

  /** The definition JSON exactly as it would be persisted / sent to the engine. */
  readonly definitionJson = computed(() => JSON.stringify(this._config()));

  /** False once the definition outgrows the server's 16KB cap (§3). */
  readonly withinSizeCap = computed(() => definitionWithinCap(this._config()));

  /** Replace the whole config (import/map/load/randomize) — normalized on entry. */
  applyConfig(input: unknown): void {
    this._config.set(normalizeChar3dConfig(input));
  }

  /** Reset to the default character. */
  reset(): void {
    this._config.set(defaultChar3dConfig());
  }

  setName(name: string): void {
    this.patch({ name });
  }

  setBodyArchetype(archetype: BodyArchetype): void {
    this.patchBody({ archetype });
  }

  setBuild(build: number): void {
    this.patchBody({ build });
  }

  setHeight(height: number): void {
    this.patchBody({ height });
  }

  setFamily(family: HeadFamily): void {
    this.patchHead({ family });
  }

  setVariant(variant: string): void {
    this.patchHead({ variant });
  }

  setSnoutLength(snoutLength: number): void {
    this.patchHead({ snoutLength });
  }

  setEarStyle(earStyle: string | null): void {
    this.patchHead({ earStyle });
  }

  setHornStyle(hornStyle: string | null): void {
    this.patchHead({ hornStyle });
  }

  /** Choose (or clear, with null) the part in one of the seven §2 slots. */
  setPart(slot: PartSlot, partId: string | null): void {
    const c = this._config();
    this.normalizeAndSet({ ...c, parts: { ...c.parts, [slot]: partId } });
  }

  /** Set one material region's colour (hex — invalid values clamp to default). */
  setMaterial(region: AnyMaterialRegion, hex: string): void {
    const c = this._config();
    this.normalizeAndSet({ ...c, materials: { ...c.materials, [region]: hex } });
  }

  /**
   * Un-pin an EXTENDED coat block, handing the region back to the maker's
   * derivation. Only the four extended regions can be cleared — the canonical
   * seven are always present in the canonical form.
   */
  clearMaterial(region: ExtendedMaterialRegion): void {
    const c = this._config();
    const materials = { ...c.materials };
    delete materials[region];
    this.normalizeAndSet({ ...c, materials });
  }

  /** True when an extended region is pinned rather than derived. */
  isMaterialPinned(region: ExtendedMaterialRegion): boolean {
    return typeof this._config().materials[region] === 'string';
  }

  setStyle(style: ForgeStyle): void {
    this.patch({ style });
  }

  private patch(partial: Partial<Char3dConfig>): void {
    this.normalizeAndSet({ ...this._config(), ...partial });
  }

  private patchBody(partial: Partial<Char3dConfig['body']>): void {
    const c = this._config();
    this.normalizeAndSet({ ...c, body: { ...c.body, ...partial } });
  }

  private patchHead(partial: Partial<Char3dConfig['head']>): void {
    const c = this._config();
    this.normalizeAndSet({ ...c, head: { ...c.head, ...partial } });
  }

  /**
   * Every mutation funnels through the §3 mirror — an out-of-range edit (e.g. a
   * typed height of 99) lands clamped, exactly as the server would store it.
   */
  private normalizeAndSet(candidate: unknown): void {
    this._config.set(normalizeChar3dConfig(candidate));
  }
}
