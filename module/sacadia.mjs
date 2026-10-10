// Import document classes.
import { SacadiaActor } from './documents/actor.mjs';
import { SacadiaItem } from './documents/item.mjs';
// Import sheet classes.
import { SacadiaActorSheet } from './sheets/actor-sheet.mjs';
import { SacadiaItemSheet } from './sheets/item-sheet.mjs';
// Import helper/utility classes and constants.
import { preloadHandlebarsTemplates } from './helpers/templates.mjs';
import { SACADIA } from './helpers/config.mjs';
import { rendPreUpdate, rendPostUpdate } from './helpers/rend.mjs';
import { isWeaponItem, isVersatile, grantWeaponAttack, removeWeaponAttack } from './helpers/weapon-attacks.mjs';
import { staleItems } from './helpers/refresh.mjs';
import { deleteKey, replaceWith } from './helpers/update-ops.mjs';
import { syncFocus } from './helpers/focus.mjs';
import { prestigePreUpdate, prestigePostUpdate, temperedAuraSweep, onAnchorEnded } from './helpers/prestige.mjs';
import { deathThreshold } from './helpers/derivation.mjs';
import { ManualLauncher } from './helpers/manual.mjs';
import { defineZoneBehavior, configureZones, resizeMadnessZones, zonesOf, deleteZone, carryZones } from './helpers/zones.mjs';
import { revealHidden } from './helpers/conditions.mjs';
import { abilityItem, ownsAbility } from './helpers/actor-utils.mjs';
import { postRollCard, styleInitiativeMessage } from './helpers/chat-cards.mjs';
import { migratePicks } from './helpers/legacy-picks.mjs';
import { TravelLedger } from './apps/travel-ledger.mjs';
// Import DataModel classes
import * as models from './data/_module.mjs';
// In-Foundry tests: registered only when the Quench module is active.
import './tests/quench.mjs';
// GM-side rules (module/rules/): the hooks below call into them.
import { applyBladeAuraTurnStart, turnAutomation, woadFacepaint, brassHorn } from './rules/turn.mjs';
import { createItemMacro, rollItemMacro } from './rules/macros.mjs';
import { drawConditionLevels, reflectStatusToSchema, syncConditionEffects } from './rules/token-display.mjs';
import { endInsane, goInsane, onMindMap } from './rules/madness.mjs';
import { hasGmRequest, pendingRequests, reportError, resolveRequests } from './rules/requests.mjs';
import { onApplyCondition, onApplyHp, onCallOfTheDying, onCritSelf, onMarkDead } from './rules/card-actions.mjs';
import { onPostRoll } from './rules/reactions.mjs';
import { onSaveRoll, zoneDamage, zoneSaveCard } from './rules/saves.mjs';
import { reapOrphanGrants, removeSacadiaEffects } from './rules/grants.mjs';
import { reconcileBasicGrants, reconcileProfessionGrants, refreshWorldItems, refreshableActors } from './rules/world.mjs';
import { adoptOrigin, moveHeritageHp, queueIdentity, reconcileIdentityGrants } from './rules/identity.mjs';
import { whisperReactions } from './rules/attack.mjs';
import { goodsItemChanged } from './rules/goods.mjs';
import { sacDialog } from './helpers/dialogs.mjs';

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
    // The Travel Ledger: Sacadia's travel rules a day at a time, for the party on a scene (the viewed one by default).
    travelLedger: (scene) => TravelLedger.open(scene),
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

  // Condition stacking (book p.258): "no creature may attempt to give a condition to any creature which
  // already has that condition … unless otherwise noted." `book` enforces that (a held condition isn't
  // re-attempted; abilities that explicitly stack are exempt); `additive` adds the new levels on top.
  // The in-system User Manual (compendium), openable from Game Settings.
  game.settings.registerMenu('sacadia', 'userManual', {
    name: 'SACADIA.Manual.Menu',
    label: 'SACADIA.Manual.Open',
    hint: 'SACADIA.Manual.Hint',
    icon: 'fa-solid fa-book',
    type: ManualLauncher,
    restricted: false,
  });

  // When GM-request tracking began (helpers: resolveRequests / pendingRequests): only cards after it can be pending.
  game.settings.register('sacadia', 'requestsSince', { scope: 'world', config: false, type: Number, default: 0 });

  // How many silver coins make a gold (helpers/downtime.mjs). The rulebook prices in both and never says.
  game.settings.register('sacadia', 'silverPerGold', {
    name: 'SACADIA.Settings.SilverPerGold.Name',
    hint: 'SACADIA.Settings.SilverPerGold.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 100,
  });

  game.settings.register('sacadia', 'conditionStacking', {
    name: 'SACADIA.Settings.ConditionStacking.Name',
    hint: 'SACADIA.Settings.ConditionStacking.Hint',
    scope: 'world',
    config: true,
    type: String,
    choices: {
      book: 'SACADIA.Settings.ConditionStacking.Book',
      additive: 'SACADIA.Settings.ConditionStacking.Additive',
    },
    default: 'book',
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
  // Woad Facepaint (trinket): "Gain 1X Advantage to Initiative. Expend the Woad Facepaint after you roll it." A Brass Horn
  // held as combat starts: "gain 1X Advantage to your Initiative roll."
  CONFIG.Combatant.documentClass = class SacadiaCombatant extends CONFIG.Combatant.documentClass {
    _getInitiativeFormula() {
      const f = super._getInitiativeFormula();
      const adv = (woadFacepaint(this.actor) ? 1 : 0) + (brassHorn(this.actor) ? 1 : 0);
      return adv ? f.replace(/^1d20/, `${1 + adv}d20kh`) : f;
    }
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
    gear: models.SacadiaGear,
    culture: models.SacadiaCulture,
    ancestry: models.SacadiaAncestry,
  }
  // Placed zones (Stygian Abyss, Suppressing Fire, Focal Point …) — a Region behavior subtype.
  CONFIG.RegionBehavior.dataModels.zone = defineZoneBehavior();
  CONFIG.RegionBehavior.typeIcons ??= {};
  CONFIG.RegionBehavior.typeIcons.zone = 'fa-solid fa-circle-radiation';
  configureZones({ saveCard: zoneSaveCard, zoneDamage: zoneDamage });

  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register every condition (and Cover) as a token status effect so it shows on the token and in the
  // token-HUD palette. Merge by id rather than concat: some ids (prone, unconscious) already exist in
  // core, and CONFIG.statusEffects is proxied by id — a duplicate id throws "can't report property …
  // more than once". Ours wins.
  const byId = new Map(CONFIG.statusEffects.map((s) => [s.id, s]));
  // Simple (binary) conditions carry AE `changes` (e.g. Prone → disadvantage).
  for (const [id, c] of Object.entries(SACADIA.simpleConditions)) {
    byId.set(id, { id, name: c.label, img: c.img, changes: c.changes ?? [] });
  }
  // Leveled conditions: status icon only (no `changes` — the automation runs off the 0–6 schema
  // tracker). The icon reflects presence; the level lives in the effect name + the sheet tracker.
  for (const [id, c] of Object.entries(SACADIA.conditions)) {
    byId.set(id, { id, name: c.label, img: c.img });
  }
  // Cover states (half/full) as togglable statuses (`none` is the absence of the status).
  for (const [key, c] of Object.entries(SACADIA.coverStates)) {
    if (key === 'none') continue;
    byId.set(`cover-${key}`, { id: `cover-${key}`, name: c.label, img: c.img });
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
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to.
  // Return `false` SYNCHRONOUSLY for Item drops so Foundry skips its default document-sheet macro —
  // `createItemMacro` is async (returns a Promise, which is truthy), so returning it directly would
  // let core's default run and clobber our slot. Fire the async macro build in the background.
  Hooks.on('hotbarDrop', (bar, data, slot) => {
    if (data.type !== 'Item') return; // let core handle non-item drops (macros, tables, …)
    createItemMacro(data, slot);
    return false;
  });
});

/* -------------------------------------------- */
/*  Combat-turn automation                      */
/* -------------------------------------------- */

// On each turn/round advance, one GM client: (1) removes expired temporary effects; (2) applies
// start-of-turn condition damage (Hemorrhage) to the new active combatant; (3) reduces the
// just-ended combatant's leveled conditions by 1 (book p.259). Foundry tracks durations/turns but
// performs none of this on its own.
Hooks.on('updateCombat', (combat, changed) => turnAutomation(combat, changed).catch((e) => reportError('turn automation', e)));

// Woad Facepaint (trinket): its initiative bonus (the Combatant class set up at init) uses it up once initiative is rolled.
Hooks.on('updateCombatant', async (combatant, changes, options, userId) => {
  if (userId !== game.user.id || !('initiative' in changes) || changes.initiative == null) return;
  const woad = woadFacepaint(combatant.actor);
  if (!woad) return;
  if ((woad.system.quantity ?? 1) > 1) await woad.update({ 'system.quantity': woad.system.quantity - 1 });
  else await woad.delete();
});

/* -------------------------------------------- */
/*  Death & Dying (book p.230)                   */
/* -------------------------------------------- */

// Health drives two states (book p.230): Wounded while below 0, and death at −½ max HP. Kept in sync
// GM-side whenever Health changes.
Hooks.on('updateActor', async (actor, changes, options) => {
  if (game.users.activeGM !== game.user) return;
  if (!foundry.utils.hasProperty(changes, 'system.health.value')) return;
  const hp = actor.system.health?.value ?? 0;
  // Death Mastery (Thug Legendary): "The first time you would be reduced to 0 HP when you are raging, roll
  // XD4 and add it to your HP, where X is your Power." Once per combat (reset with the fight's uses).
  if (hp <= 0 && (options?.sacadiaPrevHp ?? 0) > 0 && actor.statuses?.has('raging') && ownsAbility(actor, 'legendary_death')
    && !actor.getFlag('sacadia', 'uses')?.combat?.legendary_death) {
    const r = await new Roll(`${Math.max(1, actor.system.stats?.power?.value ?? 1)}d4`).evaluate();
    await actor.update({ 'system.health.value': hp + r.total, 'flags.sacadia.uses.combat.legendary_death': 1 });
    await postRollCard({ actor, roll: r, icon: 'fa-solid fa-skull', title: abilityItem(actor, 'legendary_death')?.name ?? 'Death Mastery',
      meta: [game.i18n.format('SACADIA.Dying.DeathMastery', { n: r.total })] });
    return;
  }
  const wounded = hp < 0;
  if (wounded !== !!actor.statuses?.has('wounded')) await actor.toggleStatusEffect('wounded', { active: wounded });
  const threshold = deathThreshold(actor.system.health?.max ?? 0);
  if (hp <= threshold && (actor.system.health?.max ?? 0) > 0 && !actor.statuses?.has('dead')) {
    await actor.toggleStatusEffect('dead', { active: true, overlay: true });
    await ChatMessage.create({ content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Dying.Dead', { name: actor.name, hp, threshold })}</div>` });
  }
});

// When an encounter ends, clear every combatant's target marks (Layer B) — a mark is a combat focus,
// not a permanent brand. Overwrite-on-re-mark handles the in-combat case; this is just hygiene so a
// stale focus doesn't linger into the next fight. GM-side (the authority that can update all actors).
Hooks.on('deleteCombat', async (combat) => {
  if (game.users.activeGM !== game.user) return;
  // Zones are combat constructs — clear them with the fight.
  for (const r of zonesOf()) await deleteZone(r);
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    const upd = {};
    if (Object.keys(actor.system.marks ?? {}).length) upd['system.marks'] = replaceWith({});
    // Temp HP goes away when combat ends (book p.223).
    if ((actor.system.health?.temp ?? 0) > 0) upd['system.health.temp'] = 0;
    // Unspent pending-attack buffs don't carry between fights.
    if ((actor.system.pendingAttack ?? []).length) upd['system.pendingAttack'] = [];
    // "Once per combat" uses reset when the fight ends.
    if (actor.getFlag('sacadia', 'uses')?.combat) upd['flags.sacadia.uses.combat'] = deleteKey();
    // Limbs exhausted for the rest of the combat (Prone Gutting) recover.
    if (actor.getFlag('sacadia', 'combatExhausted')) upd['flags.sacadia.combatExhausted'] = deleteKey();
    if (Object.keys(upd).length) await actor.update(upd);
  }
  // Ally grants are combat buffs — tear down every anchor + granted effect in the scene (deleting the
  // anchor cascades the grant reap via deleteActiveEffect; we also sweep any strays directly).
  await removeSacadiaEffects((e) => e.flags?.sacadia?.anchor || e.flags?.sacadia?.grantedBy);
});

/* -------------------------------------------- */
/*  Ally grants (granted effects, GM-side)      */
/* -------------------------------------------- */

// Primary cascade: when a Focus anchor is deleted (turn-start teardown, manual removal, or the caster
// being deleted), reap every ally grant that hung off it. Ties grant lifetime directly to the anchor.
Hooks.on('deleteActiveEffect', (effect) => {
  if (game.users.activeGM !== game.user) return;
  const anchor = effect.flags?.sacadia?.anchor;
  if (!anchor) return;
  onAnchorEnded(effect); // the Focus's end effects on its recipients
  const casterUuid = effect.parent?.uuid;
  if (casterUuid) removeSacadiaEffects((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    return gb && gb.casterUuid === casterUuid && gb.ability === anchor.ability;
  });
});

Hooks.on('deleteToken', () => reapOrphanGrants());

// Track token movement into the `moved-feet` auto-counter (see docs/conditional-modifiers.md) while a
// combat is running. `preUpdateToken` still sees the *old* coordinates on the document, so we measure
// the path from there to the incoming position. One GM client mutates, to avoid double-counting.
// Swarm clouds move with their token (Clouded Foe: "all tiles move together"). The mover's client records where the
// token was; the GM's client shifts every cloud carried by it by the same amount once the move lands.
Hooks.on('preUpdateToken', (tokenDoc, changes, options) => {
  if ('x' in changes || 'y' in changes) options.sacadiaFrom = { x: tokenDoc.x, y: tokenDoc.y };
});
Hooks.on('updateToken', async (tokenDoc, changes, options) => {
  if (game.users.activeGM !== game.user || !options.sacadiaFrom) return;
  const dx = (changes.x ?? tokenDoc.x) - options.sacadiaFrom.x;
  const dy = (changes.y ?? tokenDoc.y) - options.sacadiaFrom.y;
  await carryZones(tokenDoc, dx, dy);
  await temperedAuraSweep(); // Tempered Aura: Panic and Taunt drop on entering it
  // Blade Aura: a creature walking into one mid-combat checks then, not only at its turn start.
  if (game.combat?.started) {
    if (tokenDoc.actor) await applyBladeAuraTurnStart(tokenDoc.actor, { entering: true });
    // …and the aura's owner moving onto creatures counts as them entering it.
    for (const t of canvas?.tokens?.placeables ?? []) if (t.actor && t.document !== tokenDoc && t.actor !== tokenDoc.actor) await applyBladeAuraTurnStart(t.actor, { entering: true });
  }
});

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
      if (Object.keys(kept).length !== Object.keys(fr).length) update['system.combatState.focusRounds'] = replaceWith(kept);
      // Moving at all, willingly or not, ends a running Focus's stillness (Greater Glaring's extra dice type a round).
      const still = actor.getFlag('sacadia', 'stillFocus') ?? {};
      for (const [cid, n] of Object.entries(fr)) if (n > 0 && still[cid] && !still[cid].moved) update[`flags.sacadia.stillFocus.${cid}.moved`] = true;
    }
    actor.update(update);
  }
});

/* -------------------------------------------- */
/*  Condition / cover token visibility           */
/* -------------------------------------------- */

// Keep the token icons in step with the tracker: re-sync whenever a condition level or cover changes,
// then repaint the level badges (a level step, e.g. 2→3, changes no icon so the canvas won't refresh
// on its own).
Hooks.on('updateActor', async (actor, changed) => {
  const s = changed.system;
  if (!s || (s.conditions === undefined && s.cover === undefined)) return;
  await syncConditionEffects(actor);
  for (const token of actor.getActiveTokens?.() ?? []) {
    if (token.drawEffects) await token.drawEffects(); // rebuild icon sprites to the current set
    drawConditionLevels(token, true);
  }
});

// Backward path: a status toggled straight from the token HUD writes back to the schema so the
// tracker (and its automation) stay consistent. Guarded so it never fights the forward sync — which
// only toggles when schema and status already disagree — so no ping-pong loop.
Hooks.on('createActiveEffect', (effect) => reflectStatusToSchema(effect, true));
Hooks.on('deleteActiveEffect', (effect) => reflectStatusToSchema(effect, false));

// Backfill icons (and purge stale mirrors) for actors whose levels/cover predate this projection —
// world actors plus any token actors placed on the canvas (unlinked ones aren't in game.actors).
Hooks.once('ready', async () => {
  if (game.users.activeGM !== game.user) return;
  const actors = new Set(game.actors);
  for (const t of canvas.tokens?.placeables ?? []) if (t.actor) actors.add(t.actor);
  for (const actor of actors) await syncConditionEffects(actor);
});

// Choices abilities make when they're taken moved onto their cards in 0.3.6: bring existing characters along (once).
Hooks.once('ready', async () => {
  if (game.users.activeGM !== game.user) return;
  const actors = new Set(game.actors);
  for (const t of canvas.tokens?.placeables ?? []) if (t.actor) actors.add(t.actor);
  for (const actor of actors) {
    try { await migratePicks(actor); } catch (err) { console.error(`Sacadia | moving ${actor.name}'s ability picks`, err); }
  }
  // 0.3.8: the Heritage's HP is added for you, and the Heritage, Ancestry and Culture grant their abilities.
  const moved = [];
  for (const actor of actors) {
    try {
      const hp = await moveHeritageHp(actor);
      if (hp) moved.push(`${actor.name} (${hp})`);
      await reconcileIdentityGrants(actor);
    } catch (err) { console.error(`Sacadia | ${actor.name}'s heritage, ancestry and culture`, err); }
  }
  if (moved.length) ui.notifications.info(game.i18n.format('SACADIA.Origin.HeritageHpMoved', { list: moved.join(', ') }), { permanent: true });
});

// A character made from now on has no Heritage HP typed into its adjustment to take back out (moveHeritageHp).
Hooks.on('preCreateActor', (actor) => {
  if (actor.type === 'character' && !actor.getFlag('sacadia', 'heritageHpMoved')) actor.updateSource({ 'flags.sacadia.heritageHpMoved': true });
});

// Paint the condition level as a number over its token status icon. Core has no native status
// counter, so we overlay text on the canvas — the same approach systems like dnd5e use for
// exhaustion. We deep-search the effects container for the icon sprites and match each to a condition
// by its texture path (v13's `actor.temporaryEffects` is empty for statuses, so draw-order pairing
// fails). All guarded: any failure just logs and leaves the icons intact.
Hooks.on('drawToken', (token) => drawConditionLevels(token, true));
Hooks.on('refreshToken', (token) => drawConditionLevels(token, false));

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
  await resizeMadnessZones(actor);
  const insane = actor.statuses?.has('insane');
  if (m >= 6 && !insane) await goInsane(actor);
  else if (m <= 0 && insane) await endInsane(actor);
});

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

// A character's Heritage, Ancestry and Culture grant their abilities while it has them (rules/identity.mjs). Changes made
// through `setOrigin` (the Character tab) reconcile themselves (`sacadiaOrigin`); anything else is caught here.
// A new Heritage drops the old one's choice (Natural Charisma, Strength of Warp).
Hooks.on('preUpdateActor', (actor, changes) => {
  const heritage = foundry.utils.getProperty(changes, 'system.identity.heritage');
  if (heritage !== undefined && heritage !== actor.system.identity?.heritage && !foundry.utils.hasProperty(changes, 'system.identity.heritageChoice')) {
    foundry.utils.setProperty(changes, 'system.identity.heritageChoice', '');
  }
});
Hooks.on('updateActor', (actor, changes, options, userId) => {
  if (userId !== game.user.id || actor.type !== 'character' || options.sacadiaOrigin) return;
  if (foundry.utils.hasProperty(changes, 'system.identity.heritage') || foundry.utils.hasProperty(changes, 'system.identity.heritageChoice')) queueIdentity(actor);
});
Hooks.on('createItem', (item, options, userId) => {
  if (userId !== game.user.id || options.sacadiaOrigin || item.parent?.type !== 'character') return;
  if (['culture', 'ancestry'].includes(item.type)) adoptOrigin(item);
  else if (item.flags?.sacadia?.grantsSpecialty && !item.flags.sacadia.identityGrant) queueIdentity(item.parent);
});
Hooks.on('updateItem', (item, changes, options, userId) => {
  if (userId !== game.user.id || options.sacadiaOrigin || item.parent?.type !== 'character' || !['culture', 'ancestry'].includes(item.type)) return;
  if (foundry.utils.hasProperty(changes, 'system.choice') || foundry.utils.hasProperty(changes, 'system.grants')) queueIdentity(item.parent);
});
Hooks.on('deleteItem', (item, options, userId) => {
  if (userId !== game.user.id || options.sacadiaOrigin || item.parent?.type !== 'character') return;
  if (['culture', 'ancestry'].includes(item.type) || (item.flags?.sacadia?.grantsSpecialty && !item.flags.sacadia.identityGrant)) queueIdentity(item.parent);
});

// Personal goods (rules/goods.mjs): a light lit, put out, affixed or dropped re-lights the tokens; one rune active at a time.
Hooks.on('updateItem', (item, changes, options, userId) => { if (item.type === 'gear') goodsItemChanged(item, changes, userId); });
Hooks.on('deleteItem', (item, options, userId) => { if (item.type === 'gear') goodsItemChanged(item, null, userId); });

// Surprise "goes away … if they take damage" (book p.258): whichever client lowers a Surprised creature's
// Health also clears the status (it has permission — it just updated the actor).
// Prestige HP-loss rules that rewrite the update (Death Ward, Law of Alliance) and the checks after it (Catnap wakes).
Hooks.on('preUpdateActor', (actor, changes, options) => prestigePreUpdate(actor, changes, options));
// Rend lands on armor pieces (and comes back off on a rest); Corroded turns into Hemorrhage when nothing's left to rend.
Hooks.on('preUpdateActor', (actor, changes, options) => rendPreUpdate(actor, changes, options));
Hooks.on('updateActor', (actor, changes, options, userId) => rendPostUpdate(actor, options, userId));
Hooks.on('updateActor', (actor, changes, options) => {
  prestigePostUpdate(actor, options);
  // Tempered Aura initiated: creatures already inside lose Panic and Taunt.
  if (foundry.utils.hasProperty(changes, 'system.combatState.focusRounds.wt_tempered_aura')) temperedAuraSweep();
});
Hooks.on('preUpdateActor', (actor, changes, options) => {
  // Yarrowstem: "After casting this, if you would drop to 0 madness on your turn or at its end, instead gain
  // madness equal to half your Proficiency (rounded up)." Armed on cast (flag), spent on the first save.
  const mad = foundry.utils.getProperty(changes, 'system.conditions.madness.value');
  if (mad != null && mad <= 0 && (actor.system.conditions?.madness?.value ?? 0) > 0 && actor.getFlag('sacadia', 'yarrowstem')) {
    foundry.utils.setProperty(changes, 'system.conditions.madness.value', Math.ceil((actor.system.proficiency ?? 0) / 2));
    foundry.utils.setProperty(changes, 'flags.sacadia.yarrowstem', deleteKey());
  }
  // A condition dropping to 0 forgets its source and per-instance Enduring (a later application starts fresh).
  for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
    const v = foundry.utils.getProperty(changes, `system.conditions.${key}.value`);
    if (v === 0 && (actor.system.conditions?.[key]?.value ?? 0) > 0) {
      foundry.utils.setProperty(changes, `system.conditions.${key}.enduring`, false);
      foundry.utils.setProperty(changes, `system.conditions.${key}.source`, replaceWith({}));
    }
  }
  const hp = foundry.utils.getProperty(changes, 'system.health.value');
  if (hp != null) options.sacadiaPrevHp = actor.system.health?.value ?? 0;
  if (hp != null && hp < (actor.system.health?.value ?? 0) && actor.statuses?.has('surprised')) options.sacadiaEndSurprise = true;
  // Taking damage reveals a Hidden creature.
  if (hp != null && hp < (actor.system.health?.value ?? 0) && actor.statuses?.has('hidden')) options.sacadiaReveal = true;
});
Hooks.on('updateActor', async (actor, changes, options, userId) => {
  if (userId !== game.user.id) return;
  if (options.sacadiaEndSurprise) await actor.toggleStatusEffect('surprised', { active: false });
  if (options.sacadiaReveal) await revealHidden(actor);
});

// Every character gets the book's basic actions and reactions (Kick, Rend Armor, Help, Block, Dodge, Grab,
// and the four Opportunity Attacks — pp.237–240) as real, rollable abilities. Granted on creation and
// back-filled once for existing characters (GM, on ready). Idempotent by catalogId; tagged
// `flags.sacadia.basicGrant` so a player can still delete one they never use.
Hooks.on('createActor', async (actor, options, userId) => {
  if (userId !== game.user.id || actor.type !== 'character') return;
  await reconcileBasicGrants(actor);
});

Hooks.once('ready', async () => {
  if (game.users.activeGM !== game.user) return;
  for (const actor of game.actors.filter((a) => a.type === 'character')) await reconcileBasicGrants(actor);
  // Owned items the compendium has since changed (helpers/refresh.mjs): tell the GM once, with where to refresh them.
  let n = 0;
  for (const actor of refreshableActors()) if ((await staleItems(actor)).length) n += 1;
  if (n) ui.notifications.info(game.i18n.format('SACADIA.Refresh.ReadyNotice', { n }), { permanent: true });
});

Hooks.on('renderActorDirectory', (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const actions = root?.querySelector('.header-actions');
  if (!actions || actions.querySelector('.sacadia-refresh')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sacadia-refresh';
  button.innerHTML = `<i class="fa-solid fa-rotate"></i> ${game.i18n.localize('SACADIA.Refresh.WorldButton')}`;
  button.addEventListener('click', () => refreshWorldItems());
  actions.append(button);
});

/* -------------------------------------------- */
/*  Weapon → default attack ability              */
/* -------------------------------------------- */

Hooks.on('createItem', async (item, options, userId) => {
  if (userId !== game.user.id || !isWeaponItem(item)) return;
  await grantWeaponAttack(item);
});

Hooks.on('updateItem', async (item, changes, options, userId) => {
  if (userId !== game.user.id || !['gear', 'armor'].includes(item.type) || item.parent?.type !== 'character') return;
  if (options.sacadiaRefresh) return; // a compendium refresh rebuilds the generated attacks itself
  // Named Weapons: at most Proficiency named weapons at a time (warn-but-allow).
  if (foundry.utils.hasProperty(changes, 'flags.sacadia.namedAs') && item.flags?.sacadia?.namedAs) {
    const n = item.parent.items.filter((w) => w.flags?.sacadia?.namedAs).length;
    const max = item.parent.system.proficiency ?? 0;
    if (n > max) ui.notifications.warn(game.i18n.format('SACADIA.Weapon.NamedLimit', { n, max }));
  }
  const typeChanged = foundry.utils.hasProperty(changes, 'system.weaponType');
  const traitsChanged = foundry.utils.hasProperty(changes, 'system.traits');
  if (!typeChanged && !traitsChanged) return;
  // weaponType newly set → grant; cleared → remove the companions. Gaining / losing Versatile adds / removes the throw.
  if (!item.system.weaponType) return removeWeaponAttack(item.parent, item.id);
  if (traitsChanged && !isVersatile(item)) {
    const throws = item.parent.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === item.id && i.getFlag('sacadia', 'thrown')).map((i) => i.id);
    if (throws.length) await item.parent.deleteEmbeddedDocuments('Item', throws);
  }
  await grantWeaponAttack(item);
});

Hooks.on('deleteItem', async (item, options, userId) => {
  if (userId !== game.user.id || !['gear', 'armor'].includes(item.type) || item.parent?.type !== 'character') return;
  await removeWeaponAttack(item.parent, item.id);
});

/* -------------------------------------------- */
/*  GM requests                                  */
/* -------------------------------------------- */

// A card carrying GM requests (an attack to resolve, a grant to place …) is applied by exactly one client, the active
// GM's (rules/requests.mjs resolveRequests).
Hooks.on('createChatMessage', (message) => {
  if (game.users.activeGM !== game.user || !hasGmRequest(message.flags?.sacadia)) return; // one authority resolves + mutates
  resolveRequests(message);
});

// Focus lifetime (helpers/focus.mjs): when an actor's Focus counters change, tear down what hung off any Focus that ended
// (its anchor and the grants it gave, its mark, its zone and cloud layers) — whichever path ended it.
Hooks.on('updateActor', (actor, changes) => {
  if (game.users.activeGM !== game.user || !foundry.utils.hasProperty(changes, 'system.combatState.focusRounds')) return;
  syncFocus(actor).catch((e) => reportError('focus sync', e));
});

Hooks.once('ready', async () => {
  if (game.users.activeGM !== game.user) return;
  if (!game.settings.get('sacadia', 'requestsSince')) await game.settings.set('sacadia', 'requestsSince', Date.now());
  const pending = pendingRequests();
  if (!pending.length) return;
  const list = pending.map((m) => `<li>${foundry.utils.escapeHTML(m.speaker?.alias ?? m.author?.name ?? '')}: ${foundry.utils.escapeHTML(
    (m.flavor || m.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))}</li>`).join('');
  const ok = await sacDialog.confirm({ window: { title: game.i18n.localize('SACADIA.Requests.PendingTitle') }, rejectClose: false,
    content: `<p>${game.i18n.format('SACADIA.Requests.Pending', { n: pending.length })}</p><ul class="refresh-list">${list}</ul>` });
  if (!ok) return;
  for (const m of pending) await resolveRequests(m);
});

/** The player side: a card that needs the GM, posted with no GM connected, says so (at most every 30 seconds). */
let noGmWarned = 0;
Hooks.on('preCreateChatMessage', (message) => {
  if (game.users.activeGM || !hasGmRequest(message.flags?.sacadia)) return;
  if (Date.now() - noGmWarned < 30000) return;
  noGmWarned = Date.now();
  ui.notifications.warn(game.i18n.localize('SACADIA.Requests.NoGm'));
});

// Movement-triggered reaction auto-prompt. When a token finishes a move during combat, surface the
// window to nearby actors that own a `move`-triggered reaction (classified at build) and still have a
// reaction this round — the movement half of the reactions subsystem (Forbidden Trap, Bloodsapper, That
// Sluggish Feeling, Come and Heal, Vaulter, Reposition…). One GM client posts, to avoid duplicates. A
// broad 30ft range (the largest common reaction range) bounds the search; the player judges whether their
// specific reaction's range/direction actually applies, consistent with the attack-prompt philosophy.
Hooks.on('updateToken', (tokenDoc, changes) => {
  if (game.users.activeGM !== game.user) return;
  if (!game.combat?.started) return;
  if (!('x' in changes) && !('y' in changes)) return;
  const mover = tokenDoc.object;
  if (!mover?.actor) return;
  const gs = canvas.grid?.size ?? 100;
  const center = (doc) => ({ x: doc.x + (doc.width * gs) / 2, y: doc.y + (doc.height * gs) / 2 });
  const moverCenter = center(tokenDoc);
  for (const t of canvas.tokens?.placeables ?? []) {
    if (!t?.actor || t.id === mover.id) continue;
    if ((t.actor.system.reaction?.value ?? 0) < 1) continue;
    const reactions = t.actor.items.filter((i) => i.type === 'ability' && i.system?.tag === 'reaction' && i.system?.reactionTrigger === 'move');
    if (!reactions.length) continue;
    const d = canvas.grid?.measurePath?.([center(t.document), moverCenter])?.distance;
    if (d == null || d > 30) continue;
    whisperReactions(t.actor, reactions, game.i18n.format('SACADIA.Reaction.MovePrompt', { mover: tokenDoc.name }));
  }
});

/* -------------------------------------------- */
/*  Chat card interactions                      */
/* -------------------------------------------- */

// Bind chat-card buttons: "Roll Save" (any clicker) and the GM-only apply controls.
Hooks.on('renderChatMessageHTML', (message, html) => {
  // A card the GM's client never applied (posted while no GM was connected): an Apply button, for the GM.
  // (Not on a card just posted: the active GM's client is claiming it.)
  if (game.user.isGM && hasGmRequest(message.flags?.sacadia) && !message.flags.sacadia.handled
    && (message.timestamp ?? 0) >= (game.settings.get('sacadia', 'requestsSince') || Infinity) && Date.now() - (message.timestamp ?? 0) > 10000) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sacadia-apply-request';
    btn.innerHTML = `<i class="fa-solid fa-play"></i> ${game.i18n.localize('SACADIA.Requests.Apply')}`;
    btn.addEventListener('click', () => resolveRequests(message));
    (html.querySelector('.message-content') ?? html).append(btn);
  }
  styleInitiativeMessage(message, html);
  for (const btn of html.querySelectorAll('[data-action="rollSave"]')) {
    btn.addEventListener('click', onSaveRoll);
  }
  for (const btn of html.querySelectorAll('[data-action="mindMap"]')) {
    btn.addEventListener('click', onMindMap);
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
  for (const btn of html.querySelectorAll('[data-action="critSelf"]')) {
    btn.addEventListener('click', onCritSelf);
  }
  for (const btn of html.querySelectorAll('[data-action="postRoll"]')) {
    btn.addEventListener('click', onPostRoll);
  }
  for (const btn of html.querySelectorAll('[data-action="callOfTheDying"]')) {
    btn.addEventListener('click', onCallOfTheDying);
  }
});
