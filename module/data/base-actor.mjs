import SacadiaDataModel from "./base-model.mjs";
import { defenseValue, effectiveDefenseStat, evaluatePredicate, resolveModifierValue } from "../helpers/derivation.mjs";

/** Global (bucket) modifier scopes; anything else is a per-ability catalogId scope. */
const GLOBAL_SCOPES = new Set(['all', 'melee', 'ranged', 'magic']);

/**
 * Shared schema + derived data for every Sacadia actor: the five core stats, current/max Health,
 * a biography, and the four derived defenses (+ DR). Character and NPC both use the same defense
 * derivation, so combat "just works" on either.
 */
export default class SacadiaActorBase extends SacadiaDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    // Five core stats (book p.226). The raw stat value is what gets added to rolls and defenses
    // (there is no d20-style derived modifier); `.display` is the signed string for the sheet.
    schema.stats = new fields.SchemaField(Object.keys(CONFIG.SACADIA.stats).reduce((obj, stat) => {
      obj[stat] = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 0 })
      });
      return obj;
    }, {}));

    // Health. Max stays player-editable — the book allows rolling instead of taking the average,
    // and Heritage HP isn't tracked; `_prepareDerived` only ever sets a *suggested* max hint.
    schema.health = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 })
    });

    schema.biography = new fields.HTMLField({ required: true, blank: true });

    // Action economy — shared by both actor types (NPCs use the same AP + limb rules, book p.237).
    // `max` is the base pool: a character derives it from level (see `_baseMaxAp`); an NPC's is this
    // GM-editable value. Fatigue reduces the effective max in derived data for both.
    schema.ap = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 2, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 2, min: 0 })
    });

    // Limb-exhaustion tracker (7 boolean slots).
    schema.exhaustion = new fields.SchemaField(Object.keys(CONFIG.SACADIA.exhaustionSlots).reduce((obj, key) => {
      obj[key] = new fields.BooleanField({ initial: false });
      return obj;
    }, {}));

    // Per-turn action log (the "Actions Used" tracker). Each entry records what it spent so it can
    // be undone. `ap` is the action's nominal cost (shown in the log); `spent` is the AP actually
    // deducted — these differ on overspend (the deduction floors at 0), and undo refunds only
    // `spent`. `exhausted` lists the slots this action newly set (cleared on undo). Cleared at the
    // start of the turn.
    schema.actionLog = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      // Source ability's catalogId (or item id) — drives the `self:used:<key>` roll option, which is
      // how a Focus ability's passive knows it was maintained (re-used) this turn.
      key: new fields.StringField({ required: true, blank: true }),
      // Per-use choice picked when the ability was activated → `self:choice:<key>:<choice>`.
      choice: new fields.StringField({ required: true, blank: true }),
      ap: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      exhausted: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
    }));

    // Auto-maintained combat-state counters — the observable half of the conditional-modifier roll
    // options (see docs/conditional-modifiers.md). Combat hooks keep these current; predicates read
    // them as `self:combat:*`. Not player-edited in the common case (the aggressive-automation path).
    schema.combatState = new fields.SchemaField({
      consecutiveHits: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      attacksThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      movedFeet: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      tookDamage: new fields.BooleanField({ initial: false }),
      // Focus-maintenance streak per Focus ability: catalogId → consecutive turns it has been used
      // ("maintained"), counting the turn it was initiated. Incremented on the first use each turn
      // (#spendAction); a streak that wasn't maintained last turn is dropped at turn start
      // (resetActionEconomy). Drives per-round ramps like Fight Reflex (`@combat.focusRounds.<id>`).
      focusRounds: new fields.ObjectField({ required: true, initial: {} }),
    });

    // Target marks (Layer B, see docs/conditional-modifiers.md): a map of mark-key → array of the
    // token uuids this actor most recently "marked" with an ability declaring `system.mark.key`.
    // Stored on the *marker* (not the target) so re-marking simply overwrites the pointer — the old
    // target drops with no cleanup — and so a player can write it to their own actor without GM
    // routing. Read at roll time as `target:mark:<key>` when the current target is in the list.
    schema.marks = new fields.ObjectField({ required: true, initial: {} });

    // Leveled conditions (0–6). Shared by both actor types so an inflicted condition automates on
    // PCs and NPCs alike; the character sheet surfaces the tracker (NPC UI in Phase 6).
    schema.conditions = new fields.SchemaField(Object.keys(CONFIG.SACADIA.conditions).reduce((obj, key) => {
      obj[key] = new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      });
      return obj;
    }, {}));

    return schema;
  }

  /* -------------------------------------------- */

  /**
   * Initialize the cross-modifier sink *before* Active Effects apply, so AE with keys like
   * `system.bonuses.toHit.all` / `system.bonuses.defense.pd` (mode ADD) accumulate into it; derived
   * data (attack rolls, defenses) then reads the populated values. This is the Foundry-native way to
   * let a temp buff "move the numbers": base-data init → AE apply → derived-data read.
   */
  prepareBaseData() {
    const buckets = () => ({ all: 0, melee: 0, ranged: 0, magic: 0 });
    this.bonuses = {
      toHit: buckets(),
      damage: buckets(),
      defense: { ad: 0, pd: 0, td: 0, md: 0, dr: 0 },
      dieStep: 0, // ladder steps applied to damage dice (die-step buffs; AE add to this)
    };
    // Advantage / disadvantage sinks (extra kept-highest / kept-lowest d20s). Populated by AE and
    // leveled conditions; rolls net them against the player's chosen level. Any magnitude stacks.
    // Init here so AE (mode ADD) can accumulate before rolls read them.
    this.advantage = { toHit: 0, trait: 0 };
    this.disadvantage = { toHit: 0, trait: 0 };
    // Extra incoming damage (Sting); surfaced now, auto-applied to damage with Phase 10.
    this.damageTaken = 0;
    // Per-ability modifier sinks (keyed by catalogId): flat to-hit/damage and die-steps that apply
    // only when *that* ability rolls. `abilityDamageSteps` predates the unified model; the other two
    // are the flat-bonus siblings. Init here so AE could target them too if ever needed.
    this.abilityToHit = {};
    this.abilityDamage = {};
    this.abilityDamageSteps = {};
    // Dice-valued conditional damage bonuses (Consecutive Threat's `Xd4`): kept as roll *formulas*
    // (not numeric-resolved) and appended to matching damage rolls. Global by bucket, or per-ability.
    this.damageDiceBonus = { all: [], melee: [], ranged: [], magic: [] };
    this.abilityDamageDice = {};
    // Itemized list of conditional modifiers that qualified this cycle — the Tier-1 display surface
    // (the chat card / sheet read this to show "why is this +2"). {label, target, scope, value, source}.
    this.activeModifiers = [];
  }

  prepareDerivedData() {
    this._applyConditionEffects(); // fold leveled conditions into bonuses/disadvantage before defenses
    this._prepareStats();
    this._prepareModifiers();      // fold qualifying conditional modifiers into the sinks (pre-defense)
    this._prepareDefenses();
    this._prepareActionPoints();
  }

  /**
   * Assemble the roll options — a flat `tag → value` map of facts about the current situation that
   * predicates read (see docs/conditional-modifiers.md). Two sources here: actor-state (derived) and
   * combat-state (auto counters). The `context` (roll-time / canvas `target:*`) source is merged in
   * later by the caller at roll time; pass `extra` to fold it in.
   * @param {Record<string, number|string|boolean>} [extra]  Context options to merge (roll-time).
   * @returns {Record<string, number|string|boolean>}
   */
  _rollOptions(extra = {}) {
    const o = {};
    // --- actor-state ---
    const hp = this.health ?? {};
    if (hp.max > 0 && hp.value * 2 <= hp.max) o['self:hp-below-half'] = true;
    if (hp.max > 0 && hp.value >= hp.max) o['self:hp-full'] = true;
    for (const [key, cond] of Object.entries(this.conditions ?? {})) {
      if (cond.value > 0) o[`self:condition:${key}`] = cond.value;
    }
    const armorCats = []; // equipped-armor categories, for the `self:armor:only-light` aggregate below.
    for (const item of this.parent?.items ?? []) {
      if (item.type === 'ability') {
        const cid = item.flags?.sacadia?.catalogId;
        if (cid) o[`self:ability:${cid}`] = true;
      }
      if (!item.system?.equipped) continue;
      // Equipped gear advertises its freeform weapon/item traits as `self:wielding:<trait>` predicates
      // (the book's weapon taxonomy is open-ended).
      if (item.type === 'gear') {
        for (const t of String(item.system.traits ?? '').split(/[,\s]+/).filter(Boolean)) {
          o[`self:wielding:${t.toLowerCase()}`] = true;
        }
      }
      // Any equipped item with a validated weapon type (a weapon, or a shield that can Bash) advertises a
      // reliable `self:wielding:<type>` for ability gating (Shield and Spear, Shield Warrior, …).
      if (item.system.weaponType) o[`self:wielding:${item.system.weaponType}`] = true;
      // Equipped armor advertises its weight class → `self:armor:<category>` (shields carry no class).
      if (item.type === 'armor' && item.system.category) {
        o[`self:armor:${item.system.category}`] = true;
        armorCats.push(item.system.category);
      }
    }
    // Light Wear / Slightly Darker Wear gate on wearing *only* light armor (at least one piece, none heavier).
    if (armorCats.length && armorCats.every((c) => c === 'light')) o['self:armor:only-light'] = true;
    for (const key of this._professionKeys?.() ?? []) o[`self:profession:${key}`] = true;
    // Sentinel's chosen Favored Enemy types → `self:favored:<type>` (Favored Style keys its self-buff on
    // which type you favor). Character-only; NPCs have no professionResources.
    for (const t of this.professionResources?.sentinel?.favored ?? []) o[`self:favored:${t}`] = true;
    // Token status conditions (binary, GM-tracked on the token) — e.g. Insanity → `self:insane`.
    if (this.parent?.statuses?.has('insane')) o['self:insane'] = true;
    // Abilities activated this turn (the per-turn action log, cleared at turn start) → `self:used:*`.
    // This is how a Focus ability's passive is gated on being re-used ("maintained") this turn.
    for (const entry of this.actionLog ?? []) {
      if (entry.key) o[`self:used:${entry.key}`] = true;
      if (entry.key && entry.choice) o[`self:choice:${entry.key}:${entry.choice}`] = true;
    }
    // --- combat-state (auto counters) ---
    const cs = this.combatState ?? {};
    o['self:combat:consecutive-hits'] = cs.consecutiveHits ?? 0;
    o['self:combat:attacks-this-turn'] = cs.attacksThisTurn ?? 0;
    o['self:combat:moved-feet'] = cs.movedFeet ?? 0;
    if ((cs.attacksThisTurn ?? 0) === 0) o['self:combat:first-attack'] = true;
    if ((cs.movedFeet ?? 0) > 0) o['self:combat:moved'] = true;
    if (cs.tookDamage) o['self:combat:took-damage'] = true;
    // Focus-maintenance streaks (turns a Focus ability has been maintained) → `self:combat:focus-rounds:<id>`.
    for (const [cid, r] of Object.entries(cs.focusRounds ?? {})) o[`self:combat:focus-rounds:${cid}`] = r;
    return { ...o, ...extra };
  }

  /**
   * Numeric map for resolving modifier `@ref` values (`@power`, `@combat.consecutiveHits`, …) — the
   * flat, synchronous counterpart to getRollData (which builds dice roll data).
   * @returns {Record<string, number>}
   */
  _modifierNumbers() {
    const n = {};
    for (const [key, stat] of Object.entries(this.stats ?? {})) n[key] = stat.value;
    for (const [key, cond] of Object.entries(this.conditions ?? {})) n[key] ??= cond.value;
    const cs = this.combatState ?? {};
    n['combat.consecutiveHits'] = cs.consecutiveHits ?? 0;
    n['combat.attacksThisTurn'] = cs.attacksThisTurn ?? 0;
    n['combat.movedFeet'] = cs.movedFeet ?? 0;
    for (const [cid, r] of Object.entries(cs.focusRounds ?? {})) n[`combat.focusRounds.${cid}`] = r;
    return n;
  }

  /**
   * The unified conditional-modifier producer (see docs/conditional-modifiers.md). Walk every owned
   * ability's `system.modifiers` (plus the legacy `flags.sacadia.modifiesDamage` shim), keep those
   * whose predicate holds against the current roll options, and fold each qualifying effect into the
   * right sink — global buckets (`bonuses`/`advantage`) or the per-ability maps. Records the survivors
   * in `activeModifiers` for Tier-1 display. Runs in derived data (reactive; no manual sweep).
   */
  _prepareModifiers() {
    const options = this._rollOptions();
    const numbers = this._modifierNumbers();
    for (const item of this.parent?.items ?? []) {
      if (item.type !== 'ability') continue;
      const mods = [...(item.system?.modifiers ?? []), ...this.#legacyModifiers(item)];
      for (const mod of mods) {
        if (!mod?.target) continue;
        // Predicate atoms are `{atom}` objects (authored) or bare strings (legacy shim).
        const atoms = (mod.predicate ?? []).map((p) => (typeof p === 'string' ? p : p?.atom)).filter((a) => a);
        // Target-contextual modifiers (any `target:*` atom, even negated) need the current target, so
        // they're evaluated at roll time in the sheet — never folded here (would double-count).
        if (atoms.some((a) => a.replace(/^!/, '').startsWith('target:'))) continue;
        if (!evaluatePredicate(atoms, options)) continue;
        // Dice-valued damage: keep the formula (resolved in the Roll at use, so it counter-scales).
        if (mod.target === 'damageDice') {
          const formula = String(mod.value ?? '').trim();
          if (!formula) continue;
          const entry = { formula, label: mod.label || item.name };
          const scope = mod.scope || 'all';
          if (GLOBAL_SCOPES.has(scope)) this.damageDiceBonus[scope].push(entry);
          else (this.abilityDamageDice[scope] ??= []).push(entry);
          this.activeModifiers.push({ ...entry, target: 'damageDice', scope, mode: 'dice', source: item.name, value: formula });
          continue;
        }
        const v = resolveModifierValue(mod.value, numbers);
        if (!v) continue;
        this.#foldModifier(mod, v);
        this.activeModifiers.push({
          label: mod.label || item.name, target: mod.target, scope: mod.scope || 'all',
          value: v, mode: mod.mode, source: item.name,
        });
      }
    }
  }

  /** Read the deprecated `flags.sacadia.modifiesDamage` as unconditional per-ability die-step modifiers. */
  #legacyModifiers(item) {
    return (item.flags?.sacadia?.modifiesDamage ?? []).map((m) => ({
      target: 'damage', mode: 'step', scope: m.target, value: m.ladderSteps ?? 0, predicate: [],
      label: item.name,
    }));
  }

  /** Fold one qualifying modifier (with resolved numeric value) into the appropriate sink. */
  #foldModifier(mod, v) {
    const scope = mod.scope || 'all';
    const global = GLOBAL_SCOPES.has(scope);
    if (mod.target === 'toHit') {
      if (global) this.bonuses.toHit[scope] += v; else this.abilityToHit[scope] = (this.abilityToHit[scope] ?? 0) + v;
    } else if (mod.target === 'damage') {
      if (mod.mode === 'step') {
        if (global) this.bonuses.dieStep += v; else this.abilityDamageSteps[scope] = (this.abilityDamageSteps[scope] ?? 0) + v;
      } else if (global) this.bonuses.damage[scope] += v;
      else this.abilityDamage[scope] = (this.abilityDamage[scope] ?? 0) + v;
    } else if (mod.target === 'dieStep') {
      if (global) this.bonuses.dieStep += v; else this.abilityDamageSteps[scope] = (this.abilityDamageSteps[scope] ?? 0) + v;
    } else if (mod.target.startsWith('defense.')) {
      const sub = mod.target.split('.')[1];
      if (sub in this.bonuses.defense) this.bonuses.defense[sub] += v;
    } else if (mod.target.startsWith('advantage.')) {
      const sub = mod.target.split('.')[1];
      if (sub in this.advantage) this.advantage[sub] += v;
    }
  }

  /**
   * Effective Max AP = base pool − Fatigue (book p.262), shared by both actor types. The base pool
   * comes from {@link _baseMaxAp} (level-derived for characters, the GM-set field for NPCs).
   */
  _prepareActionPoints() {
    const fatigue = this.conditions?.fatigue?.value ?? 0;
    this.ap.max = Math.max(0, this._baseMaxAp() - fatigue);
  }

  /**
   * The base (pre-Fatigue) Max AP. The NPC uses its stored, GM-editable value; the character
   * overrides this to derive it from level.
   * @returns {number}
   */
  _baseMaxAp() {
    return this._source.ap?.max ?? 0;
  }

  /**
   * Apply each leveled condition's automated effects, scaled by its 0–6 level (effects cap at 6),
   * into the already-AE-populated `bonuses` / `disadvantage` sinks. Display-only conditions (no
   * `effects`) are left for adjudication; `turnDamage` is handled by the combat hook, not here.
   */
  _applyConditionEffects() {
    for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
      const level = Math.min(this.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
      if (!level || !cfg.effects?.length) continue;
      for (const eff of cfg.effects) {
        if (eff.type === 'bonus') {
          const [bucket, sub] = eff.target.split('.');
          if (this.bonuses[bucket] && sub in this.bonuses[bucket]) this.bonuses[bucket][sub] += eff.perLevel * level;
        } else if (eff.type === 'disadvantage') {
          this.disadvantage[eff.target] += eff.perLevel * level;
        } else if (eff.type === 'damageTaken') {
          this.damageTaken += eff.perLevel * level;
        }
        // `resource` (Fatigue→ap.max) is applied in the character progression; `turnDamage` in combat.
      }
    }
  }

  /** Localized label + signed display string for each stat. */
  _prepareStats() {
    for (const [key, stat] of Object.entries(this.stats)) {
      stat.label = game.i18n.localize(CONFIG.SACADIA.stats[key]) ?? key;
      stat.display = stat.value >= 0 ? `+${stat.value}` : `${stat.value}`;
    }
  }

  /**
   * Derive AD/PD/TD/MD independently (`11 + capped governing stat + armor + effect bonus`), plus
   * DR. The governing stat is capped by equipped-armor Max Stat (flagged `cappedStat`). AD is a
   * floor: where AD exceeds another defense, that defense keeps its own true value and is flagged
   * `supersededByAd` for display (never overwritten — the Roll20 `_override_note` pattern).
   */
  _prepareDefenses() {
    const armor = this._armorContribution();
    const bonus = this.bonuses?.defense ?? {};
    this.defenses = {};
    for (const [def, statKey] of Object.entries(CONFIG.SACADIA.defenseStat)) {
      const raw = this.stats[statKey]?.value ?? 0;
      const stat = effectiveDefenseStat(raw, armor.maxStat);
      this.defenses[def] = {
        value: defenseValue({ stat, armor: (armor[def] ?? 0) + (bonus[def] ?? 0) }),
        statKey,
        label: game.i18n.localize(`SACADIA.Defense.${def.toUpperCase()}`),
        cappedStat: stat < raw,
      };
    }
    this.defenses.dr = { value: (armor.dr ?? 0) + (bonus.dr ?? 0), label: game.i18n.localize("SACADIA.Defense.DR") };

    const ad = this.defenses.ad.value;
    for (const def of ["pd", "td", "md"]) {
      this.defenses[def].supersededByAd = ad > this.defenses[def].value;
    }
  }

  /**
   * Sum the flat defense/DR bonuses (and the tightest Max Stat cap) from equipped armor Items.
   * @returns {{ad: number, pd: number, td: number, md: number, dr: number, maxStat: number|null}}
   */
  _armorContribution() {
    const c = { ad: 0, pd: 0, td: 0, md: 0, dr: 0, maxStat: null };
    for (const item of this.parent?.items ?? []) {
      if (item.type !== "armor" || !item.system.equipped) continue;
      const d = item.system.defenses;
      c.ad += d.ad; c.pd += d.pd; c.td += d.td; c.md += d.md; c.dr += d.dr;
      if (item.system.maxStat != null) {
        c.maxStat = c.maxStat == null ? item.system.maxStat : Math.min(c.maxStat, item.system.maxStat);
      }
    }
    return c;
  }

  /* -------------------------------------------- */

  getRollData() {
    const data = {};
    // Expose raw stat values at the top level so roll formulas can use `@power`, `@fate`, …
    for (const [key, stat] of Object.entries(this.stats)) {
      data[key] = stat.value;
    }
    // Expose leveled-condition values so damage that scales off a condition resolves — e.g. the
    // Oracle's `@madness`-many-dice abilities (`@{condition_madness}` in the source catalogs).
    for (const [key, cond] of Object.entries(this.conditions ?? {})) {
      data[key] ??= cond.value;
    }
    // Proficiency defaults to 0 here so `@proficiency` resolves for NPCs (e.g. the initiative
    // formula `max(@courage,@finesse) + @proficiency`); the character overrides it with its real
    // derived value in its own getRollData.
    data.proficiency ??= 0;
    // Combat counters, so damage/inflict formulas can scale off live state (`@combat.consecutiveHits`).
    const cs = this.combatState ?? {};
    data.combat = {
      consecutiveHits: cs.consecutiveHits ?? 0,
      attacksThisTurn: cs.attacksThisTurn ?? 0,
      movedFeet: cs.movedFeet ?? 0,
      focusRounds: { ...(cs.focusRounds ?? {}) },
    };
    return data;
  }

  /**
   * Profession keys owned by this actor, for `self:profession:*` roll options. Base actors (NPCs)
   * have none; the character overrides this with its primary/secondary professions.
   * @returns {string[]}
   */
  _professionKeys() {
    return [];
  }
}
