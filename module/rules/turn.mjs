/**
 * Combat-turn automation, GM-side: what happens at the start and end of each creature's turn (the action-economy reset,
 * turn-start conditions and auras, condition reduction, Berserker Rage's countdown).
 */
import { actorCheckDc } from './damage.mjs';
import { actorToken, findGear, ownsAbility, tokenDistance } from '../helpers/actor-utils.mjs';
import { applyConditionDeltas, applySelfDamage, conditionEndures } from '../helpers/conditions.mjs';
import { bladeAuraRadius, hostileAuraSources, hostileTokensNear } from '../helpers/auras.mjs';
import { casterZoneTurn, pruneZones, refreshCloudLayers } from '../helpers/zones.mjs';
import { consumeGrants, reapOrphanGrants } from './grants.mjs';
import { corrodedTurnStart } from '../helpers/rend.mjs';
import { deleteKey } from '../helpers/update-ops.mjs';
import { poolsAfterDamage, stepDie } from '../helpers/derivation.mjs';
import { prestigeTurnEnd, prestigeTurnStart, rollTurnDamage } from '../helpers/prestige.mjs';
import { rollInsaneTable } from './madness.mjs';
import { syncFocus } from '../helpers/focus.mjs';
import { replaceWith } from '../helpers/update-ops.mjs';

export async function turnAutomation(combat, changed) {
  if (game.users.activeGM !== game.user) return; // only one client mutates
  if (!('round' in changed) && !('turn' in changed)) return;

  // (1) expire timed-out temporary effects across the encounter
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    const expired = actor.effects.filter((e) => {
      const remaining = e.duration?.remaining;
      return e.isTemporary && typeof remaining === 'number' && remaining <= 0;
    });
    if (expired.length) await actor.deleteEmbeddedDocuments('ActiveEffect', expired.map((e) => e.id));
  }

  // (2) start-of-turn: refresh the new combatant's action economy (AP to max, limbs cleared, log
  // emptied), apply start-of-turn condition damage (Hemorrhage), then — if Insane — roll the Insane
  // table (after the AP reset, so its ±AP entries land on top of the fresh economy).
  if (combat.combatant?.actor) {
    const actor = combat.combatant.actor;
    await resetActionEconomy(actor);
    await syncFocus(actor); // what hung off a Focus that wasn't maintained goes before the turn-start effects read it
    // Zones this creature sustains: drop those whose Focus lapsed (and last turn's action zones), move God's Mist
    // to it, and charge Stygian Abyss's upkeep.
    await pruneZones(actor, { turnStart: true });
    await refreshCloudLayers(actor); // Swarm cloud layers whose Focus just lapsed drop their statuses/terrain
    for (const c of await casterZoneTurn(actor)) {
      await applySelfDamage(actor, c.damage);
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Zone.CasterCost', { zone: c.label, n: c.damage })}</div>` });
    }
    await applyTurnStartConditions(actor);
    await corrodedTurnStart(actor); // Corroded: one level of Rend per level
    await applyWoundedTurnStart(actor);
    await applySphereInsanium(actor);
    await applyBladeAuraTurnStart(actor);
    await prestigeTurnStart(actor); // Hallow's Calm / Gale Madness, Crown of Insanity
    // Guardian of the Ambush: "Gain 1 AP on the first round of combat."
    if (combat.round === 1 && ownsAbility(actor, 'guardian_of_the_ambush')) {
      await actor.update({ 'system.ap.value': (actor.system.ap?.value ?? 0) + 1 });
    }
    if (actor.statuses?.has('insane')) await rollInsaneTable(actor);
  }

  // (3) end-of-turn condition reduction for the combatant whose turn just ended
  const prevId = combat.previous?.combatantId;
  const prev = prevId ? combat.combatants.get(prevId) : null;
  if (prev?.actor) {
    // I'll Come Back: "If your turn ends and you have thrown at least 3 versatile weapons on your turn, gain
    // one extra reaction this turn."
    if (ownsAbility(prev.actor, 'ill_come_back') && (prev.actor.getFlag('sacadia', 'turnFlags')?.versatileThrows ?? 0) >= 3) {
      await prev.actor.update({ 'system.reaction.value': (prev.actor.system.reaction?.value ?? 0) + 1 });
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: prev.actor }), content: `<div class="sacadia">${game.i18n.localize('SACADIA.Named.IllComeBack')}</div>` });
    }
    await sphereInsaniumCheck(prev.actor);
    await prestigeTurnEnd(prev.actor); // Catnap's end-of-turn Fate Check
    await consumeGrants(prev.actor, 'turnEnd'); // "until the end of your turn" grants (No Holds Barred, Toxic Touch)
    await reduceConditions(prev.actor);
    // Berserker Rage's countdown and the Fatigue when it ends, after the reduction: the Fatigue is all still there at
    // the creature's next turn (owner's ruling).
    await rageTurnEnd(prev.actor);
  }

  // (4) backstop: reap any ally grant whose anchor is gone (the anchor-delete cascade is primary).
  await reapOrphanGrants();
}

/**
 * Blade Aura (Focus): "any creature who … starts their turn in it makes a Finesse Check or takes 1D6 points of
 * slashing damage (1D8 @5, 1D10 @11). Once a creature takes this damage, they cannot take it again until the
 * start of their next turn." The turn-start half: a save card per aura the creature starts inside, damage
 * pre-rolled with the owner's level die + its Blade Aura die-steps (Stabby Aura, Blindstab). Entering the
 * aura mid-turn is the GM's call (movement policy).
 */
export async function applyBladeAuraTurnStart(actor, { entering = false } = {}) {
  // Entering mid-turn (movement hook): only auras this creature wasn't already in, and at most one card per aura until
  // the creature's next turn start ("Once a creature takes this damage, they cannot take it again until the start of
  // their next turn"). At its turn start the list resets and every aura it starts in checks.
  const before = new Set(actor.getFlag('sacadia', 'bladeAuraIn') ?? []);
  const carded = new Set(entering ? (actor.getFlag('sacadia', 'bladeAuraCarded') ?? []) : []);
  const now = [];
  for (const [id, fatebound] of [['bd_blade_aura', false], ['blade_aura', true]]) {
    for (const src of hostileAuraSources(actor, id, (a) => bladeAuraRadius(a, fatebound))) {
      now.push(src.uuid);
      if (entering && (before.has(src.uuid) || carded.has(src.uuid))) continue;
      carded.add(src.uuid);
      const lvl = src.system.level ?? 1;
      const base = lvl >= 11 ? 10 : lvl >= 5 ? 8 : 6;
      const steps = src.system.abilityDamageSteps?.[id] ?? 0;
      const die = stepDie('1', base, steps, CONFIG.SACADIA.diceLadder);
      const r = await new Roll(`${die.count}d${die.denomination}`).evaluate();
      const dc = actorCheckDc(src);
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: src }), rolls: [r],
        content: `<div class="sacadia">${game.i18n.format('SACADIA.Aura.BladeAura', { name: actor.name })}`
          + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="finesse" data-dc="${dc}" data-damage="${r.total}" data-onsuccess="none"`
          + ` data-casterpc="${src.type === 'character' ? 1 : 0}" data-caster="${src.uuid}">`
          + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · Finesse)</button></div></div>` });
    }
  }
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  const prevCarded = actor.getFlag('sacadia', 'bladeAuraCarded') ?? [];
  if (!same(now, [...before]) || !same([...carded], prevCarded)) {
    await actor.update({ 'flags.sacadia.bladeAuraIn': now, 'flags.sacadia.bladeAuraCarded': [...carded] });
  }
}

/**
 * Sphere Insanium (Focus): "at the start of your turn give two levels of Delirium to every enemy within 30ft
 * of you even if they already have Delirium. They do not make Trait Checks against this."
 */
export async function applySphereInsanium(actor) {
  if ((actor.system.combatState?.focusRounds?.sphere_insanium ?? 0) <= 0 || !ownsAbility(actor, 'sphere_insanium')) return;
  const hit = [];
  for (const t of hostileTokensNear(actor, 30)) {
    const cur = t.actor.system.conditions?.delirium?.value ?? 0;
    await t.actor.update({ 'system.conditions.delirium.value': Math.min(CONFIG.SACADIA.conditionStoreMax, cur + 2) });
    hit.push(t.name);
  }
  if (hit.length) await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sacadia">${game.i18n.format('SACADIA.Madness.SphereInsanium', { names: hit.join(', ') })}</div>` });
}

/**
 * Sphere Insanium: "At the end of every turn after the turn you initiate this, make a Wiles Check against your
 * own Check DC. If you fail, end Focus." A save card for the caster (ending the Focus on a failure is theirs).
 */
export async function sphereInsaniumCheck(actor) {
  if ((actor.system.combatState?.focusRounds?.sphere_insanium ?? 0) < 2 || !ownsAbility(actor, 'sphere_insanium')) return;
  const dc = actorCheckDc(actor);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="sacadia">${game.i18n.localize('SACADIA.Madness.SphereCheck')}`
      + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="wiles" data-dc="${dc}">`
      + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · Wiles)</button></div></div>` });
}

/**
 * Start of a Wounded creature's turn: +1 Battle Fatigue (irrecoverable in combat, reduces AP). If that
 * leaves no AP it falls Unconscious. Allies within 15ft who own Call of the Dying (with a reaction and a
 * Call point) are offered a GM button to prevent this turn's gain.
 */
export async function applyWoundedTurnStart(actor) {
  if ((actor.system.health?.value ?? 0) >= 0) return;
  // Death Mastery: "Do not gain Exhaustion from being Wounded."
  if (ownsAbility(actor, 'legendary_death')) return;
  // Spare the Meek (Magus): "They do not gain Battle Fatigue at the start of their next turn."
  if (actor.getFlag('sacadia', 'spareTheMeek')) {
    await actor.unsetFlag('sacadia', 'spareTheMeek');
    return ChatMessage.create({ content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Prestige.Spared', { name: actor.name })}</div>` });
  }
  const n = (actor.system.battleFatigue ?? 0) + 1;
  // The turn's AP was just refilled — the new point of Battle Fatigue comes out of it too.
  await actor.update({ 'system.battleFatigue': n, 'system.ap.value': Math.max(0, (actor.system.ap?.value ?? 0) - 1) });
  const gm = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
  let content = game.i18n.format('SACADIA.Dying.BattleFatigue', { name: actor.name, n });
  const aTok = actorToken(actor);
  for (const t of canvas?.tokens?.placeables ?? []) {
    const r = t.actor;
    if (!r || r === actor || !ownsAbility(r, 'call_of_the_dying')) continue;
    if ((t.document.disposition ?? 0) !== (aTok?.document?.disposition ?? 0)) continue;
    if ((tokenDistance(t, aTok) ?? 99) > 15 || (r.system.reaction?.value ?? 0) < 1 || (r.system.classPools?.call?.value ?? 0) < 1) continue;
    content += `<div><button type="button" data-action="callOfTheDying" data-reactor="${r.uuid}" data-target="${actor.uuid}">`
      + `${game.i18n.format('SACADIA.Dying.CallOfTheDying', { name: r.name })}</button></div>`;
  }
  await ChatMessage.create({ whisper: gm, content: `<div class="sacadia gm-note">${content}</div>` });
  // Recompute after the update: no AP left → Unconscious.
  if ((actor.system.ap?.max ?? 0) <= 0 && !actor.statuses?.has('unconscious')) {
    await actor.toggleStatusEffect('unconscious', { active: true });
    await ChatMessage.create({ content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Dying.Unconscious', { name: actor.name })}</div>` });
  }
}

/** The Woad Facepaint at hand, if any (a readied trinket). */
export function woadFacepaint(actor) {
  return findGear(actor, 'woad_facepaint', { where: 'hand' });
}

/**
 * Berserker Rage at the raging creature's turn end: one round fewer; when none are left (or Explosive Rage ends it this
 * turn), the rage ends and "you gain Fatigue equal to half your Proficiency, rounded up". Endurance Mastery: "roll Power
 * Checks against the effect (against your own Check DC). Only take Fatigue if you fail these checks."
 */
export async function rageTurnEnd(actor) {
  const rage = actor.getFlag('sacadia', 'rage');
  if (!actor.statuses?.has('raging')) { if (rage) await actor.unsetFlag('sacadia', 'rage'); return; }
  const endNow = (actor.system.bonuses?.endRageAtTurnEnd ?? 0) > 0;
  if (!rage && !endNow) return; // a rage toggled by hand: its length is the table's
  const left = (rage?.rounds ?? 1) - 1;
  if (left > 0 && !endNow) return actor.setFlag('sacadia', 'rage', { rounds: left });
  await actor.toggleStatusEffect('raging', { active: false });
  await actor.unsetFlag('sacadia', 'rage');
  const n = Math.ceil((actor.system.proficiency ?? 0) / 2);
  const speaker = ChatMessage.getSpeaker({ actor });
  if (n <= 0) return;
  if (ownsAbility(actor, 'legendary_endurance')) {
    const cd = actor.system.checkDc;
    const dc = (typeof cd === 'number' ? cd : cd?.primary) ?? 10;
    const inf = foundry.utils.escapeHTML(JSON.stringify([{ condition: 'fatigue', level: n, self: true, label: game.i18n.localize('SACADIA.Condition.Fatigue') }]));
    return ChatMessage.create({ speaker, content: `<div class="sacadia">${game.i18n.format('SACADIA.Rage.EndedCheck', { name: actor.name, n })}`
      + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="power" data-dc="${dc}" data-inflict="${inf}" data-caster="${actor.uuid}">`
      + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · ${game.i18n.localize('SACADIA.Stat.Power')})</button></div></div>` });
  }
  await applyConditionDeltas(actor, [{ condition: 'fatigue', amount: n, self: true }]);
  await ChatMessage.create({ speaker, content: `<div class="sacadia">${game.i18n.format('SACADIA.Rage.Ended', { name: actor.name, n })}</div>` });
}

/** Roll each `turnDamage` condition (e.g. Hemorrhage `Nd10`) and apply it to the actor's Health. */
export async function applyTurnStartConditions(actor) {
  let total = 0;
  const flavors = [];
  for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
    const level = Math.min(actor.system.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
    const dmg = cfg.effects?.find((e) => e.type === 'turnDamage');
    if (!level || !dmg) continue;
    // The giver's upgrades, read live (Mastery of Hemorrhage, Bloodthinner, Bleeding Expert, Bleeding Bane) and falling
    // back to those recorded when it was given: die types up.
    const roll = await rollTurnDamage(actor, key, level);
    if (!roll) continue;
    total += roll.total;
    flavors.push(`${game.i18n.localize(cfg.label)} ${roll.formula} = ${roll.total}`);
  }
  if (total > 0) {
    await actor.update({ 'system.health.value': Math.max(0, actor.system.health.value - total) });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sacadia"><b>${game.i18n.localize('SACADIA.Condition.TurnDamage')}:</b> ${total} (${flavors.join(', ')})</div>`,
    });
  }
}

/** Reduce every leveled (non-enduring) condition on the actor by 1 (end-of-turn, book p.259). */
export async function reduceConditions(actor) {
  const update = {};
  const held = [...(actor.getFlag('sacadia', 'holdDecay') ?? [])];
  // Bloodlet (Focus): "treat your Madness as enduring … Instead, reduce your HP by your Madness at the end of
  // each turn."
  const madness = actor.system.conditions?.madness?.value ?? 0;
  if ((actor.system.combatState?.focusRounds?.bloodlet ?? 0) > 0 && madness > 0) {
    held.push('madness');
    const pools = poolsAfterDamage(actor.system.health?.value ?? 0, actor.system.health?.temp ?? 0, madness);
    update['system.health.value'] = pools.value;
    update['system.health.temp'] = pools.temp;
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Madness.Bloodlet', { n: madness })}</div>` });
  }
  if (actor.getFlag('sacadia', 'holdDecay')) update['flags.sacadia.holdDecay'] = deleteKey();
  for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
    if (CONFIG.SACADIA.enduringConditions.includes(key)) continue;
    // This creature's instance is Enduring (Balanced Scale, Wrestling Focus's Pin).
    if (await conditionEndures(actor, key)) continue;
    const value = actor.system.conditions?.[key]?.value ?? 0;
    // A held condition (Cornered Animal) skips this end-of-turn reduction; the hold is then spent.
    if (held.includes(key)) continue;
    // Fumbled isn't reduced — "a creature removes all Fumbled at the end of their turn" (book p.257).
    if (value > 0) update[`system.conditions.${key}.value`] = key === 'fumbled' ? 0 : value - 1;
  }
  if (Object.keys(update).length) await actor.update(update);
}

/**
 * Refresh a character's turn economy (start-of-turn or manual reset): AP to Max, every limb slot
 * cleared, and the action log emptied. Static so the combat hook can call it too.
 * @param {Actor} actor
 */
export async function resetActionEconomy(actor) {
  // Hero's Response debt: the extra reactions taken since last turn come out of this turn's AP.
  const heroDebt = actor.getFlag('sacadia', 'heroResponse')?.used ?? 0;
  // AP lost on this turn to an enemy effect (Pinetar: "lose one AP to use on their next turn") — not Fatigue.
  const apDebt = actor.getFlag('sacadia', 'apDebt') ?? 0;
  // Call of Fury: "On your chosen ally's next turn, they receive additional AP equal to the number you expended."
  const apBonus = actor.getFlag('sacadia', 'apBonusNext') ?? 0;
  const update = { 'system.ap.value': Math.max(0, (actor.system.ap?.max ?? 0) - heroDebt - apDebt + apBonus), 'system.actionLog': [] };
  if (apBonus) update['flags.sacadia.apBonusNext'] = deleteKey();
  if (actor.getFlag('sacadia', 'heroResponse')) update['flags.sacadia.heroResponse'] = deleteKey();
  if (apDebt) update['flags.sacadia.apDebt'] = deleteKey();
  // Surprise "goes away after the creature's turn starts" (book p.258); a Reckless exposure lasts
  // "until the start of your next turn".
  if (actor.statuses?.has('surprised')) await actor.toggleStatusEffect('surprised', { active: false });
  if (actor.getFlag('sacadia', 'exposed')) update['flags.sacadia.exposed'] = deleteKey();
  // Cover this actor granted others ("until the start of your next turn") lapses now.
  for (const u of actor.getFlag('sacadia', 'grantedCover') ?? []) {
    const d = await fromUuid(u);
    const a = d?.actor ?? d;
    if (a && a.system.cover !== 'none') await a.update({ 'system.cover': 'none' });
  }
  if (actor.getFlag('sacadia', 'grantedCover')) update['flags.sacadia.grantedCover'] = deleteKey();
  // Reaction refreshes at the start of your turn (book p.237) — back to the passive max, discarding
  // any unspent grant from last round.
  update['system.reaction.value'] = actor.system.reaction?.max ?? 1;
  // Prone Gutting: limbs exhausted "for the remainder of combat" stay exhausted.
  const kept = new Set(actor.getFlag('sacadia', 'combatExhausted') ?? []);
  for (const slot of Object.keys(CONFIG.SACADIA.exhaustionSlots)) update[`system.exhaustion.${slot}`] = kept.has(slot);
  // Reset the per-turn auto-counters (see docs/conditional-modifiers.md). The consecutive-hit
  // streak is per *turn* ("made consecutively on your turn"), so it clears at turn start too — it's
  // additionally broken mid-turn by a miss (in resolveAttack).
  update['system.combatState.attacksThisTurn'] = 0;
  update['system.combatState.shieldAttacksThisTurn'] = 0;
  update['system.combatState.shieldHitsThisTurn'] = 0;
  update['system.combatState.missedAttacksThisTurn'] = 0;
  update['system.combatState.newTargetsHitThisTurn'] = 0;
  update['system.combatState.attackedTargetsThisTurn'] = [];
  update['system.combatState.movedFeet'] = 0;
  update['system.combatState.tookDamage'] = false;
  update['system.combatState.consecutiveHits'] = 0;
  // Armed-but-unused boosts fizzle at turn start — you never took the action, so nothing was spent.
  // The used-`once` log clears too, so those boosts are available again next turn.
  update['system.armedBoosts'] = [];
  update['system.boostsUsed'] = [];
  // Pending-attack buffs are scoped to "this turn" ("your next attack … this turn") — an unspent one
  // fizzles at turn start, like an armed boost.
  if ((actor.system.pendingAttack ?? []).length) update['system.pendingAttack'] = [];
  // Once-per-turn post-roll options (Remaneuver, Combo Breaker, Drunken Fisticuff …) re-arm.
  if (actor.getFlag('sacadia', 'turnFlags')) update['flags.sacadia.turnFlags'] = deleteKey();
  if (actor.getFlag('sacadia', 'uses')?.turn) update['flags.sacadia.uses.turn'] = deleteKey();
  // Focus-maintenance streaks: a Focus ability keeps its round count only if it was used on the turn
  // that just ended (its key is still in the not-yet-cleared log); otherwise the streak is broken and
  // drops to 0. The count itself grows on use in #spendAction.
  const usedLastTurn = new Set((actor.system.actionLog ?? []).map((e) => e.key).filter(Boolean));
  // Hold the Brush (Witch): while a Witch holds this creature's Focus, "they do not expend AP to maintain Focus" — every
  // Focus it has running counts as maintained.
  if ((actor.system.bonuses?.heldFocus ?? 0) > 0) {
    for (const k of Object.keys(actor.system.combatState?.focusRounds ?? {})) usedLastTurn.add(k);
    for (const e of actor.effects) if (e.flags?.sacadia?.anchor?.ability) usedLastTurn.add(e.flags.sacadia.anchor.ability);
  }
  const focusRounds = {};
  for (const [cid, r] of Object.entries(actor.system.combatState?.focusRounds ?? {})) {
    if (usedLastTurn.has(cid)) focusRounds[cid] = r;
  }
  update['system.combatState.focusRounds'] = replaceWith(focusRounds);
  // Per-Focus target sets live exactly as long as their Focus streak; per-turn hit tallies reset.
  update['system.combatState.focusTargets'] = replaceWith(Object.fromEntries(Object.entries(actor.system.combatState?.focusTargets ?? {})
    .filter(([cid]) => cid in focusRounds)));
  update['system.combatState.hitsByTarget'] = replaceWith({});
  update['system.combatState.reactionAttacks'] = 0;
  // The Focus anchors, marks and zones of whatever wasn't maintained are torn down by syncFocus (helpers/focus.mjs),
  // which the GM runs whenever the counters above change — so "stop maintaining → mark + buff + zone all end" holds.
  await actor.update(update);
}
