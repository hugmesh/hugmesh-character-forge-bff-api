import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { EngineBridgeService } from '../services/engine-bridge.service';
import { ForgeStateService } from '../services/forge-state.service';
import {
  AnyMaterialRegion,
  BODY_ARCHETYPES,
  BodyArchetype,
  EXTENDED_DERIVED_FROM,
  EXTENDED_MATERIAL_REGIONS,
  ExtendedMaterialRegion,
  FORGE_STYLES,
  ForgeStyle,
  HEAD_FAMILIES,
  HeadFamily,
  MATERIAL_REGIONS,
  MaterialRegion,
  MAX_STYLE_STRING_LENGTH,
  PART_SLOTS,
  PartSlot,
  RIG_JOINTS,
  RIG_OFFSET_MAX,
  RIG_SCALE_MAX,
  RIG_SCALE_MIN,
  RigJoint,
  Triple,
  effectiveRegionColor,
} from '../models/char3d-config';
import { PART_SLOT_IDS } from '../models/part-archetypes';

/**
 * The Char3DConfig parameter editor — one panel per §2 section (name, body,
 * head family, parts, materials, style), mirroring the studio's picker/palette
 * layout. Every control writes through {@link ForgeStateService}, whose §3
 * clamp mirror keeps the config valid; part pickers offer REAL VN part ids
 * from the vendored per-slot lists so a forged character round-trips through
 * the VN packs.
 */
@Component({
  selector: 'snap-config-editor',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './config-editor.component.html',
  styleUrl: './config-editor.component.scss',
})
export class ConfigEditorComponent {
  protected readonly state = inject(ForgeStateService);
  private readonly engine = inject(EngineBridgeService);

  // ── Rigging: nudge one joint at a time, live in the engine ─────────────────
  readonly rigJoints = RIG_JOINTS;
  readonly rigOffsetMax = RIG_OFFSET_MAX;
  readonly rigScaleMin = RIG_SCALE_MIN;
  readonly rigScaleMax = RIG_SCALE_MAX;
  readonly rigAxes = ['x', 'y', 'z'] as const;
  /** The joint the six rig sliders currently edit. */
  readonly rigJoint = signal<RigJoint>('jaw');
  /** How many joints carry an adjustment — the panel's "adjusted" badge. */
  readonly rigAdjustedCount = computed(() => Object.keys(this.state.config().rig ?? {}).length);

  rigOffset(axis: 0 | 1 | 2): number {
    return this.state.config().rig?.[this.rigJoint()]?.offset?.[axis] ?? 0;
  }

  rigScale(axis: 0 | 1 | 2): number {
    return this.state.config().rig?.[this.rigJoint()]?.scale?.[axis] ?? 1;
  }

  onRigJoint(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    if ((RIG_JOINTS as readonly string[]).includes(v)) {
      this.rigJoint.set(v as RigJoint);
    }
  }

  /**
   * One slider moved: store it (clamped by the mirror) AND push just the rig to
   * the engine, which re-poses without a rebuild — so the drag is live. The
   * debounced full setConfig that follows is a no-op for the engine's geometry.
   */
  onRigOffset(axis: 0 | 1 | 2, ev: Event): void {
    const offset = [this.rigOffset(0), this.rigOffset(1), this.rigOffset(2)] as Triple;
    offset[axis] = Number((ev.target as HTMLInputElement).value);
    this.commitRig({ offset, scale: [this.rigScale(0), this.rigScale(1), this.rigScale(2)] });
  }

  onRigScale(axis: 0 | 1 | 2, ev: Event): void {
    const scale = [this.rigScale(0), this.rigScale(1), this.rigScale(2)] as Triple;
    scale[axis] = Number((ev.target as HTMLInputElement).value);
    this.commitRig({ offset: [this.rigOffset(0), this.rigOffset(1), this.rigOffset(2)], scale });
  }

  private commitRig(entry: { offset: Triple; scale: Triple }): void {
    this.state.setRigJoint(this.rigJoint(), entry);
    this.engine.setRig(this.state.config().rig ?? {});
  }

  /** Ask the engine to fit the rig to the head it built; it answers via onConfigChanged. */
  autoAdjustRig(): void {
    this.engine.autoAdjustRig();
  }

  resetRig(): void {
    this.state.clearRig();
    this.engine.setRig({});
  }

  resetRigJoint(): void {
    this.state.setRigJoint(this.rigJoint(), {});
    this.engine.setRig(this.state.config().rig ?? {});
  }

  readonly families = HEAD_FAMILIES;
  readonly archetypes = BODY_ARCHETYPES;
  readonly styles = FORGE_STYLES;
  readonly partSlots = PART_SLOTS;
  readonly materialRegions = MATERIAL_REGIONS;
  readonly extendedRegions = EXTENDED_MATERIAL_REGIONS;
  readonly derivedFrom = EXTENDED_DERIVED_FROM;

  /**
   * Part options per slot: humanoid heads draw from the anime-v1 kemonomimi
   * set first, beast heads from menagerie-v1 — with every other pack's ids
   * appended (deduped) so nothing the packs ship is unreachable.
   */
  readonly partOptions = computed<Record<string, string[]>>(() => {
    const humanoid = this.state.config().head.family === 'humanoid';
    const packOrder = humanoid
      ? ['anime-v1', 'menagerie-v1', 'srd-taxonomy-v1', 'base-anthro-v1']
      : ['menagerie-v1', 'anime-v1', 'srd-taxonomy-v1', 'base-anthro-v1'];
    const options: Record<string, string[]> = {};
    for (const slot of PART_SLOTS) {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const pack of packOrder) {
        for (const id of PART_SLOT_IDS[pack]?.[slot] ?? []) {
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
      options[slot] = ids;
    }
    return options;
  });

  /**
   * Keystroke-level sanitisation for the free-text boxes.
   *
   * The §3 clamp mirror DROPS a `head.variant`/`earStyle`/`hornStyle` that does not
   * match the server's `^[A-Za-z0-9 _-]{1,40}$` (the BFF answers 400 on it), and the
   * inputs are one-way-bound to the store — so without this a single `!` would blank
   * the whole field the user was typing into. Stripping the character the server
   * cannot store is the same thing `maxlength` already does for the 40-char bound.
   */
  private static shortDescriptor(raw: string): string {
    return raw.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, MAX_STYLE_STRING_LENGTH);
  }

  onName(ev: Event): void {
    // The store's mirror strips the control/bidi code points the server rejects.
    // Nothing is force-written back into the element here: those characters are
    // INVISIBLE, so rewriting would move the caret for no visible benefit.
    this.state.setName((ev.target as HTMLInputElement).value);
  }

  onArchetype(ev: Event): void {
    this.state.setBodyArchetype((ev.target as HTMLSelectElement).value as BodyArchetype);
  }

  onBuild(ev: Event): void {
    this.state.setBuild(Number((ev.target as HTMLInputElement).value));
  }

  onHeight(ev: Event): void {
    this.state.setHeight(Number((ev.target as HTMLInputElement).value));
  }

  onCurve(ev: Event): void {
    this.state.setCurve(Number((ev.target as HTMLInputElement).value));
  }

  onTop(ev: Event): void {
    this.state.setTop(Number((ev.target as HTMLInputElement).value));
  }

  onLegs(ev: Event): void {
    this.state.setLegs(Number((ev.target as HTMLInputElement).value));
  }

  onArms(ev: Event): void {
    this.state.setArms(Number((ev.target as HTMLInputElement).value));
  }

  onLimb(ev: Event): void {
    this.state.setLimb(Number((ev.target as HTMLInputElement).value));
  }

  /**
   * True when the limb-LENGTH axes have nothing to drive on this body.
   *
   * A slime has no legs and no arms — the assembler builds two blobs — so
   * `legs`/`arms` are inert by anatomy rather than by oversight. The honest
   * affordance is to disable the control and say why: the previous shape-axis
   * round shipped two families where dragging a slider did nothing at all, with
   * nothing in the UI admitting it. Girth still applies to neither, so it is
   * covered by the same flag.
   */
  limbAxesInert(): boolean {
    return this.state.config().body.archetype === 'slime';
  }

  onFamily(ev: Event): void {
    this.state.setFamily((ev.target as HTMLSelectElement).value as HeadFamily);
  }

  onVariant(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const cleaned = ConfigEditorComponent.shortDescriptor(el.value);
    if (cleaned !== el.value) {
      el.value = cleaned;
    }
    this.state.setVariant(cleaned);
  }

  onSnout(ev: Event): void {
    this.state.setSnoutLength(Number((ev.target as HTMLInputElement).value));
  }

  onEarStyle(ev: Event): void {
    this.state.setEarStyle(this.cleanedStyleInput(ev));
  }

  onHornStyle(ev: Event): void {
    this.state.setHornStyle(this.cleanedStyleInput(ev));
  }

  private cleanedStyleInput(ev: Event): string | null {
    const el = ev.target as HTMLInputElement;
    const cleaned = ConfigEditorComponent.shortDescriptor(el.value);
    if (cleaned !== el.value) {
      el.value = cleaned;
    }
    return cleaned === '' ? null : cleaned;
  }

  onPart(slot: PartSlot, ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    this.state.setPart(slot, v === '' ? null : v);
  }

  onMaterial(region: AnyMaterialRegion, ev: Event): void {
    this.state.setMaterial(region, (ev.target as HTMLInputElement).value);
  }

  /** Hand an extended coat block back to the maker's derivation. */
  onDerive(region: ExtendedMaterialRegion): void {
    this.state.clearMaterial(region);
  }

  /** True when the user pinned this coat block rather than deriving it. */
  isPinned(region: ExtendedMaterialRegion): boolean {
    return this.state.isMaterialPinned(region);
  }

  /**
   * The colour the swatch shows: the pinned hex, or the colour the maker will
   * derive. An `<input type="color">` cannot render "unset", so showing the
   * derived value is the only honest option — the pin/derive control next to it
   * is what tells the two states apart.
   */
  effectiveColor(region: AnyMaterialRegion): string {
    return effectiveRegionColor(this.state.config(), region);
  }

  onStyle(ev: Event): void {
    this.state.setStyle((ev.target as HTMLSelectElement).value as ForgeStyle);
  }
}
