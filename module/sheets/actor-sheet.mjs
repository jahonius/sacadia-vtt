import { prepareActiveEffectCategories } from '../helpers/effects.mjs';
import { stepDie, resolveLimbSlots, effectiveApCost, resolveModifierValue, evaluatePredicate } from '../helpers/derivation.mjs';

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/**
 * The Tales of Sacadia actor sheet (ApplicationV2 + Handlebars). Handles both the `character`
 * and `npc` actor types; parts and tabs are trimmed per type in {@link _configureRenderOptions}.
 * @extends {ActorSheetV2}
 */
export class SacadiaActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** Registered [hookName, id] pairs for the live range markers; torn down on close. */
  #rangeHooks = null;

  /**
   * Live token positions by id, seeded from `updateToken` changes. In v14 the token *document*'s
   * `x/y` lags well behind an in-flight move (it commits only as the animation settles), so reading it
   * during a refresh measures a stale position — and the render-driven refresh would clobber the
   * correct value. This map is the fresh source of truth every refresh path reads instead.
   */
  #tokenPos = new Map();

  /** Ability cards whose description drawer is open (item ids). Survives re-renders, not reopens. */
  #expandedAbilities = new Set();

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sacadia', 'actor'],
    position: { width: 720, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      changeTab: SacadiaActorSheet.#onChangeTab,
      roll: SacadiaActorSheet.#onRoll,
      useAbility: SacadiaActorSheet.#onUseAbility,
      toggleExpand: SacadiaActorSheet.#onToggleExpand,
      logBasicAction: SacadiaActorSheet.#onLogBasicAction,
      undoAction: SacadiaActorSheet.#onUndoAction,
      resetTurn: SacadiaActorSheet.#onResetTurn,
      shortRest: SacadiaActorSheet.#onShortRest,
      longRest: SacadiaActorSheet.#onLongRest,
      toggleEquip: SacadiaActorSheet.#onToggleEquip,
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
    const parts = ['header', 'tabs', 'stats', 'abilities'];
    if (this.actor.type === 'character') parts.push('inventory'); // NPCs stay lean (no inventory tab)
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

    // Both actor types get the ability list (attacks) and the leveled-condition tracker (the
    // automation applies to NPCs too, so the GM must be able to see/set it). Talents and inventory
    // are character-only.
    context.abilityGroups = await this.#prepareAbilityGroups();
    context.conditionGroups = this.#prepareConditionGroups();
    context.combatStrip = this.#prepareCombatStrip();

    // Header vitals: HP meter fill, AP pips, and the Madness track (with its insanity threshold).
    const hp = actor.system.health ?? {};
    context.hpPct = hp.max > 0 ? Math.round(Math.min(100, Math.max(0, (hp.value / hp.max) * 100))) : 0;
    if (context.isCharacter) {
      const ap = actor.system.ap ?? {};
      context.apPips = ap.max > 0 && ap.max <= 8
        ? Array.from({ length: ap.max }, (_, i) => ({ on: i < ap.value })) : null;
      context.apText = `${ap.value}/${ap.max}`;
      const madVal = actor.system.conditions?.madness?.value ?? 0;
      context.insane = actor.statuses?.has?.('insane') ?? false;
      // The track earns header space when it's in play: any current Madness, Insane, or an Oracle.
      context.showMadness = madVal > 0 || context.insane
        || ['primary', 'secondary'].some((s) => actor.system.professions?.[s]?.key === 'oracle');
      context.madnessPips = Array.from({ length: 6 }, (_, i) => ({ on: i < madVal, threshold: i === 5 }));
    }
    if (context.isCharacter) {
      context.talentGroups = this.#prepareTalentGroups();
      context.inventory = this.#prepareInventory();
      context.classPools = this.#prepareClassPools();
      // Sentinel's Favored Enemy selector: shown when the character has the Sentinel profession.
      context.isSentinel = ['primary', 'secondary'].some((s) => actor.system.professions?.[s]?.key === 'sentinel');
    }

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

  /**
   * Group the actor's embedded `ability` Items into the four Abilities-tab sub-lists by tag.
   * @returns {Record<string, {label: string, items: Item[]}>}
   */
  async #prepareAbilityGroups() {
    const groups = {
      active: { label: 'SACADIA.AbilityGroup.Active', items: [] },
      passive: { label: 'SACADIA.AbilityGroup.Passive', items: [] },
      reactionsBoosts: { label: 'SACADIA.AbilityGroup.ReactionsBoosts', items: [] },
      lore: { label: 'SACADIA.AbilityGroup.Lore', items: [] },
    };
    for (const item of this.actor.items) {
      if (item.type !== 'ability') continue;
      const tag = item.system.tag;
      const vm = await this.#abilityViewModel(item);
      if (['action', 'focus', 'ceremony'].includes(tag)) groups.active.items.push(vm);
      else if (tag === 'passive') groups.passive.items.push(vm);
      else if (['reaction', 'boost'].includes(tag)) groups.reactionsBoosts.items.push(vm);
      else if (tag === 'lore') groups.lore.items.push(vm);
    }
    return groups;
  }

  /**
   * Build one ability card's view model: cost / madness / range / attack chips, the bound weapon,
   * and (when its drawer is open) the enriched description. Madness badges use the book's own
   * annotation grammar — P:I, P:MX, M+…, M−… — so the sheet reads like the source.
   */
  async #abilityViewModel(item) {
    const sys = item.system;
    const mad = sys.madness ?? {};
    const madBadges = [];
    if (mad.insaneOnly) madBadges.push('P:I');
    if (mad.prereq != null && mad.prereq > 0) madBadges.push(`P:M${mad.prereq}`);
    if (mad.gain) madBadges.push(`M +${mad.gain}`);
    if (mad.spend) madBadges.push(`M −${mad.spend}`);
    const range = sys.range ?? {};
    const rangeText = range.value
      ? `${range.value} ${game.i18n.localize('SACADIA.Range.Feet')}`
      : (range.type ? game.i18n.localize(CONFIG.SACADIA.rangeTypes[range.type] ?? '') : '');
    // First attack activity's target defense → "Attack vs MD"; the bound weapon rides along.
    const atk = (sys.activities ?? []).find((a) => a.type === 'attack');
    const attackText = atk
      ? (atk.attack.defense
        ? `${game.i18n.localize('SACADIA.Activity.Attack')} vs ${game.i18n.localize(`SACADIA.Defense.${atk.attack.defense.toUpperCase()}`)}`
        : game.i18n.localize('SACADIA.Activity.Attack'))
      : '';
    const weapon = atk ? this.#resolveWeapon(item) : null;
    const pool = sys.costs?.pool ?? {};
    const poolText = pool.key && (pool.amount > 0 || pool.variable)
      ? `${pool.amount > 0 ? pool.amount : 'X'} ${game.i18n.localize(CONFIG.SACADIA.pools[pool.key] ?? '')}`
      : '';
    const expanded = this.#expandedAbilities.has(item.id);
    return {
      id: item.id, img: item.img, name: item.name,
      tagLabel: CONFIG.SACADIA.abilityTags[sys.tag] ?? '',
      apCost: sys.isActive ? (sys.costs?.ap ?? 1) : 0,
      cspCost: sys.costs?.csp ?? 0,
      poolText, madBadges, rangeText,
      rangeValue: range.value ?? null,
      attackText, hasSave: sys.hasSave,
      weaponName: weapon?.name ?? '',
      expanded,
      enrichedDescription: expanded
        ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? '',
          { secrets: this.actor.isOwner, rollData: this.actor.getRollData(), relativeTo: item })
        : '',
    };
  }

  /** Toggle an ability card's description drawer open/closed. */
  static #onToggleExpand(event, target) {
    const id = target.closest('[data-item-id]')?.dataset.itemId;
    if (!id) return;
    if (this.#expandedAbilities.has(id)) this.#expandedAbilities.delete(id);
    else this.#expandedAbilities.add(id);
    this.render({ parts: ['abilities'] });
  }

  /**
   * The combat live-state strip (Abilities tab): per-turn counters, focus streaks, marks, exhaustion
   * slots, and grants currently on this actor. Pure surfacing — every value is auto-maintained by the
   * combat hooks; only the exhaustion chips are interactive (they're checkboxes bound to the schema).
   */
  #prepareCombatStrip() {
    const sys = this.actor.system;
    const cs = sys.combatState ?? {};
    // Focus streaks: catalogId → consecutive maintained rounds, labeled by the owned ability.
    const focus = Object.entries(cs.focusRounds ?? {})
      .filter(([, rounds]) => rounds > 0)
      .map(([cid, rounds]) => ({
        name: this.actor.items.find((i) => (i.flags?.sacadia?.catalogId ?? i.id) === cid)?.name ?? cid,
        rounds,
        bars: Array.from({ length: Math.min(rounds, 8) }),
      }));
    // Marks this actor has placed (stored marker-side): mark key → current target names.
    const marks = Object.entries(sys.marks ?? {}).flatMap(([key, uuids]) => {
      const names = (uuids ?? []).map((u) => fromUuidSync(u)?.name).filter(Boolean);
      return names.length ? [{ key, names: names.join(', ') }] : [];
    });
    const exhaustion = Object.entries(CONFIG.SACADIA.exhaustionSlots).map(([key, label]) => ({
      key, label, spent: !!sys.exhaustion?.[key],
    }));
    // Grants currently on this actor (blessings received), with how each expires.
    const grants = [];
    for (const e of this.actor.effects) {
      const gb = e.flags?.sacadia?.grantedBy;
      if (!gb || e.disabled) continue;
      grants.push({
        name: e.name,
        expiry: gb.kind === 'focus'
          ? game.i18n.localize('SACADIA.Combat.Maintained')
          : game.i18n.format('SACADIA.Combat.ConsumedOn', { trigger: gb.on || 'trigger' }),
      });
    }
    return {
      moved: cs.movedFeet ?? 0,
      consecutiveHits: cs.consecutiveHits ?? 0,
      attacks: cs.attacksThisTurn ?? 0,
      focus, marks, exhaustion, grants,
      hasFocus: focus.length > 0 || marks.length > 0,
      hasLive: focus.length > 0 || marks.length > 0 || grants.length > 0
        || (cs.movedFeet ?? 0) > 0 || (cs.consecutiveHits ?? 0) > 0 || (cs.attacksThisTurn ?? 0) > 0,
    };
  }

  /** Group the leveled conditions by CONFIG group for the Stats-tab tracker. */
  #prepareConditionGroups() {
    const groups = {};
    for (const [gk, glabel] of Object.entries(CONFIG.SACADIA.conditionGroups)) {
      groups[gk] = { label: glabel, conditions: [] };
    }
    for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
      groups[cfg.group]?.conditions.push({
        key,
        label: cfg.label,
        rules: cfg.rules,
        auto: (cfg.effects?.length ?? 0) > 0,
        value: this.actor.system.conditions?.[key]?.value ?? 0,
      });
    }
    return groups;
  }

  /** The signature pools to show, drawn from the character's set profession(s). */
  #prepareClassPools() {
    const keys = new Set();
    for (const slot of ['primary', 'secondary']) {
      const p = this.actor.system.professions?.[slot]?.key;
      for (const k of CONFIG.SACADIA.professionPools[p] ?? []) keys.add(k);
    }
    return [...keys].map((key) => ({
      key,
      label: CONFIG.SACADIA.pools[key],
      value: this.actor.system.classPools?.[key]?.value ?? 0,
      max: this.actor.system.classPools?.[key]?.max ?? 0,
    }));
  }

  /** Split the actor's items into the Inventory-tab sections. */
  #prepareInventory() {
    const armor = [];
    const gear = [];
    for (const item of this.actor.items) {
      if (item.type === 'armor') armor.push(item);
      else if (item.type === 'gear') gear.push(item);
    }
    return { armor, gear };
  }

  /* -------------------------------------------- */

  /** Toggle an armor item's equipped state (re-derives defenses). */
  static async #onToggleEquip(event, target) {
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (item) await item.update({ 'system.equipped': !item.system.equipped });
  }

  /** Switch the active tab. Explicit so it works regardless of framework auto-binding. */
  static #onChangeTab(event, target) {
    this.changeTab(target.dataset.tab, target.dataset.group);
  }

  /**
   * Enforce the CSP budget when an `ability` is dropped from outside this actor (drop-time check,
   * per PLANNING). Sorting an already-owned ability is unaffected. @override
   */
  async _onDropItem(event, item) {
    if (this.actor.type === 'character' && item.type === 'ability' && item.parent !== this.actor) {
      const cost = item.system.costs?.csp ?? 0;
      const current = this.actor.system.csp?.current ?? 0;
      if (cost > current) {
        ui.notifications.warn(game.i18n.format('SACADIA.Csp.Insufficient', { name: item.name, cost, current }));
        return false;
      }
    }
    return super._onDropItem(event, item);
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
      const level = await SacadiaActorSheet.#promptAdvantage(game.i18n.localize(CONFIG.SACADIA.stats[key]));
      if (level === null) return;
      const die = this.#d20FromLevel(level, 'trait'); // stat rolls are Trait Checks
      return this.#sendRoll(`${die} + @${key} + @proficiency`, game.i18n.localize(CONFIG.SACADIA.stats[key]));
    }

    if (rollType === 'talent') {
      const talent = CONFIG.SACADIA.talents[key];
      const proficient = actor.system.talents?.[key]?.proficient ?? false;
      const level = await SacadiaActorSheet.#promptAdvantage(game.i18n.localize(talent.label));
      if (level === null) return;
      // Proficient is a straight d20; non-proficient is inherently 1 disadvantage (book p.146/225),
      // folded in on top of the chosen level and the actor's advantage/disadvantage sinks.
      const die = this.#d20FromLevel(level + (proficient ? 0 : -1), 'trait');
      return this.#sendRoll(`${die} + @${talent.stat} + @proficiency`, game.i18n.localize(talent.label));
    }
  }

  /** Net-advantage d20 term: `1d20` at 0, else `(1+|net|)d20kh1/kl1` (positive = advantage). */
  static #d20FromNet(net) {
    if (net === 0) return '1d20';
    return `${1 + Math.abs(net)}d20${net > 0 ? 'kh1' : 'kl1'}`;
  }

  /**
   * Combine the player's chosen advantage level with the actor's advantage/disadvantage sinks
   * (conditions, effects) for a roll type. Any magnitude stacks: net > 0 keeps-highest, < 0 lowest.
   */
  #d20FromLevel(level, rollType) {
    const adv = this.actor.system.advantage?.[rollType] ?? 0;
    const dis = this.actor.system.disadvantage?.[rollType] ?? 0;
    return SacadiaActorSheet.#d20FromNet((level ?? 0) + adv - dis);
  }

  /**
   * Use an embedded ability: run each of its activities and post one chat card (attack rolls,
   * save prompts, damage), or a plain card if it has no activities.
   * @this {SacadiaActorSheet}
   */
  static async #onUseAbility(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (item) return this.#useAbility(item);
  }

  /* -------------------------------------------- */
  /*  Action / limb economy                       */
  /* -------------------------------------------- */

  /**
   * Spend one action's AP + limbs against the turn economy (book pp.236–237): resolve which
   * exhaustion slots the limbs occupy, add +1 AP if an already-exhausted limb is reused (silently —
   * that's the rule, not an error), warn-but-allow when the cost exceeds remaining AP, then deduct
   * AP, mark the newly-exhausted slots, and push a log entry so it can be undone.
   * @param {{label: string, ap: number, limbs: string[]}} action
   * @returns {Promise<boolean>} true if the action was logged, false if the player cancelled.
   */
  async #spendAction({ label, ap, limbs, key = '', choice = '', focusKey = '' }) {
    const sys = this.actor.system;
    const { newlyExhausted, reused } = resolveLimbSlots(limbs, sys.exhaustion ?? {});
    const cost = effectiveApCost(ap, reused);
    const current = sys.ap?.value ?? 0;

    if (cost > current) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize('SACADIA.Economy.OverspendTitle') },
        content: `<p>${game.i18n.format('SACADIA.Economy.OverspendWarn', { label, cost, current })}</p>`,
        rejectClose: false,
      });
      if (!ok) return false;
    }

    // Deduct only what AP is actually available; record that (`spent`) alongside the nominal `cost`
    // so undo refunds exactly what left the pool, not what the action nominally cost.
    const spent = Math.min(cost, current);
    const log = sys.actionLog.map((e) => ({ label: e.label, key: e.key, choice: e.choice, ap: e.ap, spent: e.spent, exhausted: [...e.exhausted] }));
    log.push({ label, key, choice, ap: cost, spent, exhausted: newlyExhausted });
    const update = { 'system.ap.value': current - spent, 'system.actionLog': log };
    for (const slot of newlyExhausted) update[`system.exhaustion.${slot}`] = true;
    // Focus-maintenance streak: on the *first* use of this Focus ability this turn (its key not yet in
    // the log), bump its round count. Turn-start (resetActionEconomy) drops streaks not maintained.
    if (focusKey && !sys.actionLog.some((e) => e.key === focusKey)) {
      const fr = foundry.utils.deepClone(sys.combatState?.focusRounds ?? {});
      fr[focusKey] = (fr[focusKey] ?? 0) + 1;
      update['system.combatState.focusRounds'] = fr;
    }
    await this.actor.update(update);
    return true;
  }

  /**
   * Spend a signature-pool cost (Arrangement/Glory/…). Warn-but-allow when the pool is short (the
   * value floors at 0), matching the AP overspend posture. NPCs have no class pools — skip.
   * @returns {Promise<boolean>} true to proceed, false if the player cancelled.
   */
  async #spendPool(label, { key, amount, variable = false, max = '' }) {
    if (this.actor.type !== 'character') return true;
    const pool = this.actor.system.classPools?.[key];
    if (!pool) return true;
    const poolLabel = game.i18n.localize(CONFIG.SACADIA.pools[key] ?? key);
    // Variable cost ("expend X / any number of …"): prompt for the amount, bounded by the ability's
    // own limit (`max`, e.g. @proficiency) when it has one; the pool value is a soft cap (overspend
    // still warns, matching AP). A blank/0 pick is a no-op spend.
    if (variable) {
      const cap = max ? resolveModifierValue(max, this.actor.system._modifierNumbers?.() ?? {}) : null;
      const chosen = await SacadiaActorSheet.#promptPoolAmount(poolLabel, pool.value, cap);
      if (chosen === null) return false; // cancelled
      amount = cap != null ? Math.min(chosen, cap) : chosen;
    }
    if (amount <= 0) return true;
    if (amount > pool.value) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize('SACADIA.Economy.OverspendTitle') },
        content: `<p>${game.i18n.format('SACADIA.Pool.Insufficient', { label, amount, pool: poolLabel, current: pool.value })}</p>`,
        rejectClose: false,
      });
      if (!ok) return false;
    }
    await this.actor.update({ [`system.classPools.${key}.value`]: Math.max(0, pool.value - amount) });
    return true;
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
    return foundry.applications.api.DialogV2.wait({
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

  /** Log a basic action (Move/Steady/Attack/…) from the tracker's preset palette. */
  static async #onLogBasicAction(event, target) {
    const preset = CONFIG.SACADIA.basicActions[target.dataset.basic];
    if (preset) await this.#spendAction({ label: game.i18n.localize(preset.label), ap: preset.ap, limbs: preset.limbs });
  }

  /**
   * Undo a logged action: refund its AP (clamped to Max) and clear the exact limb slots it set,
   * then drop it from the log. Defaults to the last entry.
   */
  static async #onUndoAction(event, target) {
    const sys = this.actor.system;
    const log = sys.actionLog.map((e) => ({ label: e.label, key: e.key, choice: e.choice, ap: e.ap, spent: e.spent, exhausted: [...e.exhausted] }));
    if (!log.length) return;
    const idx = target.dataset.index != null ? Number(target.dataset.index) : log.length - 1;
    const [entry] = log.splice(idx, 1);
    if (!entry) return;
    const update = {
      // Refund only what was actually deducted (`spent`), so undoing an over-budget action never
      // returns AP that was never spent.
      'system.ap.value': Math.min(sys.ap?.max ?? 0, (sys.ap?.value ?? 0) + entry.spent),
      'system.actionLog': log,
    };
    for (const slot of entry.exhausted) update[`system.exhaustion.${slot}`] = false;
    await this.actor.update(update);
  }

  /** Reset the turn economy manually: AP back to Max, all limbs un-exhausted, log cleared. */
  static async #onResetTurn() {
    await SacadiaActorSheet.resetActionEconomy(this.actor);
  }

  /* -------------------------------------------- */
  /*  Rests (book p.235)                           */
  /* -------------------------------------------- */

  /**
   * Common rest effects (both rest types): recover ability pools to max, remove most leveled
   * conditions, and reduce armor Rend by 1 (Rend isn't fully cleared on a Quick Rest).
   * @returns {object} an update payload to merge
   */
  static #restRecovery(actor) {
    const update = {};
    for (const key of Object.keys(CONFIG.SACADIA.pools)) {
      const p = actor.system.classPools?.[key];
      if (p) update[`system.classPools.${key}.value`] = p.max;
    }
    for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
      if (key === 'rended' || CONFIG.SACADIA.enduringConditions.includes(key)) continue;
      if ((actor.system.conditions?.[key]?.value ?? 0) > 0) update[`system.conditions.${key}.value`] = 0;
    }
    return update;
  }

  /** Quick/Short Rest: pool + condition recovery, Rend −1, and optional HP-pool healing. */
  static async #onShortRest() {
    const actor = this.actor;
    const update = SacadiaActorSheet.#restRecovery(actor);
    const rend = actor.system.conditions?.rended?.value ?? 0;
    if (rend > 0) update['system.conditions.rended.value'] = rend - 1;
    await actor.update(update);
    await SacadiaActorSheet.#promptHealPools(actor);
    SacadiaActorSheet.#restMessage(actor, 'SACADIA.Rest.ShortDone');
  }

  /** Long/Nightly Rest: full HP + HP-pool + Lore refill, all Rend cleared, plus the common recovery. */
  static async #onLongRest() {
    const actor = this.actor;
    const update = SacadiaActorSheet.#restRecovery(actor);
    update['system.health.value'] = actor.system.health.max;
    update['system.healthPools.value'] = actor.system.healthPools.max;
    update['system.lorePoints.value'] = actor.system.lorePoints.max;
    update['system.conditions.rended.value'] = 0;
    await actor.update(update);
    SacadiaActorSheet.#restMessage(actor, 'SACADIA.Rest.LongDone');
  }

  /**
   * Spend HP pools to heal: each pool recovers HP equal to the primary profession's HP/level, capped
   * at Max HP (book p.235). Prompts for how many of the available pools to spend.
   */
  static async #promptHealPools(actor) {
    const available = actor.system.healthPools?.value ?? 0;
    if (available <= 0) return;
    const profKey = actor.system.professions?.primary?.key;
    const perPool = CONFIG.SACADIA.professionHpPerLevel[profKey] ?? 0;
    const spend = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('SACADIA.Rest.HealTitle') },
      content: `<div class="adv-prompt">
        <label>${game.i18n.format('SACADIA.Rest.HealPrompt', { per: perPool, available })}</label>
        <input type="number" name="pools" value="${available}" min="0" max="${available}"/>
      </div>`,
      buttons: [
        { action: 'skip', label: game.i18n.localize('SACADIA.Rest.HealSkip'), callback: () => 0 },
        { action: 'heal', label: game.i18n.localize('SACADIA.Rest.HealDo'), default: true,
          callback: (e, b, d) => Math.round(Number(d.element.querySelector('[name="pools"]')?.value) || 0) },
      ],
      rejectClose: false,
    });
    const n = Math.min(Math.max(0, spend ?? 0), available);
    if (!n) return;
    const healed = Math.min(n * perPool, (actor.system.health.max ?? 0) - (actor.system.health.value ?? 0));
    await actor.update({
      'system.healthPools.value': available - n,
      'system.health.value': (actor.system.health.value ?? 0) + Math.max(0, healed),
    });
  }

  static #restMessage(actor, key) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div class="sacadia"><b>${actor.name}</b> — ${game.i18n.localize(key)}</div>`,
    });
  }

  /**
   * Refresh a character's turn economy (start-of-turn or manual reset): AP to Max, every limb slot
   * cleared, and the action log emptied. Static so the combat hook can call it too.
   * @param {Actor} actor
   */
  static async resetActionEconomy(actor) {
    const update = { 'system.ap.value': actor.system.ap?.max ?? 0, 'system.actionLog': [] };
    for (const slot of Object.keys(CONFIG.SACADIA.exhaustionSlots)) update[`system.exhaustion.${slot}`] = false;
    // Reset the per-turn auto-counters (see docs/conditional-modifiers.md). The consecutive-hit
    // streak is per *turn* ("made consecutively on your turn"), so it clears at turn start too — it's
    // additionally broken mid-turn by a miss (in resolveAttack).
    update['system.combatState.attacksThisTurn'] = 0;
    update['system.combatState.movedFeet'] = 0;
    update['system.combatState.tookDamage'] = false;
    update['system.combatState.consecutiveHits'] = 0;
    // Focus-maintenance streaks: a Focus ability keeps its round count only if it was used on the turn
    // that just ended (its key is still in the not-yet-cleared log); otherwise the streak is broken and
    // drops to 0. The count itself grows on use in #spendAction.
    const usedLastTurn = new Set((actor.system.actionLog ?? []).map((e) => e.key).filter(Boolean));
    const focusRounds = {};
    for (const [cid, r] of Object.entries(actor.system.combatState?.focusRounds ?? {})) {
      if (usedLastTurn.has(cid)) focusRounds[cid] = r;
    }
    update['system.combatState.focusRounds'] = focusRounds;
    // Focus anchors (ally-grant lifecycle, see docs): an anchor whose ability wasn't maintained last
    // turn is torn down — the reap sweep (updateCombat) then deletes its dependent ally grants, and we
    // clear that ability's marks too so "stop maintaining → mark + buff both end" holds. Anchor uses
    // the same `usedLastTurn` maintenance signal as the streaks above.
    const staleAnchors = actor.effects.filter((e) => {
      const a = e.flags?.sacadia?.anchor;
      return a && !usedLastTurn.has(a.ability);
    });
    if (staleAnchors.length) {
      const marks = foundry.utils.deepClone(actor.system.marks ?? {});
      for (const e of staleAnchors) {
        const item = actor.items.find((i) => (i.flags?.sacadia?.catalogId ?? i.id) === e.flags.sacadia.anchor.ability);
        const markKey = item?.system?.mark?.key;
        if (markKey) delete marks[markKey];
      }
      update['system.marks'] = marks;
      await actor.deleteEmbeddedDocuments('ActiveEffect', staleAnchors.map((e) => e.id));
    }
    await actor.update(update);
  }

  /**
   * Resolve an ability's activities into one chat card. Attack activities roll to-hit
   * (`d20 + proficiency + trait`, with a single advantage prompt shared across the ability); save
   * activities embed a "Roll Save" button vs the user's Check DC; damage is structured per part.
   * Global bonuses come from the actor's `system.bonuses` sink (0 until Phase 5 AE populate it).
   */
  async #useAbility(item) {
    // Oracle Madness gates (book p120): P:I (insane-only), P:MX (min Madness), and the insane-time
    // lockout of non-P:I Madness abilities. Checked before any cost is paid so a blocked ability spends
    // nothing. Focus-maintenance re-uses don't re-roll the Madness change (it's an initiate-only cost),
    // so capture whether this is the initiation before #spendAction bumps the focus streak.
    const mcat = item.flags?.sacadia?.catalogId ?? item.id;
    const madInitiating = item.system.tag !== 'focus'
      || (this.actor.system.combatState?.focusRounds?.[mcat] ?? 0) === 0;
    if (!(await this.#checkMadnessPrereq(item))) return;

    // Weapon binding: an attack ability draws its base dice + type gating from the character's bound
    // weapon (flags.sacadia.weapon, auto-resolving to the first equipped/owned weapon). If that weapon
    // isn't equipped, offer to draw it — a 1-AP action — before committing. Declining aborts here, so
    // nothing (not even the ability's own AP) is spent. Resolved before #spendAction for that reason.
    const weapon = this.#resolveWeapon(item);
    if (weapon && !weapon.system.equipped) {
      const draw = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize('SACADIA.Weapon.DrawTitle') },
        content: `<p>${game.i18n.format('SACADIA.Weapon.DrawPrompt', { weapon: weapon.name })}</p>`,
      });
      if (!draw) return; // declined → keep the current (unarmed / other) stance; abort the attack
      const drew = await this.#spendAction({
        label: game.i18n.format('SACADIA.Weapon.DrawAction', { weapon: weapon.name }),
        ap: 1, limbs: [], key: '',
      });
      if (!drew) return;
      await weapon.update({ 'system.equipped': true });
    }

    // Active abilities (Action/Focus/Ceremony) pay the AP/limb economy — same rules for PCs and
    // NPCs (p.237); if the user cancels the over-AP warning, abort before posting the card.
    // Passives/Reactions/Lore are free (p.236).
    if (item.system.isActive) {
      // Per-use choice (e.g. Blessing of the Iron Wall's PD/MD/TD) — prompt before spending so it's
      // recorded in the action log and surfaces as `self:choice:<key>:<value>` this turn.
      let choice = '';
      if (item.system.choice?.options?.length) {
        choice = await SacadiaActorSheet.#promptChoice(item.name, item.system.choice);
        if (choice === null) return; // cancelled
      }
      const spent = await this.#spendAction({
        label: item.name,
        ap: item.system.costs?.ap ?? 1,
        limbs: item.system.costs?.limbs ?? [],
        key: item.flags?.sacadia?.catalogId ?? item.id, // for the `self:used:<key>` roll option
        choice,
        // Focus abilities feed the maintenance-streak counter (`@combat.focusRounds.<id>`); the key
        // matches the `self:used:*` / mark key so ramps and marks reference the same id.
        focusKey: item.system.tag === 'focus' ? (item.flags?.sacadia?.catalogId ?? item.id) : '',
      });
      if (!spent) return;
    }

    // Signature-pool cost (e.g. 1 Arrangement point) — any tag can carry one; warn-but-allow if short.
    const poolCost = item.system.costs?.pool;
    if (poolCost?.key && (poolCost.amount > 0 || poolCost.variable) && !(await this.#spendPool(item.name, poolCost))) return;

    // Out-of-range check (warn-but-allow): numeric range + a targeted token whose distance exceeds it.
    const range = item.system.range;
    if (range?.value != null) {
      const dist = this.#targetDistance();
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

    const rollData = this.actor.getRollData();
    const bonuses = this.actor.system.bonuses ?? {};
    const numbers = this.actor.system._modifierNumbers?.() ?? {}; // flat map for @ref / dice resolution
    const activities = item.system.activities ?? [];
    const rolls = [];
    const cardActivities = [];

    // Phase 8/9 mechanization: extra die-steps this ability gets from owned `modifiesDamage`
    // passives, plus its own `selfScaling` (level-based base-die growth). Both flow into damage.
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
    // Bind this attack's weapon type precisely (it's equipped by now), so gating like Bigger Stones
    // resolves off the weapon actually in hand rather than merely "some weapon is equipped".
    if (weapon?.system.weaponType) fullOptions[`self:wielding:${weapon.system.weaponType}`] = true;
    const targetNotes = []; // target-contextual modifier receipts, deduped for the card

    let advLevel = 0;
    if (activities.some((a) => a.type === 'attack')) {
      advLevel = await SacadiaActorSheet.#promptAdvantage(item.name);
      if (advLevel === null) return; // dismissed
    }

    // First attack activity with a known target defense feeds GM-side hit resolution (Phase 10).
    let attackReq = null;

    for (const act of activities) {
      const entry = { type: act.type, label: act.label };

      const category = act.type === 'attack' ? act.attack.category : '';
      // Target-contextual modifiers for this activity (gated on the targeted token's state).
      const tmod = this.#targetModifiers(fullOptions, numbers, category, catalogId);
      targetNotes.push(...tmod.notes);
      // Flat to-hit/damage bonuses that apply to this activity: the `all` bucket, the category
      // bucket (melee/ranged/magic), this ability's own scoped bonus, and target-contextual flats.
      const flatToHit = (bonuses.toHit?.all ?? 0) + (category ? (bonuses.toHit?.[category] ?? 0) : 0) + abilityToHit + tmod.toHit;
      const flatDamage = (bonuses.damage?.all ?? 0) + (category ? (bonuses.damage?.[category] ?? 0) : 0) + abilityDamage + tmod.damage;
      // Dice-valued conditional damage (Consecutive Threat): global `all` + category buckets + this
      // ability's scoped dice + target-contextual dice. Each is a formula appended (counter-scaled).
      const dd = this.actor.system.damageDiceBonus ?? {};
      const diceBonus = [
        ...(dd.all ?? []), ...(category ? (dd[category] ?? []) : []),
        ...(this.actor.system.abilityDamageDice?.[catalogId] ?? []), ...tmod.dice,
      ].map((d) => ({ label: d.label, formula: SacadiaActorSheet.#resolveDiceLabel(d.formula, numbers) }));

      if (act.type === 'attack') {
        const die = this.#d20FromLevel(advLevel + tmod.advToHit, 'toHit'); // + target-gated advantage
        const traitKey = act.attack.effectiveTrait;
        let f = `${die} + @proficiency`;
        if (traitKey) f += ` + @${traitKey}`;
        if (flatToHit) f += ` + ${flatToHit}`;
        const toHit = await new Roll(f, rollData).evaluate();
        rolls.push(toHit);
        entry.toHit = await toHit.render();
        entry.traitLabel = traitKey ? game.i18n.localize(CONFIG.SACADIA.stats[traitKey]) : null;
        entry.defenseLabel = act.attack.defense
          ? game.i18n.localize(`SACADIA.Defense.${act.attack.defense.toUpperCase()}`) : null;
        if (!attackReq && act.attack.defense) {
          attackReq = { defenseKey: act.attack.defense, toHitTotal: toHit.total, damage: 0, inflict: await this.#rollInflict(act, rollData) };
        }
      }

      if (act.type === 'save') {
        const traitKey = act.save.trait;
        // Pre-compute inflicted-condition levels now (they scale off the *user's* stats); the target
        // applies them to itself on a failed save (see onSaveRoll).
        const inflict = await this.#rollInflict(act, rollData);
        entry.save = {
          dc: act.save.dc ?? this.actor.system.checkDc?.primary ?? 10,
          traitKey,
          traitLabel: traitKey ? game.i18n.localize(CONFIG.SACADIA.stats[traitKey]) : '',
          inflictData: inflict.length ? JSON.stringify(inflict) : '',
        };
      }

      if (['attack', 'save', 'damage'].includes(act.type)) {
        // A weapon attack whose ability defines no base dice of its own rolls the weapon's base dice.
        const weaponPart = (weapon && act.type === 'attack' && weapon.system.weaponDamage?.denomination)
          ? weapon.system.weaponDamage : null;
        const dmg = await this.#rollDamage(act, rollData, bonuses,
          { ...damageOpts, extraSteps: damageOpts.extraSteps + tmod.dieStep, flatDamage, diceBonus, weaponPart });
        if (dmg) {
          rolls.push(dmg);
          entry.damage = await dmg.render();
          if (attackReq && act.type === 'attack' && !attackReq.damage) attackReq.damage = dmg.total;
        }
      }

      cardActivities.push(entry);
    }

    // If this ability makes an attack and the user has targeted tokens, attach a resolution request
    // for the GM client to compute hit/miss against the hidden defense (see the createChatMessage
    // hook). Nothing secret goes here — just the roller's own numbers + the targeted defense key.
    let attackFlag = null;
    if (attackReq) {
      const targetUuids = Array.from(game.user.targets ?? [])
        .map((t) => t.document?.uuid).filter(Boolean);
      if (targetUuids.length) {
        attackFlag = { ...attackReq, attackerUuid: this.actor.uuid, targetUuids };
      }
    }

    // Layer B: if this ability marks a target, record the current target token(s) under the mark key
    // on *our own* actor. Exclusive (default) overwrites the prior set — the "moving mark"; otherwise
    // union with what's there. Written to our own actor, so no GM routing is needed.
    await this.#applyMark(item);

    // Variable resource spend feeding a grant's magnitude (e.g. Blessing of Hot Coal — spend Madness
    // to add die-steps). Prompt + deduct now; the chosen amount flows into the grant as `@spent`.
    // Returns undefined when the ability has no spend block, null if the player cancelled the prompt.
    const spent = await this.#spendGrantResource(item);
    if (spent === null) return; // cancelled the spend prompt

    // Ally grant (see docs — "granted effects"): build a request the GM client applies (anchor on us +
    // effects on the targets). Values are resolved against our numbers now, so the buff is a fixed
    // number on the ally that scaled off the caster at cast time.
    const grantFlag = this.#buildGrant(item, spent == null ? numbers : { ...numbers, spent });

    // Tier-1 disclosure: itemize the conditional modifiers that qualified and affect this card's
    // rolls (global or scoped to this ability), split into to-hit vs damage receipts.
    const isToHit = (t) => t === 'toHit' || t === 'advantage.toHit' || t === 'advantage.trait';
    const isDamage = (t) => ['damage', 'damageDice', 'dieStep'].includes(t);
    const fmt = (m) => {
      if (m.mode === 'dice') return `+${SacadiaActorSheet.#resolveDiceLabel(m.value, numbers)} · ${m.label}`;
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
    const allMods = [...applicable, ...dedupedTarget, ...grantReceipts];
    const toHitMods = allMods.filter((m) => isToHit(m.target)).map(fmt);
    const damageMods = allMods.filter((m) => isDamage(m.target)).map(fmt);

    const content = await foundry.applications.handlebars.renderTemplate(
      'systems/sacadia/templates/chat/ability-card.hbs',
      {
        item,
        tagLabel: game.i18n.localize(CONFIG.SACADIA.abilityTags[item.system.tag]),
        cspCost: item.system.costs?.csp,
        limbs: (item.system.costs?.limbs ?? []).map((l) => game.i18n.localize(CONFIG.SACADIA.limbs[l])),
        activities: cardActivities,
        rangeLabel: SacadiaActorSheet.#rangeLabel(item.system.range),
        toHitMods,
        damageMods,
        description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          item.system.description ?? '', { relativeTo: item, rollData }
        ),
      }
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      rolls,
      rollMode: game.settings.get('core', 'rollMode'),
      flags: (attackFlag || grantFlag)
        ? { sacadia: { ...(attackFlag ? { attack: attackFlag } : {}), ...(grantFlag ? { grant: grantFlag } : {}) } }
        : {},
    });

    // Madness change happens at the end of the action (book p120); crossing 6/0 latches Insanity via the
    // updateActor hook. Focus maintenance doesn't re-roll it (initiate-only). Skipped when Sinewy Sanity
    // already applied it *before* the effect (above).
    if (!sinewyEarly) await this.#applyMadnessChange(item, madInitiating);
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
    return foundry.applications.api.DialogV2.confirm({
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
  async #applyMadnessChange(item, initiating) {
    const md = item.system.madness;
    if (!md || this.actor.type !== 'character' || !initiating) return;
    const cur = this.actor.system.conditions?.madness?.value ?? 0;
    let delta = 0;
    const rolls = [];
    if (md.gain && md.gain !== 'N') { // gain 'N' is trigger-driven (Shared Mind), not on cast
      const r = await this.#rollMadnessAmount(md.gain, cur);
      delta += r.amount; if (r.roll) rolls.push(r.roll);
    }
    // Abilities that spend Madness via a grant's own `spend` block (Blessing of Hot Coal) already
    // deducted it there and used the amount as `@spent` — don't deduct a second time here.
    const grantHandledSpend = item.system.grant?.spend?.resource === 'madness';
    if (md.spend && !grantHandledSpend) {
      const r = await this.#rollMadnessAmount(md.spend, cur);
      delta -= r.amount; if (r.roll) rolls.push(r.roll);
    }
    if (!delta) return;
    const next = Math.max(0, Math.min(6, cur + delta));
    if (next !== cur) await this.actor.update({ 'system.conditions.madness.value': next });
    const label = game.i18n.localize('SACADIA.Condition.Madness');
    const sign = delta >= 0 ? '+' : '−';
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<p><strong>${label}</strong> ${sign}${Math.abs(delta)} → ${next}</p>`,
      rolls,
      rollMode: game.settings.get('core', 'rollMode'),
    });
  }

  /**
   * Resolve one Madness amount formula. `M` → all current Madness; `N` → prompt (capped at current);
   * a dice/number formula → an evaluated Roll. Returns the integer amount and any Roll made (for display).
   * @returns {Promise<{amount: number, roll: Roll|null}>}
   */
  async #rollMadnessAmount(formula, current) {
    if (formula === 'M') return { amount: current, roll: null };
    if (formula === 'N') {
      const chosen = await SacadiaActorSheet.#promptResourceSpend(game.i18n.localize('SACADIA.Condition.Madness'), current, current);
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
  async #rollInflict(activity, rollData) {
    const out = [];
    for (const inf of activity.inflict ?? []) {
      if (!inf.condition) continue;
      const roll = await new Roll(String(inf.amount || '1'), rollData).evaluate();
      const level = Math.max(0, Math.floor(roll.total));
      const cfg = CONFIG.SACADIA.conditions[inf.condition] ?? CONFIG.SACADIA.simpleConditions[inf.condition];
      if (level > 0) out.push({ condition: inf.condition, level, label: game.i18n.localize(cfg?.label ?? inf.condition) });
    }
    return out;
  }

  /**
   * Resolve which of the character's weapons an attack ability uses. Returns the weapon Item, or null
   * for non-attack abilities / characters with no weapons. Binding is `flags.sacadia.weapon` (set via
   * the ability sheet's Weapon dropdown); when unset it auto-resolves to the first *equipped* weapon,
   * else the first owned — the "defaults to the first found" behaviour.
   */
  #resolveWeapon(item) {
    if (!item.system.activities?.some((a) => a.type === 'attack')) return null;
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
   * Build and evaluate one combined damage Roll for an activity's parts (each part adds its own
   * trait, per p.218), plus the global damage bonus. Returns null when there's nothing to roll.
   */
  async #rollDamage(activity, rollData, bonuses, opts = {}) {
    const { extraSteps = 0, selfScaling = null, flatDamage = 0, diceBonus = [], weaponPart = null } = opts;
    const ladder = CONFIG.SACADIA.diceLadder;
    // Global die-step sink (AE buffs) + this ability's own modifiesDamage-driven steps.
    const dieStep = (bonuses.dieStep ?? 0) + extraSteps;
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
        if (selfScaling?.length) {
          const reached = selfScaling.filter((s) => level >= s.level).sort((a, b) => b.level - a.level)[0];
          if (reached) denomination = ladder[reached.ladderIndex]?.die ?? denomination;
        }
        // Apply die-step buffs to the structured (count)d(denomination) at roll time.
        const s = dieStep > 0
          ? stepDie(part.count, denomination, dieStep, ladder)
          : { count: part.count, denomination };
        const count = String(s.count ?? '1').trim() || '1';
        dice = `(${count})d${s.denomination}`;
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
    return new Roll(formula, rollData).evaluate();
  }

  /**
   * Resolve a dice-bonus formula's variable count to a concrete `NdM` for card display — e.g.
   * `(min(@combat.consecutiveHits, @proficiency))d4` → `2d4` — so the receipt shows the actual dice,
   * not the raw formula. Resolves the count expression (parenthesized, or a bare `@ref`) via the
   * modifier-value arithmetic; leaves the die faces and anything else untouched.
   */
  static #resolveDiceLabel(formula, numbers) {
    return String(formula)
      .replace(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)d(\d+)/g, (_m, expr, faces) => `${resolveModifierValue(expr, numbers)}d${faces}`)
      .replace(/(@[\w.]+)d(\d+)/g, (_m, ref, faces) => `${resolveModifierValue(ref, numbers)}d${faces}`);
  }

  /**
   * Build the ally-grant request for an ability (or null). Focus-maintained grants only (first build).
   * Resolves each change's `value` against the caster's numbers now, so the AE placed on the ally is a
   * fixed number that scaled off the caster at cast time. The GM client applies it (see applyGrant).
   * @param {Item} item
   * @param {Record<string,number>} numbers  The caster's `_modifierNumbers()` map.
   * @returns {object|null}
   */
  #buildGrant(item, numbers) {
    const g = item.system.grant;
    const type = g?.duration?.type;
    if (!g?.scope || (type !== 'focus' && type !== 'consumed')) return null;
    const targets = Array.from(game.user.targets ?? []).map((t) => t.document?.uuid).filter(Boolean);
    if (!targets.length) return null;
    const changes = (g.changes ?? [])
      .filter((c) => c.key)
      .map((c) => ({ key: c.key, mode: c.mode ?? 2, value: String(resolveModifierValue(c.value, numbers)) }));
    if (!changes.length) return null;
    return {
      casterUuid: this.actor.uuid,
      ability: item.flags?.sacadia?.catalogId ?? item.id,
      label: g.label || item.name,
      targets, changes,
      duration: { type, on: g.duration.on || '' },
    };
  }

  /**
   * Prompt for and deduct a grant's variable resource spend (e.g. Blessing of Hot Coal — reduce your
   * Madness by up to M). Only fires when the grant will actually land (declares a scope and has a
   * target); the chosen amount becomes `@spent` in the grant's change formulas. The resource is a
   * leveled condition (`system.conditions.<key>.value`); overspend is impossible (cap == available).
   * @param {Item} item
   * @returns {Promise<number|null|undefined>} amount spent, null if cancelled, undefined if no spend.
   */
  async #spendGrantResource(item) {
    const g = item.system.grant;
    const spend = g?.spend;
    if (!spend?.resource || !g.scope) return undefined;
    if (!(game.user.targets?.size)) return undefined; // nothing to grant to — don't burn the resource
    const cond = this.actor.system.conditions?.[spend.resource];
    if (!cond) return undefined;
    const numbers = this.actor.system._modifierNumbers?.() ?? {};
    const cap = spend.max ? resolveModifierValue(spend.max, numbers) : null;
    const label = game.i18n.localize(CONFIG.SACADIA.conditions[spend.resource]?.label ?? spend.resource);
    const chosen = await SacadiaActorSheet.#promptResourceSpend(label, cond.value, cap);
    if (chosen === null) return null; // cancelled
    const amount = cap != null ? Math.min(chosen, cap) : chosen;
    if (amount > 0) {
      await this.actor.update({ [`system.conditions.${spend.resource}.value`]: Math.max(0, cond.value - amount) });
    }
    return amount;
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
    return foundry.applications.api.DialogV2.wait({
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
    const moved = item.system.mark.exclusive && !SacadiaActorSheet.#sameSet(prev, uuids);
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
    // Creature type (Sentinel's Favored Enemy): `target:type:<t>`, plus `target:favored` when the type is
    // in *our* favored list. Character targets have no creature type; only NPC stat blocks carry one.
    const cType = actor.system.creatureType;
    if (cType) {
      o[`target:type:${cType}`] = true;
      if ((this.actor.system.professionResources?.sentinel?.favored ?? []).includes(cType)) o['target:favored'] = true;
    }
    // Adjacency: `target:adjacent` when the target is within 5ft (one square) — the simplest positional
    // gate (Too Close!, etc.), measured from the same grid distance the range markers use.
    const dist = this.#targetDistance();
    if (dist != null && dist <= 5) o['target:adjacent'] = true;
    // Layer B: `target:mark:<key>` when this target token carries one of *our* marks (marks store
    // token uuids; a mark set from a previous scene/combat simply never matches a current target).
    const uuid = token.document?.uuid;
    for (const [key, uuids] of Object.entries(this.actor.system.marks ?? {})) {
      if (Array.isArray(uuids) && uuids.includes(uuid)) o[`target:mark:${key}`] = true;
    }
    return o;
  }

  /**
   * Evaluate the actor's **target-contextual** modifiers (those with a `target:*` atom, excluded
   * from the derived-data fold) against the full roll options, and return their contribution to this
   * activity's roll — flat to-hit/damage, die-steps, dice bonuses, target-gated advantage, plus card
   * receipts. Scope honors global buckets (all/category) or a specific catalogId.
   */
  #targetModifiers(options, numbers, category, catalogId) {
    const out = { toHit: 0, damage: 0, dieStep: 0, advToHit: 0, dice: [], notes: [] };
    const GLOBAL = ['all', 'melee', 'ranged', 'magic'];
    for (const item of this.actor.items) {
      if (item.type !== 'ability') continue;
      for (const mod of item.system?.modifiers ?? []) {
        const atoms = (mod.predicate ?? []).map((p) => p?.atom ?? p).filter(Boolean);
        if (!atoms.some((a) => a.replace(/^!/, '').startsWith('target:'))) continue;
        if (!evaluatePredicate(atoms, options)) continue;
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
  #targetDistance() {
    const attacker = this.actor.getActiveTokens?.()?.[0];
    const target = Array.from(game.user.targets ?? [])[0];
    if (!attacker || !target || !canvas?.grid) return null;
    // Prefer the cached move position over the (v14-laggy) document coords — see #tokenPos. Falls back
    // to the document for tokens that haven't moved since the sheet opened.
    const gs = canvas.grid.size;
    const center = (t) => {
      const p = this.#tokenPos.get(t.id);
      const x = (p?.x ?? t.document.x) + (t.document.width * gs) / 2;
      const y = (p?.y ?? t.document.y) + (t.document.height * gs) / 2;
      return { x, y };
    };
    return canvas.grid.measurePath([center(attacker), center(target)])?.distance ?? null;
  }

  /**
   * Toggle the "Out of Range" marker on each rangeable ability row against the currently-targeted
   * token. No target (or no token/canvas) → distance is null → all markers hidden.
   */
  #refreshRangeMarkers() {
    if (!this.element) return;
    const dist = this.#targetDistance();
    for (const row of this.element.querySelectorAll('.ability-row[data-range]')) {
      const marker = row.querySelector('.out-of-range');
      if (!marker) continue;
      const out = dist != null && dist > Number(row.dataset.range);
      marker.hidden = !out;
      row.classList.toggle('is-out-of-range', out);
    }
  }

  /** @override — refresh range markers each render, and (once) hook target/token changes to keep them live. */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#refreshRangeMarkers();
    if (!this.#rangeHooks) {
      this.#rangeHooks = [
        ['targetToken', Hooks.on('targetToken', () => this.#refreshRangeMarkers())],
        ['updateToken', Hooks.on('updateToken', (doc, ch) => {
          // v14: the fresh coords arrive in `ch` while the document lags — cache them so every refresh
          // path (including a render-driven one) measures the real position, not the stale document.
          if ('x' in ch || 'y' in ch) this.#tokenPos.set(doc.id, { x: ch.x ?? doc.x, y: ch.y ?? doc.y });
          this.#refreshRangeMarkers();
        })],
      ];
    }
  }

  /** @override — tear down the range-marker hooks when the sheet closes. */
  async _onClose(options) {
    await super._onClose(options);
    for (const [name, id] of this.#rangeHooks ?? []) Hooks.off(name, id);
    this.#rangeHooks = null;
    this.#tokenPos.clear();
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
   * Ask the player for a signed Advantage level (book p.217, "NX Advantage" = N extra d20s kept
   * best; negative = Disadvantage). Quick buttons cover ±1; the number field takes any magnitude.
   * @param {string} label
   * @returns {Promise<number|null>} the advantage level (+adv / −dis / 0 normal), or null if dismissed
   */
  static async #promptAdvantage(label) {
    const readLevel = (event, button, dialog) =>
      Math.round(Number(dialog.element.querySelector('[name="level"]')?.value) || 0);
    const customLabel = game.i18n.localize('SACADIA.Roll.AdvantageUse');
    return foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format('SACADIA.Roll.AdvantagePrompt', { label }) },
      content: `<div class="adv-prompt">
        <label>${game.i18n.localize('SACADIA.Roll.AdvantageLevel')}</label>
        <div class="adv-custom-row">
          <input type="number" name="level" value="0" step="1"/>
          <button type="button" class="adv-roll-custom"><i class="fa-solid fa-dice-d20"></i> ${customLabel}</button>
        </div>
        <p class="hint">${game.i18n.localize('SACADIA.Roll.AdvantageHint')}</p>
      </div>`,
      buttons: [
        { action: 'dis', label: game.i18n.localize('SACADIA.Roll.Disadvantage'), icon: 'fa-solid fa-angles-down', callback: () => -1 },
        { action: 'normal', label: game.i18n.localize('SACADIA.Roll.Normal'), icon: 'fa-solid fa-minus', callback: () => 0 },
        { action: 'adv', label: game.i18n.localize('SACADIA.Roll.Advantage'), icon: 'fa-solid fa-angles-up', callback: () => 1 },
        // The custom "Roll" action stays a real footer button (so Enter submits it and it reads the
        // field), but it's hidden and proxied by the in-row button beside the input — see render.
        { action: 'custom', label: customLabel, icon: 'fa-solid fa-dice-d20', default: true, callback: readLevel },
      ],
      render: (event, dialog) => {
        const root = dialog.element;
        const customBtn = root.querySelector('button[data-action="custom"]');
        if (customBtn) customBtn.hidden = true;
        root.querySelector('.adv-roll-custom')?.addEventListener('click', (e) => {
          e.preventDefault();
          customBtn?.click();
        });
        const input = root.querySelector('[name="level"]');
        input?.focus();
        input?.select();
      },
      rejectClose: false,
    });
  }

  /**
   * Prompt the player to pick one of an ability's per-use `choice.options` (e.g. Blessing of the
   * Iron Wall's PD/MD/TD). Each option is a button returning its `value`.
   * @param {string} label   The ability name (for the dialog title).
   * @param {{prompt: string, options: Array<{value: string, label: string}>}} choice
   * @returns {Promise<string|null>} the chosen value, or null if dismissed.
   */
  static async #promptChoice(label, choice) {
    return foundry.applications.api.DialogV2.wait({
      window: { title: label },
      content: choice.prompt ? `<p>${choice.prompt}</p>` : '',
      buttons: choice.options.map((o) => ({ action: o.value, label: o.label || o.value, callback: () => o.value })),
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
