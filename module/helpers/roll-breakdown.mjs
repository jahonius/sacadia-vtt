/**
 * Where an actor's standing roll modifiers come from, for the roll prompt and the check card: the advantage on a roll
 * type (`trait` for checks, `toHit` for attacks) and the flat bonuses (the Trait-check bonus, an attack's to-hit), each
 * with its source. The actor's totals don't keep their sources, so they're re-derived from the three places that fill
 * them — leveled conditions (base-actor `_applyConditionEffects`), Active Effects, and the owned abilities' qualifying
 * modifiers (`activeModifiers`, from `_prepareModifiers`). Anything the three don't account for is shown as one
 * "Other effects" line, so the lines always add up to what the roll uses.
 */

const loc = (k) => game.i18n.localize(k);
const GLOBAL = new Set(['all', 'melee', 'ranged', 'magic']);

/** The rest of `total` not covered by `lines` (`key` is the number field), as a labeled line; none when they agree. */
function remainder(lines, total, key) {
  const sum = lines.reduce((a, l) => a + l[key], 0);
  return total !== sum ? [{ label: loc('SACADIA.Roll.OtherEffects'), [key]: total - sum }] : [];
}

/**
 * The standing advantage (n > 0) and disadvantage (n < 0) on a roll type, by source: [{ label, n }].
 * @param {Actor} actor
 * @param {'trait'|'toHit'} rollType
 */
export function standingAdvantage(actor, rollType) {
  const sys = actor.system;
  const lines = [];
  for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
    const level = Math.min(sys.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
    if (!level || sys._conditionIgnored?.(key) || (sys.bonuses?.tonic?.[key] ?? 0) > 0) continue;
    for (const eff of cfg.effects ?? []) {
      if (eff.type === 'disadvantage' && eff.target === rollType) lines.push({ label: `${loc(cfg.label)} ${level}`, n: -eff.perLevel * level });
    }
  }
  for (const e of actor.appliedEffects ?? []) {
    if (e.disabled) continue;
    for (const c of e.changes ?? []) {
      const v = Number(c.value) || 0;
      if (c.key === `system.advantage.${rollType}`) lines.push({ label: e.name, n: v });
      else if (c.key === `system.disadvantage.${rollType}`) lines.push({ label: e.name, n: -v });
    }
  }
  for (const m of sys.activeModifiers ?? []) {
    if (m.target === `advantage.${rollType}`) lines.push({ label: m.label, n: Number(m.value) || 0 });
  }
  const total = (sys.advantage?.[rollType] ?? 0) - (sys.disadvantage?.[rollType] ?? 0);
  return [...lines, ...remainder(lines, total, 'n')].filter((l) => l.n);
}

/** The flat bonus to Trait Checks (`bonuses.trait`, read as `@traitBonus`), by source: [{ label, value }]. */
export function traitBonusParts(actor) {
  const sys = actor.system;
  const lines = [];
  for (const e of actor.appliedEffects ?? []) {
    if (e.disabled) continue;
    for (const c of e.changes ?? []) if (c.key === 'system.bonuses.trait') lines.push({ label: e.name, value: Number(c.value) || 0 });
  }
  for (const m of sys.activeModifiers ?? []) if (m.target === 'trait') lines.push({ label: m.label, value: Number(m.value) || 0 });
  return [...lines, ...remainder(lines, sys.bonuses?.trait ?? 0, 'value')].filter((l) => l.value);
}

/**
 * The flat to-hit bonus an attack of this category gets before its target is known (the `all` and category buckets, and
 * this ability's own), by source: [{ label, value }].
 * @param {Actor} actor
 * @param {string} category   melee / ranged / magic ('' for none)
 * @param {string} catalogId  the ability's id (its own to-hit bonus)
 */
export function toHitParts(actor, category, catalogId) {
  const sys = actor.system;
  const keys = new Set(['system.bonuses.toHit.all', ...(category ? [`system.bonuses.toHit.${category}`] : [])]);
  const lines = [];
  for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
    const level = Math.min(sys.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
    if (!level || sys._conditionIgnored?.(key) || (sys.bonuses?.tonic?.[key] ?? 0) > 0) continue;
    for (const eff of cfg.effects ?? []) {
      if (eff.type === 'bonus' && (eff.target === 'toHit.all' || (category && eff.target === `toHit.${category}`))) {
        lines.push({ label: `${loc(cfg.label)} ${level}`, value: eff.perLevel * level });
      }
    }
  }
  for (const e of actor.appliedEffects ?? []) {
    if (e.disabled) continue;
    for (const c of e.changes ?? []) if (keys.has(c.key)) lines.push({ label: e.name, value: Number(c.value) || 0 });
  }
  for (const m of sys.activeModifiers ?? []) {
    if (m.target !== 'toHit') continue;
    if (m.scope === 'all' || m.scope === category || (m.scope === catalogId && !GLOBAL.has(m.scope))) lines.push({ label: m.label, value: Number(m.value) || 0 });
  }
  const total = (sys.bonuses?.toHit?.all ?? 0) + (category ? (sys.bonuses?.toHit?.[category] ?? 0) : 0) + (sys.abilityToHit?.[catalogId] ?? 0);
  return [...lines, ...remainder(lines, total, 'value')].filter((l) => l.value);
}
