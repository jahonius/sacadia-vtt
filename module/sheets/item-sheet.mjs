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
      createDoc: SacadiaItemSheet.#onCreateDoc,
      viewDoc: SacadiaItemSheet.#onViewDoc,
      deleteDoc: SacadiaItemSheet.#onDeleteDoc,
      toggleEffect: SacadiaItemSheet.#onToggleEffect,
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
      tabs: this.#getTabs(),
    });

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

  /** Create an Active Effect on this item. */
  static async #onCreateDoc(event, target) {
    return this.item.createEmbeddedDocuments('ActiveEffect', [{
      name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize('DOCUMENT.ActiveEffect') }),
      img: 'icons/svg/aura.svg',
      origin: this.item.uuid,
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
