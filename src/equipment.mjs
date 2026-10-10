/**
 * Armor Adornments (book p.195) — hand-transcribed, since they're not in the Roll20 catalogs (the Trinkets are in
 * src/goods.mjs, with the rest of the Personal Goods). They are conditional/triggered effects, so — like the Masteries and the
 * display-only conditions — they ship as compendium `gear` Items carrying the effect as rules text
 * (with retail value), rather than auto-wired Active Effects. Adornments note their armor
 * prerequisite; the book's "one adornment per armor piece" cap is left to the table (descriptive).
 */

export const ADORNMENTS = [
  { name: 'Shimmering Polish', armor: 'Iron Set', value: 30, description: "When you hold a source of light, increase the radius of that light by 5ft Bright and 5ft Dim." },
  { name: 'Flowing Robes', armor: 'Cloth Set', value: 50, description: "When you kill an enemy, gain 1 HP." },
  { name: 'Embossed Patch', armor: 'Leather Set', value: 60, description: "When you are surrounded, increase the damage dice of your first melee attack each turn by one dice type." },
  { name: 'Tusk Headdress', armor: 'Fur Set', value: 80, description: "When you add no AD, PD, MD, or TD from the armor you wear, gain +1 DR." },
  { name: 'Painted Face', armor: 'Dye Set', value: 50, description: "Roll 1D6 at the start of combat. You may add that roll to any 1D20 roll made on your first turn." },
  { name: 'Brittlework', armor: 'Wrought Style', value: 50, description: "The first Rend dealt to you is dealt to this item and breaks it. It can be repaired during a nightly rest." },
  { name: 'Visaged Breastplate', armor: 'Bulwark Style', value: 50, description: "Reduce your Move Speed by 5ft. Whenever you give Taunt or Panic, give one more." },
  { name: 'Momentum Charm', armor: 'Padded Style', value: 50, description: "Once per turn, when you move 15ft or more towards an enemy just before you make a 1H attack action against them, increase that damage's dice type by one." },
  { name: 'Finger Necklace', armor: 'Divine Style', value: 100, description: "For each Battle Fatigue you have from being Wounded, gain 1 DR." },
  { name: 'Feathered Headdress', armor: 'Feathered Style', value: 20, description: "Treat all distances you fall as 10ft shorter." },
  { name: 'Stamped Feathers', armor: 'Platted Style', value: 30, description: "Whenever your armor is fully rended, increase your Move Speed by 10ft." },
  { name: 'Cloak of Faces', armor: 'Cloaked Style', value: 100, description: "The first time each turn you 5ft adjust, you do not provoke an attack of opportunity." },
  { name: 'Moonstone Earrings', armor: 'Lucky Style', value: 100, description: "When you expend a Lore Point, roll 1D10. On a 10, you do not expend the Lore Point." },
];

/**
 * Weapons (book pp.187–189) — the Basic, Military, Imbued, and example Cultural weapon tables. Each ships
 * as a compendium `gear` Item carrying the weapon facet (type/base dice/target defense/reach), so dropping
 * one on a character auto-creates its attack ability (see module/sacadia.mjs). `type` is the book's weapon
 * *family*; `hands`, `reach` (5 or 10ft) and `range` (thrown/ranged feet) drive the generated attack.
 * `defense` is the targeted defense; the governing stat is derived (MD→Wiles, ranged→Finesse, else Power).
 * Versatile weapons are modelled at their melee mode (the 40ft throw is noted in text, a later nuance).
 */
export const WEAPONS = [
  // --- Basic ---
  { name: 'Fist Wraps', type: 'unarmed', hands: 1, reach: 5, count: 1, denom: 4, defense: 'pd', damageType: 'Bludgeon', value: 2 },
  { name: 'Kukri', type: 'dagger', hands: 1, reach: 5, count: 1, denom: 4, defense: 'pd', damageType: 'Slashing', value: 10 },
  { name: 'Sharp Rock', type: 'unarmed', hands: 1, reach: 5, throw: 40, count: 1, denom: 4, defense: 'pd', damageType: 'Bludgeon', value: 0, note: 'Versatile: may be thrown up to 40ft.' },
  { name: 'Dagger', type: 'dagger', hands: 1, reach: 5, throw: 40, count: 1, denom: 4, defense: 'td', damageType: 'Piercing', value: 5, note: 'Versatile: may be thrown up to 40ft.' },
  { name: 'Hand Axe', type: 'axe', hands: 1, reach: 5, throw: 40, count: 1, denom: 6, defense: 'pd', damageType: 'Slashing', value: 25, note: 'Versatile: may be thrown up to 40ft.' },
  { name: 'Spear', type: 'spear', hands: 1, reach: 5, throw: 40, count: 1, denom: 6, defense: 'td', damageType: 'Piercing', value: 15, note: 'Versatile: may be thrown up to 40ft.' },
  { name: 'Short Sword', type: 'sword', hands: 1, reach: 5, count: 1, denom: 6, defense: 'pd', damageType: 'Slashing', value: 20 },
  { name: 'Club or Staff', type: 'bludgeon', hands: 1, reach: 5, count: 1, denom: 6, defense: 'pd', damageType: 'Bludgeon', value: 10 },
  { name: 'Sling', type: 'sling', hands: 1, range: 60, count: 1, denom: 4, defense: 'pd', damageType: 'Bludgeon', value: 3 },
  { name: 'Shortbow', type: 'bow', hands: 2, range: 120, count: 1, denom: 6, defense: 'td', damageType: 'Piercing', value: 50 },
  // --- Military (Training: Military Weapons unless noted Heavy) ---
  { name: 'Pike', type: 'spear', hands: 2, reach: 10, count: 1, denom: 6, defense: 'td', damageType: 'Piercing', value: 30, prereq: 'Training: Military Weapons' },
  { name: 'Longsword', type: 'sword', hands: 2, reach: 5, count: 1, denom: 8, defense: 'pd', damageType: 'Slashing', value: 55, prereq: 'Training: Military Weapons' },
  { name: 'War Axe', type: 'axe', hands: 2, reach: 5, count: 1, denom: 8, defense: 'pd', damageType: 'Slashing', value: 60, prereq: 'Training: Military Weapons' },
  { name: 'Mace', type: 'bludgeon', hands: 2, reach: 5, count: 1, denom: 8, defense: 'pd', damageType: 'Bludgeon', value: 60, prereq: 'Training: Military Weapons' },
  { name: 'Crossbow', type: 'crossbow', hands: 2, range: 120, count: 1, denom: 4, defense: 'td', damageType: 'Piercing', value: 60, prereq: 'Training: Military Weapons' },
  { name: 'Composite Bow', type: 'bow', hands: 2, range: 200, count: 1, denom: 8, defense: 'td', damageType: 'Piercing', value: 100, prereq: 'Training: Military Weapons' },
  { name: 'Halberd', type: 'spear', hands: 2, reach: 10, count: 1, denom: 8, defense: 'td', damageType: 'Piercing', value: 200, prereq: 'Training: Heavy Weapons' },
  { name: 'Greatsword', type: 'sword', hands: 2, reach: 5, count: 1, denom: 10, defense: 'pd', damageType: 'Slashing', value: 200, prereq: 'Training: Heavy Weapons' },
  { name: 'Great Axe', type: 'axe', hands: 2, reach: 5, count: 1, denom: 10, defense: 'pd', damageType: 'Slashing', value: 200, prereq: 'Training: Heavy Weapons' },
  { name: 'Greater Club', type: 'bludgeon', hands: 2, reach: 5, count: 1, denom: 10, defense: 'pd', damageType: 'Bludgeon', value: 200, prereq: 'Training: Heavy Weapons' },
  // --- Imbued (target MD → Wiles) ---
  { name: 'Bone Cudgel', type: 'bludgeon', hands: 1, reach: 5, count: 1, denom: 4, defense: 'md', damageType: 'Bludgeon', value: 40, prereq: 'Wiles[1]' },
  { name: 'Athame', type: 'dagger', hands: 1, reach: 5, count: 1, denom: 4, defense: 'md', damageType: 'Slashing', value: 60, prereq: 'Wiles[1]' },
  { name: 'Kris', type: 'dagger', hands: 1, reach: 5, count: 1, denom: 4, defense: 'md', damageType: 'Piercing', value: 60, prereq: 'Wiles[1]' },
  { name: 'Vine Staff', type: 'bludgeon', hands: 1, reach: 5, count: 1, denom: 6, defense: 'md', damageType: 'Bludgeon', value: 120, prereq: 'Wiles[2], Fate[1]' },
  { name: 'Ceremonial Blade', type: 'sword', hands: 1, reach: 5, count: 1, denom: 4, defense: 'md', damageType: 'Slashing', value: 150, prereq: 'Wiles[2], Fate[1]' },
  { name: 'Great Tumi', type: 'sword', hands: 1, reach: 5, count: 1, denom: 6, defense: 'md', damageType: 'Slashing', value: 200, prereq: 'Wiles[2], Fate[1]' },
  { name: 'Black Lance', type: 'spear', hands: 2, reach: 10, count: 1, denom: 6, defense: 'md', damageType: 'Piercing', value: 300, prereq: 'Wiles[3], Fate[1]' },
  { name: 'Divine Bow', type: 'bow', hands: 2, range: 200, count: 1, denom: 6, defense: 'md', damageType: 'Piercing', value: 500, prereq: 'Wiles[3], Fate[2]' },
  // --- Cultural / example ---
  { cultural: true, name: 'Shuriken', type: 'dagger', hands: 1, range: 60, count: 1, denom: 4, defense: 'td', damageType: 'Slashing', value: 10, prereq: 'Finesse[1]', note: 'On a critical hit, may give Hemorrhage at range.' },
  { cultural: true, name: 'Bola', type: 'sling', hands: 1, range: 60, defense: 'pd', value: 50, prereq: 'Finesse[1]', note: 'Deals no damage. On hit, the target makes Trait Checks against 3 Pin.' },
  { cultural: true, name: 'Greensword', type: 'sword', hands: 2, reach: 5, count: 2, denom: 10, defense: 'md', damageType: 'Slashing', value: 5000, prereq: 'Training: Heavy Weapons, Fate[3]', note: 'Sickly Radiation: at the start of each round you wield it, take 1D6 damage and permanently reduce your Max HP by that amount.' },
];

/**
 * Armor sets (book pp.192–193). Five types × six quality tiers. Each ships as a compendium `armor` Item
 * with its flat defenses, Max Stat cap, weight class (Iron→heavy, Cloth/Dye→light, Leather/Fur→medium),
 * and retail value. `def` lists only the non-zero defenses. Styles / add-ons are a later slice.
 */
export const ARMORS = [
  // Iron — heavy (PD focus)
  { name: 'Shoddy Iron Set', category: 'heavy', def: { td: 2, pd: 7 }, maxStat: 19, value: 20, prereq: 'Heavy Armor Training' },
  { name: 'Basic Iron Set', category: 'heavy', def: { td: 2, pd: 8 }, maxStat: 22, value: 60, prereq: 'Heavy Armor Training, Prof[2]' },
  { name: 'Professional Iron Set', category: 'heavy', def: { td: 3, pd: 9 }, maxStat: 25, value: 200, prereq: 'Heavy Armor Training, Prof[3]' },
  { name: "Craftsman's Iron Set", category: 'heavy', def: { td: 3, pd: 10 }, maxStat: 27, value: 600, prereq: 'Heavy Armor Training, Prof[4]' },
  { name: 'Masterwork Iron Set', category: 'heavy', def: { td: 4, pd: 11 }, maxStat: 29, value: 1000, prereq: 'Heavy Armor Training, Prof[5]' },
  { name: 'Legendary Iron Set', category: 'heavy', def: { td: 4, pd: 12 }, maxStat: 31, value: 2500, prereq: 'Heavy Armor Training, Prof[6]' },
  // Cloth — light (MD focus)
  { name: 'Shoddy Cloth Set', category: 'light', def: { md: 7 }, maxStat: 20, value: 10, prereq: 'Light Armor Training' },
  { name: 'Basic Cloth Set', category: 'light', def: { md: 8 }, maxStat: 22, value: 40, prereq: 'Light Armor Training, Prof[2]' },
  { name: 'Professional Cloth Set', category: 'light', def: { ad: 1, md: 9 }, maxStat: 24, value: 140, prereq: 'Light Armor Training, Prof[3]' },
  { name: "Craftsman's Cloth Set", category: 'light', def: { ad: 1, md: 10 }, maxStat: 27, value: 400, prereq: 'Light Armor Training, Prof[4]' },
  { name: 'Masterwork Cloth Set', category: 'light', def: { ad: 2, md: 11 }, maxStat: 30, value: 800, prereq: 'Light Armor Training, Prof[5]' },
  { name: 'Legendary Cloth Set', category: 'light', def: { ad: 2, md: 12 }, maxStat: 32, value: 2000, prereq: 'Light Armor Training, Prof[6]' },
  // Dye — light (AD focus)
  { name: 'Shoddy Dye Set', category: 'light', def: { ad: 2 }, maxStat: 17, value: 20, prereq: 'Light Armor Training' },
  { name: 'Basic Dye Set', category: 'light', def: { ad: 3 }, maxStat: 19, value: 50, prereq: 'Light Armor Training, Prof[2]' },
  { name: 'Professional Dye Set', category: 'light', def: { ad: 4 }, maxStat: 21, value: 150, prereq: 'Light Armor Training, Prof[3]' },
  { name: "Craftsman's Dye Set", category: 'light', def: { ad: 5 }, maxStat: 23, value: 450, prereq: 'Light Armor Training, Prof[4]' },
  { name: 'Masterwork Dye Set', category: 'light', def: { ad: 6 }, maxStat: 25, value: 850, prereq: 'Light Armor Training, Prof[5]' },
  { name: 'Legendary Dye Set', category: 'light', def: { ad: 7 }, maxStat: 27, value: 1800, prereq: 'Light Armor Training, Prof[6]' },
  // Leather — medium (TD focus)
  { name: 'Shoddy Leather Set', category: 'medium', def: { td: 4, pd: 1 }, maxStat: 20, value: 15, prereq: 'Medium Armor Training' },
  { name: 'Basic Leather Set', category: 'medium', def: { td: 5, pd: 2, md: 1 }, maxStat: 22, value: 50, prereq: 'Medium Armor Training, Prof[2]' },
  { name: 'Professional Leather Set', category: 'medium', def: { td: 6, pd: 3, md: 2 }, maxStat: 24, value: 180, prereq: 'Medium Armor Training, Prof[3]' },
  { name: "Craftsman's Leather Set", category: 'medium', def: { td: 7, pd: 4, md: 3 }, maxStat: 27, value: 500, prereq: 'Medium Armor Training, Prof[4]' },
  { name: 'Masterwork Leather Set', category: 'medium', def: { td: 8, pd: 5, md: 4 }, maxStat: 30, value: 900, prereq: 'Medium Armor Training, Prof[5]' },
  { name: 'Legendary Leather Set', category: 'medium', def: { td: 9, pd: 6, md: 5 }, maxStat: 32, value: 2200, prereq: 'Medium Armor Training, Prof[6]' },
  // Fur — medium (DR focus)
  { name: 'Shoddy Fur Set', category: 'medium', def: { ad: 1, dr: 1 }, maxStat: 14, value: 20, prereq: 'Medium Armor Training' },
  { name: 'Basic Fur Set', category: 'medium', def: { ad: 1, dr: 3 }, maxStat: 16, value: 50, prereq: 'Medium Armor Training, Prof[2]' },
  { name: 'Professional Fur Set', category: 'medium', def: { ad: 2, dr: 5 }, maxStat: 19, value: 200, prereq: 'Medium Armor Training, Prof[3]' },
  { name: "Craftsman's Fur Set", category: 'medium', def: { ad: 2, dr: 7 }, maxStat: 21, value: 600, prereq: 'Medium Armor Training, Prof[4]' },
  { name: 'Masterwork Fur Set', category: 'medium', def: { ad: 3, dr: 9 }, maxStat: 23, value: 1200, prereq: 'Medium Armor Training, Prof[5]' },
  { name: 'Legendary Fur Set', category: 'medium', def: { ad: 3, dr: 11 }, maxStat: 25, value: 3000, prereq: 'Medium Armor Training, Prof[6]' },
];

/**
 * Shields (book p.196) — dual-natured: an `armor` Item whose flat PD/TD sums into defenses with no Max
 * Stat (so it doesn't count against the cap), *plus* a Shield Bash weapon facet (`weaponType: 'shield'`,
 * `bash` dice) that auto-generates a Bash attack. Bash is a Bludgeon attack vs PD (Power), reach 5ft.
 * Shields carry no armor weight class. Buckler/Tower add-on rules (unarmed strike, cover, −5ft) are noted
 * in text. `def` lists only the non-zero defenses.
 */
export const SHIELDS = [
  { name: 'Light Buckler', def: { pd: 1 }, count: 1, denom: 4, value: 40, prereq: 'Medium Armor Training' },
  { name: 'Armored Buckler', def: { pd: 2 }, count: 1, denom: 6, value: 120, prereq: 'Medium Armor Training, Prof[3]' },
  { name: 'Armored Rogue Buckler', def: { pd: 2 }, count: 1, denom: 8, value: 260, prereq: 'Medium Armor Training, Prof[4]' },
  { name: 'Wood Shield', def: { td: 2 }, count: 1, denom: 4, value: 30, prereq: 'Medium Armor Training' },
  { name: 'Leather Shield', def: { td: 2, pd: 1 }, count: 1, denom: 6, value: 90, prereq: 'Medium Armor Training, Prof[3]' },
  { name: 'Spiked Leather Shield', def: { td: 2, pd: 1 }, count: 1, denom: 8, value: 150, prereq: 'Medium Armor Training, Prof[3]' },
  { name: 'Metal Shield', def: { td: 3, pd: 1 }, count: 1, denom: 8, value: 200, prereq: 'Medium Armor Training, Prof[5]' },
  { name: 'Spiked Metal Shield', def: { td: 3, pd: 1 }, count: 1, denom: 10, value: 300, prereq: 'Medium Armor Training, Prof[5]' },
  { name: 'Light Tower Shield', def: { td: 3 }, count: 1, denom: 6, value: 60, prereq: 'Heavy Armor Training, Power 2', note: 'Tower Shield: −5ft Move Speed; creatures directly behind you have Full Cover.' },
  { name: 'Professional Tower Shield', def: { td: 4 }, count: 1, denom: 8, value: 200, prereq: 'Heavy Armor Training, Power 3', note: 'Tower Shield: −5ft Move Speed; creatures directly behind you have Full Cover.' },
  { name: 'Armored Tower Shield', def: { td: 5 }, count: 1, denom: 10, value: 500, prereq: 'Heavy Armor Training, Power 4', note: 'Tower Shield: −5ft Move Speed; creatures directly behind you have Full Cover.' },
  { name: 'Heavy Tower Shield', def: { td: 6 }, count: 2, denom: 6, value: 1000, prereq: 'Heavy Armor Training, Power 5', note: 'Tower Shield: −5ft Move Speed; creatures directly behind you have Full Cover.' },
];
