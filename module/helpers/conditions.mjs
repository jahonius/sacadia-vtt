/**
 * Applying condition changes to an actor — shared by the owner-side (a caster's own `onUse.self`) and
 * GM-side (targets of `onUse.target`, via the card flag) paths so both follow the same book rules.
 * Runtime (reads CONFIG + world settings), not pure.
 */

import { availableCheckSpends } from './check-pool.mjs';
import { replaceWith } from './update-ops.mjs';
import { resolveModifierValue, poolsAfterDamage } from './derivation.mjs';
import { witchPresenceImmune, temperedAuraImmune } from './auras.mjs';
import { ownsAbility, completionist, confirmWarn } from './actor-utils.mjs';

/**
 * Whether an attempt to give `condition` to `actor` proceeds under the stacking rule (book p.258): a
 * creature that already has the condition can't be given it again — unless the attempt explicitly stacks
 * (`stacks`, e.g. Sphere Insanium "even if they already have Delirium"), the condition is inherently
 * cumulative (Rend on armor, Madness), or the world uses additive stacking. A condition you give yourself (`self`:
 * Remaneuver's Sting, Rage's and Insanity's Fatigue) always stacks onto the levels you have (designer's ruling).
 */
export function conditionAttemptAllowed(actor, condition, stacks = false, { self = false } = {}) {
  if (conditionImmune(actor, condition, { self })) return false;
  if (stacks || self || ['rended', 'madness'].includes(condition)) return true;
  if (condition in CONFIG.SACADIA.simpleConditions) return true;
  if (game.settings.get('sacadia', 'conditionStacking') === 'additive') return true;
  const cur = actor.system.conditions?.[condition]?.value ?? 0;
  // Poured Mold (Witch): "your chosen condition is treated as Stacking up to your Proficiency" while the Focus holds.
  if (cur > 0 && cur < stackingCap(actor, condition)) return true;
  return cur === 0;
}

/** A Focus-granted stacking ceiling for a held condition (Poured Mold), or 0 when it doesn't stack. */
export function stackingCap(actor, condition) {
  return actor.system?.bonuses?.stackingCap?.[condition] ?? 0;
}

/**
 * Whether the actor is immune to a condition: We Don't Hibernate (Fatigue, from any source) and
 * Caffeinated (the condition it picked from Not Even Impressed). `self`: the actor is giving it to itself, so an
 * immunity to enemy effects (Endurance Mastery) doesn't apply.
 */
export function conditionImmune(actor, condition, { self = false } = {}) {
  const owns = (id) => ownsAbility(actor, id);
  if (condition === 'fatigue' && owns('we_don_t_hibernate')) return true;
  // Mastery of Energy (Bladedancer Legendary): immune to Fatigue and Slowed. Endurance Mastery (Thug
  // Legendary): immune to Fatigue from enemy effects (every save-applied Fatigue is an enemy's).
  if ((condition === 'fatigue' || condition === 'slowed') && owns('legendary_energy')) return true;
  if (condition === 'fatigue' && !self && owns('legendary_endurance')) return true;
  // Granted immunity (Heroism → Panic) via the `bonuses.immune.<condition>` sink.
  if ((actor.system?.bonuses?.immune?.[condition] ?? 0) > 0) return true;
  // Blood Tome (Magus): "You are immune to Hemorrhage if you are attuned to this tome."
  if (condition === 'hemorrhage' && owns('mg_blood_tome')) return true;
  // Saptouched (Warped ancestry): "You are immune to the Pin condition."
  if (condition === 'pinned' && owns('lore_saptouched')) return true;
  // Meditative Will (Cunei): "You are immune to Frenzy."
  if (condition === 'frenzy' && owns('cunei_meditative_will')) return true;
  // Witch's Presence (party-wide) and Tempered Aura (Panic / Taunt within the aura).
  if (witchPresenceImmune(actor, condition) || temperedAuraImmune(actor, condition)) return true;
  return (actor.system._picks?.().condition ?? []).some((p) => p.id === 'bd_caffeinated' && p.value === condition);
}

const GROUPS = {
  '*adversarial': () => true,
  '*mental': (g) => /mental/i.test(g),
  '*physical': (g) => /physical/i.test(g),
};

/**
 * Apply condition deltas: positive `amount` gives levels (under the stacking rule), negative removes them.
 * Group wildcards (`*adversarial`, `*mental`, `*physical`) touch every held leveled condition in the group
 * (Madness excluded — its own track). Simple conditions toggle as token statuses.
 * @param {Actor} actor
 * @param {{condition:string, amount:number, stacks?:boolean, self?:boolean}[]} entries
 * @returns {Promise<string[]>} short receipts ("Hemorrhage 2", "−1 all mental")
 */
export async function applyConditionDeltas(actor, entries, { source: sourceOpt = null } = {}) {
  const cap = CONFIG.SACADIA.conditionStoreMax;
  const upd = {};
  const notes = [];
  const label = (k) => game.i18n.localize(CONFIG.SACADIA.conditions[k]?.label ?? CONFIG.SACADIA.simpleConditions[k]?.label ?? k);
  // Same-condition gains in one call are one attempt (book p.258) — summed, not applied twice (and not left
  // to overwrite each other against the pre-update value).
  const merged = [];
  for (const e of entries ?? []) {
    const prior = e.amount > 0 && !GROUPS[e.condition] ? merged.find((m) => m.condition === e.condition && m.amount > 0) : null;
    if (prior) { prior.amount += e.amount; prior.stacks ||= e.stacks; prior.self ||= e.self; } else merged.push({ ...e });
  }
  for (const { condition, amount, stacks: stacksOpt, self, source: entrySource } of merged) {
    // A condition you give yourself stacks (see conditionAttemptAllowed).
    const stacks = stacksOpt || self;
    const source = entrySource ?? sourceOpt;
    if (!amount) continue;
    if (GROUPS[condition]) {
      for (const [k, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
        if (k === 'madness' || !GROUPS[condition](cfg.group ?? '')) continue;
        const cur = actor.system.conditions?.[k]?.value ?? 0;
        // Group wildcards only ever *reduce* held conditions — a group increase would stack onto held ones.
        if (cur > 0 && amount < 0) upd[`system.conditions.${k}.value`] = Math.max(0, cur + amount);
      }
      notes.push(`${amount > 0 ? '+' : ''}${amount} ${condition.slice(1)}`);
      continue;
    }
    if (condition in CONFIG.SACADIA.simpleConditions) {
      await actor.toggleStatusEffect(condition, { active: amount > 0 });
      notes.push(`${amount > 0 ? '' : '−'}${label(condition)}`);
      continue;
    }
    const cur = actor.system.conditions?.[condition]?.value ?? 0;
    if (amount > 0 && !conditionAttemptAllowed(actor, condition, stacks, { self })) continue;
    // A Poured Mold stack stops at its ceiling (unless the gain is explicitly stacking).
    const moldCap = cur > 0 && !stacks && stackingCap(actor, condition) ? Math.max(cur, stackingCap(actor, condition)) : cap;
    const next = Math.max(0, Math.min(condition === 'madness' ? 6 : Math.min(cap, moldCap), cur + amount));
    upd[`system.conditions.${condition}.value`] = next;
    // First application records who gave it (see conditionSource).
    if (cur === 0 && next > 0 && source) upd[`system.conditions.${condition}.source`] = replaceWith(source);
    notes.push(`${label(condition)} ${amount > 0 ? '+' : ''}${amount}`);
  }
  // Rend lands on the giver's preferred armor type first (Rend Armor's choice, Clever Rend).
  const prefer = merged.find((e) => e.condition === 'rended' && e.prefer)?.prefer;
  if (Object.keys(upd).length) await actor.update(upd, prefer ? { sacadiaRendPrefer: prefer } : {});
  return notes;
}


/**
 * Offer the checker's optional paid improvements for this Trait Check (Confidence, Fateful Saves — see
 * CHECK_SPENDS), charge the accepted ones, and return their effect on the roll.
 * @returns {Promise<{adv:number, bonus:number, notes:string[]}>}
 */
export async function promptCheckSpends(actor, options) {
  const owned = new Set(actor.items.filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
  const pools = Object.fromEntries(Object.entries(actor.system.classPools ?? {}).map(([k, v]) => [k, v?.value ?? 0]));
  const restFlags = actor.getFlag('sacadia', 'restFlags') ?? {};
  const out = { adv: 0, bonus: 0, bonusOne: 0, notes: [] };
  const upd = {};
  const reaction = actor.system.reaction?.value ?? 0;
  for (const c of availableCheckSpends({ owned, pools, restFlags, reaction }, options)) {
    const cost = c.cost.pool ? game.i18n.format('SACADIA.CheckSpend.PoolCost', { pool: game.i18n.localize(CONFIG.SACADIA.pools[c.cost.pool] ?? c.cost.pool) })
      : game.i18n.localize('SACADIA.CheckSpend.RestCost');
    const yes = await confirmWarn(c.label, game.i18n.format('SACADIA.CheckSpend.Prompt', { label: c.label, cost }));
    if (!yes) continue;
    if (c.adv) out.adv += c.adv;
    const nums = actor.system._modifierNumbers?.() ?? {};
    if (c.bonus) out.bonus += resolveModifierValue(c.bonus, nums);
    if (c.bonusIfSteadied && options['self:steadied']) out.bonus += resolveModifierValue(c.bonusIfSteadied, nums);
    else if (c.bonusOne) out.bonusOne += resolveModifierValue(c.bonusOne, nums);
    if (c.cost.reaction) upd['system.reaction.value'] = Math.max(0, reaction - 1);
    if (c.cost.pool) upd[`system.classPools.${c.cost.pool}.value`] = Math.max(0, (pools[c.cost.pool] ?? 0) - 1);
    if (c.cost.rest) upd[`flags.sacadia.restFlags.${c.cost.rest}`] = true;
    out.notes.push(c.label);
  }
  if (Object.keys(upd).length) await actor.update(upd);
  return out;
}

/**
 * Merge the inflict entries of one attempt that name the same condition into a single attempt (book p.258: a
 * creature can't be given a condition it already has, so two parts of one action giving the same condition —
 * Jagged Blade's extra Hemorrhage on Artery Strike, a boost's Prone alongside a rider's — are one attempt of
 * their summed levels, not two). Entries that negate on different traits stay separate (they're different
 * checks). Pure.
 * @param {{condition:string, level:number, stacks?:boolean, saveNegate?:string}[]} list
 */
export function mergeInflicts(list) {
  const out = [];
  const byKey = new Map();
  for (const inf of list ?? []) {
    if (!inf?.condition) continue;
    const key = `${inf.condition}|${inf.saveNegate ?? ''}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.level = (hit.level ?? 0) + (inf.level ?? 0);
      if (inf.stacks) hit.stacks = true;
    } else {
      const copy = { ...inf };
      byKey.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}

/**
 * End Hidden: drop the status and the Focus that kept it (Hide Behind Hide: "Focus … immediately ends as soon
 * as you make an attack, impose a trait check against a creature, take damage …").
 */
export async function revealHidden(actor) {
  if (!actor?.statuses?.has('hidden')) return;
  await actor.toggleStatusEffect('hidden', { active: false });
  const fr = { ...(actor.system.combatState?.focusRounds ?? {}) };
  if (fr.hide_behind_hide) {
    delete fr.hide_behind_hide;
    await actor.update({ 'system.combatState.focusRounds': replaceWith(fr) });
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Hidden.Revealed', { name: actor.name })}</div>` });
}

/**
 * The source record for a condition someone gives (stored on the target when it's first given): who, with what
 * ability, and the die-steps their upgrades add to its damage — computed *when given* from the giver's state:
 *  - Hemorrhage: Mastery of Hemorrhage +1 type ("Hemorrhage you give"); Bleeding Expert +1 while the giver maintains
 *    Multiplicity and benefits from Completionist (they've hit every enemy).
 * @param {object} giver  {uuid, name, owned:Set<string>, options:object, numbers:object}
 */
export function conditionSource(giver, condition, ability = '') {
  if (!giver?.uuid) return null;
  let dieSteps = 0;
  if (condition === 'hemorrhage') {
    if (giver.owned?.has('mastery_hemorrhage')) dieSteps += 1;
    if (giver.owned?.has('mg_bloodthinner')) dieSteps += 1;
    // Bleeding Bane (a Witch's Focus on the giver) — recorded as a fallback; the tick reads it live.
    dieSteps += giver.numbers?.hemorrhageSteps ?? 0;
    const n = giver.numbers ?? {};
    if (giver.owned?.has('bd_bleeding_expert') && giver.options?.['self:used:bd_multiplicity'] && completionist(n)) dieSteps += 1;
  }
  return { casterUuid: giver.uuid, name: giver.name ?? '', ability, dieSteps };
}

/**
 * Whether a held condition skips its end-of-turn reduction: this instance is Enduring (Balanced Scale), or it's Pin
 * given through Natural Wrestler while its giver maintains Wrestling Focus.
 */
export async function conditionEndures(actor, key) {
  const c = actor.system.conditions?.[key];
  if (!c?.value) return false;
  if (c.enduring) return true;
  if (key === 'pinned' && c.source?.ability === 'thug_natural_wrestler' && c.source?.casterUuid) {
    const d = await fromUuid(c.source.casterUuid);
    const giver = d?.actor ?? d;
    return !!giver?.items?.some((i) => i.flags?.sacadia?.catalogId === 'thug_wrestling_focus')
      && (giver.system.combatState?.focusRounds?.thug_wrestling_focus ?? 0) > 0;
  }
  return false;
}

/**
 * HP a creature loses to its own effect (Mad Smear, Bloodlet, Pained Bash, Stygian Abyss …). Under Self-Heal (Witch
 * Focus) "any ability they would use or effect they trigger that deals damage to themselves gives them temporary HP
 * instead" — the higher of current and new temp HP (temp HP doesn't stack). Returns 'heal' or 'damage'.
 */
export async function applySelfDamage(actor, dmg) {
  if (!actor || !(dmg > 0)) return 'none';
  const hp = actor.system.health ?? {};
  if ((actor.system.bonuses?.selfHeal ?? 0) > 0) {
    await actor.update({ 'system.health.temp': Math.max(hp.temp ?? 0, dmg) });
    return 'heal';
  }
  const pools = poolsAfterDamage(hp.value ?? 0, hp.temp ?? 0, dmg);
  await actor.update({ 'system.health.value': pools.value, 'system.health.temp': pools.temp });
  return 'damage';
}
