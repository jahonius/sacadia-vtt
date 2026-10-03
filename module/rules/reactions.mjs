/**
 * Post-roll reactions at runtime (the registry is helpers/post-roll.mjs): offering them on a resolved attack and
 * applying the one a player picks.
 */
import { POST_ROLL, eligiblePostRolls } from '../helpers/post-roll.mjs';
import { actorToken, allied, tokenDistance } from '../helpers/actor-utils.mjs';
import { applyConditionDeltas } from '../helpers/conditions.mjs';
import { applyDamageTo, incomingDr, restoreHitSnapshot } from './damage.mjs';
import { applyGrant } from './grants.mjs';
import { damageAfterDr, effectiveDefenseValue } from '../helpers/derivation.mjs';

/**
 * Plain context for the pure post-roll registry (see module/helpers/post-roll.mjs) — everything an
 * entry's `eligible` / `die` / `cap` reads, so the helper stays free of Foundry globals.
 */
export function postRollCtx(reactor, { sub, targetUuid, target }) {
  const sys = reactor.system;
  return {
    owned: new Set(reactor.items.filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean)),
    opts: sys._rollOptions?.() ?? {},
    level: sys.level ?? 0,
    prof: sys.proficiency ?? 0,
    stats: Object.fromEntries(Object.keys(CONFIG.SACADIA.stats).map((k) => [k, sys.stats?.[k]?.value ?? 0])),
    madness: sys.conditions?.madness?.value ?? 0,
    reactionAvailable: (sys.reaction?.value ?? 0) >= 1,
    pools: Object.fromEntries(Object.entries(sys.classPools ?? {}).map(([k, v]) => [k, v?.value ?? 0])),
    lore: sys.lorePoints?.value ?? 0,
    cracked: sys.professionResources?.oracle?.cracked ?? [],
    flags: { ...(reactor.getFlag('sacadia', 'turnFlags') ?? {}), ...(reactor.getFlag('sacadia', 'restFlags') ?? {}) },
    focusRounds: sys.combatState?.focusRounds ?? {},
    reactorMarks: sys.marks ?? {},
    targetUuid,
    targetPinned: target?.system?.conditions?.pinned?.value ?? 0,
    // Is the target inside one of the reactor's Swarm clouds? (Armor Nics: Clouded Foe; Sacrificial Wing: Clouded Ally.)
    targetInCloud: Object.fromEntries(['foe', 'ally'].map((k) => [k, [...(actorToken(target)?.document?.regions ?? [])]
      .some((r) => r.flags?.sacadia?.zone?.cloud === k && r.flags.sacadia.zone.casterUuid === reactor.uuid)])),
    sub,
  };
}

/**
 * Render the GM buttons for every post-roll option available on this resolved row. Reactors: the
 * attacker, the defender, and other tokens friendly to either within an entry's range.
 * @returns {string} HTML
 */
export function postRollControls({ req, sub, uuid, attacker, target, hit, hpBefore, tempBefore }) {
  if (!attacker || !target) return '';
  const subCtx = { ...sub, defenseKey: req.defenseKey };
  const aTok = actorToken(attacker);
  const tTok = actorToken(target);
  const friendly = allied;
  const rows = [];
  const offer = (reactor, side, subject) => {
    const ctx = postRollCtx(reactor, { sub: subCtx, targetUuid: uuid, target });
    for (const e of eligiblePostRolls(ctx, { side, hit })) {
      if (subject && reactor !== subject) {
        const from = e.rangeFrom === 'attacker' ? aTok : (side === 'attackerAlly' ? aTok : tTok);
        const d = tokenDistance(actorToken(reactor), from);
        const range = (e.steadiedRange && ctx.opts['self:steadied']) ? e.steadiedRange : (e.range ?? 5);
        if (d == null || d > range) continue;
      }
      rows.push({ e, reactor });
    }
  };
  offer(attacker, 'attacker');
  offer(target, 'defender');
  for (const t of canvas?.tokens?.placeables ?? []) {
    const r = t.actor;
    if (!r) continue;
    if (r !== attacker && friendly(t, aTok)) offer(r, 'attackerAlly', attacker);
    if ((r !== target || false) && friendly(t, tTok)) offer(r, 'defenderAlly', target);
  }
  // Some "you or an ally" reactions can be used by the one who was hit, too (Black Rebuke, Blend In).
  if (hit) {
    const ctx = postRollCtx(target, { sub: subCtx, targetUuid: uuid, target });
    for (const e of eligiblePostRolls(ctx, { side: 'defenderAlly', hit }).filter((x) => x.includeSelf)) {
      if (e.rangeFrom === 'attacker') {
        const d = tokenDistance(tTok, aTok);
        if (d == null || d > (e.range ?? 30)) continue;
      }
      rows.push({ e, reactor: target });
    }
  }
  if (!rows.length) return '';
  const btns = rows.map(({ e, reactor }) => `<button type="button" data-action="postRoll" data-key="${e.id}"`
    + ` data-reactor="${reactor.uuid}" data-attacker="${req.attackerUuid}" data-target="${uuid}"`
    + ` data-defense="${req.defenseKey}" data-tohit="${sub.toHitTotal}" data-natural="${sub.natural ?? 0}"`
    + ` data-damage="${sub.damage ?? 0}" data-dtype="${sub.damageType ?? ''}" data-critfloor="${sub.critFloor ?? 20}" data-hp="${hpBefore}" data-temp="${tempBefore}" class="post-roll">`
    + `${foundry.utils.escapeHTML(e.label)}${reactor !== attacker && reactor !== target ? ` (${foundry.utils.escapeHTML(reactor.name)})` : ''}</button>`);
  return `<div class="post-roll-controls">${btns.join('')}</div>`;
}

/** Prompt the GM for an amount (0..cap). Returns the number, or null if dismissed. */
export async function promptAmount(title, label, cap) {
  const read = (event, button, dialog) =>
    Math.max(0, Math.min(cap, Math.round(Number(dialog.element.querySelector('[name="amt"]')?.value) || 0)));
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `<div class="adv-prompt"><label>${label}</label>
      <input type="number" name="amt" value="${cap}" min="0" max="${cap}" step="1" autofocus/></div>`,
    buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.PostRoll.Confirm'), default: true, callback: read }],
    rejectClose: false,
  });
}

/**
 * Execute a post-roll option (GM-side). Computes the new to-hit (raise / reroll / force / reduce) and
 * re-checks it against the hidden defense, or moves the damage (redirect / reflect); charges the
 * reactor's costs; and posts a public receipt (no defense numbers) plus a GM whisper with apply controls.
 */
export async function onPostRoll(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const ds = event.currentTarget.dataset;
  const entry = POST_ROLL[ds.key];
  if (!entry) return;
  const resolve = async (u) => { const d = await fromUuid(u); return d?.actor ?? d; };
  const reactor = await resolve(ds.reactor);
  const attacker = await resolve(ds.attacker);
  const target = await resolve(ds.target);
  if (!reactor || !attacker || !target) return;
  const sub = { toHitTotal: Number(ds.tohit), natural: Number(ds.natural), damage: Number(ds.damage) || 0, defenseKey: ds.defense, damageType: ds.dtype || '',
    critFloor: Number(ds.critfloor) || 20 };
  const ctx = postRollCtx(reactor, { sub, targetUuid: ds.target, target });
  const title = entry.label;

  // --- the to-hit change (or the damage move) ---
  let newTotal = sub.toHitTotal;
  let bonusDamage = 0;
  let fareLine = '';
  let detail = '';
  const costUpd = {};
  if (entry.kind === 'raise') {
    let delta;
    if (entry.spend) {
      const max = entry.spend.max(ctx);
      const n = await promptAmount(title, game.i18n.format('SACADIA.PostRoll.SpendPrompt', { resource: game.i18n.localize(CONFIG.SACADIA.conditions[entry.spend.resource]?.label ?? entry.spend.resource), max }), max);
      if (!n) return;
      const die = entry.die(ctx);
      const r = await new Roll(`${n}${die.slice(1)}`).evaluate();
      delta = r.total;
      if (entry.addsDamage) bonusDamage = r.total;
      costUpd[`system.conditions.${entry.spend.resource}.value`] = Math.max(0, (reactor.system.conditions?.[entry.spend.resource]?.value ?? 0) - n);
      detail = `${n}${die.slice(1)} = ${r.total}`;
    } else if (entry.fixed) {
      delta = entry.fixed(ctx);
      detail = `+${delta}`;
    } else {
      const cap = entry.cap(ctx);
      delta = await promptAmount(title, game.i18n.format('SACADIA.PostRoll.RaisePrompt', { cap }), cap);
      if (!delta) return;
      detail = `+${delta}`;
    }
    newTotal += delta;
  } else if (entry.kind === 'reroll') {
    const r = await new Roll('1d20').evaluate();
    newTotal = sub.toHitTotal - sub.natural + r.total;
    detail = `d20 ${sub.natural} → ${r.total}`;
  } else if (entry.kind === 'force') {
    newTotal = Number.POSITIVE_INFINITY;
  } else if (entry.kind === 'crit') {
    // Torq of Thorns: the reactor pays Spell Slots to stretch the crit range down to the natural roll — a critical hit.
    const n = entry.slots(ctx);
    costUpd['system.classPools.spell.value'] = Math.max(0, (reactor.system.classPools?.spell?.value ?? 0) - n);
    newTotal = Number.POSITIVE_INFINITY;
    detail = game.i18n.format('SACADIA.PostRoll.CritNow', { n });
  } else if (entry.kind === 'reduce' && entry.pickSaved) {
    // Pull the Strand: subtract one of the reactor's saved Slightly Cracked rolls, which is spent.
    const saved = [...(reactor.system.professionResources?.oracle?.cracked ?? [])];
    const res = await foundry.applications.api.DialogV2.wait({ window: { title }, rejectClose: false,
      content: `<p>${game.i18n.localize('SACADIA.Cracked.Pick')}</p>`, buttons: saved.map((v, i) => ({ action: String(i), label: `−${v}` })) });
    if (res == null) return;
    const v = saved.splice(Number(res), 1)[0];
    costUpd['system.professionResources.oracle.cracked'] = saved;
    newTotal -= v;
    detail = `−${v}`;
  } else if (entry.kind === 'reduce') {
    const die = entry.die?.(ctx);
    const r = die ? await new Roll(die).evaluate() : null;
    const flat = (entry.flat?.(ctx) ?? 0) + (entry.fixedReduce?.(ctx) ?? 0);
    newTotal -= (r?.total ?? 0) + flat;
    detail = `−(${die ? `${die} ${r.total}` : ''}${flat ? `${die ? ' +' : ''}${flat}` : ''})`;
  } else if (entry.kind === 'fare') {
    // Balanced Fare (a miss by X → the attacking ally takes XD6, then hits) / Harmed Fare (a hit by X over the defense →
    // the reactor takes XD6, then it misses).
    const def = target.system?.defenses ?? {};
    const eff = effectiveDefenseValue(def[sub.defenseKey]?.value, def.ad?.value);
    const margin = Math.max(0, entry.on === 'miss' ? eff - sub.toHitTotal : sub.toHitTotal - eff);
    const payer = entry.on === 'miss' ? attacker : reactor;
    const payerUuid = entry.on === 'miss' ? ds.attacker : reactor.uuid;
    const die = entry.fareDie(ctx);
    if (margin > 0) {
      const r = await new Roll(`${margin}${die}`).evaluate();
      detail = `${margin}${die} = ${r.total} → ${payer.name}`;
      fareLine = await applyDamageTo(payer, payerUuid, r.total, null, '');
    }
    newTotal = entry.on === 'miss' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }

  // --- costs & side effects on the reactor ---
  const u = entry.onUse ?? {};
  if (u.reaction) costUpd['system.reaction.value'] = Math.max(0, (reactor.system.reaction?.value ?? 0) - 1);
  if (u.ap) costUpd['system.ap.value'] = Math.max(0, (reactor.system.ap?.value ?? 0) - u.ap);
  if (u.pool) costUpd[`system.classPools.${u.pool.key}.value`] = Math.max(0, (reactor.system.classPools?.[u.pool.key]?.value ?? 0) - u.pool.n);
  if (u.setFlag) costUpd[`flags.sacadia.turnFlags.${u.setFlag}`] = true;
  if (u.setRestFlag) costUpd[`flags.sacadia.restFlags.${u.setRestFlag}`] = true;
  if (u.lore) costUpd['system.lorePoints.value'] = Math.max(0, (reactor.system.lorePoints?.value ?? 0) - u.lore);
  if (u.clearMadness) costUpd['system.conditions.madness.value'] = 0;
  if (Object.keys(costUpd).length) await reactor.update(costUpd);
  // Self-given conditions (Remaneuver's "Gain 2 Sting") stack onto the levels you have (designer's ruling).
  const selfConds = Object.entries(u.selfConditions ?? {}).map(([condition, amount]) => ({ condition, amount, self: true }));
  if (selfConds.length) await applyConditionDeltas(reactor, selfConds);
  for (const [k, n] of Object.entries(u.targetConditionDelta?.(ctx) ?? {})) {
    await target.update({ [`system.conditions.${k}.value`]: Math.max(0, Math.min(CONFIG.SACADIA.conditionStoreMax, (target.system.conditions?.[k]?.value ?? 0) + n)) });
  }

  const gm = ChatMessage.getWhisperRecipients('GM').map((x) => x.id);
  let gmLine = `${title} (${reactor.name})`;
  let publicText;

  if (['raise', 'reroll', 'force', 'reduce', 'fare', 'crit'].includes(entry.kind)) {
    const def = target.system?.defenses ?? {};
    const eff = effectiveDefenseValue(def[sub.defenseKey]?.value, def.ad?.value);
    // An 'any' option (Torq of Thorns) can follow a hit or a miss — read which from the original roll.
    const wasHit = entry.on === 'hit' || (entry.on === 'any' && sub.toHitTotal >= eff);
    const nowHit = newTotal >= eff;
    const outcome = game.i18n.localize(nowHit ? 'SACADIA.Card.Hit' : 'SACADIA.Card.Miss');
    const shown = Number.isFinite(newTotal) ? newTotal : (newTotal > 0 ? '✓' : '✗');
    gmLine += `: ${sub.toHitTotal} ${detail} = ${shown} vs ${String(sub.defenseKey).toUpperCase()} ${eff} → ${outcome}${fareLine}`;
    publicText = game.i18n.format('SACADIA.PostRoll.Public', { label: title, name: reactor.name, target: target.name, outcome });
    if (!wasHit && nowHit && sub.damage + bonusDamage > 0) {
      gmLine += await applyDamageTo(target, ds.target, sub.damage + bonusDamage, attacker, ds.attacker);
    } else if (wasHit && !nowHit) {
      // A landed hit turned aside: restore the pre-hit Health snapshot (idempotent with the Undo button).
      await restoreHitSnapshot(target, ds);
      gmLine += ` · ${game.i18n.format('SACADIA.PostRoll.Restored', { name: target.name, hp: ds.hp })}`;
      const rider = entry.onConvert?.(ctx);
      if (rider?.damageToAttacker) {
        const r = await new Roll(rider.damageToAttacker).evaluate();
        gmLine += ` · ${rider.label} ${r.total}` + await applyDamageTo(attacker, ds.attacker, r.total, reactor, reactor.uuid);
      }
    }
  } else if (entry.kind === 'redirect') {
    // Someone else takes the landed damage: restore the target's snapshot, then apply the moved share
    // (less any reduction) to the recipient — the reactor, or the soulbound target for Soulbinding.
    // Book p.192 (v1.2): "DR is applied at the moment a target is hit … the DR applies to the total damage
    // (before being split across targets) if the attack is made against a target with DR. If the attack is
    // made to a target without DR, but shared with a target who has DR, DR is not applied." So the attacked
    // target's DR comes off the whole hit, and neither share applies DR again.
    const share = entry.share ?? 1;
    const targetDr = (target.system.defenses?.dr?.value ?? 0) + incomingDr(target, attacker, sub, sub.defenseKey);
    const total = damageAfterDr(sub.damage, targetDr);
    const moved = Math.max(0, Math.ceil(total * share) - (entry.reduction?.(ctx) ?? 0));
    const kept = total - Math.ceil(total * share);
    await restoreHitSnapshot(target, ds);
    if (kept > 0) gmLine += await applyDamageTo(target, ds.target, kept, attacker, ds.attacker, { ignoreDr: true });
    let recipient = reactor;
    let recipientUuid = reactor.uuid;
    if (entry.redirectTo) {
      const markUuid = (reactor.system.marks?.[entry.redirectTo] ?? [])[0];
      recipient = markUuid ? await resolve(markUuid) : null;
      recipientUuid = markUuid;
    }
    if (recipient && moved > 0) gmLine += await applyDamageTo(recipient, recipientUuid, moved, attacker, ds.attacker, { ignoreDr: true });
    publicText = game.i18n.format('SACADIA.PostRoll.Redirect', { label: title, name: reactor.name, target: target.name, amount: moved });
  } else if (entry.kind === 'shield') {
    // Damage cut after the hit landed (Checkered Shield: to a minimum of 1; Absorb Attack banks what it absorbed onto
    // the reactor's next damaging attack). DR already came off the whole hit, so the re-application skips it.
    const targetDr = (target.system.defenses?.dr?.value ?? 0) + incomingDr(target, attacker, sub, sub.defenseKey);
    const total = damageAfterDr(sub.damage, targetDr);
    const r = await new Roll(entry.die(ctx)).evaluate();
    const kept = Math.max(entry.minDamage ?? 0, total - r.total);
    const absorbed = Math.max(0, total - kept);
    await restoreHitSnapshot(target, ds);
    gmLine += `: ${entry.die(ctx)} = ${r.total}`;
    if (kept > 0) gmLine += await applyDamageTo(target, ds.target, kept, attacker, ds.attacker, { ignoreDr: true });
    if (entry.storeAsDamage && absorbed > 0) {
      await applyGrant({ casterUuid: reactor.uuid, ability: ds.key, label: title, targets: [reactor.uuid],
        changes: [{ key: 'system.bonuses.damage.all', mode: 2, value: String(absorbed) }], duration: { type: 'consumed', on: 'attack' } });
    }
    publicText = game.i18n.format('SACADIA.PostRoll.Shield', { label: title, name: reactor.name, amount: absorbed });
  } else if (entry.kind === 'retaliate') {
    const amount = entry.damage(ctx);
    if (amount > 0) gmLine += await applyDamageTo(attacker, ds.attacker, amount, reactor, reactor.uuid);
    publicText = game.i18n.format('SACADIA.PostRoll.Reflect', { label: title, name: reactor.name, attacker: attacker.name, amount });
  } else if (entry.kind === 'retarget') {
    // Roll among the reactor's allies within 5ft (including the reactor); the attack re-aims at the rolled one.
    const rTok = actorToken(reactor);
    const pool = (canvas?.tokens?.placeables ?? []).filter((t) => t.actor && (t === rTok
      || (allied(t, rTok) && (tokenDistance(t, rTok) ?? 99) <= 5)));
    const r = await new Roll(`1d${Math.max(1, pool.length)}`).evaluate();
    const chosen = pool[r.total - 1];
    const cActor = chosen?.actor;
    if (!cActor || cActor === target) {
      gmLine += `: 1d${pool.length} = ${r.total} → ${target.name} (unchanged)`;
      publicText = game.i18n.format('SACADIA.PostRoll.Retarget', { label: title, name: target.name });
    } else {
      await restoreHitSnapshot(target, ds);
      const def = cActor.system?.defenses ?? {};
      const eff = effectiveDefenseValue(def[sub.defenseKey]?.value, def.ad?.value);
      const nowHit = sub.toHitTotal >= eff;
      gmLine += `: 1d${pool.length} = ${r.total} → ${cActor.name}: ${sub.toHitTotal} vs ${String(sub.defenseKey).toUpperCase()} ${eff} → `
        + game.i18n.localize(nowHit ? 'SACADIA.Card.Hit' : 'SACADIA.Card.Miss') + ` (${game.i18n.localize('SACADIA.PostRoll.RangeNote')})`;
      if (nowHit && sub.damage > 0) gmLine += await applyDamageTo(cActor, chosen.document.uuid, sub.damage, attacker, ds.attacker);
      publicText = game.i18n.format('SACADIA.PostRoll.Retarget', { label: title, name: cActor.name });
    }
  } else if (entry.kind === 'reflect') {
    gmLine += await applyDamageTo(attacker, ds.attacker, sub.damage, reactor, reactor.uuid);
    publicText = game.i18n.format('SACADIA.PostRoll.Reflect', { label: title, name: reactor.name, attacker: attacker.name, amount: sub.damage });
  }

  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: reactor }), content: `<div class="sacadia gm-note">${publicText}</div>` });
  await ChatMessage.create({ whisper: gm, content: `<div class="sacadia gm-note">${gmLine}</div>` });
}
