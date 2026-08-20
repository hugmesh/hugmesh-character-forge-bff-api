import { Component, computed, inject } from '@angular/core';
import { ForgeStateService } from '../services/forge-state.service';
import { VN_PACK_CREDITS, VnPackCredit } from '../models/vn-pack-credits';

/**
 * The in-app CREDITS view (DESIGN §4; docs/CATALOG-DND-SRD.md in the studio repo
 * requires it). A pack under CC-BY carries a verbatim attribution string in its
 * manifest, and CC-BY discharges only when that string is shown to the END USER
 * — shipping it in repo metadata (ATTRIBUTION.txt, THIRD_PARTY_ASSETS.md) and in
 * the validator is necessary but not sufficient. srd-taxonomy-v1's SRD 5.1
 * notice is the one this repo actually owes.
 *
 * Renders from the VENDORED {@link VN_PACK_CREDITS} rather than the BFF: the
 * forge deliberately works signed-out/offline (the "Preview locally" path), and
 * a credit that vanishes when a fetch 401s is not a credit. The shared contract
 * fixture pins that constant against the server's own parse of the same
 * manifests, so the two copies cannot drift apart.
 *
 * The 3D model credits are NOT duplicated here — they live on the model cards in
 * pack-selector.component.html, which is where THIRD_PARTY_ASSETS.md records the
 * in-app credit as being discharged.
 */
@Component({
  selector: 'snap-credits',
  standalone: true,
  imports: [],
  templateUrl: './credits.component.html',
  styleUrl: './credits.component.scss',
})
export class CreditsComponent {
  private readonly state = inject(ForgeStateService);

  /** Every vendored VN pack, credited whether or not it carries an attribution. */
  readonly credits: readonly VnPackCredit[] = VN_PACK_CREDITS;

  /** The packs that MUST be quoted verbatim — what this view exists for. */
  readonly attributed = VN_PACK_CREDITS.filter(c => c.attribution !== null);

  /**
   * The pack the live config was mapped from (`source.packId`), or null for a
   * character that was never imported from a VN one. Only a marker: the notices
   * below are shown in full either way, because the app ships all four packs.
   */
  readonly sourcePackId = computed<string | null>(() => this.state.config().source?.packId ?? null);
}
