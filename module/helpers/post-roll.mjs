/**
 * Post-roll options — reactions and passives decided *after* an attack's to-hit is known, resolved
 * GM-side against the hidden defense (the roll is on the player card; hit/miss is computed later in
 * `resolveAttack`). Each entry names who may use it (`side`), when (`on` a miss or a hit), and what it
 * does (`kind`):
 *
 *  - `raise`   — add to the attacker's to-hit, then re-check (Remaneuver, Good Hit, A Helping Hold, Armor Nics)
 *  - `reroll`  — re-roll the attack's kept d20 (Combo Breaker, Drunken Fisticuff, Spider's Trap)
 *  - `force`   — the miss becomes a hit (Lucky Strike)
 *  - `reduce`  — subtract a rolled die from the to-hit, then re-check (Block, Dodge, Quick Defense)
 *  - `redirect`— someone else takes the damage of a landed hit (Sacrifice, Carried Sacrifice, Sacrificial Wing,
 *                Soulbinding's half share)
 *  - `reflect` — the attacker takes the damage it dealt (Black Rebuke)
 *  - `retaliate` — the attacker takes a fixed amount back (Parrying Focus)
 *  - `retarget` — the hit is re-aimed at a random nearby ally and re-resolved against them (Blend In)
 *  - `shield`  — the landed damage is cut by a rolled die (Checkered Shield; Absorb Attack banks it for your next hit)
 *  - `fare`    — someone pays rolled HP to flip the result: a miss becomes a hit (Balanced Fare) or a hit a miss
 *                (Harmed Fare)
 *
 * `side` picks the *reactor*: `attacker` / `defender` (the attack's two parties), or `attackerAlly` /
 * `defenderAlly` (another token friendly to that party, within `range` feet). The whole module is pure
 * data + pure functions over a plain context (no Foundry globals), so eligibility and dice are unit-tested;
 * sacadia.mjs gathers the context, renders the buttons, and applies the outcome.
 *
 * Context (`ctx`) shape, built per reactor per target row:
 *   { owned:Set<catalogId>, opts:{roll options of the reactor}, level, prof, stats:{power,finesse,…},
 *     madness, reactionAvailable, pools:{key:n}, flags:{…per-turn/rest one-shots},
 *     sub:{melee, category, hands, natural, toHitTotal, damage, weaponType, divine, abilityId, opportunity},
 *     reactorMarks:{key:[uuid]}, targetUuid, distance }
 */

/** Level-scaled die (1d4 → 1d6@5 → 1d8@11 is the common reaction ladder) plus extra steps. */
export function scaledDie(level, steps = 0, base = 4, scale = [5, 11]) {
  const ladder = [4, 6, 8, 10, 12];
  let i = ladder.indexOf(base);
  if (i < 0) i = 0;
  i += scale.filter((l) => level >= l).length + steps;
  return `1d${ladder[Math.min(i, ladder.length - 1)]}`;
}

const has = (ctx, id) => ctx.owned.has(id);

/** The system dice ladder's low end (1D2 … 3D10), for reaction dice that climb past a d10 (Checkered Shield: 2D6 @11). */
const LADDER = ['1d2', '1d4', '1d6', '1d8', '1d10', '2d6', '2d8', '2d10', '3d8', '3d10'];
export function ladderDie(index, steps = 0) {
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, index + steps))];
}
const onceTurn = (ctx, flag) => !ctx.flags?.[flag];

/** @type {Record<string, object>} keyed by the owning ability's catalogId */
export const POST_ROLL = {
  /* ---------------- attacker-side, on a miss ---------------- */
  remaneuver: {
    label: 'Remaneuver', side: 'attacker', on: 'miss', kind: 'raise',
    // A one-handed melee attack; once per turn unless Brace and Maneuver.
    eligible: (ctx) => ctx.sub.melee && ctx.sub.hands === 1
      && (onceTurn(ctx, 'remaneuverUsed') || has(ctx, 'brace_and_maneuver')),
    cap: (ctx) => ctx.prof * (has(ctx, 'sticking_your_neck_out') ? 2 : 1),
    onUse: { selfConditions: { sting: 2 }, setFlag: 'remaneuverUsed' },
  },
  thug_combo_breaker: {
    label: 'Combo Breaker', side: 'attacker', on: 'miss', kind: 'reroll',
    // Only while Chained Advance is contributing to-hit (a consecutive-hit streak is running).
    eligible: (ctx) => has(ctx, 'thug_chained_advance') && (ctx.opts['self:combat:consecutive-hits'] ?? 0) >= 1
      && onceTurn(ctx, 'comboBreakerUsed'),
    onUse: { setFlag: 'comboBreakerUsed' },
  },
  thug_drunken_fisticuff: {
    label: 'Drunken Fisticuff', side: 'attacker', on: 'miss', kind: 'reroll',
    eligible: (ctx) => ctx.sub.melee && onceTurn(ctx, 'drunkenFisticuffUsed'),
    onUse: { ap: 1, setFlag: 'drunkenFisticuffUsed' },
  },
  lucky_strike: {
    label: 'Lucky Strike', side: 'attacker', on: 'miss', kind: 'force',
    // Once per fitful (quick) rest.
    eligible: (ctx) => !ctx.flags?.luckyStrikeUsed,
    onUse: { setRestFlag: 'luckyStrikeUsed' },
  },
  spiders_trap: {
    label: "Spider's Trap", side: 'attacker', on: 'miss', kind: 'reroll',
    // A Boost to Forbidden Knowledge / Web while at 0 Madness: spend a Prescient point per re-roll,
    // repeatable until a hit or the pool runs dry.
    eligible: (ctx) => ['forbidden_knowledge', 'forbidden_web'].includes(ctx.sub.abilityId)
      && (ctx.madness ?? 0) === 0 && (ctx.pools?.prescient ?? 0) > 0,
    onUse: { pool: { key: 'prescient', n: 1 } },
  },

  forbidden_trap: {
    label: 'Forbidden Trap', side: 'attacker', on: 'miss', kind: 'force',
    // "If you have Steadied and you miss [with the Forbidden Knowledge it lets you use], you may choose to hit
    // instead (unless you rolled a nat 1)."
    eligible: (ctx) => ctx.sub.abilityId === 'forbidden_knowledge' && !!ctx.opts['self:steadied'] && ctx.sub.natural !== 1,
    onUse: {},
  },

  /* ---------------- an ally of the attacker, on a miss ---------------- */
  good_hit: {
    label: 'Good Hit', side: 'attackerAlly', on: 'miss', kind: 'raise', range: 30,
    // Reduce Madness by N → +ND4 to the ally's to-hit and damage (die +1 type if Steadied).
    eligible: (ctx) => ctx.reactionAvailable && (ctx.madness ?? 0) > 0,
    spend: { resource: 'madness', max: (ctx) => ctx.madness },
    die: (ctx) => scaledDie(0, ctx.opts['self:steadied'] ? 1 : 0, 4, []),
    addsDamage: true,
    onUse: { reaction: true },
  },
  thug_a_helping_hold: {
    label: 'A Helping Hold', side: 'attackerAlly', on: 'miss', kind: 'raise', range: 60,
    // You've Pinned the target: add its Pin to the ally's to-hit; the Pin drops by 1 unless Steadied.
    eligible: (ctx) => ctx.reactionAvailable && (ctx.targetPinned ?? 0) > 0,
    fixed: (ctx) => ctx.targetPinned,
    onUse: { reaction: true, targetConditionDelta: (ctx) => (ctx.opts['self:steadied'] ? {} : { pinned: -1 }) },
  },
  armor_nics: {
    label: 'Armor Nics', side: 'attackerAlly', on: 'miss', kind: 'raise', range: 1000,
    // v1.2: an enemy inside your Clouded Foe has its MD, PD or TD lowered by your Finesse against one attack,
    // declared after the roll. (Raising a defense, or lowering DR, is the GM's.)
    eligible: (ctx) => ctx.reactionAvailable && !!ctx.targetInCloud?.foe && ['pd', 'md', 'td'].includes(ctx.sub.defenseKey),
    fixed: (ctx) => ctx.stats.finesse ?? 0,
    onUse: { reaction: true },
  },

  /* ---------------- defender-side, on a hit ---------------- */
  basic_block: {
    label: 'Block', side: 'defender', on: 'hit', kind: 'reduce',
    // Steadied; vs a melee physical attack. Swordplay (+1 type, wielding a sword) and Improvisational
    // (+1 type, unarmed) step the die. Dodge and Weave deals 1D10+Power (2D6+Power @11) if it turns the hit.
    eligible: (ctx) => ctx.reactionAvailable && ctx.opts['self:steadied'] && ctx.sub.melee && ctx.sub.category !== 'magic',
    die: (ctx) => scaledDie(ctx.level, (has(ctx, 'swordplay') && ctx.opts['self:wielding:sword'] ? 1 : 0)
      + (has(ctx, 'improvisational') && ctx.opts['self:unarmed'] ? 1 : 0)),
    onConvert: (ctx) => (has(ctx, 'thug_dodge_and_weave')
      ? { damageToAttacker: `${ctx.level >= 11 ? '2d6' : '1d10'} + ${ctx.stats.power ?? 0}`, label: 'Dodge and Weave' } : null),
    onUse: { reaction: true },
  },
  basic_dodge: {
    label: 'Dodge', side: 'defender', on: 'hit', kind: 'reduce',
    // Steadied + Medium Armor; vs a ranged physical attack. Improvisational (+1 type, unarmed); Cunning of
    // Crows adds ½ Fate to the roll.
    eligible: (ctx) => ctx.reactionAvailable && ctx.opts['self:steadied'] && ctx.opts['self:armor:medium']
      && ctx.sub.category === 'ranged',
    // Rabbit's Paw (trinket): "While a Rabbit's Paw is equipped in a RIS, increase your Dodge's dice type by one."
    die: (ctx) => scaledDie(ctx.level, (has(ctx, 'improvisational') && ctx.opts['self:unarmed'] ? 1 : 0) + (ctx.opts["self:gear:rabbit-s-paw"] ? 1 : 0)),
    flat: (ctx) => (has(ctx, 'cunning_of_crows') ? Math.ceil((ctx.stats.fate ?? 0) / 2) : 0),
    onUse: { reaction: true },
  },
  quick_defense: {
    label: 'Quick Defense', side: 'defender', on: 'hit', kind: 'reduce',
    // Deflect a ranged physical projectile with your own: −1D4 (1D6@5, 1D8@11; +1 type if Steadied).
    eligible: (ctx) => ctx.reactionAvailable && ctx.sub.category === 'ranged',
    die: (ctx) => scaledDie(ctx.level, ctx.opts['self:steadied'] ? 1 : 0),
    onUse: { reaction: true },
  },

  please_dont: {
    label: "Please Don't", side: 'defenderAlly', on: 'hit', kind: 'reduce', range: 5, rangeFrom: 'attacker',
    // "If you successfully hit a target making an attack with Excuse Me, reduce that target's rolled to-hit
    // by your Proficiency." (Excuse Me's reaction is the cost.)
    eligible: (ctx) => ctx.owned.has('excuse_me'),
    fixedReduce: (ctx) => ctx.prof,
    onUse: {},
  },
  bd_parrying_focus: {
    label: 'Parrying Focus', side: 'defender', on: 'hit', kind: 'retaliate',
    // "As long as you maintain Focus, any time a creature hits you with a melee attack, you may expend a
    // reaction to make them take damage equal to your Finesse."
    eligible: (ctx) => ctx.reactionAvailable && ctx.sub.melee && (ctx.focusRounds?.bd_parrying_focus ?? 0) > 0,
    damage: (ctx) => ctx.stats.finesse ?? 0,
    onUse: { reaction: true },
  },

  /* ---------------- damage redirection / reflection, on a hit ---------------- */
  sacrifice: {
    label: 'Sacrifice', side: 'defenderAlly', on: 'hit', kind: 'redirect', range: 5, steadiedRange: 10,
    // Take an adjacent ally's damage; Reduced Threat cuts it by ½ Courage (Good Side → full Courage).
    eligible: (ctx) => ctx.reactionAvailable,
    reduction: (ctx) => (has(ctx, 'reduced_threat')
      ? (has(ctx, 'good_side') ? (ctx.stats.courage ?? 0) : Math.ceil((ctx.stats.courage ?? 0) / 2)) : 0),
    onUse: { reaction: true },
  },
  carried_sacrifice: {
    label: 'Carried Sacrifice', side: 'defenderAlly', on: 'hit', kind: 'redirect', range: 5,
    // Only while carrying the ally (Pack Mule in use this turn).
    eligible: (ctx) => ctx.reactionAvailable && ctx.opts['self:used:pack_mule'],
    onUse: { reaction: true },
  },
  sacrificial_wing: {
    label: 'Sacrificial Wing', side: 'defenderAlly', on: 'hit', kind: 'redirect', range: 1000,
    // v1.2: "when you are maintaining Focus on Clouded Ally and a target of Clouded Ally is attacked, you may take all
    // the damage instead." The ally hit stands inside your Clouded Ally.
    eligible: (ctx) => ctx.reactionAvailable && !!ctx.targetInCloud?.ally,
    onUse: { reaction: true },
  },
  soulbinding: {
    label: 'Soulbinding', side: 'defender', on: 'hit', kind: 'redirect', share: 0.5,
    // While maintained, the soulbound target takes half of every hit you take (no reaction).
    eligible: (ctx) => (ctx.reactorMarks?.soulbound ?? []).length > 0 && (ctx.focusRounds?.soulbinding ?? 0) > 0,
    redirectTo: 'soulbound',
    onUse: {},
  },
  blend_in_with_the_herd: {
    label: 'Blend In with the Herd', side: 'defenderAlly', on: 'hit', kind: 'retarget', range: 5, includeSelf: true,
    // "Roll 1DX, where X is the number of allies within 5ft of you, including yourself … The enemy's attack
    // instead targets the target rolled." Costs a Herd point and the reaction.
    eligible: (ctx) => ctx.reactionAvailable && (ctx.pools?.herd ?? 0) > 0,
    onUse: { reaction: true, pool: { key: 'herd', n: 1 } },
  },
  /* ---------------- Magus / Witch (Prestige Classes addendum) ---------------- */
  mg_checkered_shield: {
    label: 'Checkered Shield', side: 'defender', on: 'hit', kind: 'shield', minDamage: 1,
    // "In response to taking damage, expend a reaction and reduce that damage by 1D8 to a minimum of 1 damage. 1D10 at
    // Level 5, and 2D6 at level 11." Greater Shield and Shield of Delatia each add a dice type.
    eligible: (ctx) => ctx.reactionAvailable,
    die: (ctx) => ladderDie(ctx.level >= 11 ? 5 : ctx.level >= 5 ? 4 : 3,
      (has(ctx, 'mg_greater_shield') ? 1 : 0) + (has(ctx, 'mg_shield_of_delatia') ? 1 : 0)),
    onUse: { reaction: true },
  },
  mg_absorb_attack: {
    label: 'Absorb Attack', side: 'defender', on: 'hit', kind: 'shield', storeAsDamage: true,
    // "As a reaction to taking damage from an elemental or mental attack, expend a Spell Slot and reduce the damage by
    // XD4 (X = Proficiency) … the first time you make an attack that would deal damage, add this damage" (until the end
    // of your next turn). Greater Absorption: XD6. Elemental or mental: a magic attack, or one against MD.
    eligible: (ctx) => ctx.reactionAvailable && (ctx.pools?.spell ?? 0) > 0 && (ctx.sub.category === 'magic' || ctx.sub.defenseKey === 'md'),
    die: (ctx) => `${Math.max(1, ctx.prof)}d${has(ctx, 'mg_greater_absorption') ? 6 : 4}`,
    onUse: { reaction: true, pool: { key: 'spell', n: 1 } },
  },
  mg_torq_of_thorns: {
    label: 'Torq of Thorns', side: 'attackerAlly', on: 'any', kind: 'crit', range: 30,
    // "In response to an attack made by an ally within 30ft of you that is some number on the die away from a critical
    // hit, you may expend any number of Spell Slots. For each Spell Slot expended, increase the critical range of your
    // ally by one." The slots it takes: the ally's crit floor minus the natural d20 rolled.
    eligible: (ctx) => {
      const need = (ctx.sub.critFloor ?? 20) - (ctx.sub.natural ?? 0);
      return need > 0 && (ctx.sub.natural ?? 0) > 1 && (ctx.pools?.spell ?? 0) >= need;
    },
    slots: (ctx) => (ctx.sub.critFloor ?? 20) - (ctx.sub.natural ?? 0),
    onUse: {},
  },
  wt_balanced_fare: {
    label: 'Balanced Fare', side: 'attackerAlly', on: 'miss', kind: 'fare', range: 5,
    // "In response to an ally within 5ft of you attempting to hit a target and missing, you may deal XD6 damage to them,
    // where X is the amount by which they missed. They then hit. You cannot use this to turn a natural 1 into a hit."
    // Reduced Fare: XD4. (The ally agreeing first is the table's.)
    eligible: (ctx) => ctx.reactionAvailable && ctx.sub.natural !== 1,
    fareDie: (ctx) => (has(ctx, 'wt_reduced_fare') ? 'd4' : 'd6'),
    onUse: { reaction: true },
  },
  wt_harmed_fare: {
    label: 'Harmed Fare', side: 'defenderAlly', on: 'hit', kind: 'fare', range: 5, rangeFrom: 'attacker', includeSelf: true,
    // "You may use Balanced Fare on an enemy target within 5ft who would hit on their attack against you or an ally. If
    // you do, take XD6 damage, where X is the difference between their to-hit rolled and the Defense they target. Then,
    // the enemy target misses. You cannot use this to prevent a natural 20 from critically hitting." Reduced Fare: XD4.
    eligible: (ctx) => ctx.reactionAvailable && ctx.sub.natural !== 20 && has(ctx, 'wt_balanced_fare'),
    fareDie: (ctx) => (has(ctx, 'wt_reduced_fare') ? 'd4' : 'd6'),
    onUse: { reaction: true },
  },
  oracle_pull_the_strand: {
    label: 'Pull the Strand', side: 'defenderAlly', on: 'hit', kind: 'reduce', range: 30, rangeFrom: 'attacker', includeSelf: true,
    // "You may expend 'Slightly Cracked' rolls to add or subtract your rolled number to a roll made by an enemy within
    // 30ft of you." Against an enemy's hit: subtract a saved roll (picked on use), then re-check.
    eligible: (ctx) => ctx.reactionAvailable && (ctx.cracked?.length ?? 0) > 0,
    pickSaved: true,
    onUse: { reaction: true },
  },
  /* ---------------- Lore ---------------- */
  lore_oozing_flow: {
    label: 'Oozing Flow', side: 'defender', on: 'hit', kind: 'shield',
    // "You can expend a lore point to prevent all damage from any single source that would be dealt to you."
    eligible: (ctx) => (ctx.lore ?? 0) > 0,
    die: () => '999',
    onUse: { lore: 1 },
  },
  black_rebuke: {
    label: 'Black Rebuke', side: 'defenderAlly', on: 'hit', kind: 'reflect', range: 30, rangeFrom: 'attacker', includeSelf: true,
    // When an enemy within 30ft hits you or an ally: remove all your Madness, deal that damage back.
    eligible: (ctx) => ctx.reactionAvailable,
    onUse: { reaction: true, clearMadness: true },
  },
};

/** The entries a given reactor could use for this row (pure). */
export function eligiblePostRolls(ctx, { side, hit }) {
  const on = hit ? 'hit' : 'miss';
  return Object.entries(POST_ROLL)
    .filter(([id, e]) => e.side === side && (e.on === on || e.on === 'any') && ctx.owned.has(id))
    .filter(([, e]) => e.eligible(ctx))
    .map(([id, e]) => ({ id, ...e }));
}
