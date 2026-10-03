/**
 * Prestige-profession runtime (Magus / Witch, SAoW Prestige Classes addendum): the mechanics that don't fit the generic
 * activity / grant / save-extension pipeline — shared damage (Law of Alliance), Death Ward, Armor of Itthoa, Catnap,
 * Crown of Insanity, Hallow's Calm / Gale Madness, Tempered Aura, Hemorrhage bursts and live Hemorrhage upgrades, and
 * the ends of Focus-tied effects (Poured Mold, Winter Frost). Foundry globals are only touched inside functions.
 */
import { deleteKey } from './update-ops.mjs';
import { syncFocus } from './focus.mjs';
import { stepDie } from './derivation.mjs';
import { actorToken, hallowsMadnessDelta, temperedAuraImmune } from './auras.mjs';
import { ownsAbility, maintainsFocus, completionist, gmNote } from './actor-utils.mjs';
import { applyConditionDeltas } from './conditions.mjs';

const actorOf = async (uuid) => { const d = uuid ? await fromUuid(uuid) : null; return d?.actor ?? d; };
const owns = ownsAbility;
const checkDcOf = (a) => { const cd = a?.system?.checkDc; return (typeof cd === 'number' ? cd : cd?.primary) ?? 10; };
const sceneActors = () => Array.from(new Set((globalThis.canvas?.tokens?.placeables ?? []).map((t) => t.actor).filter(Boolean)));
const tokenUuid = (a) => actorToken(a)?.document?.uuid ?? a?.uuid;
const isGM = () => game.users.activeGM === game.user;

/** The effects on `actor` granted by `ability` (optionally from one caster). */
export function grantsFrom(actor, ability, casterUuid = null) {
  return (actor?.effects ?? []).filter((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    return gb?.ability === ability && (!casterUuid || gb.casterUuid === casterUuid);
  });
}

/* -------------------------------------------- */
/*  Hemorrhage                                  */
/* -------------------------------------------- */

/**
 * Die-steps on Hemorrhage given by `giver`, read now (decision: upgrades are evaluated when Hemorrhage deals damage):
 * Mastery of Hemorrhage, Bloodthinner, Bleeding Expert (while Multiplicity is maintained with Completionist), and
 * Bleeding Bane (+ Greater Bleed) while the Witch holds it on the giver (`bonuses.hemorrhageSteps`).
 */
export function giverHemorrhageSteps(giver) {
  let steps = 0;
  if (owns(giver, 'mastery_hemorrhage')) steps += 1;
  if (owns(giver, 'mg_bloodthinner')) steps += 1;
  const n = giver.system?._modifierNumbers?.() ?? {};
  if (owns(giver, 'bd_bleeding_expert') && maintainsFocus(giver, 'bd_multiplicity') && completionist(n)) steps += 1;
  steps += giver.system?.bonuses?.hemorrhageSteps ?? 0;
  return steps;
}

/** A turn-damage condition's die-steps: Hemorrhage reads its giver live, falling back to the steps recorded when given. */
export async function turnDamageSteps(actor, key) {
  const src = actor.system.conditions?.[key]?.source ?? {};
  const recorded = src.dieSteps ?? 0;
  if (key !== 'hemorrhage' || !src.casterUuid) return recorded;
  const giver = await actorOf(src.casterUuid);
  return giver ? giverHemorrhageSteps(giver) : recorded;
}

/** Roll a turn-damage condition at `level` (Hemorrhage: level × d10, its die stepped). Returns the evaluated Roll. */
export async function rollTurnDamage(actor, key, level) {
  const dmg = CONFIG.SACADIA.conditions[key]?.effects?.find((e) => e.type === 'turnDamage');
  if (!dmg || !level) return null;
  const steps = await turnDamageSteps(actor, key);
  const [, den] = /d(\d+)/.exec(dmg.perLevelDice) ?? [];
  const die = steps && den ? stepDie('1', Number(den), steps, CONFIG.SACADIA.diceLadder) : null;
  const formula = die ? `${level * Number(die.count)}d${die.denomination}` : `${level}${dmg.perLevelDice.replace(/^\d+/, '')}`;
  return new Roll(formula).evaluate();
}

/**
 * Trigger a target's Hemorrhage now (GM-side): Vampiric Siphon and Touch the Flame deal Hemorrhage damage for its
 * current level and then remove one level; Into Fire repeats that once per extra AP. Vampiric Siphon's caster gains
 * half the damage rolled as temp HP (`drain`).
 */
export async function hemorrhageBurst(target, { triggers = 1, drain = 0, casterUuid = '', label = '' } = {}) {
  let total = 0;
  const parts = [];
  const rolls = [];
  let level = target.system.conditions?.hemorrhage?.value ?? 0;
  for (let i = 0; i < Math.max(1, triggers) && level > 0; i++) {
    const r = await rollTurnDamage(target, 'hemorrhage', level);
    if (r) { rolls.push(r); total += r.total; parts.push(`${r.formula} = ${r.total}`); }
    level -= 1;
  }
  if (!rolls.length) return gmNote(game.i18n.format('SACADIA.Prestige.NoHemorrhage', { name: target.name }));
  await target.update({ 'system.health.value': (target.system.health?.value ?? 0) - total, 'system.conditions.hemorrhage.value': level,
    'system.combatState.tookDamage': true });
  let text = game.i18n.format('SACADIA.Prestige.Burst', { label, name: target.name, total, parts: parts.join(', '), level });
  if (drain > 0 && casterUuid) {
    const caster = await actorOf(casterUuid);
    const gain = Math.floor(total * drain);
    if (caster && gain > 0) {
      await caster.update({ 'system.health.temp': Math.max(caster.system.health?.temp ?? 0, gain) });
      text += ` · ${game.i18n.format('SACADIA.Save.Drain', { amount: gain })}`;
    }
  }
  await ChatMessage.create({ content: `<div class="sacadia">${text}</div>`, rolls });
}

/* -------------------------------------------- */
/*  Damage seams                                */
/* -------------------------------------------- */

/**
 * preUpdateActor (every client): HP-loss rules that must change the update itself.
 *  - Death Ward: "The next time they would drop to 0HP or below, they drop to 1HP instead, and your Focus ends."
 *  - Law of Alliance / Greater Alliance: damage to any bound creature is split across the caster and everyone bound
 *    (the caster takes indivisible points); this creature keeps its share, the rest goes to the GM to apply.
 * Records the pre-update pools on `options.sacadiaHp` for the post-update checks.
 */
export function prestigePreUpdate(actor, changes, options) {
  const h = changes?.system?.health;
  if (!h || (!('value' in h) && !('temp' in h))) return;
  const before = { value: actor.system.health?.value ?? 0, temp: actor.system.health?.temp ?? 0 };
  options.sacadiaHp = before;
  let value = 'value' in h ? h.value : before.value;
  const temp = 'temp' in h ? h.temp : before.temp;
  const loss = (before.value + before.temp) - (value + temp);
  if (loss <= 0) return;
  // Law of Alliance: split the loss among the bound.
  if (!options.sacadiaAlliance) {
    const circle = allianceCircle(actor);
    if (circle && circle.members.length > 1) {
      const n = circle.members.length;
      const each = Math.floor(loss / n);
      const extra = loss - each * n;
      const mine = each + (circle.casterUuid === actor.uuid ? extra : 0);
      const keepLoss = Math.min(loss, mine);
      // Recompute this creature's pools for its share (temp HP first).
      const pool = before.value + before.temp - keepLoss;
      const newTemp = Math.max(0, before.temp - keepLoss);
      h.temp = newTemp;
      h.value = Math.min(before.value, pool - newTemp);
      value = h.value;
      const others = circle.members.filter((m) => m.uuid !== actor.uuid)
        .map((m) => ({ uuid: m.uuid, amount: each + (m.uuid === circle.casterUuid ? extra : 0) })).filter((m) => m.amount > 0);
      if (others.length) gmNote(game.i18n.format('SACADIA.Prestige.AllianceSplit', { name: actor.name, loss, n }), { allianceShare: { entries: others } });
      // Remembered so a post-roll option that turns this hit aside can refund the shares (restoreHitSnapshot).
      foundry.utils.setProperty(changes, 'flags.sacadia.lastAllianceShare', { entries: others });
    }
  }
  // Death Ward.
  if (value <= 0 && before.value > 0) {
    const ward = grantsFrom(actor, 'mg_death_ward')[0];
    if (ward) {
      h.value = 1;
      gmNote(game.i18n.format('SACADIA.Prestige.DeathWard', { name: actor.name }), { endFocus: { casterUuid: ward.flags.sacadia.grantedBy.casterUuid, ability: 'mg_death_ward' } });
    }
  }
}

/** The Law of Alliance circle this actor belongs to: `{casterUuid, members:[actor]}`, or null. */
function allianceCircle(actor) {
  const ids = ['mg_law_of_alliance'];
  // Bound by someone else's Law?
  const bound = actor.effects.find((e) => ids.includes(e.flags?.sacadia?.grantedBy?.ability));
  const casterUuid = bound ? bound.flags.sacadia.grantedBy.casterUuid
    : (actor.effects.some((e) => ids.includes(e.flags?.sacadia?.anchor?.ability)) ? actor.uuid : null);
  if (!casterUuid) return null;
  const members = sceneActors().filter((a) => a.uuid === casterUuid || grantsFrom(a, 'mg_law_of_alliance', casterUuid).length);
  if (!members.some((a) => a.uuid === casterUuid)) return null; // the caster isn't on the scene
  return { casterUuid, members };
}

/** GM: apply the other members' alliance shares (no DR — it already applied to the whole hit, book p.192). */
export async function applyAllianceShare({ entries }) {
  for (const { uuid, amount } of entries ?? []) {
    const a = await actorOf(uuid);
    if (!a || !(amount > 0)) continue;
    const temp = a.system.health?.temp ?? 0;
    const fromTemp = Math.min(temp, amount);
    await a.update({ 'system.health.temp': temp - fromTemp, 'system.health.value': (a.system.health?.value ?? 0) - (amount - fromTemp),
      'system.combatState.tookDamage': true }, { sacadiaAlliance: true });
  }
}

/**
 * GM: end a caster's Focus on an ability (Death Ward triggering, Mimicked Caw): drop its counter, then syncFocus deletes its
 * anchor (reaping its grants), its zone and its mark.
 */
export async function endFocus({ casterUuid, ability }) {
  const caster = await actorOf(casterUuid);
  if (!caster) return;
  if (ability in (caster.system.combatState?.focusRounds ?? {})) await caster.update({ [`system.combatState.focusRounds.${ability}`]: deleteKey() });
  await syncFocus(caster);
}

/**
 * updateActor (GM): after HP loss — Catnap's sleepers wake ("until they take any damage"); Armor of Itthoa is handled at
 * the hit (it needs the attacker).
 */
export async function prestigePostUpdate(actor, options) {
  if (!isGM() || !options?.sacadiaHp) return;
  const b = options.sacadiaHp;
  const lost = (b.value + b.temp) - ((actor.system.health?.value ?? 0) + (actor.system.health?.temp ?? 0));
  if (lost <= 0) return;
  const naps = grantsFrom(actor, 'mg_catnap');
  if (naps.length) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', naps.map((e) => e.id));
    await gmNote(game.i18n.format('SACADIA.Prestige.CatnapWake', { name: actor.name }));
  }
}

/**
 * GM, after a resolved hit: Armor of Itthoa ("Whenever a target deals damage to you and that damage reduces your
 * Temporary HP, the target takes damage equal to the Temporary HP you lose").
 */
export async function afterHit(target, attacker, { tempBefore = 0, tempAfter = 0 } = {}) {
  const lostTemp = tempBefore - tempAfter;
  if (lostTemp > 0 && attacker && grantsFrom(target, 'mg_armor_of_itthoa').length) {
    const hp = attacker.system.health?.value ?? 0;
    await attacker.update({ 'system.health.value': hp - lostTemp, 'system.combatState.tookDamage': true });
    await gmNote(game.i18n.format('SACADIA.Prestige.Itthoa', { name: target.name, attacker: attacker.name, n: lostTemp }));
  }
}

/* -------------------------------------------- */
/*  Turn boundaries                             */
/* -------------------------------------------- */

/** GM, at a creature's turn start: Hallow's Calm / Gale Madness, Crown of Insanity, Call of the Quick Blade's reach. */
export async function prestigeTurnStart(actor) {
  // Call of the Quick Blade: "If any ally moves outside the aura radius, the effect ends for them for the duration of the
  // call" (15ft; Legendary Group doubles call auras).
  for (const e of grantsFrom(actor, 'call_of_the_quick_blade')) {
    const caster = await actorOf(e.flags.sacadia.grantedBy.casterUuid);
    const r = owns(caster, 'legendary_group') ? 30 : 15;
    const a = actorToken(actor); const c = actorToken(caster);
    const d = a && c && globalThis.canvas?.grid ? canvas.grid.measurePath([a.center, c.center])?.distance : null;
    if (d != null && d > r) await actor.deleteEmbeddedDocuments('ActiveEffect', [e.id]);
  }
  // "any Oracles who start their turn within this aura lose (gain) 1 Madness at the start of each turn."
  if ((actor.system._professionKeys?.() ?? []).includes('oracle') || actor.items.some((i) => i.system?.meta?.profession === 'oracle')) {
    const delta = hallowsMadnessDelta(actor);
    if (delta) {
      const cur = actor.system.conditions?.madness?.value ?? 0;
      const next = Math.max(0, Math.min(6, cur + delta));
      if (next !== cur) {
        await actor.update({ 'system.conditions.madness.value': next });
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Prestige.HallowMadness', { name: actor.name, delta: delta > 0 ? `+${delta}` : delta, next })}</div>` });
      }
    }
  }
  // Crown of Insanity: "at the start of each of their turns that you maintain Focus, the target takes 2D8 damage. They
  // then apply the effect from the Oracle Insane Table (minus the damage) that corresponds to the lower of the two dice."
  const crowns = grantsFrom(actor, 'mg_crown_of_insanity').length; // one per Magus holding it on this creature
  for (let i = 0; i < crowns; i++) {
    const r = await new Roll('2d8').evaluate();
    const [a, b] = r.dice[0].results.map((x) => x.result);
    const low = Math.min(a, b);
    await actor.update({ 'system.health.value': (actor.system.health?.value ?? 0) - r.total, 'system.combatState.tookDamage': true });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [r],
      content: `<div class="sacadia">${game.i18n.format('SACADIA.Prestige.Crown', { name: actor.name, total: r.total, low,
        effect: game.i18n.localize(`SACADIA.Insane.Effect${low}`) })}</div>` });
  }
}

/**
 * GM, at a creature's turn end: Catnap — "At the end of each turn in which they remain unconscious, they make a Fate
 * Check against your Check DC, ending the effect on a success" (at 1× disadvantage with Deeper Napping).
 */
export async function prestigeTurnEnd(actor) {
  for (const e of grantsFrom(actor, 'mg_catnap')) {
    const caster = await actorOf(e.flags.sacadia.grantedBy.casterUuid);
    if (!caster) continue;
    const dc = checkDcOf(caster);
    const adv = owns(caster, 'mg_deeper_napping') ? -1 : 0;
    const ext = foundry.utils.escapeHTML(JSON.stringify({ onSuccess: { endGrant: { ability: 'mg_catnap', casterUuid: caster.uuid } } }));
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sacadia">${game.i18n.format('SACADIA.Prestige.CatnapCheck', { name: actor.name })}`
        + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="fate" data-dc="${dc}" data-adv="${adv}" data-onsuccess="none"`
        + ` data-casterpc="${caster.type === 'character' ? 1 : 0}" data-caster="${caster.uuid}" data-ext="${ext}">`
        + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · ${game.i18n.localize('SACADIA.Stat.Fate')})</button></div></div>` });
  }
}

/* -------------------------------------------- */
/*  Auras and Focus-tied effects                */
/* -------------------------------------------- */

/**
 * Tempered Aura: "If they have Panic or Taunt, they lose all levels when they enter the aura." GM-side sweep after any
 * token moves (or the Witch initiates it): everyone inside an active Tempered Aura sheds Panic and Taunt.
 */
export async function temperedAuraSweep() {
  if (!isGM()) return;
  for (const a of sceneActors()) {
    const upd = {};
    for (const k of ['panic', 'taunt']) {
      if ((a.system.conditions?.[k]?.value ?? 0) > 0 && temperedAuraImmune(a, k)) upd[`system.conditions.${k}.value`] = 0;
    }
    if (Object.keys(upd).length) {
      await a.update(upd);
      await gmNote(game.i18n.format('SACADIA.Prestige.Tempered', { name: a.name }));
    }
  }
}

/**
 * A Focus anchor was deleted (GM) — the Focus truly ended. Its `onEnd` (set by applyGrant) hits each recipient: Poured
 * Mold — "if you drop Focus, they lose all levels of that condition"; Winter Frost — the condition stops being
 * Enduring; Armor of Itthoa — "If you drop Focus, lose all Temporary HP immediately".
 */
export async function onAnchorEnded(anchor) {
  const end = anchor.flags?.sacadia?.onEnd;
  if (!isGM() || !end) return;
  for (const uuid of end.targets ?? []) {
    const actor = await actorOf(uuid);
    if (!actor) continue;
    const upd = {};
    for (const k of end.clear ?? []) if ((actor.system.conditions?.[k]?.value ?? 0) > 0) upd[`system.conditions.${k}.value`] = 0;
    for (const k of end.unEndure ?? []) if (actor.system.conditions?.[k]?.enduring) upd[`system.conditions.${k}.enduring`] = false;
    if (end.clearTemp && (actor.system.health?.temp ?? 0) > 0) upd['system.health.temp'] = 0;
    if (Object.keys(upd).length) {
      await actor.update(upd);
      await gmNote(game.i18n.format('SACADIA.Prestige.FocusEnded', { label: anchor.name, name: actor.name }));
    }
  }
  // Guard Them: "When you lose Focus on Guard Them, gain one Fatigue." Your own, so it stacks (immunities still hold).
  if (end.casterFatigue && anchor.parent?.documentName === 'Actor') {
    await applyConditionDeltas(anchor.parent, [{ condition: 'fatigue', amount: end.casterFatigue, self: true }]);
  }
}

/** Token uuids for a list of actors (used by the sheet's renew checks). */
export const tokenUuids = (actors) => actors.map(tokenUuid);
