// VENDORED DATA — generated from the hugmesh-character-studio-ui asset
// packs (src/assets/vn/packs/{base-anthro-v1,srd-taxonomy-v1,menagerie-v1,
// anime-v1}/pack.json). The 3D mapping keys off the STABLE VN parameterization
// (packId, partId, headArchetype) — never SVG geometry (DESIGN §2) — and this
// index is the client-side mirror of the pack-manifest headArchetype lookup the
// BFF /map endpoint performs server-side. Regenerate by re-running the
// extraction against the studio packs when a pack revs.

/** packId → slot ('head'|'body') → partId → headArchetype (only parts that
 *  declare one). SLOT-SCOPED on purpose: the BFF's `VnPackManifests` indexes the
 *  head and body slots SEPARATELY, so a flat per-pack map made the client resolve
 *  a body partId sitting in `slots.head` (or vice versa) that the server resolves
 *  to nothing — two different families for one VN character. */
export const PART_ARCHETYPE_INDEX: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = {
  "anime-v1": {
    "body": {
      "body_anime_a_01": "humanoid",
      "body_anime_b_01": "humanoid",
      "body_anime_c_01": "humanoid"
    },
    "head": {
      "head_anime_oval_01": "humanoid",
      "head_anime_round_01": "humanoid",
      "head_anime_sharp_01": "humanoid"
    }
  },
  "base-anthro-v1": {
    "body": {
      "body_canine_01": "canid"
    },
    "head": {
      "head_canine_01": "canid"
    }
  },
  "menagerie-v1": {
    "body": {
      "body_amphibian_01": "amphibian",
      "body_aquatic_01": "aquatic",
      "body_avian_01": "avian",
      "body_bat_01": "bat",
      "body_canid_lean_01": "canid",
      "body_canid_stocky_01": "canid",
      "body_dino_01": "dino",
      "body_dragon_plated_01": "dragon",
      "body_dragon_stone_01": "dragon",
      "body_equine_01": "equine",
      "body_felid_01": "felid",
      "body_finned_01": "aquatic",
      "body_gryphon_01": "gryphon",
      "body_hoofed_01": "cervine",
      "body_hoofed_stocky_01": "bovine",
      "body_hyena_01": "hyena",
      "body_kobold_01": "dragon",
      "body_lapine_01": "lapine",
      "body_macropod_01": "macropod",
      "body_moth_01": "moth",
      "body_procyonid_01": "procyonid",
      "body_robot_01": "robot",
      "body_rodent_01": "rodent",
      "body_scaled_01": "dragon",
      "body_serpent_01": "reptile",
      "body_sleek_01": "mustelid",
      "body_slime_01": "slime",
      "body_stocky_01": "ursine",
      "body_synth_01": "synth"
    },
    "head": {
      "head_axolotl_01": "aquatic",
      "head_basilisk_01": "reptile",
      "head_bat_01": "bat",
      "head_bear_01": "ursine",
      "head_bee_01": "insect",
      "head_bird_01": "avian",
      "head_boar_01": "suid",
      "head_cat_01": "felid",
      "head_cow_01": "bovine",
      "head_deer_01": "cervine",
      "head_dragon_01": "dragon",
      "head_dragon_crystal_01": "dragon",
      "head_dragon_metallic_01": "dragon",
      "head_dragon_stone_01": "dragon",
      "head_eastern_dragon_01": "dragon",
      "head_ferret_01": "mustelid",
      "head_fox_01": "canid",
      "head_frog_01": "amphibian",
      "head_goat_01": "caprine",
      "head_gryphon_01": "gryphon",
      "head_horse_01": "equine",
      "head_husky_01": "canid",
      "head_hyena_01": "hyena",
      "head_kangaroo_01": "macropod",
      "head_kelpie_01": "aquatic",
      "head_kirin_01": "cervine",
      "head_kobold_01": "dragon",
      "head_lion_01": "felid",
      "head_lizard_01": "reptile",
      "head_mantis_01": "insect",
      "head_moth_01": "moth",
      "head_mouse_01": "rodent",
      "head_newt_01": "amphibian",
      "head_orca_01": "aquatic",
      "head_otter_01": "mustelid",
      "head_phoenix_01": "avian",
      "head_protogen_01": "synth",
      "head_rabbit_01": "lapine",
      "head_raccoon_01": "procyonid",
      "head_raptor_01": "avian",
      "head_raptor_dino_01": "dino",
      "head_rat_01": "rodent",
      "head_redpanda_01": "procyonid",
      "head_robot_01": "robot",
      "head_salamander_01": "amphibian",
      "head_shark_01": "aquatic",
      "head_slime_01": "slime",
      "head_snake_01": "reptile",
      "head_squirrel_01": "rodent",
      "head_tiger_01": "felid",
      "head_trex_01": "dino",
      "head_triceratops_01": "dino",
      "head_unicorn_01": "equine",
      "head_wolf_01": "canid"
    }
  },
  "srd-taxonomy-v1": {
    "body": {
      "body_avian_01": "avian",
      "body_canid_01": "canid",
      "body_dragonborn_01": "reptile",
      "body_felid_01": "felid",
      "body_humanoid_01": "humanoid",
      "body_reptile_01": "reptile",
      "body_synth_01": "synth",
      "body_tiefling_01": "humanoid"
    },
    "head": {
      "head_avian_01": "avian",
      "head_canid_01": "canid",
      "head_dragonborn_01": "reptile",
      "head_dwarf_01": "humanoid",
      "head_elf_01": "humanoid",
      "head_felid_01": "felid",
      "head_humanoid_01": "humanoid",
      "head_reptile_01": "reptile",
      "head_synth_01": "synth",
      "head_tiefling_01": "humanoid"
    }
  }
};

export const PART_SLOT_IDS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "anime-v1": {
    "accessory": [
      "accessory_ribbon_01",
      "accessory_megane_01",
      "accessory_choker_bell_01",
      "accessory_hairclip_01"
    ],
    "ears": [
      "ears_neko_01",
      "ears_kitsune_01",
      "ears_ookami_01",
      "ears_usagi_01"
    ],
    "feature": [
      "feature_halo_01",
      "feature_oni_horns_01"
    ],
    "hair": [
      "hair_bob_01",
      "hair_twintails_01",
      "hair_ponytail_01",
      "hair_long_straight_01",
      "hair_hime_01",
      "hair_messy_short_01",
      "hair_curly_01",
      "hair_spiky_01",
      "hair_side_sweep_01"
    ],
    "markings": [
      "marking_blush_01",
      "marking_freckles_01"
    ],
    "tail": [
      "tail_neko_01",
      "tail_kitsune_01",
      "tail_kitsune_nine_01",
      "tail_ookami_01"
    ],
    "wings": [
      "wings_fairy_01"
    ]
  },
  "base-anthro-v1": {},
  "menagerie-v1": {
    "accessory": [
      "accessory_bandana_01",
      "accessory_mushroom_cap_01",
      "accessory_collar_01",
      "accessory_glasses_01",
      "accessory_ear_piercing_01",
      "accessory_slime_pet_01"
    ],
    "ears": [
      "ears_lop_01",
      "ears_goo_01"
    ],
    "feature": [
      "feature_mane_01",
      "feature_snail_shell_01",
      "feature_dorsal_fin_01",
      "feature_head_fins_01",
      "feature_head_crest_01",
      "feature_antlers_01",
      "feature_horse_mane_01",
      "feature_dragon_spines_01",
      "feature_crystal_horns_01",
      "feature_dragon_horns_01",
      "feature_frill_01",
      "feature_tusks_01",
      "feature_hyena_mane_01",
      "feature_antennae_ball_01",
      "feature_unicorn_horn_01",
      "feature_fin_mane_01",
      "feature_goo_crown_01",
      "feature_core_orb_01",
      "feature_antennae_01",
      "feature_synth_fins_01",
      "feature_goat_horns_01",
      "feature_ram_horns_01",
      "feature_bull_horns_01"
    ],
    "hair": [
      "hair_flower_01",
      "hair_leafy_01",
      "hair_goo_01"
    ],
    "markings": [
      "marking_mask_01",
      "marking_countershade_01",
      "marking_sock_01",
      "marking_muzzle_blaze_01",
      "marking_fawn_spots_01",
      "marking_dino_stripes_01",
      "marking_metallic_sheen_01",
      "marking_stone_cracks_01",
      "marking_crystal_growths_01",
      "marking_belly_scutes_01",
      "marking_tiger_stripes_01",
      "marking_hyena_spots_01",
      "marking_bee_stripes_01",
      "marking_belly_patch_01",
      "marking_kirin_scales_01",
      "marking_serpent_coils_01",
      "marking_goo_drip_01",
      "marking_holstein_patches_01"
    ],
    "tail": [
      "tail_wolf_bushy_01",
      "tail_tadpole_01",
      "tail_shark_01",
      "tail_cetacean_01",
      "tail_feather_fan_01",
      "tail_gryphon_01",
      "tail_fox_01",
      "tail_husky_curl_01",
      "tail_deer_01",
      "tail_horse_01",
      "tail_dino_01",
      "tail_kobold_01",
      "tail_spade_01",
      "tail_thick_lizard_01",
      "tail_cat_01",
      "tail_lion_01",
      "tail_hyena_01",
      "tail_pig_curl_01",
      "tail_bunny_puff_01",
      "tail_rat_thin_01",
      "tail_squirrel_01",
      "tail_ringed_01",
      "tail_redpanda_01",
      "tail_otter_01",
      "tail_phoenix_01",
      "tail_eastern_01",
      "tail_goo_01",
      "tail_macropod_01",
      "tail_synth_01",
      "tail_bear_stub_01",
      "tail_cow_tassel_01"
    ],
    "wings": [
      "wings_small_01",
      "wings_feathered_01",
      "wings_crystal_01",
      "wings_dragon_01",
      "wings_bat_01",
      "wings_insect_01",
      "wings_butterfly_01",
      "wings_goo_01",
      "wings_moth_01"
    ]
  },
  "srd-taxonomy-v1": {
    "feature": [
      "muzzle_beak_01",
      "horns_tiefling_01"
    ]
  }
} as const;
