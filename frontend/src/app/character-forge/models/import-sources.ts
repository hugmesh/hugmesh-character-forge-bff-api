/**
 * Where a user can GET an avatar to import — links only, never bundles.
 *
 * kemono.md's verdict is blunt: no CC0/CC-BY true-kemono model exists anywhere.
 * The good kemono bases (BOOTH VN3 derivatives, TheRPGslayer's free trio) are
 * explicitly non-redistributable — "DO NOT redistribute... even though this is
 * free" — so they can never ship in this repo. What we CAN do is tell the user
 * where they are and let them bring their own copy: the importer reads the file
 * in the browser and the bytes never leave the device, which is exactly the
 * usage those licences permit.
 *
 * `redistributable: false` entries are the ones we are legally barred from
 * vendoring; the UI says so next to the link rather than leaving the user to
 * wonder why a listed model is not in the catalogue.
 */
export interface ImportSource {
  readonly name: string;
  readonly url: string;
  readonly terms: string;
  /** Could we legally ship it? false ⇒ user-supplied only, by licence. */
  readonly redistributable: boolean;
  readonly note: string;
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    name: 'VRoid Studio',
    url: 'https://vroid.com/en/studio',
    terms: 'pixiv VRoid Studio guidelines',
    redistributable: true,
    note:
      'Author your own anime base and export a VRM. Models you make are yours to '
      + 'use and sell. Use the polygon-reduction export options — a raw export is '
      + 'tens of thousands of triangles, well past the Quest-3 browser budget.',
  },
  {
    name: 'Open Source Avatars (100Avatars, Grifters, NeonGlitch86)',
    url: 'https://www.opensourceavatars.com/',
    terms: 'CC0-1.0 / CC-BY-4.0 per collection',
    redistributable: true,
    note:
      'The same corpus eight of our Import-lane models come from. Everything else '
      + 'there imports the same way.',
  },
  {
    name: 'VRoid Studio CC0 sample models (OpenGameArt bundle)',
    url: 'https://opengameart.org/content/vroid-studio-cc0-models',
    terms: 'CC0-1.0',
    redistributable: true,
    note:
      'AvatarSample D–G, Sendagaya Shino, Sakurada Fumiriya. AvatarSample A/B/C '
      + 'are NOT CC0 — they are conditions-of-use models. Two of these bases are '
      + 'already in the Anime lane.',
  },
  {
    name: 'TheRPGslayer kemono trio (Ryuki / Amaterasu / Arkon)',
    url: 'https://therpgslayer.gumroad.com/',
    terms: 'free download, redistribution FORBIDDEN by the author',
    redistributable: false,
    note:
      'Real kemono models with MMD viseme shapes. Free to download and use, but '
      + 'the author forbids redistribution even of the free files — so they can '
      + 'only ever reach this app through your own import.',
  },
  {
    name: 'BOOTH kemono bases (VN3 and derivatives)',
    url: 'https://booth.pm/en/browse/3D%20Models',
    terms: 'commercial, per-model licence',
    redistributable: false,
    note:
      'The production-grade kemono line (Quest variants around 15k triangles, '
      + 'full visemes). Paid, per-model terms, never redistributable — import your '
      + 'own purchased copy.',
  },
  {
    name: 'Quaternius',
    url: 'https://quaternius.com/',
    terms: 'CC0-1.0',
    redistributable: true,
    note:
      'The CC0 backbone of the JRPG, Kemono and Monsters lanes. Any other pack '
      + 'there imports as a GLB.',
  },
  {
    name: 'KayKit',
    url: 'https://kaylousberg.itch.io/',
    terms: 'CC0-1.0',
    redistributable: true,
    note: 'The chibi adventurer and undead lines already in the JRPG/Monsters lanes.',
  },
];

/** What the importer will actually try to parse. */
export const IMPORT_ACCEPT = '.vrm,.glb,.gltf';

/**
 * Client-side size ceiling, mirroring CharForgeGlbLoader.MAX_BYTES. The engine
 * refuses anything larger anyway; refusing here means a 200 MB drop never gets
 * base64'd into WASM memory first.
 */
export const IMPORT_MAX_BYTES = 24 * 1024 * 1024;
