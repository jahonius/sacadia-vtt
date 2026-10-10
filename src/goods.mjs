/**
 * Personal Goods (rulebook v1.2 printed pp.197–210) and Home Goods (pp.211–212), transcribed from the PDF. Each table is a
 * category: its items (name, Item Slots, the slot notes in brackets, retail value and coin, properties) and the item
 * rules printed beneath it. src/build-goods.mjs turns them into `gear` Items in the Personal Goods, Trinkets and Home Goods
 * compendiums, one compendium folder per table.
 *
 * Item fields:
 *  - `slots` — Item Slots (0 for the book's "N/A"); `tags` — the slot notes ("Small", "Quickdraw", "RIS Passive", "Worn");
 *    `props` — the Properties column (clothing, add-ons), whose rules (PROPERTIES) are added to the description.
 *  - `value` and `coin` ('gc', or 'sc' for silver prices), `prereq`, and `rules`: the item's own rules, [tag, title, text].
 *  - What the sheet works with: `providesSis` / `providesRis` and `storageGroup` (only the largest of a group counts),
 *    `storage` ('sis' for containers and things not carried), `light` (lit sources light the token), `jewelry` (the
 *    condition it guards against), `rune` (the defense changes it makes while active), `use` (a consumable the sheet can
 *    use up), and `weapon` (the weapon facet: the Torch as a club).
 *  - `bargain`: the Shop for Bargains table (p.266) the item is rolled on.
 *
 * Ability tags as printed: P Passive, A Action, R Reaction, B Boost, F Focus, C Ceremony. Where the PDF drops an icon
 * (a limb), the text names it ("in one hand"). A few printed inconsistencies are kept and noted (Chest (Large), the
 * Solar Rune, the two Healing Date texts); they're listed in docs/rules-questions-for-designer.md.
 */

const P = 'Passive', A = 'Action', R = 'Reaction', B = 'Boost', F = 'Focus', C = 'Ceremony';

/** Property rules (the clothing properties p.198, the add-ons p.199, Jewelry p.208, Runes p.209). */
export const PROPERTIES = {
  'Worn': [P, "Worn Items can be worn on your person. A Worn Item must still be placed in RIS to use, but if it is in your RIS, it is assumed that you are wearing it. If it is in your SIS, it is assumed that the item is in your bags. Many Worn items have an effect when worn."],
  'Clothes Set': [P, "You must equip at least one item marked Clothes Set to interact with humans from cultures that wear clothing."],
  'Hat': [P, "When worn in a RIS slot, you have protection from Bright lights from a source. Provided you are not attacking the source (or something wielding the source) of a bright light, you may ignore the Bright Condition from a single source."],
  'Impoverished': [P, "When you wear this item, you appear obviously impoverished. This can be helpful when interacting with poor communities, and may hinder when you attempt to interact with the wealthy."],
  'Scented': [P, "When you wear this item, you have a noticeable (pleasant) scent. Define the scent when you purchase this item. It is uniquely yours. All creatures have 1X Advantage to identify you by smell or track you."],
  'Shoes': [P, "<em>Prerequisite: Finesse[2].</em> Shoes protect your feet from terrain challenges. If you wear shoes, you may 5ft adjust into difficult terrain."],
  'Wealthy': [P, "When you wear this item, you appear obviously wealthy. This can be helpful when interacting with rich communities, and may hinder when you attempt to interact with the poor."],
  'Winter': [P, "You must wear a Winter Clothes Set to enter cold regions of the world. For each additional Winter Item you wear in your RIS, gain 1X Advantage against the effects of cold storms when you travel or in combat."],
  'Add-On': [P, "Add-Ons are made to an item with the Clothes Set property. They take no item slot: denote them on the Clothing Set to which they are added."],
  'Belt': [P, "In a pinch, a belt can be used as 5ft of rope. You may add a maximum of 1 belt to any Clothing Set."],
  'Goldwing': [P, "<em>Prerequisite: Sandals.</em> When you purchase this, choose a pair of Sandals to which they apply. When wearing those Sandals, increase your base move speed by 5ft."],
  'Hidden': [P, "This item is obscured. A creature must make a Perception: Sight or Perception: Touch Trait Check against your Check DC to identify this item."],
  'Pocket': [P, "This item gives you 1 RIS. You may only place a Trinket in this RIS slot. You may add a maximum of 2 Pockets to any Clothing Set."],
  'Shrimp': [P, "<em>Prerequisite: Boots.</em> When you purchase this item, apply it to a pair of boots. When you wear that pair of boots, you can 5ft adjust in water."],
  'Sigil': [P, "This item identifies something about you: it can be your family sigil, your country, or your guild. When you purchase this item, denote what it signifies. At a glance, anyone can identify the sigil. You may add a maximum of 1 Sigil to any Clothing Set."],
  'Jewelry': [P, "Gain 1X Advantage against taking the X condition when it is first given to you, as well as on all uses of the “Make Trait Check” action against the specified X condition. The condition X is specified by the type of jewelry (the Jewelry Boons table)."],
  'Rune': [A, "Runes must be worn on armor, and equipped in your RIS to use. You can activate or deactivate a Rune with an action when it is in your RIS, without taking it out of your RIS. When activated, Runes will change or alter your Armor Properties according to the rune type. You can deactivate it with another action. If you activate one Rune equipped in RIS, any other Runes you have activated will automatically deactivate."],
};

/* -------------------------------------------- */
/*  Shared rule texts                           */
/* -------------------------------------------- */

const ILLUMINATE = [A, 'Illuminate/Extinguish', "You light (or extinguish) a source of illumination held in one hand provided you have Flint and Tinder in a combat-readied item slot. All light sources are Quickdraw."];
const CRAFTING_KIT = [P, 'Crafting Kit', "When you purchase this crafting kit, you must declare the crafting Talent that this crafting kit applies to. You may only use this Crafting Kit with that talent. Crafting Kits are most useful for crafting magic items; in all cases, you must have a crafting kit in order to craft (see the Crafting Section). Most towns and villages will have craft stations for rent which will let you craft some types of items."];
const CRAFT_INGREDIENT = [P, 'Craft Ingredients', "You cannot go into a market to purchase craft ingredients from this table. Instead, you must search a market for rare finds (see the Crafting Section). Once you have found a Rare Find, you must purchase it according to these costs. You cannot identify that a Craft Ingredient has a Special Property, Craft Taint, or the Relic Property until you purchase it, and these do not affect the price of items."];
const MOUNTS = [P, 'Mounts and Vehicles', "Mounts and vehicles are particularly useful for travel (the travel rules cover them). Mounts in Sacadia vary by region and culture; your Cultural Tapestry may say which. If not, the default mount is a Helk (a large elk that can be ridden)."];
const STORED = "Storage Items store other items. Their Item Slots are how many item slots the Storage Item consumes, rather than how many it provides; Stored Baggage provides SIS.";
const READIED = [P, 'Readied Baggage', "All Readied baggage items must be equipped to RIS to work. When occupying RIS, baggage items create extra RIS within them, often with specific requirements."];
const ONE_BOX = "You may only benefit from one Chest, Ornate Box, or Craft Pouch at a time.";
const FIRST_AID_KIT = [C, 'First Aid Kit', "<em>Prerequisite: Medicine General Talent.</em> First Aid Kits have X charges. During Quick Rests, you may expend any number of charges. For each charge expended, choose one ally and roll a Medicine Check against your own Check DC. If you succeed, the ally gains 1 HP Pool to spend immediately. First Aid Kits expend all charges during a Long Rest."];
const LOCKS = [P, 'Locks and Keys', "If you have a lock and key, you may put that lock and key on a box to secure it. If you do, creatures must succeed at a Roguecraft or Power Check to break the lock."];
const PICK_LOCK = [A, 'Pick Lock', "<em>Prerequisite: Nimble Hands: Roguecraft[1].</em> You must have a Lockpick Kit equipped in both hands to use this ability. You attempt to pick a lock. A simple lock has a DC14 Check DC. An Advanced Lock has a DC19 Check DC. A Master’s Lock has a DC24 Check DC. Each lock comes with a Level. You must succeed at this check a number of times equal to the Lock level to open it. After opening it, you may close the lock again to lock it once more."];
const BREAK_LOCK = [A, 'Break Lock', "Make a Power Check to attempt to brute force break a lock. A simple lock has a DC22 Check DC. An Advanced Lock has a DC27 Check DC. A Master’s Lock has a DC32 Check DC. When you break the lock, it is destroyed."];
const KEY = [A, 'Key', "When you have a key equipped in one hand, and a lock that matches that key, you can open the lock with an action. After opening it, you may close the lock again to lock it once more."];
const HOLY_SYMBOL = [P, 'Holy Symbols', "If you hold a holy symbol, you can pray in both longform and shortform situations. Prayer as a Longform action is the Pray for Guidance Long Rest Action."];
const PRAY = [F, 'Pray', "<em>Prerequisite: Religion, Fate[1].</em> For as long as you pray, you cannot take any other actions or reactions. Spend all your AP on Prayer each turn. This ability has no effect if you do not spend your full turn in prayer. You may only use this ability when you hold a holy symbol in hand.<br/><strong>Fumble:</strong> Choose one target enemy you can see. They gain Fumble equal to twice the AP you spend on your turn.<br/><strong>Fates:</strong> Make a consistent Fate Check using all AP. You may exchange one ally D20 rolled with your Fate Check before the start of your next turn."];
const OFFERING = [P, 'Making an Offering', "As a Long Rest action, you may use Religion to make an Offering to your deity, potentially gaining their favor. To do so, you must make at least a token offering (1gc). You may, alternatively, spend any amount of money on offerings, in 100gc increments, to gain 1X advantage/100gc spent on your Offering Long Rest Action."];
const WRITE = [C, 'Write', "<em>Prerequisite: Literacy.</em> You create a written work during rests and downtime. For each hour you spend writing, you may create one page worth of quality written word, or three pages of hasty scrawl. To do this, you must have something to write with (charcoal, ink, etc.) and something to write on (paperweave, scroll, wood slips). The raw ingredients used to create your written document are consumed when you write. You may write anything during nightly rests, or small notes to reference later during quick rests."];
const DRAW = [C, 'Draw/Paint', "<em>Prerequisite: Illustration[1].</em> You create an illustrated work during rests. For each hour you spend drawing or painting, you may create one canvas of quality painting or illustration. To do this, you must have something to illustrate with (charcoal, ink, etc.) and something to paint on (paperweave, scroll, wood slips). The raw ingredients used to create your illustrated document are consumed when you draw."];
const NIGHTLY = [P, 'Nightly Rests', "In order to nightly rest, a character must be Safe (nothing could attack you), Sheltered from the elements (in a tent, covered wagon, or lean-to), have Food and Water (clean water and food), and Comfort (you can rest your head comfortably: blankets, or a bedroll). Only then can you take a nightly rest."];
const REPAIR_KIT = [C, 'Repair Kit', "<em>Prerequisite: Smithing General Talent or Tailoring General Talent.</em> Repair Kits have X charges. During Quick Rests, you may expend any number of charges. For each charge expended, choose one set of Armor with Rend and make a Smithing Check (in the case of Heavy Armor) or Tailoring Check (in the case of Light or Medium Armor) against your own Check DC. If you succeed, remove one rend from that armor. Repair Kits expend all charges during a Long Rest."];

/* -------------------------------------------- */
/*  Personal Goods                              */
/* -------------------------------------------- */

export const PERSONAL_GOODS = [
  {
    key: 'clothing', name: 'Clothing', page: 198, bargain: 'clothes',
    note: "Every time you purchase or acquire a piece of clothing, you must describe that article of clothing. Clothing should reflect your culture, or the culture from which you acquired it.",
    items: [
      { name: 'Boots', props: ['Worn', 'Shoes', 'Winter'], slots: 1, value: 30, img: 'icons/equipment/feet/boots-leather-laced-brown.webp' },
      { name: 'Cloak (Simple)', props: ['Worn', 'Impoverished'], slots: 1, value: 12, img: 'icons/equipment/back/cloak-simple-tan.webp' },
      { name: 'Cloak (Winter)', props: ['Worn', 'Winter'], slots: 1, value: 30, img: 'icons/equipment/back/cloak-brown-fur-white.webp' },
      { name: 'Clothes (Simple)', props: ['Worn', 'Clothes Set', 'Impoverished'], slots: 1, value: 12, img: 'icons/equipment/chest/shirt-collared-brown.webp' },
      { name: 'Clothes (Traveler’s)', props: ['Worn', 'Clothes Set'], slots: 1, value: 55, img: 'icons/equipment/chest/shirt-collared-green.webp' },
      { name: 'Clothes (Wealthy)', props: ['Worn', 'Clothes Set', 'Wealthy'], slots: 1, value: 600, img: 'icons/equipment/chest/robe-layered-purple.webp' },
      { name: 'Hat (Simple)', props: ['Worn', 'Impoverished', 'Hat'], slots: 1, value: 8, img: 'icons/equipment/head/hat-belted-simple.webp' },
      { name: 'Hat (Worker’s)', props: ['Worn', 'Hat'], slots: 1, value: 12, img: 'icons/equipment/head/cap-simple-leather-brown.webp' },
      { name: 'Hat (Winter)', props: ['Worn', 'Winter', 'Hat'], slots: 1, value: 20, img: 'icons/equipment/head/hat-furred-brown.webp' },
      { name: 'Hat (Wealthy)', props: ['Worn', 'Wealthy', 'Hat'], slots: 1, value: 100, img: 'icons/equipment/head/hat-cocked-feather-green.webp' },
      { name: 'Perfume Vial (Simple)', props: ['Worn', 'Scented'], slots: 1, tags: ['Small'], value: 50, img: 'icons/consumables/potions/potion-vial-corked-purple.webp' },
      { name: 'Perfume Vial (Wealthy)', props: ['Worn', 'Scented', 'Wealthy'], slots: 1, tags: ['Small'], value: 100, img: 'icons/consumables/potions/potion-vial-corked-labeled-purple.webp' },
      { name: 'Sandals', props: ['Worn', 'Shoes'], slots: 1, value: 10, img: 'icons/equipment/feet/shoes-sandals.webp' },
      { name: 'Shoes', props: ['Worn', 'Shoes'], slots: 1, value: 18, img: 'icons/equipment/feet/shoes-leather-simple-brown.webp' },
    ],
  },
  {
    key: 'clothing-add-ons', name: 'Clothing Add-Ons', page: 199,
    note: "Small details and additions can be made to clothing you own. If you purchase these additions, you do not add them to your inventory, and these additions do not take an item slot. Instead, denote them on the Clothing Set to which they are added (on the sheet, they take no slots).",
    items: [
      { name: 'Belt', props: ['Add-On', 'Belt'], slots: 0, value: 1, img: 'icons/equipment/waist/belt-leather-brown.webp' },
      { name: 'Embroidery', props: ['Add-On'], slots: 0, value: 10, img: 'icons/commodities/cloth/cloth-bolt-embroidered-pink.webp' },
      { name: 'Pocket', props: ['Add-On', 'Pocket'], slots: 0, value: 1, providesRis: 1, img: 'icons/containers/bags/pouch-cloth-tan.webp' },
      { name: 'Pocket (Hidden)', props: ['Add-On', 'Pocket', 'Hidden'], slots: 0, value: 10, providesRis: 1, img: 'icons/containers/bags/pouch-simple-brown.webp' },
      { name: 'Shrimp Bauble', props: ['Add-On', 'Shrimp'], slots: 0, value: 50, img: 'icons/environment/creatures/crustacean-shrimp.webp' },
      { name: 'Sigil', props: ['Add-On', 'Sigil'], slots: 0, value: 5, img: 'icons/magic/symbols/rune-sigil-green.webp' },
      { name: 'Gold Wings', props: ['Add-On', 'Goldwing'], slots: 0, value: 200, img: 'icons/skills/movement/feet-winged-sandals-tan.webp' },
    ],
  },
  {
    key: 'crafting-kits', name: 'Crafting Kits', page: 199, bargain: 'crafting-kits',
    items: [
      { name: 'Crafting Kit (Basic)', slots: 1, value: 20, img: 'icons/tools/hand/hammer-and-nail.webp', rules: [CRAFTING_KIT, [P, 'Crafting Kit (Basic)', "You may craft basic items with this crafting kit (levels 1-3)."]] },
      { name: 'Crafting Kit (Advanced)', slots: 1, value: 100, img: 'icons/tools/hand/awl-steel-tan.webp', rules: [CRAFTING_KIT, [P, 'Crafting Kit (Advanced)', "You may craft advanced items with this crafting kit (levels 1-4)."]] },
      { name: 'Crafting Kit (Master)', slots: 1, value: 500, img: 'icons/tools/hand/chisel-steel-brown.webp', rules: [CRAFTING_KIT, [P, 'Crafting Kit (Master)', "You may craft master items with this crafting kit (levels 1-5)."]] },
      { name: 'Crafting Kit (Legendary)', slots: 1, value: 2500, img: 'icons/tools/hand/engraving-tool-black.webp', rules: [CRAFTING_KIT, [P, 'Crafting Kit (Legendary)', "You may craft legendary items with this crafting kit (levels 1-6)."]] },
    ],
  },
  {
    key: 'craft-ingredients', name: 'Craft Ingredients', page: 200,
    items: [
      { name: 'Craft Ingredient (Common)', slots: 1, value: 20, img: 'icons/commodities/materials/bowl-powder-grey.webp', rules: [CRAFT_INGREDIENT] },
      { name: 'Craft Ingredient (Uncommon)', slots: 1, value: 50, img: 'icons/commodities/materials/bowl-powder-teal.webp', rules: [CRAFT_INGREDIENT] },
      { name: 'Craft Ingredient (Rare)', slots: 1, value: 100, img: 'icons/commodities/materials/bowl-powder-blue.webp', rules: [CRAFT_INGREDIENT] },
      { name: 'Craft Ingredient (Very Rare)', slots: 1, value: 200, img: 'icons/commodities/materials/bowl-powder-pink.webp', rules: [CRAFT_INGREDIENT] },
      { name: 'Craft Ingredient (Legendary[1])', slots: 1, value: 500, img: 'icons/commodities/materials/bowl-powder-gold.webp', rules: [CRAFT_INGREDIENT] },
      { name: 'Craft Ingredient (Legendary[2])', slots: 1, value: 800, img: 'icons/commodities/materials/bowl-powder-yellow.webp', rules: [CRAFT_INGREDIENT] },
    ],
  },
  {
    key: 'illumination', name: 'Illumination', page: 200, bargain: 'illumination',
    note: "Illumination allows you to light the way, giving you sight where you might not have had it before.",
    items: [
      { name: 'Black Lens', slots: 0, value: 500, img: 'icons/tools/scribal/lens-grey-brown.webp', light: { addOn: true, scale: 0.5 },
        rules: [[P, 'Black Lens', "When you purchase Black Glass, choose a lantern to which it is affixed. The lantern illuminates Bright and Dim light half as far (round down), but that light reveals all creatures in the Hallowfell (i.e., any invisible creatures that are invisible through magical means)."]], noBargain: true },
      { name: 'Candle', slots: 1, tags: ['Quickdraw'], value: 1, coin: 'sc', img: 'icons/sundries/lights/candle-unlit-white.webp', light: { bright: 0, dim: 5, burnsOut: true },
        rules: [[P, 'Candle', "When you hold a candle in one hand, and it is lit, it gives off 5ft of dim light. It burns out after one hour, or with a quick rest."], ILLUMINATE] },
      { name: 'Chickenglitter Dye', slots: 1, tags: ['Quickdraw'], value: 10, img: 'icons/commodities/materials/bowl-powder-gold.webp', light: { bright: 5, dim: 5, glow: true },
        rules: [[A, 'Chickenglitter Dye', "When you apply Chickenglitter Dye, expend it. For the next hour or until a Nightly Rest, you glow 5ft Bright, 5ft Dim."]] },
      { name: 'Flint and Tinder', slots: 1, tags: ['RIS Passive'], value: 1, coin: 'sc', img: 'icons/sundries/survival/fire-lighter-brass-lit.webp', rules: [ILLUMINATE] },
      { name: 'Lantern', slots: 1, tags: ['Quickdraw'], value: 45, img: 'icons/sundries/lights/lantern-iron-yellow.webp', light: { bright: 20, dim: 40, fuel: 'lantern_oil' },
        rules: [[P, 'Lantern', "When you hold an illuminated lantern in one hand, it gives off 20ft of bright and 40ft of dim light. It burns through lantern oil at a rate of 1 supply per hour. If it would go out (either in combat, after an hour, or at the end of a rest), the lantern oil can be replenished using your other hand. You may affix one item to the lantern (a diffuser, lens, or hood)."], ILLUMINATE] },
      { name: 'Lantern Diffuser', slots: 0, value: 25, img: 'icons/consumables/potions/vial-cork-empty.webp', light: { addOn: true, bright: 0, dim: 50 }, noBargain: true,
        rules: [[`${P}, ${C}`, 'Lantern Diffuser', "You may affix the lantern diffuser (or remove it) from a lantern during a short rest. If the lantern diffuser is affixed to a lantern, it gives off 50ft of dim light, but no bright light."]] },
      { name: 'Lantern Hood', slots: 0, value: 50, img: 'icons/sundries/lights/lantern-bullseye-signal-copper.webp', light: { addOn: true, bright: 40, dim: 40, angle: 30 }, noBargain: true,
        rules: [[`${P}, ${C}`, 'Lantern Hood', "You may affix the Lantern Hood (or remove it) from a lantern during a short rest. If the lantern hood is affixed to a lantern, it gives off 40ft bright light, and 40ft dim, in a 5ft/10° cone."]] },
      { name: 'Lantern Oil (1hr Supply)', id: 'lantern_oil', slots: 1, tags: ['Small', 'Quickdraw'], value: 1, img: 'icons/consumables/potions/flask-corked-green.webp',
        rules: [[P, 'Lantern Oil', "A lantern burns through 1 supply of lantern oil per hour. (On the sheet, lighting a lantern uses one.)"]] },
      { name: 'Torch', slots: 1, tags: ['Quickdraw'], value: 2, coin: 'sc', img: 'icons/sundries/lights/torch-brown.webp', light: { bright: 10, dim: 20, burnsOut: true, litDamage: 'Fire' },
        weapon: { type: 'bludgeon', count: 1, denom: 6, defense: 'pd', damageType: 'Bludgeon', reach: 5 },
        rules: [[`${P}, ${A}`, 'Torch', "When you hold a lit torch in one hand, it gives off 10ft of bright light and 20ft of dim. In combat, you may treat this torch as a club (5ft Melee range, 1D6 Bludgeon vs. PD). If it is lit, deal Fire damage instead of Bludgeon. If you critically fail to hit a creature with a torch, it goes out. It burns out after one hour, or with a quick rest."], ILLUMINATE] },
      { name: 'Torch Holder', slots: 1, tags: ['RIS Passive'], value: 50, img: 'icons/sundries/lights/torch-black.webp',
        rules: [[P, 'Torch Holder', "When you have a Torch Holder equipped in RIS, you may place a lit Torch in a RIS slot (instead of keeping it in your hands). The torch continues to illuminate the area without requiring a hand to use."]] },
    ],
  },
  {
    key: 'mounts-vehicles', name: 'Mounts and Vehicles', page: 201, bargain: 'mounts', storage: 'sis',
    items: [
      { name: 'Light Mount (Local)', slots: 0, value: 600, img: 'icons/environment/creatures/horse-brown.webp', rules: [MOUNTS] },
      { name: 'Light Mount (Foreign)', slots: 0, value: 1200, img: 'icons/environment/creatures/horse-tan.webp', rules: [MOUNTS] },
      { name: 'Heavy Mount (Local)', slots: 0, value: 1000, img: 'icons/creatures/mammals/elk-moose-marked-green.webp', rules: [MOUNTS] },
      { name: 'Heavy Mount (Foreign)', slots: 0, value: 2000, img: 'icons/environment/creatures/horse-white.webp', rules: [MOUNTS] },
      { name: 'Saddle and Bridle', slots: 0, value: 120, img: 'icons/commodities/leather/leather-buckle-steel-tan.webp' },
      { name: 'Basic Wagon (with two Light Mounts)', slots: 0, value: 1800, img: 'icons/environment/settlement/wagon.webp', rules: [MOUNTS] },
      { name: 'Covered Wagon (with two Light Mounts)', slots: 0, value: 2200, img: 'icons/environment/settlement/wagon-black.webp',
        rules: [MOUNTS, [P, 'Covered Wagon', "You may take a nightly rest in a covered wagon provided you are in a safe area, and can let your guard down."]] },
      { name: 'Heavy Cart (with two Heavy Mounts)', slots: 0, value: 2800, img: 'icons/environment/vehicles/minecart-coal.webp', rules: [MOUNTS] },
      { name: 'Canoe', slots: 0, value: 1000, img: 'icons/tools/nautical/steering-wheel.webp' },
      { name: 'Sailboat', slots: 0, value: 1600, img: 'icons/environment/vehicles/boat-fishing-masted.webp' },
      { name: 'Heavy Ship', slots: 0, value: 3200, img: 'icons/environment/settlement/ship.webp' },
      { name: 'Feed (Per Day)', slots: 0, value: 2, img: 'icons/consumables/grains/sacks-grain-white.webp', use: true,
        rules: [[P, 'Feed', "Animals can consume 1 feed per day as a form of ration. You must carry this as part of travel supply. Feed represents cheaper-to-purchase animal rations than human food (humans cannot eat it)."]] },
      { name: 'Stabling (Per Day)', slots: 0, value: 5, img: 'icons/environment/settlement/stable.webp' },
    ],
  },
  {
    key: 'stored-baggage', name: 'Stored Baggage', page: 201, bargain: 'baggage',
    note: STORED,
    items: [
      { name: 'Backpack (Small)', slots: 0, value: 10, providesSis: 20, storageGroup: 'backpack', img: 'icons/containers/bags/pack-simple-leather-tan.webp',
        rules: [[P, 'Backpack (Small)', "Gain 20 SIS when you have this item. You may only benefit from one Backpack at a time."]] },
      { name: 'Backpack (Medium)', slots: 0, value: 100, providesSis: 40, storageGroup: 'backpack', prereq: 'Power[2]', img: 'icons/containers/bags/pack-leather-brown.webp',
        rules: [[P, 'Backpack (Medium)', "Gain 40 SIS when you have this item. You may only benefit from one Backpack at a time."]] },
      { name: 'Backpack (Large)', slots: 0, value: 500, providesSis: 60, storageGroup: 'backpack', prereq: 'Power[4]', img: 'icons/containers/bags/pack-leather-strapped-tan.webp',
        rules: [[P, 'Backpack (Large)', "Gain 60 SIS when you have this item. You may only benefit from one Backpack at a time."]] },
      { name: 'Handbag', slots: 0, value: 5, providesSis: 3, storageGroup: 'handbag', img: 'icons/containers/bags/satchel-leather-brown.webp',
        rules: [[P, 'Handbag', "Gain 3 SIS when you have this item. You may only benefit from one Handbag at a time."]] },
      { name: 'Jar (Glass)', slots: 1, storage: 'sis', value: 1, providesSis: 3, img: 'icons/consumables/potions/potion-jar-capped-teal.webp',
        rules: [[P, 'Jar (Glass)', "This item consumes 1 Stored Item Slot (SIS), but provides 3 SIS. You may only put items with the Small Property into these SIS. All items placed in the jar’s slots must be the same."]] },
      { name: 'Pot, Small (Iron)', slots: 2, storage: 'sis', value: 10, providesSis: 5, storageGroup: 'pot', img: 'icons/tools/cooking/pot-camping-iron-black.webp',
        rules: [[P, 'Pot, Small (Iron)', "This item consumes 2 Stored Item Slots (SIS), but provides 5 SIS. You may only put items with the Small Property into these SIS. All items placed in the pot’s slots must be the same. You may benefit from only one Pot at a time."]] },
      { name: 'Amphora (Bronze)', slots: 3, storage: 'sis', value: 120, providesSis: 8, storageGroup: 'amphora', img: 'icons/consumables/drinks/wine-amphora-clay-red.webp',
        rules: [[P, 'Amphora (Bronze)', "This item consumes 3 Stored Item Slots (SIS), but provides 8 SIS. You may only put items with the Small Property into these SIS. All items placed in the Amphora’s slots must be the same. You may benefit from only one Amphora at a time."]] },
      { name: 'Simple Chest (Small)', slots: 2, storage: 'sis', value: 20, providesSis: 4, storageGroup: 'box', img: 'icons/containers/chest/chest-simple-box-brown.webp',
        rules: [[P, 'Chest (Small)', `This item consumes 2 Stored Item Slots (SIS), but provides 4 SIS. You may only put items in this SIS with a max size of 1 Item Slot. Items stored in the Chest do not need to be the same. ${ONE_BOX}`]] },
      // The book's table gives the Large chest 3 Item Slots; its rule text repeats the Small chest's (2 → 4 SIS).
      { name: 'Simple Chest (Large)', slots: 3, storage: 'sis', value: 100, providesSis: 4, storageGroup: 'box', img: 'icons/containers/chest/chest-reinforced-steel-oak-tan.webp',
        rules: [[P, 'Chest (Large)', `This item consumes 2 Stored Item Slots (SIS), but provides 4 SIS. You may only put items in this SIS with a max size of 1 Item Slot. Items stored in the Chest do not need to be the same. ${ONE_BOX} <em>(As printed on p.202; the table lists 3 Item Slots.)</em>`]] },
      { name: 'Ornate Box (Small)', slots: 1, storage: 'sis', value: 50, providesSis: 2, storageGroup: 'box', img: 'icons/containers/chest/chest-small-gold-cherry.webp',
        rules: [[P, 'Ornate Box (Small)', `This item consumes 1 Stored Item Slot (SIS), but provides 2 SIS. You may only put items in this SIS with a max size of 1 Item Slot. Items stored in the Ornate Box do not need to be the same. ${ONE_BOX}`]] },
      { name: 'Ornate Box (Medium)', slots: 2, storage: 'sis', value: 250, providesSis: 4, storageGroup: 'box', img: 'icons/containers/chest/chest-simple-box-gold-brown.webp',
        rules: [[P, 'Ornate Box (Medium)', `This item consumes 2 Stored Item Slots (SIS), but provides 4 SIS. You may only put items in this SIS with a max size of 1 Item Slot. Items stored in the Ornate Box do not need to be the same. ${ONE_BOX}`]] },
      { name: 'Ornate Box (Large)', slots: 3, storage: 'sis', value: 1000, providesSis: 6, storageGroup: 'box', img: 'icons/containers/chest/chest-reinforced-steel-cherry.webp',
        rules: [[P, 'Ornate Box (Large)', `This item consumes 3 Stored Item Slots (SIS), but provides 6 SIS. You may only put items in this SIS with a max size of 1 Item Slot. Items stored in the Ornate Box do not need to be the same. ${ONE_BOX}`]] },
      { name: 'Craft Pouch (Small)', slots: 1, storage: 'sis', value: 10, providesSis: 3, storageGroup: 'box', img: 'icons/containers/bags/pouch-leather-simple-tan.webp',
        rules: [[P, 'Craft Pouch (Small)', `This item consumes 1 Stored Item Slot (SIS), but provides 3 SIS. You may only put craft ingredients in a Craft Pouch. ${ONE_BOX}`]] },
      { name: 'Craft Pouch (Medium)', slots: 2, storage: 'sis', value: 30, providesSis: 6, storageGroup: 'box', img: 'icons/containers/bags/pouch-leather-green.webp',
        rules: [[P, 'Craft Pouch (Medium)', `This item consumes 2 Stored Item Slots (SIS), but provides 6 SIS. You may only put craft ingredients in a Craft Pouch. ${ONE_BOX}`]] },
      { name: 'Craft Pouch (Large)', slots: 3, storage: 'sis', value: 100, providesSis: 9, storageGroup: 'box', img: 'icons/containers/bags/pouch-leather-gold-tan.webp',
        rules: [[P, 'Craft Pouch (Large)', `This item consumes 3 Stored Item Slots (SIS), but provides 9 SIS. You may only put craft ingredients in a Craft Pouch. ${ONE_BOX}`]] },
    ],
  },
  {
    key: 'readied-baggage', name: 'Readied Baggage', page: 202, bargain: 'baggage',
    items: [
      { name: 'Bandolier (Small)', slots: 1, value: 50, providesRis: 3, img: 'icons/equipment/waist/belt-utility-green.webp',
        rules: [READIED, [P, 'Bandolier (Small)', "This item provides 3 readied item slots (RIS). You cannot store any individual item over 1 slot in size in these slots. You cannot store weapons, shields, or baggage in these slots."]] },
      { name: 'Bandolier (Large)', slots: 2, value: 150, providesRis: 6, img: 'icons/containers/ammunition/bullets-belt.webp',
        rules: [READIED, [P, 'Bandolier (Large)', "This item provides 6 readied item slots (RIS). You cannot store any individual item over 2 slots in size in these slots. You cannot store weapons, shields, or baggage in these slots."]] },
      { name: 'Weapon Holster', slots: 1, value: 100, providesRis: 3, img: 'icons/equipment/waist/belt-buckle-square-leather-brown.webp',
        rules: [READIED, [P, 'Weapon Holster', "This item provides 3 readied item slots (RIS). You can store a single weapon in the weapon holster (even if it would not fill up every slot). You cannot put anything in these slots except for a weapon."]] },
      { name: 'Shield Holster', slots: 2, value: 100, providesRis: 3, img: 'icons/commodities/leather/leather-buckle-clip-steel.webp',
        rules: [READIED, [P, 'Shield Holster', "This item provides 3 readied item slots (RIS). You can store a single shield or buckler in the shield holster. You cannot put anything in these slots except for a shield or buckler."]] },
      { name: 'Vial (Small)', slots: 1, value: 20, providesRis: 3, img: 'icons/consumables/potions/vial-cork-empty.webp',
        rules: [READIED, [P, 'Vial (Small)', "This item provides 3 readied item slots (RIS). You may only put items with the Small Property into these RIS. All items placed in the vial’s slots must be the same."]] },
      { name: 'Vial (Large)', slots: 1, value: 60, providesRis: 6, img: 'icons/consumables/potions/vial-cork-blue.webp',
        rules: [READIED, [P, 'Vial (Large)', "This item provides 6 readied item slots (RIS). You may only put items with the Small Property into these RIS. All items placed in the vial’s slots must be the same."]] },
      { name: 'Dagger Belt', slots: 2, value: 150, providesRis: 6, img: 'icons/equipment/waist/belt-armored-studded-steel.webp',
        rules: [READIED, [P, 'Dagger Belt', "This item provides 6 readied item slots (RIS). You can only put weapons in the dagger family in these slots."]] },
      { name: 'Quiver', slots: 2, value: 100, img: 'icons/containers/ammunition/arrows-quiver-brown.webp',
        rules: [READIED, [P, 'Quiver', "You must equip a Quiver to use a Bow. Do not count arrows."]] },
    ],
  },
  {
    key: 'climbing', name: 'Climbing Tools', page: 203, bargain: 'adventuring',
    items: [
      { name: 'Grappling Hook', slots: 1, tags: ['RIS Passive'], value: 20, img: 'icons/sundries/survival/climbing-anchor-steel-grey.webp',
        rules: [[B, 'Grappling Hook', "<em>Prerequisite: Nimble Hands.</em> Provided you have a Grappling Hook equipped in your RIS, you may use the Affix Rope action to affix rope to any point within Xft, where X is the length of your rope, instead of to a spot within 5ft."]] },
      { name: 'Rope (40ft)', slots: 1, value: 5, coin: 'sc', img: 'icons/sundries/survival/rope-coiled-brown.webp',
        rules: [[A, 'Affix Rope', "With rope equipped in both hands, choose one spot within 5ft of you. You affix the rope to that point. You may also use this action to untie rope, and return it to your hands."],
          [A, 'Pull Rope', "Choose rope that is affixed to a spot within 5ft of you. You may either drape it down a rock face (making it climbable), or pull it up so that it cannot be climbed."],
          [A, 'Climb w/Rope', "You may climb up or down a rope. Move up to your move speed, but treat the distance climbed as difficult terrain. You may end your turn on a wall, but if you do, you may not use a Reaction or your arms, and you are treated as prone."]] },
    ],
  },
  {
    key: 'first-aid', name: 'First Aid', page: 203, bargain: 'adventuring',
    note: "If you have Medicine, First Aid can be an advantageous item you can use in moments of rest, or even moments of conflict. A few items (Healing Dates and Caffeine Sticks) can benefit anyone.",
    items: [
      { name: 'Bandages', slots: 1, tags: ['Small', 'Quickdraw'], value: 50, img: 'icons/tools/medical/bandage-rough.webp', use: true,
        rules: [[A, 'Bandages', "<em>Prerequisite: Medicine: Medic[1].</em> When you have Bandages equipped in both hands, choose one Dying target within 5ft. Roll a Medicine:Medic Check against that target. The target gains HP equal to your Medicine Check rolled, to a maximum of -1 HP (i.e., they do not recover from Dying from this). They then gain 1 Battle Fatigue. You may only use this once on each target per quick rest (i.e., the effect cannot stack). The bandages are then consumed."]] },
      { name: 'Caffeine Stick', slots: 1, tags: ['Small', 'Quickdraw'], value: 20, img: 'icons/consumables/grains/breadsticks-crackers-wrapped-ration-brown.webp', use: true,
        rules: [[A, 'Caffeine Stick', "Expend one Caffeine Stick from a RIS. Ignore all Battle Fatigue until the start of your next turn. Take one extra Battle Fatigue at the start of your next turn. If you have the Medicine General Talent, you may roll a general Medicine Check against your Check DC when you take this. If you roll above your Check DC, do not take one extra Battle Fatigue."]] },
      // The book prints two Healing Date texts: First Aid (p.203) and Travel Gear (p.206).
      { name: 'Date (Healing)', id: 'healing_date', slots: 1, tags: ['Small', 'Quickdraw'], value: 5, img: 'icons/consumables/fruit/berry-dates-jujube-red.webp', use: true,
        rules: [[A, 'Date (Healing)', "Expend one Healing Date from a RIS and choose one target within 5ft (you can choose yourself). Remove one level of Battle Fatigue from that target. A target may benefit from a Healing Date no more than once per quick rest."],
          [A, 'Date (Healing), p.206', "Until the start of your next turn, ignore 2 levels of Exhaustion from the Dying Condition. You may stack the effects of Healing Dates. <em>(The book prints both texts.)</em>"]] },
      { name: 'First Aid Kit (Lesser)', slots: 2, value: 50, img: 'icons/tools/medical/medkit-steel.webp', rules: [FIRST_AID_KIT, [P, 'First Aid Kit (Lesser)', "Has 1 Charge, DC14."]] },
      { name: 'First Aid Kit', slots: 2, value: 150, img: 'icons/tools/medical/medkit-white-red.webp', rules: [FIRST_AID_KIT, [P, 'First Aid Kit', "Has 2 Charges, DC17."]] },
      { name: 'First Aid Kit (Greater)', slots: 2, value: 450, img: 'icons/tools/medical/medkit-heavy.webp', rules: [FIRST_AID_KIT, [P, 'First Aid Kit (Greater)', "Has 3 Charges, DC20."]] },
      { name: 'Splint', slots: 1, value: 100, img: 'icons/tools/medical/bandages-gauze-rough.webp',
        rules: [[C, 'Splint', "<em>Prerequisite: Medicine General Talent.</em> During a Quick Rest, choose one target with Enduring Exhaustion on a specific wound (e.g., a Wounded limb, if you use the Wound Variant Dying Rules). Remove the limb exhaustion on that wound."]] },
    ],
  },
  {
    key: 'locks', name: 'Locks and Keys', page: 204, bargain: 'adventuring',
    items: [
      { name: 'Key and Lock (Simple)', slots: 1, tags: ['Small'], value: 18, img: 'icons/sundries/misc/key-steel.webp', rules: [[P, 'Key and Lock (Simple)', "A Level 1 lock: Pick Lock DC14, Break Lock DC22."], LOCKS, KEY, BREAK_LOCK] },
      { name: 'Key and Lock (Advanced)', slots: 1, tags: ['Small'], value: 100, img: 'icons/sundries/misc/key-brass.webp', rules: [[P, 'Key and Lock (Advanced)', "A Level 1 lock: Pick Lock DC19, Break Lock DC27."], LOCKS, KEY, BREAK_LOCK] },
      { name: 'Key and Lock (Master’s)', slots: 1, tags: ['Small'], value: 300, img: 'icons/sundries/misc/key-ornate-iron-black.webp', rules: [[P, 'Key and Lock (Master’s)', "A Level 1 lock: Pick Lock DC24, Break Lock DC32."], LOCKS, KEY, BREAK_LOCK] },
      { name: 'Lockpick Kit', slots: 1, value: 50, img: 'icons/tools/hand/lockpicks-steel-grey.webp', rules: [PICK_LOCK] },
      { name: 'Lockpick Kit (Master)', slots: 1, value: 500, img: 'icons/tools/hand/pry-bar-hook-steel.webp', rules: [PICK_LOCK] },
    ],
  },
  {
    key: 'navigation', name: 'Navigation Tools', page: 204, bargain: 'adventuring',
    note: "With navigation tools, you can improve your ability to navigate when you are attempting to navigate an area.",
    items: [
      { name: 'Astrolabe', slots: 1, value: 60, img: 'icons/tools/navigation/sextant-brass-brown.webp',
        rules: [[C, 'Astrolabe', "<em>Prerequisite: Survival: Navigation[2].</em> If you get lost while navigating and identify that you are lost, you may use an Astrolabe to re-roll your Navigation Check for this Travel Ledger. When you re-roll this check, you may choose to keep the original or new roll. You may do this once per journey."]] },
      { name: 'Compass', slots: 1, tags: ['Small', 'Quickdraw'], value: 20, img: 'icons/tools/navigation/compass-brass-blue-red.webp',
        rules: [[P, 'Compass', "<em>Prerequisite: Survival.</em> You always know where north is, unless there is an Arcane Font within 20 Hexes of you. If there is an Arcane Font within 20 Hexes of you, the compass points towards the Font."]] },
      { name: 'Map', slots: 1, value: 100, img: 'icons/tools/navigation/map-marked-brown.webp',
        rules: [[P, 'Map', "Gain a map of the area you are traveling, denoting hex distances between relevant locations. You may reference this map at any time if it is equipped in your RIS, or during any rest if it is in your SIS."]] },
      { name: 'Map Notes', slots: 0, value: 20, img: 'icons/tools/navigation/map-chart-tan.webp',
        rules: [[P, 'Map Notes', "<em>Prerequisite: Survival: Navigation[1].</em> When you buy a map, you may purchase Map Notes up to the level of Specialized Talent Proficiency you possess in Survival: Navigation. Each map note will add a hidden or important location to your map. Whenever you are traveling, the location will appear as visible within the regional map you travel, even if you do not have sightlines to that location."]] },
      { name: 'Orrery', slots: 2, value: 1000, img: 'icons/tools/navigation/sextant-complex-brown.webp',
        rules: [[P, 'Orrery', "<em>Prerequisite: Survival: Navigation[3].</em> Gain 1X Advantage to all Trait Checks to Navigate."]] },
    ],
  },
  {
    key: 'holy', name: 'Holy Tools', page: 205, bargain: 'adventuring',
    items: [
      { name: 'Holy Symbol', slots: 1, tags: ['Small', 'Quickdraw'], value: 6, img: 'icons/equipment/neck/amulet-carved-stone-cross.webp', rules: [HOLY_SYMBOL, PRAY] },
      { name: 'Offering (Token)', slots: 1, value: 1, img: 'icons/commodities/treasure/token-gold-cross.webp', rules: [OFFERING] },
      { name: 'Offering', slots: 1, value: 100, img: 'icons/commodities/treasure/goblet-coins-gold.webp', rules: [OFFERING] },
    ],
  },
  {
    key: 'literary', name: 'Literary Tools', page: 205, bargain: 'literary',
    items: [
      { name: 'Charcoal Stick', slots: 1, tags: ['Small'], value: 1, coin: 'sc', img: 'icons/commodities/wood/kindling-stick-grey.webp', rules: [WRITE, DRAW] },
      { name: 'Codex', slots: 1, value: 1, coin: 'sc', img: 'icons/sundries/books/book-symbol-link-brown.webp',
        rules: [[P, 'Codex', "<em>Prerequisite: Literacy: Translate[1].</em> When you purchase or acquire this Codex, choose two languages, scripts, or codes. You may translate between one and the other if you have this codex in your inventory (e.g., translating between two languages, or between one language and a secret code)."],
          [C, 'Translate', "<em>Prerequisite: Literacy: Translate[1], Codex.</em> Using a codex, you may translate a written item that you possess between the two languages of a Codex. You must be able to read one Codex language, and the written item must be in one of the Codex languages."]] },
      { name: 'Ink (Bottle - Black)', slots: 1, value: 45, img: 'icons/tools/scribal/ink-quill-red.webp', rules: [WRITE, DRAW] },
      { name: 'Paintbrush - Helkhair', slots: 1, tags: ['Small'], value: 25, img: 'icons/tools/hand/brush-paint-brown-tan.webp', rules: [DRAW] },
      { name: 'Paperweave / Sheet', slots: 1, tags: ['Small'], value: 5, img: 'icons/sundries/documents/paper-plain-white.webp', rules: [WRITE, DRAW] },
      { name: 'Scroll (Blank)', slots: 1, value: 50, img: 'icons/sundries/scrolls/scroll-rolled-plain-white.webp', rules: [WRITE, DRAW] },
      { name: 'Sealing Wax', slots: 1, tags: ['Small'], value: 1, img: 'icons/sundries/documents/envelope-sealed-red-tan.webp' },
      { name: 'Stamp', slots: 1, tags: ['Small'], value: 2, coin: 'sc', img: 'icons/sundries/documents/document-sealed-red-white.webp' },
      { name: 'Wood Slips / Slip', slots: 1, tags: ['Small'], value: 1, coin: 'sc', img: 'icons/commodities/wood/lumber-plank-beige.webp', rules: [WRITE, DRAW] },
    ],
  },
  {
    key: 'travel', name: 'Travel Gear', page: 206, bargain: 'travel',
    note: "Travel Gear are the items you use to adventure on the open road.",
    items: [
      { name: 'Bedroll', slots: 1, value: 8, img: 'icons/sundries/survival/bedroll-brown.webp', rules: [NIGHTLY] },
      { name: 'Blanket', slots: 1, value: 12, img: 'icons/sundries/survival/bedroll-worn-blue.webp', rules: [NIGHTLY] },
      { name: 'Flag - Nation', slots: 1, value: 50, img: 'icons/sundries/flags/banner-standard-brown.webp' },
      { name: 'Gaming Set', slots: 1, value: 25, img: 'icons/sundries/gaming/gaming-set-dice.webp' },
      { name: 'Hammer', slots: 1, value: 2, img: 'icons/tools/hand/hammer-simple-wood.webp' },
      { name: 'Rations / Day', id: 'rations', slots: 1, tags: ['Small'], value: 1, img: 'icons/consumables/food/berries-ration-round-red.webp', use: true,
        rules: [[P, 'Travel', "When you travel, you consume 1 Ration per Day per character. Typically, this is tracked through the travel rules, and you shouldn’t often need to worry about purchasing rations at such a granular level."]] },
      { name: 'Shovel', slots: 1, value: 2, img: 'icons/tools/hand/shovel-spade-steel-brown-grey.webp' },
      { name: 'Soap', slots: 1, tags: ['Small', 'Quickdraw'], value: 1, coin: 'sc', img: 'icons/sundries/survival/soap.webp' },
      { name: 'Tent, 2-person', slots: 2, value: 18, img: 'icons/sundries/survival/shelter-tent-small.webp', rules: [NIGHTLY] },
      { name: 'Wooden Stakes', slots: 1, tags: ['Small'], value: 1, coin: 'sc', img: 'icons/sundries/survival/stake-rough-simple-brown.webp' },
    ],
  },
  {
    key: 'kits', name: 'Weapon & Armor Kits', page: 206, bargain: 'adventuring',
    note: "Weapon and Armor Kits are used by Smiths and Tailors to enhance or take care of armor. A well cared for set of armor or weapons can make all the difference in battle.",
    items: [
      { name: 'Armor Oil', slots: 1, value: 200, img: 'icons/consumables/potions/flask-corked-blue.webp', use: true,
        rules: [[C, 'Armor Oil', "<em>Prerequisite: Smithing: Armor[3].</em> Choose one set of Iron Armor during a quick rest. Expend your Armor Oil. Add +1 PD to that armor until the next rest."]] },
      { name: 'Leather Oil', slots: 1, value: 200, img: 'icons/consumables/potions/bottle-round-corked-pink.webp', use: true,
        rules: [[C, 'Leather Oil', "<em>Prerequisite: Tailoring: Leatherwork[3].</em> Choose one set of Leather Armor during a quick rest. Expend your Leather Oil. Add +1 TD to that armor until the next rest."]] },
      { name: 'Patch Kit', slots: 1, value: 200, img: 'icons/commodities/cloth/thread-and-needle.webp', use: true,
        rules: [[C, 'Patch Kit', "<em>Prerequisite: Tailoring: Clothier[3].</em> Choose one set of Cloth Armor during a quick rest. Expend your Patch Kit. Add +1 MD to that armor until the next rest."]] },
      { name: 'Repair Kit (Lesser)', slots: 2, value: 25, img: 'icons/tools/smithing/hammer-sledge-steel-grey.webp', rules: [REPAIR_KIT, [P, 'Repair Kit (Lesser)', "Has 1 Charge."]] },
      { name: 'Repair Kit', slots: 2, value: 100, img: 'icons/tools/smithing/anvil.webp', rules: [REPAIR_KIT, [P, 'Repair Kit', "Has 2 Charges."]] },
      { name: 'Repair Kit (Greater)', slots: 2, value: 300, img: 'icons/tools/smithing/tongs-steel-grey.webp', rules: [REPAIR_KIT, [P, 'Repair Kit (Greater)', "Has 3 Charges."]] },
      { name: 'Ron’s Weapon Oil', slots: 1, value: 500, img: 'icons/consumables/potions/bottle-conical-corked-purple.webp', use: true,
        rules: [[C, 'Ron’s Weapon Oil', "<em>Prerequisite: Smithing: Weapons[3].</em> Choose one nonmagical weapon. Expend Ron’s Weapon Oil. That weapon gains +1 to Hit until the next rest. If you use this on a weapon that expends munitions (e.g., arrows, bolts, or thrown weapons), it only works on a single munition."]] },
      { name: 'Whetstone', slots: 1, value: 200, img: 'icons/commodities/stone/stone-chunk-grey-white.webp',
        rules: [[C, 'Whetstone', "<em>Prerequisite: Smithing: Weapons[3].</em> Every quick rest, choose one slashing weapon. The next time that weapon deals damage, increase the dice type by one dice type. The effects of Whetstone cannot stack, and only works on the next successful hit of that weapon."]] },
    ],
  },
];

/* -------------------------------------------- */
/*  Trinkets (pp.207–209)                        */
/* -------------------------------------------- */

/** The jewelry and the condition each guards against (the Jewelry Boons table, p.208), as condition keys. */
const JEWELRY = [
  ['Amber Jewelry', 'Courage[2]', 50, 'nausea', 'Nausea', 'icons/equipment/neck/pendant-rough-orange.webp'],
  ['Red Jasper Jewelry', 'Courage[2]', 100, 'hemorrhage', 'Hemorrhage', 'icons/equipment/neck/pendant-faceted-red.webp'],
  ['Citrine Jewelry', 'Wiles[2]', 100, 'delirium', 'Delirium', 'icons/equipment/finger/ring-cabochon-gold-orange.webp'],
  ['Moonstone Jewelry', 'Wiles[2]', 100, 'frenzy', 'Frenzy', 'icons/equipment/neck/necklace-astrology-moon-blue.webp'],
  ['Quartz Jewelry', 'Courage[2]', 200, 'pinned', 'Pin', 'icons/equipment/finger/ring-faceted-white.webp'],
  ['Amethyst Jewelry', 'Courage[2]', 200, 'fatigue', 'Fatigue', 'icons/equipment/neck/pendant-faceted-purple.webp'],
  ['Agate Jewelry', 'Wiles[2]', 200, 'taunt', 'Taunt', 'icons/equipment/neck/amulet-round-brown.webp'],
  ['Turquoise Jewelry', 'Wiles[2]', 200, 'panic', 'Panic', 'icons/equipment/neck/amulet-simple-rough-teal.webp'],
  ['Carnelian Jewelry', 'Courage[2]', 200, 'paralysis', 'Paralyzed', 'icons/equipment/finger/ring-cabochon-copper-red.webp'],
  ['Silver Jewelry', 'Courage[2]', 200, 'pulled', 'Dragged', 'icons/equipment/neck/choker-chain-thick-silver.webp'],
  ['Onyx Jewelry', 'Courage[2]', 200, 'debilitated', 'Debilitated', 'icons/equipment/finger/ring-band-skull-purple.webp'],
  ['Emerald Jewelry', 'Courage[2]', 300, 'corroded', 'Corroded', 'icons/equipment/neck/pendant-gold-emerald.webp'],
  ['Gold Jewelry', 'Wiles[2]', 200, 'jinxed', 'Jinxed', 'icons/equipment/neck/choker-chain-thick-gold.webp'],
  ['Pearl Jewelry', 'Wiles[2]', 200, 'slowed', 'Slowed', 'icons/equipment/neck/collar-rounded-pearl.webp'],
];

/**
 * Runes (p.209): `fixed` changes, then the choices made when you buy one — `minus` and `plus`, each `n` picks of `by`
 * from `from` (`distinct`: the picks must differ). The chosen keys live on the owned item (flags.sacadia.runeChoice).
 */
const DEF4 = ['pd', 'td', 'md', 'dr'];
const DEF5 = ['ad', 'pd', 'td', 'md', 'dr'];
const RUNES = [
  ['Lunar Eclipse Rune', 'Prof[3]', 150, { minus: { n: 1, by: 2, from: DEF4 }, plus: { n: 1, by: 2, from: DEF4 } },
    "Choose one of the following effects when you buy this rune: -2 to PD/TD/MD/DR. Then choose one of the following effects when you buy this rune: +2 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-star-pentagon-blue.webp'],
  ['Moon Rune', 'Prof[3]', 200, { fixed: { ad: -2 }, plus: { n: 1, by: 3, from: DEF4 } },
    "-2AD. Then choose one of the following effects when you buy this rune: +3 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-triangle-blue.webp'],
  ['Moon Rune (Greater)', 'Prof[5]', 800, { fixed: { ad: -3 }, plus: { n: 1, by: 5, from: DEF4 } },
    "-3AD. Then choose one of the following effects when you buy this rune: +5 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-star-blue.webp'],
  ['Rising Dawn Rune', 'Prof[5]', 600, { minus: { n: 2, by: 2, from: DEF4 }, plus: { n: 2, by: 2, from: DEF4 } },
    "Choose two of the following effects when you buy this rune: -2 to PD/TD/MD/DR. Then choose two of the following effects when you buy this rune: +2 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-star-orange.webp'],
  ['Shifting Sands Rune', '', 150, { minus: { n: 1, by: 2, from: DEF4 }, fixed: { ad: 1 } },
    "Choose one of the following effects when you buy this rune: -2 to PD/TD/MD/DR. +1 AD.", 'icons/magic/symbols/runes-triangle-orange.webp'],
  ['Solar Rune (Lesser)', '', 20, { minus: { n: 1, by: 1, from: DEF5 }, plus: { n: 1, by: 1, from: DEF4 } },
    "Choose one of the following effects when you buy this rune: -1 to AD/PD/TD/MD/DR. Then choose one of the following effects when you buy this rune: +1 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-star-orange-purple.webp'],
  // As printed: two −1s and one +1 ("Your selections must differ" reads as if two +1s were meant).
  ['Solar Rune', 'Prof[3]', 100, { minus: { n: 2, by: 1, from: DEF5 }, plus: { n: 1, by: 1, from: DEF4, distinct: true } },
    "Choose two of the following effects when you buy this rune: -1 to AD/PD/TD/MD/DR. Your selections can be the same. Then choose one of the following effects when you buy this rune: +1 to PD/TD/MD/DR. Your selections must differ.", 'icons/magic/symbols/runes-triangle-orange-purple.webp'],
  ['Solar Rune (Greater)', 'Prof[5]', 400, { minus: { n: 3, by: 1, from: DEF5 }, plus: { n: 3, by: 1, from: DEF4, distinct: true } },
    "Choose three of the following effects when you buy this rune: -1 to AD/PD/TD/MD/DR. Your selections can be the same. Then choose three of the following effects when you buy this rune: +1 to PD/TD/MD/DR. Your selections must all differ.", 'icons/magic/symbols/runes-star-pentagon-orange-purple.webp'],
  ['Solar Eclipse Rune', 'Prof[5]', 400, { minus: { n: 1, by: 3, from: DEF4 }, plus: { n: 1, by: 3, from: DEF4 } },
    "Choose one of the following effects when you buy this rune: -3 to PD/TD/MD/DR. Then choose one of the following effects when you buy this rune: +3 to PD/TD/MD/DR.", 'icons/magic/symbols/runes-star-pentagon-orange.webp'],
];

export const TRINKET_GOODS = [
  {
    key: 'baubles', name: 'Baubles', page: 207, bargain: 'miscellany',
    note: "Trinkets are small items that can help in different ways. Most trinkets have either an action that can be used, or are RIS Passive (have a use in combat).",
    items: [
      { name: 'Bag of Flour', slots: 1, value: 1, img: 'icons/consumables/grains/sack-rice-flour-brown.webp', use: true,
        rules: [[A, 'Bag of Flour', "With a bag of flour equipped in 1 hand, choose a 10x10ft square in front of you. All invisible (but material) creatures in that 10x10ft square are revealed to you. They cannot remove the flour until a quick rest. Expend your Bag of Flour when you use this."]] },
      { name: 'Brass Horn', slots: 1, value: 10, img: 'icons/tools/instruments/horn-flared-wood.webp',
        rules: [[P, 'Brass Horn', "When you are not ambushed, you may choose to start combat with the Brass Horn equipped in both hands. If you do, gain 1X Advantage to your Initiative roll. <em>(On the sheet: equip it before rolling Initiative.)</em>"]] },
      { name: 'Charcoal', slots: 1, tags: ['Small', 'Quickdraw'], value: 1, coin: 'sc', img: 'icons/commodities/stone/ore-chunk-black.webp', use: true,
        rules: [[A, 'Charcoal', "Consume 1 charcoal. Gain 1X Advantage to ‘Make Trait Check’ to reduce levels of Hemorrhage caused by poisons until the end of your turn."]] },
      { name: 'Feather Necklace', slots: 1, tags: ['Worn', 'RIS Passive'], value: 10, img: 'icons/equipment/neck/necklace-simple-feather-red-brown.webp',
        rules: [[P, 'Feather Necklace', "When you are wearing a Feather Necklace, treat all fall distances as 10ft shorter."]] },
      { name: 'Informative Scroll', slots: 1, tags: ['RIS Passive'], value: 100, img: 'icons/sundries/scrolls/scroll-writing-tan.webp',
        rules: [[P, 'Informative Scroll', "When you purchase an Informative Scroll, choose one Knowledge Talent you possess. Provided this scroll is equipped in a RIS slot, you gain +1 to all Knowledge Talents made with this Talent. The effects of Informative Scrolls do not stack. <em>(On the sheet: name it after the Talent, e.g. “Informative Scroll (History)”.)</em>"]] },
      { name: 'Ivory Charm', slots: 1, tags: ['Small', 'RIS Passive'], value: 60, img: 'icons/commodities/bones/bone-fragments-grey.webp',
        rules: [[R, 'Ivory Charm', "As a reaction when you are Steadied and have an Ivory Charm in your RIS, you may roll 1D20. The first time on your next turn that you would roll a D20, do not roll 1D20; use this roll instead."]] },
      { name: 'Lodestone', slots: 1, tags: ['RIS Passive'], value: 20, img: 'icons/commodities/stone/ore-chunk-iron-black.webp',
        rules: [[P, 'Lodestone', "When you have a Lodestone in RIS, if you attempt to kick or grab a target who is wearing Iron Armor, they gain 1X Disadvantage."]] },
      { name: 'Rabbit’s Paw', id: 'rabbit_s_paw', slots: 1, tags: ['RIS Passive'], value: 100, prereq: 'Fate[3], wearing Medium Armor', img: 'icons/commodities/treasure/figurine-rabbit.webp',
        rules: [[P, 'Rabbit’s Paw', "When you have a Rabbit’s Paw equipped in a RIS, increase your Dodge’s Dice Type by one dice type."]] },
      { name: 'Saltstone', slots: 2, tags: ['RIS Passive'], value: 800, img: 'icons/commodities/stone/stone-white-quartz-ball.webp',
        rules: [[P, 'Saltstone', "When you have a Saltstone equipped in your RIS, gain +1 to your Check DC."]] },
      { name: 'Signet Ring', slots: 1, tags: ['Worn', 'RIS Passive'], value: 50, img: 'icons/equipment/finger/ring-cabochon-signet-gold-red.webp',
        rules: [[C, 'Signet Ring', "When you are wearing a Signet Ring and write any document, you may seal it. If you seal the written document, anyone who receives it will know if it has been opened or tampered with, as well as that the letter comes from the owner of the signet ring."]] },
      { name: 'Smudge (Lavender)', slots: 1, tags: ['Quickdraw'], value: 50, img: 'icons/consumables/plants/leaf-pink.webp',
        rules: [[A, 'Smudge (Lavender)', "When you hold a lit smudge in both hands, it gives off a strong but pleasant scented smoke. Ranged attacks have 1X Disadvantage against you. The Smudge goes out after 1 minute, with a quick rest, or when you stop holding it in both hands. Expend the Smudge when you use it. <em>(On the sheet: equip it while it burns.)</em>"]] },
      { name: 'Smudge (Sage)', slots: 1, tags: ['Quickdraw'], value: 100, img: 'icons/consumables/plants/basil-herb-green.webp',
        rules: [[A, 'Smudge (Sage)', "When you hold a lit smudge in both hands, it gives off a strong but pleasant scented smoke. Melee attacks have 1X Disadvantage against you. The Smudge goes out after 1 minute, with a quick rest, or when you stop holding it in both hands. Expend the Smudge when you use it. <em>(On the sheet: equip it while it burns.)</em>"]] },
      { name: 'Tinted Goggles', slots: 1, tags: ['Worn', 'RIS Passive'], value: 60, img: 'icons/equipment/head/goggles-leather-tan.webp',
        rules: [[P, 'Tinted Goggles', "If you wear Tinted Goggles, you are unaffected by Bright Light."]] },
      { name: 'Woad Facepaint', slots: 1, tags: ['Small', 'Worn', 'RIS Passive'], value: 10, img: 'icons/commodities/materials/bowl-powder-blue.webp',
        rules: [[P, 'Woad Facepaint', "If you equip Woad Facepaint in your RIS, gain 1X Advantage to Initiative. After you roll 1X Advantage to Initiative, expend the Woad Facepaint."]] },
    ],
  },
  {
    key: 'jewelry', name: 'Jewelry', page: 208, bargain: 'armor-trinkets',
    items: JEWELRY.map(([name, prereq, value, jewelry, label, img]) => ({
      name, prereq, value, jewelry, img, slots: 1, tags: ['Worn', 'RIS Passive'], props: ['Jewelry'],
      rules: [[P, `${name}: ${label}`, `The condition X for this jewelry is ${label}.`]],
    })),
  },
  {
    key: 'runes', name: 'Runes', page: 209, bargain: 'armor-trinkets',
    items: RUNES.map(([name, prereq, value, rune, text, img]) => ({
      name, prereq, value, rune, img, slots: 1, tags: ['RIS Passive', 'Worn', 'Rune'], props: ['Rune'],
      rules: [[P, name, `${text} <em>(Make the choices on the item sheet; equip the rune to activate it.)</em>`]],
    })),
  },
];

/* -------------------------------------------- */
/*  Home Goods (pp.211–212)                      */
/* -------------------------------------------- */

const home = (rows, extra = {}) => rows.map(([name, value, img, more = {}]) => ({ name, value, img, slots: 0, ...extra, ...more }));
const SC = { coin: 'sc' };
const KITCHEN = { bargain: 'cooking' };

export const HOME_GOODS = [
  {
    key: 'property', name: 'Property', page: 211, bargain: 'homes', storage: 'sis',
    note: "Where homes and businesses may be purchased, these prices are a baseline. The value of homes may fluctuate for other reasons, such as the location of the area; market values may also indicate the economic prosperity of a region.",
    items: home([
      ['Apartment Monthly Rent (Poor)', 50, 'icons/environment/settlement/house-shelter-stone.webp'],
      ['Apartment Monthly Rent (Average)', 250, 'icons/environment/settlement/house-two-stories-small.webp'],
      ['Apartment Monthly Rent (Wealthy)', 1000, 'icons/environment/settlement/house-two-stories.webp'],
      ['Home Purchase (Poor)', 5000, 'icons/environment/settlement/hut.webp'],
      ['Home Purchase (Average)', 20000, 'icons/environment/settlement/house-city.webp'],
      ['Home Purchase (Wealthy)', 100000, 'icons/environment/settlement/house-manor.webp'],
      ['Land Purchase / Acre', 10000, 'icons/environment/settlement/house-farmland.webp'],
      ['Market Stall Rent (Poor)', 300, 'icons/environment/settlement/wood-stall.webp'],
      ['Market Stall Rent (Average)', 600, 'icons/environment/settlement/market-stall.webp'],
      ['Market Stall Rent (Wealthy)', 1500, 'icons/environment/settlement/tent-flag.webp'],
      ['Business Building Rent (Small)', 800, 'icons/environment/settlement/pottery-shop-shed-red.webp'],
      ['Business Building Rent (Large)', 2600, 'icons/environment/settlement/warehouse-crates.webp'],
    ]),
  },
  {
    key: 'trade-goods', name: 'Trade Goods', page: 212, bargain: 'trade-goods', storage: 'sis',
    note: "Trade Goods often vary wildly in value depending upon region; these prices are the average global value in Sacadia. Whole campaigns may be formed (especially in Trade games) around market manipulations of the values of these goods, which are common in Sacadia’s early economy.",
    items: home([
      ['Ale/Beer (Barrel)', 10, 'icons/containers/barrels/barrel-oak-tan.webp'],
      ['Chalk', 1, 'icons/commodities/stone/stone-chunk-tan.webp', SC],
      ['Cream - Heavy (Bottle)', 5, 'icons/consumables/drinks/drink-carton.webp', SC],
      ['Dyes (Common)', 4, 'icons/commodities/materials/bowl-liquid-red.webp'],
      ['Dyes (Uncommon)', 20, 'icons/skills/trades/textiles-cloth-dye-red.webp'],
      ['Fabric - Hemp (Roll)', 10, 'icons/commodities/cloth/cloth-roll-tan.webp'],
      ['Fabric - Wool (Roll)', 40, 'icons/commodities/cloth/cloth-roll-worn-tan.webp'],
      ['Fabric - Silk (Roll)', 200, 'icons/commodities/cloth/cloth-bolt-gold-red.webp'],
      ['Fishing Bait', 5, 'icons/tools/fishing/hook-simple-steel-grey.webp', SC],
      ['Fishing Rod', 10, 'icons/tools/fishing/rod-simple-stick-brown.webp'],
      ['Flour (Sack)', 1, 'icons/consumables/grains/sack-grain-open-white.webp'],
      ['Fruit in Honey (Jar)', 5, 'icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp'],
      ['Fruits and Vegetables (Common)', 1, 'icons/consumables/fruit/apple-red-tree-green.webp', SC],
      ['Fruits and Vegetables (Uncommon)', 1, 'icons/consumables/fruit/dragonfruit-cut-red-white.webp'],
      ['Garum (Bottle)', 1, 'icons/consumables/potions/bottle-pear-corked-pink.webp'],
      ['Honey (Jug)', 40, 'icons/consumables/food/honey-beehive-brown.webp'],
      ['Incense', 1, 'icons/commodities/tech/smoke-spout-blue.webp'],
      ['Ivory (1lb)', 50, 'icons/commodities/bones/skull-tusked-grey.webp'],
      ['Jam - Common (Jug)', 1, 'icons/containers/kitchenware/jug-clay-brown.webp', SC],
      ['Jam - Uncommon (Jug)', 1, 'icons/containers/kitchenware/jug-terracotta-orange.webp'],
      ['Livestock - Small (cost/head)', 1, 'icons/creatures/birds/chicken-hen-white.webp'],
      ['Livestock - Large (cost/head)', 100, 'icons/creatures/mammals/livestock-cow-green.webp'],
      ['Livestock - Exotic (cost/head)', 500, 'icons/creatures/mammals/goat-horned-blue.webp'],
      ['Meats - Salted (lb)', 1, 'icons/consumables/meat/hock-leg-pink-brown.webp'],
      ['Meats - Smoked (lb)', 5, 'icons/consumables/meat/hock-leg-skin-brown.webp'],
      ['Net', 20, 'icons/tools/fishing/net-simple-brown.webp'],
      ['Oil, Cooking (Jug)', 5, 'icons/containers/kitchenware/jug-wrapped-red.webp', SC],
      ['Oil, Olive (Jug)', 40, 'icons/containers/kitchenware/jug-bottle-clay-brown-gold-blue.webp'],
      ['Salt - Common (Pouch)', 1, 'icons/containers/bags/pouch-cloth-tan.webp', SC],
      ['Salt - Uncommon (Pouch)', 5, 'icons/consumables/food/salt-seasoning-spice-pink.webp'],
      ['Spices - Common (Pouch)', 1, 'icons/consumables/food/spice-anise-pod.webp'],
      ['Spices - Uncommon (Pouch)', 20, 'icons/containers/bags/pouch-leather-spiral-red-brown.webp'],
      ['Suet, Lard, or Butter (Jug)', 5, 'icons/containers/kitchenware/jug-clay-brown-sealed.webp', SC],
      ['Wine (Jug)', 8, 'icons/consumables/drinks/wine-amphora-clay-pink.webp'],
    ]),
  },
  {
    key: 'furnishings', name: 'Furnishings', page: 212, storage: 'sis',
    note: "In order to furnish a home or business, you need to buy furniture, cooking supplies, and other supplies; these prices give a sense of their costs.",
    items: home([
      ['Altar, Personal', 300, 'icons/environment/wilderness/altar-hidden.webp'],
      ['Amphora, Clay', 10, 'icons/consumables/drinks/wine-amphora-clay-gray.webp'],
      ['Bed (Small)', 100, 'icons/sundries/survival/bedroll-tan.webp'],
      ['Bed (Large)', 500, 'icons/sundries/survival/bedroll-blue-red.webp'],
      ['Blanket', 5, 'icons/sundries/survival/bedroll-worn-tan.webp'],
      ['Bowl (Clay, Personal)', 1, 'icons/containers/kitchenware/bowl-clay-brown.webp', KITCHEN],
      ['Bowl (Clay, Serving)', 5, 'icons/consumables/food/bowl-stew-brown.webp', KITCHEN],
      ['Brazier', 80, 'icons/tools/smithing/furnace-fire-metal-orange.webp', KITCHEN],
      ['Bucket', 1, 'icons/containers/misc/bucket-wooden-brown.webp', KITCHEN],
      ['Cabinet', 200, 'icons/containers/chest/chest-worn-oak-tan.webp'],
      ['Candle', 1, 'icons/sundries/lights/candle-unlit-tan.webp', SC],
      ['Candle Holder (Bronze)', 40, 'icons/sundries/lights/candle-pillar-lit-yellow.webp'],
      ['Chair (Simple)', 50, 'icons/commodities/wood/furniture-stool-brown.webp'],
      ['Chair (Wealthy)', 400, 'icons/commodities/wood/framing-reinforced-brown.webp'],
      ['Chest (Small)', 100, 'icons/containers/chest/chest-simple-walnut.webp'],
      ['Chest (Large)', 300, 'icons/containers/chest/chest-reinforced-steel-walnut-brown.webp'],
      ['Cup (Clay)', 25, 'icons/containers/kitchenware/goblet-simple-clay-white.webp', { ...SC, ...KITCHEN }],
      ['Cushion', 80, 'icons/commodities/cloth/cloth-patterned-teal.webp'],
      ['Footstool', 10, 'icons/commodities/wood/furniture-stool-brown.webp'],
      ['Fountain', 400, 'icons/commodities/stone/masonry-block-cube-white.webp'],
      ['Glassware (Bottle)', 5, 'icons/consumables/drinks/alcohol-jar-spirits-gray.webp', KITCHEN],
      ['Instrument (Percussion)', 300, 'icons/tools/instruments/drum-hand-tan.webp'],
      ['Instrument (String)', 300, 'icons/tools/instruments/lute-gold-brown.webp'],
      ['Instrument (Woodwind)', 300, 'icons/tools/instruments/flute-simple-wood.webp'],
      ['Mirror (Hand)', 80, 'icons/sundries/survival/mirror-plain.webp'],
      ['Painting (Wall) / 5ft x 5ft Square', 160, 'icons/tools/hand/paint-palette.webp'],
      ['Pillow (Decorative)', 20, 'icons/commodities/cloth/cloth-patterned-pink.webp'],
      ['Pond (Small)', 1200, 'icons/commodities/materials/liquid-droplet-blue.webp'],
      ['Pond, Koi (Large)', 3000, 'icons/environment/creatures/fish-crosshatched-blue-purple.webp'],
      ['Pot (Bronze)', 30, 'icons/containers/kitchenware/vase-clay-brown.webp', KITCHEN],
      ['Pot (Iron)', 100, 'icons/containers/kitchenware/pot-meal.webp', KITCHEN],
      ['Pot (Decorative)', 240, 'icons/containers/kitchenware/vase-clay-painted-blue-gold.webp'],
      ['Tableware Set (Personal)', 1, 'icons/tools/cooking/fork-steel-brown.webp', KITCHEN],
      ['Tree, Sapling (Decorative)', 30, 'icons/commodities/materials/plant-sprout-seed-green.webp'],
      ['Tree, Sapling (Fruit)', 60, 'icons/commodities/materials/plant-pot-flower.webp'],
      ['Sofa (Simple)', 100, 'icons/commodities/wood/lumber-plank-brown.webp'],
      ['Sofa (Wealthy)', 800, 'icons/commodities/cloth/cloth-bolt-gold-pink.webp'],
      ['Sundial', 400, 'icons/commodities/treasure/plaque-stone-hammer.webp'],
      ['Statue (Small)', 200, 'icons/commodities/treasure/figurine-goddess.webp'],
      ['Statue (Large)', 1000, 'icons/commodities/treasure/statue-gold-laurel-wreath.webp'],
      ['Table (Small)', 200, 'icons/commodities/wood/blocks-cut-brown.webp'],
      ['Table (Large)', 400, 'icons/commodities/wood/lumber-stack-brown.webp'],
      ['Tripod', 20, 'icons/tools/cooking/soup-ladle.webp', KITCHEN],
      ['Water Clock', 1000, 'icons/tools/navigation/hourglass.webp'],
    ]),
  },
];
