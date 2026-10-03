/**
 * Oracle Madness annotations, transcribed from *Sacadia's Art of War v1.0* pp. 122–125 (the Roll20
 * `sheet.html` the packs are built from omitted them — they exist only in the PDF). Merged into each
 * ability's `system.madness` by build-packs. See docs/madness-engine.md for the grammar and the full
 * reviewed table.
 *
 * Fields: `insaneOnly` (`P:I`), `prereq` (`P:MX` minimum Madness), `gain` (`M+X`), `spend` (`M-X`).
 * Amount formulas — `1d3-1` is the standard roll; `N` = a player-chosen amount; `M` = all Madness.
 * Omitted fields default (insaneOnly:false, prereq:null, gain:'', spend:'').
 */
export const MADNESS_ANNOTATIONS = {
  // --- gain-on-use (M+X) ---
  vision_of_hemlock: { gain: '1d3-1' },
  gibbering: { gain: '1d3-1' },
  sheermind: { gain: '1d3-1' },
  curse_of_the_bound_tongue: { gain: '1d3-1' }, // Focus: on initiate
  revulsion_of_pox: { gain: '1d3-1' },
  bloodied_urn: { gain: '1d3-1' },
  mad_start: { gain: '1d6' }, // prose ("Gain 1D6 levels"), not bracketed
  blood_for_blood: { gain: '1' }, // Boost
  mad_smear: { prereq: 4, gain: '1d3-1' }, // Boost
  mad_spector: { prereq: 4, gain: '1d3-1' }, // Boost
  curse_of_the_shared_mind: { prereq: 1, gain: 'N' }, // gains 1d3-1 on ally-fail trigger, not on cast
  blood_for_god: { prereq: 1, gain: '1d3-1' }, // Boost

  // --- prereq only, no gain/spend ---
  voices_that_shriek: { prereq: 1 }, // Boost; skips end-of-turn −1
  open_the_third_eye: { prereq: 1 },
  bloodied_cruelty: { prereq: 1 }, // Boost
  soulbinding: { prereq: 3 },

  // --- spend-on-use (M-X) ---
  blessing_of_the_winged_sandal: { prereq: 1, spend: '1d3-1' }, // Reaction
  blessing_of_the_burning_incense: { prereq: 1, spend: 'N' },
  blessing_of_the_iron_wall: { prereq: 1, spend: '1d3-1' }, // Focus
  blessing_of_dreams: { prereq: 1, spend: '1d3-1' }, // Focus
  blessing_of_the_shield: { prereq: 3, spend: '1d3-1' }, // Focus
  blessing_of_the_hallowed_vale: { prereq: 5, spend: 'N' },
  blessing_of_iron: { prereq: 1, spend: '1d3-1' }, // Focus
  blessing_of_hot_coal: { prereq: 5, spend: 'N' },
  black_rebuke: { prereq: 3, spend: 'M' }, // Reaction; removes all Madness
  that_sluggish_feeling: { prereq: 4, spend: '1d3-1' }, // Reaction
  good_hit: { prereq: 4, spend: 'N' }, // Reaction
  partial_drivel: { prereq: 1, spend: 'N' }, // Focus
  bloodsapper: { prereq: 4, spend: '1d3-1' }, // Reaction

  // --- Insane-only (P:I), Blood Sage & Druidia deep cuts ---
  balanced_scale: { insaneOnly: true, prereq: 5, spend: 'N' },
  a_boiled_leech: { insaneOnly: true, spend: '1' }, // Focus
  yarrowstem: { insaneOnly: true }, // once/rest
  voidsphere: { insaneOnly: true, prereq: 1, spend: '1' }, // Focus
  mad_chanting: { insaneOnly: true, spend: '1' },
  sanguine_orb: { insaneOnly: true, prereq: 1, spend: '1' },
  draining_aura: { insaneOnly: true, prereq: 1, spend: '1' }, // Focus
  stygian_abyss: { insaneOnly: true, prereq: 1, spend: '1' }, // Focus
  sphere_insanium: { insaneOnly: true, spend: '1' }, // Focus, once/rest
  mindmaze: { insaneOnly: true },
  incredulous_will: { insaneOnly: true },
  bleeding_eyes_bloodsage: { insaneOnly: true }, // Boost
  bloodlet: { insaneOnly: true }, // Focus
  mind_map: { insaneOnly: true },
  curse_of_the_crying_maiden: { insaneOnly: true, spend: 'N' },
  quieted_mind: { insaneOnly: true, spend: 'M' }, // once/rest; removes all Madness + Insanity
};
