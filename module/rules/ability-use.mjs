/**
 * Using an ability: the whole pipeline behind a click on an ability (or a hotbar macro), for one actor — ask (every
 * prompt that can call the use off, #planUse), pay (AP, limbs, reactions, pool and Lore points), then resolve (rolls,
 * boosts, inflicts, grants, zones, the chat card and the requests it carries to the GM). It doesn't touch the sheet: the
 * sheet makes one per use, passing its live token positions (`tokenPos`, kept fresh while tokens move).
 */
import { hallowsAttackAdvantage, confusionSources, trendSide } from '../helpers/auras.mjs';
import { zoneAttackDisadvantage, tokensInCloud, cloudContext } from '../helpers/zones.mjs';
import { stepDie, resolveLimbSlots, effectiveApCost, resolveModifierValue, evaluatePredicate, foldPendingAttack, modifierIsRollTime, normalizeDamageType, checkPrerequisites, trendToArcana, predicateAtoms } from '../helpers/derivation.mjs';
import { isSurrounded } from '../helpers/geometry.mjs';
import { matchArmedBoosts, foldBoostEffects, boostLimit } from '../helpers/boosts.mjs';
import { critLayout, damageVariantDieStep } from '../helpers/crit-effects.mjs';
import { planPool, scorePool } from '../helpers/check-pool.mjs';
import { advantageText, cardHead, poolRows, postRollCard, traitEmblem } from '../helpers/chat-cards.mjs';
import { applyConditionDeltas, revealHidden, conditionSource, applySelfDamage } from '../helpers/conditions.mjs';
import { attackRiders } from '../helpers/attack-riders.mjs';
import { grantsFrom } from '../helpers/prestige.mjs';
import { rendPreference } from '../helpers/rend.mjs';
import { findGear, armorMaterial, ownsAbility, abilityItem, opposed, allied, confirmWarn } from '../helpers/actor-utils.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';
import { standingAdvantage, toHitParts } from '../helpers/roll-breakdown.mjs';

export class AbilityUse {
  /**
   * @param {Actor} actor
   * @param {{tokenPos?: Map<string, {x: number, y: number}>}} [opts]  token positions fresher than their documents
   */
  constructor(actor, { tokenPos = new Map() } = {}) {
    this.actor = actor;
    this.tokenPos = tokenPos;
  }

  /**
   * Enforce the CSP budget when an `ability` is dropped from outside this actor (drop-time check,
   * per PLANNING). Sorting an already-owned ability is unaffected. @override
   */
  /**
   * What prerequisite text is checked against (see checkPrerequisites): Traits, levels, professions, owned abilities,
   * talents and specializations, plus every ability name in the system's compendia (so a missing one reads as unmet).
   */
  async prerequisiteContext() {
    const sys = this.actor.system;
    AbilityUse.#knownAbilities ??= await (async () => {
      const names = new Set();
      for (const pack of game.packs.filter((p) => p.metadata.system === 'sacadia' && p.documentName === 'Item')) {
        for (const e of await pack.getIndex()) names.add(String(e.name).toLowerCase());
      }
      return names;
    })();
    const profSlots = ['primary', 'secondary'].map((s) => sys.professions?.[s]).filter((p) => p?.key);
    return {
      stats: Object.fromEntries(Object.entries(sys.stats ?? {}).map(([k, s]) => [k, s?.value ?? 0])),
      level: sys.level ?? 0, proficiency: sys.proficiency ?? 0,
      professions: profSlots.map((p) => p.key), professionLevels: Object.fromEntries(profSlots.map((p) => [p.key, p.level ?? 0])),
      professionNames: Object.keys(CONFIG.SACADIA.professions).flatMap((k) => [k, k.replace(/_.*/, ''), game.i18n.localize(CONFIG.SACADIA.professions[k]?.label ?? CONFIG.SACADIA.professions[k] ?? k).toLowerCase()]),
      abilities: new Set(this.actor.items.filter((i) => i.type === 'ability').map((i) => i.name.toLowerCase())),
      knownAbilities: AbilityUse.#knownAbilities,
      specialties: Object.fromEntries((sys.specialties ?? []).map((s) => [String(s.name).toLowerCase().trim(), s.rank ?? 0])),
      talents: new Set(Object.values(CONFIG.SACADIA.talents).map((t) => game.i18n.localize(t.label).toLowerCase())),
      ownedTalents: new Set(Object.entries(CONFIG.SACADIA.talents).filter(([k]) => sys.talents?.[k]?.proficient).map(([, t]) => game.i18n.localize(t.label).toLowerCase())),
    };
  }

  static #knownAbilities = null;

  /** Net-advantage d20 term: `1d20` at 0, else `(1+|net|)d20kh1/kl1` (positive = advantage). */
  static #d20FromNet(net) {
    if (net === 0) return '1d20';
    return `${1 + Math.abs(net)}d20${net > 0 ? 'kh1' : 'kl1'}`;
  }

  /**
   * Combine the player's chosen advantage level with the actor's advantage/disadvantage sinks
   * (conditions, effects) for a roll type. Any magnitude stacks: net > 0 keeps-highest, < 0 lowest.
   */
  d20FromLevel(level, rollType) {
    const adv = this.actor.system.advantage?.[rollType] ?? 0;
    const dis = this.actor.system.disadvantage?.[rollType] ?? 0;
    return AbilityUse.#d20FromNet((level ?? 0) + adv - dis);
  }

  async consumeRollGrants(on = 'roll') {
    const ids = this.actor.effects.filter((e) => {
      const gb = e.flags?.sacadia?.grantedBy;
      return gb && gb.kind === 'consumed' && String(gb.on ?? '').split('|').includes(on);
    }).map((e) => e.id);
    if (ids.length) await this.actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  }

  /**
   * Spend the one-shot grants whose `on` trigger names this event, and only those carrying the given sink key (so a
   * Blossom grant isn't spent by a temp-HP roll). Events: 'cast' (any ability used), 'tempHp', 'limb', 'inflict'.
   */
  async #consumeGrantsWith(on, keyPart) {
    const ids = this.actor.effects.filter((e) => {
      const gb = e.flags?.sacadia?.grantedBy;
      return gb && gb.kind === 'consumed' && String(gb.on ?? '').split('|').includes(on)
        && (!keyPart || (e.changes ?? []).some((c) => String(c.key).includes(keyPart)));
    }).map((e) => e.id);
    if (ids.length) await this.actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  }

  /**
   * The armed boosts that match a given action (the ability being used): by target ability catalogId,
   * or by action kind (`attack` + optional category / `save`). Excludes the action itself.
   * @param {Item} actionItem  the ability being activated
   * @returns {Item[]} matching boost Items (already armed)
   */
  #matchArmedBoosts(actionItem) {
    return matchArmedBoosts(actionItem, this.actor.items, this.actor.system.armedBoosts ?? []);
  }

  /**
   * Accumulate a boost's effects (modifier-shaped) into the running roll contribution for one
   * activity — the same sinks `#targetModifiers` fills (flat to-hit/damage, die-steps, advantage,
   * dice). Delegates to the pure `foldBoostEffects`, passing the actor's live roll options + the
   * current target context for predicate evaluation.
   */
  #foldBoostEffects(effects, numbers, category) {
    const options = { ...(this.actor.system._rollOptions?.() ?? {}), ...this.#targetOptions(), ...this.#positionalContext().opts };
    return foldBoostEffects(effects, numbers, category, options, game.i18n.localize('SACADIA.Boost.Label'));
  }

  /**
   * Resolution riders a consumed boost adds to an attack's sub (read GM-side in resolveAttack):
   *  - `graze` (Boostbane): on a miss by no more than `margin`, deal the weapon's base dice stepped `steps`;
   *  - `onKill` (Tear Apart): if this attack kills, enemies within 5ft become Surprised; with Tearing Fright,
   *    a Panic (½ Proficiency) save for one of them.
   */
  static #subBoostRiders(sets, weapon, owned) {
    const out = {};
    for (const { item: b } of sets ?? []) {
      const sp = b.system.boost?.special ?? {};
      if (sp.graze && weapon?.system.weaponDamage?.denomination) {
        const wd = weapon.system.weaponDamage;
        const st = stepDie(wd.count ?? 1, wd.denomination, sp.graze.steps ?? -2, CONFIG.SACADIA.diceLadder);
        out.graze = { margin: sp.graze.margin ?? 5, dice: `${st.count}d${st.denomination}`, label: b.name };
      }
      if (sp.onKill) out.onKill = { ...sp.onKill, panicOne: sp.onKill.panicWith && owned.has(sp.onKill.panicWith), label: b.name };
    }
    return out;
  }

  /**
   * Resolve an ability's zone (item `zone`, see helpers/zones.mjs) against this caster now: size, the parts whose
   * `requires` hold (owned upgrades, Madness thresholds), level-tiered dice, and where it goes — the caster, or a
   * point clicked on the map (Esc → the first target, else the caster). Returns the GM-side create request.
   */
  async #buildZone(item, numbers, options, boostSets = []) {
    const z = item.system.zone;
    if (z.shape === 'tiles') return this.#buildCloud(item, numbers, boostSets);
    const holds = (req) => !req?.length || evaluatePredicate(req, options);
    const level = this.actor.system.level ?? 1;
    // "(@madness)d4" → "3d4": dice counts resolve against the caster's numbers now.
    const dice = (f) => String(f).replace(/\(([^()]*)\)d(\d+)/g, (_, inner, d) => `${Math.max(0, Math.round(resolveModifierValue(inner, numbers)))}d${d}`);
    const tier = (tiers) => { const t = (tiers ?? []).filter((x) => level >= (x.level ?? 1)).at(-1); return t ? dice(t.formula) : ''; };
    const effect = foundry.utils.deepClone(z.effect ?? {});
    for (const part of ['check', 'exitCheck']) if (effect[part] && !holds(effect[part].requires)) delete effect[part];
    if (effect.check?.damageTiers) effect.check.damage = tier(effect.check.damageTiers);
    // Inflict levels may be formulas (Divine Aura: "Panic equal to half your Proficiency"), fixed at cast.
    if (effect.check?.inflict) effect.check.inflict = effect.check.inflict.map((i) => (typeof i.level === 'string'
      ? { ...i, level: Math.max(1, Math.round(resolveModifierValue(i.level, numbers))) } : i));
    if (effect.damageTiers) effect.damage = tier(effect.damageTiers);
    const tok = this.actor.getActiveTokens()[0];
    const ft = Math.max(1, resolveModifierValue(z.size, numbers));
    const px = ft * (canvas.dimensions?.distancePixels ?? 1);
    let center = z.anchor === 'caster' ? tok?.center : await AbilityUse.#pickCanvasPoint(item.name);
    center ??= Array.from(game.user.targets ?? [])[0]?.center ?? tok?.center;
    if (!center) return null;
    // "A point within 60ft": warn-but-allow when the clicked point is beyond the ability's range.
    const reach = item.system.range?.value;
    if (z.anchor !== 'caster' && reach && tok && canvas?.grid) {
      const d = canvas.grid.measurePath([tok.center, center])?.distance ?? 0;
      if (d > reach && !(await confirmWarn(item.name, game.i18n.format('SACADIA.Zone.OutOfRange', { name: item.name, dist: Math.round(d), range: reach })))) return null;
    }
    const shape = z.shape === 'square'
      ? { type: 'rectangle', x: center.x - px / 2, y: center.y - px / 2, width: px, height: px }
      : { type: 'circle', x: center.x, y: center.y, radius: px };
    return {
      casterUuid: this.actor.uuid, casterTokenUuid: tok?.document?.uuid ?? '', ability: item.flags?.sacadia?.catalogId ?? item.id,
      label: item.name, shape, effect, focus: item.system.tag === 'focus',
      difficult: z.difficult === true || (Array.isArray(z.difficult) && holds(z.difficult)),
      followCaster: !!z.followCaster, radiusPerMadness: !!z.radiusPerMadness,
      casterTurnDamage: z.casterTurnDamage ? Math.max(0, Math.round(resolveModifierValue(z.casterTurnDamage, numbers))) : 0,
    };
  }

  /**
   * A Swarm cloud (v1.2 Clouded Foe / Clouded Ally): X contiguous tiles including your own (X = the zone's size +
   * Cloudsurge's spent points), picked on the map and carried with you. Rolling Fog instead starts the cloud on the
   * targeted creature, carries it with them, and locks your Move Speed to 0 for as long as the cloud stands.
   */
  async #buildCloud(item, numbers, boostSets) {
    const z = item.system.zone;
    let count = Math.max(1, Math.round(resolveModifierValue(z.size, numbers)));
    let followToken = null;
    let mult = 1;
    for (const { item: b, numbers: bn } of boostSets) {
      const sp = b.system.boost?.special ?? {};
      if (sp.zoneTiles) count += Math.max(0, Math.round(resolveModifierValue(sp.zoneTiles, bn)));
      if (sp.zoneTilesMult) mult *= Math.max(1, Number(sp.zoneTilesMult) || 1);
      if (sp.zoneFollowTarget) followToken = Array.from(game.user.targets ?? [])[0] ?? null;
    }
    // Coordinated Flock doubles the whole cloud (Cloudsurge's extra tiles included).
    count *= mult;
    const tok = this.actor.getActiveTokens()[0];
    const anchor = followToken ?? tok;
    if (!anchor) return null;
    const tiles = await AbilityUse.#pickCanvasTiles(item.name, count, anchor);
    if (!tiles?.length) return null;
    if (followToken) await this.actor.setFlag('sacadia', 'rollingFog', followToken.document.uuid);
    return {
      casterUuid: this.actor.uuid, casterTokenUuid: tok?.document?.uuid ?? '', ability: item.flags?.sacadia?.catalogId ?? item.id,
      label: item.name, shapes: tiles, effect: foundry.utils.deepClone(z.effect ?? {}), focus: item.system.tag === 'focus',
      cloud: z.cloud ?? '', carry: !!z.carry, followTokenUuid: followToken?.document?.uuid ?? '',
    };
  }

  /**
   * Pick `count` grid tiles: the anchor token's own tile(s) first, then clicks on tiles orthogonally adjacent to the
   * picked set ("all must be adjacent to at least one other tile (no diagonals)"). Esc finishes early. Returns
   * Region rectangle shapes.
   */
  static #pickCanvasTiles(label, count, anchor) {
    if (!canvas?.stage || !canvas.grid) return Promise.resolve([]);
    const size = canvas.grid.size;
    const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const picked = new Map();
    const doc = anchor.document;
    for (let i = 0; i < Math.max(1, doc.width); i++) for (let j = 0; j < Math.max(1, doc.height); j++) {
      const p = { x: doc.x + i * size, y: doc.y + j * size };
      if (picked.size < count) picked.set(key(p), p);
    }
    const gfx = new PIXI.Graphics();
    const draw = () => {
      gfx.clear().beginFill(0x8a3b52, 0.35).lineStyle(2, 0x8a3b52, 0.9);
      for (const p of picked.values()) gfx.drawRect(p.x, p.y, size, size);
      gfx.endFill();
    };
    canvas.interface?.addChild(gfx);
    draw();
    const shapes = () => [...picked.values()].map((p) => ({ type: 'rectangle', x: p.x, y: p.y, width: size, height: size }));
    if (picked.size >= count) { gfx.destroy(); return Promise.resolve(shapes()); }
    ui.notifications.info(game.i18n.format('SACADIA.Zone.PlaceTiles', { name: label, n: count - picked.size }));
    return new Promise((resolve) => {
      const done = () => { canvas.stage.off('pointerdown', onClick); window.removeEventListener('keydown', onKey); gfx.destroy(); resolve(shapes()); };
      const onClick = (ev) => {
        const p = canvas.grid.getTopLeftPoint(ev.getLocalPosition(canvas.stage));
        if (picked.has(key(p))) return;
        const adjacent = [[size, 0], [-size, 0], [0, size], [0, -size]].some(([dx, dy]) => picked.has(key({ x: p.x + dx, y: p.y + dy })));
        if (!adjacent) return ui.notifications.warn(game.i18n.localize('SACADIA.Zone.TileAdjacent'));
        picked.set(key(p), p);
        draw();
        if (picked.size >= count) done();
      };
      const onKey = (ev) => { if (ev.key === 'Escape') done(); };
      canvas.stage.on('pointerdown', onClick);
      window.addEventListener('keydown', onKey);
    });
  }

  /** Exploding Weapon has gone off: once per quick rest, and the weapon must be named again. */
  async #spendExplodingWeapon(weapon) {
    await this.actor.setFlag('sacadia', 'restFlags.explodingWeapon', true);
    if (weapon) await weapon.unsetFlag('sacadia', 'namedAs');
  }

  /** One click on the map → its scene coordinates (null on Escape). */
  static #pickCanvasPoint(label) {
    if (!canvas?.stage) return Promise.resolve(null);
    ui.notifications.info(game.i18n.format('SACADIA.Zone.Place', { name: label }));
    return new Promise((resolve) => {
      const done = (p) => { canvas.stage.off('pointerdown', onClick); window.removeEventListener('keydown', onKey); resolve(p); };
      const onClick = (ev) => done(ev.getLocalPosition(canvas.stage));
      const onKey = (ev) => { if (ev.key === 'Escape') done(null); };
      canvas.stage.on('pointerdown', onClick);
      window.addEventListener('keydown', onKey);
    });
  }

  /** This actor as a condition giver (helpers/conditions.mjs conditionSource), with its roll-time state. */
  #giver(options = {}) {
    const numbers = { ...(this.actor.system._modifierNumbers?.() ?? {}), 'combat.enemies': AbilityUse.#enemyCount(this.actor),
      hemorrhageSteps: this.actor.system.bonuses?.hemorrhageSteps ?? 0 };
    return {
      uuid: this.actor.uuid, name: this.actor.name, options, numbers,
      owned: new Set(this.actor.items.filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean)),
    };
  }

  /**
   * Resistance to damage you deal yourself outside the Insane table: Mistletoe (Heather Root's ½ Proficiency)
   * plus Blood Mastery (Oracle Legendary: +1).
   */
  #selfDamageResist() {
    const owns = (id) => ownsAbility(this.actor, id);
    return (owns('mistletoe') ? Math.ceil((this.actor.system.proficiency ?? 0) / 2) : 0) + (owns('legendary_blood') ? 1 : 0);
  }

  /** Fold every consumed boost's effects (each with its own `@spent`) into one roll contribution. */
  #foldBoostSets(sets, category) {
    const out = { toHit: 0, damage: 0, dieStep: 0, advToHit: 0, saveAdv: 0, saveDc: 0, dice: [], notes: [] };
    for (const { item, numbers } of sets ?? []) {
      const f = this.#foldBoostEffects(item.system.boost?.effects ?? [], numbers, category);
      for (const k of ['toHit', 'damage', 'dieStep', 'advToHit', 'saveAdv', 'saveDc']) out[k] += f[k] ?? 0;
      out.dice.push(...f.dice); out.notes.push(...f.notes);
    }
    return out;
  }

  /**
   * A consumed boost's side effects, applied before the action rolls (BOOST_OVERRIDES `special.onConsume`):
   * turn flags (Glory of Storms' ignore-conditions, Reckless's turn advantage), a Reckless exposure (attacks
   * against you at advantage until your next turn), a Madness change (Mad Smear's +1D3−1), self-damage
   * (Mad Smear / Mad Spector — Mistletoe resists self-damage by ½ Proficiency), and held decay (Voices That
   * Shriek keeps your Madness at your turn end).
   */
  async #boostOnConsume(b, numbers, ctx = {}) {
    const oc = b.system.boost?.special?.onConsume;
    if (!oc) return;
    const upd = {};
    const notes = [];
    for (const [k, v] of Object.entries(oc.turnFlags ?? {})) upd[`flags.sacadia.turnFlags.${k}`] = v;
    // An extra AP the boost costs (Long Arc: "expend one additional AP"; Boost Step).
    // A formula so a chosen amount can drive it (Shockwave: `@spent` extra AP); negative refunds (Fast
    // Reflexes, Legendary AP), capped at the AP maximum.
    const apCost = oc.ap ? Math.trunc(resolveModifierValue(String(oc.ap), numbers)) : 0;
    if (apCost) upd['system.ap.value'] = Math.min(this.actor.system.ap?.max ?? Infinity, Math.max(0, (this.actor.system.ap?.value ?? 0) - apCost));
    if (oc.lore) upd['system.lorePoints.value'] = Math.max(0, (this.actor.system.lorePoints?.value ?? 0) - oc.lore);
    if (oc.exposed) upd['flags.sacadia.exposed'] = { ...oc.exposed, label: oc.exposed.label || b.name };
    if (oc.holdDecay?.length) upd['flags.sacadia.holdDecay'] = Array.from(new Set([...(this.actor.getFlag('sacadia', 'holdDecay') ?? []), ...oc.holdDecay]));
    let madness = this.actor.system.conditions?.madness?.value ?? 0;
    if (oc.madness) {
      const r = await new Roll(String(oc.madness)).evaluate();
      madness = Math.max(0, Math.min(6, madness + r.total));
      upd['system.conditions.madness.value'] = madness;
      notes.push(`${game.i18n.localize('SACADIA.Condition.Madness')} ${r.total >= 0 ? '+' : ''}${r.total} → ${madness}`);
    }
    if (Object.keys(upd).length) await this.actor.update(upd);
    if (oc.selfDamage) {
      const raw = Math.max(0, resolveModifierValue(oc.selfDamage, { ...numbers, madness }));
      const resist = this.#selfDamageResist();
      const dmg = Math.max(0, raw - resist);
      if (dmg > 0) await applySelfDamage(this.actor, dmg);
      notes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: dmg }) + (resist ? ` (−${resist})` : ''));
    }
    // Rolled self-damage by level tier (Blood for Bane: 1D10 → 2D6 @6 → 2D8 @11). With `refundPoolAt`, taking at
    // least that much refunds what the boosted action spent from its pool ("If you take 6+ damage, do not expend a
    // Spell Slot").
    if (oc.selfDamageRoll?.length) {
      const lvl = this.actor.system.level ?? 1;
      const tier = oc.selfDamageRoll.filter((t) => lvl >= (t.level ?? 1)).at(-1) ?? oc.selfDamageRoll[0];
      const r = await new Roll(tier.formula).evaluate();
      if (r.total > 0) await applySelfDamage(this.actor, r.total);
      notes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: r.total }));
      const pool = ctx.pool;
      if (oc.refundPoolAt && r.total >= oc.refundPoolAt && pool?.key && pool.spent > 0) {
        const cur = this.actor.system.classPools?.[pool.key]?.value ?? 0;
        await this.actor.update({ [`system.classPools.${pool.key}.value`]: cur + pool.spent });
        notes.push(game.i18n.format('SACADIA.Boost.PoolRefund', { n: pool.spent, pool: game.i18n.localize(CONFIG.SACADIA.pools[pool.key] ?? pool.key) }));
      }
    }
    if (notes.length) await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="sacadia chat-card note-card"><strong>${b.name}</strong>: ${notes.join(' · ')}</div>` });
  }

  /**
   * Spend one action's AP + limbs against the turn economy (book pp.236–237): resolve which
   * exhaustion slots the limbs occupy, add +1 AP if an already-exhausted limb is reused (silently —
   * that's the rule, not an error), warn-but-allow when the cost exceeds remaining AP, then deduct
   * AP, mark the newly-exhausted slots, and push a log entry so it can be undone.
   * `confirmed` skips the overspend warning (the caller already asked — #planUse).
   * @param {{label: string, ap: number, limbs: string[]}} action
   * @returns {Promise<boolean>} true if the action was logged, false if the player cancelled.
   */
  async spendAction({ label, ap, limbs, key = '', choice = '', focusKey = '', ranged = false, confirmed = false }) {
    const sys = this.actor.system;
    const { mmUsed, firstRanged, freeLimbs, newlyExhausted, cost } = this.#actionCost({ ap, limbs, ranged });
    const current = sys.ap?.value ?? 0;

    if (cost > current && !confirmed) {
      const ok = await confirmWarn(game.i18n.localize('SACADIA.Economy.OverspendTitle'), game.i18n.format('SACADIA.Economy.OverspendWarn', { label, cost, current }));
      if (!ok) return false;
    }
    if (freeLimbs) await this.#consumeGrantsWith('limb', 'freeLimbs');

    // Deduct only what AP is actually available; record that (`spent`) alongside the nominal `cost`
    // so undo refunds exactly what left the pool, not what the action nominally cost.
    const spent = Math.min(cost, current);
    const log = sys.actionLog.map((e) => ({ label: e.label, key: e.key, choice: e.choice, ap: e.ap, spent: e.spent, exhausted: [...e.exhausted] }));
    log.push({ label, key, choice, ap: cost, spent, exhausted: newlyExhausted });
    const update = { 'system.ap.value': current - spent, 'system.actionLog': log };
    for (const slot of newlyExhausted) update[`system.exhaustion.${slot}`] = true;
    if (mmUsed) update['flags.sacadia.turnFlags.muscleMemory'] = true;
    if (firstRanged) update['flags.sacadia.turnFlags.rangedAttacked'] = true;
    // Focus-maintenance streak: on the *first* use of this Focus ability this turn (its key not yet in
    // the log), bump its round count. Turn-start (resetActionEconomy) drops streaks not maintained.
    if (focusKey && !sys.actionLog.some((e) => e.key === focusKey)) {
      const fr = foundry.utils.deepClone(sys.combatState?.focusRounds ?? {});
      fr[focusKey] = (fr[focusKey] ?? 0) + 1;
      update['system.combatState.focusRounds'] = fr;
      // Rounds of this Focus kept without moving since it began (`@combat.stillRounds.<id>` — Greater Glaring): reset
      // as it starts, then each later round counts until the first move (the GM's token-move hook sets `moved`).
      const still = this.actor.getFlag('sacadia', 'stillFocus')?.[focusKey];
      update[`flags.sacadia.stillFocus.${focusKey}`] = fr[focusKey] === 1 ? { rounds: 0, moved: false }
        : { rounds: (still?.rounds ?? 0) + (still && !still.moved ? 1 : 0), moved: !still || !!still.moved };
    }
    await this.actor.update(update);
    return true;
  }

  /**
   * What an action would cost right now, without spending anything: the limbs it exhausts after Second Shot, Muscle and
   * Memory and a Blossom grant, and its AP (+1 when it reuses an exhausted limb).
   */
  #actionCost({ ap, limbs, ranged = false }) {
    const sys = this.actor.system;
    // Muscle and Memory: once per turn, the picked limb type isn't exhausted when used.
    let limbsToUse = limbs ?? [];
    // Second Shot (Sentinel L7): "When you make your first ranged attack each turn, you do not exhaust any limbs."
    const tf0 = this.actor.getFlag('sacadia', 'turnFlags') ?? {};
    const firstRanged = ranged && !tf0.rangedAttacked;
    if (firstRanged && ownsAbility(this.actor, 'sen_second_shot')) limbsToUse = [];
    const mm = (sys._picks?.().limb ?? []).find((p) => p.id === 'muscle_and_memory');
    const mmFlag = this.actor.getFlag('sacadia', 'turnFlags')?.muscleMemory;
    let mmUsed = false;
    if (mm && !mmFlag && limbsToUse.includes(mm.value)) {
      limbsToUse = limbsToUse.filter((l, i) => !(l === mm.value && i === limbsToUse.indexOf(mm.value)));
      mmUsed = true;
    }
    // Blossom (Witch reaction): "That ally does not exhaust a limb through that ability use." A one-shot grant.
    const freeLimbs = (sys.bonuses?.freeLimbs ?? 0) > 0 && limbsToUse.length > 0;
    if (freeLimbs) limbsToUse = [];
    const { newlyExhausted, reused } = resolveLimbSlots(limbsToUse, sys.exhaustion ?? {});
    return { limbsToUse, mmUsed, firstRanged, freeLimbs, newlyExhausted, cost: effectiveApCost(ap, reused) };
  }

  /**
   * An ability's next-attack buff (`nextAttack`) resolved against the user's numbers: `{advantage, toHit, damage, dieStep,
   * targetCondition, label}` for `system.pendingAttack`, or null when it adds nothing.
   */
  #nextAttackBuff(item, numbers) {
    const na = item.system.nextAttack ?? {};
    const num = (f) => (f ? Math.round(resolveModifierValue(f, numbers)) : 0);
    const buff = { advantage: num(na.advantage), toHit: num(na.toHit), damage: num(na.damage), dieStep: 0,
      targetCondition: na.targetCondition ?? '', label: na.label || item.name };
    return (buff.advantage || buff.toHit || buff.damage || buff.targetCondition) ? buff : null;
  }

  /** Roll a check pool (book p.258: one d20 per level, advantage adding dice) and score it. */
  static async #rollPool(levels, net, mod) {
    const { poolCount, autoFail } = planPool(levels, net);
    const roll = poolCount > 0 ? await new Roll(`${poolCount}d20`).evaluate() : null;
    const sc = scorePool(roll ? roll.dice[0].results.map((r) => r.result) : [], { levels, net, mod });
    return { roll, sc, autoFail };
  }

  /**
   * A condition-check card: the ability-card head (emblem, title, a tag and facts), any modifiers that applied, then the
   * dice (auto-fails first, then kept and dropped); its outcome slot is filled GM-side (resolveResist).
   */
  static checkCardHtml({ icon, img, title, tag = '', meta = [], notes = [], entries, autoFail = 0 }) {
    return `<div class="sacadia chat-card resist-card">${cardHead({ icon, img, title, tag, meta })}`
      + (notes.length ? `<div class="card-parts">${notes.map((n) => `<span class="part">${n}</span>`).join('')}</div>` : '')
      + poolRows(entries, { autoFail })
      + `<div class="rc-resolution" data-resolution>${game.i18n.localize('SACADIA.Resist.Awaiting')}</div></div>`;
  }

  /**
   * Make Trait Checks for targeted allies against one of their conditions (item `aidResist`). Per ally:
   * pick the condition (and the trait you check with); if the ability is automatic here (Final Calm owned,
   * or Steadied for Vision of Moss) one level is simply removed, otherwise the checks roll with *your*
   * modifiers and post as a Make-Trait-Check card for that ally (each success removes a level; the GM
   * compares against the condition's DC).
   */
  async #aidResist(item, funnel = null) {
    const ar = item.system.aidResist;
    if (ar.funnel) return funnel ? this.#funnelEnergy(item, funnel) : undefined;
    const loc = (k) => game.i18n.localize(k);
    const nums = this.actor.system._modifierNumbers?.() ?? {};
    const owns = (id) => id && ownsAbility(this.actor, id);
    const opts = this.actor.system._rollOptions?.() ?? {};
    const auto = owns(ar.autoWith) || (ar.autoIfSteadied && opts['self:steadied']);
    const max = ar.maxTargets ? Math.max(1, resolveModifierValue(ar.maxTargets, nums)) : 1;
    const allies = Array.from(game.user.targets ?? []).map((t) => t.actor).filter(Boolean).slice(0, max);
    if (!allies.length) return ui.notifications.warn(game.i18n.format('SACADIA.Aid.NoTarget', { name: item.name }));
    // Burning Incense: spend N Madness → N checks.
    let spent = 0;
    if (ar.spendMadness) {
      const cur = this.actor.system.conditions?.madness?.value ?? 0;
      spent = await AbilityUse.#promptResourceSpend(loc('SACADIA.Condition.Madness'), cur, cur);
      if (!spent) return;
      await this.actor.update({ 'system.conditions.madness.value': Math.max(0, cur - spent) });
    }
    const levels = Math.max(1, resolveModifierValue(ar.levels, { ...nums, spent }));
    const statOpts = Object.entries(CONFIG.SACADIA.stats).map(([k, l]) => `<option value="${k}">${loc(l)}</option>`).join('');
    for (const ally of allies) {
      const held = Object.entries(CONFIG.SACADIA.conditions)
        .filter(([k, c]) => k !== 'madness' && (ally.system.conditions?.[k]?.value ?? 0) > 0 && (!ar.mentalOnly || /mental/i.test(c.group ?? '')));
      if (!held.length) { ui.notifications.info(game.i18n.format('SACADIA.Aid.NothingToAid', { name: ally.name })); continue; }
      const condOpts = held.map(([k, c]) => `<option value="${k}">${loc(c.label)} ${ally.system.conditions[k].value}</option>`).join('');
      const form = await sacDialog.wait({
        window: { title: `${item.name} — ${ally.name}` },
        content: `<div class="resist-prompt"><div class="rp-row"><label>${loc('SACADIA.Resist.Condition')}</label><select name="cond">${condOpts}</select></div>`
          + (auto ? '' : `<div class="rp-row"><label>${loc('SACADIA.Resist.Trait')}</label><select name="trait">${statOpts}</select></div>`) + '</div>',
        buttons: [{ action: 'ok', label: loc(auto ? 'SACADIA.Aid.Remove' : 'SACADIA.Resist.Roll'), default: true,
          callback: (e, b, d) => ({ cond: d.element.querySelector('[name="cond"]')?.value, trait: d.element.querySelector('[name="trait"]')?.value }) }],
        rejectClose: false,
      });
      if (!form?.cond) continue;
      const condLabel = loc(CONFIG.SACADIA.conditions[form.cond]?.label ?? form.cond);
      if (auto) {
        // No roll: one level removed (GM-routed — the ally may not be ours).
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Aid.Removed', { label: item.name, name: ally.name, condition: condLabel })}</div>`,
          flags: { sacadia: { onUse: { targetUuids: [ally.token?.uuid ?? ally.uuid], inflicts: [{ condition: form.cond, amount: -1 }] } } },
        });
        continue;
      }
      const rd = this.actor.getRollData();
      const mod = (Number(rd[form.trait]) || 0) + (Number(rd.proficiency) || 0) + (Number(rd.traitBonus) || 0);
      const net = (owns(ar.advantageWith) ? 1 : 0) + (this.actor.system.advantage?.trait ?? 0) - (this.actor.system.disadvantage?.trait ?? 0);
      const { roll, sc, autoFail } = await AbilityUse.#rollPool(levels, net, mod);
      await AbilityUse.postCard({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: AbilityUse.checkCardHtml({ ...traitEmblem(form.trait, 'fa-solid fa-hands-holding'), entries: sc.entries, autoFail,
          title: game.i18n.format('SACADIA.Aid.CardTitle', { label: item.name, name: ally.name, condition: condLabel }),
          tag: loc('SACADIA.Check.MakeTraitCheck'), meta: [loc(CONFIG.SACADIA.stats[form.trait]), advantageText(net)] }),
        rolls: roll ? [roll] : [],
        sound: CONFIG.sounds.dice,
        flags: { sacadia: { resist: { resisterUuid: ally.token?.uuid ?? ally.uuid, sourceUuid: null, condition: form.cond, mode: 'reduce', keptTotals: sc.keptTotals, autoFail } } },
      });
    }
  }

  /**
   * Funnel Energy's two creatures, settled before the use is paid for (#planUse): the targeted pair (one target and
   * yourself with Given Energy), and which of them gives up Fatigue (asked when both have some). Null when the targets
   * don't fit or the player calls it off.
   */
  async #funnelPair(item) {
    const fmt = (k, d) => game.i18n.format(`SACADIA.Funnel.${k}`, d);
    const given = ownsAbility(this.actor, 'wt_given_energy');
    const pair = [...new Set(Array.from(game.user.targets ?? []).map((t) => t.actor).filter(Boolean))];
    if (given && pair.length === 1 && pair[0] !== this.actor) pair.push(this.actor);
    if (pair.length !== 2) { ui.notifications.warn(fmt('NeedTwo', { name: item.name })); return null; }
    if (!given && pair.includes(this.actor) && !(await confirmWarn(item.name, fmt('NotYourself', { name: item.name })))) return null;
    const fatigue = (a) => a.system.conditions?.fatigue?.value ?? 0;
    const tired = pair.filter((a) => fatigue(a) > 0);
    if (!tired.length) { ui.notifications.warn(fmt('NoFatigue', { name: item.name })); return null; }
    // Both tired: you choose whose Fatigue moves.
    let from = tired[0];
    if (tired.length === 2) {
      const pick = await sacDialog.wait({ window: { title: item.name }, content: `<p>${fmt('Which', {})}</p>`,
        buttons: tired.map((a, i) => ({ action: String(i), label: `${a.name} (${fatigue(a)})`, default: i === 0 })), rejectClose: false });
      if (pick == null) return null;
      from = tired[Number(pick)] ?? tired[0];
    }
    return { from, to: pair.find((a) => a !== from) };
  }

  /**
   * Witch Funnel Energy: "Choose two different targets within 5ft of you (you cannot choose yourself). One of those two
   * targets must have Fatigue. Make Fate Checks against the Check DC of the target with Fatigue. For every successful
   * Trait Check, remove one level of Fatigue from that target, and give the other target 1 additional AP to use on their
   * next turn. This does not work on Battle Fatigue." You roll one check per level of their Fatigue (owner ruling). Given
   * Energy: "You can choose yourself as one of the targets" — target one creature and you're the other.
   */
  async #funnelEnergy(item, { from, to }) {
    const fmt = (k, d) => game.i18n.format(`SACADIA.Funnel.${k}`, d);
    const levels = from.system.conditions?.fatigue?.value ?? 0;
    const rd = this.actor.getRollData();
    const mod = (Number(rd.fate) || 0) + (Number(rd.proficiency) || 0) + (Number(rd.traitBonus) || 0);
    const net = (this.actor.system.advantage?.trait ?? 0) - (this.actor.system.disadvantage?.trait ?? 0);
    const { roll, sc, autoFail } = await AbilityUse.#rollPool(levels, net, mod);
    const uuidOf = (a) => a.token?.uuid ?? a.uuid;
    await AbilityUse.postCard({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: AbilityUse.checkCardHtml({ ...traitEmblem('fate', 'fa-solid fa-arrow-right-arrow-left'), entries: sc.entries, autoFail,
        title: fmt('CardTitle', { label: item.name, from: from.name, to: to.name }),
        tag: `${game.i18n.localize('SACADIA.Stat.Fate.long')} ${game.i18n.localize('SACADIA.Resist.Check')}`, meta: [game.i18n.format('SACADIA.Check.ChecksN', { n: levels }), advantageText(net)] }),
      rolls: roll ? [roll] : [],
      sound: CONFIG.sounds.dice,
      // Checked against the fatigued creature's own Check DC (`dcUuid`); each success also gives `funnelTo` 1 AP next turn.
      flags: { sacadia: { resist: { resisterUuid: uuidOf(from), sourceUuid: null, dcUuid: uuidOf(from), funnelTo: uuidOf(to),
        condition: 'fatigue', mode: 'reduce', keptTotals: sc.keptTotals, autoFail } } },
    });
  }

  /**
   * Check an ability's usage limit and precondition (item `usage`, with any owned upgrade applied).
   * Returns false if the player declines past a warning; otherwise true, or `{commit}` to count the use
   * once the action has paid its costs.
   */
  async #checkUsage(item) {
    const u = item.system.usage;
    if (!u || (!u.per && !u.requires?.length)) return true;
    const owned = new Set(this.actor.items.map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
    const up = (u.upgrades ?? []).find((g) => owned.has(g.ability));
    // An upgrade may scale the limit (Patla's Touch: Divine Strike "a number of times equal to half your proficiency").
    const max = up?.maxFormula ? Math.max(1, Math.floor(resolveModifierValue(up.maxFormula, this.actor.system._modifierNumbers?.() ?? {})))
      : (up?.max ?? u.max ?? 1);
    const requires = up?.requires?.length ? up.requires : (u.requires ?? []);
    const requiresLabel = up?.requires?.length ? up.requiresLabel : u.requiresLabel;
    const cid = item.flags?.sacadia?.catalogId ?? item.id;
    const warn = async (text) => confirmWarn(item.name, text);
    if (requires.length) {
      const atoms = predicateAtoms(requires);
      if (!evaluatePredicate(atoms, this.actor.system._rollOptions?.() ?? {})
        && !(await warn(game.i18n.format('SACADIA.Usage.Requires', { name: item.name, req: requiresLabel || atoms.join(', ') })))) return false;
    }
    if (u.per && u.perTarget) {
      // Per target: the flag holds the creatures it was used on this period (by actor uuid; a synthetic token's actor
      // has its own). With no target there's nothing to check.
      const used = this.actor.getFlag('sacadia', `uses.${u.per}.${cid}`);
      const seen = Array.isArray(used) ? used : [];
      const targets = Array.from(game.user.targets ?? []).map((t) => t.actor).filter(Boolean);
      const again = targets.filter((a) => seen.filter((x) => x === a.uuid).length >= max);
      if (again.length && !(await warn(game.i18n.format('SACADIA.Usage.ExceededTarget', {
        name: item.name, targets: again.map((a) => a.name).join(', '), per: game.i18n.localize(`SACADIA.Usage.Per.${u.per}`) })))) return false;
      return { commit: () => this.actor.setFlag('sacadia', `uses.${u.per}.${cid}`, [...seen, ...targets.map((a) => a.uuid)]) };
    }
    if (u.per) {
      const used = this.actor.getFlag('sacadia', `uses.${u.per}.${cid}`) ?? 0;
      if (used >= max && !(await warn(game.i18n.format('SACADIA.Usage.Exceeded', {
        name: item.name, used, max, per: game.i18n.localize(`SACADIA.Usage.Per.${u.per}`) })))) return false;
      // Counted only once the action actually commits (after its costs are paid).
      return { commit: () => this.actor.setFlag('sacadia', `uses.${u.per}.${cid}`, used + 1) };
    }
    return true;
  }

  /** The warnings before spending a reaction (Prone, none left). False if the player calls it off. */
  async reactionOk(label) {
    // Prone (book p.258): "Cannot use reactions or move." Warn-but-allow, like every other limit.
    if (this.actor.statuses?.has('prone') && !(await confirmWarn(label, game.i18n.format('SACADIA.Reaction.ProneWarn', { label })))) return false;
    if ((this.actor.system.reaction?.value ?? 0) < 1) {
      const ok = await confirmWarn(game.i18n.localize('SACADIA.Reaction.NoneTitle'), game.i18n.format('SACADIA.Reaction.NoneWarn', { label }));
      if (!ok) return false;
    }
    return true;
  }

  /** Spend the reaction (no prompts; Hero's Response counts the extra ones as next turn's AP debt). */
  async payReaction() {
    const current = this.actor.system.reaction?.value ?? 0;
    const hero = this.actor.getFlag('sacadia', 'heroResponse');
    await this.actor.update({ 'system.reaction.value': Math.max(0, current - 1),
      ...(hero ? { 'flags.sacadia.heroResponse.used': (hero.used ?? 0) + 1 } : {}) });
    return true;
  }

  /**
   * Spend a signature-pool cost (Arrangement/Glory/…). Warn-but-allow when the pool is short (the
   * value floors at 0), matching the AP overspend posture. NPCs have no class pools — skip.
   * @returns {Promise<boolean>} true to proceed, false if the player cancelled.
   */
  /**
   * Spend a pool cost. Returns the numeric amount actually spent (≥ 0; 0 for a no-op like a non-
   * character or a 0 pick), or `null` if the player cancelled/declined — callers gate on `=== null`.
   * A variable cost ("expend X …") also exposes its amount so boosts can feed it in as `@spent`.
   */
  async #spendPool(label, cost) {
    const amount = await this.#askPool(label, cost);
    if (amount === null) return null;
    await this.#payPool(cost.key, amount);
    return amount;
  }

  /** Deduct an amount chosen by #askPool from a signature pool (no prompts). */
  async #payPool(key, amount) {
    const pool = this.actor.type === 'character' ? this.actor.system.classPools?.[key] : null;
    if (!pool || !(amount > 0)) return;
    await this.actor.update({ [`system.classPools.${key}.value`]: Math.max(0, pool.value - amount) });
  }

  /**
   * The prompts before a pool spend: the amount of a variable cost, and the warning when the pool is short. Returns the
   * amount (≥ 0), or null if the player called it off. Spends nothing.
   */
  async #askPool(label, { key, amount, variable = false, max = '' }) {
    if (this.actor.type !== 'character') return 0;
    const pool = this.actor.system.classPools?.[key];
    if (!pool) return 0;
    const poolLabel = game.i18n.localize(CONFIG.SACADIA.pools[key] ?? key);
    // Variable cost ("expend X / any number of …"): prompt for the amount, bounded by the ability's
    // own limit (`max`, e.g. @proficiency) when it has one; the pool value is a soft cap (overspend
    // still warns, matching AP). A blank/0 pick is a no-op spend.
    if (variable) {
      const cap = max ? resolveModifierValue(max, this.actor.system._modifierNumbers?.() ?? {}) : null;
      const chosen = await AbilityUse.#promptPoolAmount(poolLabel, pool.value, cap);
      if (chosen === null) return null; // cancelled
      amount = cap != null ? Math.min(chosen, cap) : chosen;
    }
    if (amount <= 0) return 0;
    if (amount > pool.value) {
      const ok = await confirmWarn(game.i18n.localize('SACADIA.Economy.OverspendTitle'), game.i18n.format('SACADIA.Pool.Insufficient', { label, amount, pool: poolLabel, current: pool.value }));
      if (!ok) return null;
    }
    return amount;
  }

  /**
   * Prompt for a variable pool spend. Returns the chosen count (≥0), or null if dismissed.
   * @param {string} poolLabel  Localized pool name.
   * @param {number} available  Current pool value (shown as a hint; overspend is allowed with a warning).
   * @param {number|null} cap   The ability's rule limit on the spend, or null for unbounded.
   */
  static async #promptPoolAmount(poolLabel, available, cap) {
    const read = (event, button, dialog) =>
      Math.max(0, Math.round(Number(dialog.element.querySelector('[name="amt"]')?.value) || 0));
    const prompt = cap != null
      ? game.i18n.format('SACADIA.Pool.HowManyMax', { pool: poolLabel, max: cap })
      : game.i18n.format('SACADIA.Pool.HowMany', { pool: poolLabel });
    return sacDialog.wait({
      window: { title: poolLabel },
      content: `<div class="adv-prompt">
        <label>${prompt}</label>
        <input type="number" name="amt" value="1" min="0"${cap != null ? ` max="${cap}"` : ''} step="1"/>
        <p class="hint">${game.i18n.format('SACADIA.Pool.Available', { current: available })}</p>
      </div>`,
      buttons: [{ action: 'spend', label: game.i18n.localize('SACADIA.Pool.Spend'), default: true, callback: read }],
      rejectClose: false,
    });
  }

  /** Pick one saved Slightly Cracked roll (buttons); resolves to its index, or null if cancelled / none saved. */
  static async #pickCracked(actor, title) {
    const saved = actor.system.professionResources?.oracle?.cracked ?? [];
    if (!saved.length) { ui.notifications.warn(game.i18n.localize('SACADIA.Cracked.None')); return null; }
    const buttons = saved.map((v, i) => ({ action: String(i), label: String(v), default: i === 0 }));
    const res = await sacDialog.wait({ window: { title }, content: `<p>${game.i18n.localize('SACADIA.Cracked.Pick')}</p>`,
      buttons, rejectClose: false });
    return res == null ? null : Number(res);
  }

  /**
   * Resolve an ability's activities into one chat card. Attack activities roll to-hit
   * (`d20 + proficiency + trait`, with a single advantage prompt shared across the ability); save
   * activities embed a "Roll Save" button vs the user's Check DC; damage is structured per part.
   * Global bonuses come from the actor's `system.bonuses` sink (0 until Phase 5 AE populate it).
   */
  /**
   * Is this actor trained in attacks of this category (book p.6 "Proficient Attacks")? The union of its professions'
   * trained categories (melee / ranged). Magic attacks (vs MD) are melee or ranged in the book, so they count as
   * trained whenever the character is trained in either. NPCs, and characters without a profession, are trained.
   */
  static proficientIn(actor, category) {
    if (actor.type !== 'character') return true;
    const keys = ['primary', 'secondary'].map((s) => actor.system.professions?.[s])
      .filter((p) => p?.key && (p.level ?? 0) > 0).map((p) => p.key);
    if (!keys.length) return true;
    const trained = new Set(keys.flatMap((k) => CONFIG.SACADIA.professionProficientAttacks?.[k] ?? ['melee', 'ranged']));
    if (category === 'magic') return trained.size > 0;
    return !category || trained.has(category);
  }

  /** Guiding Wingbeats / Wingthrust from any allied Clouded Ally this actor stands in (best one). */
  static #wingbeats(actor) {
    const out = { toHit: 0, damage: 0 };
    for (const owner of cloudContext(actor.getActiveTokens?.()?.[0]?.document).friendlyAlly) {
      if ((owner.system.combatState?.focusRounds?.guiding_wingbeats ?? 0) <= 0) continue;
      const x = Math.ceil((owner.system.proficiency ?? 0) / 2);
      const thrust = ownsAbility(owner, 'wingthrust');
      out.toHit = Math.max(out.toHit, x);
      if (thrust) out.damage = Math.max(out.damage, x);
    }
    return out;
  }

  /** Abilities that act on every enemy inside your Clouded Foe (auto-targeted when nothing is targeted). */
  static #CLOUD_TARGETING = new Set(['birdbite', 'delirious_flock']);

  /** Focus abilities that layer onto a Swarm cloud (statuses / terrain refreshed GM-side when used). */
  static #CLOUD_LAYERS = new Set(['sharp_cloud', 'dark_cloud', 'blackcloud', 'birdshield', 'guiding_wingbeats', 'swarm_effects']);

  /**
   * Everything about a use that needs the player's say, asked before anything is spent (#useAbility pays afterwards):
   * usage limits, the Madness gates, the per-use choice and amounts, drawing the weapon, the AP shortfall, the reaction,
   * the pool and Lore costs, advantage, and a grant's resource spend. Returns the decisions; `{handoff}` for an ability
   * that opens its own flow (a Promise, a Tome); or null when the player calls the use off. Its one side effect is
   * targeting: a Swarm ability with nothing targeted targets the enemies in your cloud.
   */
  async #planUse(item) {
    const warn = (content, title = item.name) => confirmWarn(title, content);
    // Oracle Madness gates (book p120): P:I (insane-only), P:MX (min Madness), and the insane-time
    // lockout of non-P:I Madness abilities. Focus-maintenance re-uses don't re-roll the Madness change (it's an
    // initiate-only cost), so capture whether this is the initiation before #spendAction bumps the focus streak.
    const mcat = item.flags?.sacadia?.catalogId ?? item.id;
    // Usage limits and preconditions (book "once per turn / quick rest / combat", "when you are raging").
    // Warn-but-allow, like AP overspend; the use is counted once the action is committed.
    const usage = await this.#checkUsage(item);
    if (!usage) return null;
    // A cap on how many creatures it may target (Webcraft: up to your Proficiency, one per Madness): warn-but-allow.
    const maxTargets = item.system.multiAttack?.maxTargets;
    if (maxTargets) {
      const cap = Math.max(0, Math.floor(resolveModifierValue(maxTargets, this.actor.system._modifierNumbers?.() ?? {})));
      const n = game.user.targets?.size ?? 0;
      if (n > cap && !(await warn(game.i18n.format('SACADIA.Usage.TooManyTargets', { name: item.name, n, max: cap })))) return null;
    }
    const ownsId = (id) => ownsAbility(this.actor, id);
    const madInitiating = item.system.tag !== 'focus'
      || (this.actor.system.combatState?.focusRounds?.[mcat] ?? 0) === 0;
    if (!(await this.#checkMadnessPrereq(item))) return null;
    // Renewing a Focus that may only be renewed near its recipient (the Witch's ally Focuses): warn-but-allow when a
    // creature carrying this Focus's grant is beyond reach.
    const renewWithin = item.system.focus?.renewWithin;
    if (renewWithin != null && this.actor.effects.some((e) => e.flags?.sacadia?.anchor?.ability === item.flags?.sacadia?.catalogId)) {
      const me = this.actor.getActiveTokens?.()?.[0];
      const cid = item.flags?.sacadia?.catalogId;
      const far = (canvas.tokens?.placeables ?? []).filter((t) => t.actor?.effects?.some((e) => {
        const gb = e.flags?.sacadia?.grantedBy;
        return gb?.ability === cid && gb.casterUuid === this.actor.uuid;
      })).filter((t) => (this.#tokenGap(me, t) ?? 0) > renewWithin);
      if (far.length && !(await warn(game.i18n.format('SACADIA.Prestige.RenewTooFar', { name: item.name, who: far.map((t) => t.name).join(', '), ft: renewWithin })))) return null;
    }
    // The Witch's Promise (Prestige Classes): using a Promise toggles it broken / kept; while it's broken, Witch abilities
    // are lost until Atone (warn-but-allow); Promise of Nonviolence breaks on harming a creature not on your side.
    const cidP = item.flags?.sacadia?.catalogId ?? '';
    if (CONFIG.SACADIA.witchPromises.includes(cidP)) return { handoff: () => this.#togglePromise(item) };
    const broken = !!this.actor.getFlag('sacadia', 'promiseBroken');
    const atone = cidP === 'wt_atone' && broken;
    let breakPromise = false;
    if (!atone && broken && item.system.meta?.profession === 'witch' && !(await warn(game.i18n.localize('SACADIA.Prestige.PromiseBrokenWarn')))) return null;
    if (!broken && ownsId('wt_promise_of_nonviolence')) {
      const harmful = (item.system.activities ?? []).some((a) => a.type === 'attack' || a.type === 'damage' || (a.damage ?? []).length
        || (a.inflict ?? []).some((i) => i.condition === 'hemorrhage'));
      const myDisp = this.actor.getActiveTokens?.()?.[0]?.document?.disposition ?? 1;
      const foes = Array.from(game.user.targets ?? []).filter((t) => (t.document?.disposition ?? 0) !== myDisp);
      if (harmful && foes.length) {
        if (!(await warn(game.i18n.format('SACADIA.Prestige.NonviolenceWarn', { names: foes.map((t) => t.name).join(', ') })))) return null;
        breakPromise = true;
      }
    }
    // A Magus Tome: using it opens its research record (Research is a Long Rest Action).
    if (CONFIG.SACADIA.magusTomes.includes(item.flags?.sacadia?.catalogId)) return { handoff: () => this.#researchTome(item) };
    // Confusion (Magus): "no other creatures within 30ft of you can initiate a new Focus action" (warn-but-allow).
    if (item.system.tag === 'focus' && !(this.actor.system.combatState?.focusRounds?.[item.flags?.sacadia?.catalogId] > 0)) {
      const confusers = confusionSources(this.actor);
      if (confusers.length && !(await warn(game.i18n.format('SACADIA.Prestige.ConfusionWarn', { names: confusers.map((a) => a.name).join(', ') })))) return null;
    }

    // Swarm abilities that act on "all enemies inside your Swarm" (Birdbite, Delirious Flock): with nothing targeted,
    // target every enemy inside your Clouded Foe.
    if (AbilityUse.#CLOUD_TARGETING.has(mcat) && !(game.user.targets?.size)) {
      const ids = tokensInCloud(this.actor.uuid, 'foe', { hostileOnly: true }).map((t) => t.id);
      if (ids.length) canvas.tokens?.setTargets?.(ids, { mode: 'replace' });
    }

    // Weapon binding: an attack ability draws its base dice + type gating from the character's bound
    // weapon (flags.sacadia.weapon, auto-resolving to the first equipped/owned weapon). If that weapon
    // isn't equipped, offer to draw it — a 1-AP action, paid with the use. Declining calls the use off.
    const weapon = this.resolveWeapon(item);
    let draw = null;
    if (weapon && !weapon.system.equipped) {
      // A weapon in a Stored Item Slot can't be reached in combat (book p.181) — warn-but-allow.
      const stored = weapon.system.storage === 'sis' && game.combat?.started;
      const ok = await sacDialog.confirm({
        window: { title: game.i18n.localize('SACADIA.Weapon.DrawTitle') },
        content: `<p>${game.i18n.format(stored ? 'SACADIA.Inventory.DrawStored' : 'SACADIA.Weapon.DrawPrompt', { weapon: weapon.name })}</p>`,
      });
      if (!ok) return null; // declined → keep the current (unarmed / other) stance
      // Adaptive Range: "Once per turn, you do not need to use an action to draw an item from a readied item slot (RIS)."
      const tf = this.actor.getFlag('sacadia', 'turnFlags') ?? {};
      draw = { free: !stored && !tf.adaptiveDraw && ownsAbility(this.actor, 'adaptive_range') };
    }

    // Per-use choice (Blessing of the Iron Wall's PD/MD/TD, Standards Elite's Panic/Fatigue …) — prompted for every
    // ability that has one (reactions too); active abilities record it in the action log (`self:choice:<key>:<value>`),
    // and on-use effects read it as `@choice`. `requires` may list several ids (comma-separated) — any one owned enables it.
    let usedChoice = '';
    const choiceReq = (item.system.choice?.requires ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (item.system.choice?.options?.length && (!choiceReq.length || this.actor.items.some((i) => choiceReq.includes(i.flags?.sacadia?.catalogId)))) {
      usedChoice = await AbilityUse.#promptChoice(item.name, item.system.choice);
      if (usedChoice === null) return null;
    }
    // Extra AP on a consistent action (Clotsnipe, Into Fire, Dancer's Gale …): chosen now, paid with the action.
    let extraAp = 0;
    if (item.system.extraAp?.max) {
      const cap = Math.max(0, Math.round(resolveModifierValue(item.system.extraAp.max, this.actor.system._modifierNumbers?.() ?? {})));
      if (cap > 0) {
        const n = await AbilityUse.#promptResourceSpend(item.system.extraAp.label || game.i18n.localize('SACADIA.Ability.ExtraAp'), cap, cap);
        if (n === null) return null;
        extraAp = Math.min(cap, Math.max(0, n));
      }
    }
    // A number chosen at use (Life Transference's dice, Give of Thyself's checks): `@spent` in this use's formulas.
    let promptSpent = null;
    if (item.system.amountPrompt?.label) {
      const cap = Math.max(0, Math.round(resolveModifierValue(item.system.amountPrompt.max || '0', this.actor.system._modifierNumbers?.() ?? {})));
      const n = await AbilityUse.#promptResourceSpend(item.system.amountPrompt.label, cap, cap);
      if (n === null) return null;
      promptSpent = Math.min(cap, Math.max(0, n));
    }
    // Berserker Rage: "you gain one extra melee attack per turn that does not count towards either AP or limb count. You
    // may not apply a Boost to this attack." Offered on the first melee attack each turn while raging.
    let rageAttack = false;
    if (item.system.isActive && this.actor.statuses?.has('raging') && !(this.actor.getFlag('sacadia', 'turnFlags')?.rageAttack)
      && ownsAbility(this.actor, 'thug_berserker_rage')
      && (item.system.activities ?? []).some((a) => a.type === 'attack' && a.attack?.category === 'melee')) {
      rageAttack = !!(await warn(game.i18n.localize('SACADIA.Rage.FreeAttack')));
    }
    // grant-choice-redirect (Shared Blessing): if the enabling passive is owned and an ally is targeted, this ability's
    // per-use choice buff may be applied to that ally *instead of* the caster. Redirecting suppresses the self-buff by
    // clearing the logged choice (the self modifiers gate on `self:choice:…`) and applies a focus grant (keyed by the
    // choice) to the ally, anchored to this ability's focus.
    let redirectGrant = null;
    let action = null;
    if (item.system.isActive) {
      let choice = usedChoice;
      const cr = item.system.choiceRedirect;
      if (choice && cr?.requiresAbility && cr.key
        && ownsAbility(this.actor, cr.requiresAbility)
        && game.user.targets?.size
        && await AbilityUse.#confirmRedirect(item.name)) {
        const nums = this.actor.system._modifierNumbers?.() ?? {};
        const uuid = Array.from(game.user.targets)[0]?.document?.uuid;
        if (uuid) {
          redirectGrant = {
            casterUuid: this.actor.uuid,
            ability: item.flags?.sacadia?.catalogId ?? item.id,
            label: cr.label || item.name,
            targets: [uuid],
            changes: [{ key: cr.key.replace('<choice>', choice), mode: 2, value: String(resolveModifierValue(cr.value, nums)) }],
            duration: { type: 'focus', on: '' },
          };
          choice = ''; // "instead of you" — the caster forgoes the self-buff
        }
      }
      action = {
        label: item.name,
        ap: rageAttack ? 0 : (item.system.costs?.ap ?? 1) + extraAp,
        limbs: rageAttack ? [] : (item.system.costs?.limbs ?? []),
        key: item.flags?.sacadia?.catalogId ?? item.id, // for the `self:used:<key>` roll option
        choice,
        // Focus abilities feed the maintenance-streak counter (`@combat.focusRounds.<id>`); the key
        // matches the `self:used:*` / mark key so ramps and marks reference the same id.
        focusKey: item.system.tag === 'focus' ? (item.flags?.sacadia?.catalogId ?? item.id) : '',
        ranged: (item.system.activities ?? []).some((a) => a.type === 'attack' && a.attack?.category === 'ranged'),
      };
    }
    // Advantage / disadvantage for the attack roll(s), and a Consistent Roll (book p.237): "expend extra AP on any ability
    // that rolls D20s in order to add advantages to that roll, on top of the AP cost of that ability", up to the AP left
    // after its own cost. Each extra AP is 1X advantage, paid with the action (so the log shows the whole spend, which
    // Crossbow Mastery's 4+ AP reads; Bowling Bolt's 6X advantage counts it too).
    let advLevel = 0;
    let consistent = 0;
    if ((item.system.activities ?? []).some((a) => a.type === 'attack')) {
      const baseCost = (draw && !draw.free ? 1 : 0) + (action ? this.#actionCost(action).cost : 0);
      const spare = action ? Math.max(0, (this.actor.system.ap?.value ?? 0) - baseCost) : 0;
      const targets = Array.from(game.user.targets ?? []).map((t) => t.name);
      const sub = [game.i18n.localize(CONFIG.SACADIA.abilityTags[item.system.tag] ?? ''),
        targets.length ? `${game.i18n.localize('SACADIA.Card.Vs')} ${targets.slice(0, 2).join(', ')}${targets.length > 2 ? ` +${targets.length - 2}` : ''}` : '']
        .filter(Boolean).join(' · ');
      // What the first attack roll already carries: Proficiency (when trained), its Trait (Courage when a weapon attack's
      // is lower, as the roll picks), the flat to-hit bonuses and a pending Fumble, and the standing advantage. What
      // depends on the target (cover, height, marks …) is only known when it rolls, and the prompt says so.
      const act = item.system.activities.find((a) => a.type === 'attack');
      const rd = this.actor.getRollData();
      const category = act.attack.category ?? '';
      const thrown = !!item.flags?.sacadia?.thrown || usedChoice === 'thrown';
      let traitKey = (thrown && !act.attack.trait && category === 'melee') ? CONFIG.SACADIA.attackCategories.ranged.trait : act.attack.effectiveTrait;
      if (weapon && !act.attack.trait && traitKey && traitKey !== 'courage' && (Number(rd.courage) || 0) > (Number(rd[traitKey]) || 0)) traitKey = 'courage';
      const fumble = this.actor.system.conditions?.fumbled?.value ?? 0;
      const parts = [
        ...(AbilityUse.proficientIn(this.actor, category) ? [{ label: game.i18n.localize('SACADIA.Progression.Proficiency'), value: Number(rd.proficiency) || 0 }] : []),
        ...(traitKey ? [{ label: game.i18n.localize(CONFIG.SACADIA.stats[traitKey]), value: Number(rd[traitKey]) || 0 }] : []),
        ...toHitParts(this.actor, category, item.flags?.sacadia?.catalogId ?? ''),
        ...(fumble ? [{ label: game.i18n.localize('SACADIA.Condition.Fumbled'), value: -fumble }] : []),
      ];
      const adv = await AbilityUse.#advantageDialog(item.name, spare, { img: item.img, sub, baseAp: baseCost, parts,
        standing: standingAdvantage(this.actor, 'toHit'), note: game.i18n.localize('SACADIA.Roll.TargetNote') });
      if (adv === null) return null;
      consistent = Math.min(spare, Math.max(0, adv.consistent));
      advLevel = adv.level + consistent;
      if (consistent) action.ap += consistent;
    }
    // AP: the weapon draw (unless free) and the action itself, warned about once (warn-but-allow, book pp.236–237).
    const apCost = (draw && !draw.free ? 1 : 0) + (action ? this.#actionCost(action).cost : 0);
    const apNow = this.actor.system.ap?.value ?? 0;
    if (apCost > apNow && !(await warn(game.i18n.format('SACADIA.Economy.OverspendWarn', { label: item.name, cost: apCost, current: apNow }),
      game.i18n.localize('SACADIA.Economy.OverspendTitle')))) return null;

    // Hidden targets (book: "nothing in the combat sees you or may directly attack you"): warn-but-allow, since
    // whether the creature was found is the GM's call.
    const hiddenTargets = Array.from(game.user.targets ?? []).filter((t) => t.actor?.statuses?.has('hidden') && t.actor !== this.actor);
    if (hiddenTargets.length && (item.system.activities ?? []).some((a) => a.type === 'attack' || a.type === 'save')
      && !(await warn(game.i18n.format('SACADIA.Hidden.TargetWarn', { names: hiddenTargets.map((t) => t.name).join(', ') })))) return null;
    // Pull the Strand (Oracle L7): "expend 'Slightly Cracked' rolls to add or subtract your rolled number to a
    // roll made by an enemy within 30ft" — pick the saved roll and its sign.
    let strand = null;
    if (item.flags?.sacadia?.catalogId === 'oracle_pull_the_strand') {
      const saved = this.actor.system.professionResources?.oracle?.cracked ?? [];
      if (!saved.length) { ui.notifications.warn(game.i18n.localize('SACADIA.Cracked.None')); return null; }
      const buttons = saved.flatMap((v, i) => [{ action: `${i}:+`, label: `+${v}` }, { action: `${i}:-`, label: `−${v}` }]);
      const res = await sacDialog.wait({ window: { title: item.name },
        content: `<p>${game.i18n.localize('SACADIA.Cracked.PickSigned')}</p>`, buttons, rejectClose: false });
      if (!res) return null;
      const [i, sign] = String(res).split(':');
      strand = { index: Number(i), value: saved[Number(i)], sign };
    }
    // Checks made for allies (aid-resist) need their targets — settled now, so a missing one costs nothing.
    let funnel = null;
    if (item.system.aidResist?.levels) {
      if (item.system.aidResist.funnel) {
        funnel = await this.#funnelPair(item);
        if (!funnel) return null;
      } else if (!(game.user.targets?.size)) {
        ui.notifications.warn(game.i18n.format('SACADIA.Aid.NoTarget', { name: item.name }));
        return null;
      }
    }
    // Reaction-tag abilities spend the actor's per-round reaction instead of AP (book p.237): warn-but-allow if none.
    if (item.system.tag === 'reaction' && !(await this.reactionOk(item.name))) return null;
    // Signature-pool cost (e.g. 1 Arrangement point; a variable "expend X" asks how many) — warn-but-allow if short.
    const poolCost = item.system.costs?.pool;
    let poolAmount = null;
    if (poolCost?.key && (poolCost.amount > 0 || poolCost.variable)) {
      poolAmount = await this.#askPool(item.name, poolCost);
      if (poolAmount === null) return null;
    }
    // Lore points (Lore abilities): warn-but-allow when short, like AP.
    const loreCost = item.system.costs?.lore ?? 0;
    if (loreCost > 0 && this.actor.type === 'character') {
      const have = this.actor.system.lorePoints?.value ?? 0;
      if (have < loreCost && !(await warn(game.i18n.format('SACADIA.Lore.Short', { name: item.name, n: loreCost, have })))) return null;
    }
    // A grant's variable resource spend (Blessing of Hot Coal's Madness), deducted when the grant is built.
    const grantSpend = await this.#askGrantResource(item);
    if (grantSpend === null) return null;
    return { mcat, usage, ownsId, madInitiating, weapon, draw, usedChoice, extraAp, promptSpent, rageAttack, redirectGrant, action,
      strand, poolCost, poolAmount, loreCost, advLevel, consistent, grantSpend, atone, breakPromise, funnel };
  }

  async useAbility(item) {
    // Ask, then pay, then resolve. Every prompt that can call a use off runs in #planUse, before anything is spent, so a
    // dismissed dialog never strands AP, a reaction, a pool point or a Lore point. Paying (below) asks nothing; a prompt
    // after it only ever skips an optional part (a Boost, a refund, a zone's placement), never the action.
    const plan = await this.#planUse(item);
    if (!plan) return;
    if (plan.handoff) return plan.handoff();
    // The use's state, filled in stage by stage: the plan's decisions, then each stage's results for the ones after it.
    const u = { item, plan, ...plan };
    if (!(await this.#payForUse(u))) return; // Lawful Sanctuary can stop the action after its costs
    await this.#buildRollContext(u);
    await this.#consumeBoosts(u);
    await this.#rollActivities(u);
    await this.#buildAttackRequest(u);
    await this.#buildGrantRequest(u);
    await this.#bankTempHpAndNextAttack(u);
    await this.#applyOnUseEffects(u);
    await this.#postUseCard(u);
    await this.#afterUse(u);
  }

  /**
   * Pay for the use (nothing here asks the player): draw the weapon, spend AP and limbs or the reaction, count the use,
   * the Promise, then what paying sets off — A Deeper Rend, Hide Behind Hide, Yarrowstem, Pull the Strand, checks made for
   * allies, granted reactions, pool and Lore points, Lawful Sanctuary, Corrupted Iron, Berserker Rage, the range warning and
   * Sinewy Sanity's early Madness change. False when Lawful Sanctuary stops the action.
   */
  async #payForUse(u) {
    const { item, madInitiating, ownsId, plan, rageAttack, strand, usage, usedChoice, weapon } = u;
    // Drawing the bound weapon is its own 1-AP action (free once a turn with Adaptive Range).
    let hiddenBladesDraw = false;
    if (plan.draw) {
      if (plan.draw.free) await this.actor.setFlag('sacadia', 'turnFlags.adaptiveDraw', true);
      else await this.spendAction({ label: game.i18n.format('SACADIA.Weapon.DrawAction', { weapon: weapon.name }), ap: 1, limbs: [], key: '', confirmed: true });
      await weapon.update({ 'system.equipped': true, 'system.storage': 'ris' });
      // Hidden Blades: "When you bring a new dagger to bear from a readied item slot for the first time in
      // combat, treat the first target you attack with this dagger this turn as Surprised."
      if (weapon.system.weaponType === 'dagger' && game.combat && ownsId('hidden_blades')
        && weapon.getFlag('sacadia', 'drawnInCombat') !== game.combat.id) {
        hiddenBladesDraw = true;
        await weapon.setFlag('sacadia', 'drawnInCombat', game.combat.id);
      }
    }
    if (rageAttack) await this.actor.setFlag('sacadia', 'turnFlags.rageAttack', true);
    // Active abilities (Action/Focus/Ceremony) pay the AP/limb economy — same rules for PCs and NPCs (p.237); Reactions
    // spend the round's reaction instead; Passives and Lore are free (p.236).
    if (plan.action) await this.spendAction({ ...plan.action, confirmed: true });
    if (item.system.tag === 'reaction') await this.payReaction();
    await usage.commit?.(); // the action is committed (costs paid) — count it against its usage limit
    // The Witch's Promise: Atone mends a broken one; harming a creature not on your side breaks Nonviolence.
    if (plan.atone) await this.actor.unsetFlag('sacadia', 'promiseBroken');
    if (plan.breakPromise) await this.actor.setFlag('sacadia', 'promiseBroken', true);
    // A Deeper Rend: the chosen limb holds for the Focus (read by _rollOptions as `self:deeper-rend:<limb>`).
    if (item.flags?.sacadia?.catalogId === 'a_deeper_rend' && usedChoice) await this.actor.setFlag('sacadia', 'deeperRend', usedChoice);
    // Hide Behind Hide (Focus, first turn): "nothing in the combat sees you or may directly attack you".
    if (item.flags?.sacadia?.catalogId === 'hide_behind_hide') await this.actor.toggleStatusEffect('hidden', { active: true });
    // Yarrowstem: arm the Madness floor (consumed by the preUpdateActor hook; cleared on a rest).
    if (item.flags?.sacadia?.catalogId === 'yarrowstem') {
      await this.actor.setFlag('sacadia', 'yarrowstem', true);
      ui.notifications.info(game.i18n.localize('SACADIA.Madness.Yarrowstem'));
    }
    if (strand) {
      const saved = [...(this.actor.system.professionResources?.oracle?.cracked ?? [])];
      saved.splice(strand.index, 1);
      await this.actor.update({ 'system.professionResources.oracle.cracked': saved });
      const target = Array.from(game.user.targets ?? [])[0]?.name ?? game.i18n.localize('SACADIA.Cracked.AnEnemy');
      await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<div class="sacadia chat-card note-card"><strong>${item.name}</strong>: ${game.i18n.format('SACADIA.Cracked.Strand', { target, n: `${strand.sign === '-' ? '−' : '+'}${strand.value}` })}</div>` });
    }

    // Aid-resist (Call of Respite, Vision of Moss, Burning Incense): checks made for targeted allies.
    if (item.system.aidResist?.levels) await this.#aidResist(item, plan.funnel);

    // Some abilities *grant* a reaction on use (Reactionary: "gain one reaction before your next turn";
    // Legendary Reactionary makes it two). Applied after the ability's own costs so the grant is banked
    // even if it's itself a reaction.
    // Hero's Response: "take any number of additional reactions before your next turn (max your AP); reduce
    // your AP next turn by the number of additional reactions you take" — bank up to AP reactions and count
    // the ones actually spent as next turn's AP debt (#spendReaction / resetActionEconomy).
    if (item.flags?.sacadia?.catalogId === 'hero_s_response') {
      await this.actor.update({ 'system.reaction.value': (this.actor.system.reaction?.value ?? 0) + (this.actor.system.ap?.max ?? 0),
        'flags.sacadia.heroResponse': { used: 0 } });
    }
    const grantN = item.flags?.sacadia?.catalogId === 'reactionary' && ownsId('legendary_reactionary') ? 2 : item.system.grantsReaction;
    if (grantN) {
      await this.actor.update({ 'system.reaction.value': (this.actor.system.reaction?.value ?? 0) + grantN });
      ui.notifications.info(game.i18n.format('SACADIA.Reaction.Granted', { n: grantN }));
    }

    // Signature-pool cost (e.g. 1 Arrangement point) — any tag can carry one; the amount was settled in #planUse.
    const { poolCost, loreCost } = plan;
    const itemSpent = plan.poolAmount;
    if (itemSpent > 0) await this.#payPool(poolCost.key, itemSpent);
    // Lore points (Lore abilities): a shortfall was warned about in #planUse.
    if (loreCost > 0 && this.actor.type === 'character') {
      const have = this.actor.system.lorePoints?.value ?? 0;
      // Moonstone Earrings (adornment): "When you expend a Lore Point, roll 1D10. On a 10, you do not expend the Lore Point."
      let refund = false;
      if (this.actor.system._rollOptions?.()['self:gear:moonstone-earrings']) {
        const r = await new Roll('1d10').evaluate();
        refund = r.total === 10;
        await postRollCard({ actor: this.actor, roll: r, icon: 'fa-solid fa-moon', title: game.i18n.localize('SACADIA.Lore.MoonstoneTitle'),
          meta: [game.i18n.localize(refund ? 'SACADIA.Lore.MoonstoneSaved' : 'SACADIA.Lore.Moonstone')] });
      }
      if (!refund) await this.actor.update({ 'system.lorePoints.value': Math.max(0, have - loreCost) });
    }
    // Lawful Sanctuary on a target: the attacker's Wiles Check, after the costs (a failure with no new target stops here).
    if (!(await this.#lawfulSanctuary(item))) return false;
    // Corrupted Iron (Lore): warp one of your weapons or armor pieces to your Font's element, for good.
    if (item.flags?.sacadia?.catalogId === 'lore_corrupted_iron') await this.#corruptedIron(item);
    // Berserker Rage: "Rage goes away after X rounds (where X is equal to your Proficiency)" — +1 each with Lengthy Rage
    // and Anger Management. The countdown and the Fatigue at its end run at your turn ends (sacadia.mjs rageTurnEnd).
    if (item.flags?.sacadia?.catalogId === 'thug_berserker_rage') {
      const owns = (id) => ownsAbility(this.actor, id);
      const rounds = (this.actor.system.proficiency ?? 0) + (owns('thug_lengthy_rage') ? 1 : 0) + (owns('thug_anger_management') ? 1 : 0);
      await this.actor.toggleStatusEffect('raging', { active: true });
      await this.actor.setFlag('sacadia', 'rage', { rounds });
      ui.notifications.info(game.i18n.format('SACADIA.Rage.Started', { n: rounds }));
    }

    // Out-of-range check (warn-but-allow): numeric range + a targeted token whose distance exceeds it.
    const range = item.system.range;
    if (range?.value != null) {
      const dist = this.targetDistance();
      if (dist != null && dist > range.value) {
        ui.notifications.warn(game.i18n.format('SACADIA.Range.OutOfRange',
          { name: item.name, dist: Math.round(dist), range: range.value }));
      }
    }

    // Sinewy Sanity (book p123): while maintained, an ability's Madness change is rolled BEFORE its
    // effect instead of after — so a gain feeds this cast's Madness-scaling dice (Gibbering, Mad
    // Chanting, …) and a spend drains it first. "Maintained" = its focus action was re-spent this turn
    // (in the action log). Applying it here, before rollData, updates the actor's derived Madness so the
    // rolls below see the new value. The end-of-action call is then skipped (`sinewyEarly`).
    const md = item.system.madness;
    const sinewyEarly = madInitiating && (md?.gain || md?.spend)
      && this.actor.system.actionLog?.some((e) => e.key === 'sinewy_sanity');
    if (sinewyEarly) await this.#applyMadnessChange(item, true);
    Object.assign(u, { hiddenBladesDraw, itemSpent, poolCost, sinewyEarly });
    return true;
  }

  /**
   * The roll context: roll data and modifier numbers (extra AP, `@spent`), the roll options (the weapon, an opportunity
   * attack, the target's conditions and their levels, positional state, hits this turn), treat-as riders, and the pending
   * next-attack buffs this attack uses up.
   */
  async #buildRollContext(u) {
    const { extraAp, hiddenBladesDraw, item, itemSpent, poolCost, promptSpent, usedChoice, weapon } = u;
    const rollData = this.actor.getRollData();
    const bonuses = this.actor.system.bonuses ?? {};
    const numbers = this.actor.system._modifierNumbers?.() ?? {}; // flat map for @ref / dice resolution
    numbers.extraAp = rollData.extraAp = extraAp; // `@extraAp` — the extra AP spent on a consistent action
    // A variable pool price chosen at use (Beastly Presence: "Expense X Savage Points … that many levels") is
    // `@spent` in this ability's formulas.
    if (poolCost?.variable && itemSpent != null) numbers.spent = rollData.spent = itemSpent;
    if (promptSpent != null) numbers.spent = rollData.spent = promptSpent;
    // Renewing a Focus (its anchor stands): a save-gated grant (Bane, Catnap) isn't rolled for again — except one the
    // target re-checks on each renewal (Enemies Abound), which then only ends it on a success.
    const renewing = this.actor.effects.some((e) => e.flags?.sacadia?.anchor?.ability === item.flags?.sacadia?.catalogId);
    const activities = item.system.activities ?? [];
    const rolls = [];
    const cardActivities = [];

    // Phase 8/9 mechanization: extra die-steps this ability gets from owned die-step modifiers scoped
    // to it, plus its own `selfScaling` (level-based base-die growth). Both flow into damage.
    const catalogId = item.flags?.sacadia?.catalogId;
    const damageOpts = {
      extraSteps: this.actor.system.abilityDamageSteps?.[catalogId] ?? 0,
      selfScaling: item.flags?.sacadia?.selfScaling ?? null,
    };
    // Per-ability flat sinks (from qualifying scoped conditional modifiers) — applied only to this
    // ability's rolls, on top of the global bucket bonuses.
    const abilityToHit = this.actor.system.abilityToHit?.[catalogId] ?? 0;
    const abilityDamage = this.actor.system.abilityDamage?.[catalogId] ?? 0;

    // Roll-time target context (Layer A): options describing the targeted token, merged with the
    // actor's own roll options. Target-contextual modifiers are evaluated here per activity.
    const fullOptions = { ...(this.actor.system._rollOptions?.() ?? {}), ...this.#targetOptions() };
    fullOptions.usedChoice = usedChoice; // read by #rollInflict for an `@choice` condition
    fullOptions.sourceAbility = catalogId; // recorded as the source of conditions this use gives
    // A thrown attack: the generated "Throw <weapon>" ability of a Versatile weapon, or Wild Strike's
    // "thrown" pick (Wild Throws). Thrown melee attacks roll as ranged (Finesse), and they count toward
    // I'll Come Back's three throws a turn.
    const thrown = !!item.flags?.sacadia?.thrown || usedChoice === 'thrown';
    if (thrown) fullOptions['self:attack:thrown'] = true;
    // Tricky Boy: "This weapon does not deal damage. Instead, the first time you attack an enemy with this
    // weapon in combat, they gain Surprised."
    const trickyBoy = !!fullOptions['self:attack:named-by:bd_tricky_boy'];
    // Bind this attack's weapon type precisely (it's equipped by now), so gating like Bigger Stones
    // resolves off the weapon actually in hand rather than merely "some weapon is equipped". The
    // `self:attack:weapon:<type>` option names the *single* weapon this attack uses (unlike
    // `self:wielding:*`, which base-actor emits for every equipped weapon) — so weapon-family damage
    // passives (Midas Spear, Shield Bash, Swordwork) apply only to attacks with that weapon.
    if (weapon?.system.weaponType) {
      fullOptions[`self:wielding:${weapon.system.weaponType}`] = true;
      fullOptions[`self:attack:weapon:${weapon.system.weaponType}`] = true;
      // Hands (1H/2H) of the bound weapon — gates the heavy (two-handed) divine-weapon buffs.
      fullOptions[`self:attack:hands:${this.#weaponHands(weapon)}`] = true;
      // A named weapon (Bladedancer Named Weapons) → `self:attack:named-by:<ability>`.
      if (weapon.flags?.sacadia?.namedAs) fullOptions[`self:attack:named-by:${weapon.flags.sacadia.namedAs}`] = true;
      // The bound weapon's traits (`self:attack:trait:versatile` — Throwing Hand, Mastery of the Versatile Weapon).
      for (const t of String(weapon.system.traits ?? '').split(/[,\s]+/).filter(Boolean)) fullOptions[`self:attack:trait:${t.toLowerCase()}`] = true;
      // Signature (Named / Divine) weapon instance: the same designation reads as both, so the
      // Bladedancer's named-weapon and Fatebound's divine-weapon buffs each gate on their own atom
      // (a character only owns one profession's abilities, so they never collide in practice).
      if (weapon.flags?.sacadia?.signature) {
        fullOptions['self:attack:named'] = true;
        fullOptions['self:attack:divine'] = true;
      }
      // A permanent weapon-type pick (Swordwork, Harmful Hand, Sharp Weaponry, Heavy Damage …) matches
      // the weapon this attack uses → `self:attack:picked:<id>`.
      for (const { id, value } of this.actor.system._picks?.().weaponType ?? []) {
        if (value === weapon.system.weaponType) fullOptions[`self:attack:picked:${id}`] = true;
      }
    }
    // Opportunity / reaction attacks (book p.240): one of the four Opportunity Attacks (Don't Leave,
    // Reaction Attack, Ticket to Enter, Base Clobber — or a profession ability flagged the same) emits
    // `self:attack:opportunity`; any reaction-tag attack emits `self:attack:reaction`. Both are
    // roll-time atoms, so opportunity-attack passives (Hidebite, Shove and Twist, Porcupine …) gate on
    // them. Used while Steadied, an Opportunity Attack "is treated as a critical hit".
    const isOpportunity = !!item.flags?.sacadia?.opportunity;
    if (isOpportunity) fullOptions['self:attack:opportunity'] = true;
    if (item.system.tag === 'reaction') fullOptions['self:attack:reaction'] = true;
    const opportunitySteadiedCrit = !!item.flags?.sacadia?.steadiedCrit && !!fullOptions['self:steadied'];
    // Target condition *levels* as value refs (Layer A numeric): `#targetOptions` already surfaces a
    // leveled condition as `target:condition:<key>` = its level (for predicate gating), but a modifier
    // *value* or a damage/inflict formula needs it as a number too. Mirror each numeric level into
    // `numbers` as `@target.<key>` (for modifier values / structured damage counts) and into `rollData`
    // as `@target.<key>` (for Roll-evaluated damage & inflict formulas). This is what lets the Thug's
    // Wrestle Pin cluster scale off the target's Pin — Harm's `(@target.pinned)d10`, Pankration's
    // `+@target.pinned` damage, Render's Rend, etc. Absent a target the refs are simply undefined (→ 0).
    const targetLevels = {};
    for (const [k, v] of Object.entries(fullOptions)) {
      if (k.startsWith('target:condition:') && typeof v === 'number') targetLevels[k.slice(17)] = v;
    }
    for (const [k, v] of Object.entries(targetLevels)) numbers[`target.${k}`] = v;
    rollData.target = { ...(rollData.target ?? {}), ...targetLevels };
    // Positional context (book p.256): the Surrounded state (`self:surrounded` / `target:surrounded`)
    // and the adjacent-token counts (`@adjacentEnemies` / `@adjacentAllies`), computed from token
    // geometry. Merged into the options (for gating) and both number maps (for value/dice scaling), so
    // e.g. Surrounded by Me's per-adjacent-enemy damage and Flanking Forces' surrounded gate resolve.
    const pos = this.#positionalContext();
    Object.assign(fullOptions, pos.opts);
    numbers.adjacentEnemies = rollData.adjacentEnemies = pos.nums.adjacentEnemies;
    numbers.adjacentAllies = rollData.adjacentAllies = pos.nums.adjacentAllies;
    // Every adjacent creature, friend or foe (Surrounded by Friends).
    numbers.adjacentCreatures = rollData.adjacentCreatures = pos.nums.adjacentEnemies + pos.nums.adjacentAllies;
    numbers.targetAdjacentAllies = rollData.targetAdjacentAllies = pos.nums.targetAdjacentAllies ?? 0;
    // Baneful Scratch: "X is the number of unique conditions they possess (i.e., if a target has 3 Fumble, 2 Nausea,
    // and is Surrounded, they roll against 3D4)" — and with Greater Twist, "count each level … as separate".
    {
      const tActor = Array.from(game.user.targets ?? [])[0]?.actor;
      const leveled = Object.entries(tActor?.system?.conditions ?? {}).filter(([k, c]) => k !== 'madness' && (c?.value ?? 0) > 0);
      const statuses = ['prone', 'blinded', 'dragged', 'surprised', 'unconscious', 'cornered'].filter((k) => tActor?.statuses?.has(k)).length
        + (fullOptions['target:surrounded'] ? 1 : 0);
      numbers['target.uniqueConditions'] = leveled.length + statuses;
      // How many creatures are targeted (`@targetCount` — Every Enemy's X × enemies, Home Advantage) and the first
      // one's max HP (`@target.hpMax` — Healing War Cry's ¼).
      numbers.targetCount = rollData.targetCount = game.user.targets?.size ?? 0;
      numbers['target.hpMax'] = tActor?.system?.health?.max ?? 0;
      numbers['target.conditionLevels'] = leveled.reduce((n, [, c]) => n + c.value, 0) + statuses;
      rollData.target = { ...rollData.target, uniqueConditions: numbers['target.uniqueConditions'], conditionLevels: numbers['target.conditionLevels'],
        hpMax: numbers['target.hpMax'] };
    }
    // Per-target hits this turn (`@target.hits` / `target:hits`) and the number of enemies still in the
    // fight (`@combat.enemies` — Boss Energy's "only one enemy", Completionist's "every enemy").
    const tUuid = Array.from(game.user.targets ?? [])[0]?.document?.uuid;
    const tHits = (tUuid && this.actor.system.combatState?.hitsByTarget?.[tUuid]) || 0;
    numbers['target.hits'] = tHits; rollData.target = { ...(rollData.target ?? {}), hits: tHits };
    fullOptions['target:hits'] = tHits;
    numbers['combat.enemies'] = AbilityUse.#enemyCount(this.actor);
    fullOptions[`self:attack:ability:${catalogId}`] = true;
    // The limbs this action uses (`self:attack:limb:<limb>`) — A Deeper Rend buffs attacks made with one.
    for (const l of item.system.costs?.limbs ?? []) fullOptions[`self:attack:limb:${l}`] = true;
    if (hiddenBladesDraw) fullOptions['target:condition:surprised'] = true; // Hidden Blades (see the draw above)
    const targetNotes = []; // target-contextual modifier receipts, deduped for the card
    // "Treat the target as …" passives (Spearpoint, Full Monty, What's That — helpers/attack-riders.mjs).
    {
      const owned = new Set(this.actor.items.filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
      for (const r of attackRiders(owned, fullOptions, numbers).treatAs) {
        fullOptions[`target:condition:${r.condition}`] = true;
        targetNotes.push({ label: abilityItem(this.actor, r.id)?.name ?? r.id,
          target: 'advantage.toHit', mode: 'add', value: 0, text: game.i18n.localize(CONFIG.SACADIA.simpleConditions[r.condition]?.label ?? r.condition) });
      }
    }

    // Pending-attack buffs (one-shot, ride this attack then consumed): Critical Strike's advantage,
    // Sapped/Sapping flat to-hit/damage, and "treat the next target as <condition>" (Killing Frenzy →
    // Surprised, Reaching Claw → Prone — the latter feed the target-context so gated modifiers fire).
    // Drained only when this ability actually attacks; the folded totals apply to its rolls below.
    const pend = { advantage: 0, toHit: 0, damage: 0, dieStep: 0, conditions: [], notes: [] };
    if (activities.some((a) => a.type === 'attack') && (this.actor.system.pendingAttack ?? []).length) {
      Object.assign(pend, foldPendingAttack(this.actor.system.pendingAttack));
      for (const c of pend.conditions) fullOptions[`target:condition:${c}`] = true;
      await this.actor.update({ 'system.pendingAttack': [] }); // consumed
    }
    Object.assign(u, { abilityDamage, abilityToHit, activities, bonuses, cardActivities, catalogId, damageOpts, fullOptions, isOpportunity, numbers, opportunitySteadiedCrit, pend, renewing, rollData, rolls, targetNotes, thrown, trickyBoy });
  }

  /**
   * Boosts: the armed Boosts this action consumes (one per action, more with Boosted Attack or Glore; free ones ride
   * outside the limit), their costs and on-consume effects, and what they add to the roll options.
   */
  async #consumeBoosts(u) {
    const { catalogId, fullOptions, item, itemSpent, numbers, poolCost, rageAttack, rollData, weapon } = u;
    // Boost consumption (see docs — "boosts"): armed boosts that match this action are its declared
    // Boosts. The book allows one per action and none on reactions (p.236); Boostbuster allows one on an
    // opportunity attack, and Boosted Attack / Boost Stack allow two / three unique Boosts on a divine-
    // weapon attack (helpers/boosts.mjs boostLimit). Within the limit every matched boost applies; past
    // it the player picks. Each keeps its own `@spent`; costs are charged now, side effects applied now.
    const ownedSet = new Set(this.actor.items.filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
    // The rage attack takes no Boost.
    const matchedBoosts = rageAttack ? [] : this.#matchArmedBoosts(item);
    const limit = boostLimit({ tag: item.system.tag, opportunity: !!item.flags?.sacadia?.opportunity,
      divine: !!weapon?.flags?.sacadia?.signature, steadied: !!(this.actor.system._rollOptions?.()['self:steadied']), catalogId }, ownedSet);
    // "Free" boosts (Rousing Success: "without expending a Boost to that action") ride outside the limit.
    const freeBoosts = matchedBoosts.filter((b) => b.system.boost?.special?.free);
    const limited = matchedBoosts.filter((b) => !b.system.boost?.special?.free);
    // Glore (Lore): "expend any number of additional unique Boosts to that attack."
    const unlimited = matchedBoosts.some((b) => b.system.boost?.special?.unlimitedBoosts);
    const picked = [...freeBoosts, ...(unlimited ? limited : !limit ? [] : (limited.length <= limit ? limited : await AbilityUse.#pickBoosts(limited, limit)))];
    const boostSets = [];
    for (const b of picked) {
      let bn = numbers;
      // A boost's precondition (Biting Pankration: "after making at least 4 successful melee attacks against
      // that target"; Unpredictability: "against a Surprised creature") — skipped (stays armed) when unmet.
      const req = predicateAtoms(b.system.boost?.special?.requires);
      if (req.length && !evaluatePredicate(req, fullOptions)) {
        ui.notifications.info(game.i18n.format('SACADIA.Boost.NotApplicable', { name: b.name }));
        continue;
      }
      // A usage limit on the boost itself ("Once per quick rest" — Boon of the Gods): warn-but-allow, counted
      // when the boost is actually consumed. A declined warning leaves it armed.
      const bu = await this.#checkUsage(b);
      if (!bu) continue;
      // A Lore-point price (Rousing Success) — skipped (stays armed) with none left.
      const loreCost = b.system.boost?.special?.onConsume?.lore ?? 0;
      if (loreCost && (this.actor.system.lorePoints?.value ?? 0) < loreCost) {
        ui.notifications.warn(game.i18n.format('SACADIA.Boost.NoLore', { name: b.name }));
        continue;
      }
      const bp = b.system.costs?.pool ?? {};
      if (bp.key && (bp.amount > 0 || bp.variable)) {
        const spent = await this.#spendPool(b.name, bp);
        if (spent === null) continue; // cancelled → stays armed and doesn't apply
        bn = { ...numbers, spent };
      }
      // A free variable amount chosen at use (Boosted Fury: "reduce your to-hit by X … up to Proficiency").
      const pr = b.system.boost?.special?.prompt;
      if (pr?.label) {
        const max = Math.max(0, resolveModifierValue(pr.max || '0', numbers));
        const n = await AbilityUse.#promptResourceSpend(pr.label, max, max);
        if (n === null) continue;
        bn = { ...bn, spent: n };
      }
      boostSets.push({ item: b, numbers: bn, commit: bu.commit });
    }
    if (boostSets.length) {
      const ids = boostSets.map((x) => x.item.flags?.sacadia?.catalogId);
      const upd = { 'system.armedBoosts': (this.actor.system.armedBoosts ?? []).filter((c) => !ids.includes(c)) };
      // A `once` boost is logged so it can't be re-armed this turn (cleared at turn start).
      const once = boostSets.filter((x) => x.item.system.boost?.once).map((x) => x.item.flags?.sacadia?.catalogId);
      if (once.length) upd['system.boostsUsed'] = [...(this.actor.system.boostsUsed ?? []), ...once];
      await this.actor.update(upd);
      // On-consume side effects run *before* the rolls so they feed them (Mad Smear raises Madness, then
      // adds it to the attack); refresh each boost's numbers afterward.
      for (const set of boostSets) await set.commit?.();
      const poolCtx = poolCost?.key ? { key: poolCost.key, spent: itemSpent ?? 0 } : null;
      for (const set of boostSets) await this.#boostOnConsume(set.item, set.numbers, { pool: poolCtx });
      const fresh = this.actor.system._modifierNumbers?.() ?? {};
      for (const set of boostSets) set.numbers = { ...fresh, ...(set.numbers.spent != null ? { spent: set.numbers.spent } : {}) };
      Object.assign(rollData, this.actor.getRollData());
    }
    // How many Boosts ride this action (Boost Mastery: "+½ Prof damage … when you apply three Boosts").
    fullOptions['self:attack:boosts'] = boostSets.filter((x) => !x.item.system.boost?.special?.free).length;
    // Which Boosts ride it (`self:boost:<id>`): inflict entries can swap on one (Bleeding Barbs: Jinxed instead of Fumble).
    for (const { item: b } of boostSets) fullOptions[`self:boost:${b.flags?.sacadia?.catalogId}`] = true;
    // Alarming Mastery (Thug Legendary): "Treat all enemies as surprised for your first turn in combat."
    if (ownedSet.has('legendary_alarming') && fullOptions['self:combat:first-round']) fullOptions['target:condition:surprised'] = true;
    // Imposition: "Treat enemies as Surprised for the first round of combat if you go before them."
    if (ownedSet.has('imposition') && game.combat?.round === 1) {
      const turns = game.combat.turns ?? [];
      const mine = turns.findIndex((c) => c.actor?.id === this.actor.id);
      const tgt = Array.from(game.user.targets ?? [])[0];
      const theirs = tgt ? turns.findIndex((c) => c.tokenId === tgt.id) : -1;
      if (mine >= 0 && theirs > mine) fullOptions['target:condition:surprised'] = true;
    }
    // Rousing Success: "You critically succeed at that action" — an attack it rides is a critical hit.
    const forceCrit = boostSets.some((x) => x.item.system.boost?.special?.forceCrit);
    // Boost "treat the target as …" (Barreling Stature: "Treat that target as prone for that action").
    for (const { item: b } of boostSets) {
      const ta = b.system.boost?.special?.targetAs;
      if (ta) fullOptions[`target:condition:${ta}`] = true;
    }
    const boostNotes = [];
    Object.assign(u, { boostNotes, boostSets, forceCrit, ownedSet });
  }

  /**
   * Roll each activity (attacks — several for a multi-attack —, saves, damage): to-hit, damage, conditions given and the
   * critical layout. Fills the card's activities and the attack rolls for the GM.
   */
  async #rollActivities(u) {
    const { abilityDamage, abilityToHit, activities, advLevel, bonuses, boostNotes, boostSets, cardActivities, catalogId, damageOpts, extraAp, forceCrit, fullOptions, isOpportunity, item, numbers, opportunitySteadiedCrit, ownedSet, pend, renewing, rollData, rolls, targetNotes, thrown, trickyBoy, usedChoice, weapon } = u;
    // A Consistent Roll's advantage, named on the card's to-hit line ("3× Adv · Consistent Roll").
    if (u.consistent) targetNotes.push({ label: game.i18n.localize('SACADIA.Roll.Consistent'), target: 'advantage.toHit', mode: 'add', value: u.consistent });
    const boostSaveDamage = []; // rolled boost damage riding a save activity (consumed by the first save)

    // First attack activity with a known target defense feeds GM-side hit resolution (Phase 10).
    const attackSubs = [];           // one resolution sub-attack per rolled attack (multi-attack → several)
    let currentSub = null;           // the sub being built for the activity in hand (attack → its damage)

    // Crit pipeline (Phase 2): owned crit abilities, split into always-on riders / pick-menu choices /
    // damage-variant mods (see helpers/crit-effects.mjs). Resolved once, applied on the attack that crits.
    const ownedAbilityIds = this.actor.items
      .filter((i) => i.type === 'ability').map((i) => i.flags?.sacadia?.catalogId).filter(Boolean);
    let critLayoutData = null;       // the owned layout, set on the attack that crits
    const critRiderInflict = [];     // rider on-hit inflicts (Fumbling Slice), merged into the first sub
    let pendDone = false;            // pending-attack buffs ride only the first attack activity

    // Multi-attack (Wild Strike / Dagger Threat): roll the attack activity several times for one AP. Expand
    // it into `attackCount` labeled copies so the loop produces that many to-hit + damage rolls, each its
    // own sub-attack. `upgrade` (Third Arm) raises the count when the actor owns that passive.
    const ma = item.system.multiAttack;
    let attackCount = 1;
    // A boost that collapses a multi-attack into one (Razorbite: "instead of making attacks against all enemy
    // targets, make a single Unarmed attack against one target").
    const singleAttack = boostSets.some((x) => x.item.system.boost?.special?.singleAttack);
    if (ma?.targeting === 'each' && !singleAttack) {
      // Dynamic: one attack per targeted token (Forbidden Web — "roll against each enemy in one action"),
      // but only when the enabling ability is owned (Forbidden Knowledge alone stays single-target).
      const owned = !ma.requiresAbility || ownedAbilityIds.includes(ma.requiresAbility);
      const nTargets = game.user.targets?.size ?? 0;
      if (owned && nTargets > 1) attackCount = nTargets;
    } else if (ma?.countFormula) {
      // A scaling number of attacks (Magic Missive: "up to X targets, X = ½ Proficiency"), split across the targets.
      attackCount = Math.max(1, Math.round(resolveModifierValue(ma.countFormula, numbers)));
    } else if (ma?.count > 1) {
      attackCount = ma.count;
      if (ma.upgrade?.ability && ma.upgrade.count > attackCount && ownedAbilityIds.includes(ma.upgrade.ability)) attackCount = ma.upgrade.count;
    }
    // Extra attacks a boost adds to this action (Freefire: one per 2 Trickshot; Long Arc / Solar Arc: more
    // targets, base weapon dice only; Rebound: one more at 1× disadvantage). They follow the regular ones.
    let extra = 0, extraAdv = 0, extraBaseOnly = false;
    for (const { item: b, numbers: bn } of boostSets) {
      const sp = b.system.boost?.special ?? {};
      if (!sp.extraAttacks) continue;
      extra += Math.max(0, Math.floor(resolveModifierValue(sp.extraAttacks, { ...bn, ...Object.fromEntries([...ownedSet].map((id) => [`owns.${id}`, 1])) })));
      extraAdv += sp.extraAttackAdvantage ?? 0;
      if (sp.baseOnly) extraBaseOnly = true;
    }
    const regular = attackCount;
    attackCount += extra;
    const nth = (i) => game.i18n.format('SACADIA.MultiAttack.Nth', { n: i + 1 });
    const rollActivities = attackCount > 1
      ? activities.flatMap((a) => a.type === 'attack'
        ? Array.from({ length: attackCount }, (_, i) => ({ ...a, _multiIndex: i,
          ...(i >= regular ? { _extraAdv: extraAdv, ...(extraBaseOnly ? { baseDamageOnly: true } : {}) } : (extraBaseOnly ? { baseDamageOnly: true } : {})) }))
        : [a])
      : activities;

    const activityHolds = (a) => !a.predicate?.length || evaluatePredicate(a.predicate, fullOptions);
    for (const act of rollActivities) {
      if (!activityHolds(act)) continue;
      if (renewing && act.type === 'save' && act.save?.ext?.grantOnFail && !act.save.ext.resaveOnRenew) continue;
      // Label each multi-attack copy ("Attack 1/2/…") on the card so the several rolls read distinctly.
      const entry = { type: act.type, label: (attackCount > 1 && act.type === 'attack') ? `${act.label ? act.label + ' ' : ''}${nth(act._multiIndex ?? 0)}` : act.label };

      const category = act.type === 'attack' ? ((thrown && act.attack.category === 'melee') ? 'ranged' : act.attack.category) : '';
      // Target-contextual modifiers for this activity (gated on the targeted token's state). Re-folded
      // below for attacks once advantage is known, so its notes are pushed after that (not here).
      let tmod = this.#targetModifiers(fullOptions, numbers, category, catalogId);
      // Consumed boost's effects for this activity (same sinks as tmod). Deduped onto the card once.
      const bmod = this.#foldBoostSets(boostSets, category);
      if (boostSets.length && !boostNotes.length) boostNotes.push(...bmod.notes);
      // Pending-attack buffs ride the first attack activity of this action only (they're "your next
      // attack"), then are inert for any further activities.
      const p = (act.type === 'attack' && !pendDone) ? pend : { advantage: 0, toHit: 0, damage: 0, dieStep: 0 };

      // combat-context (Boltshot family, book p.170): the net advantage on *this* attack — as a roll
      // option (`self:attack:has-advantage`) and a scaler (`@advantageStacks`) — computed *before* the
      // damage fold so advantage-gated damage modifiers resolve with the right stack count. Advantage
      // sources: player-chosen + pending + boost + target-modifier grants (cover negation, Loose Morals)
      // − target cover + the actor's standing advantage/disadvantage sinks; disadvantage floors it at 0.
      // These transient atoms are per-attack, so clear them first (a prior sub-attack may have set them),
      // then re-fold the target modifiers advantage-aware (advantage-*granting* mods don't depend on the
      // stack count, so tmod.advToHit is stable across the re-fold — no circularity).
      delete fullOptions['self:attack:has-advantage'];
      delete fullOptions['self:attack:ap:2plus'];
      delete fullOptions['self:attack:advantage-stacks'];
      let situ = { adv: 0, notes: [] };
      if (act.type === 'attack') {
        situ = this.#situationalAdvantage(fullOptions, category, act.attack.defense || weapon?.system.defense || '');
        const stacks = Math.max(0, advLevel + tmod.advToHit + bmod.advToHit + p.advantage + situ.adv
          + (this.actor.system.advantage?.toHit ?? 0) - (this.actor.system.disadvantage?.toHit ?? 0));
        fullOptions['self:attack:has-advantage'] = stacks > 0;
        fullOptions['self:attack:advantage-stacks'] = stacks; // numeric — Bowling Bolt's "≥6× advantage"
        numbers.advantageStacks = rollData.advantageStacks = stacks;
        // "expend at least 2 AP" gate — this attack's AP: its cost plus any Consistent Roll AP spent on it.
        if ((item.system.costs?.ap ?? 0) + (u.consistent ?? 0) >= 2) fullOptions['self:attack:ap:2plus'] = true;
        tmod = this.#targetModifiers(fullOptions, numbers, category, catalogId); // advantage-aware re-fold
      }
      targetNotes.push(...tmod.notes);

      // Flat to-hit/damage bonuses that apply to this activity: the `all` bucket, the category
      // bucket (melee/ranged/magic), this ability's own scoped bonus, target-contextual + boost + pending.
      // Guiding Wingbeats (v1.2): allies within a Clouded Ally whose caster maintains it get +½Prof (rounded up) to-hit,
      // and with Wingthrust the same to damage on a hit — the caster's Proficiency.
      const wing = act.type === 'attack' ? AbilityUse.#wingbeats(this.actor) : { toHit: 0, damage: 0 };
      if (wing.toHit) targetNotes.push({ label: 'Guiding Wingbeats', target: 'toHit', mode: 'add', value: wing.toHit });
      if (wing.damage) targetNotes.push({ label: 'Wingthrust', target: 'damage', mode: 'add', value: wing.damage });
      const flatToHit = (bonuses.toHit?.all ?? 0) + (category ? (bonuses.toHit?.[category] ?? 0) : 0) + abilityToHit + tmod.toHit + bmod.toHit + p.toHit + wing.toHit;
      const flatDamage = (bonuses.damage?.all ?? 0) + (category ? (bonuses.damage?.[category] ?? 0) : 0) + abilityDamage + tmod.damage + bmod.damage + p.damage + wing.damage;
      // Dice-valued conditional damage (Consecutive Threat): global `all` + category buckets + this
      // ability's scoped dice + target-contextual + boost dice. Each is a formula appended (counter-scaled).
      const dd = this.actor.system.damageDiceBonus ?? {};
      const diceBonus = [
        ...(dd.all ?? []), ...(category ? (dd[category] ?? []) : []),
        ...(this.actor.system.abilityDamageDice?.[catalogId] ?? []), ...tmod.dice, ...bmod.dice,
      ].map((d) => ({ label: d.label, formula: AbilityUse.resolveDiceLabel(d.formula, numbers) }));

      if (act.type === 'attack') {
        // Cover the *target* has (book p239/254): attacks against a covered creature take disadvantage —
        // 1× at Half, 2× at Full. It's the defensive half of the player-set Cover state (`target:cover`
        // rank). Abilities negate/reduce it as gated advantage (Expert Marksman vs Half, Curving Shots
        // vs Full) which rides in `tmod.advToHit`, so the net is what lands on the die.
        // Situational advantage (see #situationalAdvantage): the target's Cover, the core melee advantage
        // vs a Surrounded or Prone target, and the target's own defensive modifiers vs incoming attacks.
        targetNotes.push(...situ.notes);
        const die = this.d20FromLevel(advLevel + tmod.advToHit + bmod.advToHit + p.advantage + situ.adv + (act._extraAdv ?? 0), 'toHit');
        let traitKey = (thrown && !act.attack.trait && act.attack.category === 'melee') ? CONFIG.SACADIA.attackCategories.ranged.trait : act.attack.effectiveTrait;
        // Weapon attacks (v1.2 p.219): "If a weapon attack, you may choose to use Courage or the Trait associated
        // with the attack type" — take the better of the two, unless the ability fixes its own trait.
        if (weapon && !act.attack.trait && traitKey && traitKey !== 'courage'
          && (Number(rollData.courage) || 0) > (Number(rollData[traitKey]) || 0)) {
          traitKey = 'courage';
          targetNotes.push({ label: game.i18n.localize('SACADIA.Roll.CourageToHit'), target: 'toHit', mode: 'add', value: 0, text: game.i18n.localize('SACADIA.Stat.Courage.long') });
        }
        // Proficient attacks (book p.6): "You do not add your Proficiency to untrained attacks."
        const proficient = AbilityUse.proficientIn(this.actor, category);
        if (!proficient) targetNotes.push({ label: game.i18n.localize('SACADIA.Roll.Untrained'), target: 'toHit', mode: 'add', value: 0, text: game.i18n.localize('SACADIA.Roll.NoProficiency') });
        let f = proficient ? `${die} + @proficiency` : `${die}`;
        if (traitKey) f += ` + @${traitKey}`;
        if (flatToHit) f += ` + ${flatToHit}`;
        // Fumbled (book p.257): the very next d20 roll is reduced by the Fumble count, then it's spent.
        const fumble = this.actor.system.conditions?.fumbled?.value ?? 0;
        if (fumble > 0) {
          f += ` - ${fumble}`;
          targetNotes.push({ label: game.i18n.localize('SACADIA.Condition.Fumbled'), target: 'toHit', mode: 'add', value: -fumble });
        }
        const toHit = await new Roll(f, rollData).evaluate();
        rolls.push(toHit);
        if (fumble > 0) await this.actor.update({ 'system.conditions.fumbled.value': 0 });
        // Count reaction attacks between your turns (the second one I'm Not Supposed to Be Here allows).
        if (item.system.tag === 'reaction') await this.actor.update({ 'system.combatState.reactionAttacks': (this.actor.system.combatState?.reactionAttacks ?? 0) + 1 });
        await this.consumeRollGrants(); // Help's +1 advantage was read into this die — spend it
        // Critical hit: the *kept* natural d20 (dice[0].total handles advantage kh1 / disadvantage kl1)
        // meets the actor's crit floor (20 by default; 19/18 with Criticality / Divine Criticality). A
        // crit is a separate axis from hit/miss — surfaced on the card and passed to GM resolution.
        let natural = toHit.dice[0]?.total ?? 0;
        let hitTotal = toHit.total;
        // Critical Mastery (Fatebound): "Once per Quick Rest, when you roll a natural 1 on a D20, you may treat it
        // as a natural 20." Offered on the kept natural 1; the to-hit is re-read with the 20.
        if (natural === 1 && ownedSet.has('mastery_critical') && !this.actor.getFlag('sacadia', 'restFlags')?.masteryCritical
          && await confirmWarn('Critical Mastery', game.i18n.localize('SACADIA.Crit.MasteryCritical'))) {
          await this.actor.setFlag('sacadia', 'restFlags.masteryCritical', true);
          natural = 20;
          hitTotal += 19;
          targetNotes.push({ label: 'Critical Mastery', target: 'toHit', mode: 'add', value: 19 });
        }
        // Miss Recovery (Sentinel triggered-resource, book p.171): the *first* natural 1 on a bow to-hit
        // each quick rest refunds 1 AP for the turn. It's a passive with no activity of its own — it rides
        // any bow attack — so it's detected here on the kept die, gated on ownership + a rest-scoped
        // one-shot flag (`flags.sacadia.missRecoveryUsed`, cleared in #restRecovery). "Bow" reads as the
        // bow family (bow + crossbow), a documented simplification of the book's "a bow".
        if (natural === 1 && ownedAbilityIds.includes('miss_recovery')
          && ['bow', 'crossbow'].includes(weapon?.system.weaponType)
          && !this.actor.getFlag('sacadia', 'missRecoveryUsed')) {
          const ap = this.actor.system.ap ?? {};
          await this.actor.update({
            'system.ap.value': Math.min((ap.value ?? 0) + 1, ap.max ?? Number.MAX_SAFE_INTEGER),
            'flags.sacadia.missRecoveryUsed': true,
          });
          entry.missRecovery = true; // card receipt (renders a "recovered 1 AP" line)
          ui.notifications.info(game.i18n.localize('SACADIA.Triggered.MissRecovery'));
        }
        // A Steadied Opportunity Attack is treated as a critical hit regardless of the die (book p.240).
        // Surprised targets (book p.258): "attacks made against them critically hit if they hit".
        // Baneful Trade (Magus): "they critically hit with their first attack each turn".
        const baneful = (this.actor.system.bonuses?.forceCritFirst ?? 0) > 0 && (this.actor.system.combatState?.attacksThisTurn ?? 0) === 0 && (act._multiIndex ?? 0) === 0;
        // Corrupting Touch (Lore): "if you roll a Prime number on a D20 (2, 3, 5, 7, 11, or 13), treat it as a critical
        // hit … do not treat Nat20s rolled as Critical Hits."
        const primes = (this.actor.system.bonuses?.primeCrits ?? 0) > 0;
        const naturalCrit = primes ? [2, 3, 5, 7, 11, 13].includes(natural) : natural >= (this.actor.system.critThreshold ?? 20);
        entry.crit = !act.autoHit && (naturalCrit || opportunitySteadiedCrit
          || !!fullOptions['target:condition:surprised'] || forceCrit || baneful);
        if (act.autoHit) entry.autoHit = true;
        if (entry.crit) {
          // Crushing Blow: "When you critically hit a Targeted Foe, increase the dice type of your divine weapon".
          critLayoutData = critLayout(ownedAbilityIds.filter((id) => id !== 'crushing_blow'
            || (fullOptions['target:mark:targeted-foe'] && fullOptions['self:attack:divine'])));
          // Always-on riders fold into *this* attack now (they don't consume the pick): extra damage
          // dice ride the damage roll below; on-hit inflicts merge into the attack after the loop.
          for (const r of critLayoutData.riders) {
            if (r.damageDice) diceBonus.push({ label: r.label, formula: AbilityUse.resolveDiceLabel(r.damageDice, numbers) });
            if (r.inflict) critRiderInflict.push(r.inflict);
          }
          // The pick menu, for the card's chooser (Maximize is always first).
          entry.critChoices = critLayoutData.choices.map((c) => ({ label: c.label, kind: c.kind, text: c.text ?? '' }));
          // Self-effect picks the *roller* applies from their own card: AP recovery (Rapidstrike), limb
          // recovery (Paused Critical), temp-HP (Critical Recovery), and next-attack advantage (Critical
          // Strike → a pending-attack buff the next attack consumes).
          entry.critSelf = critLayoutData.choices
            .filter((c) => c.kind === 'self' && ['ap', 'limb', 'tempHp', 'advantage'].includes(c.effect))
            .map((c) => {
              const item = { effect: c.effect, amount: c.amount ?? 1, label: c.label };
              // Temp-HP dice grow at the ability's scale levels and step once more if Lifeguard is owned
              // (book p.96) — resolved to a concrete die here so the button just rolls it.
              if (c.effect === 'tempHp' && c.dice) {
                const [, cnt, den] = /^(\d+)d(\d+)$/.exec(c.dice) ?? [];
                if (den) {
                  let steps = (c.scaleLevels ?? []).filter((l) => (this.actor.system.level ?? 1) >= l).length;
                  if (ownedAbilityIds.includes('lifeguard')) steps += 1;
                  const s = stepDie(cnt, Number(den), steps, CONFIG.SACADIA.diceLadder);
                  item.dice = `${s.count}d${s.denomination}`;
                } else item.dice = c.dice;
              }
              return item;
            });
          entry.critBudget = critLayoutData.budget;
        }
        entry.toHit = await toHit.render();
        entry.traitLabel = traitKey ? game.i18n.localize(CONFIG.SACADIA.stats[traitKey]) : null;
        // A catalog weapon-attack often names no defense (the prose just says "make a melee attack");
        // fall back to the bound weapon's target defense (default PD) so the hit still resolves.
        let atkDefense = act.attack.defense || weapon?.system.defense || '';
        // Imbued Fury: "Your attacks target AD … against a Targeted Foe"; Spirit Blade (Focus): the divine weapon
        // attacks AD.
        if (atkDefense && ((ownedSet.has('imbued_fury') && fullOptions['target:mark:targeted-foe'])
          || (fullOptions['self:attack:divine'] && (this.actor.system.combatState?.focusRounds?.spirit_blade ?? 0) > 0)
          // Allied Spirit Blade (Witch): the ally's chosen weapon "attacks AD … instead of other armor types".
          || (weapon && (this.actor.system.bonuses?.attackAd ?? 0) > 0))) atkDefense = 'ad';
        entry.defenseLabel = atkDefense
          ? game.i18n.localize(`SACADIA.Defense.${atkDefense.toUpperCase()}`) : null;
        if (atkDefense) {
          currentSub = { defenseKey: atkDefense, toHitTotal: hitTotal, damage: 0, crit: entry.crit,
            // Crossbow Mastery: 4+ AP on a consistent crossbow attack vs a Surrounded/Cornered target, or with
            // Height — it hits even if it would miss (GM resolution honors `autoHit`).
            // An attack that simply lands (Magic Missive, Barbed Stare), or Crossbow Mastery's conditions.
            // Infallible (Lore): "any attack you attempt that would miss hits instead".
            autoHit: !!act.autoHit || (this.actor.system.bonuses?.autoHit ?? 0) > 0 || (ownedSet.has('mastery_crossbow') && weapon?.system.weaponType === 'crossbow'
              && ((this.actor.system.actionLog ?? []).at(-1)?.ap ?? 0) >= 4
              && !!(fullOptions['target:surrounded'] || Array.from(game.user.targets ?? [])[0]?.actor?.statuses?.has('cornered') || this.actor.statuses?.has('height'))),
            weaponType: weapon?.system.weaponType ?? '',
            // The activity's own on-hit inflicts plus any attack-rider passive's (Bowling Bolt → Prone).
            inflict: [
              ...await this.#rollInflict(act, rollData, fullOptions),
              ...await this.#rollInflict({ inflict: attackRiders(new Set(ownedAbilityIds), fullOptions, numbers).inflicts.map((r) => r.inflict) }, rollData, fullOptions),
            ],
            // Melee + one-handedness of the bound weapon, so GM-side resolution can gate Remaneuver
            // (post-roll-boost: a one-handed melee attack that misses may raise its to-hit).
            melee: category === 'melee', hands: weapon ? this.#weaponHands(weapon) : 1,
            // Post-roll options (module/helpers/post-roll.mjs) need these GM-side: the attack category
            // (Block = melee physical, Dodge = ranged), the kept natural d20 (re-rolls swap it), the source
            // ability (Spider's Trap rides Forbidden Knowledge/Web), and the attack's nature.
            category, natural, abilityId: catalogId, opportunity: isOpportunity,
            // The attacker's natural-d20 crit floor (Torq of Thorns widens it after the roll).
            critFloor: this.actor.system.critThreshold ?? 20,
            // The (first) target's Surrounded state as seen at roll time — GM-side defensive
            // modifiers (Toughhide's DR when Surrounded) read it.
            targetSurrounded: !!fullOptions['target:surrounded'],
            // A boost's Check-DC bump on this attack's save-to-negate inflicts (Conditioned Strike).
            saveDcBonus: bmod.saveDc ?? 0,
            // Piercing Pin: one roll through two creatures in a line — full damage to the first targeted, half
            // (rounded up) to the second.
            halfAfterFirst: boostSets.some((x) => x.item.system.boost?.special?.pierce),
            // The damage type, for typed resistances (book p.222): the weapon's, an element (Elemental Weapon, Corrupted
            // Iron, Corrupting Touch), or the ability's own (Magic Missive: mental).
            damageType: this.#attackDamageType(act, weapon),
            // Spirit Sap: the target's temp HP is stripped before this hit's damage lands.
            stripTempHp: boostSets.some((x) => x.item.system.boost?.special?.stripTempHp),
            // HP the attacker pays if this attack hits (Pained Bash).
            // Tough Skull: "You do not take damage when you use Pained Bash."
            selfCostOnHit: act.selfCostOnHit && !(catalogId === 'thug_pained_bash' && ownedSet.has('thug_tough_skull'))
              ? Math.max(0, Math.round(resolveModifierValue(act.selfCostOnHit, numbers))) : 0,
            // Boost-carried resolution riders: a graze on a near miss (Boostbane) and on-kill effects (Tear Apart).
            ...AbilityUse.#subBoostRiders(boostSets, weapon, ownedSet),
            divine: !!weapon?.flags?.sacadia?.signature,
            label: attackCount > 1 ? nth(act._multiIndex ?? 0) : '' };
          attackSubs.push(currentSub);
        } else currentSub = null;
      }

      if (act.type === 'save') {
        // A boost may change the save's trait (Bleeding Barbs: "The target instead makes Wiles Checks").
        const traitKey = boostSets.map((x) => x.item.system.boost?.special?.saveTrait).find(Boolean) || act.save.trait;
        // Pre-compute inflicted-condition levels now (they scale off the *user's* stats); the target
        // applies them to itself on a failed save (see onSaveRoll).
        const inflict = await this.#rollInflict(act, rollData, fullOptions);
        // Boost contributions to a save it rides: extra inflicts (Tripping Kick's Prone, Concussive Slam's
        // Rend) and bonus levels (Starter: +1 Pin, capped at Proficiency).
        for (const { item: b } of boostSets) {
          if (b.system.boost?.inflict?.length) inflict.push(...await this.#rollInflict({ inflict: b.system.boost.inflict }, rollData, fullOptions));
          for (const [cond, n] of Object.entries(b.system.boost?.special?.inflictBonus ?? {})) {
            const hit = inflict.find((i) => i.condition === cond);
            if (hit) hit.level = Math.min(Math.max(hit.level, this.actor.system.proficiency ?? hit.level), hit.level + n);
          }
        }
        // Caster-side save modifiers, folded with this save's inflicts in view: `inflict:<cond>` atoms
        // (and `@inflict.<cond>` levels) let Tough Starter hit Pin saves, Bloodletter scale with the
        // Hemorrhage attempted, etc. Boost effects may carry the same targets (Enormity, Hoofslam).
        const inflictOpts = Object.fromEntries(inflict.map((i) => [`inflict:${i.condition}`, true]));
        // A condition an ability picked is among them (Sling Mastery's chosen condition) → `inflict:picked:<id>`.
        for (const { id, value } of this.actor.system._picks?.().condition ?? []) {
          if (inflict.some((i) => i.condition === value)) inflictOpts[`inflict:picked:${id}`] = true;
        }
        const inflictNums = Object.fromEntries(inflict.map((i) => [`inflict.${i.condition}`, i.level]));
        const smod = this.#targetModifiers({ ...fullOptions, ...inflictOpts }, { ...numbers, ...inflictNums }, category, catalogId);
        for (const n of smod.notes) if (n.target === 'saveAdvantage' || n.target === 'saveDc') targetNotes.push(n);
        // Lodestone (trinket): "if you attempt to kick or grab a target wearing Iron Armor, they gain 1X Disadvantage."
        const tActorL = Array.from(game.user.targets ?? [])[0]?.actor;
        const lodestone = fullOptions['self:gear:lodestone'] && ['basic_kick', 'basic_grab'].includes(catalogId)
          && tActorL?.items?.some((i) => i.type === 'armor' && i.system.equipped && armorMaterial(i) === 'iron') ? -1 : 0;
        const saveAdv = smod.saveAdv + (bmod.saveAdv ?? 0) + lodestone;
        // Characters carry a per-slot Check DC object; NPCs a flat number.
        const cd = this.actor.system.checkDc;
        const baseDc = act.save.dc ?? (typeof cd === 'number' ? cd : cd?.primary) ?? 10;
        entry.save = {
          dc: baseDc + smod.saveDc + (bmod.saveDc ?? 0),
          traitKey,
          traitLabel: traitKey ? game.i18n.localize(CONFIG.SACADIA.stats[traitKey]) : '',
          inflictData: inflict.length ? JSON.stringify(inflict) : '',
          adv: saveAdv,
          advLabel: saveAdv ? `${saveAdv > 0 ? '+' : ''}${saveAdv}×` : '',
          onSuccess: act.save.onSuccess || 'none',
          drain: act.save.drain || '',
          casterPc: this.actor.type === 'character' ? 1 : 0,
          caster: this.actor.uuid,
          ability: catalogId,
          damage: 0,
          // Per-failed-level damage (Biting Pankration: 1D6 per level of Pin taken, 1D8 @11, +1 type with
          // The Extra Bite) and a pending buff for the caster per failure (Sapped Fates / Sapping Strike).
          // Per-failed-check damage the activity itself carries (Olive Branch: 1D6 per failed check, 1D8 with Oldgrove).
          perLevel: act.save?.ext?.perFailDie ? String(ownedSet.has(act.save.ext.perFailDieWith?.ability) ? act.save.ext.perFailDieWith.die : act.save.ext.perFailDie) : '',
          pending: '',
          // Prestige save extensions (Siphon Soul's AP per failure, Witch's Finger's cap, Olive Branch's heal …).
          ext: this.#saveExt(act, item, numbers, usedChoice, boostSets, renewing),
        };
        // Tweak the Heart: "+1 Check DC for that effect" — a one-shot grant, spent by this condition attempt.
        if (inflict.length) await this.#consumeGrantsWith('inflict', 'checkDc');
        for (const { item: b } of boostSets) {
          const sp = b.system.boost?.special ?? {};
          if (sp.perLevelDamage) {
            const [, cnt, den] = /^(\d*)d(\d+)$/.exec(sp.perLevelDamage) ?? [];
            let steps = (sp.perLevelScale ?? []).filter((l) => (this.actor.system.level ?? 0) >= l).length
              + (sp.perLevelStepWith && ownedSet.has(sp.perLevelStepWith) ? 1 : 0);
            entry.save.perLevel = den ? `${stepDie(cnt || '1', Number(den), steps, CONFIG.SACADIA.diceLadder).denomination}` : '';
          }
          if (sp.pendingPerFail) {
            const pf = { toHit: sp.pendingPerFail.toHit ?? 0, damage: (sp.pendingPerFail.damageWith && ownedSet.has(sp.pendingPerFail.damageWith)) ? 1 : 0, label: b.name };
            entry.save.pending = JSON.stringify(pf);
          }
          if (sp.marginStep) entry.save.margin = sp.marginStep.margin;
          if (sp.storeMomentum) entry.save.momentum = 1;
          // Damage a boost adds to the forced check, dealt on a failure (Horn Butting: 1D10+Power → 2D6 @5 →
          // 2D8 @11; Ribcrack: XD6, X = Finesse) — the highest tier at or below the actor's level.
          if (sp.saveDamage?.length) {
            const lvl = this.actor.system.level ?? 1;
            const tier = sp.saveDamage.filter((t) => lvl >= (t.level ?? 1)).at(-1);
            if (tier?.formula) {
              const r = await new Roll(tier.formula, rollData).evaluate();
              rolls.push(r);
              boostSaveDamage.push({ total: r.total, html: await r.render() });
            }
          }
        }
      }

      // Damaging Slingblow: "Whenever you make a ranged attack with a sling that applies a condition … also roll
      // normal damage on that attack."
      const slingDamage = act.noDamage && act.type === 'attack' && ownedSet.has('damaging_slingblow')
        && weapon?.system.weaponType === 'sling' && (act.inflict ?? []).length > 0;
      if (['attack', 'save', 'damage'].includes(act.type) && (!act.noDamage || slingDamage) && !(trickyBoy && act.type === 'attack')) {
        // A weapon attack whose ability defines no base dice of its own rolls the weapon's base dice.
        // Base-damage-only (Base Clobber): the bound weapon's dice alone, even on a damage activity.
        const weaponPart = (weapon && (act.type === 'attack' || act.baseDamageOnly || (act.weaponDamageWith && ownedAbilityIds.includes(act.weaponDamageWith)))
          && weapon.system.weaponDamage?.denomination) ? weapon.system.weaponDamage : null;
        // Heavy Damage / Heavier Damage: re-roll a 1 (and a 2) once on the picked weapon's base dice.
        const weaponReroll = fullOptions['self:attack:picked:heavy_damage'] ? (ownedAbilityIds.includes('heavier_damage') ? 2 : 1) : 0;
        const dmgOpts = act.baseDamageOnly
          ? { extraSteps: 0, flatDamage: 0, diceBonus: [], weaponPart: weaponPart ? { ...weaponPart, trait: '' } : null, numbers }
          : { ...damageOpts, extraSteps: damageOpts.extraSteps + tmod.dieStep + bmod.dieStep + p.dieStep
              // Razorleaf / Needlepine (Witch): die-steps on attacks with one weapon type.
              + (act.type === 'attack' && weapon ? (this.actor.system.bonuses?.weaponSteps?.[weapon.system.weaponType] ?? 0) : 0)
              // Clotsnipe: one dice type per AP spent beyond the first.
              + (item.system.extraAp?.stepPerAp ? extraAp * item.system.extraAp.stepPerAp : 0)
              // Embossed Patch / Momentum Charm (adornments): a die type on the turn's first qualifying melee attack.
              + (act.type === 'attack' ? await this.#adornmentSteps(category, weapon, fullOptions) : 0),
            flatDamage, diceBonus, weaponPart, numbers, weaponReroll,
            minWeaponDie: catalogId === 'wild_strike' ? (ownedSet.has('feralwild') ? 6 : ownedSet.has('wilder_strike') ? 4 : 0) : 0,
            // Call of Effort's grant: +N damage per AP this effect costs.
            ...(this.actor.system.bonuses?.damagePerAp ? { flatDamage: flatDamage + this.actor.system.bonuses.damagePerAp * (item.system.costs?.ap ?? 0) } : {}) };
        const dmgBonuses = act.baseDamageOnly ? { dieStep: 0 } : bonuses;
        // "Treat this attack as a critical hit" on a damage-only opportunity attack (Base Clobber while
        // Steadied) is the crit baseline — Maximize.
        // Explosive Rage (Lore): "make all your attacks for the remainder of your turn do maximum damage if they hit".
        const maximizeBase = (act.baseDamageOnly && opportunitySteadiedCrit)
          || (act.type === 'attack' && (this.actor.system.bonuses?.maximizeDamage ?? 0) > 0);
        const dmg = maximizeBase
          ? await (async () => { const f = this.buildDamageFormula(act, dmgBonuses, dmgOpts); return f ? new Roll(f, rollData).evaluate({ maximize: true }) : null; })()
          : await this.#rollDamage(act, rollData, dmgBonuses, dmgOpts);
        if (dmg) {
          rolls.push(dmg);
          entry.damage = await dmg.render();
          const dtype = act.type === 'attack' ? this.#attackDamageType(act, weapon) : normalizeDamageType(act.damage?.[0]?.type, CONFIG.SACADIA.damageTypes);
          if (dtype) entry.damageTypeLabel = game.i18n.localize(CONFIG.SACADIA.damageTypes[dtype]?.label ?? dtype);
          if (entry.save) entry.save.dtype = dtype;
          if (currentSub && act.type === 'attack' && !currentSub.damage) currentSub.damage = dmg.total;
          // A save's damage rides its button so the saver's roll applies it (full / half / none).
          if (act.type === 'save' && entry.save) {
            entry.save.damage = dmg.total;
            // Backpress: a failure by 5+ steps Harm's die one type — pre-roll that variant too.
            const ms = boostSets.map((x) => x.item.system.boost?.special?.marginStep).find(Boolean);
            if (ms) {
              const f = this.buildDamageFormula(act, bonuses, { ...dmgOpts, extraSteps: (dmgOpts.extraSteps ?? 0) + (ms.steps ?? 1) });
              if (f) entry.save.altDamage = (await new Roll(f, rollData).evaluate()).total;
            }
          }
        }
        // Crit damage variants (Phase 2): the *choices* that transform damage. Maximize (baseline; +die-
        // steps from Nicking Touch / Crushing Blow) uses evaluate({maximize}); Critical Harm doubles every
        // die count. Precomputed here so the GM whisper can offer them as apply buttons — base damage
        // stays the fallback when the crit pick is spent elsewhere.
        if (entry.crit && act.type === 'attack' && critLayoutData) {
          const variants = {};
          const maxSteps = damageVariantDieStep(critLayoutData.damageMods, 'maximize');
          const maxFormula = this.buildDamageFormula(act, bonuses, { ...dmgOpts, extraSteps: dmgOpts.extraSteps + maxSteps });
          if (maxFormula) variants.maximize = (await new Roll(maxFormula, rollData).evaluate({ maximize: true })).total;
          if (critLayoutData.choices.some((c) => c.variant === 'double')) {
            const dbl = (this.buildDamageFormula(act, bonuses, dmgOpts) || '').replace(/(\d+)d(\d+)/g, (_, c, d) => `${Number(c) * 2}d${d}`);
            if (dbl) variants.double = (await new Roll(dbl, rollData).evaluate()).total;
          }
          entry.critVariants = variants;
          if (currentSub) currentSub.critVariants = variants;
        }
      }

      // A boost's own damage on the forced check (Horn Butting, Ribcrack) adds to the save's failure damage.
      if (act.type === 'save' && entry.save && boostSaveDamage.length) {
        for (const d of boostSaveDamage.splice(0)) { entry.save.damage = (entry.save.damage ?? 0) + d.total; entry.damage = (entry.damage ?? '') + d.html; }
      }
      if (act.type === 'attack' && !pendDone) {
        pendDone = true; // this action's first attack has now consumed the pending buffs
        if (pend.notes.length) entry.pendNotes = pend.notes; // receipt on the card
      }
      cardActivities.push(entry);
    }

    // If this ability makes an attack and the user has targeted tokens, attach a resolution request
    // for the GM client to compute hit/miss against the hidden defense (see the createChatMessage
    // hook). Nothing secret goes here — just the roller's own numbers + the targeted defense key.
    // A consumed boost may inflict a condition on the hit (Thrustforth's Rend) — roll it and merge into
    // the attack's own inflicts so the GM applies it on a hit alongside them. A boost applies to one
    // action, so it rides the *first* sub-attack (which is the only sub for a normal single attack).
    const firstSub = attackSubs[0];
    for (const { item: b } of boostSets) {
      if (!b.system.boost?.inflict?.length || !firstSub) continue;
      const bi = await this.#rollInflict({ inflict: b.system.boost.inflict }, rollData);
      if (bi.length) firstSub.inflict = [...(firstSub.inflict ?? []), ...bi];
    }
    // Crit riders + choices → GM resolution. Rider inflicts (Fumbling Slice) merge like a boost inflict;
    // the condition *choices* (Slamming Prone, Paralytic Paralysis) become the whisper's crit buttons.
    if (firstSub && critLayoutData) {
      if (critRiderInflict.length) {
        const ri = await this.#rollInflict({ inflict: critRiderInflict }, rollData);
        if (ri.length) firstSub.inflict = [...(firstSub.inflict ?? []), ...ri];
      }
      firstSub.critConditions = critLayoutData.choices
        .filter((c) => c.kind === 'condition' && c.condition)
        .map((c) => ({ condition: c.condition, level: Math.max(1, resolveModifierValue(c.amount, numbers)), label: c.label }));
      firstSub.critBudget = critLayoutData.budget;
    }
    Object.assign(u, { attackSubs, firstSub, ownedAbilityIds, singleAttack });
  }

  /**
   * The attack request for the GM (targets per attack, an on-hit next-attack buff, Exploding Weapon's blast), and the
   * throws I'll Come Back counts.
   */
  async #buildAttackRequest(u) {
    const { attackSubs, firstSub, fullOptions, item, numbers, singleAttack, thrown, weapon } = u;
    let attackFlag = null;
    let explodeAt = null;
    const explodes = thrown && fullOptions['self:attack:named-by:bd_exploding_weapon'] && !this.actor.getFlag('sacadia', 'restFlags')?.explodingWeapon;
    if (attackSubs.length) {
      const targetUuids = Array.from(game.user.targets ?? [])
        .map((t) => t.document?.uuid).filter(Boolean);
      if (targetUuids.length) {
        // Assign targets: a single attack hits every targeted token (unchanged); a multi-attack assigns
        // each sub a target — 'split' cycles through them in order, 'same' sends all at the first.
        if (attackSubs.length === 1) {
          // A collapsed multi-attack (Razorbite) is "a single attack against one target": the first targeted.
          attackSubs[0].targetUuids = singleAttack ? targetUuids.slice(0, 1) : targetUuids;
        } else {
          const targeting = item.system.multiAttack?.targeting || 'split';
          attackSubs.forEach((s, i) => {
            s.targetUuids = targeting === 'same' ? [targetUuids[0]] : [targetUuids[Math.min(i, targetUuids.length - 1)]];
          });
        }
        // A next-attack buff banked when this attack lands (`nextAttack.on: 'hit'` — Reaching Claw), resolved now.
        const ohp = item.system.nextAttack?.on === 'hit' ? this.#nextAttackBuff(item, numbers) : null;
        attackFlag = { attackerUuid: this.actor.uuid, defenseKey: firstSub.defenseKey,
          weaponType: firstSub.weaponType ?? '', attacks: attackSubs, ...(ohp ? { onHitPending: ohp } : {}) };
        // Exploding Weapon: "The first time per quick rest that you throw this weapon, it explodes, dealing its
        // damage to all targets in a 5ft radius from the point you select. You must then name a new weapon."
        // Thrown at a creature, the point is that (first) target; GM-side applies the thrown attack's damage to every
        // other creature within 5ft of it. The name is spent.
        if (explodes) {
          attackFlag.explode = { damage: firstSub.damage ?? 0, damageType: firstSub.damageType ?? '', centerUuid: targetUuids[0],
            label: game.i18n.localize('SACADIA.Named.Explodes') };
          await this.#spendExplodingWeapon(weapon);
        }
      } else if (explodes) {
        // …or thrown at a point (owner ruling: the text names no creature target): pick it on the map, and everyone
        // within 5ft of it takes the damage.
        const point = await AbilityUse.#pickCanvasPoint(game.i18n.localize('SACADIA.Named.Explodes'));
        if (point) {
          explodeAt = { attackerUuid: this.actor.uuid, x: point.x, y: point.y, damage: firstSub.damage ?? 0,
            damageType: firstSub.damageType ?? '', label: game.i18n.localize('SACADIA.Named.Explodes') };
          await this.#spendExplodingWeapon(weapon);
        }
      }
    }
    // I'll Come Back counts Versatile throws this turn (checked at turn end).
    if (thrown && attackSubs.length) {
      const tf = this.actor.getFlag('sacadia', 'turnFlags') ?? {};
      await this.actor.setFlag('sacadia', 'turnFlags.versatileThrows', (tf.versatileThrows ?? 0) + attackSubs.length);
    }
    Object.assign(u, { attackFlag, explodeAt });
  }

  /**
   * Marks, a grant's resource spend, and the grant for the GM to place: the ability's own, a choice redirected to an ally,
   * or one a Boost places on the targets.
   */
  async #buildGrantRequest(u) {
    const { activities, boostSets, fullOptions, item, numbers, plan, redirectGrant, usedChoice } = u;
    // Layer B: if this ability marks a target, record the current target token(s) under the mark key
    // on *our own* actor. Exclusive (default) overwrites the prior set — the "moving mark"; otherwise
    // union with what's there. Written to our own actor, so no GM routing is needed.
    await this.#applyMark(item);

    // Variable resource spend feeding a grant's magnitude (e.g. Blessing of Hot Coal — spend Madness
    // to add die-steps): chosen in #planUse, deducted now; the amount flows into the grant as `@spent`
    // (undefined when the ability has no spend block).
    const spent = plan.grantSpend;
    if (spent > 0) await this.#payGrantResource(item, spent);

    // Ally grant (see docs — "granted effects"): build a request the GM client applies (anchor on us +
    // effects on the targets). Values are resolved against our numbers now, so the buff is a fixed
    // number on the ally that scaled off the caster at cast time.
    // A choice-redirect grant (Shared Blessing) takes the grant slot when present (the ability's own
    // #buildGrant is null for a redirect-only ability like Blessing of the Iron Wall).
    // A save-gated grant (Bane, Catnap, Crown of Insanity) lands only on those who fail — it rides the save button
    // (#saveExt) instead of the card.
    const saveGated = activities.some((a) => a.type === 'save' && a.save?.ext?.grantOnFail
      && (!a.predicate?.length || evaluatePredicate(a.predicate, fullOptions)));
    // A boost's extra grant changes resolve against that boost's own numbers (Dancer's Gale: +5ft per extra AP spent).
    const grantExtras = boostSets.flatMap((x) => (x.item.system.boost?.special?.grantExtra ?? [])
      .map((c) => ({ ...c, value: String(resolveModifierValue(c.value, x.numbers ?? numbers)) })));
    let grantFlag = redirectGrant ?? (saveGated ? null : this.#buildGrant(item, spent == null ? numbers : { ...numbers, spent }, usedChoice, grantExtras));
    // A boost that places its own one-shot grant on the targets (Blood Doping: "Increase the damage dice of their first
    // attack on their next turn by two dice types").
    for (const { item: b, numbers: bn } of boostSets) {
      const tg = b.system.boost?.special?.targetGrant;
      const tUuids = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
      if (!tg || grantFlag || !tUuids.length) continue;
      grantFlag = { casterUuid: this.actor.uuid, ability: b.flags?.sacadia?.catalogId ?? b.id, label: tg.label || b.name, targets: tUuids,
        changes: (tg.changes ?? []).map((c) => ({ key: c.key, mode: c.mode ?? 2, value: String(resolveModifierValue(c.value, bn ?? numbers)) })),
        duration: { type: 'consumed', on: tg.on || 'attack' } };
    }
    Object.assign(u, { grantFlag });
  }

  /**
   * Temp HP the ability gives (rolled now; applied to you here, to allies by the GM), and a next-attack buff banked on use.
   */
  async #bankTempHpAndNextAttack(u) {
    const { item, numbers, ownedAbilityIds, renewing, rollData, rolls } = u;
    // Temp-HP grant (book p.223): roll the die once (Lifeguard + the ability's level scaling step it),
    // then grant that many Temp HP — to us (`self`), the targeted allies (`allies`), or both. Non-stacking,
    // so each recipient takes the higher of new-vs-current. Self applies here; allies route through the GM.
    let tempHpFlag = null;
    const preNotes = []; // card notes from steps that run before the on-use block (Life Transference's HP cost)
    const th = item.system.tempHp;
    let thFormula = th?.formula ?? '';
    // Armor of Itthoa's temp HP comes with initiating it, not each renewal; Heroism's needs Greater Heroism.
    if ((th?.initiateOnly && renewing) || (th?.requires && !ownedAbilityIds.includes(th.requires))) thFormula = '';
    if (thFormula && th.spendMadness) {
      const cur = this.actor.system.conditions?.madness?.value ?? 0;
      const n = cur > 0 ? await AbilityUse.#promptResourceSpend(game.i18n.localize('SACADIA.Condition.Madness'), cur, cur) : 0;
      const spentM = Math.min(Math.max(0, n ?? 0), cur);
      if (spentM > 0) await this.actor.update({ 'system.conditions.madness.value': cur - spentM });
      thFormula = spentM > 0 ? thFormula.replace(/\(@spent\)|@spent/g, String(spentM)) : '';
    }
    if (thFormula) {
      let steps = (th.scaleLevels ?? []).filter((l) => (this.actor.system.level ?? 1) >= l).length;
      if (ownedAbilityIds.includes('lifeguard')) steps += 1;
      // Greater Transference: Life Transference's XD6 → XD8.
      if (th.stepWith && ownedAbilityIds.includes(th.stepWith)) steps += 1;
      // Hallowed Touch (Witch): "add one die to the amount rolled" (and with Mastery of Nonviolence, one type up) —
      // a one-shot grant this roll spends.
      const extraDice = this.actor.system.bonuses?.tempHpDice ?? 0;
      steps += this.actor.system.bonuses?.tempHpSteps ?? 0;
      if (extraDice) {
        const fm = /^(.+)d(\d+)$/.exec(String(thFormula).trim());
        if (fm) thFormula = `(${fm[1]} + ${extraDice})d${fm[2]}`;
      }
      if (extraDice || this.actor.system.bonuses?.tempHpSteps) await this.#consumeGrantsWith('tempHp', 'tempHp');
      const roll = await new Roll(AbilityUse.#stepDiceFormula(thFormula, steps), rollData).evaluate();
      rolls.push(roll);
      let amount = Math.max(0, Math.floor(roll.total));
      // Life Transference: "Lose that HP. Give your ally Temp HP equal to twice the HP you lost."
      if (th.selfCost && amount > 0) {
        await applySelfDamage(this.actor, amount);
        preNotes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: amount }));
      }
      if (th.multiplier) amount = Math.floor(amount * th.multiplier);
      if (amount > 0 && (th.target === 'self' || th.target === 'both')) {
        await this.actor.update({ 'system.health.temp': Math.max(this.actor.system.health?.temp ?? 0, amount) });
      }
      if (amount > 0 && (th.target === 'allies' || th.target === 'both')) {
        const uuids = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
        if (uuids.length) tempHpFlag = { amount, targetUuids: uuids };
      }
    }

    // Activation-time pending-attack buff (Astonishing Shout): bank a one-shot to-hit/damage bonus onto
    // the actor's next attack this turn. Resolved against the caster's numbers now (positional scalers
    // included), then pushed to `system.pendingAttack` — drained/folded by the next attack activity. Any
    // buff this ability itself might have drained above is already consumed (this is a fresh bank).
    const pb = item.system.nextAttack?.on === 'use' ? this.#nextAttackBuff(item, numbers) : null;
    if (pb) {
      await this.actor.update({ 'system.pendingAttack': [...(this.actor.system.pendingAttack ?? []), pb] });
      ui.notifications.info(game.i18n.format('SACADIA.Reaction.Banked', { label: pb.label }));
    }
    Object.assign(u, { preNotes, tempHpFlag, th });
  }

  /**
   * Effects with no roll: self-damage and gains, pool refunds, condition changes on you and on the targets (sent to the
   * GM), Tricky Boy, a Boost's effects on the targets, and saves a Boost forces.
   */
  async #applyOnUseEffects(u) {
    const { attackSubs, boostSets, cardActivities, extraAp, fullOptions, item, numbers, preNotes, rollData, rolls, trickyBoy, usedChoice } = u;
    // On-use inflicts (no-roll reactions: Predator and Prey, That Sluggish Feeling): apply `self`
    // conditions to the actor directly (owner-side, additive up to the cap), and hand `target` conditions
    // to the GM via a card flag — auto-applied (no save) to the currently-targeted token(s).
    let onUseFlag = null;
    const onUseNotes = [...preNotes];
    // "You may only end Focus on X on your turn" (Law of Alliance, Pact of the Earth, Law of Exchange, Baneful Trade).
    if (item.system.focus?.endOnOwnTurn) onUseNotes.push(game.i18n.localize('SACADIA.Prestige.EndOnOwnTurn'));
    const onUse = item.system.onUse;
    // Incredulous Will: "If you successfully hit, roll twice on the Insane table and apply one effect to that
    // creature." Both results ride the card; the GM applies the chosen one on a hit.
    if (item.flags?.sacadia?.catalogId === 'incredulous_will') {
      const r = await new Roll('2d8').evaluate();
      rolls.push(r);
      const [a, b] = r.dice[0].results.map((x) => x.result);
      onUseNotes.push(game.i18n.format('SACADIA.Madness.Incredulous', {
        a: `${a} — ${game.i18n.localize(`SACADIA.Insane.Effect${a}`)}`, b: `${b} — ${game.i18n.localize(`SACADIA.Insane.Effect${b}`)}` }));
    }
    // Clotsnipe: "When you make this attack, lose 1D4 HP per AP expended."
    if (item.system.extraAp?.selfDamagePerAp) {
      const apTotal = (item.system.costs?.ap ?? 1) + extraAp;
      const m = /^1?d(\d+)$/.exec(item.system.extraAp.selfDamagePerAp.trim());
      const r = await new Roll(m ? `${apTotal}d${m[1]}` : `${apTotal} * (${item.system.extraAp.selfDamagePerAp})`).evaluate();
      rolls.push(r);
      await applySelfDamage(this.actor, Math.max(0, r.total));
      onUseNotes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: r.total }));
    }
    if (onUse?.selfDamage) {
      const raw = Math.max(0, Math.round(resolveModifierValue(onUse.selfDamage, numbers)));
      const resist = this.#selfDamageResist();
      const dmg = Math.max(0, raw - resist);
      if (dmg > 0) await applySelfDamage(this.actor, dmg);
      onUseNotes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: dmg }) + (resist ? ` (−${resist})` : ''));
    }
    // Gains for the user (Lore): Still Up's ⅓ Max HP, Royal Recovery's half AP, Cursed Contract's Lore point.
    const sg = onUse?.selfGain;
    if (sg && (sg.hp || sg.ap || sg.lore || sg.reactions)) {
      const sys = this.actor.system;
      const amt = (f) => (f ? Math.round(resolveModifierValue(f, numbers)) : 0);
      const upd = {};
      const [hp, ap, lore, reactions] = [amt(sg.hp), amt(sg.ap), amt(sg.lore), amt(sg.reactions)];
      if (hp) upd['system.health.value'] = Math.min(sys.health?.max ?? Infinity, (sys.health?.value ?? 0) + hp);
      if (ap) upd['system.ap.value'] = Math.max(0, Math.min(sys.ap?.max ?? Infinity, (sys.ap?.value ?? 0) + ap));
      if (lore) upd['system.lorePoints.value'] = Math.max(0, (sys.lorePoints?.value ?? 0) + lore);
      if (reactions) upd['system.reaction.value'] = Math.max(0, (sys.reaction?.value ?? 0) + reactions);
      if (Object.keys(upd).length) await this.actor.update(upd);
      for (const [n, k] of [[hp, 'Hp'], [ap, 'Ap'], [lore, 'Lore'], [reactions, 'Reactions']]) if (n) onUseNotes.push(game.i18n.format(`SACADIA.Lore.Gain${k}`, { n }));
    }
    // Pool refunds (Reverse Catnap, Call to Recovery): for each recipient, pick which pool regains the points.
    if (onUse?.poolRefund) {
      const n = Math.max(0, Math.round(resolveModifierValue(onUse.poolRefund, numbers)));
      const recipients = [...Array.from(game.user.targets ?? []).map((t) => t.actor).filter(Boolean), ...(onUse.refundSelf ? [this.actor] : [])];
      for (const a of new Set(recipients)) {
        const pool = n ? await AbilityUse.#pickPool(a, n) : null;
        if (!pool) continue;
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Pool.Refunded', { name: a.name, n, pool: game.i18n.localize(CONFIG.SACADIA.pools[pool] ?? pool) })}</div>`,
          flags: { sacadia: { gainOn: { uuid: a.uuid, n, pool } } } });
      }
    }
    const prestigeOnUse = onUse && (onUse.burst?.triggers || onUse.reactions || onUse.convertTemp || onUse.sourcePatch?.condition || onUse.setFlag || onUse.convert?.amount
      || onUse.apGain || onUse.apNext || onUse.revealWithin || onUse.exhaustRandomCombat);
    if (onUse && (onUse.self?.length || onUse.target?.length || onUse.exhaust || onUse.holdDecay?.length || onUse.cover || onUse.enduring || prestigeOnUse)) {
      // Amounts may be negative (remove levels: Standards Elite, Call to Overcome) and may name a group
      // wildcard (`*adversarial` / `*mental` / `*physical`) — see helpers/conditions.mjs. `@choice` is the
      // per-use pick; an entry's `predicate` is read against the caster's options + that pick.
      const cid = item.flags?.sacadia?.catalogId ?? item.id;
      const casterOpts = { ...(this.actor.system._rollOptions?.() ?? {}), ...(usedChoice ? { [`self:choice:${cid}:${usedChoice}`]: true } : {}) };
      const pick = (v) => (v === '@choice' ? usedChoice : v);
      const live = (e) => evaluatePredicate(e.predicate, casterOpts);
      // A dice amount ("1D4 Fumble … roll for each target separately") stays a formula for the GM to roll
      // per target; anything else resolves now.
      const amtOf = (e) => (/\d*d\d/i.test(String(e.amount)) && !String(e.amount).includes('@') ? String(e.amount) : Math.round(resolveModifierValue(e.amount, numbers)));
      const giver = this.#giver(casterOpts);
      const entries = (list) => (list ?? []).filter(live)
        .map((e) => ({ condition: pick(e.condition), amount: amtOf(e), stacks: e.stacks, source: conditionSource(giver, pick(e.condition), cid) }))
        .filter((e) => e.amount && e.condition);
      // Conditions you give yourself stack onto the levels you have (designer's ruling).
      const selfEntries = entries(onUse.self).map((e) => ({ ...e, self: true }));
      if (selfEntries.length) {
        for (const e of selfEntries) if (typeof e.amount === 'string') e.amount = (await new Roll(e.amount).evaluate()).total;
        for (const n of await applyConditionDeltas(this.actor, selfEntries)) onUseNotes.push(`${game.i18n.localize('SACADIA.OnUse.Self')}: ${n}`);
      }
      const tUuids = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
      const tInflicts = entries(onUse.target);
      const exhaust = pick(onUse.exhaust ?? '');
      const holdDecay = (onUse.holdDecay ?? []).map(pick).filter(Boolean);
      const cover = onUse.cover ?? '';
      // Balanced Scale: the chosen condition on the target "gains the Enduring Condition".
      const enduring = pick(onUse.enduring ?? '');
      // Prestige on-use effects on the targets (see item-ability `onUse`): a Hemorrhage burst, granted reactions, temp
      // HP made real, a condition variant, a one-shot flag, and a condition conversion (Nettle).
      const extras = {};
      if (onUse.burst?.triggers) {
        extras.burst = { triggers: Math.max(1, Math.round(resolveModifierValue(onUse.burst.triggers, numbers))), drain: onUse.burst.drain ?? 0, label: item.name };
        onUseNotes.push(game.i18n.format('SACADIA.Prestige.BurstNote', { n: extras.burst.triggers }));
      }
      if (onUse.reactions) {
        extras.reactions = Math.max(0, Math.round(resolveModifierValue(onUse.reactions, numbers)));
        if (extras.reactions) onUseNotes.push(game.i18n.format('SACADIA.Prestige.ReactionsNote', { n: extras.reactions }));
      }
      if (onUse.convertTemp) { extras.convertTemp = true; onUseNotes.push(game.i18n.localize('SACADIA.Prestige.ConvertTempNote')); }
      if (onUse.sourcePatch?.condition) extras.sourcePatch = { condition: pick(onUse.sourcePatch.condition), patch: onUse.sourcePatch.patch ?? {} };
      if (onUse.setFlag) extras.setFlag = onUse.setFlag;
      const num = (f) => Math.max(0, Math.round(resolveModifierValue(f, numbers)));
      if (onUse.apGain) extras.apGain = num(onUse.apGain);
      if (onUse.apNext) extras.apNext = num(onUse.apNext);
      if (onUse.exhaustRandomCombat) extras.exhaustRandomCombat = true;
      // Open the Third Eye: hidden creatures within reach are revealed (GM-side, from your token).
      if (onUse.revealWithin) {
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          content: `<div class="sacadia chat-card note-card">${game.i18n.localize('SACADIA.Prestige.ThirdEye')}</div>`,
          flags: { sacadia: { reveal: { casterUuid: this.actor.uuid, within: num(onUse.revealWithin) } } } });
      }
      if (onUse.convert?.amount && tUuids.length) {
        const conv = await this.#promptConvert(item, onUse.convert, numbers);
        if (conv) {
          tInflicts.push({ condition: conv.from, amount: -conv.n }, { condition: conv.to, amount: conv.n });
        }
      }
      if (tUuids.length && (tInflicts.length || exhaust || holdDecay.length || cover || enduring || Object.keys(extras).length)) {
        onUseFlag = { targetUuids: tUuids, inflicts: tInflicts, exhaust, holdDecay, cover, enduring, casterUuid: this.actor.uuid, ...extras };
        if (enduring) onUseNotes.push(game.i18n.format('SACADIA.OnUse.Enduring', { condition: game.i18n.localize(CONFIG.SACADIA.conditions[enduring]?.label ?? enduring) }));
        const condLabel = (k) => game.i18n.localize(CONFIG.SACADIA.conditions[k]?.label ?? CONFIG.SACADIA.simpleConditions[k]?.label ?? k.replace(/^\*/, ''));
        const T = game.i18n.localize('SACADIA.OnUse.Target');
        for (const e of tInflicts) onUseNotes.push(`${T}: ${condLabel(e.condition)} ${typeof e.amount === 'string' || e.amount > 0 ? '+' : ''}${e.amount}`);
        if (exhaust) onUseNotes.push(`${T}: ${game.i18n.format('SACADIA.OnUse.Exhaust', { limb: game.i18n.localize(CONFIG.SACADIA.limbs[exhaust] ?? exhaust) })}`);
        for (const c of holdDecay) onUseNotes.push(`${T}: ${game.i18n.format('SACADIA.OnUse.HoldDecay', { condition: condLabel(c) })}`);
        if (cover) onUseNotes.push(`${T}: ${game.i18n.localize(CONFIG.SACADIA.coverStates[cover]?.label ?? cover)}`);
      }
    }

    // Tricky Boy: the first attack with the named weapon against each enemy this combat gives Surprised.
    if (trickyBoy && attackSubs.length) {
      const seen = this.actor.getFlag('sacadia', 'uses')?.combat?.trickyBoy ?? [];
      const fresh = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter((u) => u && !seen.includes(u));
      if (fresh.length) {
        onUseFlag ??= { targetUuids: [], inflicts: [] };
        onUseFlag.targetUuids = Array.from(new Set([...onUseFlag.targetUuids, ...fresh]));
        onUseFlag.inflicts.push({ condition: 'surprised', amount: 1 });
        onUseNotes.push(game.i18n.localize('SACADIA.Named.TrickyBoy'));
        await this.actor.setFlag('sacadia', 'uses.combat.trickyBoy', [...seen, ...fresh]);
      }
    }
    // Boost effects on the targets themselves (Tangled Harm: "reduce the target's Pin by one") — GM-routed.
    for (const { item: b } of boostSets) {
      const td = b.system.boost?.special?.targetDelta;
      if (!td) continue;
      const tUuids = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
      if (!tUuids.length) continue;
      onUseFlag ??= { targetUuids: tUuids, inflicts: [] };
      for (const [condition, amount] of Object.entries(td)) {
        onUseFlag.inflicts.push({ condition, amount });
        onUseNotes.push(`${b.name}: ${game.i18n.localize(CONFIG.SACADIA.conditions[condition]?.label ?? condition)} ${amount > 0 ? '+' : ''}${amount}`);
      }
    }
    // A boost that forces its own save on the target (Unpredictability: "force that creature to make a Wiles
    // Check against your Check DC. If they fail, they remain Surprised").
    for (const { item: b } of boostSets) {
      const xs = b.system.boost?.special?.extraSave;
      if (!xs?.trait) continue;
      const cd = this.actor.system.checkDc;
      const dc = (typeof cd === 'number' ? cd : cd?.primary) ?? 10;
      const inf = await this.#rollInflict({ inflict: xs.inflict ?? [] }, rollData, fullOptions);
      cardActivities.push({ type: 'save', label: b.name, save: {
        dc, traitKey: xs.trait, traitLabel: game.i18n.localize(CONFIG.SACADIA.stats[xs.trait]),
        inflictData: inf.length ? JSON.stringify(inf) : '', adv: 0, advLabel: '', onSuccess: 'none',
        casterPc: this.actor.type === 'character' ? 1 : 0, caster: this.actor.uuid, ability: b.flags?.sacadia?.catalogId ?? '', damage: 0 } });
    }
    Object.assign(u, { onUseFlag, onUseNotes });
  }

  /**
   * Build and post the chat card: the modifier receipts, and the requests it carries to the GM (attack, grant, temp HP,
   * on-use effects, zone, cloud layers).
   */
  async #postUseCard(u) {
    const { activities, attackFlag, boostNotes, boostSets, cardActivities, catalogId, explodeAt, fullOptions, grantFlag, item, numbers, onUseFlag, onUseNotes, rollData, rolls, targetNotes, tempHpFlag, th } = u;
    // Tier-1 disclosure: itemize the conditional modifiers that qualified and affect this card's
    // rolls (global or scoped to this ability), split into to-hit vs damage receipts.
    const isToHit = (t) => t === 'toHit' || t === 'advantage.toHit' || t === 'advantage.trait';
    const isDamage = (t) => ['damage', 'damageDice', 'dieStep'].includes(t);
    const fmt = (m) => {
      if (m.mode === 'dice') return `+${AbilityUse.resolveDiceLabel(m.value, numbers)} · ${m.label}`;
      if (m.text) return `${m.text} · ${m.label}`;
      if (m.target === 'advantage.toHit' || m.target === 'advantage.trait') {
        const kind = game.i18n.localize(m.value >= 0 ? 'SACADIA.Roll.AdvShort' : 'SACADIA.Roll.DisadvShort');
        return `${Math.abs(m.value)}× ${kind} · ${m.label}`;
      }
      const sign = m.value >= 0 ? '+' : '';
      const step = m.mode === 'step' ? ` ${game.i18n.localize('SACADIA.Roll.Step')}` : '';
      return `${sign}${m.value}${step} · ${m.label}`;
    };
    const applicable = (this.actor.system.activeModifiers ?? [])
      .filter((m) => ['all', 'melee', 'ranged', 'magic'].includes(m.scope) || m.scope === catalogId);
    // Merge the derived (actor-state) modifiers with the target-contextual ones, deduped (a modifier
    // may qualify on several activities of this ability).
    const seen = new Set();
    const dedupedTarget = targetNotes.filter((n) => {
      const k = `${n.label}|${n.target}|${n.value}`;
      return seen.has(k) ? false : seen.add(k);
    });
    // Ally-grant receipts: buffs an ally placed on *us* (Blessing of Iron/Hot Coal, …) feed raw
    // `bonuses.*` sinks, so they're invisible to the conditional-modifier listing above even though
    // they move this card's dice/bonuses. Surface the attack-relevant ones as labeled lines — but
    // only when this card actually attacks/deals damage, so a defense grant (Dreams/Shield) that
    // doesn't touch an attack never shows spuriously.
    const hasAttack = activities.some((a) => a.type === 'attack');
    const hasDamageOut = activities.some((a) => a.type === 'attack' || a.type === 'damage');
    const grantReceipts = [];
    for (const eff of this.actor.effects) {
      if (!eff.flags?.sacadia?.grantedBy || eff.disabled) continue;
      for (const c of eff.changes ?? []) {
        const value = Number(c.value);
        if (!Number.isFinite(value) || !value) continue;
        if (hasDamageOut && c.key === 'system.bonuses.dieStep') grantReceipts.push({ target: 'dieStep', mode: 'step', value, label: eff.name });
        else if (hasDamageOut && c.key.startsWith('system.bonuses.damage')) grantReceipts.push({ target: 'damage', mode: 'add', value, label: eff.name });
        else if (hasAttack && c.key.startsWith('system.bonuses.toHit')) grantReceipts.push({ target: 'toHit', mode: 'add', value, label: eff.name });
      }
    }
    // Consumed-boost receipts (already the {label, target, mode, value} shape) render as labeled lines
    // via the same fmt — so a boost shows as e.g. "1× Disadv · Targeted Strike" / "+2 Step · …".
    const allMods = [...applicable, ...dedupedTarget, ...grantReceipts, ...boostNotes];
    const toHitMods = allMods.filter((m) => isToHit(m.target)).map(fmt);
    const damageMods = allMods.filter((m) => isDamage(m.target)).map(fmt);

    const content = await foundry.applications.handlebars.renderTemplate(
      'systems/sacadia/templates/chat/ability-card.hbs',
      {
        item,
        attackerUuid: this.actor.uuid, // threads the roller into the crit self-effect buttons
        tempHpGrant: th?.formula ? game.i18n.localize(`SACADIA.Card.TempHpTo.${th.target}`) : null, // labels the temp-HP roll on the card
        onUseNotes, // no-roll on-use inflict receipts (Predator and Prey, That Sluggish Feeling)
        tagLabel: game.i18n.localize(CONFIG.SACADIA.abilityTags[item.system.tag]),
        cspCost: item.system.costs?.csp,
        limbs: (item.system.costs?.limbs ?? []).map((l) => game.i18n.localize(CONFIG.SACADIA.limbs[l])),
        activities: cardActivities,
        rangeLabel: AbilityUse.#rangeLabel(item.system.range),
        toHitMods,
        damageMods,
        description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          item.system.description ?? '', { relativeTo: item, rollData }
        ),
      }
    );
    // A placed zone this ability creates (Stygian Abyss, Suppressing Fire …): resolved now, created GM-side.
    const zoneFlag = item.system.zone?.shape ? await this.#buildZone(item, numbers, fullOptions, boostSets) : null;
    // A Swarm cloud layer Focus (Dark Cloud, Sharp Cloud …): the GM re-applies the cloud's layered statuses/terrain.
    const cloudRefresh = AbilityUse.#CLOUD_LAYERS.has(catalogId) ? this.actor.uuid : '';
    await AbilityUse.postCard({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      rolls,
      flags: (attackFlag || explodeAt || grantFlag || tempHpFlag || onUseFlag || zoneFlag || cloudRefresh)
        ? { sacadia: {
          ...(attackFlag ? { attack: attackFlag } : {}),
          ...(explodeAt ? { explodeAt } : {}),
          ...(grantFlag ? { grant: grantFlag } : {}),
          ...(tempHpFlag ? { tempHp: tempHpFlag } : {}),
          ...(onUseFlag ? { onUse: onUseFlag } : {}),
          ...(zoneFlag ? { zone: zoneFlag } : {}),
          ...(cloudRefresh ? { cloudRefresh } : {}),
        } }
        : {},
    });
  }

  /**
   * After the card: the Madness change (unless Sinewy Sanity applied it first), and acting reveals a Hidden creature.
   */
  async #afterUse(u) {
    const { boostSets, item, madInitiating, sinewyEarly } = u;
    // Madness change happens at the end of the action (book p120); crossing 6/0 latches Insanity via the
    // updateActor hook. Focus maintenance doesn't re-roll it (initiate-only). Skipped when Sinewy Sanity
    // already applied it *before* the effect (above).
    if (!sinewyEarly) await this.#applyMadnessChange(item, madInitiating, boostSets);

    // A Hidden creature is revealed once it attacks or forces a Trait Check on another creature (Hide Behind
    // Hide: "Focus … immediately ends as soon as you make an attack, impose a trait check against a
    // creature …"). After the rolls, so What's That? still sees the Focus on this attack.
    const exposes = (item.system.activities ?? []).some((a) => a.type === 'attack' || a.type === 'save')
      || (item.system.onUse?.target?.length ?? 0) > 0;
    if (exposes && this.actor.statuses?.has('hidden') && item.flags?.sacadia?.catalogId !== 'hide_behind_hide') await revealHidden(this.actor);
  }

  /**
   * Enforce an ability's Madness use-gates (book p120). Warn-but-allow (a confirm, matching the AP/pool
   * overspend posture) so a GM can override, but abort on cancel. Returns true to proceed.
   */
  async #checkMadnessPrereq(item) {
    const md = item.system.madness;
    if (!md || this.actor.type !== 'character') return true;
    const madness = this.actor.system.conditions?.madness?.value ?? 0;
    const insane = this.actor.statuses?.has('insane');
    const problems = [];
    if (md.insaneOnly && !insane) problems.push(game.i18n.localize('SACADIA.Madness.NeedInsane'));
    if (md.prereq != null && madness < md.prereq) {
      problems.push(game.i18n.format('SACADIA.Madness.NeedMadness', { n: md.prereq, current: madness }));
    }
    // While insane you may only use P:I abilities among those that touch Madness (prereq/gain/spend).
    if (insane && !md.insaneOnly && (md.prereq != null || md.gain || md.spend)) {
      problems.push(game.i18n.localize('SACADIA.Madness.LockedWhileInsane'));
    }
    if (!problems.length) return true;
    return sacDialog.confirm({
      window: { title: game.i18n.localize('SACADIA.Madness.PrereqTitle') },
      content: `<p>${game.i18n.format('SACADIA.Madness.PrereqIntro', { name: item.name })}</p><ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>`,
      rejectClose: false,
    });
  }

  /**
   * Apply an ability's `M+X` gain / `M-X` spend at end of action, clamped 0–6 (which latches Insanity via
   * the updateActor hook). Amount formulas: `M` = all current Madness; `N` = a player-chosen amount
   * (prompted); otherwise a dice/number roll. Posts the roll so the change is auditable. Skipped for
   * focus maintenance (initiate-only) and NPCs.
   */
  async #applyMadnessChange(item, initiating, boostSets = []) {
    const md = item.system.madness;
    if (!md || this.actor.type !== 'character' || !initiating) return;
    const cur = this.actor.system.conditions?.madness?.value ?? 0;
    // Madness Boosts riding this action: Cracked Laughter / Quiet Smirk take the max / min of the gain
    // roll; Blood for Blood adds 1 more then deals M damage; Blood for God deals M damage before a
    // reduction and adds 1D3−1 after; Bleeding Eyes (insane) pays Proficiency HP instead of reducing.
    const sp = Object.assign({}, ...boostSets.map((x) => x.item.system.boost?.special ?? {}));
    const notes = [];
    let selfDamage = 0;
    let delta = 0;
    const rolls = [];
    // Slightly Cracked Boost: a saved d3 stands in for one 1D3−1 Madness roll (gain or loss) — so 1D3−1 → d3−1.
    const crackedFor = async (formula) => {
      if (!sp.useCracked || !/^1d3\s*-\s*1$/i.test(String(formula))) return null;
      const idx = await AbilityUse.#pickCracked(this.actor, item.name);
      if (idx == null) return null;
      const saved = [...(this.actor.system.professionResources?.oracle?.cracked ?? [])];
      const [v] = saved.splice(idx, 1);
      await this.actor.update({ 'system.professionResources.oracle.cracked': saved });
      sp.useCracked = false; // one roll per Boost
      notes.push(game.i18n.format('SACADIA.Cracked.Used', { n: v }));
      return { amount: Math.max(0, v - 1), roll: null };
    };
    if (md.gain && md.gain !== 'N') { // gain 'N' is trigger-driven (Shared Mind), not on cast
      let r = await crackedFor(md.gain);
      if (!r && sp.madnessRoll && !['M', 'N'].includes(md.gain)) {
        const roll = await new Roll(String(md.gain)).evaluate(sp.madnessRoll === 'max' ? { maximize: true } : { minimize: true });
        r = { amount: Math.max(0, roll.total), roll };
      }
      r ??= await this.#rollMadnessAmount(md.gain, cur);
      delta += r.amount; if (r.roll) rolls.push(r.roll);
      if (sp.madnessExtra) { delta += sp.madnessExtra; notes.push(`+${sp.madnessExtra}`); }
    }
    // Abilities that spend Madness via a grant's own `spend` block (Blessing of Hot Coal) already
    // deducted it there and used the amount as `@spent` — don't deduct a second time here.
    const grantHandledSpend = item.system.grant?.spend?.resource === 'madness' || !!item.system.tempHp?.spendMadness;
    if (md.spend && !grantHandledSpend) {
      if (sp.madnessSpendInstead && this.actor.statuses?.has('insane')) {
        selfDamage += this.actor.system.proficiency ?? 0; // Bleeding Eyes: HP instead of Madness
        notes.push('Bleeding Eyes');
      } else {
        if (sp.madnessBeforeSpend) selfDamage += cur; // Blood for God: "take damage equal to M before reducing"
        const r = (await crackedFor(md.spend)) ?? await this.#rollMadnessAmount(md.spend, cur);
        delta -= r.amount; if (r.roll) rolls.push(r.roll);
      }
    }
    if (sp.madnessAfterSpend && md.spend) {
      const r = await new Roll(String(sp.madnessAfterSpend)).evaluate();
      delta += r.total; rolls.push(r);
    }
    if (!delta && !selfDamage) return;
    const next = Math.max(0, Math.min(6, cur + delta));
    // Blood for Blood: "then take damage equal to M" (the raised Madness).
    if (sp.madnessExtra) selfDamage += next;
    if (selfDamage > 0) {
      const resist = this.#selfDamageResist();
      const dmg = Math.max(0, selfDamage - resist);
      await applySelfDamage(this.actor, dmg);
      notes.push(game.i18n.format('SACADIA.Boost.SelfDamage', { n: dmg }));
    }
    if (!delta) {
      if (notes.length) await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), content: `<div class="sacadia chat-card note-card">${notes.join(' · ')}</div>`, rolls });
      return;
    }
    if (next !== cur) await this.actor.update({ 'system.conditions.madness.value': next });
    const label = game.i18n.localize('SACADIA.Condition.Madness');
    const sign = delta >= 0 ? '+' : '−';
    await AbilityUse.postCard({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="sacadia chat-card note-card"><strong>${label}</strong> ${sign}${Math.abs(delta)} → ${next}${notes.length ? ` · ${notes.join(' · ')}` : ''}</div>`,
      rolls,
    });
  }

  /**
   * Resolve one Madness amount formula. `M` → all current Madness; `N` → prompt (capped at current);
   * a dice/number formula → an evaluated Roll. Returns the integer amount and any Roll made (for display).
   * @returns {Promise<{amount: number, roll: Roll|null}>}
   */
  async #rollMadnessAmount(formula, current) {
    if (formula === 'M') return { amount: current, roll: null };
    // One per targeted creature (Webcraft's M-X: one enemy per Madness spent).
    if (formula === 'T') return { amount: Math.min(game.user.targets?.size ?? 0, current), roll: null };
    if (formula === 'N') {
      const chosen = await AbilityUse.#promptResourceSpend(game.i18n.localize('SACADIA.Condition.Madness'), current, current);
      return { amount: chosen === null ? 0 : Math.min(Math.max(0, chosen), current), roll: null };
    }
    const roll = await new Roll(String(formula)).evaluate();
    return { amount: Math.max(0, roll.total), roll };
  }

  /**
   * Evaluate the leveled conditions an activity inflicts (amount formulas → integer levels) for the
   * GM to apply from the resolution whisper.
   * @returns {Promise<Array<{condition: string, level: number, label: string}>>}
   */
  async #rollInflict(activity, rollData, options = {}) {
    const out = [];
    for (let inf of activity.inflict ?? []) {
      if (!inf.condition) continue;
      // Optional predicate (inflict-amount upgrades, supersede pairs): skip entries that don't hold for
      // the caster's current roll options — so a base amount and its owned-upgrade amount never both fire.
      const atoms = predicateAtoms(inf.predicate);
      if (atoms.length && !evaluatePredicate(atoms, options)) continue;
      // A once-per-rest inflict part (Jagged Blade's extra Hemorrhage): skipped once its rest flag is set; set
      // the first time it fires.
      if (inf.restFlag) {
        if (this.actor.getFlag('sacadia', 'restFlags')?.[inf.restFlag]) continue;
        await this.actor.setFlag('sacadia', `restFlags.${inf.restFlag}`, true);
      }
      let amountF = String(inf.amount || '1');
      // A per-use choice may name the condition (Beastly Presence: Panic or Taunt).
      if (inf.condition === '@choice') inf = { ...inf, condition: options.usedChoice ?? '' };
      if (!inf.condition) continue;
      // Fumble Mastery (Fatebound Legendary): "Whenever you give Fumble, increase the dice type of Fumble
      // given by two dice types."
      if (inf.condition === 'fumbled' && options['self:ability:legendary_fumble']) {
        amountF = amountF.replace(/(\d*)d(\d+)/g, (_, c, d) => { const st = stepDie(c || '1', Number(d), 2, CONFIG.SACADIA.diceLadder); return `${st.count}d${st.denomination}`; });
      }
      const roll = await new Roll(amountF, rollData).evaluate();
      let level = Math.max(0, Math.floor(roll.total));
      // Visaged Breastplate (adornment): "Whenever you give Taunt or Panic, give one more."
      if (['taunt', 'panic'].includes(inf.condition) && options['self:gear:visaged-breastplate']) level += 1;
      // Poison Touch: attempting exactly Proficiency levels of the picked condition → one more.
      if (options[`self:pick:poisontouch:${inf.condition}`] && level === Number(rollData.proficiency ?? -1)) level += 1;
      // Wellspring (Witch reaction): an attempt of at least Proficiency levels (½ with Greater Wellspring) gets one more.
      const plus = this.actor.system.bonuses?.inflictPlus ?? 0;
      const prof = Number(rollData.proficiency ?? 0);
      const plusAt = (this.actor.system.bonuses?.inflictPlusAt ?? 0) || ((this.actor.system.bonuses?.inflictPlusHalf ?? 0) > 0 ? Math.ceil(prof / 2) : prof);
      if (plus > 0 && level >= plusAt && CONFIG.SACADIA.conditions[inf.condition]) {
        level += plus;
        await this.#consumeGrantsWith('inflict', 'inflictPlus');
      }
      const cfg = CONFIG.SACADIA.conditions[inf.condition] ?? CONFIG.SACADIA.simpleConditions[inf.condition];
      if (level > 0) out.push({ condition: inf.condition, level, label: game.i18n.localize(cfg?.label ?? inf.condition),
        ...(inf.saveNegate ? { saveNegate: inf.saveNegate } : {}),
        // Rend's first armor type: Rend Armor's per-use choice, else Clever Rend's standing pick.
        ...(inf.condition === 'rended' ? { prefer: (['pd', 'md', 'td'].includes(options.usedChoice) ? options.usedChoice : '') || rendPreference(this.actor) } : {}),
        // Toxic Touch (Lore): "all Hemorrhage you give stacks" while it lasts.
        ...((inf.stacks || (this.actor.system.bonuses?.stacksGiven?.[inf.condition] ?? 0) > 0) ? { stacks: true } : {}),
        // Who is giving it and what their upgrades add — stored on the target if this is its first application.
        source: conditionSource(this.#giver(options), inf.condition, options.sourceAbility ?? '') });
    }
    return out;
  }

  /**
   * Resolve which of the character's weapons an attack ability uses. Returns the weapon Item, or null
   * for non-attack abilities / characters with no weapons. Binding is `flags.sacadia.weapon` (set via
   * the ability sheet's Weapon dropdown); when unset it auto-resolves to the first *equipped* weapon,
   * else the first owned — the "defaults to the first found" behaviour.
   */
  resolveWeapon(item) {
    if (!item.system.activities?.some((a) => a.type === 'attack')) return null;
    // Prestige spells (Chill Touch, Clotsnipe, Magic Missive) are cast, not swung: no weapon is bound or drawn.
    if (item.flags?.sacadia?.prestige) return null;
    // A "weapon" is any gear or shield (armor) carrying a weaponType.
    const weapons = this.actor.items.filter((i) => ['gear', 'armor'].includes(i.type) && i.system.weaponType);
    if (!weapons.length) return null;
    const boundId = item.flags?.sacadia?.weapon;
    if (boundId) return this.actor.items.get(boundId) ?? weapons[0]; // fall back if the bound weapon is gone
    // Auto: prefer an equipped non-shield weapon (a generic attack shouldn't default to a Shield Bash),
    // then any equipped weapon, then the first owned.
    return weapons.find((w) => w.system.equipped && w.system.weaponType !== 'shield')
      ?? weapons.find((w) => w.system.equipped) ?? weapons[0];
  }

  /**
   * Assemble the damage formula string for an activity's parts (each part adds its own trait, per
   * p.218) without rolling — weapon base dice prepended for a bare "make an attack", selfScaling +
   * die-steps applied, dice-/flat-bonus tails appended. The structured `(count)d(denom)` count is
   * resolved to a concrete integer here (via `numbers`), so a formula count like `ceil(@proficiency/2)`
   * becomes `1d8`, not `(ceil(1 / 2))d8` — both the rolled and the displayed formula read cleanly.
   * Shared by {@link #rollDamage} and the sheet's roll-preview tooltip. Returns null when there's
   * nothing to roll.
   */
  buildDamageFormula(activity, bonuses, opts = {}) {
    const { extraSteps = 0, selfScaling = null, flatDamage = 0, diceBonus = [], weaponPart = null, numbers = {}, weaponReroll = 0, minWeaponDie = 0 } = opts;
    const ladder = CONFIG.SACADIA.diceLadder;
    // Global die-step sink (AE buffs) + this ability's own scoped die-step modifiers.
    const dieStep = (bonuses.dieStep ?? 0) + (bonuses.dieStepBy?.[activity.attack?.category] ?? 0) + extraSteps;
    const level = this.actor.system.level ?? 0;
    const terms = [];
    // Weapon base dice are prepended only when the ability contributes none itself (a "make an attack"
    // ability). An ability with its own dice (a spell/special strike) keeps them and ignores the weapon.
    const parts = activity.damage;
    const useWeapon = weaponPart && !parts.some((p) => p.formula?.trim() || p.denomination);
    for (const part of (useWeapon ? [weaponPart, ...parts] : parts)) {
      let dice;
      if (part.formula?.trim()) {
        dice = part.formula.trim(); // freeform override isn't die-stepped
      } else if (part.denomination) {
        // selfScaling grows the base die at level thresholds (highest reached wins) before stepping.
        let denomination = part.denomination;
        // A floor on the weapon's base die (Feralwild: "The minimum base damage dice of Wild Strike is 1D6").
        if (part === weaponPart && minWeaponDie && String(part.count ?? '1') === '1' && denomination < minWeaponDie) denomination = minWeaponDie;
        if (selfScaling?.length) {
          const reached = selfScaling.filter((s) => level >= s.level).sort((a, b) => b.level - a.level)[0];
          if (reached) denomination = ladder[reached.ladderIndex]?.die ?? denomination;
        }
        // Apply die-step buffs to the structured (count)d(denomination) at roll time.
        const s = dieStep > 0
          ? stepDie(part.count, denomination, dieStep, ladder)
          : { count: part.count, denomination };
        // Resolve a formula count (e.g. ceil(@proficiency/2)) to a concrete integer; a plain
        // number passes straight through untouched.
        const raw = String(s.count ?? '1').trim() || '1';
        const count = /^\d+$/.test(raw) ? raw : Math.max(0, resolveModifierValue(raw, numbers));
        dice = `${count}d${s.denomination}`;
        // Re-roll once a low result on the weapon's own base dice (Heavy Damage: 1; Heavier Damage: 1–2).
        if (weaponReroll > 0 && part === weaponPart) dice += weaponReroll === 1 ? 'ro1' : `ro<=${weaponReroll}`;
      } else {
        continue;
      }
      terms.push(part.trait ? `${dice} + @${part.trait}` : dice);
    }
    if (!terms.length && !diceBonus.length) return null;
    let formula = terms.join(' + ') || '0';
    // Dice-valued conditional damage bonuses (formulas, counter-scaled at roll time).
    for (const d of diceBonus) formula += ` + ${d.formula}`;
    // Flat damage bonus (all + category + this ability's scoped bonus), pre-summed by the caller.
    if (flatDamage) formula += ` + ${flatDamage}`;
    // Trend to Arcana nearby swaps dice sizes for allies and enemies.
    return trendToArcana(formula, trendSide(this.actor));
  }

  /**
   * Build and evaluate one combined damage Roll for an activity's parts, plus the global damage
   * bonus. Returns null when there's nothing to roll.
   */
  async #rollDamage(activity, rollData, bonuses, opts = {}) {
    const formula = this.buildDamageFormula(activity, bonuses, opts);
    if (formula == null) return null;
    return new Roll(formula, rollData).evaluate();
  }

  /**
   * Resolve a dice-bonus formula's variable count to a concrete `NdM` for card display — e.g.
   * `(min(@combat.consecutiveHits, @proficiency))d4` → `2d4` — so the receipt shows the actual dice,
   * not the raw formula. Resolves the count expression (parenthesized, or a bare `@ref`) via the
   * modifier-value arithmetic; leaves the die faces and anything else untouched.
   */
  static resolveDiceLabel(formula, numbers) {
    return String(formula)
      .replace(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)d(\d+)/g, (_m, expr, faces) => `${resolveModifierValue(expr, numbers)}d${faces}`)
      .replace(/(@[\w.]+)d(\d+)/g, (_m, ref, faces) => `${resolveModifierValue(ref, numbers)}d${faces}`);
  }

  /**
   * Step a single-die formula's denomination up the ladder by `steps` (temp-HP grants: Lifeguard + level
   * scaling). Splits `<count>d<faces>` and defers to {@link stepDie} — a numeric count walks the full
   * ladder (`1d10`→`2d6`), a formula count (`(ceil(@proficiency/2))d4`) steps only the die faces. Returns
   * the formula unchanged when it isn't a plain `NdM` or `steps` is 0.
   */
  static #stepDiceFormula(formula, steps) {
    if (!steps) return formula;
    const m = /^(.+)d(\d+)$/.exec(String(formula).trim());
    if (!m) return formula;
    const s = stepDie(m[1], Number(m[2]), steps, CONFIG.SACADIA.diceLadder);
    return `${s.count}d${s.denomination}`;
  }

  /**
   * A Witch's Promise, used from the sheet: mark it broken (its Witch abilities are lost until Atone) or kept again.
   * Nonviolence also breaks on its own when the Witch harms a creature not on her side (see #useAbility).
   */
  async #togglePromise(item) {
    const broken = !!this.actor.getFlag('sacadia', 'promiseBroken');
    const ok = await confirmWarn(item.name, game.i18n.localize(broken ? 'SACADIA.Prestige.PromiseRestore' : 'SACADIA.Prestige.PromiseBreak'));
    if (!ok) return;
    if (broken) await this.actor.unsetFlag('sacadia', 'promiseBroken');
    else await this.actor.setFlag('sacadia', 'promiseBroken', true);
    await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="sacadia chat-card note-card"><strong>${item.name}</strong>: ${game.i18n.localize(broken ? 'SACADIA.Prestige.PromiseKept' : 'SACADIA.Prestige.PromiseBroken')}</div>` });
  }

  /**
   * A Magus Tome's research record: "Whenever you research a new Magus ability using a Long Rest Action, record the name
   * of that ability in your tome. You can purchase any Magus ability recorded in your tome if you meet the
   * prerequisites." Lists this Tome's abilities (its own and the shared Unfurlings) with their prerequisites, recorded
   * ones checked; saving records the picks on the Tome item (`flags.sacadia.researched`), so the record travels with it.
   * Prerequisites are shown, not enforced.
   */
  async #researchTome(item) {
    const tome = { mg_blood_tome: 'blood', mg_contract_tome: 'contract', mg_elder_tome: 'elder' }[item.flags?.sacadia?.catalogId];
    const pack = game.packs.get('sacadia.abilities-magus');
    if (!pack) return;
    const index = await pack.getIndex({ fields: ['flags.sacadia', 'system.meta.prerequisite'] });
    const entries = index.filter((e) => [tome, 'any'].includes(e.flags?.sacadia?.tome)).sort((a, b) => a.name.localeCompare(b.name));
    const recorded = new Set(item.flags?.sacadia?.researched ?? []);
    const esc = foundry.utils.escapeHTML;
    // Each entry's prerequisites (talents with ranks, Traits, other abilities) marked ✓ / ✗ for this character.
    const pctx = await this.prerequisiteContext();
    const mark = (pre) => { const { unmet } = checkPrerequisites(pre, pctx); return unmet.length ? ` <span class="prereq-unmet" title="${esc(unmet.join(', '))}">✗</span>` : ' <span class="prereq-met">✓</span>'; };
    const rows = entries.map((e) => `<label class="research-row"><input type="checkbox" name="r" value="${e.flags.sacadia.catalogId}"${recorded.has(e.flags.sacadia.catalogId) ? ' checked' : ''}/>`
      + ` <b>${esc(e.name)}</b>${e.system?.meta?.prerequisite ? ` <small>(${esc(e.system.meta.prerequisite)})</small>${mark(e.system.meta.prerequisite)}` : ''}</label>`).join('');
    const picked = await sacDialog.wait({
      window: { title: game.i18n.format('SACADIA.Prestige.ResearchTitle', { name: item.name }) },
      content: `<p>${game.i18n.localize('SACADIA.Prestige.ResearchHint')}</p><div class="research-list">${rows}</div>`,
      buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.Prestige.ResearchSave'), default: true,
        callback: (event, button, dialog) => Array.from(dialog.element.querySelectorAll('[name="r"]:checked')).map((el) => el.value) }],
      rejectClose: false,
    });
    if (!Array.isArray(picked)) return;
    const added = picked.filter((id) => !recorded.has(id));
    await item.setFlag('sacadia', 'researched', picked);
    if (added.length) {
      const names = added.map((id) => entries.find((e) => e.flags.sacadia.catalogId === id)?.name ?? id);
      await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<div class="sacadia chat-card note-card"><strong>${item.name}</strong>: ${game.i18n.format('SACADIA.Prestige.Researched', { names: names.join(', '), n: added.length })}</div>` });
    }
  }

  /**
   * Lawful Sanctuary (Magus): "any time a target attempts an attack that specifically attacks that target, they must make
   * a Wiles Check against your Check DC. If they fail, they must choose a different target within range. If there is no
   * other target within range, they expend the AP and exhaust limbs, but do not make the attack." Rolled for the
   * attacker here, after the costs; on a failure the player may retarget and continue, or stop. Returns false to stop.
   */
  async #lawfulSanctuary(item) {
    if (!(item.system.activities ?? []).some((a) => a.type === 'attack')) return true;
    for (const t of Array.from(game.user.targets ?? [])) {
      const ward = grantsFrom(t.actor, 'mg_lawful_sanctuary')[0];
      if (!ward) continue;
      const caster = fromUuidSync(ward.flags.sacadia.grantedBy.casterUuid);
      const cActor = caster?.actor ?? caster;
      const cd = cActor?.system?.checkDc;
      const dc = (typeof cd === 'number' ? cd : cd?.primary) ?? 10;
      const rd = this.actor.getRollData();
      const r = await new Roll(`1d20 + ${Number(rd.wiles) || 0} + ${Number(rd.proficiency) || 0}`).evaluate();
      const pass = r.total >= dc;
      await AbilityUse.postCard({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), rolls: [r],
        content: `<div class="sacadia chat-card note-card">${game.i18n.format('SACADIA.Prestige.SanctuaryCheck', { name: t.name, total: r.total, dc,
          result: game.i18n.localize(pass ? 'SACADIA.Card.SaveSuccess' : 'SACADIA.Card.SaveFailure') })}</div>` });
      if (pass) continue;
      const go = await confirmWarn(item.name, game.i18n.format('SACADIA.Prestige.SanctuaryRetarget', { name: t.name }));
      if (!go || Array.from(game.user.targets ?? []).includes(t)) return false;
    }
    return true;
  }

  /** Ask which of a creature's pools regains `n` points (those below max first). Returns the pool key, or null. */
  static async #pickPool(actor, n) {
    const pools = Object.entries(actor.system.classPools ?? {}).filter(([, p]) => p && (p.max ?? 0) > 0);
    if (!pools.length) return null;
    const options = pools.map(([k, p]) => `<option value="${k}"${(p.value ?? 0) < (p.max ?? 0) ? '' : ' disabled'}>${game.i18n.localize(CONFIG.SACADIA.pools[k] ?? k)} (${p.value}/${p.max})</option>`).join('');
    return sacDialog.wait({ window: { title: actor.name }, rejectClose: false,
      content: `<div class="adv-prompt"><label>${game.i18n.format('SACADIA.Pool.RefundWhich', { n })}</label><select name="pool">${options}</select></div>`,
      buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.PostRoll.Confirm'), default: true,
        callback: (event, button, dialog) => dialog.element.querySelector('[name="pool"]')?.value || null }] });
  }

  /**
   * A weapon's hands as wielded. Shield and Pike: "If you wield a shield in one hand, you may wield a pike in the other.
   * Treat it as a one-handed melee weapon when you wield it."
   */
  #weaponHands(weapon) {
    const hands = weapon?.system.hands ?? 1;
    if (hands === 2 && /pike/i.test(weapon.name) && ownsAbility(this.actor, 'shield_and_pike')
      && this.actor.items.some((i) => i.type === 'armor' && i.system.weaponType === 'shield' && i.system.equipped)) return 1;
    return hands;
  }

  /**
   * Adornment damage steps on a melee attack, each once per turn: Embossed Patch — "When you are surrounded, increase the
   * damage dice of your first melee attack each turn by one dice type"; Momentum Charm — "when you move 15ft or more
   * towards an enemy just before you make a 1H attack action against them" (read as 15ft+ moved this turn).
   */
  async #adornmentSteps(category, weapon, options) {
    if (category !== 'melee') return 0;
    const tf = this.actor.getFlag('sacadia', 'turnFlags') ?? {};
    let steps = 0;
    if (options['self:gear:embossed-patch'] && options['self:surrounded'] && !tf.embossedPatch) {
      steps += 1; await this.actor.setFlag('sacadia', 'turnFlags.embossedPatch', true);
    }
    if (options['self:gear:momentum-charm'] && (weapon?.system.hands ?? 1) === 1 && (this.actor.system.combatState?.movedFeet ?? 0) >= 15 && !tf.momentumCharm) {
      steps += 1; await this.actor.setFlag('sacadia', 'turnFlags.momentumCharm', true);
    }
    return steps;
  }

  /**
   * Corrupted Iron (Lore): "You warp a weapon or armor that you touch. Forever after, that weapon deals elemental damage
   * … instead of normal damage, and it overcomes non-magical damage resistance. If you apply this effect to armor
   * instead, forever after you gain X Damage Resistance to elemental damage of the same type (X = your Proficiency when
   * you apply the effect)." The element is this ability's pick; the item is chosen from your weapons and armor.
   */
  async #corruptedIron(item) {
    const element = item.flags?.sacadia?.pickValue;
    if (!element) return ui.notifications.warn(game.i18n.localize('SACADIA.Lore.PickElement'));
    const choices = this.actor.items.filter((i) => (i.type === 'gear' && i.system.weaponType) || (i.type === 'armor' && i.system.weaponType !== 'shield'));
    if (!choices.length) return ui.notifications.warn(game.i18n.localize('SACADIA.Lore.NoIronTarget'));
    const options = choices.map((i) => `<option value="${i.id}">${foundry.utils.escapeHTML(i.name)}</option>`).join('');
    const id = await sacDialog.wait({ window: { title: item.name }, rejectClose: false,
      content: `<div class="adv-prompt"><label>${game.i18n.localize('SACADIA.Lore.IronWhich')}</label><select name="it">${options}</select></div>`,
      buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.PostRoll.Confirm'), default: true,
        callback: (event, button, dialog) => dialog.element.querySelector('[name="it"]')?.value }] });
    const target = id ? this.actor.items.get(id) : null;
    if (!target) return;
    if (target.type === 'armor') await target.setFlag('sacadia', 'resist', { [element]: this.actor.system.proficiency ?? 0 });
    else await target.setFlag('sacadia', 'elementalDamage', element);
    ui.notifications.info(game.i18n.format('SACADIA.Lore.IronDone', { name: target.name, element: game.i18n.localize(CONFIG.SACADIA.damageTypes[element]?.label ?? element) }));
  }

  /**
   * An attack's damage type (book p.184): Corrupting Touch's element on weapon attacks this turn, a Corrupted Iron
   * weapon's element, the Elemental Weapon's element on the divine weapon, else the weapon's own type — or, for a
   * weaponless attack, the ability's damage-part type. '' is untyped.
   */
  #attackDamageType(act, weapon) {
    const T = CONFIG.SACADIA.damageTypes;
    const turnElement = Object.entries(this.actor.system.bonuses?.weaponElement ?? {}).find(([, v]) => v > 0)?.[0];
    if (weapon && turnElement && T[turnElement]) return turnElement;
    if (weapon?.flags?.sacadia?.elementalDamage) return weapon.flags.sacadia.elementalDamage;
    if (weapon?.flags?.sacadia?.signature) {
      const el = abilityItem(this.actor, 'fb_elemental_weapon')?.flags?.sacadia?.pickValue;
      if (el && T[el]) return el;
    }
    if (weapon) return normalizeDamageType(weapon.system.damageType, T);
    return normalizeDamageType(act.damage?.[0]?.type, T);
  }

  /**
   * Nettle's conversion: pick which of the target's adversarial conditions to convert and what it becomes ("convert up
   * to 2 levels of that adversarial condition to Sting, Jinxed, Delirium, or Nausea" per point). Returns `{from, to, n}`
   * (n capped at the levels held), or null when dismissed. "They must be able to take the condition chosen": a result
   * the target already has is refused at apply (no stacking).
   */
  async #promptConvert(item, convert, numbers) {
    const tgt = Array.from(game.user.targets ?? [])[0]?.actor;
    const S = CONFIG.SACADIA;
    const held = Object.entries(tgt?.system?.conditions ?? {}).filter(([k, c]) => (c?.value ?? 0) > 0 && k !== 'madness' && S.conditions[k]);
    if (!held.length) { ui.notifications.warn(game.i18n.localize('SACADIA.Prestige.NothingToConvert')); return null; }
    const opt = (k) => `<option value="${k}">${game.i18n.localize(S.conditions[k]?.label ?? k)}</option>`;
    const content = `<div class="adv-prompt"><label>${game.i18n.localize('SACADIA.Prestige.ConvertFrom')}</label><select name="from">${held.map(([k]) => opt(k)).join('')}</select>`
      + `<label>${game.i18n.localize('SACADIA.Prestige.ConvertTo')}</label><select name="to">${(convert.to ?? []).map(opt).join('')}</select></div>`;
    const res = await sacDialog.wait({
      window: { title: item.name }, content, rejectClose: false,
      buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.PostRoll.Confirm'), default: true,
        callback: (event, button, dialog) => ({ from: dialog.element.querySelector('[name="from"]')?.value, to: dialog.element.querySelector('[name="to"]')?.value }) }],
    });
    if (!res?.from || !res?.to || res.from === res.to) return null;
    if ((tgt.system.conditions?.[res.to]?.value ?? 0) > 0) {
      ui.notifications.warn(game.i18n.format('SACADIA.Prestige.CannotTake', { name: tgt.name, condition: game.i18n.localize(S.conditions[res.to]?.label ?? res.to) }));
      return null;
    }
    const max = Math.max(0, Math.round(resolveModifierValue(convert.amount, numbers)));
    const n = Math.min(max, tgt.system.conditions[res.from]?.value ?? 0);
    return n > 0 ? { ...res, n } : null;
  }

  /**
   * Resolve an activity's prestige save extensions (item-ability `save.ext`, build-authored; see the `ext` note in
   * onSaveRoll) for this cast: formula fields become numbers, `@target1` / `@target2` / `@self` become token uuids, a
   * save-gated grant (`grantOnFail`) becomes the ability's built grant, and armed boosts merge their `saveExt`
   * (Luckless Hold: Enduring). Returns the JSON the card's save button carries, or '' when there is none.
   */
  #saveExt(act, item, numbers, usedChoice, boostSets = [], renewing = false) {
    const src = { ...(act.save?.ext ?? {}) };
    for (const { item: b } of boostSets) Object.assign(src, b.system.boost?.special?.saveExt ?? {});
    if (!Object.keys(src).length) return '';
    const cid = item.flags?.sacadia?.catalogId ?? item.id;
    // Enemies Abound: "The affected target makes a Wiles Check against this effect every time you renew Focus … When
    // it passes the Check, the effect ends."
    if (renewing && src.grantOnFail && src.resaveOnRenew) return JSON.stringify({ onSuccess: { endGrant: { ability: cid, casterUuid: this.actor.uuid } } });
    // Build-only keys (the card needs none of them).
    delete src.perFailDie; delete src.perFailDieWith; delete src.resaveOnRenew;
    const choiceKey = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k === '@choice' ? usedChoice : k, v]).filter(([k]) => k));
    const targets = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
    const self = this.actor.token?.uuid ?? this.actor.getActiveTokens?.()[0]?.document?.uuid ?? this.actor.uuid;
    const ref = (v) => (v === '@target1' ? targets[0] : v === '@target2' ? targets[1] : v === '@self' ? self : v) ?? '';
    const num = (v) => Math.max(0, Math.floor(resolveModifierValue(String(v), numbers)));
    const out = { ...src };
    for (const k of ['checks', 'capAt']) if (src[k] != null) out[k] = num(src[k]);
    if (src.healTo) out.healTo = ref(src.healTo);
    // Silvery Barbs: the ally (second target) gains the Fumble taken to their next to-hit.
    if (src.allyToHit) out.allyToHit = { uuid: ref(src.allyToHit.uuid ?? '@target2') };
    // Per failed check deltas; a `@choice` key is this use's picked condition (Transmute Trauma).
    if (src.perFail) out.perFail = { ...(src.perFail.self ? { self: choiceKey(src.perFail.self) } : {}),
      ...(src.perFail.other ? { other: { deltas: choiceKey(src.perFail.other.deltas), uuid: ref(src.perFail.other.uuid ?? '@target2') } } : {}) };
    if (src.grantOnFail) {
      const g = this.#buildGrant(item, numbers, usedChoice);
      // Given once, on the failed save, and not re-given on renewal — so it has no lease; the Focus anchor reaps it.
      if (g) out.grant = { ...g, duration: { ...g.duration, noLease: true } };
      delete out.grantOnFail;
    }
    return JSON.stringify(out);
  }

  /**
   * Build the ally-grant request for an ability (or null). Focus-maintained grants only (first build).
   * Resolves each change's `value` against the caster's numbers now, so the AE placed on the ally is a
   * fixed number that scaled off the caster at cast time. The GM client applies it (see applyGrant).
   * @param {Item} item
   * @param {Record<string,number>} numbers  The caster's `_modifierNumbers()` map.
   * @returns {object|null}
   */
  #buildGrant(item, numbers, usedChoice = '', extraChanges = []) {
    const g = item.system.grant;
    const type = g?.duration?.type;
    if (!g?.scope || !['focus', 'consumed', 'rounds'].includes(type)) return null;
    // A `self` grant lands on the caster (no external target needed); ally/allies grants need targets.
    const targeted = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
    // Absolute Drivel: "you may use it on an ally within 30ft of you instead of yourself".
    const redirect = g.scope === 'self' && g.allyWith && targeted.length && ownsAbility(this.actor, g.allyWith);
    const targets = g.scope === 'self' && !redirect ? [this.actor.uuid] : (redirect ? targeted.slice(0, 1) : targeted);
    if (!targets.length) return null;
    // A change may carry a `predicate` (atoms) evaluated against the *caster's* roll options at cast
    // time — so an upgrade passive (Standing Strike enhancing Stand By Me) or an "If you have
    // Steadied" clause is folded into the grant only when the caster actually qualifies.
    // The per-use choice joins the caster's options so a change can gate on its branch (Mindmeld's
    // "disadvantage on their attack" vs "advantage on an ally's check").
    const cidG = item.flags?.sacadia?.catalogId ?? item.id;
    // Whether the target is an enemy rides along too (Greater Transference only strengthens Shield Transference on an ally).
    const casterOptions = { ...(this.actor.system._rollOptions?.() ?? {}), ...(usedChoice ? { [`self:choice:${cidG}:${usedChoice}`]: true } : {}),
      ...(this.#targetOptions()['target:hostile'] ? { 'target:hostile': true } : {}) };
    // `<choice>` in a key is this use's pick (Contract Tome's defense, Toxin to Tonic's condition); `<pick>` the
    // ability's standing pick (flags.sacadia.pickValue — Razorleaf's weapon type when chosen up front).
    const pickValue = item.flags?.sacadia?.pickValue ?? '';
    // `<picks>`: every pick of this ability's copies (Poured Mold, taken up to three times — one Focus covers them all).
    const picks = this.actor.items.filter((i) => i.flags?.sacadia?.catalogId === cidG).map((i) => i.flags?.sacadia?.pickValue).filter(Boolean);
    const keyOf = (k) => String(k).replaceAll('<choice>', usedChoice || '').replaceAll('<pick>', pickValue);
    const resolve = (c) => ({ key: keyOf(c.key), mode: c.mode ?? 2, value: String(resolveModifierValue(c.value, numbers)) });
    const expand = (c) => (String(c.key).includes('<picks>') ? picks.map((p) => ({ ...c, key: String(c.key).replaceAll('<picks>', p) })) : [c]);
    const changes = (g.changes ?? [])
      .filter((c) => c.key && evaluatePredicate(c.predicate, casterOptions))
      .flatMap(expand).map(resolve);
    // Extra changes a consumed boost adds to this grant (Call of Effort: +1 damage per AP of an effect).
    for (const c of extraChanges) changes.push(resolve(c));
    // Per-target change sets: the i-th target gets set i (the last set repeats for any further targets).
    const per = (g.perTarget ?? []).filter((set) => set?.length);
    const changesByTarget = per.length
      ? Object.fromEntries(targets.map((u, i) => [u, per[Math.min(i, per.length - 1)].filter((c) => c.key).map(resolve)]))
      : null;
    if (!changes.length && !changesByTarget && !g.marker) return null;
    // The Focus's end effects, with this use's pick(s) filled in (Winter Frost: the chosen condition; Poured Mold: all).
    const endList = (list) => (list ?? []).flatMap((k) => (k === '<picks>' ? picks : [k === '<choice>' || k === '@choice' ? usedChoice : k])).filter(Boolean);
    const oe = g.onEnd ?? {};
    const onEnd = (oe.clear?.length || oe.unEndure?.length || oe.clearTemp || oe.casterFatigue)
      ? { clear: endList(oe.clear), unEndure: endList(oe.unEndure), clearTemp: !!oe.clearTemp, casterFatigue: oe.casterFatigue ?? 0 } : null;
    return {
      casterUuid: this.actor.uuid,
      ability: item.flags?.sacadia?.catalogId ?? item.id,
      label: g.label || item.name,
      targets, changes, ...(changesByTarget ? { changesByTarget } : {}),
      ...(onEnd ? { onEnd } : {}), ...(g.statuses?.length ? { statuses: [...g.statuses] } : {}),
      // A rounds count may scale (Bloodrage: "up to X rounds, X is your Proficiency").
      duration: { type, on: g.duration.on || '', ...(type === 'rounds' ? { rounds: g.duration.roundsFormula
        ? Math.max(1, Math.round(resolveModifierValue(g.duration.roundsFormula, numbers))) : (g.duration.rounds || 1) } : {}) },
    };
  }

  /**
   * Prompt for a grant's variable resource spend (e.g. Blessing of Hot Coal — reduce your Madness by up to M), without
   * spending it (#payGrantResource does, once the action is under way). Only asks when the grant will actually land
   * (declares a scope and has a target); the chosen amount becomes `@spent` in the grant's change formulas. The resource
   * is a leveled condition (`system.conditions.<key>.value`); overspend is impossible (cap == available).
   * @param {Item} item
   * @returns {Promise<number|null|undefined>} the amount, null if cancelled, undefined if no spend.
   */
  async #askGrantResource(item) {
    const g = item.system.grant;
    const spend = g?.spend;
    if (!spend?.resource || !g.scope) return undefined;
    // A self grant always has a recipient (the caster); an ally grant needs a target — don't burn the
    // resource if there's nothing to grant to.
    if (g.scope !== 'self' && !(game.user.targets?.size)) return undefined;
    const cond = this.actor.system.conditions?.[spend.resource];
    if (!cond) return undefined;
    const numbers = this.actor.system._modifierNumbers?.() ?? {};
    const cap = spend.max ? resolveModifierValue(spend.max, numbers) : null;
    const label = game.i18n.localize(CONFIG.SACADIA.conditions[spend.resource]?.label ?? spend.resource);
    const chosen = await AbilityUse.#promptResourceSpend(label, cond.value, cap);
    if (chosen === null) return null; // cancelled
    return cap != null ? Math.min(chosen, cap) : chosen;
  }

  /** Deduct a grant's resource spend chosen by #askGrantResource (no prompts). */
  async #payGrantResource(item, amount) {
    const key = item.system.grant?.spend?.resource;
    const cond = key ? this.actor.system.conditions?.[key] : null;
    if (!cond || !(amount > 0)) return;
    await this.actor.update({ [`system.conditions.${key}.value`]: Math.max(0, cond.value - amount) });
  }

  /**
   * Prompt for a variable resource spend (a leveled condition like Madness). Returns the chosen count
   * (≥0), or null if dismissed. Mirrors #promptPoolAmount but frames the ask as reducing a condition.
   * @param {string} label     Localized resource name.
   * @param {number} available Current value (shown as a hint).
   * @param {number|null} cap  The ability's rule limit on the spend, or null for unbounded.
   */
  static async #promptResourceSpend(label, available, cap) {
    const read = (event, button, dialog) =>
      Math.max(0, Math.round(Number(dialog.element.querySelector('[name="amt"]')?.value) || 0));
    const prompt = cap != null
      ? game.i18n.format('SACADIA.Spend.HowManyMax', { resource: label, max: cap })
      : game.i18n.format('SACADIA.Spend.HowMany', { resource: label });
    return sacDialog.wait({
      window: { title: label },
      content: `<div class="adv-prompt">
        <label>${prompt}</label>
        <input type="number" name="amt" value="0" min="0"${cap != null ? ` max="${cap}"` : ''} step="1"/>
        <p class="hint">${game.i18n.format('SACADIA.Spend.Available', { resource: label, current: available })}</p>
      </div>`,
      buttons: [{ action: 'spend', label: game.i18n.localize('SACADIA.Spend.Confirm'), default: true, callback: read }],
      rejectClose: false,
    });
  }

  /**
   * Layer B: record the current target token(s) under the ability's mark key on this actor. Does
   * nothing if the ability declares no `mark.key` or nothing is targeted. Exclusive marks (default)
   * replace the key's prior set so re-marking *moves* the mark; non-exclusive marks union in.
   * @param {Item} item  The ability being used.
   */
  async #applyMark(item) {
    const key = item.system.mark?.key;
    if (!key) return;
    const uuids = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
    if (!uuids.length) return;
    const marks = foundry.utils.deepClone(this.actor.system.marks ?? {});
    const prev = marks[key] ?? [];
    marks[key] = item.system.mark.exclusive ? uuids
      : Array.from(new Set([...prev, ...uuids]));
    const update = { 'system.marks': marks };
    // If an exclusive mark *moves* to a different target set, this is a fresh focus on a new foe —
    // restart the maintenance ramp at round 1 (overriding the +1 #spendAction just applied), so a
    // per-round bonus (Fight Reflex) doesn't carry the prior target's accrued rounds onto the new one.
    const cid = item.flags?.sacadia?.catalogId ?? item.id;
    const moved = item.system.mark.exclusive && !AbilityUse.#sameSet(prev, uuids);
    if (moved && this.actor.system.combatState?.focusRounds?.[cid] != null) {
      const fr = foundry.utils.deepClone(this.actor.system.combatState.focusRounds);
      fr[cid] = 1;
      update['system.combatState.focusRounds'] = fr;
    }
    await this.actor.update(update);
  }

  /** True when two uuid lists hold the same set (order-independent). */
  static #sameSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x));
  }

  /**
   * Roll-time target context (Layer A): the currently-targeted token's conditions/statuses as
   * `target:condition:<key>` roll options — leveled conditions carry their value, simple/status
   * conditions (surprised, prone, …) are `true`. Empty when nothing is targeted.
   */
  #targetOptions() {
    const token = Array.from(game.user.targets ?? [])[0];
    const actor = token?.actor;
    if (!actor) return {};
    const o = {};
    for (const [key, cond] of Object.entries(actor.system.conditions ?? {})) {
      if (cond.value > 0) o[`target:condition:${key}`] = cond.value;
    }
    for (const status of actor.statuses ?? []) o[`target:condition:${status}`] = true;
    // Unconscious creatures are Prone (book p.230).
    if (o['target:condition:unconscious']) o['target:condition:prone'] = true;
    // A target on the other side (not neutral) → `target:hostile` (Foe Transference's save only against an enemy).
    const myDisp = this.actor.getActiveTokens?.()?.[0]?.document?.disposition ?? 1;
    const tDisp = token.document?.disposition ?? 0;
    if (tDisp !== 0 && tDisp !== myDisp) o['target:hostile'] = true;
    // Catnap: "Any attack made against them while they are unconscious is treated as Surprised".
    if (grantsFrom(actor, 'mg_catnap').length) o['target:condition:surprised'] = true;
    // Creature type (Sentinel's Favored Enemy): `target:type:<t>`, plus `target:favored` when the type is
    // in *our* favored list. Character targets have no creature type; only NPC stat blocks carry one.
    // A creature picked by one of our abilities (The Vengeance's chosen enemy) → `target:pick:<id>`. Token
    // actors of an unlinked NPC share the base actor's id, so any copy of that creature matches.
    for (const it of this.actor.items) {
      if (it.type === 'ability' && it.system.pick?.kind === 'creature' && it.flags?.sacadia?.pickValue === actor.id) {
        o[`target:pick:${it.flags.sacadia.catalogId}`] = true;
      }
    }
    const cType = actor.system.creatureType;
    if (cType) {
      o[`target:type:${cType}`] = true;
      if ((this.actor.system._favoredTypes?.() ?? []).includes(cType)) o['target:favored'] = true;
      // A creature-type pick that names this target's type (Favored Mastery's bonus type → `target:pick2:legendary_favored`).
      const picks = this.actor.system._picks?.() ?? {};
      for (const { id, value, slot } of [...(picks.favored ?? []), ...(picks.ownFavored ?? [])]) {
        if (value === cType) o[`target:${slot === 2 ? 'pick2' : 'pick'}:${id}`] = true;
      }
    }
    // Adjacency: `target:adjacent` when the target is within 5ft (one square) — the simplest positional
    // gate (Too Close!, etc.), measured from the same grid distance the range markers use.
    const dist = this.targetDistance();
    if (dist != null && dist <= 5) o['target:adjacent'] = true;
    // Layer B: `target:mark:<key>` when this target token carries one of *our* marks (marks store
    // token uuids; a mark set from a previous scene/combat simply never matches a current target).
    const uuid = token.document?.uuid;
    for (const [key, uuids] of Object.entries(this.actor.system.marks ?? {})) {
      if (Array.isArray(uuids) && uuids.includes(uuid)) o[`target:mark:${key}`] = true;
    }
    // `target:new` — a target not yet attacked this turn (Bowman / Hawkeye's new-target bow ramps).
    // resolveAttack records attacked targets after each attack; this reads the set *before* this one.
    if (uuid && !(this.actor.system.combatState?.attackedTargetsThisTurn ?? []).includes(uuid)) o['target:new'] = true;
    // The target's Cover (their own player-set state): rank drives the to-hit penalty, the tier flags
    // gate abilities (Curving Shots vs Full, Expert Marksman vs Half). Full ⇒ Half for the flag.
    let tCover = CONFIG.SACADIA.coverStates[actor.system.cover]?.rank ?? 0;
    // Afraid of Your Touch (on the target): its Half Cover counts as Full.
    if (tCover === 1 && ownsAbility(actor, 'afraid_of_your_touch')) tCover = 2;
    o['target:cover'] = tCover;
    if (tCover >= 1) o['target:cover:half'] = true;
    if (tCover >= 2) o['target:cover:full'] = true;
    return o;
  }

  /**
   * The defensive situation of an incoming attack, as net advantage + card receipts:
   *  - the target's Cover (Half −1, Full −2 — book p.239/254);
   *  - core melee advantage vs a **Surrounded** target (book p.255) and vs a **Prone** target (p.257);
   *  - the target's own `incomingAdvantage` modifiers, evaluated from the *target's* point of view with the
   *    attack described as `attack:melee|ranged|magic`, `attack:opportunity`, `attack:reaction`,
   *    `attack:defense:<pd|…>`, `attack:attacker:pinned` (Swarm Defense, Agile Dance, Close Marksman,
   *    Greased and Wily, Deflect Arrows, Erratic Charge …);
   *  - a Reckless "exposed" state on the target (Reckless Loosing / Reckless Physical Attack).
   * @returns {{adv:number, notes:object[]}}
   */
  #situationalAdvantage(options, category, defenseKey) {
    const notes = [];
    let adv = 0;
    const note = (label, value) => { adv += value; notes.push({ label, target: 'advantage.toHit', mode: 'add', value }); };
    // Clouded Ally (v1.2): "allies in a tile occupied by your Clouded Ally are treated as under Partial Cover".
    const cloudCover = cloudContext(Array.from(game.user.targets ?? [])[0]?.document).friendlyAlly.length ? 1 : 0;
    const cover = Math.max(Number(options['target:cover'] ?? 0), cloudCover);
    if (cover > 0) note(game.i18n.localize('SACADIA.Cover.TargetCover'), -cover);
    // Reckless (your own turn advantage): "make all attacks on this turn at 1× advantage" (optionally only
    // melee attacks vs PD — Reckless Physical Attack).
    const ta = this.actor.getFlag('sacadia', 'turnFlags')?.turnAdvantage;
    if (ta?.value && (!ta.category || ta.category === category) && (!ta.vs || ta.vs === defenseKey)) note(ta.label ?? 'Reckless', ta.value);
    // Surrounded's melee advantage, unless the target shrugs it off: Surrounded Brute ("having Surrounded no longer
    // affects them", designer's ruling) or Mastery of the Cornered ("creatures do not gain 1X Advantage on attacks made
    // against you"). They're still Surrounded for their own abilities (Toughhide).
    const surroundProof = ['surrounded_brute', 'legendary_cornered'].some((id) => ownsAbility(Array.from(game.user.targets ?? [])[0]?.actor, id));
    if (category === 'melee' && options['target:surrounded'] && !surroundProof) note(game.i18n.localize('SACADIA.Situation.Surrounded'), 1);
    if (category === 'melee' && options['target:condition:prone']) note(game.i18n.localize('SACADIA.Simple.Prone'), 1);
    // Environmental conditions (book p.254–255): your Height; the target Cornered or Shadowed.
    // Low Ground: "Creatures do not get advantage to hit you when they have height advantage."
    const tgtLow = Array.from(game.user.targets ?? [])[0]?.actor?.items?.some((i) => i.flags?.sacadia?.catalogId === 'low_ground');
    if (this.actor.statuses?.has('height') && !tgtLow) note(game.i18n.localize('SACADIA.Simple.Height'), 1);
    // Hallow's Calm / Gale (Magus auras): attacks made inside them at 1× disadvantage / advantage.
    const hallow = hallowsAttackAdvantage(this.actor);
    if (hallow.adv) note(hallow.label, hallow.adv);
    // Standing in a zone that hampers attacks (Suppressing Fire: "1X disadvantage on all attacks they make while
    // inside the space").
    const zoneDis = zoneAttackDisadvantage(this.actor.getActiveTokens()[0]?.document);
    if (zoneDis) note(zoneDis, -1);
    const target = Array.from(game.user.targets ?? [])[0]?.actor;
    if (target) {
      const tOpts = {
        ...(target.system._rollOptions?.() ?? {}),
        [`attack:${category || 'none'}`]: true,
        ...(defenseKey ? { [`attack:defense:${defenseKey}`]: true } : {}),
        ...(options['self:attack:opportunity'] ? { 'attack:opportunity': true } : {}),
        ...(options['self:attack:reaction'] ? { 'attack:reaction': true } : {}),
        ...(options['target:surrounded'] ? { 'self:surrounded': true } : {}),
        ...((this.actor.system.conditions?.pinned?.value ?? 0) > 0 ? { 'attack:attacker:pinned': true } : {}),
      };
      const tNums = target.system._modifierNumbers?.() ?? {};
      for (const it of target.items) {
        if (it.type !== 'ability') continue;
        for (const m of it.system?.modifiers ?? []) {
          if (m.target !== 'incomingAdvantage') continue;
          if (!evaluatePredicate(m.predicate, tOpts)) continue;
          const v = resolveModifierValue(m.value, tNums);
          if (v) note(`${m.label || it.name} (${target.name})`, v);
        }
      }
      // Buffs placed on the target that change how attacks against it roll (Carrying the Team's shield,
      // Reckless exposure via grant) — the AE-able `bonuses.incomingAdvantage` sink.
      if (target.statuses?.has('cornered')) note(`${game.i18n.localize('SACADIA.Simple.Cornered')} (${target.name})`, 1);
      if (target.statuses?.has('shadowed')) note(`${game.i18n.localize('SACADIA.Simple.Shadowed')} (${target.name})`, -1);
      // Field of Flowers (Witch): "all reaction attacks made against them are made at 1X Disadvantage".
      const incR = options['self:attack:reaction'] ? (target.system.bonuses?.incomingReactionAdvantage ?? 0) : 0;
      if (incR) note(`Field of Flowers (${target.name})`, incR);
      const inc = target.system.bonuses?.incomingAdvantage ?? 0;
      if (inc) note(`${game.i18n.localize('SACADIA.Situation.Incoming')} (${target.name})`, inc);
      // Smudge (trinket): "Hold a lit smudge in both hands: ranged attacks have 1X Disadvantage against you."
      if (category === 'ranged' && findGear(target, 'smudge', { prefix: true, where: 'equipped' })) note(`Smudge (${target.name})`, -1);
      // Reckless exposure: "attacks made against you (your PD) at X advantage until your next turn".
      const ex = target.getFlag('sacadia', 'exposed');
      if (ex?.adv && (!ex.vs || ex.vs === defenseKey)) note(`${ex.label ?? ''} (${target.name})`, ex.adv);
    }
    return { adv, notes };
  }

  /**
   * Evaluate the actor's **roll-time-contextual** modifiers against the full roll options, and return
   * their contribution to this activity's roll — flat to-hit/damage, die-steps, dice bonuses, gated
   * advantage, plus card receipts. These are the modifiers excluded from the prep-time derived fold
   * because they depend on roll-time state: a `target:*` atom (the current target) or a
   * `self:attack:*` atom (the weapon *bound* to the attack being rolled). Scope honors global buckets
   * (all/category) or a specific catalogId.
   */
  #targetModifiers(options, numbers, category, catalogId) {
    const out = { toHit: 0, damage: 0, dieStep: 0, advToHit: 0, saveAdv: 0, saveDc: 0, dice: [], notes: [] };
    const GLOBAL = ['all', 'melee', 'ranged', 'magic'];
    for (const item of this.actor.items) {
      if (item.type !== 'ability') continue;
      // An ability taken more than once with different weapon picks (Bigger Stones on the bow and on the crossbow):
      // its `self:attack:picked:<id>` must reflect this copy's own pick, not any copy's.
      let opts = options;
      const cid = item.flags?.sacadia?.catalogId;
      if (cid && item.system?.pick?.kind === 'weaponType') {
        const pickValue = item.flags?.sacadia?.pickValue;
        opts = { ...options };
        if (pickValue && options[`self:attack:weapon:${pickValue}`]) opts[`self:attack:picked:${cid}`] = true;
        else delete opts[`self:attack:picked:${cid}`];
      }
      for (const mod of item.system?.modifiers ?? []) {
        const atoms = predicateAtoms(mod.predicate);
        if (!modifierIsRollTime(mod)) continue; // prep-folded already; this pass is roll-time only
        if (!evaluatePredicate(atoms, opts)) continue;
        const scope = mod.scope || 'all';
        const scopeOk = GLOBAL.includes(scope) ? (scope === 'all' || scope === category) : (scope === catalogId);
        if (!scopeOk) continue;
        const label = mod.label || item.name;
        if (mod.target === 'damageDice') {
          out.dice.push({ label, formula: mod.value });
          out.notes.push({ target: 'damageDice', mode: 'dice', value: mod.value, label });
          continue;
        }
        const v = resolveModifierValue(mod.value, numbers);
        if (!v) continue;
        if (mod.target === 'toHit') out.toHit += v;
        else if (mod.target === 'damage') { if (mod.mode === 'step') out.dieStep += v; else out.damage += v; }
        else if (mod.target === 'dieStep') out.dieStep += v;
        else if (mod.target === 'advantage.toHit') out.advToHit += v;
        // Debuffs on a save this ability forces (Tough Starter, Ground Wrestle, Bloodletter …): net
        // advantage handed to the saver (negative = disadvantage), and a bump to the DC they roll against.
        else if (mod.target === 'saveAdvantage') out.saveAdv += v;
        else if (mod.target === 'saveDc') out.saveDc += v;
        else continue; // non-offense targets don't apply to an outgoing attack roll
        out.notes.push({ target: mod.target, mode: mod.mode, value: v, label });
      }
    }
    return out;
  }

  /** Format an ability's range for the card: a numeric distance shows "N ft"; else the type label. */
  static #rangeLabel(range) {
    if (range?.value != null) return `${range.value} ${game.i18n.localize('SACADIA.Range.Feet')}`;
    if (range?.type) return game.i18n.localize(CONFIG.SACADIA.rangeTypes[range.type] ?? range.type);
    return '';
  }

  /**
   * Grid distance (in scene units, i.e. feet) from the actor's token to the first targeted token, or
   * null if the geometry isn't available (no token, no target, no canvas). Used for the range check.
   */
  targetDistance() {
    return this.#tokenGap(this.actor.getActiveTokens?.()?.[0], Array.from(game.user.targets ?? [])[0]);
  }

  /**
   * Pixel center of a token, preferring the cached move position over the (v14-laggy) document coords
   * (see #tokenPos), falling back to the document for tokens that haven't moved since the sheet opened.
   */
  #tokenCenter(t) {
    const gs = canvas.grid.size;
    const p = this.tokenPos.get(t.id);
    return {
      x: (p?.x ?? t.document.x) + (t.document.width * gs) / 2,
      y: (p?.y ?? t.document.y) + (t.document.height * gs) / 2,
    };
  }

  /** Grid distance (feet) between two tokens, or null if the geometry isn't available. */
  #tokenGap(a, b) {
    if (!a || !b || !canvas?.grid) return null;
    return canvas.grid.measurePath([this.#tokenCenter(a), this.#tokenCenter(b)])?.distance ?? null;
  }

  /**
   * Positional context from token geometry at use (book p.256). Returns roll options — `self:surrounded`
   * / `target:surrounded` (the 180°-sightline test in {@link isSurrounded}) — and numeric scalers
   * `adjacentEnemies` / `adjacentAllies`. All empty/zero when the geometry isn't available (no token/
   * canvas), so positional modifiers simply don't fire. "Enemy"/"ally" is by token disposition relative
   * to the acting token; "adjacent"/"threatening" is ≤ 5ft (one square) — a documented simplification of
   * melee reach, in the same player-visible-state spirit as Cover (not exact wall/reach geometry).
   * @returns {{opts: Record<string, boolean>, nums: {adjacentEnemies: number, adjacentAllies: number}}}
   */
  #positionalContext() {
    const empty = { opts: {}, nums: { adjacentEnemies: 0, adjacentAllies: 0 } };
    const self = this.actor.getActiveTokens?.()?.[0];
    if (!self || !canvas?.grid) return empty;
    const all = (canvas.tokens?.placeables ?? []).filter((t) => t?.actor);
    const enemyOf = opposed;
    const near = (a, b) => { const d = this.#tokenGap(a, b); return d != null && d <= 5; };
    const threats = (of) => all.filter((t) => t.id !== of.id && enemyOf(of, t) && near(of, t));
    const opts = {};
    const selfThreats = threats(self);
    const nums = {
      adjacentEnemies: selfThreats.length,
      adjacentAllies: all.filter((t) => t.id !== self.id && allied(t, self) && near(self, t)).length,
    };
    if (isSurrounded(this.#tokenCenter(self), selfThreats.map((t) => this.#tokenCenter(t)))) opts['self:surrounded'] = true;
    // Clouded Foe (v1.2): "enemies in a tile occupied by Clouded Foe are considered Surrounded".
    if (cloudContext(self.document).hostileFoe.length) opts['self:surrounded'] = true;
    if ((this.actor.system.bonuses?.ignoreSurrounded ?? 0) > 0) delete opts['self:surrounded'];
    // Target Surrounded: the target's threatening enemies are the tokens hostile to *it* (the actor's side).
    const target = Array.from(game.user.targets ?? [])[0];
    if (target && target.id !== self.id) {
      const tThreats = threats(target);
      if (isSurrounded(this.#tokenCenter(target), tThreats.map((t) => this.#tokenCenter(t)))) opts['target:surrounded'] = true;
      if (cloudContext(target.document).hostileFoe.length) opts['target:surrounded'] = true;
      // Guard Them: "they ignore the effects of the Surrounded condition".
      if ((target.actor?.system?.bonuses?.ignoreSurrounded ?? 0) > 0) delete opts['target:surrounded'];
      // My allies (not me) within 5ft of the target — Wrestling Friends' per-ally Harm bonus.
      nums.targetAdjacentAllies = all.filter((t) => t.id !== self.id && t.id !== target.id
        && allied(t, self) && near(target, t)).length;
    }
    return { opts, nums };
  }

  /**
   * Enemies still standing in the active combat, from this actor's side (opposite token disposition, not
   * defeated) — Boss Energy's "only one enemy" and Completionist's "hit every enemy". 0 outside combat.
   */
  static #enemyCount(actor) {
    const me = actor.getActiveTokens?.()?.[0];
    const d = me?.document?.disposition ?? 0;
    if (!game.combat || !d) return 0;
    return game.combat.combatants.filter((c) => !c.defeated && c.token && (c.token.disposition ?? 0) * d < 0).length;
  }

  /**
   * Create a chat card honoring the chat's visibility mode (Public / Private GM / Blind / Self — v14 `core.messageMode`;
   * the old `core.rollMode` setting no longer follows the chat dropdown). `ChatMessage.create` — unlike `Roll#toMessage`
   * — doesn't apply it, so it's applied here, for every card we post (e.g. a GM rolling an NPC's attack "Private to GM").
   */
  static async postCard(data) {
    return ChatMessage.create(ChatMessage.applyMode(data));
  }

  /**
   * Ask the player for a signed Advantage level (book p.217, "NX Advantage" = N extra d20s kept
   * best; negative = Disadvantage). `img` / `sub` head the prompt (a Trait's icon and the kind of check); `parts` (flat
   * modifiers, [{label, value}]) and `standing` (advantage already on the roll, [{label, n}]) are listed in it.
   * @param {string} label
   * @param {{img?: string, sub?: string, parts?: object[], standing?: object[], note?: string}} [head]
   * @returns {Promise<number|null>} the advantage level (+adv / −dis / 0 normal), or null if dismissed
   */
  static async promptAdvantage(label, head = {}) {
    return (await AbilityUse.#advantageDialog(label, 0, head))?.level ?? null;
  }

  /**
   * The roll prompt: what's being rolled (icon, name, a line about it), a −/+ stepper for the Advantage level, and for
   * an attack with AP to spare a Consistent Roll (book p.237: extra AP, 1X more advantage each, up to `consistentMax`)
   * spent by clicking bolts. The modifiers already on the roll are listed (`parts`: flat, `standing`: advantage, each
   * with its source; `note` for what's only known at roll time). A live line says what will be rolled — the chosen
   * level plus the standing advantage, and the flat total — and what it costs; one Roll button (Enter) rolls. Arrow
   * keys (or − / +) step the advantage.
   * @returns {Promise<{level: number, consistent: number}|null>} null if dismissed
   */
  static async #advantageDialog(label, consistentMax = 0, { img = '', sub = '', baseAp = 0, parts = [], standing = [], note = '' } = {}) {
    const loc = (k) => game.i18n.localize(k);
    const fmt = (k, d) => game.i18n.format(k, d);
    const esc = foundry.utils.escapeHTML;
    const read = (dialog, name) => Math.round(Number(dialog.element.querySelector(`[name="${name}"]`)?.value) || 0);
    const head = `<header class="sp-head">${img ? `<img src="${esc(img)}" alt=""/>` : ''}<div class="sp-name">`
      + `<div class="sp-title">${esc(label)}</div>${sub ? `<div class="sp-sub">${esc(sub)}</div>` : ''}</div></header>`;
    const signed = (v) => (v < 0 ? `−${-v}` : `+${v}`);
    const advWord = (n) => `${Math.abs(n)}× ${loc(n > 0 ? 'SACADIA.Roll.AdvShort' : 'SACADIA.Roll.DisadvShort')}`;
    const mods = [
      ...parts.filter((p) => p.value).map((p) => `<li class="${p.value < 0 ? 'neg' : ''}"><b>${signed(p.value)}</b><i class="sp-lead"></i><span>${esc(p.label)}</span></li>`),
      ...standing.filter((s) => s.n).map((s) => `<li class="${s.n < 0 ? 'neg' : 'pos'}"><b>${advWord(s.n)}</b><i class="sp-lead"></i><span>${esc(s.label)}</span></li>`),
    ];
    const modsBlock = (mods.length || note) ? `
        <div class="sp-mods">
          <span class="sac-label">${loc('SACADIA.Roll.Modifiers')}</span>
          ${mods.length ? `<ul>${mods.join('')}</ul>` : ''}
          ${note ? `<p class="sp-note">${esc(note)}</p>` : ''}
        </div>` : '';
    const standingNet = standing.reduce((a, s) => a + (s.n || 0), 0);
    const flat = parts.reduce((a, p) => a + (p.value || 0), 0);
    const pips = Array.from({ length: consistentMax }, (_, i) =>
      `<button type="button" class="ap-pip" data-n="${i + 1}" aria-label="${i + 1} ${loc('SACADIA.Economy.Ap')}"><i class="fa-solid fa-bolt"></i></button>`).join('');
    const consistentRow = consistentMax > 0 ? `
        <div class="sp-row">
          <span class="sac-label" data-tooltip="${esc(fmt('SACADIA.Roll.ConsistentHint', { n: consistentMax }))}">${loc('SACADIA.Roll.Consistent')}</span>
          <div class="ap-spend">${pips}</div>
          <input type="hidden" name="consistent" value="0"/>
        </div>` : '';
    const result = await sacDialog.wait({
      window: { title: fmt('SACADIA.Roll.AdvantagePrompt', { label }) },
      position: { width: 340 },
      content: `<div class="sac-prompt roll-prompt">
        ${head}${modsBlock}
        <div class="sp-row">
          <span class="sac-label">${loc('SACADIA.Roll.AdvantageLabel')}</span>
          <div class="adv-stepper">
            <button type="button" class="step" data-step="-1" aria-label="${loc('SACADIA.Roll.Less')}"><i class="fa-solid fa-minus"></i></button>
            <output class="adv-value">${loc('SACADIA.Roll.NormalShort')}</output>
            <button type="button" class="step" data-step="1" aria-label="${loc('SACADIA.Roll.More')}"><i class="fa-solid fa-plus"></i></button>
          </div>
          <input type="hidden" name="level" value="0"/>
        </div>${consistentRow}
        <div class="sp-summary"></div>
        <p class="sp-hint">${loc('SACADIA.Roll.AdvantageNote')}</p>
      </div>`,
      buttons: [{ action: 'roll', label: loc('SACADIA.Check.Roll'), icon: 'fa-solid fa-dice-d20', default: true,
        callback: (event, button, dialog) => ({ level: read(dialog, 'level'), consistent: consistentMax > 0 ? read(dialog, 'consistent') : 0 }) }],
      render: (event, dialog) => {
        const root = dialog.element;
        const level = root.querySelector('[name="level"]');
        const cons = root.querySelector('[name="consistent"]');
        const update = () => {
          const l = Number(level.value) || 0;
          const c = Number(cons?.value) || 0;
          const net = l + c + standingNet;
          const out = root.querySelector('.adv-value');
          out.textContent = l === 0 ? loc('SACADIA.Roll.NormalShort') : fmt(l > 0 ? 'SACADIA.Check.AdvN' : 'SACADIA.Check.DisN', { n: Math.abs(l) });
          out.dataset.sign = String(Math.sign(l));
          root.querySelectorAll('.ap-pip').forEach((p) => p.classList.toggle('on', Number(p.dataset.n) <= c));
          const dice = `${1 + Math.abs(net)}d20`;
          const keep = net > 0 ? loc('SACADIA.Roll.KeepHigh') : (net < 0 ? loc('SACADIA.Roll.KeepLow') : '');
          const ap = baseAp + c;
          root.querySelector('.sp-summary').innerHTML = fmt('SACADIA.Roll.Rolls', { dice: `<b>${dice}</b>` }) + (keep ? `, ${keep}` : '')
            + (flat ? `, <b>${signed(flat)}</b>` : '')
            + (ap > 0 ? ` <span class="sp-cost">· <b>${ap}</b> ${loc('SACADIA.Economy.Ap')}</span>` : '');
        };
        const step = (d) => { level.value = String((Number(level.value) || 0) + d); update(); };
        root.querySelectorAll('.adv-stepper .step').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); step(Number(b.dataset.step)); }));
        root.querySelectorAll('.ap-pip').forEach((b) => b.addEventListener('click', (e) => {
          e.preventDefault();
          const n = Number(b.dataset.n);
          cons.value = String(Number(cons.value) === n ? n - 1 : n); // clicking the last lit bolt takes it back
          update();
        }));
        root.addEventListener('keydown', (e) => {
          if (['ArrowLeft', 'ArrowDown', '-'].includes(e.key)) { e.preventDefault(); step(-1); }
          if (['ArrowRight', 'ArrowUp', '+', '='].includes(e.key)) { e.preventDefault(); step(1); }
        });
        update();
        root.querySelector('button[autofocus]')?.focus();
      },
      rejectClose: false,
    });
    if (result == null) return null;
    // A stubbed or legacy answer may be the bare level.
    return typeof result === 'number' ? { level: result, consistent: 0 } : result;
  }

  /**
   * Prompt the player to pick one of an ability's per-use `choice.options` (e.g. Blessing of the
   * Iron Wall's PD/MD/TD). Each option is a button returning its `value`.
   * @param {string} label   The ability name (for the dialog title).
   * @param {{prompt: string, options: Array<{value: string, label: string}>}} choice
   * @returns {Promise<string|null>} the chosen value, or null if dismissed.
   */
  static async #promptChoice(label, choice) {
    return sacDialog.wait({
      window: { title: label },
      content: choice.prompt ? `<p>${choice.prompt}</p>` : '',
      buttons: choice.options.map((o) => ({ action: o.value, label: o.label || o.value, callback: () => o.value })),
      rejectClose: false,
    });
  }

  /**
   * Ask whether to redirect this ability's per-use choice buff to the targeted ally (Shared Blessing).
   * Yes → the buff goes to the ally instead of the caster; No → the caster keeps it.
   * @returns {Promise<boolean>}
   */
  static async #confirmRedirect(label) {
    return confirmWarn(label, game.i18n.format('SACADIA.Redirect.Prompt', { label }));
  }

  /**
   * Deconfliction picker for the one-Boost-per-action rule: when several armed boosts match an action,
   * let the player choose which one to apply (or none). Returns the chosen boost Item, or null.
   * @param {Item[]} boosts  the matching armed boosts
   * @returns {Promise<Item|null>}
   */
  /**
   * Choose up to `limit` of several armed Boosts that match this action (checkboxes). Returns the chosen
   * boost Items (possibly none).
   */
  static async #pickBoosts(boosts, limit) {
    const rows = boosts.map((b) => `<label class="boost-pick"><input type="checkbox" name="b" value="${b.id}"> ${foundry.utils.escapeHTML(b.name)}</label>`).join('');
    const ids = await sacDialog.wait({
      window: { title: game.i18n.localize('SACADIA.Boost.PickTitle') },
      content: `<p>${game.i18n.format('SACADIA.Boost.PickMany', { n: limit })}</p><div class="boost-picks">${rows}</div>`,
      buttons: [{ action: 'ok', label: game.i18n.localize('SACADIA.Boost.Apply'), default: true,
        callback: (e, btn, d) => Array.from(d.element.querySelectorAll('input[name="b"]:checked')).map((i) => i.value) }],
      rejectClose: false,
    });
    return (ids ?? []).slice(0, limit).map((id) => boosts.find((b) => b.id === id)).filter(Boolean);
  }
}
