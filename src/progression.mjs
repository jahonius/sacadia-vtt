/**
 * Profession level features (the "All <Profession>s" aspect trees, book pp.100/107/112/121/128/135/141)
 * and the Level-11 Legendary Masteries — hand-transcribed here because the Roll20 catalogs carry only
 * the skill-point abilities. Built into the `profession-features` compendium (see build-packs.mjs).
 *
 * Proficiency / AP / Trait Points / Lore Increase are derived from level on the character already, so
 * they are not items. Everything else is: the player adds the features their level grants (and one
 * Legendary Mastery at 11), and the automation keys off the catalogId like any ability. Automation lives in
 * the usual override maps (src/modifiers.mjs) or in the runtime by id:
 *   - speed modifiers (`speed` target): Flitting/Dancing Feet, Speed of the Gods, Mastery of the Step;
 *   - boosts: Rousing Success (Lore → critical success), Boon of the Gods, Skilled Warrior, Legendary AP,
 *     Fast Reflexes, Slightly Cracked (a saved d3 in place of a 1D3−1 Madness roll; rolled at each rest);
 *   - runtime by id: Second Shot (limb-free first ranged attack), Semper Steady (self:steadied while the
 *     round's reaction is unspent), Alarming Mastery (enemies Surprised in round 1), Death Mastery (0-HP
 *     save while raging; no Wounded exhaustion), Fumble Mastery (+2 Fumble die types), the pool
 *     Masteries (+2 Glory / Trickshot / Prescient), Mastery of Energy / Endurance (condition immunity),
 *     Blood Mastery (+1 self-damage resistance).
 */
export const PROGRESSION = [
  // Every profession (Level 4 Lore Increase) — the Hulinari's is a Boost that needs no Boost slot; the rest
  // are Lore abilities usable on any action. Both play as a free, Lore-paid "critically succeed".
  { id: 'rousing_success', profession: '', level: 4, name: 'Rousing Success', tag: 'boost',
    description: 'You may use this on any action before or after rolling. If you do, expend one lore point. You critically succeed at that action.' },

  // Bladedancer
  { id: 'bd_flitting_feet', profession: 'bladedancer', level: 3, name: 'Flitting Feet', tag: 'passive',
    description: 'Increase your Move speed by 5ft. You can move through squares occupied by a creature of the same size as you by treating it as difficult terrain. You may freely move through squares occupied by a creature any size larger or smaller than you. You may not end your turn inside a square occupied by any other creature.' },
  { id: 'bd_dancing_feet', profession: 'bladedancer', level: 7, name: 'Dancing Feet', tag: 'passive',
    description: 'Increase your Move speed by 5ft. You can freely move through any square occupied by another creature, though you cannot end your turn on this square.' },
  { id: 'bd_speed_of_the_gods', profession: 'bladedancer', level: 15, name: 'Speed of the Gods', tag: 'passive',
    description: 'Increase your base Move Speed by 10ft. Increase your base Climb and Jump distance within combat by 5ft each.' },
  { id: 'legendary_cornered', profession: 'bladedancer', level: 11, legendary: true, name: 'Mastery of the Cornered', tag: 'passive',
    description: 'When you are Surrounded or Cornered, creatures do not gain 1X Advantage on attacks made against you.' },
  { id: 'legendary_energy', profession: 'bladedancer', level: 11, legendary: true, name: 'Mastery of Energy', tag: 'passive',
    description: 'You are immune to the Fatigue and Slowed conditions.' },
  { id: 'legendary_step', profession: 'bladedancer', level: 11, legendary: true, name: 'Mastery of the Step', tag: 'passive',
    description: 'Increase your Move speed by 5ft.' },

  // Fatebound
  { id: 'fb_elemental_weapon', profession: 'fatebound', level: 3, name: 'Elemental Weapon', tag: 'passive',
    description: 'Your divine weapon does elemental damage (choose one when you take this ability: Earth, Air, Fire, Water, Rot, Salt) instead of normal damage. Elemental damage overcomes physical weapon resistances. Additionally, you may summon and dismiss your divine weapon with a Boost to any action, even if physically separated. The divine weapon does not take up space in your readied item slots (RIS).' },
  { id: 'fb_boon_of_the_gods', profession: 'fatebound', level: 7, name: 'Boon of the Gods', tag: 'boost',
    description: 'Your divine weapon is imbued with the aura of your divine patron. Once per quick rest, you may increase the damage dice of an attack by two dice types as a Boost to an attack.' },
  { id: 'fb_demigod', profession: 'fatebound', level: 15, name: 'Demigod', tag: 'passive',
    description: 'Increase your Power or Fate (choose one) by one additional point, to a maximum of 7.' },
  { id: 'legendary_fumble', profession: 'fatebound', level: 11, legendary: true, name: 'Fumble Mastery', tag: 'passive',
    description: 'Whenever you give Fumble, increase the dice type of Fumble given by two dice types.' },
  { id: 'legendary_boost', profession: 'fatebound', level: 11, legendary: true, name: 'Boost Mastery', tag: 'passive',
    description: 'Increase the damage of any attack you make against a single target by half your Proficiency (rounded up) when you apply three Boosts to an attack.' },
  { id: 'legendary_aristeia', profession: 'fatebound', level: 11, legendary: true, name: 'Aristeia Mastery', tag: 'passive',
    description: 'Increase your number of Glory points by two.' },

  // Hulinari Warrior
  { id: 'hul_antlers_claws_and_talons', profession: 'hulinari_warrior', level: 1, name: 'Antlers, Claws, and Talons', tag: 'passive',
    description: 'When you make an unarmed attack in Beast form, change the damage dice from 1D4 to 1D8.' },
  { id: 'hul_bestial_respect', profession: 'hulinari_warrior', level: 3, name: 'Bestial Respect', tag: 'focus',
    description: 'Choose one beast within 30ft of you (with CR less than or equal to half your Proficiency, rounded up) to roll a Fate Check. If they fail, they become your ally until you break Focus. Once per turn they may use an action to roll a Fate check against this effect, ending Bestial Respect on a success. Once a creature succeeds against Bestial Respect, they may not be affected by it again until after a quick rest.' },
  { id: 'hul_bestial_rapidity', profession: 'hulinari_warrior', level: 7, name: 'Bestial Rapidity', tag: 'passive',
    description: 'When you change forms, it only exhausts one limb. When you do, lose all levels of Pin.' },
  { id: 'hul_mostly_human', profession: 'hulinari_warrior', level: 15, name: 'Mostly Human', tag: 'passive',
    description: 'You may change between a human and beast form as a Boost to another action.' },
  { id: 'legendary_pack', profession: 'hulinari_warrior', level: 11, legendary: true, name: 'Mastery of the Pack', tag: 'passive',
    description: 'The first time each turn you move within 5ft of an enemy in Pack Form, deal damage to them equal to your Finesse.' },
  { id: 'legendary_brute', profession: 'hulinari_warrior', level: 11, legendary: true, name: 'Mastery of the Brute', tag: 'passive',
    description: 'Increase the dice type of melee attacks made with your claws by one dice type when in Brute form.' },
  { id: 'legendary_swarm', profession: 'hulinari_warrior', level: 11, legendary: true, name: 'Mastery of the Swarm', tag: 'passive',
    description: 'Your flock constantly swarms around you. Gain damage resistance equal to half your Proficiency (rounded up) against all physical damage when in Swarm Form.' },

  // Oracle
  { id: 'oracle_slightly_cracked', profession: 'oracle', level: 3, name: 'Slightly Cracked', tag: 'boost',
    description: 'At the start of each quick rest, roll XD3 and save the die roll, where X is equal to your Proficiency Score. As a boost to an oracle ability that requires you to gain or lose 1D3-1 Madness, you may use a Boost to use a reserved roll instead of rolling for Madness.' },
  { id: 'oracle_pull_the_strand', profession: 'oracle', level: 7, name: 'Pull the Strand', tag: 'reaction',
    description: "You may expend 'Slightly Cracked' rolls to add or subtract your rolled number to a roll made by an enemy within 30ft of you." },
  { id: 'oracle_minds_eye', profession: 'oracle', level: 15, name: 'Mind’s Eye', tag: 'passive',
    description: 'Increase your Check DC by 1.' },
  { id: 'legendary_blood', profession: 'oracle', level: 11, legendary: true, name: 'Blood Mastery', tag: 'passive',
    description: 'Gain 6 HP (permanently) now. Gain 1 damage resistance to damage you deal to yourself through effects other than rolling on the Insane Table.' },
  { id: 'legendary_vision', profession: 'oracle', level: 11, legendary: true, name: 'Vision Mastery', tag: 'passive',
    description: 'Increase your number of prescient points by two.' },
  { id: 'legendary_armor_oracle', profession: 'oracle', level: 11, legendary: true, name: 'Armor Mastery (Oracle)', tag: 'passive',
    description: 'Gain +2 to your PD when you do not wear any physical armor.' },

  // Sentinel
  { id: 'sen_skilled_warrior', profession: 'sentinel', level: 3, name: 'Skilled Warrior', tag: 'boost',
    description: 'Once per turn, you may add your Wiles Score to any ranged to-hit you roll. You may not add Wiles to a ranged attack if another effect already adds your Wiles to an attack, and must decide to use this before you roll to-hit.' },
  { id: 'sen_second_shot', profession: 'sentinel', level: 7, name: 'Second Shot', tag: 'passive',
    description: 'When you make your first ranged attack each turn, you do not exhaust any limbs.' },
  { id: 'sen_legendary_ap', profession: 'sentinel', level: 15, name: 'Legendary AP', tag: 'boost',
    description: 'Once per turn as a boost to an action, you may recover a single AP.' },
  { id: 'legendary_trick', profession: 'sentinel', level: 11, legendary: true, name: 'Trick Mastery', tag: 'passive',
    description: 'Increase the number of Trickshot Points you have by two.' },
  { id: 'legendary_weapon', profession: 'sentinel', level: 11, legendary: true, name: 'Weapon Mastery', tag: 'passive',
    description: 'Increase the damage dice dealt by all ranged weapons you use by one type.' },
  { id: 'legendary_favored', profession: 'sentinel', level: 11, legendary: true, name: 'Favored Mastery', tag: 'passive',
    description: "Choose an additional favored enemy (and style, if applicable). Choose one favored enemy type, and add half your Wiles to your to-hit and damage against that favored enemy type. Do this even if you use 'Skilled Warrior' against this Favored Enemy." },

  // Soldier
  { id: 'sol_imposing_figure', profession: 'soldier', level: 3, name: 'Imposing Figure', tag: 'action',
    description: 'You may spend an action to display an imposing figure to appear more challenging to your enemies. Attempt to give one enemy within 10ft of you who you can see Taunt equal to half your Proficiency (rounded up). They roll Courage Checks against the effect.' },
  { id: 'sol_tower_training', profession: 'soldier', level: 7, name: 'Tower Training', tag: 'passive',
    description: "When you wield a Tower Shield, increase your PD by 1. When you use the Steady action while wielding a Tower Shield, you may use a reaction to add your shield's TD benefit to an ally within 5ft of you." },
  { id: 'sol_legendary_shield', profession: 'soldier', level: 15, name: 'Legendary Shield', tag: 'passive',
    description: 'Increase your PD, TD, and MD by 1. Increase the damage dice dealt by melee attacks you make while wielding a shield by one dice type.' },
  { id: 'legendary_group', profession: 'soldier', level: 11, legendary: true, name: 'Group Mastery', tag: 'passive',
    description: 'Double the radius of all call auras (e.g., calls with a 15ft range now have a 30ft range).' },
  { id: 'legendary_reactive', profession: 'soldier', level: 11, legendary: true, name: 'Reactive Mastery', tag: 'passive',
    description: 'Gain one additional reaction each turn.' },
  { id: 'legendary_second', profession: 'soldier', level: 11, legendary: true, name: 'Second Mastery', tag: 'passive',
    description: 'Take both of the Level 5 Soldier Mastery abilities that you did not take at Level 5.' },

  // Thug
  { id: 'thug_semper_steady', profession: 'thug', level: 3, name: 'Semper Steady', tag: 'passive',
    description: 'Your first reaction each turn is always treated as Steadied.' },
  { id: 'thug_fast_reflexes', profession: 'thug', level: 7, name: 'Fast Reflexes', tag: 'boost',
    description: 'Once per turn as a boost to your first melee attack in a turn, you may reduce the cost of that attack by 1AP. Still exhaust any limbs you would exhaust through this attack.' },
  { id: 'thug_toxic_masculinity', profession: 'thug', level: 15, name: 'Toxic Masculinity', tag: 'passive',
    description: 'Increase the damage dice of all melee attacks you make by one type.' },
  { id: 'legendary_alarming', profession: 'thug', level: 11, legendary: true, name: 'Alarming Mastery', tag: 'passive',
    description: 'Treat all enemies as surprised for your first turn in combat.' },
  { id: 'legendary_endurance', profession: 'thug', level: 11, legendary: true, name: 'Endurance Mastery', tag: 'passive',
    description: 'You are immune to being Fatigued from enemy effects. When you would be given Fatigue through Rage ending, roll Power Checks against the effect (against your own Check DC). Only take Fatigue if you fail these checks.' },
  { id: 'legendary_death', profession: 'thug', level: 11, legendary: true, name: 'Death Mastery', tag: 'passive',
    description: 'The first time you would be reduced to 0 HP when you are raging, roll XD4 and add it to your HP, where X is your Power. Do not gain Exhaustion from being Wounded.' },

  // ---- Prestige professions (SAoW Prestige Classes addendum). Their features follow the *profession* level
  // ("Gain the below according to your Magus level"), not the character's absolute level.
  // Magus
  { id: 'mg_scrollwriter', profession: 'magus', level: 3, prestige: true, name: 'Scrollwriter', tag: 'passive',
    description: 'Gain 3 Spell Slots.' },
  { id: 'mg_research_breakthrough', profession: 'magus', level: 5, prestige: true, name: 'Research Breakthrough', tag: 'passive',
    description: 'Immediately research up to 3 abilities for which you meet the requirements, without expending a long rest action.' },
  { id: 'mg_mastery_of_the_tome', profession: 'magus', level: 5, prestige: true, name: 'Mastery of the Tome', tag: 'passive',
    description: 'Gain 3 Spell Slots.' },
  { id: 'mg_mastery_of_the_body', profession: 'magus', level: 5, prestige: true, name: 'Mastery of the Body', tag: 'passive',
    description: 'Gain 2 additional HP per level.' },
  { id: 'mg_mastery_of_focus', profession: 'magus', level: 5, prestige: true, name: 'Mastery of Focus', tag: 'passive',
    description: 'You are immune to any effect that would cause you to end Focus on a Focus action against your Will.' },
  { id: 'mg_talented_mage', profession: 'magus', level: 7, prestige: true, name: 'Talented Mage', tag: 'passive',
    description: 'Gain one additional Talent Point to spend this level. You must spend this Talent point on Knowledge Talents.' },
  { id: 'mg_legendary_research_breakthrough', profession: 'magus', level: 11, prestige: true, legendary: true, name: 'Research Breakthrough (Legendary)', tag: 'passive',
    description: 'Immediately research up to 5 abilities for which you meet the requirements, without expending a long rest action.' },
  { id: 'mg_legendary_mind_slots', profession: 'magus', level: 11, prestige: true, legendary: true, name: 'Mastery of the Mind (Spell Slots)', tag: 'passive',
    description: 'Gain 3 Spell Slots.' },
  { id: 'mg_legendary_schools', profession: 'magus', level: 11, prestige: true, legendary: true, name: 'Mastery of Schools', tag: 'passive',
    description: 'Choose one ability from a different subclass than yours. Research that ability and add it to your Tome. You may take this ability (as may those who follow).' },
  { id: 'mg_legendary_mind_advantage', profession: 'magus', level: 11, prestige: true, legendary: true, name: 'Mastery of the Mind (Advantage)', tag: 'passive',
    description: 'Gain 1X Advantage to all Wiles and Fate Checks you make.' },
  { id: 'mg_master_of_research', profession: 'magus', level: 15, prestige: true, name: 'Master of Research', tag: 'passive',
    description: 'Immediately research any abilities of your subclass that you have not already researched.' },

  // Witch
  { id: 'wt_pinetar', profession: 'witch', level: 3, prestige: true, name: 'Pinetar', tag: 'action',
    description: 'Choose one enemy target within 5ft of you. They make Finesse Checks against your Check DC or lose one AP to use on their next turn. You can only use this once per turn. This does not count as Fatigue, and stacks with it.' },
  { id: 'wt_aura_of_the_grotto', profession: 'witch', level: 5, prestige: true, name: 'Aura of the Grotto', tag: 'focus',
    description: '(Prerequisite: Promise of Nonviolence). In a 5Xft aura around you (where X is half your Proficiency, rounded up), all allies gain 1X Advantage to Trait Checks against Adversarial Conditions given to them for as long as you maintain Focus.' },
  { id: 'wt_aura_of_bane', profession: 'witch', level: 5, prestige: true, name: 'Aura of Bane', tag: 'focus',
    description: '(Prerequisite: Promise of Vengeance). In a 5Xft aura around you (where X is half your Proficiency, rounded up), all enemies gain 1X Disadvantage to Trait Checks against Adversarial Conditions given to them for as long as you maintain Focus.' },
  { id: 'wt_tempered_aura', profession: 'witch', level: 5, prestige: true, name: 'Tempered Aura', tag: 'focus',
    description: '(Prerequisite: Promise of Justice). In a 5Xft aura around you (where X is half your Proficiency, rounded up), all creatures are immune to Panic and Taunt. If they have Panic or Taunt, they lose all levels when they enter the aura.' },
  { id: 'wt_witchs_presence', profession: 'witch', level: 7, prestige: true, name: "Witch's Presence", tag: 'passive',
    description: 'Choose one Weak Adversarial Condition: Nausea, Pinned, Paralysis, Delirium, Jinxed, Slowed, Sting. Your whole party (including you) is immune to this condition whenever you are present for the combat and conscious.' },
  { id: 'wt_mastery_of_nonviolence', profession: 'witch', level: 11, prestige: true, legendary: true, name: 'Mastery of Nonviolence', tag: 'passive',
    description: '(Prerequisite: Promise of Nonviolence). When you use Hallowed Touch, increase the dice type of effects by one additional dice type.' },
  { id: 'wt_mastery_of_vengeance', profession: 'witch', level: 11, prestige: true, legendary: true, name: 'Mastery of Vengeance', tag: 'passive',
    description: '(Prerequisite: Promise of Vengeance). When you use Baneful Scratch, increase the damage dice of Baneful Scratch by one additional dice type.' },
  { id: 'wt_mastery_of_justice', profession: 'witch', level: 11, prestige: true, legendary: true, name: 'Mastery of Justice', tag: 'passive',
    description: 'When you use Tweak the Heart, increase the target\'s Check DC by 2, instead of 1.' },
  { id: 'wt_witchs_control', profession: 'witch', level: 15, prestige: true, name: "Witch's Control", tag: 'boost',
    description: "You may use Witch's Finger on every adversarial condition." },
];
