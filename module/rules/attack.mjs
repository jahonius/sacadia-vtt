/**
 * Attack resolution, GM-side: hit or miss against the hidden defense, damage, on-hit triggers, and the reaction
 * opportunities a hit or miss opens.
 */
import { actorCheckDc, applyDamageTo, conditionControl, critControls, fireKillTriggers, hpControls, incomingDr, runOnKill, stripDamage, swarmEffectsCap } from './damage.mjs';
import { actorToken, ownsAbility, tokenDistance } from '../helpers/actor-utils.mjs';
import { afterHit, grantsFrom } from '../helpers/prestige.mjs';
import { applyOnUseInflict, explodeAround } from './effects.mjs';
import { applySelfDamage, conditionAttemptAllowed, conditionImmune, mergeInflicts } from '../helpers/conditions.mjs';
import { consumeGrants } from './grants.mjs';
import { damageAfterDr, effectiveDefenseValue, poolsAfterDamage } from '../helpers/derivation.mjs';
import { postRollControls } from './reactions.mjs';

/**
 * Whisper an actor's player owner(s) — or the GM if it has none — that a reaction window is open,
 * listing the eligible reaction abilities. The shared back-end for both auto-prompts (attack + movement).
 * Deliberately does *not* decide which reaction's trigger fits: applicability is the player's call.
 * @param {Actor} actor          The reacting actor.
 * @param {Item[]} reactions      The reaction abilities to list.
 * @param {string} headline       Localized prompt line (the trigger context).
 */
export function whisperReactions(actor, reactions, headline) {
  if (!reactions.length) return;
  const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission?.(u, 'OWNER'));
  const whisper = (owners.length ? owners : ChatMessage.getWhisperRecipients('GM')).map((u) => u.id);
  const names = reactions.map((r) => `<span class="reaction-opt">${r.name}</span>`).join('');
  ChatMessage.create({
    whisper,
    content: `<div class="sacadia reaction-prompt"><div class="reaction-head"><i class="fa-solid fa-bolt"></i> ${headline}</div>`
      + `<div class="reaction-list">${names}</div></div>`,
  });
}

/**
 * Auto-prompt a reaction opportunity on a resolved attack (book p.237): when a targeted defender (a)
 * owns reaction-tag abilities and (b) still has a reaction this round, surface the window. Spending is
 * done from the sheet, which decrements the reaction — so this fires at most once per defender per round.
 * @param {Actor} target        The defending actor (already token→actor resolved).
 * @param {string} outcomeLabel  Localized "Hit"/"Miss" for context.
 */
export function reactionOpportunity(target, outcomeLabel) {
  if ((target?.system?.reaction?.value ?? 0) < 1) return;
  const reactions = (target.items ?? []).filter((i) => i.type === 'ability' && i.system?.tag === 'reaction');
  whisperReactions(target, reactions, game.i18n.format('SACADIA.Reaction.Prompt', { target: target.name, outcome: outcomeLabel }));
}

/**
 * Triggers that fire off the running per-target hit tallies after an attack resolves (GM-side):
 *  - Step and Stop: the third unique enemy you damage this turn → recover one exhausted limb (a button on
 *    a card to the attacker, reusing the crit self-recovery handler).
 *  - Exhaustive Rage: while raging, the fifth hit on one enemy this round → it makes a Power check vs your
 *    Check DC or gains Debilitated (a save card the target's side rolls).
 */
export async function hitTriggers({ attacker, subs, prevHits, hitsByTarget, newHitTargets = [], gm }) {
  const owns = (id) => ownsAbility(attacker, id);
  // Covering Fire: "If you successfully hit at least three targets within 10ft of your allies with a bow attack
  // on your turn, those allies have half cover until the start of your next turn." Fires when a bow hit takes
  // the turn's unique-target count to 3; allies within 10ft of any target hit get Half Cover (cleared with the
  // Soldier-style granted-cover sweep at the attacker's next turn).
  const unique = Object.keys(hitsByTarget ?? {}).length;
  if (owns('covering_fire') && subs.some((x) => x.weaponType === 'bow') && Object.keys(prevHits ?? {}).length < 3 && unique >= 3
    && game.combat?.combatant?.actor === attacker) {
    const aTok = actorToken(attacker);
    const hitToks = [];
    for (const u of Object.keys(hitsByTarget)) { const d = await fromUuid(u); const tk = d?.object ?? actorToken(d?.actor ?? d); if (tk) hitToks.push(tk); }
    const allies = (canvas?.tokens?.placeables ?? []).filter((t) => t !== aTok && t.actor
      && (t.document.disposition ?? 0) === (aTok?.document?.disposition ?? 0)
      && hitToks.some((h) => (tokenDistance(t, h) ?? Infinity) <= 10));
    if (allies.length) {
      await applyOnUseInflict({ targetUuids: allies.map((t) => t.document.uuid), inflicts: [], cover: 'half', casterUuid: attacker.uuid });
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: `<div class="sacadia">Covering Fire: ${allies.map((t) => t.name).join(', ')} — Half Cover until ${attacker.name}'s next turn.</div>` });
    }
  }
  // Glidestep: after a 5ft adjust this turn, a melee hit on a new target recovers the adjust.
  if (owns('bd_glidestep') && newHitTargets.length && subs.some((x) => x.melee)
    && (attacker.system.actionLog ?? []).some((e) => e.key === 'basic:fiveFootAdjust')) {
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div class="sacadia gm-note">${game.i18n.localize('SACADIA.Trigger.Glidestep')}</div>` });
  }
  const uniqueBefore = Object.keys(prevHits).length;
  const uniqueAfter = Object.keys(hitsByTarget).length;
  if ((owns('step_and_stop') || owns('bd_step_and_stop')) && uniqueBefore < 3 && uniqueAfter >= 3
    && Object.values(attacker.system.exhaustion ?? {}).some(Boolean)) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div class="sacadia gm-note">${game.i18n.localize('SACADIA.Trigger.StepAndStop')}`
        + `<div class="crit-self"><button type="button" data-action="critSelf" data-effect="limb" data-amount="1" data-attacker="${attacker.uuid}">`
        + `${game.i18n.localize('SACADIA.Trigger.RecoverLimb')}</button></div></div>`,
    });
  }
  if (owns('thug_exhaustive_rage') && attacker.statuses?.has('raging') && subs.some((x) => x.melee)) {
    const dc = actorCheckDc(attacker);
    for (const [u, n] of Object.entries(hitsByTarget)) {
      if ((prevHits[u] ?? 0) < 5 && n >= 5) {
        const tDoc = await fromUuid(u);
        const t = tDoc?.actor ?? tDoc;
        if (!t || (t.system.conditions?.debilitated?.value ?? 0) > 0) continue;
        const label = game.i18n.localize(CONFIG.SACADIA.conditions.debilitated.label);
        const inflict = foundry.utils.escapeHTML(JSON.stringify([{ condition: 'debilitated', level: 1, label }]));
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="sacadia">${game.i18n.format('SACADIA.Trigger.ExhaustiveRage', { name: t.name })}`
            + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="power" data-dc="${dc}" data-inflict="${inflict}" data-caster="${attacker.uuid}">`
            + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc})</button></div></div>`,
        });
      }
    }
  }
}

/**
 * Resolve a PC/NPC attack against each targeted token (GM-side only — the player may not even have the NPC's defenses on
 * their client): hit or miss against the *hidden* defense, damage applied, and the result injected back into the same
 * card (which already shows the to-hit and damage dice). The target's defense, DR, applied amount and remaining Health
 * stay in a separate GM-only whisper.
 */
export async function resolveAttack(message, req) {
  const mode = game.settings.get('sacadia', 'combatResolutionMode');
  const attacker = await fromUuid(req.attackerUuid);
  const pcOffense = attacker?.type === 'character';
  // Auto-apply: PC offense in default/fullAuto, or fullAuto in either direction. NPC→PC is never
  // auto-applied outside fullAuto — the GM decides (the fudging seam).
  const autoApply = mode === 'fullAuto' || (mode === 'default' && pcOffense);
  const gm = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);

  const resultRows = []; // player-visible hit/miss, injected into the card (no secret numbers)
  const gmLines = [];    // GM-only comparison + DR + resulting HP
  let anyHit = false;    // for the attacker's consecutive-hit / attacks-this-turn counters
  const hitTargets = [];  // one entry per landed hit (a target hit twice appears twice)

  // Sub-attacks: a multi-attack (Wild Strike / Dagger Threat) carries several independent to-hit + damage
  // rolls in `req.attacks`, each vs its own target(s). A single attack wraps its top-level fields into one
  // sub, so the common path is byte-for-byte unchanged. `label` prefixes each row when there's more than one.
  const subs0 = req.attacks ?? [{
    toHitTotal: req.toHitTotal, damage: req.damage, crit: req.crit, inflict: req.inflict,
    critVariants: req.critVariants, critConditions: req.critConditions, critBudget: req.critBudget,
    targetUuids: req.targetUuids, label: '',
  }];
  // Piercing Pin: one to-hit through two creatures in a line — the first targeted takes full damage, the
  // second half (rounded up). Split into per-target subs so each resolves (and applies) on its own.
  const subs = subs0.flatMap((x) => (x.halfAfterFirst && (x.targetUuids ?? []).length > 1)
    ? x.targetUuids.slice(0, 2).map((u, i) => ({ ...x, targetUuids: [u], damage: i ? Math.ceil((x.damage ?? 0) / 2) : x.damage }))
    : [x]);

  for (const sub of subs) {
    const atkPrefix = subs.length > 1 && sub.label ? `${sub.label} · ` : '';
    for (const uuid of sub.targetUuids ?? []) {
      const doc = await fromUuid(uuid);
      const target = doc?.actor ?? doc; // TokenDocument → its actor
      const defenses = target?.system?.defenses;
      if (!defenses) continue;

      // Stored Momentum (on the target): the next attack against it from anyone but its Pinned foe compares
      // d20s — if the stored roll is higher, the attack hits that Pinned foe instead. Spent either way; lost
      // if the foe has no Pin left.
      const sm = target.getFlag('sacadia', 'storedMomentum');
      const atkTokU = actorToken(attacker)?.document?.uuid;
      if (sm && atkTokU && atkTokU !== sm.pinned) {
        await target.unsetFlag('sacadia', 'storedMomentum');
        const pd = await fromUuid(sm.pinned);
        const pa = pd?.actor ?? pd;
        if (pa && (pa.system.conditions?.pinned?.value ?? 0) > 0 && sm.d20 > (sub.natural ?? 0)) {
          resultRows.push(`<div class="resolution-row"><span class="target">${atkPrefix}${target.name}</span><b class="miss">${game.i18n.format('SACADIA.Boost.Redirected', { name: pa.name })}</b></div>`);
          gmLines.push(`${atkPrefix}${target.name}: Stored Momentum ${sm.d20} > ${sub.natural} → hits ${pa.name}`
            + (sub.damage > 0 ? await applyDamageTo(pa, sm.pinned, sub.damage, attacker, req.attackerUuid) : ''));
          continue;
        }
      }
      const eff = effectiveDefenseValue(defenses[req.defenseKey]?.value, defenses.ad?.value);
      // Unconscious (book p.230): "Any attacks made against you hit, even if they would miss, unless the
      // target rolls a natural 1."
      // Masterful Stepping (Lore): "all enemy attacks would miss you even if they would hit".
      const hit = (target.system.bonuses?.untouchable ?? 0) > 0 ? false
        : sub.autoHit || (target.statuses?.has('unconscious') ? sub.natural !== 1 : sub.toHitTotal >= eff);
      if (hit) { anyHit = true; hitTargets.push(uuid); }
      // Pained Bash: "If you hit, lose X HP" — paid by the attacker per hit.
      if (hit && sub.selfCostOnHit > 0 && attacker) {
        await applySelfDamage(attacker, sub.selfCostOnHit);
        gmLines.push(`${attacker.name}: −${sub.selfCostOnHit} HP (self-cost)`);
      }
      // Pre-damage snapshot, captured before any auto-apply reduces HP — the damage + crit variant buttons
      // set HP/temp absolutely from here, so they stay correct regardless of the auto-applied base damage.
      const hpBefore0 = target.system.health?.value ?? 0;
      // Spirit Sap (boost to Chill Touch): "Remove all temporary HP they possess. Damage … is applied after the removal."
      if (hit && sub.stripTempHp && (target.system.health?.temp ?? 0) > 0) {
        await target.update({ 'system.health.temp': 0 });
        gmLines.push(game.i18n.format('SACADIA.Prestige.TempStripped', { name: target.name }));
      }
      const tempBefore0 = target.system.health?.temp ?? 0;
      // Catnap: "Any attack made against them while they are unconscious is treated as Surprised (but immediately wakes
      // them up)." The Surprised part fed the roll; the wake happens now, hit or miss.
      const naps = grantsFrom(target, 'mg_catnap');
      if (naps.length) {
        await target.deleteEmbeddedDocuments('ActiveEffect', naps.map((e) => e.id));
        gmLines.push(game.i18n.format('SACADIA.Prestige.CatnapWake', { name: target.name }));
      }
      // A crit (kept natural d20 ≥ the attacker's crit floor, flagged on the roll card) is reported when
      // the attack also lands — the roller chooses their critical effect from the card's chooser (Phase 2).
      const crit = sub.crit && hit;
      const outcome = game.i18n.localize(hit ? 'SACADIA.Card.Hit' : 'SACADIA.Card.Miss');
      const critTag = crit ? ` <span class="crit-tag">${game.i18n.localize('SACADIA.Card.Critical')}</span>` : '';

      resultRows.push(`<div class="resolution-row"><span class="target">${atkPrefix}${target.name}</span><b class="${hit ? 'hit' : 'miss'}">${outcome}</b>${critTag}</div>`);
      let gmLine = `${atkPrefix}${target.name}: ${sub.toHitTotal} vs ${req.defenseKey.toUpperCase()} ${eff} → ${outcome}${crit ? ' (CRIT)' : ''}`;

      if (hit && sub.damage) {
        const dr = (defenses.dr?.value ?? 0) + incomingDr(target, attacker, sub, req.defenseKey);
        // Sting: "+X to all damage you take" (×2 per level under Waspnest) — added after DR.
        const applied = await swarmEffectsCap(target, damageAfterDr(sub.damage, dr) + (target.system.damageTaken ?? 0), sub);
        // Temp HP (book p.223) absorbs before real HP; both outcomes deplete it first. Absolute pools →
        // idempotent buttons that also restore temp on undo.
        const drPools = poolsAfterDamage(hpBefore0, tempBefore0, applied);       // damage soaked by DR
        const fullPools = poolsAfterDamage(hpBefore0, tempBefore0, sub.damage);  // DR bypassed
        // Auto-apply defaults to the DR outcome; the GM can flip to full or undo via the buttons. DR
        // being dodged by certain attacks is a GM call (not auto-detected), hence the manual control.
        if (autoApply && (drPools.value < hpBefore0 || drPools.temp < tempBefore0)) {
          await target.update({ 'system.health.value': drPools.value, 'system.health.temp': drPools.temp, 'system.combatState.tookDamage': true });
          // Auto-applied a killing blow (bypassing the manual buttons): fire the attacker's kill triggers here.
          if (drPools.value <= 0 && hpBefore0 > 0) { await fireKillTriggers(attacker); await runOnKill(target); }
          // Armor of Itthoa: temp HP lost to this hit is dealt back to the attacker.
          await afterHit(target, attacker, { tempBefore: tempBefore0, tempAfter: drPools.temp });
          // Consumption (Lore): "For the rest of your turn, whatever damage you do, gain one fourth that much temporary HP
          // (rounded up)" — the turn's running total, so temp HP (which doesn't stack) tracks a quarter of it.
          if ((attacker?.system.bonuses?.drainQuarter ?? 0) > 0) {
            const dealt = (hpBefore0 + tempBefore0) - (drPools.value + drPools.temp);
            const sum = (attacker.getFlag('sacadia', 'turnFlags')?.consumed ?? 0) + Math.max(0, dealt);
            await attacker.update({ 'flags.sacadia.turnFlags.consumed': sum,
              'system.health.temp': Math.max(attacker.system.health?.temp ?? 0, Math.ceil(sum / 4)) });
          }
        }
        // Scorching Weapon (Fatebound): "As long as you maintain Focus, whenever you make a [weapon] attack and successfully
        // hit a target, deal fire damage equal to your Power to all additional enemies within 5ft of that target."
        if (attacker && (attacker.system.combatState?.focusRounds?.scorching_weapon ?? 0) > 0 && ownsAbility(attacker, 'scorching_weapon')) {
          const tTok = actorToken(target);
          const aDisp = actorToken(attacker)?.document?.disposition ?? 0;
          const power = attacker.system.stats?.power?.value ?? 0;
          for (const t of canvas?.tokens?.placeables ?? []) {
            if (!t.actor || t === tTok || t.actor === attacker || power <= 0) continue;
            const d = t.document.disposition ?? 0;
            if (d === 0 || d === aDisp || (tokenDistance(t, tTok) ?? 99) > 5) continue;
            gmLine += ` · Scorching Weapon →` + await applyDamageTo(t.actor, t.document.uuid, power, attacker, req.attackerUuid, { damageType: 'fire' });
          }
        }
        // Offer to mark an NPC Dead only when the damage is actually lethal (full outcome hits 0 real HP).
        const canMarkDead = fullPools.value <= 0 && target.type === 'npc';
        gmLine += ` · dmg ${sub.damage}${dr ? `, DR ${dr}` : ''}${tempBefore0 ? `, temp ${tempBefore0}` : ''}`
          + hpControls(uuid, { applied, raw: sub.damage, drPools, fullPools, hpBefore: hpBefore0, tempBefore: tempBefore0, autoApply, canMarkDead, attackerUuid: req.attackerUuid });
        // Consume any "reduce your next incoming damage" grant on this target (Blessing of the Shield) —
        // its DR already fed the `dr` read above, so it applied to this hit; now it's spent.
        await consumeGrants(target, 'damage-taken');
      }

      // Inflicted conditions — same GM-controlled apply structure as damage: on a hit, the GM clicks
      // to give the leveled condition (absolute set from the snapshotted current level, so idempotent).
      if (hit) {
        // Save-to-negate inflicts (Slinger: hit, then a Finesse Check negates the Fatigue) are surfaced to
        // the *target's* player as a "Roll Save to Negate" button on the visible card — reusing onSaveRoll,
        // which applies the condition on a failed save. DC is the attacker's Check DC. Plain inflicts keep
        // the GM-side direct-apply control.
        const subInflicts = mergeInflicts(sub.inflict);
        const negates = subInflicts.filter((inf) => inf.saveNegate);
        for (const inf of subInflicts.filter((inf) => !inf.saveNegate)) {
          // No re-application (book p.258): a condition the target already has isn't attempted again.
          if (!conditionAttemptAllowed(target, inf.condition, inf.stacks)) {
            gmLine += ` · ${inf.label}: ${game.i18n.localize(conditionImmune(target, inf.condition) ? 'SACADIA.Save.Immune' : 'SACADIA.Save.AlreadyHas')}`;
            continue;
          }
          const before = target.system.conditions?.[inf.condition]?.value ?? 0;
          const after = Math.min(CONFIG.SACADIA.conditionStoreMax, before + inf.level);
          gmLine += conditionControl(uuid, inf, before, after);
        }
        if (negates.length) {
          // Characters carry a per-slot Check DC object; NPCs a flat number. Take whichever shape applies.
          const dcRaw = attacker?.system?.checkDc;
          const dc = ((typeof dcRaw === 'number' ? dcRaw : dcRaw?.primary) ?? 10) + (sub.saveDcBonus ?? 0);
          // Group by trait so one button per save trait carries all conditions it negates.
          const byTrait = {};
          for (const inf of negates) (byTrait[inf.saveNegate] ??= []).push({ condition: inf.condition, level: inf.level, label: inf.label });
          for (const [trait, infs] of Object.entries(byTrait)) {
            const traitLabel = game.i18n.localize(CONFIG.SACADIA.stats[trait] ?? trait);
            const names = infs.map((i) => i.label).join(', ');
            resultRows.push(`<div class="resolution-row save-negate"><span class="target">${atkPrefix}${target.name}: ${names}</span>`
              + `<button type="button" data-action="rollSave" data-trait="${trait}" data-dc="${dc}" data-inflict="${foundry.utils.escapeHTML(JSON.stringify(infs))}">`
              + `${game.i18n.localize('SACADIA.Card.SaveNegate')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc} · ${traitLabel})</button></div>`);
            gmLine += ` · ${names}: ${traitLabel} save (DC ${dc}) to negate`;
          }
        }
      }
      // Crit chooser (Phase 2): on a landed crit, offer the roller's picked-effect apply buttons — the
      // damage variants (Maximize / Critical Harm, from a snapshot of pre-damage HP) and the target
      // condition choices (Slamming Prone, …). Self / positional effects stay on the player card.
      if (crit) {
        gmLine += critControls(uuid, sub, { dr: (defenses.dr?.value ?? 0) + incomingDr(target, attacker, sub, req.defenseKey), hpBefore: hpBefore0, tempBefore: tempBefore0 }, target);
      }
      // Boostbane's graze: a miss by no more than the margin still deals the stepped-down base dice.
      if (!hit && sub.graze && eff - sub.toHitTotal <= sub.graze.margin) {
        const r = await new Roll(sub.graze.dice).evaluate();
        gmLine += ` · ${sub.graze.label} ${sub.graze.dice} = ${r.total}` + await applyDamageTo(target, uuid, r.total, attacker, req.attackerUuid);
      }
      // Remember an on-kill rider (Tear Apart) on a hit, for whichever path commits the kill.
      if (hit && sub.onKill) await target.setFlag('sacadia', 'pendingOnKill', { attackerUuid: req.attackerUuid, ...sub.onKill });
      // Post-roll options (module/helpers/post-roll.mjs): reactions and passives decided *after* the
      // to-hit is known — attacker-side on a miss (Remaneuver, Combo Breaker, Lucky Strike, Good Hit …),
      // defender-side on a hit (Block, Dodge, Quick Defense) and damage redirection (Sacrifice, Lend a Wing,
      // Black Rebuke …). Offered GM-side (the hidden-defense authority) as buttons; `onPostRoll` applies.
      gmLine += postRollControls({ req, sub, uuid, attacker, target, hit, hpBefore: hpBefore0, tempBefore: tempBefore0 });
      // Auto-prompt the defender's reaction window (book p.237). When a targeted actor owns reaction
      // abilities and still has a reaction this round, whisper its owner that the window is open — the
      // player judges which (if any) applies. The reaction economy naturally limits this to once/round.
      reactionOpportunity(target, outcome);
      // One-shot "the next attack against them" grants (Carrying the Team's shield, Stot) are spent now.
      await consumeGrants(target, 'attacked');
      // Vengeful Tactics (on the target): an enemy whose Attack of Opportunity damages you on your turn
      // counts as a new target again — drop it from your attacked-this-turn set.
      if (hit && sub.opportunity && sub.damage > 0 && ownsAbility(target, 'bd_vengeful_tactics')) {
        const aTok = actorToken(attacker)?.document?.uuid;
        const list = target.system.combatState?.attackedTargetsThisTurn ?? [];
        if (aTok && list.includes(aTok)) await target.update({ 'system.combatState.attackedTargetsThisTurn': list.filter((x) => x !== aTok) });
      }
      gmLines.push(gmLine);
    }
  }

  // Advance the attacker's auto-counters (see docs/conditional-modifiers.md): every resolved attack
  // increments attacks-this-turn; a hit extends the consecutive-hit streak, a whiff breaks it. One
  // update per attack action (not per target), GM-side (the authority that resolved it).
  if (attacker) {
    const cs = attacker.system.combatState ?? {};
    const shield = req.weaponType === 'shield';
    // New-target tracking (Bowman / Hawkeye): targets not yet attacked this turn; a hit on one bumps
    // the new-target count. The `target:new` roll option is read at roll time *before* this update.
    const attacked = cs.attackedTargetsThisTurn ?? [];
    const targets = subs.flatMap((s) => s.targetUuids ?? []); // every target across all sub-attacks
    const newTargets = targets.filter((u) => !attacked.includes(u));
    const newHits = anyHit ? newTargets.length : 0; // single-target attacks: exact; multi: approximated
    const prevHits = cs.hitsByTarget ?? {};
    const hitsByTarget = { ...prevHits };
    for (const u of hitTargets) hitsByTarget[u] = (hitsByTarget[u] ?? 0) + 1;
    // Unique targets hit while each maintained Focus runs (Multiplicity).
    const focusTargets = foundry.utils.deepClone(cs.focusTargets ?? {});
    for (const cid of Object.keys(cs.focusRounds ?? {})) {
      focusTargets[cid] = Array.from(new Set([...(focusTargets[cid] ?? []), ...hitTargets]));
    }
    await attacker.update({
      // A multi-attack (Wild Strike) counts as several attacks this turn — one per sub-attack rolled.
      'system.combatState.attacksThisTurn': (cs.attacksThisTurn ?? 0) + subs.length,
      'system.combatState.consecutiveHits': anyHit ? (cs.consecutiveHits ?? 0) + 1 : 0,
      // Missed-attack streak (Aim Calibration) — resets to the running count on a hit, +1 on a whiff.
      'system.combatState.missedAttacksThisTurn': (cs.missedAttacksThisTurn ?? 0) + (anyHit ? 0 : 1),
      'system.combatState.newTargetsHitThisTurn': (cs.newTargetsHitThisTurn ?? 0) + newHits,
      'system.combatState.attackedTargetsThisTurn': Array.from(new Set([...attacked, ...targets])),
      'system.combatState.hitsByTarget': hitsByTarget,
      'system.combatState.focusTargets': focusTargets,
      // Shield combos (Flurry of Shields / One-Two Bash) count shield attacks and hits separately.
      ...(shield ? {
        'system.combatState.shieldAttacksThisTurn': (cs.shieldAttacksThisTurn ?? 0) + 1,
        'system.combatState.shieldHitsThisTurn': (cs.shieldHitsThisTurn ?? 0) + (anyHit ? 1 : 0),
      } : {}),
    });
    // Consume any "on your next attack" grant on the attacker — its bonus already fed the rolled
    // damage in the attacker's own card; now it's spent.
    await consumeGrants(attacker, 'attack');
    const newHitTargets = hitTargets.filter((u) => !attacked.includes(u));
    // Exploding Weapon: the thrown named weapon's damage lands on every other creature within 5ft of the target.
    if (req.explode?.centerUuid && req.explode.damage > 0) {
      const cd = await fromUuid(req.explode.centerUuid);
      const center = cd?.object ?? actorToken(cd?.actor ?? cd);
      if (center) await explodeAround(attacker, req.attackerUuid, req.explode, { center });
    }
    // Grandstrike: "When you use Wild Strike and hit at least three targets, increase the damage dealt to each
    // target by half your Proficiency (rounded up)."
    const uniqueHit = Array.from(new Set(hitTargets));
    if (subs.some((x) => x.abilityId === 'wild_strike') && uniqueHit.length >= 3 && ownsAbility(attacker, 'grandstrike')) {
      const extra = Math.ceil((attacker.system.proficiency ?? 0) / 2);
      const lines = [];
      for (const u of uniqueHit) {
        const d = await fromUuid(u);
        const t = d?.actor ?? d;
        if (t && extra > 0) lines.push(await applyDamageTo(t, u, extra, attacker, req.attackerUuid));
      }
      if (lines.length) await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((x) => x.id),
        content: `<div class="sacadia gm-note">Grandstrike +${extra}${lines.join('')}</div>` });
    }
    await hitTriggers({ attacker, subs, prevHits, hitsByTarget, newHitTargets, gm: ChatMessage.getWhisperRecipients('GM').map((u) => u.id) });
    // On-hit pending buff (Reaching Claw: the target counts as Prone for your next attack this turn).
    if (anyHit && req.onHitPending) {
      const b = req.onHitPending;
      await attacker.update({ 'system.pendingAttack': [...(attacker.system.pendingAttack ?? []),
        { advantage: b.advantage ?? 0, toHit: b.toHit ?? 0, damage: b.damage ?? 0, dieStep: 0, targetCondition: b.targetCondition ?? '', label: b.label ?? '' }] });
    }
  }

  // Inject the hit/miss result into the original card, replacing its empty resolution slot, so it
  // sits with the to-hit + damage dice as one card (falls back to appending for older cards).
  if (resultRows.length) {
    const marker = '<div class="card-resolution" data-resolution></div>';
    const filled = `<div class="card-resolution">${resultRows.join('')}</div>`;
    let content = message.content.includes(marker)
      ? message.content.replace(marker, filled)
      : message.content + filled;
    // Full miss (a target was resolved but none were hit): strip the damage roll and its receipts
    // from the card — the dice landed on nothing, so don't advertise damage that was never dealt.
    if (!anyHit) content = stripDamage(content);
    await message.update({ content });
  }
  if (gmLines.length) {
    await ChatMessage.create({ whisper: gm, content: `<div class="sacadia gm-note">${gmLines.join('<br>')}</div>` });
  }
}
