import { prepareActiveEffectCategories } from '../helpers/effects.mjs';
import { blackcloudDisadvantage, witchCheckAura } from '../helpers/auras.mjs';
import { openManual } from '../helpers/manual.mjs';
import { resolveModifierValue, checkPrerequisites } from '../helpers/derivation.mjs';
import { planPool, scorePool, checkContext, foldCheckModifiers } from '../helpers/check-pool.mjs';
import { staleItems, refreshItems } from '../helpers/refresh.mjs';
import { rebuildWeaponAttacks } from '../helpers/weapon-attacks.mjs';
import { resetActionEconomy } from '../rules/turn.mjs';
import { shortRest, longRest } from '../rules/rest.mjs';
import { AbilityUse } from '../rules/ability-use.mjs';
import { promptCheckSpends } from '../helpers/conditions.mjs';
import { gearId, ownsAbility, confirmWarn } from '../helpers/actor-utils.mjs';
import { REND_KEYS } from '../helpers/rend.mjs';

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

  /** This actor's ability pipeline (rules/ability-use.mjs), with the sheet's live token positions. */
  get #use() {
    return new AbilityUse(this.actor, { tokenPos: this.#tokenPos });
  }

  /** Ability cards whose description drawer is open (item ids). Survives re-renders, not reopens. */
  #expandedAbilities = new Set();

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['sacadia', 'actor'],
    position: { width: 720, height: 760 },
    window: {
      resizable: true,
      // The in-system User Manual, one click from any sheet.
      controls: [{ icon: 'fa-solid fa-book', label: 'SACADIA.Manual.Open', action: 'openManual' }],
    },
    form: { submitOnChange: true },
    actions: {
      openManual: () => openManual(),
      refreshItems: SacadiaActorSheet.#onRefreshItems,
      changeTab: SacadiaActorSheet.#onChangeTab,
      roll: SacadiaActorSheet.#onRoll,
      useAbility: SacadiaActorSheet.#onUseAbility,
      toggleBoost: SacadiaActorSheet.#onToggleBoost,
      toggleExpand: SacadiaActorSheet.#onToggleExpand,
      logBasicAction: SacadiaActorSheet.#onLogBasicAction,
      undoAction: SacadiaActorSheet.#onUndoAction,
      resetTurn: SacadiaActorSheet.#onResetTurn,
      shortRest: SacadiaActorSheet.#onShortRest,
      longRest: SacadiaActorSheet.#onLongRest,
      toggleEquip: SacadiaActorSheet.#onToggleEquip,
      toggleStorage: SacadiaActorSheet.#onToggleStorage,
      addSpecialty: SacadiaActorSheet.#onAddSpecialty,
      removeSpecialty: SacadiaActorSheet.#onRemoveSpecialty,
      toggleSignature: SacadiaActorSheet.#onToggleSignature,
      conditionStep: SacadiaActorSheet.#onConditionStep,
      resistCondition: SacadiaActorSheet.#onResistCondition,
      pasteStatBlock: SacadiaActorSheet.#onPasteStatBlock,
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

    // Owned items with a newer compendium version (helpers/refresh.mjs): a notice offers to refresh them.
    const stale = this.isEditable ? await staleItems(actor) : [];
    Object.assign(context, {
      staleItems: stale,
      staleList: stale.map((i) => i.name).join(', '),
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
    // Armed-boost tray: the boosts currently toggled on, ready for the next matching action to consume.
    const armed = new Set(actor.system.armedBoosts ?? []);
    context.armedBoosts = actor.items
      .filter((i) => i.type === 'ability' && armed.has(i.flags?.sacadia?.catalogId))
      .map((i) => ({ id: i.id, name: i.name }));

    // Header vitals: HP meter fill, AP pips, and the Madness track (with its insanity threshold).
    const hp = actor.system.health ?? {};
    context.hpPct = hp.max > 0 ? Math.round(Math.min(100, Math.max(0, (hp.value / hp.max) * 100))) : 0;
    if (context.isCharacter) {
      // Max-HP provenance: standard per-level value + manual bonus = derived max.
      const bonus = hp.bonus ?? 0;
      context.hpTip = [
        `<strong>${game.i18n.localize('SACADIA.Resource.MaxHealth')}</strong>`,
        `${game.i18n.localize('SACADIA.Resource.HealthStandard')} ${hp.standardMax ?? 0}`,
        `${game.i18n.localize('SACADIA.Resource.HealthAdjust')} ${bonus >= 0 ? '+' : ''}${bonus}`,
        `<strong>${game.i18n.localize('SACADIA.Defense.TipTotal')} ${hp.max ?? 0}</strong>`,
      ].join('<br>');
      const ap = actor.system.ap ?? {};
      context.apPips = ap.max > 0 && ap.max <= 8
        ? Array.from({ length: ap.max }, (_, i) => ({ on: i < ap.value })) : null;
      context.apText = `${ap.value}/${ap.max}`;
      // Reaction economy pips (book p.237). Shown as filled/empty dots like AP; a mid-round grant can
      // push value past max, so size the track to the larger of the two.
      const rx = actor.system.reaction ?? {};
      const rxSlots = Math.max(rx.max ?? 1, rx.value ?? 0);
      context.reactionPips = rxSlots > 0 && rxSlots <= 8
        ? Array.from({ length: rxSlots }, (_, i) => ({ on: i < (rx.value ?? 0) })) : null;
      context.reactionText = `${rx.value ?? 0}/${rx.max ?? 1}`;
      const madVal = actor.system.conditions?.madness?.value ?? 0;
      context.insane = actor.statuses?.has?.('insane') ?? false;
      // The track earns header space when it's in play: any current Madness, Insane, or an Oracle.
      context.showMadness = madVal > 0 || context.insane
        || ['primary', 'secondary'].some((s) => actor.system.professions?.[s]?.key === 'oracle');
      context.madnessPips = Array.from({ length: 6 }, (_, i) => ({ on: i < madVal, threshold: i === 5 }));
      context.defTooltips = this.#prepareDefenseTooltips();
    }
    if (context.isCharacter) {
      context.talentGroups = this.#prepareTalentGroups();
      context.talentChoices = Object.fromEntries(Object.entries(CONFIG.SACADIA.talents).map(([k, t]) => [k, t.label]));
      context.traitExpertise = this.#prepareTraitExpertise();
      context.inventory = this.#prepareInventory();
      context.classPools = this.#prepareClassPools();
      // Sentinel's Favored Enemy selector: shown when the character has the Sentinel profession.
      context.isSentinel = ['primary', 'secondary'].some((s) => actor.system.professions?.[s]?.key === 'sentinel');
      context.isHulinari = ['primary', 'secondary'].some((s) => actor.system.professions?.[s]?.key === 'hulinari_warrior');
      context.crackedRolls = actor.system.professionResources?.oracle?.cracked ?? [];
      // Bigger Stones per-weapon die-size picker: shown only when the character owns the ability.
      context.ownsBiggerStones = ownsAbility(actor, 'bigger_stones');
    }

    // (Backstory tab uses plain textareas bound directly to the raw fields — no enrichment needed.)

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
   * The Trait Expertise slots (Stats tab): each is a reroll-one-failed-d20 toggle tied to a specific
   * trait drawn from the *primary* profession (CONFIG.professionTraitExpertise) — Oracle → Wiles/Fate,
   * etc. Most professions grant two; Hulinari Warrior grants one. Empty when no primary profession is
   * set (there are no traits to name), so the template shows a hint instead of anonymous checkboxes.
   * @returns {Array<{slot: string, name: string, statLabel: string, on: boolean}>}
   */
  #prepareTraitExpertise() {
    const primary = this.actor.system.professions?.primary?.key;
    const traits = CONFIG.SACADIA.professionTraitExpertise[primary] ?? [];
    return traits.map((statKey, i) => {
      const slot = `slot${i + 1}`;
      return {
        slot,
        name: `system.traitExpertise.${slot}`,
        statLabel: CONFIG.SACADIA.stats[statKey] ?? statKey,
        on: this.actor.system.traitExpertise?.[slot] ?? false,
      };
    });
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
      // The book's basic actions & reactions (Kick, Block, the Opportunity Attacks …), auto-granted to
      // every character — kept in their own list so they don't crowd the profession abilities.
      basic: { label: 'SACADIA.AbilityGroup.Basic', items: [] },
    };
    for (const item of this.actor.items) {
      if (item.type !== 'ability') continue;
      const tag = item.system.tag;
      const vm = await this.#abilityViewModel(item);
      if (item.flags?.sacadia?.basic) groups.basic.items.push(vm);
      else if (['action', 'focus', 'ceremony'].includes(tag)) groups.active.items.push(vm);
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
    if (mad.spend) madBadges.push(`M −${mad.spend === 'T' ? 'X' : mad.spend}`);
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
    const weapon = atk ? this.#use.resolveWeapon(item) : null;
    const pool = sys.costs?.pool ?? {};
    const poolText = pool.key && (pool.amount > 0 || pool.variable)
      ? `${pool.amount > 0 ? pool.amount : 'X'} ${game.i18n.localize(CONFIG.SACADIA.pools[pool.key] ?? '')}`
      : '';
    const expanded = this.#expandedAbilities.has(item.id);
    // Boost abilities are *armed* (toggled), not rolled: clicking arms/disarms them (see #onUseAbility).
    const isBoost = !!sys.boost?.appliesTo?.kind;
    const armed = isBoost && (this.actor.system.armedBoosts ?? []).includes(item.flags?.sacadia?.catalogId);
    return {
      id: item.id, img: item.img, name: item.name,
      tagLabel: CONFIG.SACADIA.abilityTags[sys.tag] ?? '',
      apCost: sys.isActive ? (sys.costs?.ap ?? 1) : 0,
      cspCost: sys.costs?.csp ?? 0,
      poolText, madBadges, rangeText,
      loreText: (sys.costs?.lore ?? 0) > 0 ? game.i18n.format('SACADIA.Lore.Cost', { n: sys.costs.lore }) : '',
      rangeValue: range.value ?? null,
      attackText, hasSave: sys.hasSave,
      weaponName: weapon?.name ?? '',
      isBoost, armed,
      pick: SacadiaActorSheet.#pickViewModel(item),
      rollTip: this.#abilityRollTip(item, weapon),
      expanded,
      enrichedDescription: expanded
        ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? '',
          { secrets: this.actor.isOwner, rollData: this.actor.getRollData(), relativeTo: item })
        : '',
    };
  }

  /**
   * The permanent-pick select for an ability card (see item-ability `pick`): the choice list for its
   * kind (weapon types / conditions / pools / limbs), narrowed by `options`, and the stored value.
   * @returns {{choices: Record<string,string>, value: string}|null}
   */
  static #pickViewModel(item) {
    const pick = item.system.pick;
    if (!pick?.kind) return null;
    const S = CONFIG.SACADIA;
    // A specific creature (The Vengeance): the creatures on the current scene, plus the one already chosen
    // (kept by name when it's not on this scene).
    if (pick.kind === 'creature') {
      const choices = { '': game.i18n.localize('SACADIA.Pick.Choose') };
      const cur = item.getFlag('sacadia', 'pickValue') ?? '';
      if (cur) choices[cur] = item.getFlag('sacadia', 'pickLabel') || cur;
      for (const t of canvas?.tokens?.placeables ?? []) {
        if (t.actor && t.actor.id !== item.actor?.id) choices[t.actor.id] = t.actor.name;
      }
      return { choices, value: cur };
    }
    const source = {
      weaponType: S.weaponTypes,
      condition: Object.fromEntries(Object.entries(S.conditions).map(([k, c]) => [k, c.label])),
      pool: S.pools,
      limb: S.limbs,
      defense: { pd: 'SACADIA.Defense.PD', md: 'SACADIA.Defense.MD', td: 'SACADIA.Defense.TD' },
      element: Object.fromEntries(S.elements.map((k) => [k, S.damageTypes[k].label])),
    }[pick.kind] ?? {};
    const keys = pick.options?.length ? pick.options.filter((k) => k in source) : Object.keys(source);
    const choices = { '': game.i18n.localize('SACADIA.Pick.Choose') };
    for (const k of keys) choices[k] = game.i18n.localize(source[k]);
    return { choices, value: item.getFlag('sacadia', 'pickValue') ?? '' };
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

  /**
   * Per-defense provenance tooltips (HTML for `data-tooltip-html`): the same derivation
   * `_prepareDefenses` runs — 11 base + governing stat + each equipped armor piece + each Active
   * Effect touching the sink — itemized, so "why is this number that" is answered before the roll.
   * Character sheets only (NPC defenses are hand-authored stat blocks).
   */
  #prepareDefenseTooltips() {
    const sys = this.actor.system;
    const esc = (s) => foundry.utils.escapeHTML(String(s));
    // Tightest Max Stat cap among equipped armor (mirrors _armorContribution).
    const armorItems = this.actor.items.filter((i) => i.type === 'armor' && i.system.equipped);
    let maxStat = null;
    for (const a of armorItems) {
      if (a.system.maxStat != null) maxStat = maxStat == null ? a.system.maxStat : Math.min(maxStat, a.system.maxStat);
    }
    // Active-Effect contributions to the defense sinks, labeled by their effect.
    const effectLines = {};
    for (const e of this.actor.appliedEffects ?? []) {
      if (e.disabled) continue;
      for (const c of e.changes ?? []) {
        const m = /^system\.bonuses\.defense\.(\w+)$/.exec(c.key ?? '');
        if (!m) continue;
        (effectLines[m[1]] ??= []).push({ label: e.name, value: Number(c.value) || 0 });
      }
    }
    const fmt = (v) => `${v >= 0 ? '+' : ''}${v}`;
    const row = (k, v) => `<div class="tip-row"><span class="tip-k">${esc(k)}</span><span class="tip-v">${esc(v)}</span></div>`;
    const tips = {};
    for (const [def, entry] of Object.entries(sys.defenses ?? {})) {
      const rows = [`<div class="tip-title">${esc(entry.label)}</div>`];
      if (def !== 'dr') {
        rows.push(row(game.i18n.localize('SACADIA.Defense.TipBase'), 11));
        const statKey = entry.statKey;
        const raw = sys.stats?.[statKey]?.value ?? 0;
        if (statKey) rows.push(row(game.i18n.localize(CONFIG.SACADIA.stats[statKey] ?? statKey), fmt(raw)));
      }
      for (const a of armorItems) {
        const v = a.system.defenses?.[def] ?? 0;
        if (v) rows.push(row(a.name, fmt(v)));
      }
      for (const el of effectLines[def] ?? []) rows.push(row(el.label, fmt(el.value)));
      if (entry.cappedStat && maxStat != null) {
        rows.push(`<div class="tip-note">${esc(game.i18n.format('SACADIA.Defense.TipCapped', { cap: maxStat }))}</div>`);
      }
      if (entry.supersededByAd) {
        rows.push(`<div class="tip-note">${esc(game.i18n.localize('SACADIA.Defense.TipSuperseded'))}</div>`);
      }
      rows.push(`<div class="tip-row total"><span class="tip-k">${esc(game.i18n.localize('SACADIA.Defense.TipTotal'))}</span><span class="tip-v">${esc(entry.value)}</span></div>`);
      tips[def] = `<div class="sac-tip">${rows.join('')}</div>`;
    }
    return tips;
  }

  /** Group the leveled conditions by CONFIG group for the Stats-tab tracker. */
  #prepareConditionGroups() {
    const groups = {};
    for (const [gk, glabel] of Object.entries(CONFIG.SACADIA.conditionGroups)) {
      groups[gk] = { label: glabel, conditions: [] };
    }
    for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
      const value = this.actor.system.conditions?.[key]?.value ?? 0;
      groups[cfg.group]?.conditions.push({
        key,
        label: cfg.label,
        rules: cfg.rules,
        value,
        tooltip: this.#conditionTooltip(cfg, value),
      });
    }
    return groups;
  }

  /**
   * A condition's hover tooltip (HTML): name + one-line rule, plus — for conditions whose effect
   * changes in *kind* by level (Pinned/Slowed/Panic/Taunt, transcribed from the book's per-level
   * tables pp.259–262 into SACADIA.ConditionLevel) — the level-by-level breakdown, with the actor's
   * current level marked. Linear "X per level" conditions keep just the rule line.
   */
  #conditionTooltip(cfg, value) {
    const esc = (s) => foundry.utils.escapeHTML(String(s));
    const rows = [
      `<div class="tip-title">${esc(game.i18n.localize(cfg.label))}</div>`,
      `<div class="tip-rule">${esc(game.i18n.localize(cfg.rules))}</div>`,
    ];
    const ruleKey = (cfg.rules ?? '').split('.').pop();
    if (ruleKey && game.i18n.has(`SACADIA.ConditionLevel.${ruleKey}.1`)) {
      // Effects cap at 6 even when more levels are stacked (book p.259).
      const current = Math.min(value, 6);
      for (let lv = 1; lv <= 6; lv++) {
        const k = `SACADIA.ConditionLevel.${ruleKey}.${lv}`;
        if (!game.i18n.has(k)) continue;
        const txt = `${lv}${lv === 6 ? '+' : ''} — ${esc(game.i18n.localize(k))}`;
        rows.push(`<div class="tip-level${lv === current ? ' on' : ''}">${lv === current ? '▸ ' : ''}${txt}</div>`);
      }
    }
    return `<div class="sac-tip">${rows.join('')}</div>`;
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
    // One-line weapon summary for any item carrying the weapon facet (weapons; shields' Bash):
    // "Crossbow · 1d4 Piercing vs TD · 120 ft · 2H".
    const weaponSummary = (sys) => {
      if (!sys.weaponType) return '';
      const parts = [game.i18n.localize(CONFIG.SACADIA.weaponTypes[sys.weaponType] ?? sys.weaponType)];
      const wd = sys.weaponDamage ?? {};
      if (wd.denomination) {
        let dmg = `${String(wd.count ?? '1').trim() || '1'}d${wd.denomination}`;
        if (sys.damageType) dmg += ` ${sys.damageType}`;
        if (sys.defense) dmg += ` vs ${game.i18n.localize(`SACADIA.Defense.${sys.defense.toUpperCase()}`)}`;
        parts.push(dmg);
      }
      if (sys.range?.value) parts.push(`${sys.range.value} ${game.i18n.localize('SACADIA.Range.Feet')}`);
      if ((sys.hands ?? 1) >= 2) parts.push('2H');
      return parts.join(' · ');
    };
    for (const item of this.actor.items) {
      const vm = {
        id: item.id, img: item.img, name: item.name, system: item.system,
        weaponSummary: weaponSummary(item.system),
        // Signature (Named / Divine) weapon designation: an instance-scoped flag a Bladedancer or
        // Fatebound sets on a weapon so their named/divine buffs apply to it. Shown as a star toggle.
        isWeapon: !!item.system.weaponType && item.system.weaponType !== 'shield',
        isSignature: !!item.flags?.sacadia?.signature,
      };
      vm.broken = !!item.flags?.sacadia?.broken;
      if (item.type === 'armor') {
        vm.categoryLabel = item.system.category
          ? game.i18n.localize(CONFIG.SACADIA.armorCategories[item.system.category] ?? '') : '';
        // Rend on this piece ("PD −2 · TD −1"), or Broken once every point is gone.
        const r = item.system.rend ?? {};
        const parts = REND_KEYS.filter((k) => (r[k] ?? 0) > 0).map((k) => `${k.toUpperCase()} −${r[k]}`);
        const full = REND_KEYS.some((k) => (item.system.defenses?.[k] ?? 0) > 0)
          && REND_KEYS.every((k) => (r[k] ?? 0) >= (item.system.defenses?.[k] ?? 0));
        vm.rendText = full ? game.i18n.localize('SACADIA.Rend.Broken') : (parts.length ? `${game.i18n.localize('SACADIA.Rend.Rended')} ${parts.join(' · ')}` : '');
        armor.push(vm);
      } else if (item.type === 'gear') gear.push(vm);
    }
    return { armor, gear };
  }

  /* -------------------------------------------- */

  /** Toggle an armor item's equipped state (re-derives defenses). */
  static async #onToggleEquip(event, target) {
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (!item) return;
    // Stored (SIS) items can't be reached in combat (book p.181); out of combat, equipping one readies it.
    if (!item.system.equipped && item.system.storage === 'sis') {
      if (game.combat?.started && !(await confirmWarn(item.name, game.i18n.format('SACADIA.Inventory.StoredInCombat', { name: item.name })))) return;
      return item.update({ 'system.equipped': true, 'system.storage': 'ris' });
    }
    await item.update({ 'system.equipped': !item.system.equipped });
  }

  /**
   * Form rows for the specialized talents arrive as `system.specialties.<i>.<field>` (an object keyed by index); rebuild
   * the array so the ArrayField gets a list. @override
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    const sp = data?.system?.specialties;
    if (sp && !Array.isArray(sp)) {
      data.system.specialties = Object.keys(sp).sort((a, b) => Number(a) - Number(b))
        .map((k) => ({ name: sp[k].name ?? '', talent: sp[k].talent ?? '', rank: Number(sp[k].rank ?? 1) }));
    }
    return data;
  }

  /** Add / remove a specialized talent row. */
  static async #onAddSpecialty() {
    await this.actor.update({ 'system.specialties': [...(this.actor.system.specialties ?? []), { name: '', talent: '', rank: 1 }] });
  }
  static async #onRemoveSpecialty(event, target) {
    const idx = Number(target.closest('[data-index]')?.dataset.index);
    const list = [...(this.actor.system.specialties ?? [])];
    list.splice(idx, 1);
    await this.actor.update({ 'system.specialties': list });
  }

  /** Move an item between a Readied (RIS) and a Stored (SIS) slot — swaps are a rest's business (warn in combat). */
  static async #onToggleStorage(event, target) {
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (!item) return;
    if (game.combat?.started && !(await confirmWarn(item.name, game.i18n.localize('SACADIA.Inventory.SwapInCombat')))) return;
    const toSis = item.system.storage !== 'sis';
    await item.update({ 'system.storage': toSis ? 'sis' : 'ris', ...(toSis ? { 'system.equipped': false } : {}) });
  }

  /**
   * Toggle a weapon's Signature (Named / Divine) designation (`flags.sacadia.signature`). When the
   * attack's bound weapon carries it, `#useAbility` emits `self:attack:named` / `self:attack:divine`,
   * so the Bladedancer's Sharp Weapon and the Fatebound's Humongous/Ridiculous Size/Slamstrike apply to
   * that specific weapon instance. No Proficiency cap is enforced here (a documented simplification).
   */
  static async #onToggleSignature(event, target) {
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (item) await item.setFlag('sacadia', 'signature', !item.flags?.sacadia?.signature);
  }

  /** Switch the active tab. Explicit so it works regardless of framework auto-binding. */
  static #onChangeTab(event, target) {
    this.changeTab(target.dataset.tab, target.dataset.group);
  }

  async _onDropItem(event, item) {
    // Prerequisites (warn-but-allow): "Power 3, Bloodsight", "Handcopy[2]", "Bladedancer, Level 9" …
    if (this.actor.type === 'character' && item.type === 'ability' && item.parent !== this.actor && item.system.meta?.prerequisite) {
      const { unmet } = checkPrerequisites(item.system.meta.prerequisite, await this.#use.prerequisiteContext());
      if (unmet.length) ui.notifications.warn(game.i18n.format('SACADIA.Prereq.Unmet', { name: item.name, list: unmet.join(', ') }));
    }
    // A Magus Tome ability (warn-but-allow): it needs an attuned Tome of its kind that has it recorded.
    if (item.type === 'ability' && item.parent !== this.actor && item.flags?.sacadia?.prestige === 'magus') {
      const tomeKey = item.flags.sacadia.tome;
      if (tomeKey && tomeKey !== 'tome') {
        const tomes = this.actor.items.filter((i) => CONFIG.SACADIA.magusTomes.includes(i.flags?.sacadia?.catalogId));
        const recorded = tomes.some((t) => (t.flags?.sacadia?.researched ?? []).includes(item.flags.sacadia.catalogId));
        if (!tomes.length) ui.notifications.warn(game.i18n.format('SACADIA.Prestige.NoTome', { name: item.name }));
        else if (!recorded) ui.notifications.warn(game.i18n.format('SACADIA.Prestige.NotResearched', { name: item.name }));
      }
    }
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
      const level = await AbilityUse.promptAdvantage(game.i18n.localize(CONFIG.SACADIA.stats[key]));
      if (level === null) return;
      const spend = await promptCheckSpends(actor, { ...(actor.system._rollOptions?.() ?? {}), [`self:checking:trait:${key}`]: true });
      const die = this.#use.d20FromLevel(level + spend.adv, 'trait'); // stat rolls are Trait Checks
      const tb = actor.system.bonuses?.trait ? ' + @traitBonus' : '';
      const sb = spend.bonus ? ` + ${spend.bonus}` : '';
      await this.#sendRoll(`${die} + @${key} + @proficiency${tb}${sb}${await this.#spendFumble()}`, game.i18n.localize(CONFIG.SACADIA.stats[key]));
      return this.#use.consumeRollGrants();
    }

    if (rollType === 'talent') {
      const talent = CONFIG.SACADIA.talents[key];
      const proficient = actor.system.talents?.[key]?.proficient ?? false;
      const level = await AbilityUse.promptAdvantage(game.i18n.localize(talent.label));
      if (level === null) return;
      // Proficient is a straight d20 + Proficiency; without the talent it's 1X disadvantage "and also do not add
      // proficiency" (book p.146), on top of the chosen level and the actor's advantage/disadvantage sinks.
      const die = this.#use.d20FromLevel(level + (proficient ? 0 : -1), 'trait');
      const tb = actor.system.bonuses?.trait ? ' + @traitBonus' : '';
      // Informative Scroll (trinket), named for its talent — "Informative Scroll (History)": "+1 to all checks made with
      // that Talent" while it's in a readied slot.
      const label = game.i18n.localize(talent.label).toLowerCase();
      const scroll = actor.items.some((i) => i.type !== 'ability' && gearId(i).startsWith('informative_scroll') && i.system?.storage !== 'sis'
        && (i.name.match(/\(([^)]+)\)/)?.[1] ?? '').toLowerCase() === label) ? ' + 1' : '';
      await this.#sendRoll(`${die} + @${talent.stat}${proficient ? ' + @proficiency' : ''}${tb}${scroll}${await this.#spendFumble()}`, game.i18n.localize(talent.label));
      return this.#use.consumeRollGrants();
    }

    // A specialized talent: "make a general talent roll, but gain 1X advantage per level of specialization" (p.146).
    if (rollType === 'specialty') {
      const sp = actor.system.specialties?.[Number(key)];
      const talent = CONFIG.SACADIA.talents[sp?.talent];
      if (!sp || !talent) return ui.notifications.warn(game.i18n.localize('SACADIA.Talent.SpecialtyNoTalent'));
      const label = `${game.i18n.localize(talent.label)}: ${sp.name}`;
      if (!(actor.system.talents?.[sp.talent]?.proficient)) ui.notifications.warn(game.i18n.format('SACADIA.Talent.SpecialtyNeedsGeneral', { name: label }));
      const level = await AbilityUse.promptAdvantage(label);
      if (level === null) return;
      const die = this.#use.d20FromLevel(level + (sp.rank ?? 0), 'trait');
      const tb = actor.system.bonuses?.trait ? ' + @traitBonus' : '';
      await this.#sendRoll(`${die} + @${talent.stat} + @proficiency${tb}${await this.#spendFumble()}`, label);
      return this.#use.consumeRollGrants();
    }
  }

  /**
   * Consume this actor's one-shot "next roll" grants (Help: +1 advantage on the ally's next d20). Called
   * right after a d20 roll reads the advantage sinks — attacks, Trait/talent checks, and resist rolls —
   * so the bonus applies exactly once. Owner-side: the roller controls their own actor.
   */
  /**
   * Fumbled (book p.257): the very next d20 roll is reduced by the Fumble count, then Fumble is spent.
   * Returns the formula suffix (` - N`) for this roll and clears the condition, or '' when not Fumbled.
   */
  async #spendFumble() {
    const n = this.actor.system.conditions?.fumbled?.value ?? 0;
    if (n <= 0) return '';
    await this.actor.update({ 'system.conditions.fumbled.value': 0 });
    return ` - ${n}`;
  }

  /**
   * Use an embedded ability: run each of its activities and post one chat card (attack rolls,
   * save prompts, damage), or a plain card if it has no activities.
   * @this {SacadiaActorSheet}
   */
  static async #onUseAbility(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (!item) return;
    // A boost isn't rolled — clicking it arms/disarms it for the next matching action.
    if (item.system.boost?.appliesTo?.kind) return this.#toggleBoost(item);
    return this.#use.useAbility(item);
  }

  /** Arm/disarm a boost ability (toggle its catalogId in `system.armedBoosts`). */
  static async #onToggleBoost(event, target) {
    event.preventDefault();
    const item = this.actor.items.get(target.closest('[data-item-id]')?.dataset.itemId);
    if (item) return this.#toggleBoost(item);
  }

  /** Toggle a boost's armed state. */
  async #toggleBoost(item) {
    const cid = item.flags?.sacadia?.catalogId;
    if (!cid) return;
    const armed = new Set(this.actor.system.armedBoosts ?? []);
    if (armed.has(cid)) armed.delete(cid);
    else {
      // A `once`-per-turn boost can't be re-armed after it's been consumed this turn.
      if (item.system.boost?.once && (this.actor.system.boostsUsed ?? []).includes(cid)) {
        return ui.notifications.warn(game.i18n.format('SACADIA.Boost.AlreadyUsed', { name: item.name }));
      }
      armed.add(cid);
    }
    await this.actor.update({ 'system.armedBoosts': Array.from(armed) });
  }

  /**
   * Public entry point to activate an ability from outside the sheet — e.g. a hotbar macro. Runs the
   * full flow (AP/limb costs, advantage prompt, attack + damage rolls, the rich chat card) and does
   * NOT require the sheet to be open. Prompts surface as their own dialogs.
   * @param {Item} item  An `ability` Item owned by this sheet's actor.
   */
  async useAbility(item) {
    return this.#use.useAbility(item);
  }

  /* -------------------------------------------- */
  /*  Action / limb economy                       */
  /* -------------------------------------------- */

  /**
   * Refresh this actor's out-of-date items from the compendium, after a confirmation naming them. What's the player's
   * (equipped, stored, quantity, rend, picks, named weapons …) is kept; edits made to the items themselves are replaced.
   */
  static async #onRefreshItems() {
    const stale = await staleItems(this.actor);
    if (!stale.length) return this.render();
    const list = stale.map((i) => `<li>${foundry.utils.escapeHTML(i.name)}</li>`).join('');
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize('SACADIA.Refresh.Title') }, rejectClose: false,
      content: `<p>${game.i18n.localize('SACADIA.Refresh.Confirm')}</p><ul class="refresh-list">${list}</ul>` });
    if (!ok) return;
    const n = await refreshItems(this.actor, { items: stale, rebuildWeapon: rebuildWeaponAttacks });
    ui.notifications.info(game.i18n.format('SACADIA.Refresh.Done', { name: this.actor.name, n }));
  }

  /**
   * Spend the actor's per-round reaction (book p.237) when a reaction-tag ability is used. Warn-but-
   * allow when none remain — same posture as AP overspend — so a GM ruling a bonus reaction isn't
   * blocked by the tracker. Floors at 0.
   * @returns {Promise<boolean>} true to proceed, false if the player cancelled the no-reaction warning.
   */
  async #spendReaction(label) {
    if (!(await this.#use.reactionOk(label))) return false;
    await this.#use.payReaction();
    return true;
  }

  /** Log a basic action (Move/Steady/Attack/…) from the tracker's preset palette. */
  static async #onLogBasicAction(event, target) {
    const preset = CONFIG.SACADIA.basicActions[target.dataset.basic];
    // Keyed `basic:<id>` so a turn's basic actions are countable / gateable (`self:used:basic:fiveFootAdjust`,
    // `@combat.basic.fiveFootAdjust` — Glidestep, Whisperglide).
    if (preset) await this.#use.spendAction({ label: game.i18n.localize(preset.label), ap: preset.ap, limbs: preset.limbs, key: `basic:${target.dataset.basic}` });
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

  /** Reset the turn economy manually: AP back to Max, all limbs un-exhausted, log cleared (rules/turn.mjs). */
  static async #onResetTurn() {
    await resetActionEconomy(this.actor);
  }

  /** Quick/Short Rest and Long/Nightly Rest (rules/rest.mjs). */
  static async #onShortRest() {
    await shortRest(this.actor);
  }

  static async #onLongRest() {
    await longRest(this.actor);
  }

  /* -------------------------------------------- */
  /*  Rests (book p.235)                           */
  /* -------------------------------------------- */

  /**
   * Roll-preview tooltip (HTML for `data-tooltip-html`) for an ability's Use button: the to-hit and
   * damage formulas exactly as the chat card will roll them — `@refs` and formula counts folded to
   * concrete numbers (so `ceil(@proficiency/2)d8` reads `1d8`), the target defense, any standing
   * advantage/disadvantage, and the self-scoped conditional modifiers that ride along. Self-only:
   * target-contextual modifiers need a target, so they surface on the card at roll time, not here.
   * @returns {string} tooltip HTML, or '' when the ability makes no roll.
   */
  #abilityRollTip(item, weapon) {
    const sys = item.system;
    const activities = sys.activities ?? [];
    if (!activities.some((a) => ['attack', 'save', 'damage'].includes(a.type))) return '';

    const numbers = this.actor.system._modifierNumbers?.() ?? {};
    const bonuses = this.actor.system.bonuses ?? {};
    const catalogId = item.flags?.sacadia?.catalogId;
    const damageOpts = {
      extraSteps: this.actor.system.abilityDamageSteps?.[catalogId] ?? 0,
      selfScaling: item.flags?.sacadia?.selfScaling ?? null,
      numbers,
    };
    const abilityToHit = this.actor.system.abilityToHit?.[catalogId] ?? 0;
    const abilityDamage = this.actor.system.abilityDamage?.[catalogId] ?? 0;
    const adv = (this.actor.system.advantage?.toHit ?? 0) - (this.actor.system.disadvantage?.toHit ?? 0);

    const esc = (s) => foundry.utils.escapeHTML(String(s));
    // Resolve @refs to their numeric value for display, leaving dice untouched.
    const disp = (f) => esc(String(f).replace(/@([\w.]+)/g, (_, r) => String(Number(numbers[r] ?? 0))));
    const rows = [];

    for (const act of activities) {
      const category = act.type === 'attack' ? act.attack.category : '';
      const flatToHit = (bonuses.toHit?.all ?? 0) + (category ? (bonuses.toHit?.[category] ?? 0) : 0) + abilityToHit;
      const flatDamage = (bonuses.damage?.all ?? 0) + (category ? (bonuses.damage?.[category] ?? 0) : 0) + abilityDamage;
      const dd = this.actor.system.damageDiceBonus ?? {};
      const diceBonus = [
        ...(dd.all ?? []), ...(category ? (dd[category] ?? []) : []),
        ...(this.actor.system.abilityDamageDice?.[catalogId] ?? []),
      ].map((d) => ({ label: d.label, formula: AbilityUse.resolveDiceLabel(d.formula, numbers) }));

      if (act.type === 'attack') {
        const traitKey = act.attack.effectiveTrait;
        let f = AbilityUse.proficientIn(this.actor, act.attack.category) ? 'd20 + @proficiency' : 'd20';
        if (traitKey) f += ` + @${traitKey}`;
        if (flatToHit) f += ` + ${flatToHit}`;
        const vs = act.attack.defense
          ? ` <small>${esc(game.i18n.localize('SACADIA.Card.Vs'))} ${esc(game.i18n.localize(`SACADIA.Defense.${act.attack.defense.toUpperCase()}`))}</small>` : '';
        rows.push(`<div class="tip-row"><span class="tip-k">${esc(game.i18n.localize('SACADIA.Card.ToHit'))}${vs}</span><span class="tip-v">${disp(f)}</span></div>`);
      }

      if (act.type === 'save') {
        const dc = act.save.dc ?? this.actor.system.checkDc?.primary ?? 10;
        const trait = act.save.trait ? ` <small>${esc(game.i18n.localize(CONFIG.SACADIA.stats[act.save.trait]))}</small>` : '';
        rows.push(`<div class="tip-row"><span class="tip-k">${esc(game.i18n.localize('SACADIA.Activity.Save'))}${trait}</span><span class="tip-v">${esc(game.i18n.localize('SACADIA.Defense.CheckDC'))} ${esc(dc)}</span></div>`);
      }

      if (['attack', 'save', 'damage'].includes(act.type)) {
        const weaponPart = (weapon && act.type === 'attack' && weapon.system.weaponDamage?.denomination)
          ? weapon.system.weaponDamage : null;
        const formula = this.#use.buildDamageFormula(act, bonuses, { ...damageOpts, flatDamage, diceBonus, weaponPart });
        if (formula != null) {
          rows.push(`<div class="tip-row"><span class="tip-k">${esc(game.i18n.localize('SACADIA.Card.Damage'))}</span><span class="tip-v">${disp(formula)}</span></div>`);
        }
      }
    }

    if (!rows.length) return '';

    // Standing advantage/disadvantage (the prompt at roll time adds to this).
    if (adv) {
      const kind = game.i18n.localize(adv > 0 ? 'SACADIA.Roll.AdvShort' : 'SACADIA.Roll.DisadvShort');
      rows.push(`<div class="tip-warn">${esc(Math.abs(adv))}× ${esc(kind)}</div>`);
    }

    // Self-scoped conditional modifiers that qualify right now (provenance for the numbers above).
    const applicable = (this.actor.system.activeModifiers ?? [])
      .filter((m) => ['all', 'melee', 'ranged', 'magic'].includes(m.scope) || m.scope === catalogId)
      .filter((m) => ['toHit', 'damage', 'damageDice', 'dieStep', 'advantage.toHit'].includes(m.target));
    if (applicable.length) {
      const fmt = (m) => {
        if (m.mode === 'dice') return `+${AbilityUse.resolveDiceLabel(m.value, numbers)} · ${m.label}`;
        const v = resolveModifierValue(m.value, numbers);
        const step = m.mode === 'step' ? ` ${game.i18n.localize('SACADIA.Roll.Step')}` : '';
        return `${v >= 0 ? '+' : ''}${v}${step} · ${m.label}`;
      };
      rows.push(`<div class="tip-mods"><span class="tip-mods-label">${esc(game.i18n.localize('SACADIA.Roll.Modifiers'))}</span>${
        applicable.map((m) => `<span class="tip-mod">${esc(fmt(m))}</span>`).join('')}</div>`);
    }

    return `<div class="sac-tip sac-rolltip"><div class="tip-title">${esc(game.i18n.localize('SACADIA.Card.Preview'))}</div>${rows.join('')}</div>`;
  }

  /**
   * Toggle the "Out of Range" marker on each rangeable ability row against the currently-targeted
   * token. No target (or no token/canvas) → distance is null → all markers hidden.
   */
  #refreshRangeMarkers() {
    if (!this.element) return;
    const dist = this.#use.targetDistance();
    for (const row of this.element.querySelectorAll('.ability-row[data-range]')) {
      const marker = row.querySelector('.out-of-range');
      if (!marker) continue;
      const out = dist != null && dist > Number(row.dataset.range);
      marker.hidden = !out;
      row.classList.toggle('is-out-of-range', out);
    }
  }

  /**
   * Restore/persist each Backstory prompt box's height, and (attempt to) make it vertically
   * resizable. Height is a per-user UI preference (never a document write, so a non-owner viewer can
   * size their own view), keyed by actor + field in localStorage; saved only on `pointerup` — real
   * user intent — so a programmatic restore or a hidden-tab (zero-height) layout never clobbers it.
   *
   * KNOWN ISSUE (see docs/KNOWN-ISSUES.md): the resize grip doesn't work in play despite the inline
   * `important` below (which should beat Foundry core's `textarea { resize: none }` and its cascade
   * layering). Left in place — persistence is ready for when the grip is fixed. Boxes scroll
   * internally meanwhile, so long entries stay usable.
   */
  #restoreBioSizes() {
    if (!this.element) return;
    for (const el of this.element.querySelectorAll('.bio-input[data-bio-field]')) {
      el.style.setProperty('resize', 'vertical', 'important');
      const key = `sacadia.bioH.${this.actor.id}.${el.dataset.bioField}`;
      const saved = Number(localStorage.getItem(key));
      if (saved >= 40) el.style.height = `${saved}px`;
      el.addEventListener('pointerup', () => {
        const h = Math.round(el.getBoundingClientRect().height);
        if (h >= 40) localStorage.setItem(key, String(h));
      });
    }
  }

  /** @override — refresh range markers each render, and (once) hook target/token changes to keep them live. */
  _onRender(context, options) {
    super._onRender(context, options);
    // Permanent-pick selects write straight to the owned ability's flag (not the actor form).
    for (const sel of this.element.querySelectorAll('select.ability-pick')) {
      sel.addEventListener('change', async (ev) => {
        ev.stopPropagation();
        const item = this.actor.items.get(ev.currentTarget.closest('[data-item-id]')?.dataset.itemId);
        if (item) {
          await item.setFlag('sacadia', 'pickValue', ev.currentTarget.value);
          // A creature pick keeps the name for display when that creature isn't on the scene.
          if (item.system.pick?.kind === 'creature') await item.setFlag('sacadia', 'pickLabel', game.actors.get(ev.currentTarget.value)?.name ?? ev.currentTarget.selectedOptions?.[0]?.text ?? '');
        }
      });
    }
    this.#refreshRangeMarkers();
    this.#restoreBioSizes();
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
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor }); // applies the chat's visibility mode
    return roll;
  }

  static async #pickBoost(boosts) {
    const id = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('SACADIA.Boost.PickTitle') },
      content: `<p>${game.i18n.localize('SACADIA.Boost.PickHint')}</p>`,
      buttons: [
        ...boosts.map((b) => ({ action: b.id, label: b.name, callback: () => b.id })),
        { action: 'none', label: game.i18n.localize('SACADIA.Boost.None'), callback: () => 'none' },
      ],
      rejectClose: false,
    });
    return id && id !== 'none' ? boosts.find((b) => b.id === id) ?? null : null;
  }

  /**
   * Step a dice-severity condition track up or down (clamped 0–6).
   * @this {SacadiaActorSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onConditionStep(event, target) {
    const { key, dir } = target.dataset;
    // Madness is its own 0–6 track; other conditions keep levels past 6 (effects still cap at 6, p.258).
    const max = key === 'madness' ? 6 : CONFIG.SACADIA.conditionStoreMax;
    const current = this.actor.system.conditions?.[key]?.value ?? 0;
    const next = Math.clamp(current + (dir === 'up' ? 1 : -1), 0, max);
    await this.actor.update({ [`system.conditions.${key}.value`]: next });
  }

  /**
   * Roll a condition-resistance check (book p258, "Giving an Adversarial Condition") — distinct from
   * a normal single Make-Trait-Check, which stays untouched. The attacker declares a level; the
   * defender rolls one Trait Check per level and takes one level of the condition for every check that
   * FAILS the attacker's Check DC.
   *
   * The player never enters the DC (they don't know a monster's). Instead the dice pool is rolled
   * here and posted as a card carrying a `flags.sacadia.resist` request; the GM client resolves it
   * (see resolveResist): if the player **targeted the source** creature, its hidden Check DC decides
   * each die and the levels auto-apply; with **no target**, the dice are whispered to the GM to
   * assign failures manually.
   *
   * Advantage handling (house rule): net advantage rolls that many *extra* dice and keeps the highest
   * N (worst dice drop → fewer fails); net disadvantage becomes that many *automatic* failures (the
   * rest are rolled normally). The actor's own `trait` advantage/disadvantage sinks (Frenzy, Panic, …)
   * fold into the net before that split.
   * @this {SacadiaActorSheet}
   */
  static async #onResistCondition(event, target) {
    event.preventDefault();
    const loc = (k) => game.i18n.localize(k);
    // The condition is fixed by which name was clicked in the tracker (data-key). Fall back to the
    // first condition only if invoked without one (defensive — every tracker row supplies a key).
    const condition = target?.dataset?.key ?? Object.keys(CONFIG.SACADIA.conditions)[0];
    const condLabel = loc(CONFIG.SACADIA.conditions[condition]?.label ?? condition);
    const statOpts = Object.entries(CONFIG.SACADIA.stats)
      .map(([k, l]) => `<option value="${k}">${loc(l)}</option>`).join('');
    const held = this.actor.system.conditions?.[condition]?.value ?? 0;

    // The source of the condition = the currently-targeted token (its hidden Check DC is used). Note
    // it up front so the dialog can tell the player which resolution path they're on.
    const srcToken = Array.from(game.user.targets ?? [])[0];
    const srcName = srcToken?.document?.name ?? srcToken?.name ?? null;
    const dcNote = srcName
      ? game.i18n.format('SACADIA.Resist.SourceNote', { name: srcName })
      : loc('SACADIA.Resist.NoSourceNote');

    // Two uses of the same per-level pool (book p.218/238/258):
    //  - Make Trait Check (the action): 1 check (+1 per extra AP, a "consistent" roll); every success
    //    removes one level of a condition you already have.
    //  - Incoming levels: one check per level someone attempts to give you; every failure is a level taken
    //    (for GM-called checks — ability saves roll this automatically from the card).
    const form = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format('SACADIA.Resist.TitleFor', { condition: condLabel }) },
      content: `<div class="resist-prompt">
        <div class="rp-row"><label>${loc('SACADIA.Resist.Mode')}</label><select name="mode">
          <option value="reduce"${held > 0 ? ' selected' : ''}>${loc('SACADIA.Resist.ModeReduce')}</option>
          <option value="incoming"${held > 0 ? '' : ' selected'}>${loc('SACADIA.Resist.ModeIncoming')}</option></select></div>
        <div class="rp-row"><label>${loc('SACADIA.Resist.Trait')}</label><select name="trait">${statOpts}</select></div>
        <div class="rp-row"><label>${loc('SACADIA.Resist.Levels')}</label><input type="number" name="levels" value="1" min="1"/></div>
        <div class="rp-row"><label>${loc('SACADIA.Resist.ExtraAp')}</label><input type="number" name="extra" value="0" min="0"/></div>
        <div class="rp-row"><label>${loc('SACADIA.Resist.Advantage')}</label><input type="number" name="adv" value="0" step="1"/></div>
        <p class="source-note">${dcNote}</p>
        <p class="hint">${loc('SACADIA.Resist.Hint')}</p>
      </div>`,
      buttons: [{
        action: 'roll', label: loc('SACADIA.Resist.Roll'), icon: 'fa-solid fa-dice-d20', default: true,
        callback: (e, b, dialog) => {
          const el = dialog.element;
          const num = (n, d) => { const v = Number(el.querySelector(`[name="${n}"]`)?.value); return Number.isFinite(v) ? v : d; };
          return {
            condition,
            mode: el.querySelector('[name="mode"]')?.value === 'reduce' ? 'reduce' : 'incoming',
            trait: el.querySelector('[name="trait"]')?.value,
            levels: Math.max(1, Math.round(num('levels', 1))),
            extra: Math.max(0, Math.round(num('extra', 0))),
            adv: Math.round(num('adv', 0)),
          };
        },
      }],
      rejectClose: false,
    });
    if (!form) return;
    const reduce = form.mode === 'reduce';

    // Make Trait Check is an action: 1 AP, plus any extra AP spent to roll it consistently.
    if (reduce) {
      const spent = await this.#use.spendAction({ label: loc('SACADIA.BasicAction.MakeTraitCheck'), ap: 1 + form.extra, limbs: [], key: 'makeTraitCheck' });
      if (!spent) return;
    }
    // Bolers Ban: a Make Trait Check against the picked (Drain Tolerant) condition doesn't roll — it simply
    // removes one level.
    if (reduce && (this.actor.system._picks?.().condition ?? []).some((pk) => pk.id === 'bolers_ban' && pk.value === form.condition)) {
      const next = Math.max(0, held - 1);
      await this.actor.update({ [`system.conditions.${form.condition}.value`]: next });
      return AbilityUse.postCard({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<div class="sacadia resist-card"><div class="rc-head"><i class="fa-solid fa-hand-fist"></i> ${game.i18n.format('SACADIA.Resist.CardTitleReduce', { condition: condLabel })}</div>`
          + `<div class="rc-sub">${game.i18n.format('SACADIA.Resist.BolersBan', { condition: condLabel, value: next })}</div></div>`,
      });
    }
    const L = reduce ? 1 + form.extra : form.levels;

    // The checker's own modifiers for *this* check (see helpers/check-pool.mjs): `self:checking:*` for any
    // check against the condition, `self:resisting:*` for the Make Trait Check action, `self:saving:*` for
    // incoming levels — plus Aware Foe's "a condition given to you by a targeted foe".
    const grp = CONFIG.SACADIA.conditions[form.condition]?.group ?? '';
    const selfOpts = this.actor.system._rollOptions?.() ?? {};
    const ctxOpts = { ...selfOpts, ...checkContext(form.condition, grp, reduce ? 'resist' : 'save', this.actor.system._picks?.().condition ?? []),
      [`self:checking:trait:${form.trait}`]: true };
    const srcUuid = srcToken?.document?.uuid;
    if (srcUuid && (this.actor.system.marks?.['targeted-foe'] ?? []).includes(srcUuid)) ctxOpts['self:resisting:from:targeted-foe'] = true;
    const items = this.actor.items.filter((i) => i.type === 'ability').map((i) => ({ name: i.name, modifiers: i.system.modifiers, id: i.flags?.sacadia?.catalogId, pickValue: i.system.pick?.kind ? (i.flags?.sacadia?.pickValue ?? '') : undefined }));
    const own = foldCheckModifiers(items, ctxOpts, this.actor.system._modifierNumbers?.() ?? {});
    const spend = await promptCheckSpends(this.actor, ctxOpts);
    const proneDis = selfOpts['self:prone'] && /physical/i.test(grp) ? 1 : 0;

    const rollData = this.actor.getRollData();
    const mod = (Number(rollData[form.trait]) || 0) + (Number(rollData.proficiency) || 0) + (Number(rollData.traitBonus) || 0) + own.bonus + spend.bonus;
    const cloudDis = blackcloudDisadvantage(this.actor, grp);
    const witchAura = witchCheckAura(this.actor);
    const net = form.adv + own.adv + spend.adv - proneDis - cloudDis + witchAura + (this.actor.system.advantage?.trait ?? 0) - (this.actor.system.disadvantage?.trait ?? 0);
    const { poolCount, autoFail } = planPool(L, net);
    const fumble = this.actor.system.conditions?.fumbled?.value ?? 0;

    let roll = null;
    let raws = [];
    if (poolCount > 0) {
      roll = await new Roll(`${poolCount}d20`).evaluate();
      raws = roll.dice[0].results.map((r) => r.result);
    }
    await this.#use.consumeRollGrants();
    if (fumble > 0) await this.actor.update({ 'system.conditions.fumbled.value': 0 });
    // Totals that count (the kept dice) — the GM compares them to the hidden DC; pass/fail isn't decided here.
    const guided = this.actor.system.bonuses?.traitBonusOne ?? 0;
    const sc = scorePool(raws, { levels: L, net, mod, fumble, bonusOne: (spend.bonusOne ?? 0) + guided });
    if (guided) await this.#use.consumeRollGrants();
    const keptTotals = sc.keptTotals;

    // --- chat card (dice shown; the outcome slot is filled GM-side) ---
    const traitLabel = loc(CONFIG.SACADIA.stats[form.trait]);
    const netNote = net > 0 ? ` · +${net} ${loc('SACADIA.Roll.Advantage')}`
      : net < 0 ? ` · ${-net} ${loc('SACADIA.Roll.Disadvantage')}` : '';
    const notes = [...own.notes, ...spend.notes, ...(proneDis ? [loc('SACADIA.Simple.Prone')] : []), ...(cloudDis ? ['Blackcloud'] : []), ...(fumble ? [`${loc('SACADIA.Condition.Fumbled')} −${fumble}`] : [])];
    const content = AbilityUse.checkCardHtml({ icon: 'fa-solid fa-hand-fist', entries: sc.entries, autoFail, notes,
      title: game.i18n.format(reduce ? 'SACADIA.Resist.CardTitleReduce' : 'SACADIA.Resist.CardTitle', { condition: condLabel }),
      sub: `${traitLabel} ${loc('SACADIA.Resist.Check')} · ${L} ${loc(reduce ? 'SACADIA.Resist.ChecksShort' : 'SACADIA.Resist.LevelsShort')}${netNote}`,
      mods: sc.entries.map((e, i) => mod - (i === 0 ? fumble : 0)), dropLabel: true });

    await AbilityUse.postCard({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content,
      rolls: roll ? [roll] : [],
      sound: CONFIG.sounds.dice,
      flags: { sacadia: { resist: {
        resisterUuid: this.actor.uuid,
        sourceUuid: srcUuid ?? null,
        condition: form.condition,
        mode: form.mode,
        keptTotals,
        autoFail,
      } } },
    });
  }

  /* -------------------------------------------- */
  /*  NPC quick-build                             */
  /* -------------------------------------------- */

  /**
   * Paste-a-stat-block importer (NPC only): a GM pastes a monster's stats + ability list, and this
   * fills the NPC's defenses / HP / AP / Check DC / CR and creates a simple `ability` Item per listed
   * entry — instead of hand-building each on a blank sheet. Freeform-tolerant (see #parseStatBlock).
   * @this {SacadiaActorSheet}
   */
  static async #onPasteStatBlock(event, target) {
    event.preventDefault();
    const loc = (k) => game.i18n.localize(k);
    // The full format reference lives in its own template (also in docs/STATBLOCK-FORMAT.md); shown
    // collapsed under the paste box so it's always at hand without cluttering.
    const help = await foundry.applications.handlebars.renderTemplate(
      'systems/sacadia/templates/actor/parts/statblock-help.hbs', {});
    const text = await foundry.applications.api.DialogV2.wait({
      window: { title: loc('SACADIA.StatBlock.Title') },
      content: `<div class="statblock-prompt">
        <p class="hint">${loc('SACADIA.StatBlock.Hint')}</p>
        <textarea name="block" rows="14" placeholder="${loc('SACADIA.StatBlock.Placeholder')}"></textarea>
        ${help}
      </div>`,
      buttons: [
        { action: 'import', label: loc('SACADIA.StatBlock.Import'), icon: 'fa-solid fa-file-import', default: true,
          callback: (e, b, dialog) => dialog.element.querySelector('[name="block"]')?.value ?? '' },
      ],
      render: (e, dialog) => {
        const root = dialog.element;
        const ta = root.querySelector('[name="block"]');
        // "Insert example" drops the reference block into the paste box to edit.
        root.querySelector('.sbh-use-example')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (ta) { ta.value = root.querySelector('.sbh-example')?.textContent ?? ''; ta.focus(); }
        });
      },
      rejectClose: false,
    });
    if (!text || !text.trim()) return;

    const { name, update, abilities } = SacadiaActorSheet.#parseStatBlock(text);
    if (name) update.name = name;
    // Nothing recognized (e.g. the wrong text was pasted) — guide, don't silently "import 0".
    if (!Object.keys(update).length && !abilities.length) {
      return ui.notifications.warn(game.i18n.localize('SACADIA.StatBlock.Nothing'));
    }
    if (Object.keys(update).length) await this.actor.update(update);
    let attacks = 0;
    if (abilities.length) {
      await this.actor.createEmbeddedDocuments('Item', abilities.map((a) => {
        // An ability whose effect names an attack (`attack vs <DEF>` + `NdM`) gets a real, rollable
        // attack activity; everything else stays prose (saves are adjudicated by the GM asking for a
        // Resist roll). The full text is kept as the description either way.
        const activity = SacadiaActorSheet.#parseAttack(a.desc);
        if (activity) attacks++;
        return {
          name: a.name, type: 'ability',
          system: {
            description: a.desc, tag: 'action', costs: { ap: a.ap },
            ...(activity ? { activities: [activity] } : {}),
          },
        };
      }));
    }
    ui.notifications.info(game.i18n.format('SACADIA.StatBlock.Done', {
      fields: Object.keys(update).length, abilities: abilities.length, attacks,
    }));
  }

  /**
   * Parse a pasted stat block into an actor update + a list of abilities. Deliberately forgiving:
   *   - Header stats are matched anywhere by keyword (`HP 34`, `AD 13 PD 12 …`, `Check DC 13`, `CR 2`),
   *     in any order/casing, with optional `:`/`=`. An optional `Name: …` line renames the actor.
   *   - After an `Abilities:` / `Actions:` line, each entry is `Name (NAP): effect text` (bullet and
   *     AP optional; AP defaults to 1). Wrapped lines without their own name/AP append to the prior
   *     entry's description.
   * @param {string} text
   * @returns {{name: string|null, update: object, abilities: Array<{name:string, ap:number, desc:string}>}}
   */
  static #parseStatBlock(text) {
    const headerLines = [], abilityLines = [];
    let inAbilities = false;
    for (const raw of text.split(/\r?\n/)) {
      if (/^\s*(abilities|actions|traits|features)\s*:?\s*$/i.test(raw)) { inAbilities = true; continue; }
      (inAbilities ? abilityLines : headerLines).push(raw);
    }
    const header = headerLines.join('\n');
    const num = (re) => { const m = header.match(re); return m ? Number(m[1]) : null; };

    const update = {};
    const hp = num(/\b(?:hp|health)\b\s*[:=]?\s*(\d+)/i);
    const ap = num(/\bap\b\s*[:=]?\s*(\d+)/i);
    const dc = num(/\b(?:check\s*dc|dc)\b\s*[:=]?\s*(\d+)/i);
    const cr = num(/\bcr\b\s*[:=]?\s*(\d+)/i);
    if (hp != null) { update['system.health.max'] = hp; update['system.health.value'] = hp; }
    if (ap != null) { update['system.ap.max'] = ap; update['system.ap.value'] = ap; }
    for (const def of ['ad', 'pd', 'td', 'md', 'dr']) {
      const v = num(new RegExp(`\\b${def}\\b\\s*[:=]?\\s*(\\d+)`, 'i'));
      if (v != null) update[`system.defenses.${def}`] = v;
    }
    if (dc != null) update['system.checkDc'] = dc;
    if (cr != null) update['system.cr'] = cr;
    const nameM = header.match(/^\s*name\s*[:\-]\s*(.+)$/im);

    // Abilities: bulleted / named / AP-tagged lines start a new entry; bare lines continue the prior.
    const abilities = [];
    let current = null;
    for (const raw of abilityLines) {
      const line = raw.trim();
      if (!line) continue;
      const bulleted = /^[-*•]/.test(line);
      const hasAp = /\(\s*\d+\s*ap\s*\)/i.test(line);
      const named = /^[^:]{1,40}:\s/.test(line);
      if (!current || bulleted || hasAp || named) {
        let body = line.replace(/^[-*•]\s*/, '');
        let apCost = 1;
        const apM = body.match(/\(\s*(\d+)\s*ap\s*\)/i);
        if (apM) { apCost = Number(apM[1]); body = body.replace(apM[0], ' '); }
        const colon = body.indexOf(':');
        const abName = (colon >= 0 ? body.slice(0, colon) : body).replace(/\s+/g, ' ').trim();
        const desc = colon >= 0 ? body.slice(colon + 1).trim() : '';
        current = { name: abName || game.i18n.localize('TYPES.Item.ability'), ap: apCost, desc };
        abilities.push(current);
      } else {
        current.desc = current.desc ? `${current.desc} ${line}` : line;
      }
    }

    return { name: nameM ? nameM[1].trim() : null, update, abilities };
  }

  /**
   * Detect a structured attack in an ability's effect text and build an attack activity, or return
   * null (leave it as prose). Recognized shape — order-tolerant within the text:
   *   [melee|ranged|magic] attack vs <AD|PD|TD|MD>, <count>d<size>[+<flat>] [<damage type>]
   * e.g. "melee attack vs PD, 1d10 slashing" or "ranged attack vs PD, 2d6+2 piercing". The to-hit
   * trait comes from the category (melee→power, ranged→finesse, magic→wiles); category defaults to
   * melee. Requires both a target defense and a `NdM` to fire.
   * @param {string} text
   * @returns {object|null} an `activities[]` entry, or null.
   */
  static #parseAttack(text) {
    if (!/\b(?:atk|attack)\b/i.test(text)) return null;
    const defM = text.match(/\bvs\.?\s*(ad|pd|td|md)\b/i);
    const diceM = text.match(/(\d+)\s*d\s*(\d+)/i);
    if (!defM || !diceM) return null;
    const category = (text.match(/\b(melee|ranged|magic)\b/i)?.[1] ?? 'melee').toLowerCase();
    const defense = defM[1].toLowerCase();
    const trait = CONFIG.SACADIA.attackCategories[category]?.trait ?? 'power';
    const flatM = text.match(/\d+\s*d\s*\d+\s*\+\s*(\d+)/i);
    // Damage type = the word right after the dice (or after +flat), unless it's filler.
    const typeM = text.match(/\d+\s*d\s*\d+(?:\s*\+\s*\d+)?[\s,]+([a-z][a-z-]*)/i);
    const stop = new Set(['damage', 'on', 'to', 'and', 'the', 'a', 'hit', 'vs', 'against']);
    const type = typeM && !stop.has(typeM[1].toLowerCase()) ? typeM[1].toLowerCase() : '';
    const damage = [{ count: diceM[1], denomination: Number(diceM[2]), formula: '', trait: '', type }];
    if (flatM) damage.push({ count: '', denomination: null, formula: flatM[1], trait: '', type });
    return { type: 'attack', label: '', attack: { category, trait, defense }, damage };
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
