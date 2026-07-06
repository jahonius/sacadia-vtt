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
