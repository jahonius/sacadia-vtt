/**
 * Downtime: money and Long Rest Actions (rulebook v1.2 printed pp.235, 263–266). Pure rules, unit-tested; the Long Rest
 * window (apps/long-rest.mjs) and its resolution (rules/downtime.mjs) use them.
 *
 * Money is gold coins (gc; the book's "gp" is the same coin) and silver coins (sc). The book never says how many silver
 * make a gold; a world setting holds it (default 100: a day's supply is 25sc, and at 10 a week's food would cost more than
 * a week's lowest wage). Item values are in gc.
 */

/** Odd job pay a Long Rest Action, by Proficiency (p.265). Past 6, as 6. */
export const ODD_JOBS = [0, 10, 20, 60, 100, 200, 250];
export const oddJobPay = (proficiency) => ODD_JOBS[Math.max(0, Math.min(6, Math.floor(proficiency ?? 0)))];

/** Each profession's starting gold (pp.20–22). The Hulinari Warrior and the prestige professions list none. */
export const STARTING_GOLD = { bladedancer: 20, fatebound: 10, oracle: 25, sentinel: 10, soldier: 5, thug: 30 };

/**
 * The Long Rest Actions (pp.263–266), with their limits in one Long Rest:
 * - `max`: actions of this kind that count (Acquire Influence and Investigate a Lead 2; Harvest your Proficiency).
 * - `pooled`: every week given to it is one roll (Make an Offering: "1 level of Advantage for each Long Rest action").
 * - `untilSuccess`: once it succeeds, more of it does nothing (Pray for Guidance).
 */
export const LONG_REST_ACTIONS = {
  earn: { label: 'SACADIA.Downtime.Action.Earn', page: 265 },
  influence: { label: 'SACADIA.Downtime.Action.Influence', page: 264, max: 2 },
  offering: { label: 'SACADIA.Downtime.Action.Offering', page: 265, pooled: true },
  pray: { label: 'SACADIA.Downtime.Action.Pray', page: 265, untilSuccess: true },
  lead: { label: 'SACADIA.Downtime.Action.Lead', page: 265, max: 2 },
  harvest: { label: 'SACADIA.Downtime.Action.Harvest', page: 265, max: 'proficiency' },
  craft: { label: 'SACADIA.Downtime.Action.Craft', page: 264 },
  shop: { label: 'SACADIA.Downtime.Action.Shop', page: 266 },
  train: { label: 'SACADIA.Downtime.Action.Train', page: 266 },
  other: { label: 'SACADIA.Downtime.Action.Other', page: 264 },
};

/**
 * Which of the planned weeks count, by the limits above: `[{week, kind, counts, reason}]`. A week past a limit doesn't
 * count (`reason`: 'max'); Make an Offering's weeks after the first are folded into its roll (`reason`: 'pooled').
 * Pray for Guidance can't be judged until it's rolled.
 * @param {Array<{kind: string}>} weeks
 * @param {{proficiency: number}} ctx
 */
export function weekLimits(weeks, { proficiency = 0 } = {}) {
  const seen = {};
  return weeks.map((w, i) => {
    const def = LONG_REST_ACTIONS[w.kind];
    seen[w.kind] = (seen[w.kind] ?? 0) + 1;
    const max = def?.max === 'proficiency' ? proficiency : def?.max;
    if (max !== undefined && seen[w.kind] > max) return { week: i + 1, kind: w.kind, counts: false, reason: 'max' };
    if (def?.pooled && seen[w.kind] > 1) return { week: i + 1, kind: w.kind, counts: true, reason: 'pooled' };
    return { week: i + 1, kind: w.kind, counts: true, reason: '' };
  });
}

/**
 * Make an Offering (p.265): 1D20 with a level of Advantage for each level of the character's Religion specialization in
 * their own religion, each 100gc offered, and each Long Rest action given to it. A natural 20 (or 30, if anything adds to
 * the roll) gains a Lore point, once a Long Rest.
 */
export const offeringAdvantage = ({ religionRank = 0, gold = 0, weeks = 1 }) =>
  Math.max(0, Math.floor(religionRank)) + Math.max(0, Math.floor((gold ?? 0) / 100)) + Math.max(1, weeks);
export const offeringSucceeds = (natural, total) => natural === 20 || total >= 30;

/** Pray for Guidance (p.265): a Religion Check of 20 or more is answered. */
export const PRAYER_DC = 20;

/**
 * Shop for Bargains (p.266): the Bargain Type table (a d20: the kind of goods, and the die that picks which of them) and the
 * Bargain Value table (an Economy: Bargaining Check: the deal, and how many items are on it).
 */
/**
 * The Bargain Type table (p.266): its printed die, and the compendium table its items are rolled from (`flags.sacadia.bargain`,
 * src/build-goods.mjs). The printed table cites an older edition's tables; most match v1.2's row for row (Travel Gear d10,
 * Literary d9, Mounts d13 …). Cooking Supplies are the kitchen furnishings, Adventuring Gear the tools, Miscellany the
 * baubles, Baggage the stored and readied baggage, Armor Trinkets the jewelry and runes. Magic Items are the GM's.
 */
export const BARGAIN_TYPES = [
  ['Clothes', 13, 'clothes'], ['Cooking Supplies', 10, 'cooking'], ['Adventuring Gear', 4, 'adventuring'], ['Miscellany', 7, 'miscellany'],
  ['Illumination', 7, 'illumination'], ['Baggage', 7, 'baggage'], ['Travel Gear', 10, 'travel'], ['Literary Supplies', 9, 'literary'],
  ['Mounts and Vehicles', 13, 'mounts'], ['Crafting Kits', 4, 'crafting-kits'], ['Homes and Businesses', 12, 'homes'], ['Trade Goods', 33, 'trade-goods'],
  ['Basic Armor Kits', 5, 'armor'], ['Armor Adornments', 4, 'adornments'], ['Armor Trinkets', 6, 'armor-trinkets'], ['Shields and Bucklers', 12, 'shields'],
  ['Basic Weapons', 10, 'basic-weapons'], ['Military Weapons', 10, 'military-weapons'], ['Imbued Weapons', 8, 'imbued-weapons'], ['Magic Items', 0, null],
].map(([name, die, table]) => ({ name, die, table }));
export const BARGAIN_VALUE = [
  { min: 1, deal: 5, items: 1 }, { min: 6, deal: 10, items: 1 }, { min: 11, deal: 15, items: 2 }, { min: 16, deal: 20, items: 2 },
  { min: 21, deal: 25, items: 3 }, { min: 26, deal: 30, items: 3 }, { min: 31, deal: 50, items: 4 },
];
/** The Bargain Value row for a Bargaining Check (31+ or a natural 20 is the best). */
export function bargainValue(total, natural = 0) {
  if (natural === 20) return BARGAIN_VALUE.at(-1);
  return [...BARGAIN_VALUE].reverse().find((r) => total >= r.min) ?? BARGAIN_VALUE[0];
}

/**
 * What an inherited business earns for the Earn Money action instead of an odd job (`flags.sacadia.business`), in gc:
 * a flat amount, a formula in `@proficiency`, or by the item's rarity (Restaurant of Forever Stew: 10–120gc × Proficiency).
 * Null when it can't be worked out (the player enters it).
 * @param {{earn?: string, byRarity?: Record<string, number>}} business
 * @param {{proficiency: number, rarity?: string}} ctx
 */
export function businessEarns(business, { proficiency = 0, rarity = '' } = {}) {
  if (!business) return null;
  if (business.byRarity) {
    const per = business.byRarity[rarity] ?? business.byRarity[String(rarity).replace(/\s+/g, ' ').trim()];
    return per == null ? null : per * proficiency;
  }
  const expr = String(business.earn ?? '').replace(/@proficiency/g, `(${proficiency})`).trim();
  if (!expr || !/^[\d\s+*()./-]+$/.test(expr)) return null;
  const v = Function(`"use strict"; return (${expr});`)();
  return Number.isFinite(v) ? v : null;
}

/* -------------------------------------------- */
/*  Money                                       */
/* -------------------------------------------- */

/** A purse as silver alone. */
export const inSilver = ({ gc = 0, sc = 0 } = {}, rate = 100) => Math.round((gc ?? 0) * rate + (sc ?? 0));
/** Silver as a purse, with as much gold as it makes. */
export const fromSilver = (silver, rate = 100) => ({ gc: Math.floor(Math.max(0, silver) / rate), sc: Math.max(0, silver) % rate });

/**
 * Pay `cost` (gc, maybe fractional) from a purse, making change: the new purse, or null when it can't cover it.
 * @param {{gc: number, sc: number}} purse
 * @param {number} cost  gc
 * @param {number} rate  silver to a gold
 */
export function pay(purse, cost, rate = 100) {
  const left = inSilver(purse, rate) - Math.round(cost * rate);
  if (left < 0) return null;
  // Keep the coins as they were where possible: spend silver first only when it covers the fraction.
  const gc = purse.gc ?? 0;
  const sc = purse.sc ?? 0;
  const wholeGc = Math.floor(cost);
  const fracSc = Math.round((cost - wholeGc) * rate);
  if (gc >= wholeGc && sc >= fracSc) return { gc: gc - wholeGc, sc: sc - fracSc };
  return fromSilver(left, rate);
}

/** Add `gain` (gc, maybe fractional) to a purse: whole gold as gold, the rest as silver. */
export function receive(purse, gain, rate = 100) {
  const whole = Math.floor(gain);
  return { gc: (purse.gc ?? 0) + whole, sc: (purse.sc ?? 0) + Math.round((gain - whole) * rate) };
}

/** A gc amount for display: "55gc", "2gc 50sc", "25sc". */
export function formatCoins(gc, rate = 100) {
  const silver = Math.round((gc ?? 0) * rate);
  const g = Math.floor(silver / rate);
  const s = silver % rate;
  return [g ? `${g}gc` : '', s ? `${s}sc` : ''].filter(Boolean).join(' ') || '0gc';
}

/**
 * What a merchant pays for an item: half its marked price (p.266 "Base Prices"), in gold; with a silver rate, rounded down
 * to a whole silver coin (half of a 1sc Candle is nothing).
 */
export const sellPrice = (value, rate = 0) => {
  const half = (Math.max(0, value ?? 0)) / 2;
  return rate ? Math.floor(half * rate + 1e-9) / rate : half;
};
