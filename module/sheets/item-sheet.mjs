import { prepareActiveEffectCategories } from '../helpers/effects.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * The Tales of Sacadia item sheet (ApplicationV2 + Handlebars). Generic across item types for now
 * — dedicated per-type parts (ability/armor/gear/specialization) arrive in Phase 4.
 * @extends {ItemSheetV2}
 */
export class SacadiaItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sacadia', 'item'],
    position: { width: 560, height: 520 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      changeTab: SacadiaItemSheet.#onChangeTab,
      createDoc: SacadiaItemSheet.#onCreateDoc,
      viewDoc: SacadiaItemSheet.#onViewDoc,
      deleteDoc: SacadiaItemSheet.#onDeleteDoc,
      toggleEffect: SacadiaItemSheet.#onToggleEffect,
      addActivity: SacadiaItemSheet.#onAddActivity,
      deleteActivity: SacadiaItemSheet.#onDeleteActivity,
      addDamagePart: SacadiaItemSheet.#onAddDamagePart,
      deleteDamagePart: SacadiaItemSheet.#onDeleteDamagePart,
      addInflict: SacadiaItemSheet.#onAddInflict,
      deleteInflict: SacadiaItemSheet.#onDeleteInflict,
      addModifier: SacadiaItemSheet.#onAddModifier,
      deleteModifier: SacadiaItemSheet.#onDeleteModifier,
      addPredicate: SacadiaItemSheet.#onAddPredicate,
      deletePredicate: SacadiaItemSheet.#onDeletePredicate,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: 'systems/sacadia/templates/item/parts/item-header.hbs' },
    tabs: { template: 'systems/sacadia/templates/item/parts/item-tabs.hbs' },
    description: { template: 'systems/sacadia/templates/item/parts/item-description.hbs' },
    attributes: { template: 'systems/sacadia/templates/item/parts/item-attributes.hbs' },
    effects: { template: 'systems/sacadia/templates/item/parts/item-effects.hbs', scrollable: [''] },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: 'description', group: 'primary', icon: 'fa-solid fa-book-open', label: 'SACADIA.Tab.Description' },
        { id: 'attributes', group: 'primary', icon: 'fa-solid fa-list', label: 'SACADIA.Tab.Attributes' },
        { id: 'effects', group: 'primary', icon: 'fa-solid fa-bolt', label: 'SACADIA.Tab.Effects' },
      ],
      initial: 'description',
    },
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;

    Object.assign(context, {
      item,
      system: item.system,
      flags: item.flags,
      config: CONFIG.SACADIA,
      editable: this.isEditable,
      itemTypeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      isAbility: item.type === 'ability',
      isArmor: item.type === 'armor',
      isGear: item.type === 'gear',
      tabs: this.#getTabs(),
    });

    // Precompute per-activity UI flags + indices (templates can't use an `eq` helper).
    if (context.isAbility) {
      context.activities = item.system.activities.map((act, idx) => ({
        ...act,
        idx,
        isAttack: act.type === 'attack',
        isSave: act.type === 'save',
        showDamage: ['attack', 'save', 'damage'].includes(act.type),
        damage: act.damage.map((part, pIdx) => ({ ...part, pIdx })),
        inflict: act.inflict.map((inf, iIdx) => ({ ...inf, iIdx })),
      }));
      // Conditional modifiers editor: index each modifier + its predicate atoms for the template.
      context.modifiers = item.system.modifiers.map((m, idx) => ({
        ...m, idx, predicate: m.predicate.map((p, aIdx) => ({ atom: p.atom, aIdx })),
      }));
      // Target/mode picker options as {value: label} objects — selectOptions keys an ARRAY by index
      // (submitting "0"/"1" instead of the value), so an object is required for the value to persist.
      context.modifierTargets = Object.fromEntries([
        'toHit', 'damage', 'damageDice', 'dieStep', 'advantage.toHit', 'advantage.trait',
        'defense.ad', 'defense.pd', 'defense.td', 'defense.md', 'defense.dr',
      ].map((v) => [v, v]));
      context.modifierModes = { add: 'add', step: 'step' };

      // Weapon binding (only meaningful for an attack ability embedded on an actor). Offer the owner's
      // weapons — gear with a set `weaponType` — as `flags.sacadia.weapon`. Blank = unarmed / no weapon;
      // the cast-time resolver falls back to the first owned weapon when unset (see actor-sheet #useAbility).
      context.hasAttack = item.system.activities.some((a) => a.type === 'attack');
      if (context.hasAttack && item.actor) {
        context.weaponChoices = { '': game.i18n.localize('SACADIA.Weapon.Auto') };
        for (const w of item.actor.items) {
          if (['gear', 'armor'].includes(w.type) && w.system.weaponType) context.weaponChoices[w.id] = w.name;
        }
        context.boundWeapon = item.flags?.sacadia?.weapon ?? '';
      }
    }

    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      item.system.description ?? '',
      { secrets: item.isOwner, rollData: item.getRollData?.() ?? {}, relativeTo: item }
    );

    context.effects = prepareActiveEffectCategories(item.effects);
    return context;
  }

  /** Build tab metadata from static TABS, marking the active tab. */
  #getTabs() {
    const group = 'primary';
    const config = this.constructor.TABS[group];
    this.tabGroups ??= {};
    this.tabGroups[group] ||= config.initial;
    const tabs = {};
    for (const tab of config.tabs) {
      tabs[tab.id] = { ...tab, active: tab.id === this.tabGroups[group], cssClass: tab.id === this.tabGroups[group] ? 'active' : '' };
    }
    return tabs;
  }

  /* -------------------------------------------- */

  /** Switch the active tab. */
  static #onChangeTab(event, target) {
    this.changeTab(target.dataset.tab, target.dataset.group);
  }

  /* -------------------------------------------- */
  /*  Ability activities editor                   */
  /* -------------------------------------------- */

  static async #onAddActivity() {
    const activities = this.item.system.toObject().activities ?? [];
    activities.push({ type: 'attack' });
    return this.item.update({ 'system.activities': activities });
  }

  static async #onDeleteActivity(event, target) {
    const activities = this.item.system.toObject().activities;
    activities.splice(Number(target.dataset.activity), 1);
    return this.item.update({ 'system.activities': activities });
  }

  static async #onAddDamagePart(event, target) {
    const activities = this.item.system.toObject().activities;
    const act = activities[Number(target.dataset.activity)];
    (act.damage ??= []).push({ count: '1', denomination: 6 });
    return this.item.update({ 'system.activities': activities });
  }

  static async #onDeleteDamagePart(event, target) {
    const activities = this.item.system.toObject().activities;
    activities[Number(target.dataset.activity)].damage.splice(Number(target.dataset.part), 1);
    return this.item.update({ 'system.activities': activities });
  }

  static async #onAddInflict(event, target) {
    const activities = this.item.system.toObject().activities;
    const act = activities[Number(target.dataset.activity)];
    (act.inflict ??= []).push({ condition: '', amount: '1' });
    return this.item.update({ 'system.activities': activities });
  }

  static async #onDeleteInflict(event, target) {
    const activities = this.item.system.toObject().activities;
    activities[Number(target.dataset.activity)].inflict.splice(Number(target.dataset.inflict), 1);
    return this.item.update({ 'system.activities': activities });
  }

  /* -------------------------------------------- */
  /*  Conditional-modifier editor                 */
  /*  (see docs/conditional-modifiers.md)         */
  /* -------------------------------------------- */

  static async #onAddModifier() {
    const modifiers = this.item.system.toObject().modifiers ?? [];
    modifiers.push({ label: '', target: 'damage', scope: 'all', mode: 'add', value: '1', predicate: [] });
    return this.item.update({ 'system.modifiers': modifiers });
  }

  static async #onDeleteModifier(event, target) {
    const modifiers = this.item.system.toObject().modifiers;
    modifiers.splice(Number(target.dataset.modifier), 1);
    return this.item.update({ 'system.modifiers': modifiers });
  }

  static async #onAddPredicate(event, target) {
    const modifiers = this.item.system.toObject().modifiers;
    (modifiers[Number(target.dataset.modifier)].predicate ??= []).push({ atom: '' });
    return this.item.update({ 'system.modifiers': modifiers });
  }

  static async #onDeletePredicate(event, target) {
    const modifiers = this.item.system.toObject().modifiers;
    modifiers[Number(target.dataset.modifier)].predicate.splice(Number(target.dataset.predicate), 1);
    return this.item.update({ 'system.modifiers': modifiers });
  }

  /* -------------------------------------------- */

  /** Create an Active Effect on this item. */
  static async #onCreateDoc(event, target) {
    return this.item.createEmbeddedDocuments('ActiveEffect', [{
      name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize('DOCUMENT.ActiveEffect') }),
      img: 'icons/svg/aura.svg',
      origin: this.item.uuid,
      // Transfer to the owning actor so a passive ability's effect applies while owned (Phase 5c).
      transfer: true,
      'duration.rounds': target.dataset.effectType === 'temporary' ? 1 : undefined,
      disabled: target.dataset.effectType === 'inactive',
    }]);
  }

  static async #onViewDoc(event, target) {
    this.item.effects.get(target.closest('[data-effect-id]')?.dataset.effectId)?.sheet.render(true);
  }

  static async #onDeleteDoc(event, target) {
    await this.item.effects.get(target.closest('[data-effect-id]')?.dataset.effectId)?.delete();
  }

  static async #onToggleEffect(event, target) {
    const effect = this.item.effects.get(target.closest('[data-effect-id]')?.dataset.effectId);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }
}
