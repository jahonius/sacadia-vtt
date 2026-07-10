/**
 * Pure derivation functions for Tales of Sacadia.
 *
 * These are intentionally free of any Foundry runtime dependency so they can be unit-tested in
 * plain Node (`node --test`). The DataModels in `module/data/*` call these from
 * `prepareDerivedData`. Formulas are lifted from the book-verified Roll20 sheet constants
 * (book pp.190/218/222/226/227) — see PLANNING.md and the Roll20 ARCHITECTURE.md.
 */

/**
 * Proficiency bonus for a character level: 1 at L1, 2 at L2, then +1 every 3 levels.
 * @param {number} level
 * @returns {number}
 */
export function proficiencyForLevel(level) {
  return level <= 1 ? 1 : 2 + Math.floor((level - 2) / 3);
}

/**
 * Maximum Action Points for a character level: 2 at L1, 3 at L2, then +1 every 4 levels.
 * @param {number} level
 * @returns {number}
 */
export function maxApForLevel(level) {
  return level <= 1 ? 2 : 3 + Math.floor((level - 2) / 4);
}

/**
 * Maximum Combat Skill Points for a character level: 10 at L1, +6 per level thereafter.
 * @param {number} level
 * @returns {number}
 */
export function maxCspForLevel(level) {
  return level <= 1 ? 10 : 10 + 6 * (level - 1);
}

/**
 * A single defense value (book pp.190/222): `11 + governing stat + armor/effect bonuses`.
 * Each of AD/PD/TD/MD is computed independently by this same formula.
 * @param {object} args
 * @param {number} args.stat   The governing stat's value.
 * @param {number} [args.armor=0]  Armor + effect contribution to this defense.
 * @param {number} [args.base=11]
 * @returns {number}
 */
export function defenseValue({ stat, armor = 0, base = 11 }) {
  return base + stat + armor;
}

/**
 * Check DC (book p.218): `9 + profession stat + Proficiency + floor(Courage / 3)`.
 * @param {object} args
 * @param {number} args.professionStat  The active profession's governing stat value.
 * @param {number} args.proficiency
 * @param {number} args.courage
 * @returns {number}
 */
export function checkDc({ professionStat, proficiency, courage }) {
  return 9 + professionStat + proficiency + Math.floor(courage / 3);
}

/**
 * Suggested (average) Max Health hint: each profession track's HP/level × its level.
 * The real Max Health stays player-editable (the book allows rolling instead).
 * @param {Array<{hpPerLevel: number, level: number}>} tracks
 * @returns {number}
 */
export function suggestedMaxHealth(tracks) {
  return tracks.reduce((sum, t) => sum + (t.hpPerLevel || 0) * (t.level || 0), 0);
}

/**
 * Suggested Max Health Pools hint: `Level + floor(Power / 2)`.
 * @param {number} level
 * @param {number} power
 * @returns {number}
 */
export function suggestedMaxHealthPools(level, power) {
  return level + Math.floor(power / 2);
}

/**
 * The defense value a to-hit must beat, honoring AD-as-floor (book pp.190/222): AD is a floor under
 * every defense, so the effective target is the greater of the specific defense and AD.
 * @param {number} specific  The targeted defense's value (PD/TD/MD/AD).
 * @param {number} ad        The target's All Defense.
 * @returns {number}
 */
export function effectiveDefenseValue(specific, ad) {
  return Math.max(specific ?? 0, ad ?? 0);
}

/**
 * Damage actually applied after Damage Resistance soaks it (book: DR subtracts, floored at 0).
 * @param {number} damage
 * @param {number} dr
 * @returns {number}
 */
export function damageAfterDr(damage, dr) {
  return Math.max(0, (damage ?? 0) - (dr ?? 0));
}

/**
 * Lore Limit — the max Lore Points a character refills to on a Long Rest (book p.168): 1 at Level
 * 4+, +1 at Fate 3+, +1 more at Fate 6+ (so 0–3). Heroic-campaign resource; 0 below Level 4.
 * @param {number} level
 * @param {number} fate
 * @returns {number}
 */
export function loreLimit(level, fate) {
  if (level < 4) return 0;
  return 1 + (fate >= 3 ? 1 : 0) + (fate >= 6 ? 1 : 0);
}

/**
 * The governing-stat value that actually counts toward a defense, respecting an armor Max Stat
 * cap (book pp.192–194). `null` maxStat = uncapped.
 * @param {number} statValue
 * @param {number|null} maxStat
 * @returns {number}
 */
export function effectiveDefenseStat(statValue, maxStat) {
  return maxStat == null ? statValue : Math.min(statValue, maxStat);
}

/**
 * Build a dice string (e.g. `"2d6"`) for a position on the book's dice-type ladder (p.218).
 * The ladder itself lives in `CONFIG.SACADIA.diceLadder`; it is passed in so this stays
 * Foundry-free and unit-testable.
 * @param {number|null} ladderIndex        Index into the ladder, or null for "no ladder value".
 * @param {Array<{count: number, die: number}>} ladder
 * @returns {string} the dice string, or "" when no ladder value applies.
 */
export function diceLadderFormula(ladderIndex, ladder) {
  if (ladderIndex == null || !ladder?.length) return '';
  const i = Math.max(0, Math.min(ladderIndex, ladder.length - 1));
  const { count, die } = ladder[i];
  return `${count}d${die}`;
}

/**
 * Step a damage die up the ladder by `steps` (die-step buffs, p.218 progression). If the current
 * `(count, denomination)` sits on the ladder and the count is a plain integer, walk the ladder
 * (so `1d10` → `2d6`, doubling count past 1d10). Otherwise — a stat-scaled/formula count — step
 * only the denomination up the standard sizes, leaving the count untouched. Clamps at the top.
 * @param {string|number} count           Dice count (may be a formula like "@madness").
 * @param {number} denomination           Die size.
 * @param {number} steps                  Number of ladder steps (0 = unchanged).
 * @param {Array<{count:number, die:number}>} ladder
 * @returns {{count: string|number, denomination: number}}
 */
export function stepDie(count, denomination, steps, ladder) {
  if (!steps || steps <= 0 || !denomination) return { count, denomination };
  const n = Number(count);
  if (Number.isInteger(n) && ladder?.length) {
    const idx = ladder.findIndex((e) => e.count === n && e.die === denomination);
    if (idx >= 0) {
      const e = ladder[Math.min(idx + steps, ladder.length - 1)];
      return { count: e.count, denomination: e.die };
    }
  }
  const sizes = [2, 4, 6, 8, 10];
  const di = sizes.indexOf(denomination);
  return { count, denomination: di >= 0 ? sizes[Math.min(di + steps, sizes.length - 1)] : denomination };
}

/* -------------------------------------------- */
/*  Conditional-modifier engine                 */
/*  (see docs/conditional-modifiers.md)         */
/* -------------------------------------------- */

/** Truthiness for a roll-option value: presence (`true`), a non-empty string, or a non-zero number. */
function optionTruthy(v) {
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return Boolean(v);
}

/**
 * Evaluate a single predicate atom against the assembled roll options (a `tag → value` map).
 * Structured, never `eval`. Grammar (see docs/conditional-modifiers.md):
 *   `tag`      → present / truthy
 *   `!tag`     → absent / falsy
 *   `tag OP N` → numeric compare of the option's value (0 if absent); OP ∈ >= <= != = > <
 * @param {string} atom
 * @param {Record<string, number|string|boolean>} options
 * @returns {boolean}
 */
export function matchesAtom(atom, options = {}) {
  const a = String(atom ?? '').trim();
  if (!a) return true;
  if (a.startsWith('!')) return !optionTruthy(options[a.slice(1).trim()]);
  const m = a.match(/^(.+?)\s*(>=|<=|!=|=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const [, tag, op, rhs] = m;
    const lv = Number(options[tag.trim()] ?? 0);
    const rv = Number(rhs);
    switch (op) {
      case '>=': return lv >= rv;
      case '<=': return lv <= rv;
      case '>': return lv > rv;
      case '<': return lv < rv;
      case '!=': return lv !== rv;
      default: return lv === rv; // '='
    }
  }
  return optionTruthy(options[a]);
}

/**
 * A predicate holds when **every** atom holds (logical AND). An empty/absent predicate is
 * unconditional (always true).
 * @param {string[]} atoms
 * @param {Record<string, number|string|boolean>} options
 * @returns {boolean}
 */
export function evaluatePredicate(atoms, options = {}) {
  if (!atoms?.length) return true;
  return atoms.every((atom) => matchesAtom(atom, options));
}

/**
 * Resolve a modifier's `value` — a number or an `@ref` arithmetic formula — against a numeric map
 * (roll data + counters). Supports the operators `+ - * / %`, parentheses, and the whitelisted math
 * functions `ceil/floor/round/min/max/abs` (so "half your Proficiency, rounded up" is
 * `ceil(@proficiency/2)`). Dice and anything outside the whitelist are rejected → 0; a standing
 * bonus is deterministic, so dice belong in a damage part, not here. Unknown refs read as 0.
 * @param {string|number} value
 * @param {Record<string, number>} numbers  Flat map, dotted keys allowed (e.g. `combat.consecutiveHits`).
 * @returns {number}
 */
export function resolveModifierValue(value, numbers = {}) {
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  if (!s) return 0;
  // Substitute @refs with their (parenthesized) numeric value.
  const substituted = s.replace(/@([\w.]+)/g, (_, ref) => `(${Number(numbers[ref] ?? 0)})`);
  // Whitelist guard: after removing the allowed function names, only numeric/operator chars may
  // remain. This rejects dice (`1d6` → leftover `d`) and any stray identifiers.
  const stripped = substituted.replace(/\b(ceil|floor|round|min|max|abs)\b/g, '');
  if (!/^[-+*/%(). ,\d]*$/.test(stripped)) return 0;
  try {
    const fn = new Function('Math', `"use strict"; const {ceil,floor,round,min,max,abs}=Math; return (${substituted});`);
    const out = fn(Math);
    return Number.isFinite(out) ? out : 0;
  } catch {
    return 0;
  }
}

/* -------------------------------------------- */
/*  Action / limb economy (book pp.236–237)     */
/* -------------------------------------------- */

/**
 * Resolve which exhaustion-tracker slots an ability's limb costs occupy, given the current
 * exhaustion state (book p.237). `oneArm` binds to whichever arm is still free (else it reuses an
 * exhausted arm); `twoArm` binds both arms; the other tokens map to their single slot.
 *
 * Returns the slots occupied, the subset *newly* exhausted by this action (what an Undo should
 * clear), and whether any already-exhausted limb was reused — the +1 AP trigger.
 * @param {string[]} limbTokens          The ability's `costs.limbs` (`oneArm`, `twoArm`, `body`, `mind`, `focus`, `leg`).
 * @param {Record<string, boolean>} [exhaustion={}]  The character's current exhaustion slots.
 * @returns {{occupied: string[], newlyExhausted: string[], reused: boolean}}
 */
export function resolveLimbSlots(limbTokens = [], exhaustion = {}) {
  const single = { body: 'body', mind: 'mind', focus: 'focus', leg: 'legs' };
  const used = new Set(Object.entries(exhaustion).filter(([, v]) => v).map(([k]) => k));
  const occupied = [];
  const newlyExhausted = [];
  let reused = false;

  const take = (slot) => {
    occupied.push(slot);
    if (used.has(slot)) reused = true;
    else newlyExhausted.push(slot);
    used.add(slot);
  };

  for (const token of limbTokens) {
    if (token === 'twoArm') { take('leftArm'); take('rightArm'); }
    else if (token === 'oneArm') take(['leftArm', 'rightArm'].find((a) => !used.has(a)) ?? 'leftArm');
    else if (single[token]) take(single[token]);
  }
  return { occupied, newlyExhausted, reused };
}

/**
 * Effective AP cost of an action: its base cost, +1 if it reused an already-exhausted limb
 * (book p.237 — "exhausted limbs always cost 2 AP"). The +1 applies once, not per limb.
 * @param {number} baseAp
 * @param {boolean} reused
 * @returns {number}
 */
export function effectiveApCost(baseAp, reused) {
  return Math.max(0, baseAp) + (reused ? 1 : 0);
}
