// VENDORED DATA — the pack-level CREDIT block of the four shipped VN packs
// (hugmesh-character-studio-ui/src/assets/vn/packs/<packId>/pack.json, vendored
// into this repo at src/main/resources/vn/packs/<packId>/pack.json; see that
// directory's PROVENANCE.md). Same provenance rule as part-archetypes.ts:
// re-copy verbatim when a pack revs.
//
// WHY A CLIENT COPY AT ALL. `VnPackManifests.credits()` parses the same block
// server-side, but the credits view has to render with no BFF reachable and
// signed out — an attribution that disappears when a fetch 401s is not an
// attribution. The shared contract fixture
// (contract/server-contract.fixtures.json -> vnPackCredits) pins THIS constant
// against what the server parses, from both sides, so the two copies cannot
// drift: contract/server-contract.spec.ts checks the client half and
// ClientContractFixturesTest the server half.

/** One pack's credit block, exactly as its manifest declares it. */
export interface VnPackCredit {
  readonly packId: string;
  readonly displayName: string;
  readonly licenseSpdx: string;
  /**
   * The VERBATIM attribution a sourced pack must carry — never reflowed,
   * truncated or reworded, because it is a licence term and not copy. `null`
   * for a pack that declares none (the manifest field is optional).
   */
  readonly attribution: string | null;
}

/**
 * Every vendored pack, in `Char3DConfigValidator.PACK_IDS` / `SOURCE_PACK_IDS`
 * order. Packs WITHOUT an attribution string are kept in the list on purpose:
 * the credits view names their licence too, and a pack that later gains an
 * attribution then shows up without anyone having to remember to add a row.
 */
export const VN_PACK_CREDITS: readonly VnPackCredit[] = [
  {
    packId: 'menagerie-v1',
    displayName: 'Menagerie — All Creatures',
    licenseSpdx: 'CC-BY-SA-4.0',
    attribution: null,
  },
  {
    packId: 'anime-v1',
    displayName: 'Anime & Kemonomimi',
    licenseSpdx: 'CC-BY-SA-4.0',
    attribution: null,
  },
  {
    packId: 'base-anthro-v1',
    displayName: 'Base Anthro v1',
    licenseSpdx: 'CC-BY-SA-4.0',
    attribution: null,
  },
  {
    packId: 'srd-taxonomy-v1',
    displayName: 'Taxonomy + SRD Placeholders v1',
    licenseSpdx: 'CC-BY-4.0',
    attribution:
      'This work includes material taken from the System Reference ' +
      'Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available ' +
      'at https://dnd.wizards.com/resources/systems-reference-document. ' +
      'The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 ' +
      'International License available at ' +
      'https://creativecommons.org/licenses/by/4.0/legalcode.',
  },
];
