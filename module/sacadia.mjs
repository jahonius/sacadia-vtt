// Import document classes.
import { SacadiaActor } from './documents/actor.mjs';
import { SacadiaItem } from './documents/item.mjs';
// Import sheet classes.
import { SacadiaActorSheet } from './sheets/actor-sheet.mjs';
import { SacadiaItemSheet } from './sheets/item-sheet.mjs';
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { SACADIA } from './helpers/config.mjs';
import { effectiveDefenseValue, damageAfterDr } from './helpers/derivation.mjs';
// Import DataModel classes
import * as models from './data/_module.mjs';

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

Hooks.once('init', function () {
  // Add utility classes to the global game object so that they're more easily
  // accessible in global contexts.
  game.sacadia = {
    SacadiaActor,
    SacadiaItem,
    rollItemMacro,
  };

  // Add custom constants for configuration.
  CONFIG.SACADIA = SACADIA;

  // Combat resolution routing (see PLANNING "Combat resolution & hidden information"). Information
  // hiding is always on regardless of this — it only governs who applies damage and when.
  //   default  : auto-resolve + auto-apply PC offense; GM-in-the-loop for NPC offense (never
  //              auto-applies NPC→PC damage — the fudging seam)
  //   fullAuto : auto-apply both directions (mook fights)
  //   manual   : resolve hit/miss only; the GM applies damage by hand
  game.settings.register('sacadia', 'combatResolutionMode', {
    name: 'SACADIA.Settings.CombatMode.Name',
    hint: 'SACADIA.Settings.CombatMode.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      default: 'SACADIA.Settings.CombatMode.Default',
      fullAuto: 'SACADIA.Settings.CombatMode.FullAuto',
      manual: 'SACADIA.Settings.CombatMode.Manual',
    },
    default: 'default',
  });

  /**
   * Initiative is a Courage *or* Finesse Check — the player picks whichever is best (book p.233).
   * `max(@courage, @finesse)` captures "use whichever is best for you" automatically, plus
   * Proficiency (0 for NPCs, per base getRollData) as a Check bonus.
   * @type {String}
   */
  CONFIG.Combat.initiative = {
    formula: '1d20 + max(@courage, @finesse) + @proficiency',
    decimals: 2,
  };

  // Define custom Document and DataModel classes
  CONFIG.Actor.documentClass = SacadiaActor;

  // Note that you don't need to declare a DataModel
  // for the base actor/item classes - they are included
  // with the Character/NPC as part of super.defineSchema()
  CONFIG.Actor.dataModels = {
    character: models.SacadiaCharacter,
    npc: models.SacadiaNPC
  }
  CONFIG.Item.documentClass = SacadiaItem;
  CONFIG.Item.dataModels = {
    ability: models.SacadiaAbility,
    armor: models.SacadiaArmor,
    gear: models.SacadiaGear
  }

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register the simple (binary) conditions as token status effects (icons + AE changes). The
  // leveled conditions are the actor's intrinsic 0–6 tracker, not toggles. Merge by id rather than
  // concat: some ids (prone, unconscious) already exist in core, and CONFIG.statusEffects is
  // proxied by id — a duplicate id throws "can't report property … more than once". Ours wins.
  const byId = new Map(CONFIG.statusEffects.map((s) => [s.id, s]));
  for (const [id, c] of Object.entries(SACADIA.simpleConditions)) {
    byId.set(id, { id, name: c.label, img: c.img, changes: c.changes ?? [] });
  }
  CONFIG.statusEffects = Array.from(byId.values());

  // Register ApplicationV2 sheet classes (v14: AppV1 `Actors`/`Items` + `ActorSheet`/`ItemSheet`
  // are removed; use DocumentSheetConfig).
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.unregisterSheet(Actor, 'core', foundry.applications.sheets.ActorSheetV2);
  DocumentSheetConfig.registerSheet(Actor, 'sacadia', SacadiaActorSheet, {
    makeDefault: true,
    label: 'SACADIA.SheetLabels.Actor',
  });
  DocumentSheetConfig.unregisterSheet(Item, 'core', foundry.applications.sheets.ItemSheetV2);
  DocumentSheetConfig.registerSheet(Item, 'sacadia', SacadiaItemSheet, {
    makeDefault: true,
    label: 'SACADIA.SheetLabels.Item',
  });

  // Preload Handlebars templates.
  return preloadHandlebarsTemplates();
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here is a useful example:
Handlebars.registerHelper('toLowerCase', function (str) {
  return str.toLowerCase();
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once('ready', function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on('hotbarDrop', (bar, data, slot) => createItemMacro(data, slot));
});

/* -------------------------------------------- */
/*  Combat-turn automation                      */
/* -------------------------------------------- */

// On each turn/round advance, one GM client: (1) removes expired temporary effects; (2) applies
// start-of-turn condition damage (Hemorrhage) to the new active combatant; (3) reduces the
// just-ended combatant's leveled conditions by 1 (book p.259). Foundry tracks durations/turns but
// performs none of this on its own.
Hooks.on('updateCombat', async (combat, changed) => {
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
    await SacadiaActorSheet.resetActionEconomy(actor);
    await applyTurnStartConditions(actor);
    if (actor.statuses?.has('insane')) await rollInsaneTable(actor);
  }

  // (3) end-of-turn condition reduction for the combatant whose turn just ended
  const prevId = combat.previous?.combatantId;
  const prev = prevId ? combat.combatants.get(prevId) : null;
  if (prev?.actor) await reduceConditions(prev.actor);

  // (4) backstop: reap any ally grant whose anchor is gone (the anchor-delete cascade is primary).
  await reapOrphanGrants();
});

// When an encounter ends, clear every combatant's target marks (Layer B) — a mark is a combat focus,
// not a permanent brand. Overwrite-on-re-mark handles the in-combat case; this is just hygiene so a
// stale focus doesn't linger into the next fight. GM-side (the authority that can update all actors).
Hooks.on('deleteCombat', async (combat) => {
  if (game.users.activeGM !== game.user) return;
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (actor && Object.keys(actor.system.marks ?? {}).length) await actor.update({ 'system.marks': {} });
  }
  // Ally grants are combat buffs — tear down every anchor + granted effect in the scene (deleting the
  // anchor cascades the grant reap via deleteActiveEffect; we also sweep any strays directly).
  await removeSacadiaEffects((e) => e.flags?.sacadia?.anchor || e.flags?.sacadia?.grantedBy);
});

/* -------------------------------------------- */
/*  Ally grants (granted effects, GM-side)      */
/* -------------------------------------------- */

// Apply an ally-grant request (from a card flag): place a `grantedBy`-tagged Active Effect on each
// target. Focus grants also anchor to a caster-side effect (reaped when it dies); consumed grants have
// no anchor and persist until their trigger fires (see consumeGrants) or combat ends. GM-side.
async function applyGrant({ casterUuid, ability, label, targets, changes, duration }) {
  const casterDoc = await fromUuid(casterUuid);
  const caster = casterDoc?.actor ?? casterDoc;
  if (!caster) return;
  const focus = duration?.type === 'focus';
  if (focus) {
    // Ensure a single anchor for this (caster, ability) — the authority for "still maintaining".
    const anchor = caster.effects.find((e) => e.flags?.sacadia?.anchor?.ability === ability);
    if (!anchor) {
      await caster.createEmbeddedDocuments('ActiveEffect', [{
        name: game.i18n.format('SACADIA.Grant.Anchor', { label }),
        img: 'icons/svg/aura.svg', changes: [],
        flags: { sacadia: { anchor: { ability } } },
      }]);
    }
  }
  // Focus grants are anchor-reaped; consumed grants are trigger-reaped (`on` = 'attack'/'damage-taken').
  const grantedBy = focus
    ? { casterUuid, ability, kind: 'focus' }
    : { casterUuid, ability, kind: 'consumed', on: duration?.on || '' };
  for (const uuid of targets) {
    const doc = await fromUuid(uuid);
    const target = doc?.actor ?? doc;
    if (!target) continue;
    // Replace any prior grant from this caster+ability (no stacking on re-cast).
    const stale = target.effects.filter((e) => {
      const gb = e.flags?.sacadia?.grantedBy;
      return gb && gb.casterUuid === casterUuid && gb.ability === ability;
    }).map((e) => e.id);
    if (stale.length) await target.deleteEmbeddedDocuments('ActiveEffect', stale);
    await target.createEmbeddedDocuments('ActiveEffect', [{
      name: label, img: 'icons/svg/aura.svg',
      changes: changes.map((c) => ({ key: c.key, mode: c.mode, value: c.value })),
      ...(focus ? { duration: { rounds: 1 } } : {}), // focus: lease backstop; consumed: lives until its trigger
      flags: { sacadia: { grantedBy } },
    }]);
  }
}

/** Delete an actor's consumed grants whose trigger matches `on` ('attack' / 'damage-taken'). GM-side. */
async function consumeGrants(actor, on) {
  if (!actor) return;
  const ids = actor.effects.filter((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    return gb && gb.kind === 'consumed' && gb.on === on;
  }).map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
}

/** Delete every embedded effect matching `pred` across the scene's tokens (GM-side). */
async function removeSacadiaEffects(pred) {
  const seen = new Set();
  for (const t of canvas.tokens?.placeables ?? []) {
    const actor = t.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    const ids = actor.effects.filter(pred).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  }
}

// Primary cascade: when a Focus anchor is deleted (turn-start teardown, manual removal, or the caster
// being deleted), reap every ally grant that hung off it. Ties grant lifetime directly to the anchor.
Hooks.on('deleteActiveEffect', (effect) => {
  if (game.users.activeGM !== game.user) return;
  const anchor = effect.flags?.sacadia?.anchor;
  if (!anchor) return;
  const casterUuid = effect.parent?.uuid;
  if (casterUuid) removeSacadiaEffects((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    return gb && gb.casterUuid === casterUuid && gb.ability === anchor.ability;
  });
});

// Backstop sweep: delete any grant whose anchor no longer exists anywhere (covers a caster token being
// removed without a per-effect delete hook). Runs on turn advance and token deletion.
async function reapOrphanGrants() {
  if (game.users.activeGM !== game.user) return;
  const live = new Set();
  for (const t of canvas.tokens?.placeables ?? []) {
    for (const e of t.actor?.effects ?? []) {
      const a = e.flags?.sacadia?.anchor;
      if (a) live.add(`${t.actor.uuid}|${a.ability}`);
    }
  }
  await removeSacadiaEffects((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    // Only anchor-backed (focus) grants are reaped here; consumed grants have no anchor and are
    // removed by their trigger (consumeGrants) or at combat end.
    return gb && gb.kind === 'focus' && !live.has(`${gb.casterUuid}|${gb.ability}`);
  });
}
Hooks.on('deleteToken', () => reapOrphanGrants());

/** Roll each `turnDamage` condition (e.g. Hemorrhage `Nd10`) and apply it to the actor's Health. */
async function applyTurnStartConditions(actor) {
  let total = 0;
  const flavors = [];
  for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
    const level = Math.min(actor.system.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
    const dmg = cfg.effects?.find((e) => e.type === 'turnDamage');
    if (!level || !dmg) continue;
    const roll = await new Roll(`${level}${dmg.perLevelDice.replace(/^\d+/, '')}`).evaluate();
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

// Track token movement into the `moved-feet` auto-counter (see docs/conditional-modifiers.md) while a
// combat is running. `preUpdateToken` still sees the *old* coordinates on the document, so we measure
// the path from there to the incoming position. One GM client mutates, to avoid double-counting.
Hooks.on('preUpdateToken', (tokenDoc, changes) => {
  if (game.users.activeGM !== game.user) return;
  if (!game.combat?.started) return;
  if (!('x' in changes) && !('y' in changes)) return;
  const actor = tokenDoc.actor;
  if (!actor) return;
  const from = { x: tokenDoc.x, y: tokenDoc.y };
  const to = { x: changes.x ?? tokenDoc.x, y: changes.y ?? tokenDoc.y };
  const dist = canvas.grid?.measurePath?.([from, to])?.distance ?? 0;
  if (dist > 0) {
    const cur = actor.system.combatState?.movedFeet ?? 0;
    const update = { 'system.combatState.movedFeet': cur + Math.round(dist) };
    // Moving breaks Focus for abilities whose Focus ends when you leave your square (Stood Ground):
    // drop their maintenance streak so per-round ramps (Fight Reflex) stop this turn.
    const fr = actor.system.combatState?.focusRounds ?? {};
    if (Object.keys(fr).length) {
      const breakers = new Set(actor.items
        .filter((i) => i.type === 'ability' && i.system?.focus?.breaksOnMove)
        .map((i) => i.flags?.sacadia?.catalogId ?? i.id));
      const kept = Object.fromEntries(Object.entries(fr).filter(([cid]) => !breakers.has(cid)));
      if (Object.keys(kept).length !== Object.keys(fr).length) update['system.combatState.focusRounds'] = kept;
    }
    actor.update(update);
  }
});

/** Reduce every leveled (non-enduring) condition on the actor by 1 (end-of-turn, book p.259). */
async function reduceConditions(actor) {
  const update = {};
  for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
    if (CONFIG.SACADIA.enduringConditions.includes(key)) continue;
    const value = actor.system.conditions?.[key]?.value ?? 0;
    if (value > 0) update[`system.conditions.${key}.value`] = value - 1;
  }
  if (Object.keys(update).length) await actor.update(update);
}

/* -------------------------------------------- */
/*  Oracle Insanity latch (book p120)            */
/* -------------------------------------------- */

// Reaching Madness 6 makes an Oracle Insane; Madness is NOT reset, and they stay Insane until it decays
// to 0 (`reduceConditions` handles the end-of-turn −1) or they fall unconscious. So Insanity is stored
// state — the `insane` token status — not a function of current Madness: at Madness 3 you may be sane
// (rising) or insane (falling). We toggle the status as Madness crosses 6 (set) / 0 (clear) and run the
// transition side effects. GM-only mutation; fires regardless of what changed the Madness (ability,
// end-of-turn decay, or a manual edit).
Hooks.on('updateActor', async (actor, changed) => {
  if (game.users.activeGM !== game.user) return;
  const m = foundry.utils.getProperty(changed, 'system.conditions.madness.value');
  if (m === undefined) return;
  const insane = actor.statuses?.has('insane');
  if (m >= 6 && !insane) await goInsane(actor);
  else if (m <= 0 && insane) await endInsane(actor);
});

/** Enter Insanity: set the status and end every maintained ability (Madness abilities + Focus, p120). */
async function goInsane(actor) {
  await actor.toggleStatusEffect('insane', { active: true });
  await endAllFocus(actor);
}

/** Leave Insanity: clear the status, end Focus / P:I abilities, and gain Fatigue = ceil(Proficiency/2). */
async function endInsane(actor) {
  await actor.toggleStatusEffect('insane', { active: false });
  await endAllFocus(actor);
  const prof = actor.getRollData?.()?.proficiency ?? 0;
  const fatigue = Math.ceil(prof / 2);
  if (fatigue > 0) {
    const cur = actor.system.conditions?.fatigue?.value ?? 0;
    await actor.update({ 'system.conditions.fatigue.value': Math.min(6, cur + fatigue) });
  }
}

// Start-of-turn Insane-table roll (book p120): while Insane, roll 1D8 and lose that many HP, then follow
// the entry's effect (a Boost on the first action). HP loss is softened by Heather Root (−ceil(Prof/2))
// or negated on a 7/8 by Writhing Block; rolls 2 & 8 also tweak AP. The narrative effects (attack the
// nearest, adv/disadv on the first attack, etc.) are surfaced on the card for the player to enact.
async function rollInsaneTable(actor) {
  const roll = await new Roll('1d8').evaluate();
  const n = roll.total;
  const owns = (id) => actor.items.some((i) => (i.flags?.sacadia?.catalogId ?? i.id) === id);
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
    `<p class="hint">${game.i18n.localize('SACADIA.Insane.Boost')}</p>`,
  ].join('');
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${game.i18n.localize('SACADIA.Insane.Title')}</strong>`,
    content: `<div class="sacadia insane-roll">${parts}</div>`,
    rolls: [roll],
    rollMode: game.settings.get('core', 'rollMode'),
  });
}

/** Tear down every Focus this actor maintains: delete focus anchors (cascades the grant reap via
 *  deleteActiveEffect), and clear the actor-local marks + focus-round counters they drove. */
async function endAllFocus(actor) {
  const update = {};
  if (Object.keys(actor.system.marks ?? {}).length) update['system.marks'] = {};
  if (Object.keys(actor.system.combatState?.focusRounds ?? {}).length) update['system.combatState.focusRounds'] = {};
  if (Object.keys(update).length) await actor.update(update);
  const anchors = actor.effects.filter((e) => e.flags?.sacadia?.anchor);
  if (anchors.length) await actor.deleteEmbeddedDocuments('ActiveEffect', anchors.map((e) => e.id));
}

/* -------------------------------------------- */
/*  Profession default abilities                 */
/* -------------------------------------------- */

// Taking a profession grants its baseline abilities (Oracle → Forbidden Knowledge / Shattermind; the
// book's "starting" set — aspect/pool abilities are chosen, not granted). We place them on the character
// when a profession is set and pull them when it's dropped, so the sheet stays consistent with the class.
// Reconcile fires only on a profession *key* change, and runs on the acting client so it happens once.
Hooks.on('updateActor', async (actor, changes, options, userId) => {
  if (userId !== game.user.id || actor.type !== 'character') return;
  if (!foundry.utils.hasProperty(changes, 'system.professions.primary.key')
    && !foundry.utils.hasProperty(changes, 'system.professions.secondary.key')) return;
  await reconcileProfessionGrants(actor);
});

/** Map a profession key to its compendium pack (only Hulinari's key/pack names differ). */
function professionPack(key) {
  return game.packs.get(`sacadia.abilities-${key === 'hulinari_warrior' ? 'hulinari' : key}`);
}

/**
 * Add the current professions' baseline ("starting" subpath) abilities that aren't already owned, and
 * remove previously auto-granted ones no longer matching a set profession. Auto-grants are tagged
 * `flags.sacadia.professionGrant` so a player's own (bought) abilities are never touched; an ability the
 * player already has (bought or granted) is never duplicated. Reads the pack live, so completing a
 * profession's `starting` set in the source + rebuilding automatically flows through here.
 */
async function reconcileProfessionGrants(actor) {
  const keys = ['primary', 'secondary'].map((s) => actor.system.professions?.[s]?.key).filter(Boolean);
  const desired = new Map(); // catalogId -> source ability document
  for (const key of new Set(keys)) {
    const pack = professionPack(key);
    if (!pack) continue;
    for (const doc of await pack.getDocuments()) {
      if (/starting/i.test(doc.system?.meta?.subpath ?? '')) desired.set(doc.flags?.sacadia?.catalogId ?? doc.id, doc);
    }
  }
  const owned = new Set(actor.items.map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
  const stale = actor.items
    .filter((i) => i.getFlag('sacadia', 'professionGrant') && !desired.has(i.flags?.sacadia?.catalogId))
    .map((i) => i.id);
  const additions = [];
  for (const [cid, doc] of desired) {
    if (owned.has(cid)) continue;
    const data = doc.toObject();
    delete data._id;
    foundry.utils.setProperty(data, 'flags.sacadia.professionGrant', true);
    additions.push(data);
  }
  if (stale.length) await actor.deleteEmbeddedDocuments('Item', stale);
  if (additions.length) await actor.createEmbeddedDocuments('Item', additions);
}

/* -------------------------------------------- */
/*  Weapon → default attack ability              */
/* -------------------------------------------- */

// Adding a weapon (gear with a `weaponType`) to a character gives it a companion attack ability — bound
// to the weapon, category/defense/range copied from it, damage parts left empty so it rolls the weapon's
// base dice live via the cast-time binding. Tagged `flags.sacadia.weaponAttack = <weaponId>` so it's
// removed when the weapon is deleted (or its weaponType cleared). Generate-once: the player may freely
// edit the generated ability afterwards; only creation/removal is automated. Runs on the acting client.
function isWeaponItem(item) {
  return (item?.type === 'gear' || item?.type === 'armor') && !!item.system?.weaponType
    && item.parent?.documentName === 'Actor' && item.parent.type === 'character';
}

/**
 * The attack category (→ to-hit/damage trait) follows the book's rule, not the weapon family: Wiles for
 * magical weapons (those targeting MD), Finesse for physical ranged, Power for melee (p.218). So a thrown
 * dagger (vs TD, ranged) is Finesse and an imbued blade (vs MD) is Wiles regardless of reach.
 */
function weaponAttackCategory(weapon) {
  if (weapon.system.defense === 'md') return 'magic';
  if (weapon.system.range?.type === 'ranged') return 'ranged';
  return 'melee';
}

/** Build the companion attack-ability document for a weapon (or a shield's Bash). */
function buildWeaponAttack(weapon) {
  const category = weaponAttackCategory(weapon);
  const range = weapon.system.range ?? {};
  const nameKey = weapon.system.weaponType === 'shield' ? 'SACADIA.Weapon.BashName' : 'SACADIA.Weapon.AttackName';
  return {
    name: game.i18n.format(nameKey, { weapon: weapon.name }),
    type: 'ability',
    img: weapon.img,
    system: {
      tag: 'action',
      costs: { ap: 1, limbs: weapon.system.hands >= 2 ? ['twoArm'] : ['oneArm'] },
      range: { type: range.type || (category === 'ranged' ? 'ranged' : 'melee'), value: range.value ?? null },
      activities: [{
        type: 'attack',
        attack: { category, defense: weapon.system.defense || 'pd' },
        damage: [], // empty → pulls the weapon's base dice at cast time (see actor-sheet #resolveWeapon)
      }],
    },
    // `weapon` binds the attack; `weaponAttack` marks it auto-generated (for cleanup).
    flags: { sacadia: { weapon: weapon.id, weaponAttack: weapon.id } },
  };
}

/** Create the companion attack for a weapon unless one already exists. */
async function grantWeaponAttack(weapon) {
  const actor = weapon.parent;
  if (actor.items.some((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id)) return;
  await actor.createEmbeddedDocuments('Item', [buildWeaponAttack(weapon)]);
}

/** Remove any companion attacks bound to a weapon id. */
async function removeWeaponAttack(actor, weaponId) {
  const stale = actor.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === weaponId).map((i) => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments('Item', stale);
}

Hooks.on('createItem', async (item, options, userId) => {
  if (userId !== game.user.id || !isWeaponItem(item)) return;
  await grantWeaponAttack(item);
});

Hooks.on('updateItem', async (item, changes, options, userId) => {
  if (userId !== game.user.id || !['gear', 'armor'].includes(item.type) || item.parent?.type !== 'character') return;
  if (!foundry.utils.hasProperty(changes, 'system.weaponType')) return;
  // weaponType newly set → grant; cleared → remove the companion.
  if (item.system.weaponType) await grantWeaponAttack(item);
  else await removeWeaponAttack(item.parent, item.id);
});

Hooks.on('deleteItem', async (item, options, userId) => {
  if (userId !== game.user.id || !['gear', 'armor'].includes(item.type) || item.parent?.type !== 'character') return;
  await removeWeaponAttack(item.parent, item.id);
});

/* -------------------------------------------- */
/*  Attack resolution & information model        */
/* -------------------------------------------- */

// An attack card carries a `flags.sacadia.attack` resolution request. Resolution runs GM-side only
// (the player may not even have the NPC's defenses on their client), so exactly one client — the
// active GM — computes hit/miss against the *hidden* defense and applies damage. The hit/miss result
// is injected back into the *same* card (which already shows the to-hit + damage dice); the target's
// defense, DR, applied amount, and remaining Health stay in a separate GM-only whisper.
Hooks.on('createChatMessage', (message) => {
  const s = message.flags?.sacadia;
  if (!s?.attack && !s?.grant) return;
  if (game.users.activeGM !== game.user) return; // one authority resolves + mutates
  if (s.attack) resolveAttack(message, s.attack);
  if (s.grant) applyGrant(s.grant);
});

/** Resolve a PC/NPC attack against each targeted token, redacting all secret target data. */
async function resolveAttack(message, req) {
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

  for (const uuid of req.targetUuids) {
    const doc = await fromUuid(uuid);
    const target = doc?.actor ?? doc; // TokenDocument → its actor
    const defenses = target?.system?.defenses;
    if (!defenses) continue;

    const eff = effectiveDefenseValue(defenses[req.defenseKey]?.value, defenses.ad?.value);
    const hit = req.toHitTotal >= eff;
    if (hit) anyHit = true;
    const outcome = game.i18n.localize(hit ? 'SACADIA.Card.Hit' : 'SACADIA.Card.Miss');

    resultRows.push(`<div class="resolution-row"><span class="target">${target.name}</span><b class="${hit ? 'hit' : 'miss'}">${outcome}</b></div>`);
    let gmLine = `${target.name}: ${req.toHitTotal} vs ${req.defenseKey.toUpperCase()} ${eff} → ${outcome}`;

    if (hit && req.damage) {
      const dr = defenses.dr?.value ?? 0;
      const applied = damageAfterDr(req.damage, dr);
      const hpBefore = target.system.health?.value ?? 0;
      const hpDr = Math.max(0, hpBefore - applied);      // damage soaked by DR
      const hpFull = Math.max(0, hpBefore - req.damage); // DR bypassed
      // Auto-apply defaults to the DR outcome; the GM can flip to full or undo via the buttons. DR
      // being dodged by certain attacks is a GM call (not auto-detected), hence the manual control.
      if (autoApply && hpDr < hpBefore) {
        await target.update({ 'system.health.value': hpDr, 'system.combatState.tookDamage': true });
      }
      // Offer to mark an NPC Dead only when the damage is actually lethal (full outcome hits 0).
      const canMarkDead = hpFull <= 0 && target.type === 'npc';
      gmLine += ` · dmg ${req.damage}${dr ? `, DR ${dr}` : ''}`
        + hpControls(uuid, { applied, raw: req.damage, hpDr, hpFull, hpBefore, autoApply, canMarkDead });
      // Consume any "reduce your next incoming damage" grant on this target (Blessing of the Shield) —
      // its DR already fed the `dr` read above, so it applied to this hit; now it's spent.
      await consumeGrants(target, 'damage-taken');
    }

    // Inflicted conditions — same GM-controlled apply structure as damage: on a hit, the GM clicks
    // to give the leveled condition (absolute set from the snapshotted current level, so idempotent).
    if (hit) {
      for (const inf of req.inflict ?? []) {
        const before = target.system.conditions?.[inf.condition]?.value ?? 0;
        const after = Math.min(CONFIG.SACADIA.conditionMax, before + inf.level);
        gmLine += conditionControl(uuid, inf, before, after);
      }
    }
    gmLines.push(gmLine);
  }

  // Advance the attacker's auto-counters (see docs/conditional-modifiers.md): every resolved attack
  // increments attacks-this-turn; a hit extends the consecutive-hit streak, a whiff breaks it. One
  // update per attack action (not per target), GM-side (the authority that resolved it).
  if (attacker) {
    const cs = attacker.system.combatState ?? {};
    await attacker.update({
      'system.combatState.attacksThisTurn': (cs.attacksThisTurn ?? 0) + 1,
      'system.combatState.consecutiveHits': anyHit ? (cs.consecutiveHits ?? 0) + 1 : 0,
    });
    // Consume any "on your next attack" grant on the attacker — its bonus already fed the rolled
    // damage in the attacker's own card; now it's spent.
    await consumeGrants(attacker, 'attack');
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

/**
 * Remove the damage roll blocks and their modifier receipts from a rendered ability card, returning
 * the trimmed HTML. Used on a full miss so the card doesn't show damage it never dealt. DOM-parsed
 * (not regex) because a rendered Roll contains nested divs a naive pattern would truncate.
 * @param {string} content  The card's HTML.
 * @returns {string} content with `.card-roll.damage` and `.card-modifiers.damage-mods` removed.
 */
function stripDamage(content) {
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
function hpControls(targetUuid, { applied, raw, hpDr, hpFull, hpBefore, autoApply, canMarkDead }) {
  const t = (k) => game.i18n.localize(`SACADIA.Card.${k}`);
  const btn = (hp, label, cls = '') =>
    `<button type="button" data-action="applyHp" data-target="${targetUuid}" data-hp="${hp}" class="${cls}">${label}</button>`;
  return '<div class="hp-controls">'
    + btn(hpDr, `${t('ApplyDr')} ${applied} → ${hpDr}`, autoApply ? 'applied' : '')
    + btn(hpFull, `${t('ApplyNoDr')} ${raw} → ${hpFull}`)
    + btn(hpBefore, `${t('Undo')} → ${hpBefore}`, 'undo')
    + (canMarkDead ? `<button type="button" data-action="markDead" data-target="${targetUuid}" class="mark-dead">${t('MarkDead')}</button>` : '')
    + '</div>';
}

/**
 * GM-only apply/undo buttons for an inflicted condition: set the target's condition level to an
 * absolute snapshotted value (idempotent), or undo back to the prior level.
 * @returns {string} HTML
 */
function conditionControl(targetUuid, inf, before, after) {
  const btn = (val, label, cls = '') =>
    `<button type="button" data-action="applyCondition" data-target="${targetUuid}" data-condition="${inf.condition}" data-value="${val}" class="${cls}">${label}</button>`;
  return `<div class="cond-controls"><span class="cond-name">${inf.label} +${inf.level}</span>`
    + btn(after, `→ ${after}`, 'apply')
    + btn(before, `${game.i18n.localize('SACADIA.Card.Undo')} → ${before}`, 'undo')
    + '</div>';
}

/* -------------------------------------------- */
/*  Chat card interactions                      */
/* -------------------------------------------- */

// Bind chat-card buttons: "Roll Save" (any clicker) and the GM-only apply controls.
Hooks.on('renderChatMessageHTML', (message, html) => {
  for (const btn of html.querySelectorAll('[data-action="rollSave"]')) {
    btn.addEventListener('click', onSaveRoll);
  }
  for (const btn of html.querySelectorAll('[data-action="applyHp"]')) {
    btn.addEventListener('click', onApplyHp);
  }
  for (const btn of html.querySelectorAll('[data-action="markDead"]')) {
    btn.addEventListener('click', onMarkDead);
  }
  for (const btn of html.querySelectorAll('[data-action="applyCondition"]')) {
    btn.addEventListener('click', onApplyCondition);
  }
});

/** Set a target's leveled-condition value to the button's absolute value (GM only). */
async function onApplyCondition(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { target: uuid, condition, value } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (actor) await actor.update({ [`system.conditions.${condition}.value`]: Number(value) });
}

/** Set a target's Health to the button's absolute value (GM only; buttons live in GM whispers). */
async function onApplyHp(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const { target: uuid, hp } = event.currentTarget.dataset;
  const doc = await fromUuid(uuid);
  const actor = doc?.actor ?? doc;
  if (!actor) return;
  const update = { 'system.health.value': Number(hp) };
  // Flag the took-damage auto-counter when this actually lowers Health (drives `self:combat:took-damage`).
  if (Number(hp) < (actor.system.health?.value ?? 0)) update['system.combatState.tookDamage'] = true;
  await actor.update(update);
}

/** Apply the core "Dead" status (defeated skull overlay) to the target NPC (GM only). */
async function onMarkDead(event) {
  event.preventDefault();
  if (!game.user.isGM) return;
  const doc = await fromUuid(event.currentTarget.dataset.target);
  const actor = doc?.actor ?? doc;
  if (actor) await actor.toggleStatusEffect('dead', { active: true, overlay: true });
}

/**
 * Resolve an ability save: roll `1d20 + @trait` for the clicker's actor and report vs the DC.
 * @param {PointerEvent} event
 */
async function onSaveRoll(event) {
  event.preventDefault();
  const { trait, dc, inflict } = event.currentTarget.dataset;
  const dcNum = Number(dc);
  const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn(game.i18n.localize('SACADIA.Card.NoSaveActor'));

  const roll = await new Roll(`1d20${trait ? ` + @${trait}` : ''}`, actor.getRollData()).evaluate();
  const success = roll.total >= dcNum;
  const traitLabel = trait ? game.i18n.localize(CONFIG.SACADIA.stats[trait]) : '';
  const outcome = game.i18n.localize(success ? 'SACADIA.Card.SaveSuccess' : 'SACADIA.Card.SaveFailure');

  // On a failed save, apply the pre-computed inflicted conditions to the saver (they control this
  // actor, so the update is authorized). Levels stack additively, clamped to the condition max.
  let inflictNote = '';
  if (!success && inflict) {
    const update = {};
    const labels = [];
    for (const inf of JSON.parse(inflict)) {
      // Simple conditions (Prone, Surprised, …) are token statuses, not leveled — toggle the status
      // rather than setting a `conditions.<key>.value` that doesn't exist.
      if (inf.condition in CONFIG.SACADIA.simpleConditions) {
        await actor.toggleStatusEffect(inf.condition, { active: true });
        labels.push(inf.label);
      } else {
        const cur = actor.system.conditions?.[inf.condition]?.value ?? 0;
        const next = Math.min(CONFIG.SACADIA.conditionMax, cur + inf.level);
        update[`system.conditions.${inf.condition}.value`] = next;
        labels.push(`${inf.label} ${next}`);
      }
    }
    if (Object.keys(update).length) await actor.update(update);
    if (labels.length) inflictNote = ` · ${labels.join(', ')}`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${game.i18n.localize('SACADIA.Card.RollSave')}${traitLabel ? ` (${traitLabel})` : ''} — ${outcome}${inflictNote}`,
    rollMode: game.settings.get('core', 'rollMode'),
  });
}

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createItemMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== 'Item') return;
  if (!data.uuid.includes('Actor.') && !data.uuid.includes('Token.')) {
    return ui.notifications.warn(
      'You can only create macro buttons for owned Items'
    );
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

  // Create the macro command using the uuid.
  const command = `game.sacadia.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: 'script',
      img: item.img,
      command: command,
      flags: { 'sacadia.itemMacro': true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: 'Item',
    uuid: itemUuid,
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then((item) => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`
      );
    }

    // Trigger the item roll
    item.roll();
  });
}
