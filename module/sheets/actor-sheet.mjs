import { prepareActiveEffectCategories } from '../helpers/effects.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The Tales of Sacadia actor sheet (ApplicationV2 + Handlebars). Handles both the `character`
 * and `npc` actor types; parts and tabs are trimmed per type in {@link _configureRenderOptions}.
 * @extends {ActorSheetV2}
 */
export class SacadiaActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sacadia', 'actor'],
    position: { width: 720, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      roll: SacadiaActorSheet.#onRoll,
      conditionStep: SacadiaActorSheet.#onConditionStep,
      createDoc: SacadiaActorSheet.#onCreateDoc,
      viewDoc: SacadiaActorSheet.#onViewDoc,
      deleteDoc: SacadiaActorSheet.#onDeleteDoc,
      toggleEffect: SacadiaActorSheet.#onToggleEffect,
    },
  };

  /** @override */
  static PARTS = {
    header: { template: 'systems/sacadia/templates/actor/parts/actor-header.hbs' },
    tabs: { template: 'systems/sacadia/templates/actor/parts/actor-tabs.hbs' },
    stats: { template: 'systems/sacadia/templates/actor/parts/actor-stats.hbs', scrollable: [''] },
    abilities: { template: 'systems/sacadia/templates/actor/parts/actor-abilities.hbs', scrollable: [''] },
    inventory: { template: 'systems/sacadia/templates/actor/parts/actor-inventory.hbs', scrollable: [''] },
    biography: { template: 'systems/sacadia/templates/actor/parts/actor-biography.hbs' },
    effects: { template: 'systems/sacadia/templates/actor/parts/actor-effects.hbs', scrollable: [''] },
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: 'stats', group: 'primary', icon: 'fa-solid fa-dice-d20', label: 'SACADIA.Tab.Stats' },
        { id: 'abilities', group: 'primary', icon: 'fa-solid fa-hand-fist', label: 'SACADIA.Tab.Abilities' },
        { id: 'inventory', group: 'primary', icon: 'fa-solid fa-box-open', label: 'SACADIA.Tab.Inventory' },
        { id: 'biography', group: 'primary', icon: 'fa-solid fa-book-open', label: 'SACADIA.Tab.Biography' },
        { id: 'effects', group: 'primary', icon: 'fa-solid fa-bolt', label: 'SACADIA.Tab.Effects' },
      ],
      initial: 'stats',
    },
  };

  /* -------------------------------------------- */

  /** Trim which parts (and therefore tabs) render for the lean NPC sheet. @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const parts = ['header', 'tabs', 'stats'];
    if (this.actor.type === 'character') parts.push('abilities', 'inventory');
    parts.push('biography', 'effects');
    options.parts = parts;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    Object.assign(context, {
      actor,
      system: actor.system,
      flags: actor.flags,
      config: CONFIG.SACADIA,
      isCharacter: actor.type === 'character',
      isNpc: actor.type === 'npc',
      editable: this.isEditable,
      // Tab metadata, limited to tabs whose part is actually rendered (the NPC renders a subset).
      tabs: this.#getTabs(options.parts),
    });

    // Grouped talent list for the Stats tab.
    if (context.isCharacter) context.talentGroups = this.#prepareTalentGroups();

    // Enriched biography.
    context.enrichedBiography = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      actor.system.biography,
      { secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: actor }
    );

    // Active effects.
    context.effects = prepareActiveEffectCategories(actor.allApplicableEffects());

    return context;
  }

  /**
   * Build tab metadata from {@link SacadiaActorSheet.TABS}, keeping only tabs whose part is being
   * rendered, and marking the active one. Self-contained so it does not depend on framework
   * internals for populating `context.tabs`; the framework still binds the nav clicks.
   * @param {string[]} parts  The part ids being rendered this pass.
   * @returns {Record<string, object>}
   */
  #getTabs(parts) {
    const group = 'primary';
    const config = this.constructor.TABS[group];
    this.tabGroups ??= {};
    this.tabGroups[group] ||= config.initial;
    const tabs = {};
    for (const tab of config.tabs) {
      if (!parts.includes(tab.id)) continue; // tab's content part isn't rendered
      tabs[tab.id] = { ...tab };
    }
    // Guarantee the active tab is one that actually rendered (matters for the NPC subset).
    if (!tabs[this.tabGroups[group]]) this.tabGroups[group] = Object.keys(tabs)[0];
    for (const [id, tab] of Object.entries(tabs)) {
      tab.active = id === this.tabGroups[group];
      tab.cssClass = tab.active ? 'active' : '';
    }
    return tabs;
  }

  /**
   * Build the 29 talents grouped by CONFIG category, each decorated with its localized label,
   * governing stat, and the actor's proficiency flag — ready for the Stats-tab template.
   * @returns {Record<string, {label: string, talents: object[]}>}
   */
  #prepareTalentGroups() {
    const groups = {};
    for (const [catKey, catLabel] of Object.entries(CONFIG.SACADIA.talentCategories)) {
      groups[catKey] = { label: catLabel, talents: [] };
    }
    for (const [key, talent] of Object.entries(CONFIG.SACADIA.talents)) {
      groups[talent.category]?.talents.push({
        key,
        label: talent.label,
        stat: talent.stat,
        proficient: this.actor.system.talents?.[key]?.proficient ?? false,
      });
    }
    return groups;
  }

  /* -------------------------------------------- */
  /*  Roll actions                                */
  /* -------------------------------------------- */

  /**
   * Handle a stat or talent roll.
   * @this {SacadiaActorSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRoll(event, target) {
    event.preventDefault();
    const { rollType, key } = target.dataset;
    const actor = this.actor;

    if (rollType === 'stat') {
      const mode = await SacadiaActorSheet.#promptAdvantage(game.i18n.localize(CONFIG.SACADIA.stats[key]));
      if (mode === null) return;
      const die = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
      return this.#sendRoll(`${die} + @${key} + @proficiency`, game.i18n.localize(CONFIG.SACADIA.stats[key]));
    }

    if (rollType === 'talent') {
      const talent = CONFIG.SACADIA.talents[key];
      const proficient = actor.system.talents?.[key]?.proficient ?? false;
      // Proficient rolls a straight d20; non-proficient rolls 2d20 keep-lowest (book p.146/225).
      const die = proficient ? '1d20' : '2d20kl1';
      return this.#sendRoll(`${die} + @${talent.stat} + @proficiency`, game.i18n.localize(talent.label));
    }
  }

  /** Post a roll to chat using the actor's roll data. */
  async #sendRoll(formula, flavor) {
    const roll = new Roll(formula, this.actor.getRollData());
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor,
      rollMode: game.settings.get('core', 'rollMode'),
    });
    return roll;
  }

  /**
   * Ask the player for Advantage / Normal / Disadvantage (extra d20 keep best/worst, book p.217).
   * @param {string} label
   * @returns {Promise<'adv'|'dis'|'normal'|null>} chosen mode, or null if dismissed
   */
  static async #promptAdvantage(label) {
    return foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format('SACADIA.Roll.AdvantagePrompt', { label }) },
      content: `<p>${game.i18n.format('SACADIA.Roll.AdvantagePrompt', { label })}</p>`,
      buttons: [
        { action: 'dis', label: game.i18n.localize('SACADIA.Roll.Disadvantage'), icon: 'fa-solid fa-angles-down' },
        { action: 'normal', label: game.i18n.localize('SACADIA.Roll.Normal'), icon: 'fa-solid fa-minus', default: true },
        { action: 'adv', label: game.i18n.localize('SACADIA.Roll.Advantage'), icon: 'fa-solid fa-angles-up' },
      ],
      rejectClose: false,
    });
  }

  /**
   * Step a dice-severity condition track up or down (clamped 0–6).
   * @this {SacadiaActorSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onConditionStep(event, target) {
    const { key, dir } = target.dataset;
    const max = CONFIG.SACADIA.conditionMax;
    const current = this.actor.system.conditions?.[key]?.value ?? 0;
    const next = Math.clamp(current + (dir === 'up' ? 1 : -1), 0, max);
    await this.actor.update({ [`system.conditions.${key}.value`]: next });
  }

  /* -------------------------------------------- */
  /*  Item & effect actions                       */
  /* -------------------------------------------- */

  /** Create an embedded Item or Active Effect (type read from the target's dataset). */
  static async #onCreateDoc(event, target) {
    const { documentClass, type } = target.dataset;
    if (documentClass === 'ActiveEffect') {
      return this.actor.createEmbeddedDocuments('ActiveEffect', [{
        name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize('DOCUMENT.ActiveEffect') }),
        img: 'icons/svg/aura.svg',
        origin: this.actor.uuid,
        'duration.rounds': target.dataset.effectType === 'temporary' ? 1 : undefined,
        disabled: target.dataset.effectType === 'inactive',
      }]);
    }
    return this.actor.createEmbeddedDocuments('Item', [{
      name: game.i18n.format('DOCUMENT.New', { type: game.i18n.localize(`TYPES.Item.${type}`) }),
      type,
    }]);
  }

  /** Open an embedded Item or Active Effect sheet. */
  static async #onViewDoc(event, target) {
    const doc = SacadiaActorSheet.#getEmbedded(this.actor, target);
    doc?.sheet.render(true);
  }

  /** Delete an embedded Item or Active Effect. */
  static async #onDeleteDoc(event, target) {
    const doc = SacadiaActorSheet.#getEmbedded(this.actor, target);
    await doc?.delete();
  }

  /** Toggle an Active Effect's disabled state. */
  static async #onToggleEffect(event, target) {
    const doc = SacadiaActorSheet.#getEmbedded(this.actor, target);
    if (doc) await doc.update({ disabled: !doc.disabled });
  }

  /** Resolve the embedded Item/Effect referenced by the nearest `[data-item-id]`/`[data-effect-id]`. */
  static #getEmbedded(actor, target) {
    const effectRow = target.closest('[data-effect-id]');
    if (effectRow) {
      const parentId = effectRow.dataset.parentId;
      const parent = parentId && parentId !== actor.id ? actor.items.get(parentId) : actor;
      return parent?.effects.get(effectRow.dataset.effectId);
    }
    const itemRow = target.closest('[data-item-id]');
    return itemRow ? actor.items.get(itemRow.dataset.itemId) : null;
  }
}
