/**
 * Oracle Madness and Insanity: going and leaving Insane (ending every Focus), Soulbinding's break, and the Insane table.
 */
import { actorCheckDc } from './damage.mjs';
import { applyConditionDeltas } from '../helpers/conditions.mjs';
import { confirmWarn, ownsAbility } from '../helpers/actor-utils.mjs';
import { postRollCard } from '../helpers/chat-cards.mjs';
import { replaceWith } from '../helpers/update-ops.mjs';
import { syncFocus } from '../helpers/focus.mjs';

/** Enter Insanity: set the status and end every maintained ability (Madness abilities + Focus, p120). */
export async function goInsane(actor) {
  await actor.toggleStatusEffect('insane', { active: true });
  await soulbindingBreak(actor);
  await endAllFocus(actor);
}

/**
 * Soulbinding: "If you go insane while using this ability, the target makes a Wiles Check against you or
 * takes XD8 points of psychic damage (X is equal to your Proficiency)." A save card per soulbound token, its
 * damage pre-rolled (applied on a failure by the saver's roll).
 */
export async function soulbindingBreak(actor) {
  const bound = actor.system.marks?.soulbound ?? [];
  if (!bound.length || !ownsAbility(actor, 'soulbinding')) return;
  const dc = actorCheckDc(actor);
  const prof = Math.max(1, actor.system.proficiency ?? 1);
  for (const u of bound) {
    const doc = await fromUuid(u);
    const t = doc?.actor ?? doc;
    if (!t) continue;
    const r = await new Roll(`${prof}d8`).evaluate();
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), rolls: [r],
      content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Madness.SoulbindingBreak', { name: t.name })}`
        + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="wiles" data-dc="${dc}" data-damage="${r.total}" data-onsuccess="none"`
        + ` data-casterpc="${actor.type === 'character' ? 1 : 0}" data-caster="${actor.uuid}">`
        + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · Wiles)</button></div></div>` });
  }
}

/** Leave Insanity: clear the status, end Focus / P:I abilities, and gain Fatigue = ceil(Proficiency/2). */
export async function endInsane(actor) {
  await actor.toggleStatusEffect('insane', { active: false });
  await endAllFocus(actor);
  const prof = actor.getRollData?.()?.proficiency ?? 0;
  const fatigue = Math.ceil(prof / 2);
  // Through the shared rule, so immunity (Mastery of Energy) applies; it's your own, so it stacks onto any Fatigue you
  // have (designer's ruling).
  if (fatigue > 0) await applyConditionDeltas(actor, [{ condition: 'fatigue', amount: fatigue, self: true }]);
}

// Start-of-turn Insane-table roll (book p120): while Insane, roll 1D8 and lose that many HP, then follow
// the entry's effect (a Boost on the first action). HP loss is softened by Heather Root (−ceil(Prof/2))
// or negated on a 7/8 by Writhing Block; rolls 2 & 8 also tweak AP. The narrative effects (attack the
// nearest, adv/disadv on the first attack, etc.) are surfaced on the card for the player to enact.
export async function rollInsaneTable(actor, forced = null) {
  let roll = await new Roll(forced != null ? String(forced) : '1d8').evaluate();
  const owns = (id) => ownsAbility(actor, id);
  // Mastery of the Mind: "insane-table effects cannot force you to attack an ally or treat allies as enemies" — 1 (allies
  // as enemies) and 2 (attack the nearest creature, which may be an ally) are re-rolled until another result comes up.
  let guarded = 0;
  while (forced == null && owns('mastery_mind') && [1, 2].includes(roll.total) && guarded++ < 20) roll = await new Roll('1d8').evaluate();
  const n = roll.total;
  let hpLoss = n;
  let mitigation = '';
  if ((n === 7 || n === 8) && owns('writhing_block')) {
    hpLoss = 0;
    mitigation = game.i18n.localize('SACADIA.Insane.WrithingBlock');
  } else if (owns('heather_root')) {
    const resist = Math.ceil((actor.getRollData?.()?.proficiency ?? 0) / 2);
    if (resist > 0) {
      hpLoss = Math.max(0, hpLoss - resist);
      mitigation = game.i18n.format('SACADIA.Insane.HeatherRoot', { resist });
    }
  }
  const update = {};
  if (hpLoss > 0) update['system.health.value'] = Math.max(0, (actor.system.health?.value ?? 0) - hpLoss);
  // A Boiled Leech (Focus): "whenever you would lose HP from an insane effect, those targets also lose that
  // HP" — the raw loss, even when Writhing Block / Heather Root spare you.
  const leeched = [];
  if ((actor.system.combatState?.focusRounds?.a_boiled_leech ?? 0) > 0 && n > 0) {
    for (const u of actor.system.marks?.leech ?? []) {
      const doc = await fromUuid(u);
      const t = doc?.actor ?? doc;
      if (!t) continue;
      await t.update({ 'system.health.value': (t.system.health?.value ?? 0) - n });
      leeched.push(t.name);
    }
  }
  // Roll 8 grants +1 AP this turn (on top of the just-reset economy). Roll 2's "−1 AP if unable to
  // attack" is player-adjudicated (you may be able to), so it's surfaced as text, not auto-deducted.
  if (n === 8) update['system.ap.value'] = (actor.system.ap?.value ?? 0) + 1;
  if (Object.keys(update).length) await actor.update(update);

  const hpLine = hpLoss > 0
    ? game.i18n.format('SACADIA.Insane.HpLoss', { hp: hpLoss })
    : game.i18n.localize('SACADIA.Insane.NoLoss');
  const parts = [
    `<p><strong>${game.i18n.localize('SACADIA.Insane.Effect' + n)}</strong></p>`,
    `<p>${hpLine}${mitigation ? ` <em>(${mitigation})</em>` : ''}</p>`,
    n === 8 ? `<p>${game.i18n.localize('SACADIA.Insane.ApGained')}</p>` : '',
    leeched.length ? `<p>${game.i18n.format('SACADIA.Madness.Leech', { n, names: leeched.join(', ') })}</p>` : '',
    // Mind Map: "expend one Prescient Point to re-roll 1D8 on the Insane table … Choose which roll you take."
    (forced == null && owns('mind_map') && (actor.system.classPools?.prescient?.value ?? 0) > 0)
      ? `<p><button type="button" data-action="mindMap" data-actor="${actor.uuid}" data-first="${n}" data-hp="${hpLoss}">${game.i18n.localize('SACADIA.Madness.MindMap')}</button></p>` : '',
    `<p class="hint">${game.i18n.localize('SACADIA.Insane.Boost')}</p>`,
  ].join('');
  const insaneCard = {
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${game.i18n.localize('SACADIA.Insane.Title')}</strong>`,
    content: `<div class="sacadia insane-roll">${parts}</div>`,
    rolls: [roll],
  };
  // Honor the chat's visibility mode (create doesn't apply it — see #postCard in the sheet).
  ChatMessage.applyMode(insaneCard);
  await ChatMessage.create(insaneCard);
}

/**
 * Mind Map (owner button on the Insane-table card): spend a Prescient point, roll the table again, and keep
 * either result. Keeping the new one refunds the first roll's HP loss before applying the second.
 */
export async function onMindMap(event) {
  event.preventDefault();
  const ds = event.currentTarget.dataset;
  const actor = await fromUuid(ds.actor);
  if (!actor?.isOwner) return;
  const pv = actor.system.classPools?.prescient?.value ?? 0;
  if (pv < 1) return ui.notifications.warn(game.i18n.localize('SACADIA.Madness.NoPrescient'));
  event.currentTarget.disabled = true;
  await actor.update({ 'system.classPools.prescient.value': pv - 1 });
  const r = await new Roll('1d8').evaluate();
  await postRollCard({ actor, roll: r, icon: 'fa-solid fa-brain', title: 'Mind Map', meta: [game.i18n.format('SACADIA.Madness.MindMapFirst', { n: ds.first })] });
  const keepNew = await confirmWarn('Mind Map', game.i18n.format('SACADIA.Madness.MindMapPick', { first: ds.first, second: r.total }));
  if (!keepNew) return;
  // Undo the first result's HP loss, then run the table with the kept roll.
  await actor.update({ 'system.health.value': (actor.system.health?.value ?? 0) + (Number(ds.hp) || 0) });
  await rollInsaneTable(actor, r.total);
}

/** Tear down every Focus this actor maintains: clear the focus counters and marks; syncFocus then deletes the anchors
 *  (reaping their grants), zones and cloud layers. */
export async function endAllFocus(actor) {
  const update = {};
  if (Object.keys(actor.system.marks ?? {}).length) update['system.marks'] = replaceWith({});
  if (Object.keys(actor.system.combatState?.focusRounds ?? {}).length) update['system.combatState.focusRounds'] = replaceWith({});
  if (Object.keys(update).length) await actor.update(update);
  await syncFocus(actor);
}
