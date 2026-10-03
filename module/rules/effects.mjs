/**
 * GM-side handlers that apply what a card asks for: on-use condition changes, pool and AP gains, banked next-attack
 * buffs, temp HP, revealing hidden creatures, and Exploding Weapon's blast.
 */
import { actorToken, tokenDistance } from '../helpers/actor-utils.mjs';
import { applyConditionDeltas } from '../helpers/conditions.mjs';
import { applyDamageTo } from './damage.mjs';
import { hemorrhageBurst } from '../helpers/prestige.mjs';
import { resolveLimbSlots } from '../helpers/derivation.mjs';

/**
 * Open the Third Eye (GM): "If there are creatures within 5x your Madness in feet of you, you can see them in their true
 * form even if they are disguised, invisible, or hiding. You also learn their creature type." Hidden creatures in reach
 * lose Hidden; their types are whispered.
 */
export async function revealWithin({ casterUuid, within }) {
  const d = await fromUuid(casterUuid);
  const caster = d?.actor ?? d;
  const me = actorToken(caster);
  if (!me) return;
  const seen = [];
  for (const t of canvas?.tokens?.placeables ?? []) {
    if (!t.actor || t === me || (tokenDistance(t, me) ?? Infinity) > within) continue;
    if (t.actor.statuses?.has('hidden')) await t.actor.toggleStatusEffect('hidden', { active: false });
    const type = t.actor.system.creatureType;
    seen.push(`${t.name}${type ? ` (${game.i18n.localize(CONFIG.SACADIA.creatureTypes[type] ?? type)})` : ''}`);
  }
  await ChatMessage.create({ whisper: [...ChatMessage.getWhisperRecipients('GM').map((u) => u.id), ...game.users.filter((u) => caster.testUserPermission(u, 'OWNER')).map((u) => u.id)],
    content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Prestige.ThirdEyeSeen', { list: seen.join(', ') || '—' })}</div>` });
}

/**
 * Exploding Weapon's blast: the weapon's damage on every creature within 5ft of a creature (`center`, which took the
 * throw itself and is skipped) or of a point on the map (`point`, a throw at the ground). GM-side.
 */
export async function explodeAround(attacker, attackerUuid, ex, { center = null, point = null } = {}) {
  const gridFt = canvas?.dimensions?.distance ?? 5;
  const lines = [];
  for (const t of canvas?.tokens?.placeables ?? []) {
    if (!t.actor || t === center) continue;
    let d = center ? tokenDistance(t, center) : null;
    // From a point: the distance to the token's center, less the reach of any squares past its first.
    if (point && canvas?.grid) d = (canvas.grid.measurePath([point, t.center])?.distance ?? Infinity) - ((t.document.width ?? 1) - 1) * gridFt / 2;
    if ((d ?? Infinity) > 5) continue;
    lines.push(await applyDamageTo(t.actor, t.document.uuid, ex.damage, attacker, attackerUuid, { damageType: ex.damageType ?? '' }));
  }
  await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((x) => x.id),
    content: `<div class="sacadia gm-note">${ex.label} (${ex.damage})${lines.join('') || ` — ${game.i18n.localize(center ? 'SACADIA.Named.NoOneElse' : 'SACADIA.Named.NoOne')}`}</div>` });
}

/**
 * Apply a no-roll on-use inflict (from a card flag) to the targeted token(s): each leveled condition is
 * added to the current level, capped (book conditions cap). GM-side (the target may be a token the roller
 * doesn't own). No save — these abilities inflict automatically (Predator and Prey, That Sluggish Feeling).
 */
export async function applyOnUseInflict({ targetUuids, inflicts, exhaust, holdDecay, cover, enduring, casterUuid, burst, reactions, convertTemp, sourcePatch, setFlag,
  apGain, apNext, exhaustRandomCombat }) {
  const granted = [];
  for (const uuid of targetUuids ?? []) {
    const doc = await fromUuid(uuid);
    const actor = doc?.actor ?? doc;
    if (!actor) continue;
    // Vampiric Siphon / Touch the Flame / Into Fire: trigger the target's Hemorrhage now (before any level changes).
    if (burst) await hemorrhageBurst(actor, { ...burst, casterUuid });
    if (inflicts?.length) {
      // Dice amounts roll separately for each target (Surprising Dance's 1D4 Fumble).
      const rolled = [];
      for (const e of inflicts) rolled.push(typeof e.amount === 'string' ? { ...e, amount: (await new Roll(e.amount).evaluate()).total } : e);
      await applyConditionDeltas(actor, rolled);
    }
    const upd = {};
    // Exhaust one of the target's limbs (Bloodsapper) — same slot mapping as spending an action.
    if (exhaust) for (const slot of resolveLimbSlots([exhaust], actor.system.exhaustion ?? {}).newlyExhausted) upd[`system.exhaustion.${slot}`] = true;
    // Hold end-of-turn decay of these conditions through the target's next turn end (Cornered Animal).
    if (holdDecay?.length) upd['flags.sacadia.holdDecay'] = Array.from(new Set([...(actor.getFlag('sacadia', 'holdDecay') ?? []), ...holdDecay]));
    // Cover until the start of the caster's next turn (Protective Instinct, Covering Dance).
    if (cover) { upd['system.cover'] = cover; granted.push(uuid); }
    // Balanced Scale: the target's held condition becomes Enduring (it stops dropping at turn end).
    if (enduring && (actor.system.conditions?.[enduring]?.value ?? 0) > 0) upd[`system.conditions.${enduring}.enduring`] = true;
    // Bloomgift: "For each AP you expend, that ally gains one reaction before the start of their next turn."
    if (reactions > 0) upd['system.reaction.value'] = (actor.system.reaction?.value ?? 0) + reactions;
    // Healthy Hands: "Convert all temporary HP they possess to permanent health."
    if (convertTemp && (actor.system.health?.temp ?? 0) > 0) {
      upd['system.health.value'] = Math.min(actor.system.health?.max ?? Infinity, (actor.system.health?.value ?? 0) + actor.system.health.temp);
      upd['system.health.temp'] = 0;
    }
    // A per-instance variant of a held condition, kept on its source record (cleared with the condition at 0) —
    // Delirious Vulnerabilities: "That Delirium no longer reduces their AD, MD, TD, and PD … it reduces their DR".
    if (sourcePatch?.condition && (actor.system.conditions?.[sourcePatch.condition]?.value ?? 0) > 0) {
      for (const [k, v] of Object.entries(sourcePatch.patch ?? {})) upd[`system.conditions.${sourcePatch.condition}.source.${k}`] = v;
    }
    // A one-shot flag on the target (Spare the Meek: skip the next Battle Fatigue).
    if (setFlag) upd[`flags.sacadia.${setFlag}`] = true;
    // Spring Weapon: "They gain 1AP per reaction you exhaust, to a maximum of their maximum unwounded AP."
    if (apGain > 0) upd['system.ap.value'] = Math.min(actor.system._baseMaxAp?.() ?? Infinity, (actor.system.ap?.value ?? 0) + apGain);
    // Call of Fury: AP on their next turn.
    if (apNext > 0) upd['flags.sacadia.apBonusNext'] = (actor.getFlag('sacadia', 'apBonusNext') ?? 0) + apNext;
    // Prone Gutting: "exhaust a random limb on that target for the remainder of combat".
    if (exhaustRandomCombat) {
      const slots = Object.entries(actor.system.exhaustion ?? {}).filter(([, v]) => !v).map(([k]) => k);
      const slot = slots[Math.floor(Math.random() * slots.length)];
      if (slot) {
        upd[`system.exhaustion.${slot}`] = true;
        upd['flags.sacadia.combatExhausted'] = Array.from(new Set([...(actor.getFlag('sacadia', 'combatExhausted') ?? []), slot]));
      }
    }
    if (Object.keys(upd).length) await actor.update(upd);
  }
  if (granted.length && casterUuid) {
    const cd = await fromUuid(casterUuid);
    const caster = cd?.actor ?? cd;
    if (caster) await caster.setFlag('sacadia', 'grantedCover', Array.from(new Set([...(caster.getFlag('sacadia', 'grantedCover') ?? []), ...granted])));
  }
}

/**
 * A caster's gain per failed check of its save (GM-side): AP this turn, a pool point, or condition levels.
 */
export async function applyGainOn({ uuid, n, ap, pool, condition }) {
  const d = await fromUuid(uuid);
  const actor = d?.actor ?? d;
  if (!actor || !(n > 0)) return;
  const upd = {};
  if (ap) upd['system.ap.value'] = (actor.system.ap?.value ?? 0) + ap * n;
  if (pool) {
    const cp = actor.system.classPools?.[pool];
    if (cp) upd[`system.classPools.${pool}.value`] = Math.min(cp.max ?? Infinity, (cp.value ?? 0) + n);
  }
  if (Object.keys(upd).length) await actor.update(upd);
  // A cost paid per failure (Give of Thyself, Transmute Trauma: "you gain 1 Fatigue") — your own, so it stacks.
  if (condition) await applyConditionDeltas(actor, [{ condition, amount: n, self: true }]);
}

/** Push a one-shot pending-attack buff onto an actor (from a card flag — e.g. Sapped Fates' per-Fumble to-hit). */
export async function applyPendingOn({ uuid, buff }) {
  const d = await fromUuid(uuid);
  const actor = d?.actor ?? d;
  if (!actor || !buff) return;
  await actor.update({ 'system.pendingAttack': [...(actor.system.pendingAttack ?? []),
    { advantage: buff.advantage ?? 0, toHit: buff.toHit ?? 0, damage: buff.damage ?? 0, dieStep: 0, targetCondition: buff.targetCondition ?? '', label: buff.label ?? '' }] });
}

/**
 * Apply a temp-HP grant to allies (from a card flag): each targeted token takes the higher of the
 * rolled amount vs its current temp HP (non-stacking, book p.223). Can't be given to a dying/unconscious
 * creature. GM-side (allies may be tokens the roller doesn't own).
 */
export async function applyTempHpGrant({ amount, targetUuids }) {
  for (const uuid of targetUuids ?? []) {
    const doc = await fromUuid(uuid);
    const actor = doc?.actor ?? doc;
    if (!actor) continue;
    if ((actor.system.health?.value ?? 0) <= 0 || actor.statuses?.has('unconscious')) continue;
    await actor.update({ 'system.health.temp': Math.max(actor.system.health?.temp ?? 0, amount) });
  }
}
