/**
 * GM buttons on chat cards: set a condition level, apply or adjust HP, choose a critical effect, mark a creature dead,
 * and Call of the Dying.
 */
import { fireKillTriggers, runOnKill } from './damage.mjs';
import { replaceWith } from '../helpers/update-ops.mjs';
import { postRollCard } from '../helpers/chat-cards.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';

/** Call of the Dying (GM button): undo this turn's Battle Fatigue gain; spend the ally's reaction + Call point. */
export async function onCallOfTheDying(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { reactor: rUuid, target: tUuid } = event.currentTarget.dataset;
  const r = (await fromUuid(rUuid))?.actor ?? await fromUuid(rUuid);
  const t = (await fromUuid(tUuid))?.actor ?? await fromUuid(tUuid);
  if (!r || !t) return;
  await t.update({ 'system.battleFatigue': Math.max(0, (t.system.battleFatigue ?? 0) - 1), 'system.ap.value': (t.system.ap?.value ?? 0) + 1 });
  await r.update({ 'system.reaction.value': Math.max(0, (r.system.reaction?.value ?? 0) - 1),
    'system.classPools.call.value': Math.max(0, (r.system.classPools?.call?.value ?? 0) - 1) });
  event.currentTarget.disabled = true;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: r }),
    content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Dying.Prevented', { label: 'Call of the Dying', name: t.name })}</div>` });
}

/** Set a target's leveled-condition value to the button's absolute value (GM only). */
export async function onApplyCondition(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { target: uuid, condition, value, source, prefer } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (!actor) return;
  const upd = { [`system.conditions.${condition}.value`]: Number(value) };
  // The first levels given record their source (see conditionSource).
  if (source && !(actor.system.conditions?.[condition]?.value > 0) && Number(value) > 0) upd[`system.conditions.${condition}.source`] = replaceWith(JSON.parse(source));
  await actor.update(upd, prefer ? { sacadiaRendPrefer: prefer } : {});
}

/** Set a target's Health to the button's absolute value (GM only; buttons live in GM whispers). */
export async function onApplyHp(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { target: uuid, hp, temp, attacker: atkUuid } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (!actor) return;
  const wasAlive = (actor.system.health?.value ?? 0) > 0;
  const update = { 'system.health.value': Number(hp) };
  if (temp !== undefined) update['system.health.temp'] = Number(temp); // temp-aware buttons carry it
  // Flag the took-damage auto-counter when this actually lowers Health (drives `self:combat:took-damage`).
  if (Number(hp) < (actor.system.health?.value ?? 0)) update['system.combatState.tookDamage'] = true;
  await actor.update(update);
  // Manual killing blow (alive → 0): fire the attacker's kill triggers. The from-alive guard makes
  // re-clicking the same 0-HP button (or a prior auto-apply) not re-fire.
  if (atkUuid && wasAlive && Number(hp) <= 0) {
    const ad = await fromUuid(atkUuid);
    await fireKillTriggers(ad?.actor ?? ad);
    await runOnKill(actor);
  }
}

/**
 * Apply a crit *self*-effect the roller picked from their own card (Phase 2b). Runs on the roller's
 * client (they own the attacker) or the GM's. AP: recover the amount, capped at max. Limb: clear one
 * exhausted slot of the roller's choice (never Focus — Paused Critical excludes it); prompts when more
 * than one is exhausted. Temp-HP / next-attack advantage aren't here (list-only, pending subsystems).
 */
export async function onCritSelf(event) {
  event.preventDefault();
  const { attacker: uuid, effect, amount, dice, label } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (!actor?.isOwner) return; // only the roller (or GM) applies their own crit effect
  if (effect === 'advantage') {
    // Critical Strike: bank a one-shot advantage on the actor's *next* attack (consumed in #useAbility).
    const buff = { advantage: Number(amount || 1), label: label || game.i18n.localize('SACADIA.Crit.NextAttack') };
    await actor.update({ 'system.pendingAttack': [...(actor.system.pendingAttack ?? []), buff] });
    return ui.notifications.info(game.i18n.localize('SACADIA.Crit.Banked'));
  }
  if (effect === 'tempHp') {
    // Roll the (already Lifeguard/level-scaled) temp-HP die and grant it — temp HP does not stack, so a
    // new grant takes the higher of new-vs-current (book p.223).
    const roll = await new Roll(dice || '1d6').evaluate();
    await postRollCard({ actor, roll, icon: 'fa-solid fa-heart-circle-plus', title: label || game.i18n.localize('SACADIA.Crit.TempHp'),
      tag: game.i18n.localize('SACADIA.Check.Critical') });
    const next = Math.max(actor.system.health?.temp ?? 0, roll.total);
    await actor.update({ 'system.health.temp': next });
    return;
  }
  if (effect === 'ap') {
    const ap = actor.system.ap ?? {};
    const next = Math.min(ap.max ?? 0, (ap.value ?? 0) + Number(amount || 1));
    if (next === (ap.value ?? 0)) return ui.notifications.info(game.i18n.localize('SACADIA.Crit.ApFull'));
    await actor.update({ 'system.ap.value': next });
  } else if (effect === 'limb') {
    const exhausted = Object.entries(actor.system.exhaustion ?? {})
      .filter(([slot, on]) => on && slot !== 'focus').map(([slot]) => slot);
    if (!exhausted.length) return ui.notifications.info(game.i18n.localize('SACADIA.Crit.NoLimb'));
    let slot = exhausted[0];
    if (exhausted.length > 1) {
      slot = await sacDialog.wait({
        window: { title: game.i18n.localize('SACADIA.Crit.LimbPick') },
        buttons: exhausted.map((s) => ({
          action: s, label: game.i18n.localize(CONFIG.SACADIA.exhaustionSlots[s] ?? s),
        })),
      }).catch(() => null);
      if (!slot) return;
    }
    await actor.update({ [`system.exhaustion.${slot}`]: false });
  }
}

/** Apply the core "Dead" status (defeated skull overlay) to the target NPC (GM only). */
export async function onMarkDead(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { target: uuid, attacker: atkUuid } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (!actor) return;
  // Mark-dead as the committing kill (the HP path hasn't already reduced it to 0 and fired) → fire triggers.
  const wasAlive = (actor.system.health?.value ?? 0) > 0;
  await actor.toggleStatusEffect('dead', { active: true, overlay: true });
  if (atkUuid && wasAlive) {
    const ad = await fromUuid(atkUuid);
    await fireKillTriggers(ad?.actor ?? ad);
    await runOnKill(actor);
  }
}
