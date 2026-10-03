/**
 * Saves and condition checks: the save card's roll, its extension effects (save.ext), condition-resistance cards, and
 * zone check cards.
 */
import { actorCheckDc, applyDamageTo, hpControls } from './damage.mjs';
import { actorToken, confirmWarn, gmNote, ownsAbility } from '../helpers/actor-utils.mjs';
import { applyConditionDeltas, conditionAttemptAllowed, conditionImmune, mergeInflicts, promptCheckSpends, stackingCap } from '../helpers/conditions.mjs';
import { blackcloudDisadvantage, witchCheckAura } from '../helpers/auras.mjs';
import { checkContext, foldCheckModifiers, planPool, scorePool } from '../helpers/check-pool.mjs';
import { consumeGrants } from './grants.mjs';
import { damageAfterDr, evaluatePredicate, poolsAfterDamage, resolveModifierValue, sizeAdvantage, typedResistance } from '../helpers/derivation.mjs';
import { deleteKey, replaceWith } from '../helpers/update-ops.mjs';
import { grantsFrom } from '../helpers/prestige.mjs';

/**
 * A zone's Trait Check card for a creature in it (GM-side): DC = the caster's Check DC; damage (a dice formula,
 * rolled now) and inflicts land on a failure; `onSuccess: 'half'` halves the damage.
 */
export async function zoneSaveCard({ caster, target, trait, damage, onSuccess = 'none', inflict = [], text }) {
  const dc = actorCheckDc(caster);
  let dmg = 0; const rolls = [];
  // Formulas may read the caster's numbers (Sharp Cloud's "(@finesse)d10").
  if (damage) { const r = await new Roll(String(damage), caster.getRollData()).evaluate(); dmg = r.total; rolls.push(r); }
  const inf = (inflict ?? []).map((i) => ({ ...i, label: game.i18n.localize(CONFIG.SACADIA.conditions[i.condition]?.label ?? CONFIG.SACADIA.simpleConditions[i.condition]?.label ?? i.condition) }));
  const infAttr = inf.length ? foundry.utils.escapeHTML(JSON.stringify(inf)) : '';
  const tl = trait ? game.i18n.localize(CONFIG.SACADIA.stats[trait]) : '';
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: caster }), rolls,
    content: `<div class="sacadia">${text}`
      + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="${trait ?? ''}" data-dc="${dc}" data-damage="${dmg}" data-onsuccess="${onSuccess}"`
      + ` data-inflict="${infAttr}" data-casterpc="${caster.type === 'character' ? 1 : 0}" data-caster="${caster.uuid}">`
      + `${game.i18n.localize('SACADIA.Card.RollSave')} (${game.i18n.localize('SACADIA.Defense.CheckDC')} ${dc}${tl ? ` · ${tl}` : ''})</button></div></div>` });
}

/** A zone's automatic damage (no check — Focal Point). */
export async function zoneDamage({ caster, target, formula, label }) {
  const r = await new Roll(String(formula), caster.getRollData()).evaluate();
  await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: caster }), flavor: game.i18n.format('SACADIA.Zone.Damage', { zone: label, name: target.name }) });
  const line = await applyDamageTo(target.actor, target.uuid, r.total, caster, caster.uuid);
  await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id), content: `<div class="sacadia gm-note">${label}${line}</div>` });
}

/**
 * Resolve a condition-resistance roll (book p258) GM-side. The player rolled the dice pool and
 * declared the condition + how many dice were auto-failed by disadvantage; the DC stays hidden here.
 *   - **Targeted a source** with a readable Check DC → compare each kept die, auto-apply the failed
 *     levels to the resister, fill the card's outcome, and offer GM override buttons.
 *   - **No target / no DC** → whisper the dice to the GM with buttons to assign the failed levels.
 */
export async function resolveResist(message, req) {
  const rd = await fromUuid(req.resisterUuid);
  const resister = rd?.actor ?? rd;
  if (!resister) return;
  const sd = req.sourceUuid ? await fromUuid(req.sourceUuid) : null;
  const source = sd?.actor ?? sd;
  const reduce = req.mode === 'reduce';
  const cond = req.condition;
  // The source's own conditional bonus to its Check DC against this condition (Mastery of the Pin: +1
  // when the target checks against the Pin you gave them) — `checkDcVs` modifiers gated on `vs:*` atoms.
  // Or a named creature's own Check DC, with no source bonuses (Funnel Energy: "the Check DC of the target with Fatigue").
  const dd = !source && req.dcUuid ? await fromUuid(req.dcUuid) : null;
  let dc = source ? actorCheckDc(source) : (dd ? actorCheckDc(dd.actor ?? dd) : null);
  if (dc != null && source) {
    const vsOpts = { ...(source.system._rollOptions?.() ?? {}), [`vs:checking:${cond}`]: true, [`vs:${reduce ? 'resisting' : 'saving'}:${cond}`]: true };
    const nums = source.system._modifierNumbers?.() ?? {};
    for (const it of source.items) {
      if (it.type !== 'ability') continue;
      for (const m of it.system?.modifiers ?? []) {
        if (m.target !== 'checkDcVs') continue;
        if (evaluatePredicate(m.predicate, vsOpts)) dc += resolveModifierValue(m.value, nums);
      }
    }
  }

  const condLabel = game.i18n.localize(CONFIG.SACADIA.conditions[cond]?.label ?? cond);
  const cur = resister.system.conditions?.[cond]?.value ?? 0;
  const cap = CONFIG.SACADIA.conditionStoreMax;
  const levels = req.autoFail + req.keptTotals.length;
  const gm = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
  const fmt = (k, d) => game.i18n.format(`SACADIA.Resist.${k}`, d);
  // Reaction hint: the source may impose 1× disadvantage on a Make Trait Check against Pin it gave
  // (Dusted) — one success fewer. Its player spends the reaction from the Dusted item; the GM picks the value.
  const dusted = reduce && cond === 'pinned' && source && ownsAbility(source, 'thug_dusted')
    && (source.system.reaction?.value ?? 0) >= 1;

  if (dc != null) {
    // --- auto-resolve against the source's hidden Check DC ---
    const successes = req.keptTotals.filter((t) => t >= dc).length;
    const fails = req.autoFail + req.keptTotals.length - successes;
    const after = reduce ? Math.max(0, cur - successes) : Math.min(cap, cur + fails);
    if (after !== cur) await resister.update({ [`system.conditions.${cond}.value`]: after });
    // Funnel Energy: each success gives the other target 1 more AP on their next turn.
    let funnelNote = '';
    if (req.funnelTo && reduce && successes > 0) {
      const fd = await fromUuid(req.funnelTo);
      const other = fd?.actor ?? fd;
      if (other) {
        await other.setFlag('sacadia', 'apBonusNext', (other.getFlag('sacadia', 'apBonusNext') ?? 0) + successes);
        funnelNote = ` · ${game.i18n.format('SACADIA.Funnel.ApNext', { name: other.name, n: successes })}`;
      }
    }

    const outcome = (reduce
      ? (successes > 0 ? fmt('Removes', { n: successes, condition: condLabel }) : fmt('NoneRemoved', { condition: condLabel }))
      : (fails > 0 ? fmt('Takes', { n: fails, condition: condLabel }) : fmt('Resisted', { condition: condLabel }))) + funnelNote;
    fillResolution(message, `<span class="${(reduce ? successes > 0 : fails === 0) ? 'clean' : 'took'}">${outcome}</span>`);
    // GM whisper: the hidden comparison + override buttons (idempotent absolute sets).
    const detail = `${resister.name}: ${req.keptTotals.length} die(s) vs DC ${dc}`
      + (req.autoFail ? ` + ${req.autoFail} ${game.i18n.localize('SACADIA.Resist.Auto')}` : '')
      + (reduce ? ` → −${successes}` : ` → ${fails} ${game.i18n.localize('SACADIA.Resist.LevelsShort')}`)
      + (dusted ? ` · ${fmt('DustedHint', { name: source.name, value: Math.max(0, cur - Math.max(0, successes - 1)) })}` : '');
    await ChatMessage.create({
      whisper: gm,
      content: `<div class="sacadia gm-note">${detail}${conditionAssign(req.resisterUuid, cond, condLabel, cur, levels, reduce ? successes : fails, reduce)}</div>`,
    });
  } else {
    // --- no source DC: hand the dice to the GM to adjudicate ---
    fillResolution(message, `<span class="pending">${game.i18n.localize('SACADIA.Resist.ManualPending')}</span>`);
    const dice = req.keptTotals.map((t) => `<span class="rc-total">${t}</span>`).join(' ')
      + (req.autoFail ? ` <i>(+${req.autoFail} ${game.i18n.localize('SACADIA.Resist.Auto')})</i>` : '');
    const header = fmt(reduce ? 'ManualHeaderReduce' : 'ManualHeader', { name: resister.name, condition: condLabel });
    await ChatMessage.create({
      whisper: gm,
      content: `<div class="sacadia gm-note"><div>${header}</div><div class="rc-manual-dice">${dice}</div>`
        + `${conditionAssign(req.resisterUuid, cond, condLabel, cur, levels, null, reduce)}</div>`,
    });
  }
}

/** Replace a resist card's `data-resolution` slot with the resolved outcome HTML. */
export async function fillResolution(message, html) {
  const marker = /<div class="rc-resolution" data-resolution>.*?<\/div>/s;
  const filled = `<div class="rc-resolution">${html}</div>`;
  const content = marker.test(message.content) ? message.content.replace(marker, filled) : message.content + filled;
  await message.update({ content });
}

/**
 * GM-only buttons to set the resister's condition to `cur + n` for n in 0..levels (0 = "no levels").
 * `computed` (when known) is highlighted as the DC-derived result; the GM can still override.
 * Reuses the existing `applyCondition` action handler (absolute, idempotent, GM-gated).
 */
export function conditionAssign(resisterUuid, cond, condLabel, cur, levels, computed, reduce = false) {
  const btns = [];
  // Incoming levels add (cur + n); a Make Trait Check removes (cur − n).
  for (let n = 0; n <= levels; n++) {
    const cls = n === computed ? 'apply' : n === 0 ? 'undo' : '';
    const value = reduce ? Math.max(0, cur - n) : Math.min(CONFIG.SACADIA.conditionStoreMax, cur + n);
    btns.push(`<button type="button" data-action="applyCondition" data-target="${resisterUuid}" data-condition="${cond}" data-value="${value}" class="${cls}">${n}</button>`);
  }
  return `<div class="cond-controls"><span class="cond-name">${condLabel} ${reduce ? '−' : '+'}</span>${btns.join('')}</div>`;
}

/**
 * Roll a save against an ability (book p.218/p.258). For each condition the ability attempts to give,
 * the saver rolls one Trait Check per level (d20 + Proficiency + Trait + flat Trait bonuses) against the
 * caster's Check DC and takes one level per failure — the same per-level pool as the Resist popup
 * (advantage = extra dice kept best, disadvantage = auto-failures). A save with nothing to inflict is a
 * single check. Net advantage folds the caster's `saveAdvantage` (carried on the button), the saver's
 * advantage/disadvantage sinks, Prone (vs physical), and the saver's own check modifiers. A Fumble spends
 * on the first die. Save damage applies full on a failed check, half (`onsuccess=half`) or none on success.
 */
export async function onSaveRoll(event) {
  event.preventDefault();
  const ds = event.currentTarget.dataset;
  const trait = ds.trait || '';
  const dc = Number(ds.dc);
  const casterAdv = Number(ds.adv) || 0;
  const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn(game.i18n.localize('SACADIA.Card.NoSaveActor'));
  const loc = (k) => game.i18n.localize(k);
  // Save extensions (prestige abilities), resolved at cast — see `#saveExt` in the actor sheet:
  //  checks (a fixed number of checks), ignoreFumble, mode 'reduce' (successes remove levels), capAt, enduring,
  //  casterGain (per failed check: AP / a pool point / a condition level for the caster), perFail (deltas per failed
  //  check on the saver and/or another creature), onFail (AP debt, lost reactions), grant (applied to the saver on a
  //  failure), marginDice (damage = (DC − roll) dice), healTo (another creature heals the damage dealt), drainCeil.
  const ext = ds.ext ? JSON.parse(ds.ext) : {};
  // Mind Sliver on this saver: each failed check costs it a die of damage (read before the grant is spent).
  const failDie = actor.system.bonuses?.failDamageDie ?? 0;

  const rd = actor.getRollData();
  const baseMod = (trait ? Number(rd[trait]) || 0 : 0) + (Number(rd.proficiency) || 0) + (Number(rd.traitBonus) || 0);
  const items = actor.items.filter((i) => i.type === 'ability').map((i) => ({ name: i.name, modifiers: i.system.modifiers, id: i.flags?.sacadia?.catalogId, pickValue: i.system.pick?.kind ? (i.flags?.sacadia?.pickValue ?? '') : undefined }));
  const selfOpts = actor.system._rollOptions?.() ?? {};
  const nums = actor.system._modifierNumbers?.() ?? {};
  const sinks = (actor.system.advantage?.trait ?? 0) - (actor.system.disadvantage?.trait ?? 0);
  // Clumsy Touch: "they do not apply their Fumbled to these Checks".
  let fumble = ext.ignoreFumble ? 0 : (actor.system.conditions?.fumbled?.value ?? 0);
  const hadFumble = fumble > 0;

  const condPicks = actor.system._picks?.().condition ?? [];
  // The save's caster is one of the saver's marked foes → `self:saving:from:mark:<key>` (Skittish).
  const markOpts = {};
  let casterActor = null;
  if (ds.caster) {
    const cDoc = await fromUuid(ds.caster);
    casterActor = cDoc?.actor ?? cDoc;
    const cTok = actorToken(cDoc?.actor ?? cDoc)?.document?.uuid;
    for (const [key, list] of Object.entries(actor.system.marks ?? {})) {
      if (cTok && Array.isArray(list) && list.includes(cTok)) markOpts[`self:saving:from:mark:${key}`] = true;
    }
  }
  // Parts of one action giving the same condition are one attempt (no stacking — book p.258).
  const inflicts = mergeInflicts(ds.inflict ? JSON.parse(ds.inflict) : []);
  const checks = inflicts.length ? inflicts : [{ condition: '', level: 1, label: '' }];
  // Optional paid improvements (Confidence, Fateful Saves), offered once for the whole save.
  const unionCtx = Object.assign({ ...selfOpts }, ...checks.filter((c) => c.condition)
    .map((c) => checkContext(c.condition, CONFIG.SACADIA.conditions[c.condition]?.group ?? '', 'save', condPicks)));
  const spend = await promptCheckSpends(actor, unionCtx);
  const update = {};
  const rolls = [];
  const sections = [];
  let firstFailed = null; // drives save damage (the first pool's outcome)
  let firstFails = 0;      // levels failed in the first pool (Biting Pankration's per-level damage)
  let firstMargin = 0;     // how far the first kept check fell short of the DC (Backpress)
  let firstSuccesses = 0;  // checks passed in the first pool (reduce mode)

  for (const inf of checks) {
    const cond = inf.condition;
    const simple = !!cond && cond in CONFIG.SACADIA.simpleConditions;
    const reduce = ext.mode === 'reduce';
    // `self`: a check against your own effect (Endurance Mastery's rage-end Fatigue), which stacks.
    if (cond && !reduce && !conditionAttemptAllowed(actor, cond, inf.stacks, { self: inf.self })) {
      sections.push(`<div class="rc-sub">${inf.label}: ${loc(conditionImmune(actor, cond, { self: inf.self }) ? 'SACADIA.Save.Immune' : 'SACADIA.Save.AlreadyHas')}</div>`);
      // Saptouched (Lore): "If a target would attempt to give you Pin, you may expend a Lore Point to force them to make
      // Checks against Pin equal to the number of levels they try to give you" (against your Check DC).
      if (cond === 'pinned' && casterActor && ownsAbility(actor, 'lore_saptouched')
        && (actor.system.lorePoints?.value ?? 0) > 0
        && await confirmWarn('Saptouched', loc('SACADIA.Lore.SaptouchedAsk'))) {
        await actor.update({ 'system.lorePoints.value': (actor.system.lorePoints?.value ?? 0) - 1 });
        const cd = actor.system.checkDc;
        const sdc = (typeof cd === 'number' ? cd : cd?.primary) ?? 10;
        const back = foundry.utils.escapeHTML(JSON.stringify([{ condition: 'pinned', level: inf.level, label: inf.label }]));
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="sacadia">${game.i18n.format('SACADIA.Lore.Saptouched', { name: casterActor.name, n: inf.level })}`
            + `<div class="card-save"><button type="button" data-action="rollSave" data-trait="${trait}" data-dc="${sdc}" data-inflict="${back}" data-caster="${actor.uuid}">`
            + `${loc('SACADIA.Card.RollSave')} (${loc('SACADIA.Defense.CheckDC')} ${sdc})</button></div></div>` });
      }
      continue;
    }
    const levels = ext.checks != null ? Math.max(1, ext.checks) : (!cond || simple ? 1 : Math.max(1, inf.level));
    const group = CONFIG.SACADIA.conditions[cond]?.group ?? '';
    const ctxOpts = { ...selfOpts, ...(cond ? checkContext(cond, group, 'save', condPicks) : {}), ...(trait ? { [`self:checking:trait:${trait}`]: true } : {}),
      ...(ds.ability ? { [`self:saving:ability:${ds.ability}`]: true } : {}), ...markOpts };
    const own = foldCheckModifiers(items, ctxOpts, nums);
    // Prone: disadvantage on Trait Checks against physical conditions (book p.257).
    const proneDis = selfOpts['self:prone'] && /physical/i.test(group) ? 1 : 0;
    const cloudDis = blackcloudDisadvantage(actor, group);
    // Size (book p.225): against a Physical Effect (a physical condition, Prone, Dragged, a Kick) the bigger creature gets
    // 1X advantage per size step. High Wrestle: "You do not have disadvantage to give Wrestle Pin to creatures one size
    // larger than you, and you can give Wrestle Pin to creatures two sizes larger at 1x disadvantage."
    const physicalEffect = /physical/i.test(group) || ['prone', 'dragged'].includes(cond) || ds.ability === 'basic_kick';
    let sizeAdv = physicalEffect && casterActor ? sizeAdvantage(actor.system.sizeIndex ?? 3, casterActor.system.sizeIndex ?? 3) : 0;
    if (sizeAdv > 0 && cond === 'pinned' && casterActor?.items?.some((i) => i.flags?.sacadia?.catalogId === 'thug_high_wrestle')) sizeAdv -= 1;
    // Aura of the Grotto (+1) / Aura of Bane (−1): Witch auras on checks against adversarial conditions.
    const witchAura = cond ? witchCheckAura(actor) : 0;
    const net = casterAdv + sinks + own.adv + spend.adv - proneDis - cloudDis + witchAura + sizeAdv;
    const { poolCount, autoFail } = planPool(levels, net);
    let raws = [];
    if (poolCount > 0) {
      const r = await new Roll(`${poolCount}d20`).evaluate();
      rolls.push(r);
      raws = r.dice[0].results.map((x) => x.result);
    }
    // Guidance (Magus): add the guide's Fate to one die of the first Trait Check — a one-shot grant, spent here.
    const guided = actor.system.bonuses?.traitBonusOne ?? 0;
    const sc = scorePool(raws, { levels, net, mod: baseMod + own.bonus + spend.bonus, fumble, dc, bonusOne: (spend.bonusOne ?? 0) + guided,
      bonusCount: guided ? (actor.system.bonuses?.traitBonusCount ?? 0) : 0 });
    // Curse of the Shared Mind (Oracle): "whenever they would fail a Mental Trait Check against a roll imposed by an enemy,
    // they succeed instead, and you gain 1D3-1 points of Madness."
    const curse = /mental/i.test(group) && sc.fails > 0 && casterActor
      && (actorToken(casterActor)?.document?.disposition ?? 0) !== (actorToken(actor)?.document?.disposition ?? 0)
      ? grantsFrom(actor, 'curse_of_the_shared_mind')[0] : null;
    if (curse) {
      for (const e of sc.entries) if (!e.dropped) e.pass = true;
      sc.successes = sc.entries.filter((e) => !e.dropped).length; sc.fails = 0;
      const m = await new Roll('1d3-1').evaluate();
      if (m.total > 0) await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
        content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Prestige.SharedMind', { n: m.total })}</div>`,
        flags: { sacadia: { deltasOn: { uuid: curse.flags.sacadia.grantedBy.casterUuid, entries: [{ condition: 'madness', amount: m.total }] } } } });
    }
    if (guided) await consumeGrants(actor, 'roll');
    spend.bonusOne = 0; // "one roll" — spent on the first pool
    fumble = 0; // spent on the first check of the sequence (p.257)
    if (firstFailed === null) {
      // Stored Momentum: the saver's raw d20 against Harm is stored on the Thug (GM-routed).
      if (ds.momentum === '1' && ds.caster && raws.length) {
        await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
          content: `<div class="sacadia gm-note">Stored Momentum: d20 ${raws[0]}</div>`,
          flags: { sacadia: { storeMomentum: { uuid: ds.caster, d20: raws[0], pinned: actorToken(actor)?.document?.uuid ?? actor.uuid } } } });
      }
      firstFailed = sc.fails > 0;
      firstFails = sc.fails;
      firstSuccesses = sc.successes ?? 0;
      const kept = sc.entries.filter((e) => !e.dropped).map((e) => e.total);
      firstMargin = kept.length ? dc - Math.min(...kept) : (sc.fails > 0 ? Infinity : 0);
    }

    // Apply the levels taken.
    let taken = '';
    if (cond && reduce) {
      // Make-Trait-Check style (Give of Thyself): each success removes a level of the condition.
      const cur = actor.system.conditions?.[cond]?.value ?? 0;
      const next = Math.max(0, cur - (sc.successes ?? 0));
      update[`system.conditions.${cond}.value`] = next;
      taken = `${inf.label} ${next}`;
    } else if (cond && sc.fails > 0) {
      if (simple) {
        await actor.toggleStatusEffect(cond, { active: true });
        taken = inf.label;
      } else {
        const cur = actor.system.conditions?.[cond]?.value ?? 0;
        // Witch's Finger: "they gain one level (to a maximum of your Proficiency)".
        // Poured Mold: a stacking gain stops at the target's Focus-granted ceiling.
        const mold = cur > 0 && !inf.stacks && !inf.self ? stackingCap(actor, cond) : 0;
        const cap = ext.capAt != null ? Math.max(cur, ext.capAt) : (mold ? Math.max(cur, mold) : CONFIG.SACADIA.conditionStoreMax);
        const next = Math.min(cap, CONFIG.SACADIA.conditionStoreMax, cur + (simple ? 1 : sc.fails));
        update[`system.conditions.${cond}.value`] = next;
        // First application: record who gave it (Hemorrhage's die-steps, Wrestling Focus's Pin).
        if (cur === 0 && inf.source?.casterUuid) update[`system.conditions.${cond}.source`] = replaceWith(inf.source);
        // Luckless Hold: "The Jinxed you give that target are treated as Enduring."
        if (ext.enduring) update[`system.conditions.${cond}.enduring`] = true;
        taken = `${inf.label} ${next}`;
      }
    }
    const dice = [];
    for (let i = 0; i < autoFail; i++) dice.push(`<li class="rc-die fail auto">${loc('SACADIA.Resist.Auto')} <b>✗</b></li>`);
    for (const e of sc.entries) {
      const cls = e.dropped ? 'dropped' : (e.pass ? 'pass' : 'fail');
      dice.push(`<li class="rc-die ${cls}"><span class="rc-d20">${e.raw}</span><span class="rc-total">${e.total}</span> ${e.dropped ? loc('SACADIA.Resist.Dropped') : (e.pass ? '✓' : '✗')}</li>`);
    }
    const head = cond ? `${inf.label} (${levels})` : loc('SACADIA.Card.RollSave');
    const netNote = net ? ` · ${net > 0 ? '+' : ''}${net}× ${loc(net > 0 ? 'SACADIA.Roll.Advantage' : 'SACADIA.Roll.Disadvantage')}` : '';
    const notes = [...own.notes, ...spend.notes, ...(proneDis ? [loc('SACADIA.Simple.Prone')] : []), ...(cloudDis ? ['Blackcloud'] : []),
      ...(sizeAdv ? [`${loc('SACADIA.Size.Label')} ${sizeAdv > 0 ? '+' : ''}${sizeAdv}×`] : [])];
    sections.push(`<div class="rc-sub"><b>${head}</b>${netNote}${notes.length ? ` <small>(${notes.join(', ')})</small>` : ''}</div>`
      + `<ul class="rc-dice">${dice.join('')}</ul>`
      + `<div class="rc-sub">${cond ? (sc.fails > 0 ? `${loc('SACADIA.Card.SaveFailure')} → ${taken}` : loc('SACADIA.Card.SaveSuccess'))
        : loc(sc.fails > 0 ? 'SACADIA.Card.SaveFailure' : 'SACADIA.Card.SaveSuccess')}</div>`);
  }
  if (hadFumble) update['system.conditions.fumbled.value'] = 0;
  // Rend lands on the caster's preferred armor type first (Clever Rend).
  const rendPrefer = checks.find((c) => c.condition === 'rended' && c.prefer)?.prefer;
  if (Object.keys(update).length) await actor.update(update, rendPrefer ? { sacadiaRendPrefer: rendPrefer } : {});
  await consumeGrants(actor, 'roll');
  await applySaveExtensions(actor, ext, { ds, firstFailed, firstFails, firstSuccesses, sections });

  // Save damage: full on a failed check; half (rounded down) or none on success. Backpress: a failure by
  // the margin or more takes the pre-rolled one-step-higher variant instead.
  let dmg = Number(ds.damage) || 0;
  if (ds.margin && ds.altdamage && firstFailed && firstMargin >= Number(ds.margin)) dmg = Number(ds.altdamage) || dmg;
  // Runic Scars: "they take XD4 damage, where X is the difference between their roll and your Check DC".
  if (ext.marginDice && firstFailed && Number.isFinite(firstMargin) && firstMargin > 0) {
    const r = await new Roll(`${firstMargin}${ext.marginDice}`).evaluate();
    rolls.push(r);
    dmg += r.total;
  }
  // Mind Sliver: "takes 1D4 mental damage for each failed Trait Check made" (1D6 @5, 1D8 @11).
  if (failDie > 0 && firstFails > 0) {
    const r = await new Roll(`${firstFails}d${failDie}`).evaluate();
    rolls.push(r);
    dmg += r.total;
  }
  // Per-failed-level damage (Biting Pankration): 1 die per level taken.
  if (ds.perlevel && firstFails > 0) {
    // Sealslam: 2D6 per level taken (`perFailCount` dice per failure).
    const r = await new Roll(`${firstFails * (ext.perFailCount ?? 1)}d${ds.perlevel}`).evaluate();
    rolls.push(r);
    dmg += r.total;
  }
  // A pending buff for the caster when this save fails (Sapped Fates: +1 to-hit on the caster's next attack
  // per enemy given Fumble; Sapping Strike adds +1 damage). GM-routed — the saver may not own the caster.
  if (ds.pending && firstFailed && ds.caster) {
    await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
      content: `<div class="sacadia gm-note">${game.i18n.localize('SACADIA.Save.PendingBanked')}</div>`,
      flags: { sacadia: { pendingOn: { uuid: ds.caster, buff: JSON.parse(ds.pending) } } } });
  }
  let dmgNote = '';
  if (dmg > 0 && firstFailed !== null) {
    let amount = firstFailed ? dmg : (ds.onsuccess === 'half' ? Math.floor(dmg / 2) : 0);
    // Evasion (Sentinel / Bladedancer): "When you would take damage requiring a Finesse Check, take half damage (rounded
    // up) on a failure or no damage on a success."
    if (trait === 'finesse' && actor.items.some((i) => ['evasion', 'bd_evasion'].includes(i.flags?.sacadia?.catalogId))) {
      amount = firstFailed ? Math.ceil(dmg / 2) : 0;
      if (dmg > 0) sections.push(`<div class="rc-sub">${game.i18n.localize('SACADIA.Save.Evasion')}</div>`);
    }
    if (amount > 0) {
      const mode = game.settings.get('sacadia', 'combatResolutionMode');
      const autoApply = mode === 'fullAuto' || (mode === 'default' && ds.casterpc === '1');
      const def = actor.system.defenses ?? {};
      const hpBefore = actor.system.health?.value ?? 0;
      const tempBefore = actor.system.health?.temp ?? 0;
      // DR plus any typed resistance to this save's damage type (book p.222).
      const saveDr = (def.dr?.value ?? 0) + typedResistance(actor.system.typedDr, ds.dtype || '', CONFIG.SACADIA.damageTypes);
      const takenAfterDr = damageAfterDr(amount, saveDr) + (actor.system.damageTaken ?? 0);
      const drPools = poolsAfterDamage(hpBefore, tempBefore, takenAfterDr);
      if (autoApply) await actor.update({ 'system.health.value': drPools.value, 'system.health.temp': drPools.temp, 'system.combatState.tookDamage': true });
      dmgNote = `<div class="rc-sub">${game.i18n.format('SACADIA.Save.Damage', { amount })}</div>`;
      const gm = ChatMessage.getWhisperRecipients('GM').map((u) => u.id);
      // Life drain (Vampiric Weapon, Ennervation): the caster gains temp HP = a fraction of the damage dealt.
      const drainRaw = amount * (Number(ds.drain) || 0);
      const drain = ext.drainCeil ? Math.ceil(drainRaw) : Math.floor(drainRaw);
      // Olive Branch: "They gain HP equal to the damage dealt to the first target (to a maximum of their max HP)."
      if (ext.healTo) await ChatMessage.create({ whisper: gm, content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Save.HealTo', { amount })}</div>`,
        flags: { sacadia: { heal: { uuid: ext.healTo, amount } } } });
      if (drain > 0 && ds.caster) await ChatMessage.create({ whisper: gm,
        content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Save.Drain', { amount: drain })}</div>`,
        flags: { sacadia: { tempHp: { amount: drain, targetUuids: [ds.caster] } } } });
      const fullPools = poolsAfterDamage(hpBefore, tempBefore, amount);
      await ChatMessage.create({ whisper: gm, content: `<div class="sacadia gm-note">${actor.name}: ${amount} save damage`
        + hpControls(actor.uuid, { applied: damageAfterDr(amount, saveDr), raw: amount, drPools, fullPools, hpBefore, tempBefore, autoApply, canMarkDead: fullPools.value <= 0 && actor.type === 'npc', attackerUuid: ds.caster ?? '' }) + '</div>' });
    }
  }

  const traitLabel = trait ? loc(CONFIG.SACADIA.stats[trait]) : '';
  const content = `<div class="sacadia resist-card">
    <div class="rc-head"><i class="fa-solid fa-shield-halved"></i> ${loc('SACADIA.Card.RollSave')}${traitLabel ? ` (${traitLabel})` : ''} · ${loc('SACADIA.Defense.CheckDC')} ${dc}${hadFumble ? ` · ${loc('SACADIA.Condition.Fumbled')}` : ''}</div>
    ${sections.join('')}${dmgNote}
  </div>`;
  await ChatMessage.create(ChatMessage.applyMode({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls, sound: CONFIG.sounds.dice }));
}

/**
 * A save's extension effects once its checks are scored (runs on the saver's client; effects on other creatures go to
 * the GM through card flags). See the `ext` note in onSaveRoll.
 */
export async function applySaveExtensions(actor, ext, { ds, firstFailed, firstFails, firstSuccesses, sections }) {
  if (!ext || !Object.keys(ext).length || firstFailed === null) return;
  const fails = firstFails ?? 0;
  const tokU = actorToken(actor)?.document?.uuid ?? actor.uuid;
  // Per failed check: the caster gains (Siphon Soul: 1 AP; Bloodsight: a Spell Slot back; Give of Thyself / Transmute
  // Trauma: a level of Fatigue).
  if (ext.casterGain && fails > 0 && ds.caster) await gmNote(game.i18n.format('SACADIA.Save.CasterGain', { n: fails }), { gainOn: { uuid: ds.caster, n: fails, ...ext.casterGain } });
  // Per failed check, on the saver (Clumsy Touch: +1 Jinxed, −1 Fumbled) and/or another creature (Transmute Trauma).
  if (ext.perFail?.self && fails > 0) {
    const entries = Object.entries(ext.perFail.self).map(([condition, n]) => ({ condition, amount: n * fails, stacks: n > 0 }));
    for (const n of await applyConditionDeltas(actor, entries)) sections.push(`<div class="rc-sub">${n}</div>`);
  }
  // Silvery Barbs: "That ally gains X to their next to-hit rolled against the enemy target, where X is the amount of
  // Fumble the enemy takes."
  if (ext.allyToHit?.uuid && fails > 0 && ds.caster) {
    await gmNote(game.i18n.format('SACADIA.Prestige.SilveryBarbs', { n: fails }), { grant: { casterUuid: ds.caster, ability: 'mg_silvery_barbs',
      label: 'Silvery Barbs', targets: [ext.allyToHit.uuid], changes: [{ key: 'system.bonuses.toHit.all', mode: 2, value: String(fails) }],
      duration: { type: 'consumed', on: 'attack' } } });
  }
  if (ext.perFail?.other?.uuid && fails > 0) {
    await gmNote(game.i18n.localize('SACADIA.Save.OtherDelta'), { deltasOn: { uuid: ext.perFail.other.uuid,
      entries: Object.entries(ext.perFail.other.deltas ?? {}).map(([condition, n]) => ({ condition, amount: n * fails })) } });
  }
  // A success ends a standing effect on the saver (Catnap's end-of-turn check, Enemies Abound on renewal).
  if (!firstFailed && ext.onSuccess?.endGrant) {
    const { ability, casterUuid } = ext.onSuccess.endGrant;
    const ids = grantsFrom(actor, ability, casterUuid).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
    sections.push(`<div class="rc-sub">${game.i18n.localize('SACADIA.Save.EffectEnds')}</div>`);
  }
  if (firstFailed) {
    // Confusion: a failed check loses the saver's Focus (unless Mastery of Focus makes it immune).
    if (ext.onFail?.endFocus && !ownsAbility(actor, 'mg_mastery_of_focus')) {
      // Dropping the counters ends the Focus; the GM's syncFocus removes its anchors, zones and marks.
      const drop = Object.fromEntries(Object.keys(actor.system.combatState?.focusRounds ?? {}).map((k) => [`system.combatState.focusRounds.${k}`, deleteKey()]));
      if (Object.keys(drop).length) await actor.update(drop);
      sections.push(`<div class="rc-sub">${game.i18n.localize('SACADIA.Save.FocusLost')}</div>`);
    }
    // A status on a failure (Sealslam: "If they take any levels, they are knocked Prone").
    if (ext.onFail?.status) await actor.toggleStatusEffect(ext.onFail.status, { active: true });
    // Pinetar: "lose one AP to use on their next turn"; Hallowfell's Whisper: "losing all Reactions".
    if (ext.onFail?.apDebt) await actor.setFlag('sacadia', 'apDebt', (actor.getFlag('sacadia', 'apDebt') ?? 0) + ext.onFail.apDebt);
    if (ext.onFail?.reactions != null) await actor.update({ 'system.reaction.value': ext.onFail.reactions });
    if (ext.onFail?.apDebt || ext.onFail?.reactions != null) sections.push(`<div class="rc-sub">${game.i18n.localize('SACADIA.Save.OnFail')}</div>`);
    // A grant the caster's ability places only on those who fail (Bane, Crown of Insanity, Catnap).
    if (ext.grant) await gmNote(ext.grant.label ?? '', { grant: { ...ext.grant, targets: [tokU] } });
  }
}
