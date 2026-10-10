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
 * Check DC (v1.2 pp.100–140, p.227): `9 + profession stat + Proficiency + floor(Courage / 2)` — the Courage
 * trait boon ("+1 Check DC per 2 Courage") is folded into every profession's formula. (v1.0 used Courage/3.)
 * @param {object} args
 * @param {number} args.professionStat  The active profession's governing stat value.
 * @param {number} args.proficiency
 * @param {number} args.courage
 * @returns {number}
 */
export function checkDc({ professionStat, proficiency, courage }) {
  return 9 + professionStat + proficiency + Math.floor(courage / 2);
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
 * Damage actually applied after Damage Resistance soaks it (book p.192): DR subtracts, but "all attacks deal
 * a minimum of one damage" — any positive damage leaves at least 1. Zero damage stays zero.
 * @param {number} damage
 * @param {number} dr
 * @returns {number}
 */
export function damageAfterDr(damage, dr) {
  const d = damage ?? 0;
  if (d <= 0) return 0;
  return Math.max(1, d - (dr ?? 0));
}

/**
 * Check an ability's prerequisite text ("Power 3, Bloodsight", "Fate[2]", "Religion: Astrology[3]", "Bladedancer, Level
 * 9", "Prof[3]") against a character. Each comma-separated part is classified: a Trait at a score, a level, a
 * Proficiency, a profession, a specialized talent at a rank (`Name[N]`), where the character comes from (a culture,
 * subculture, ancestry or Heritage: `originMatch`), or an ability by name. Parts it can't classify ("Heibrim in Empire",
 * "You work for a Myrgha Oligarch") are returned as `unknown`, never as unmet.
 * @param {string} text
 * @param {{stats: object, level: number, proficiency: number, professions: string[], abilities: Set<string>,
 *   knownAbilities?: Set<string>, specialties: Record<string, number>, talents: Set<string>, origin?: object}} ctx
 *   names lower-cased; `origin` from rules/identity.mjs originContext
 * @returns {{unmet: string[], unknown: string[]}}
 */
export function checkPrerequisites(text, ctx) {
  const unmet = [];
  const unknown = [];
  const stats = ['power', 'finesse', 'courage', 'wiles', 'fate'];
  const parts = String(text ?? '').replace(/^\s*\(?prerequisites?:\s*/i, '').replace(/\)\s*$/, '')
    .split(/\s*[,;·]\s*/).map((p) => p.trim().replace(/\.$/, '')).filter(Boolean);
  for (const part of parts) {
    const p = part.toLowerCase();
    let m;
    if (/^research:/.test(p) || /^p\.\d+$/.test(p)) continue;
    if ((m = /^(power|finesse|courage|wiles|fate)\s*\[?\s*(\d+)\s*\]?$/.exec(p))) {
      if ((ctx.stats?.[m[1]] ?? 0) < Number(m[2])) unmet.push(part);
    } else if ((m = /^(?:([a-z_]+) )?level\s*(\d+)$/.exec(p))) {
      // "Magus Level 5": that profession's own level; plain "Level 9": the character's.
      const lvl = m[1] && ctx.professionLevels?.[m[1]] != null ? ctx.professionLevels[m[1]] : (ctx.level ?? 0);
      if (lvl < Number(m[2])) unmet.push(part);
    } else if ((m = /^prof(?:iciency)?\s*\[?\s*(\d+)\s*\]?$/.exec(p))) {
      if ((ctx.proficiency ?? 0) < Number(m[1])) unmet.push(part);
    } else if ((m = /^(?:[a-z ]+:\s*)?([a-z][a-z' -]*?)\s*\[\s*(\d+)\s*\]$/.exec(p))) {
      if ((ctx.specialties?.[m[1].trim()] ?? 0) < Number(m[2])) unmet.push(part);
    } else if (ctx.origin && (m = originMatch(p, ctx.origin)) !== null) {
      if (!m) unmet.push(part);
    } else if (ctx.origin && (m = /^(.+) (\S+)$/.exec(p)) && (ctx.professionNames ?? []).includes(m[2])
      && originMatch(`${m[1]} cultural heritage`, ctx.origin) !== null) {
      // "Tianqi Oracle": a culture's profession.
      if (!originMatch(`${m[1]} cultural heritage`, ctx.origin) || !(ctx.professions ?? []).includes(m[2])) unmet.push(part);
    } else if (stats.includes(p)) {
      if ((ctx.stats?.[p] ?? 0) < 1) unmet.push(part);
    } else if ((ctx.professionNames ?? []).includes(p)) {
      if (!(ctx.professions ?? []).includes(p)) unmet.push(part);
    } else if (ctx.abilities?.has(p)) {
      // owned
    } else if (ctx.knownAbilities?.has(p)) {
      unmet.push(part);
    } else if (ctx.talents?.has(p)) {
      if (!ctx.ownedTalents?.has(p)) unmet.push(part);
    } else unknown.push(part);
  }
  return { unmet, unknown };
}

/**
 * A prerequisite about where a character comes from, lower-cased (see checkPrerequisites): "Tianqi Cultural Heritage", "Black
 * Cunei Subculture" (or "White Cunei Myrgha"), "Withered Human Ancestry", "Daemonai Heritage", "Human", "Heavily Corrupted
 * Fontborne Heritage" (Strength of Warp). An ancestry is matched without its Heritage's name ("Brute Curiot" is "Brute").
 * @param {string} p
 * @param {{cultures: string[], subcultures: string[], subculture: string, ancestry: string, heritage: string,
 *   heritageNames: Record<string, string>, heritageChoice: string}} o
 * @returns {boolean|null}  met, unmet, or null when it isn't about origin (or is the table's call: "A Nature Fixerfolk Ancestry")
 */
export function originMatch(p, o) {
  let m;
  if ((m = /^(.+?) cultural heritage$/.exec(p))) return o.cultures.includes(m[1]);
  const sub = o.subcultures.find((s) => p === s || p === `${s} subculture` || p.startsWith(`${s} `));
  if (sub) return o.subculture === sub;
  if ((m = /^(.+?) subculture$/.exec(p))) return o.subculture === m[1];
  if ((m = /^(.+?) ancestry$/.exec(p))) {
    if (/^an? /.test(m[1])) return null;
    const names = Object.keys(o.heritageNames ?? {});
    const strip = (s) => names.reduce((acc, h) => (acc.endsWith(` ${h}`) ? acc.slice(0, -h.length - 1) : acc), s);
    return !!o.ancestry && strip(m[1]) === strip(o.ancestry);
  }
  if ((m = /^(?:(weakly|lightly|heavily) (?:corrupted|warped) )?(.+?) heritage$/.exec(p)) && o.heritageNames?.[m[2]]) {
    const key = o.heritageNames[m[2]];
    if (o.heritage !== key) return false;
    return !m[1] || o.heritageChoice === (m[1] === 'heavily' ? 'heavy' : 'light');
  }
  if (o.heritageNames?.[p]) return o.heritage === o.heritageNames[p];
  return null;
}

/**
 * Trend to Arcana (Lore): "Whenever you or any allies roll 1D10 or 2D6 (or multiples of either of these dice) within 30ft
 * of you, they roll 1D12 instead. Whenever an enemy would roll 2D6 or 2D8, they roll 1D12 instead." Rewrites a formula's
 * dice for an `ally` or an `enemy` roller (XD10 → XD12; 2XD6 → XD12; for enemies 2XD6 / 2XD8 → XD12).
 * @param {string} formula
 * @param {'ally'|'enemy'|''} side
 * @returns {string}
 */
export function trendToArcana(formula, side) {
  if (!side) return formula;
  return String(formula).replace(/(\d*)d(\d+)\b/gi, (all, c, d) => {
    const n = Number(c || 1);
    const die = Number(d);
    if (side === 'ally' && die === 10) return `${n}d12`;
    if (die === 6 && n % 2 === 0) return `${n / 2}d12`;
    if (side === 'enemy' && die === 8 && n % 2 === 0) return `${n / 2}d12`;
    return all;
  });
}

/**
 * Advantage a creature gets on its checks against a Physical Effect another creature tries to give it (book p.225):
 * one step per size it's bigger than the giver (negative when smaller), capped at ±3.
 * @param {number} saverSize  index into CONFIG.SACADIA.sizes
 * @param {number} giverSize
 * @returns {number}
 */
export function sizeAdvantage(saverSize, giverSize) {
  if (!Number.isFinite(saverSize) || !Number.isFinite(giverSize)) return 0;
  return Math.max(-3, Math.min(3, saverSize - giverSize));
}

/**
 * Normalize a free-text damage type ("Bludgeon", "Slashing", "Fire damage") to a `damageTypes` key, or '' when untyped.
 * @param {string} text
 * @param {Record<string, object>} types  CONFIG.SACADIA.damageTypes
 * @returns {string}
 */
export function normalizeDamageType(text, types) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return '';
  if (types?.[t]) return t;
  const aliases = { bludgeon: 'bludgeoning', blunt: 'bludgeoning', slash: 'slashing', pierce: 'piercing', psychic: 'mental' };
  const word = t.split(/[\s,]+/)[0];
  if (aliases[word]) return aliases[word];
  return Object.keys(types ?? {}).find((k) => word.startsWith(k) || k.startsWith(word)) ?? '';
}

/**
 * Parse a resistance list ("physical 2, fire 5, rot immune, mental -2") into `{key: n}` — keys are damage types,
 * groups (physical / elemental / mental) or `all`; "immune" is a very large number and a negative value a vulnerability.
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parseResistances(text) {
  const out = {};
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const m = /^\s*([a-z]+)\s*:?\s*(immune|[+-]?\d+)\s*$/i.exec(part);
    if (!m) continue;
    const key = m[1].toLowerCase();
    out[key] = (out[key] ?? 0) + (m[2].toLowerCase() === 'immune' ? 999 : Number(m[2]));
  }
  return out;
}

/**
 * The typed DR that applies to damage of `type`: its own entry, its group's, and `all`. Untyped damage only meets `all`.
 * Elemental damage never meets physical resistance (it "overcomes physical weapon resistances").
 * @param {Record<string, number>} resist  from {@link parseResistances} (plus any derived entries)
 * @param {string} type  a damageTypes key, or ''
 * @param {Record<string, {group: string}>} types
 * @returns {number}
 */
export function typedResistance(resist, type, types) {
  if (!resist) return 0;
  const group = types?.[type]?.group ?? '';
  let n = resist.all ?? 0;
  if (type && resist[type]) n += resist[type];
  if (group && group !== type && resist[group]) n += resist[group];
  return n;
}

/**
 * Split post-DR damage across the Temp-HP buffer and real HP (book p.223 — Temp HP absorbs first).
 * Returns the resulting *absolute* pools, so the chat-card apply buttons stay idempotent.
 * @param {number} hp    real HP before the hit
 * @param {number} temp  temp HP before the hit
 * @param {number} dmg   damage after DR
 * @returns {{value: number, temp: number}}
 */
export function poolsAfterDamage(hp, temp, dmg) {
  const absorbed = Math.min(temp ?? 0, dmg ?? 0);
  // HP keeps falling below 0 (book p.230: "damage taken beyond that limit is still applied") — below 0 a
  // creature is Wounded, and it dies at −½ its max HP (see deathThreshold).
  return { temp: (temp ?? 0) - absorbed, value: (hp ?? 0) - ((dmg ?? 0) - absorbed) };
}

/**
 * The HP at or below which a creature dies (book p.230): negative half its max HP, rounded toward zero
 * (max 60 → −30; max 59 → −29).
 */
export function deathThreshold(maxHp) {
  return -Math.trunc((maxHp ?? 0) / 2);
}

/**
 * Sum a set of pending-attack buffs (one-shot bonuses that ride the next attack) into flat sinks the
 * roll applies, plus the "treat the target as …" conditions and human-readable receipts.
 * @param {Array<{advantage?:number,toHit?:number,damage?:number,dieStep?:number,targetCondition?:string,label?:string}>} buffs
 * @returns {{advantage:number,toHit:number,damage:number,dieStep:number,conditions:string[],notes:string[]}}
 */
export function foldPendingAttack(buffs) {
  const out = { advantage: 0, toHit: 0, damage: 0, dieStep: 0, conditions: [], notes: [] };
  for (const b of buffs ?? []) {
    out.advantage += b.advantage ?? 0;
    out.toHit += b.toHit ?? 0;
    out.damage += b.damage ?? 0;
    out.dieStep += b.dieStep ?? 0;
    if (b.targetCondition) out.conditions.push(b.targetCondition);
    if (b.label) out.notes.push(b.label);
  }
  return out;
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
 * A predicate's atoms as strings: entries may be strings or the schema's `{atom}` objects; blanks are dropped.
 * @param {(string|{atom: string})[]} predicate
 * @returns {string[]}
 */
export function predicateAtoms(predicate) {
  return (predicate ?? []).map((p) => p?.atom ?? p).filter((a) => typeof a === 'string' && a);
}

/**
 * A predicate holds when **every** atom holds (logical AND). An empty/absent predicate is
 * unconditional (always true). Atoms may be strings or the schema's `{atom}` entries.
 * @param {(string|{atom: string})[]} atoms
 * @param {Record<string, number|string|boolean>} options
 * @returns {boolean}
 */
export function evaluatePredicate(atoms, options = {}) {
  const list = predicateAtoms(atoms);
  if (!list.length) return true;
  return list.every((atom) => matchesAtom(atom, options));
}

/**
 * Whether a conditional modifier must be evaluated at **roll time** rather than folded into derived
 * data at prep time. Roll-time facts aren't known when the actor's data is prepared: the current
 * target (`target:*` atoms), the weapon bound to *this* attack (`self:attack:*`), the actor's live
 * positional state (`self:surrounded`), or a value that scales by a positional count (`@adjacent…`,
 * counted from token geometry at use). The prep-fold skips these; the sheet's roll-time fold includes
 * exactly these — the two must agree, so both call this one predicate.
 * @param {{predicate?: any[], value?: string|number}} mod
 * @returns {boolean}
 */
export function modifierIsRollTime(mod) {
  // Targets that only ever apply at the moment of a specific roll: a save the caster forces
  // (`saveAdvantage` / `saveDc`), or an attack coming *in* at the owner (`incomingAdvantage`).
  if (['saveAdvantage', 'saveDc', 'incomingAdvantage', 'incomingDr', 'checkDcVs', 'resistAdvantage', 'resistBonus'].includes(mod?.target)) return true;
  const atoms = predicateAtoms(mod?.predicate);
  const rollTimeAtom = (a) => {
    const b = String(a).replace(/^!/, '');
    return b.startsWith('target:') || b.startsWith('self:attack:') || b === 'self:surrounded'
      || b.startsWith('inflict:') || b.startsWith('attack:');
  };
  return atoms.some(rollTimeAtom) || /@(adjacent|inflict\.|target\.|targetAdjacent|combat\.enemies)/i.test(String(mod?.value ?? ''));
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
