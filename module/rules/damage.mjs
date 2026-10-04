/**
 * Applying damage GM-side: DR and typed resistance, Sting, Swarm Effects' cap, kill triggers, Check DCs, and the GM's
 * HP / condition / critical controls on a resolved card.
 */
import { actorToken, opposed, ownsAbility, tokenDistance } from '../helpers/actor-utils.mjs';
import { cloudContext } from '../helpers/zones.mjs';
import { conditionAttemptAllowed, conditionImmune } from '../helpers/conditions.mjs';
import { damageAfterDr, evaluatePredicate, poolsAfterDamage, resolveModifierValue, typedResistance } from '../helpers/derivation.mjs';
import { replaceWith } from '../helpers/update-ops.mjs';
import { postRollCard } from '../helpers/chat-cards.mjs';

/**
 * Fire an attacker's kill triggers — the effects that go off when it drops a target to 0 HP (book: "if
 * you kill…"). GM-side (called from the damage-apply seam: resolveAttack auto-apply + onApplyHp/onMarkDead,
 * each guarding the from-alive→dead transition so it fires once). Two effect shapes:
 *   - `condition`: bank a next-target pending buff (Killing Frenzy → Surprised) — the pending-attack
 *     subsystem folds it into the attacker's next attack this turn.
 *   - `tempHp`: grant temp HP from the highest level tier ≤ the attacker's level (Indomitable Beast),
 *     non-stacking (the higher of new-vs-current), shown as a public roll.
 * @param {Actor} attacker
 */
export async function fireKillTriggers(attacker) {
  if (!attacker) return;
  // Flowing Robes (adornment): "When you kill an enemy, gain 1 HP."
  if (attacker.system._rollOptions?.()['self:gear:flowing-robes']) {
    const hp = attacker.system.health ?? {};
    await attacker.update({ 'system.health.value': Math.min(hp.max ?? Infinity, (hp.value ?? 0) + 1) });
  }
  const abilities = (attacker.items ?? []).filter((i) => i.type === 'ability' && i.system?.killTrigger
    && (i.system.killTrigger.condition || i.system.killTrigger.tempHp?.length));
  for (const item of abilities) {
    const kt = item.system.killTrigger;
    if (kt.condition) {
      await attacker.update({ 'system.pendingAttack': [...(attacker.system.pendingAttack ?? []),
        { targetCondition: kt.condition, label: item.name }] });
      ui.notifications?.info?.(game.i18n.format('SACADIA.Kill.Banked', { label: item.name }));
    }
    if (kt.tempHp?.length) {
      const level = attacker.system.level ?? 1;
      const tier = kt.tempHp.filter((t) => level >= (t.minLevel ?? 0)).sort((a, b) => (b.minLevel ?? 0) - (a.minLevel ?? 0))[0];
      if (tier) {
        const roll = await new Roll(tier.formula).evaluate();
        await postRollCard({ actor: attacker, roll, icon: 'fa-solid fa-heart-circle-plus', title: item.name, tag: game.i18n.localize('SACADIA.Card.TempHpGrant'),
          meta: [game.i18n.localize('SACADIA.Kill.OnKill')] });
        await attacker.update({ 'system.health.temp': Math.max(attacker.system.health?.temp ?? 0, roll.total) });
      }
    }
  }
}

/** An actor's Check DC as a flat number: NPCs store one; characters derive it per profession slot. */
export function actorCheckDc(actor) {
  const cd = actor?.system?.checkDc;
  if (typeof cd === 'number') return cd;
  if (cd && typeof cd === 'object') return cd.primary ?? cd.secondary ?? null;
  return null;
}

/**
 * Situational damage resistance the *defender* gets against this particular attack — `incomingDr`
 * modifiers on the target's abilities, evaluated from the target's side with the attack described as
 * `attack:melee|ranged|magic`, `attack:physical`, `attack:defense:<pd|…>`, `attack:from:mark:<key>` (the
 * attacker's token is in one of the target's marks — Resilient Foe vs your Targeted Foe, Skittish Step vs
 * your Skittish target), and `self:surrounded` (Toughhide). Mastery of the Mage-Slayer: DR = Power vs MD.
 */
export function incomingDr(target, attacker, sub, defenseKey) {
  if (!target?.items) return 0;
  const atkTokUuid = actorToken(attacker)?.document?.uuid;
  // Physical = a physical damage type when the attack is typed; else any non-magic attack. Elemental damage "overcomes
  // physical weapon resistances" (Elemental Weapon), so it never meets physical-only DR.
  const group = CONFIG.SACADIA.damageTypes[sub.damageType]?.group ?? '';
  const physical = sub.damageType ? group === 'physical' : sub.category !== 'magic';
  const opts = {
    ...(target.system._rollOptions?.() ?? {}),
    [`attack:${sub.category || 'none'}`]: true,
    ...(physical ? { 'attack:physical': true } : {}),
    ...(sub.damageType ? { [`attack:type:${sub.damageType}`]: true, [`attack:group:${group}`]: true } : {}),
    ...(defenseKey ? { [`attack:defense:${defenseKey}`]: true } : {}),
    ...(sub.targetSurrounded ? { 'self:surrounded': true } : {}),
  };
  for (const [key, uuids] of Object.entries(target.system.marks ?? {})) {
    if (atkTokUuid && Array.isArray(uuids) && uuids.includes(atkTokUuid)) opts[`attack:from:mark:${key}`] = true;
  }
  const nums = target.system._modifierNumbers?.() ?? {};
  let dr = 0;
  for (const it of target.items) {
    if (it.type !== 'ability') continue;
    for (const m of it.system?.modifiers ?? []) {
      if (m.target !== 'incomingDr') continue;
      if (evaluatePredicate(m.predicate, opts)) dr += resolveModifierValue(m.value, nums);
    }
  }
  // Birdshield (v1.2 Trickster Tactic): "all allies within a space covered by Clouded Ally gain X DR (X = Proficiency)"
  // while its caster maintains it.
  for (const owner of cloudContext(actorToken(target)?.document).friendlyAlly) {
    if ((owner.system.combatState?.focusRounds?.birdshield ?? 0) > 0 && ownsAbility(owner, 'birdshield')) dr += owner.system.proficiency ?? 0;
  }
  // Typed resistances (book p.222): the target's list plus resistant armor, for this damage type. Negative values are
  // vulnerabilities, so this sum may go below zero (more damage).
  return Math.max(0, dr) + typedResistance(target.system.typedDr, sub.damageType ?? '', CONFIG.SACADIA.damageTypes);
}

/**
 * Swarm Effects (v1.2): while maintaining Clouded Foe or Clouded Ally *and* Swarm Effects, "attacks targeting a single
 * target cannot deal more than 5X damage to you after applying any DR you have (X = Proficiency). If an attack would
 * deal more damage than this to you, it ends your Focus on Swarm Effects." Returns the capped damage (and ends the
 * Focus when it bites).
 */
export async function swarmEffectsCap(target, applied, sub) {
  const fr = target.system.combatState?.focusRounds ?? {};
  if (!(fr.swarm_effects > 0) || !(fr.clouded_foe > 0 || fr.clouded_ally > 0) || (sub.targetUuids?.length ?? 1) > 1) return applied;
  const cap = 5 * (target.system.proficiency ?? 0);
  if (applied <= cap) return applied;
  const next = { ...fr };
  delete next.swarm_effects;
  await target.update({ 'system.combatState.focusRounds': replaceWith(next) });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: target }), content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Zone.SwarmEffects', { name: target.name, cap })}</div>` });
  return cap;
}

/**
 * An on-kill rider recorded on the victim by the killing attack (Tear Apart): "All enemies within 5ft of
 * you gain the Surprised Condition" — the attacker's enemies adjacent to the attacker — and, with Tearing
 * Fright, a Panic (½ Proficiency) save card for one of them. Spent once.
 */
export async function runOnKill(victim) {
  const ok = victim?.getFlag?.('sacadia', 'pendingOnKill');
  if (!ok) return;
  await victim.unsetFlag('sacadia', 'pendingOnKill');
  const ad = await fromUuid(ok.attackerUuid);
  const attacker = ad?.actor ?? ad;
  const aTok = actorToken(attacker);
  if (!attacker || !aTok) return;
  const near = (canvas?.tokens?.placeables ?? []).filter((t) => t.actor && t.actor !== victim
    && opposed(t, aTok) && (tokenDistance(t, aTok) ?? 99) <= 5);
  if (ok.adjacentSurprised) for (const t of near) await t.actor.toggleStatusEffect('surprised', { active: true });
  let content = game.i18n.format('SACADIA.Boost.OnKill', { label: ok.label, n: near.length });
  if (ok.panicOne) {
    const dc = actorCheckDc(attacker);
    const label = game.i18n.localize(CONFIG.SACADIA.conditions.panic.label);
    const level = Math.ceil((attacker.system.proficiency ?? 0) / 2);
    const inflict = foundry.utils.escapeHTML(JSON.stringify([{ condition: 'panic', level, label }]));
    content += `<div class="card-save"><button type="button" data-action="rollSave" data-trait="courage" data-dc="${dc}" data-inflict="${inflict}" data-caster="${attacker.uuid}">`
      + `${game.i18n.localize('SACADIA.Card.RollSave')} — Tearing Fright (${label} ${level})</button></div>`;
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: attacker }), content: `<div class="sacadia chat-card note-card">${content}</div>` });
}

/**
 * Remove the damage roll blocks and their modifier receipts from a rendered ability card, returning
 * the trimmed HTML. Used on a full miss so the card doesn't show damage it never dealt. DOM-parsed
 * (not regex) because a rendered Roll contains nested divs a naive pattern would truncate.
 * @param {string} content  The card's HTML.
 * @returns {string} content with `.card-roll.damage` and `.card-modifiers.damage-mods` removed.
 */
export function stripDamage(content) {
  const div = document.createElement('div');
  div.innerHTML = content;
  for (const el of div.querySelectorAll('.card-roll.damage, .card-modifiers.damage-mods')) el.remove();
  return div.innerHTML;
}

/**
 * GM-only HP controls for a resolved hit: three buttons that *set* the target's Health to an
 * absolute value (snapshotted from the pre-damage HP, so clicking is idempotent and switching
 * between them is safe) — soak DR, ignore DR (for attacks that bypass it), or undo. The DR outcome
 * is flagged `applied` when auto-apply already used it.
 * @returns {string} HTML
 */
export function hpControls(targetUuid, { applied, raw, drPools, fullPools, hpBefore, tempBefore, autoApply, canMarkDead, attackerUuid = '' }) {
  const t = (k) => game.i18n.localize(`SACADIA.Card.${k}`);
  // The attacker rides each button so the manual apply/mark-dead path can fire its kill triggers.
  const atk = attackerUuid ? ` data-attacker="${attackerUuid}"` : '';
  // Each button sets both real HP and temp HP absolutely (idempotent). A "→ hp (t:temp)" suffix shows the
  // remaining temp buffer only when there was one, so non-temp targets read exactly as before.
  const show = (p) => `${p.value}${tempBefore ? ` (${t('Temp')}:${p.temp})` : ''}`;
  const btn = (p, label, cls = '') =>
    `<button type="button" data-action="applyHp" data-target="${targetUuid}"${atk} data-hp="${p.value}" data-temp="${p.temp}" class="${cls}">${label}</button>`;
  return '<div class="hp-controls">'
    + btn(drPools, `${t('ApplyDr')} ${applied} → ${show(drPools)}`, autoApply ? 'applied' : '')
    + btn(fullPools, `${t('ApplyNoDr')} ${raw} → ${show(fullPools)}`)
    + btn({ value: hpBefore, temp: tempBefore }, `${t('Undo')} → ${show({ value: hpBefore, temp: tempBefore })}`, 'undo')
    + (canMarkDead ? `<button type="button" data-action="markDead" data-target="${targetUuid}"${atk} class="mark-dead">${t('MarkDead')}</button>` : '')
    + '</div>';
}

/**
 * GM-only apply/undo buttons for an inflicted condition: set the target's condition level to an
 * absolute snapshotted value (idempotent), or undo back to the prior level.
 * @returns {string} HTML
 */
export function conditionControl(targetUuid, inf, before, after) {
  const src = inf.source?.casterUuid ? ` data-source="${foundry.utils.escapeHTML(JSON.stringify(inf.source))}"` : '';
  // Rend's preferred armor type (Rend Armor's choice, Clever Rend).
  const pref = inf.prefer ? ` data-prefer="${inf.prefer}"` : '';
  const btn = (val, label, cls = '') =>
    `<button type="button" data-action="applyCondition" data-target="${targetUuid}" data-condition="${inf.condition}" data-value="${val}"${src}${pref} class="${cls}">${label}</button>`;
  return `<div class="cond-controls"><span class="cond-name">${inf.label} +${inf.level}</span>`
    + btn(after, `→ ${after}`, 'apply')
    + btn(before, `${game.i18n.localize('SACADIA.Card.Undo')} → ${before}`, 'undo')
    + '</div>';
}

/**
 * GM-only crit chooser (Phase 2): the roller's picked critical effect is applied here. Damage variants
 * (Maximize / Critical Harm) reuse the `applyHp` button with an absolute HP snapshot; the target
 * condition choices (Slamming Prone, Paralytic Paralysis, …) reuse `applyCondition`. The roller picks
 * from the card menu and the GM clicks the matching button — one per crit (budget shown), or more with
 * Overwhelm / Boosted Crit. Self / positional effects aren't here (they live on the player card).
 * @returns {string} HTML, or '' when nothing is mechanically applicable.
 */
export function critControls(targetUuid, req, { dr, hpBefore, tempBefore = 0 }, target) {
  const parts = [];
  const variantLabel = { maximize: 'Maximize', double: 'Critical Harm' };
  for (const [key, dmg] of Object.entries(req.critVariants ?? {})) {
    if (!dmg) continue;
    const p = poolsAfterDamage(hpBefore, tempBefore, damageAfterDr(dmg, dr));
    const show = `${p.value}${tempBefore ? ` (${game.i18n.localize('SACADIA.Card.Temp')}:${p.temp})` : ''}`;
    parts.push(`<button type="button" data-action="applyHp" data-target="${targetUuid}" data-hp="${p.value}" data-temp="${p.temp}" class="crit-opt">${variantLabel[key] ?? key} ${dmg}${dr ? ` (DR ${dr})` : ''} → ${show}</button>`);
  }
  for (const c of req.critConditions ?? []) {
    // A crit's condition choice is an attempt like any other: nothing to offer if the target already has it.
    if (!conditionAttemptAllowed(target, c.condition, c.stacks)) {
      parts.push(`<span class="crit-opt disabled">${c.label}: ${game.i18n.localize(conditionImmune(target, c.condition) ? 'SACADIA.Save.Immune' : 'SACADIA.Save.AlreadyHas')}</span>`);
      continue;
    }
    const before = target.system.conditions?.[c.condition]?.value ?? 0;
    const after = Math.min(CONFIG.SACADIA.conditionStoreMax, before + c.level);
    parts.push(`<button type="button" data-action="applyCondition" data-target="${targetUuid}" data-condition="${c.condition}" data-value="${after}" class="crit-opt">${c.label}: ${c.condition} → ${after}</button>`);
  }
  if (!parts.length) return '';
  const head = `${game.i18n.localize('SACADIA.Card.Critical')} — ${game.i18n.localize('SACADIA.Card.CritChoose')} ${req.critBudget ?? 1}`;
  return `<div class="crit-controls"><span class="crit-label">${head}</span>${parts.join('')}</div>`;
}

/**
 * Apply `raw` damage to an actor through its DR and temp HP (the same pipeline as a resolved hit),
 * firing the attacker's kill triggers on a killing blow. Returns the GM control HTML for adjustment.
 */
export async function applyDamageTo(actor, uuid, raw, attacker, attackerUuid = '', { ignoreDr = false, damageType = '' } = {}) {
  const def = actor.system?.defenses ?? {};
  const hpBefore = actor.system.health?.value ?? 0;
  const tempBefore = actor.system.health?.temp ?? 0;
  // Shared damage (book p.192): DR was already applied once, at the moment of the hit — not again per share. Typed
  // damage (Scorching Weapon's fire) also meets the actor's resistance to it.
  const dr = ignoreDr ? 0 : (def.dr?.value ?? 0) + (damageType ? typedResistance(actor.system.typedDr, damageType, CONFIG.SACADIA.damageTypes) : 0);
  // Sting's "+X to all damage you take" rides every damage application.
  const applied = raw > 0 ? damageAfterDr(raw, dr) + (actor.system.damageTaken ?? 0) : 0;
  const drPools = poolsAfterDamage(hpBefore, tempBefore, applied);
  const fullPools = poolsAfterDamage(hpBefore, tempBefore, raw);
  if (drPools.value < hpBefore || drPools.temp < tempBefore) {
    await actor.update({ 'system.health.value': drPools.value, 'system.health.temp': drPools.temp, 'system.combatState.tookDamage': true });
    if (attacker && drPools.value <= 0 && hpBefore > 0) { await fireKillTriggers(attacker); await runOnKill(actor); }
  }
  const canMarkDead = fullPools.value <= 0 && actor.type === 'npc';
  return ` · ${actor.name} dmg ${raw}${dr ? `, DR ${dr}` : ''}`
    + hpControls(uuid, { applied, raw, drPools, fullPools, hpBefore, tempBefore, autoApply: true, canMarkDead, attackerUuid });
}

/**
 * Put a target back to its pre-hit Health (a post-roll option turned the hit aside or re-applies it). Under Law of
 * Alliance the hit was split when it landed, so the other members' shares are refunded too (the re-applied amount, if
 * any, is then split afresh).
 */
export async function restoreHitSnapshot(target, ds) {
  await target.update({ 'system.health.value': Number(ds.hp), 'system.health.temp': Number(ds.temp) });
  const last = target.getFlag('sacadia', 'lastAllianceShare');
  if (!last?.entries?.length) return;
  for (const { uuid, amount } of last.entries) {
    const d = await fromUuid(uuid);
    const a = d?.actor ?? d;
    if (a) await a.update({ 'system.health.value': Math.min(a.system.health?.max ?? Infinity, (a.system.health?.value ?? 0) + amount) }, { sacadiaAlliance: true });
  }
  await target.unsetFlag('sacadia', 'lastAllianceShare');
}
