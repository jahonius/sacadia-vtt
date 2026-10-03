/**
 * Trait Checks against adversarial condition levels (book p.218 / p.258).
 *
 * Giving a condition: the defender rolls one Trait Check *per level* the attacker attempts to give, each
 * die + Proficiency + Trait (+ flat Trait bonuses), against the attacker's Check DC; every failed die is
 * one level taken. The Make Trait Check action is the same pool in reverse: every *success* removes a level.
 *
 * Advantage / disadvantage use the playtest owner's house rule (see docs/NEXT-STEPS.md #2), shared by the
 * Resist popup and the initial save so both read the same:
 *  - net advantage Y  → roll (L+Y) dice and keep the best L (the rest are shown struck through);
 *  - net disadvantage Y → Y of the L checks are automatic failures; roll the other L−Y normally.
 * A Fumble applies to the *first* check of the sequence only (book p.257), then is spent.
 *
 * Pure (no Foundry globals) so the planning/scoring is unit-tested; callers roll the dice.
 */

import { evaluatePredicate, resolveModifierValue, predicateAtoms } from './derivation.mjs';

/**
 * How many d20s to roll for `levels` checks at net advantage `net`.
 * @returns {{poolCount:number, autoFail:number}}
 */
export function planPool(levels, net) {
  const L = Math.max(1, Math.floor(levels));
  if (net >= 0) return { poolCount: L + net, autoFail: 0 };
  const autoFail = Math.min(-net, L);
  return { poolCount: L - autoFail, autoFail };
}

/**
 * Score rolled d20 results. `mod` is added to every die; `fumble` is subtracted from the first die only.
 * With surplus dice (net advantage), only the best `levels − autoFail` totals count. When `dc` is known,
 * counts failures (each a level taken / a level not removed) and successes.
 * @param {number[]} raws  natural d20 results, in roll order
 * @returns {{entries:{raw:number,total:number,dropped:boolean,pass:boolean|null}[], keptTotals:number[], fails:number|null, successes:number|null}}
 */
export function scorePool(raws, { levels, net = 0, mod = 0, fumble = 0, dc = null, bonusOne = 0, bonusCount = 0 }) {
  const { autoFail } = planPool(levels, net);
  const keepN = Math.max(0, Math.max(1, Math.floor(levels)) - autoFail);
  const entries = raws.map((raw, i) => ({ raw, total: raw + mod - (i === 0 ? fumble : 0), dropped: false, pass: null }));
  if (entries.length > keepN) {
    const keep = new Set([...entries].sort((a, b) => b.total - a.total).slice(0, keepN));
    for (const e of entries) if (!keep.has(e)) e.dropped = true;
  }
  const kept = entries.filter((e) => !e.dropped);
  // A bonus to one roll chosen after rolling (Reactive Mind): it goes where it turns a failure into a success
  // — the highest failing kept die that it lifts to the DC; without a DC, onto the lowest kept die.
  // Bureaucrat's Blessing adds the same bonus to `bonusCount` more dice.
  for (let i = 0; bonusOne > 0 && i <= bonusCount && kept.length; i++) {
    const open = kept.filter((e) => !e.bonused);
    const target = dc != null
      ? open.filter((e) => e.total < dc && e.total + bonusOne >= dc).sort((a, b) => b.total - a.total)[0]
      : [...open].sort((a, b) => a.total - b.total)[0];
    if (!target) break;
    target.total += bonusOne; target.bonused = true;
  }
  let fails = null, successes = null;
  if (dc != null) {
    for (const e of kept) e.pass = e.total >= dc;
    successes = kept.filter((e) => e.pass).length;
    fails = kept.length - successes + autoFail;
  }
  return { entries, keptTotals: kept.map((e) => e.total), fails, successes };
}


/**
 * Roll options describing *which* check is being made against a condition, so passives can say exactly
 * where they apply:
 *  - `self:checking:<cond>` / `self:checking:physical|mental` — any Trait Check against the condition;
 *  - `self:saving:<cond>` (+group)  — the checks made when the condition is first given (Anointed, Drain
 *    Tolerant: "your initial Trait Check");
 *  - `self:resisting:<cond>` (+group) — the Make Trait Check action to shed it (Enduring Animal, Bolers Ban).
 * @param {string} condition  condition key
 * @param {string} group      its CONFIG group (lesserMental / greaterPhysical / …)
 * @param {'save'|'resist'} mode
 */
export function checkContext(condition, group, mode, conditionPicks = []) {
  const o = {};
  const fam = /physical/i.test(group ?? '') ? 'physical' : (/mental/i.test(group ?? '') ? 'mental' : '');
  const modePrefix = mode === 'resist' ? 'self:resisting' : 'self:saving';
  const add = (prefix) => { o[`${prefix}:${condition}`] = true; if (fam) o[`${prefix}:${fam}`] = true; };
  add('self:checking');
  add(modePrefix);
  // The checked condition is one an ability picked (Drain Tolerant, Not Even Impressed …).
  for (const { id, value } of conditionPicks) {
    if (value === condition) { o[`self:checking:picked:${id}`] = true; o[`${modePrefix}:picked:${id}`] = true; }
  }
  return o;
}

/**
 * Fold a checker's own condition-check modifiers: `resistAdvantage` (net advantage on the pool) and
 * `resistBonus` (flat bonus to every die — Mental Fortitude's +Wiles). Only modifiers whose predicate
 * holds for `options` count, so nothing applies outside its named check.
 * @param {{name:string, modifiers:object[], id?:string, pickValue?:string}[]} items  the checker's abilities
 * @returns {{adv:number, bonus:number, notes:string[]}}
 */
export function foldCheckModifiers(items, options, numbers = {}) {
  let adv = 0, bonus = 0;
  const notes = [];
  for (const it of items) {
    // A picked ability can be taken more than once with different picks (Drain Tolerant ×3): its
    // `…:picked:<id>` atoms must reflect *this* instance's own pick, not any instance's.
    let opts = options;
    if (it.id && it.pickValue !== undefined) {
      opts = { ...options };
      for (const pre of ['self:checking', 'self:saving', 'self:resisting']) {
        const key = `${pre}:picked:${it.id}`;
        if (it.pickValue && options[`${pre}:${it.pickValue}`]) opts[key] = true; else delete opts[key];
      }
    }
    for (const m of it.modifiers ?? []) {
      if (m.target !== 'resistAdvantage' && m.target !== 'resistBonus') continue;
      const atoms = predicateAtoms(m.predicate);
      if (!evaluatePredicate(atoms, opts)) continue;
      const v = resolveModifierValue(m.value, numbers);
      if (!v) continue;
      if (m.target === 'resistAdvantage') adv += v; else bonus += v;
      notes.push(`${m.label || it.name} ${v > 0 ? '+' : ''}${v}${m.target === 'resistAdvantage' ? '×' : ''}`);
    }
  }
  return { adv, bonus, notes };
}

/**
 * Optional, paid improvements a checker may choose when rolling a Trait Check — offered as a prompt at the
 * moment of the roll (the save button, the Resist / Make-Trait-Check popup, a stat roll):
 *  - Confidence: spend a Savage Point → 1× advantage vs mental conditions an adversary gives you;
 *  - Fateful Saves: once per quick rest (a Boost) → add your Fate to every roll of the Trait Check.
 * `when` reads the check's context options; `cost` is a class pool point or a per-rest flag.
 */
export const CHECK_SPENDS = [
  { id: 'confidence', label: 'Confidence', adv: 1, cost: { pool: 'savage' }, when: (o) => !!o['self:checking:mental'] },
  { id: 'fateful_saves', label: 'Fateful Saves', bonus: '@fate', cost: { rest: 'fatefulSaves' }, when: () => true },
  // Reactive Mind: "use a reaction to add your Wiles to one roll (you may choose which roll after you roll). If
  // you have Steadied, you may choose all rolls made." One die (placed by scorePool) or all when Steadied.
  { id: 'reactive_mind', label: 'Reactive Mind', bonusOne: '@wiles', bonusIfSteadied: '@wiles', cost: { reaction: true },
    when: (o) => !!o['self:checking:mental'] },
];

/** The optional spends this checker can afford right now (pure). */
export function availableCheckSpends({ owned, pools = {}, restFlags = {}, reaction = 1 }, options) {
  return CHECK_SPENDS.filter((c) => owned.has(c.id) && c.when(options)
    && (c.cost.pool ? (pools[c.cost.pool] ?? 0) > 0 : true)
    && (c.cost.reaction ? reaction > 0 : true)
    && (c.cost.rest ? !restFlags[c.cost.rest] : true));
}
