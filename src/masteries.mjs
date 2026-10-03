/**
 * Profession Masteries (book pp.101/107/113/122/129/135/141) — the Level-5 "choose one" passive
 * each profession grants. Not present in the Roll20 catalogs, so hand-transcribed here; the pack
 * builder (`build-packs.mjs`) turns each into a passive `ability` Item in the Masteries compendium.
 *
 * Their bonuses are almost all *conditional* (a weapon family, a situation), so they ship as
 * descriptive passives — auto-applying a global Active Effect would over-apply. The one clean case is
 * Tome Mastery, whose die-step boost to Forbidden Knowledge is authored as a unified modifier in
 * src/modifiers.mjs (MODIFIER_OVERRIDES.mastery_tome), keyed by this mastery's id.
 */
export const MASTERIES = [
  // Bladedancer
  { id: 'mastery_swift_feet', profession: 'bladedancer', name: 'Mastery of the Swift Feet',
    description: "You are not affected by difficult terrain from natural causes. Still treat occupied squares as difficult terrain." },
  { id: 'mastery_versatile_weapon', profession: 'bladedancer', name: 'Mastery of the Versatile Weapon',
    description: "Increase To-Hit and damage by +1 on all attacks you make with a Versatile weapon." },
  { id: 'mastery_hemorrhage', profession: 'bladedancer', name: 'Mastery of Hemorrhage',
    description: "Increase the damage dealt through Hemorrhage you give to targets by one dice type." },

  // Fatebound
  { id: 'mastery_heavy_weapons', profession: 'fatebound', name: 'Heavy Weapons Mastery',
    description: "Gain +1 to attack and damage rolls you make with your divine weapon if you wield a heavy weapon as your divine weapon." },
  { id: 'mastery_armor', profession: 'fatebound', name: 'Armor Mastery',
    description: "You may gain the benefit of one extra visible item while wearing armor that would obscure it (to a max of 3)." },
  { id: 'mastery_critical', profession: 'fatebound', name: 'Critical Mastery',
    description: "Once per Quick Rest, when you roll a natural 1 on a D20, you may treat it as a natural 20." },

  // Hulinari Warrior
  { id: 'mastery_tooth_and_claw', profession: 'hulinari_warrior', name: 'Mastery of Tooth and Claw',
    description: "Gain +1 to unarmed melee attacks and damage." },
  { id: 'mastery_paw_and_wing', profession: 'hulinari_warrior', name: 'Mastery of Paw and Wing',
    description: "Increase your movement speed by 5ft (and Fly speed if applicable)." },
  { id: 'mastery_feather_and_hide', profession: 'hulinari_warrior', name: 'Mastery of Feather and Hide',
    description: "Increase your HP by 1 per level, and increase the size of your HP pools by the same amount." },

  // Oracle
  { id: 'mastery_mind', profession: 'oracle', name: 'Mastery of the Mind',
    description: "When you are insane, insane-table effects cannot force you to attack an ally or treat allies as enemies." },
  { id: 'mastery_temperament', profession: 'oracle', name: 'Mastery of Temperament',
    description: "Gain one additional Slightly Cracked roll each quick rest." },
  { id: 'mastery_tome', profession: 'oracle', name: 'Tome Mastery',
    description: "When you cast 'Forbidden Knowledge', increase the damage dice dealt by one dice type (e.g., XD8 becomes XD10)." },

  // Sentinel
  { id: 'mastery_crossbow', profession: 'sentinel', name: 'Crossbow Mastery',
    description: "When you expend 4 AP or more in a consistent attack with a crossbow against a target who is surrounded or cornered, or against whom you have Height Advantage, you successfully hit even if you would miss." },
  { id: 'mastery_bow', profession: 'sentinel', name: 'Bow Mastery',
    description: "Increase the base damage dice of bow attacks you make by one dice type." },
  { id: 'mastery_sling', profession: 'sentinel', name: 'Sling Mastery',
    description: "You gain a +1 bonus to attack rolls you make with a sling. Choose one condition; increase the Check DC made against you giving a target that condition by 1." },

  // Soldier
  { id: 'mastery_sword', profession: 'soldier', name: 'Sword Mastery',
    description: "Gain +1 to melee to-hit and damage with weapons in the sword family. While holding your sword, you may use an action to assume a parrying stance until the start of your next turn; while in it you gain one additional reaction, usable only to make an opportunity attack." },
  { id: 'mastery_spear', profession: 'soldier', name: 'Spear Mastery',
    description: "Gain +1 to melee to-hit and damage with weapons in the spear family. When you critically hit with a spear, you may make a critical effect to push the target back 5ft." },
  { id: 'mastery_defensive', profession: 'soldier', name: 'Defensive Mastery',
    description: "Do not decrease your move speed by 5ft when you wield a tower shield. Gain 1X Advantage against Panic." },

  // Thug
  { id: 'mastery_fist', profession: 'thug', name: 'Fist Mastery',
    description: "Gain a +1 bonus to attack rolls made with unarmed weapons vs. PD. Additionally, do not reduce your AP on the first turn of combat when you are ambushed." },
  { id: 'mastery_pin', profession: 'thug', name: 'Pin Mastery',
    description: "When you have Pinned an enemy through Natural Wrestler and they make a Trait Check against your Check DC, they treat your Check DC as one higher than it is." },
  { id: 'mastery_mageslayer', profession: 'thug', name: 'Mageslayer Mastery',
    description: "You are resistant to attack damage dealt against your MD by your Power Score." },
];
