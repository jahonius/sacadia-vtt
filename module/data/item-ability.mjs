import SacadiaItemBase from "./base-item.mjs";

/**
 * The `ability` Item — the centerpiece of the system. Covers every catalog entry: Actions/Focus/
 * Ceremonies (cost AP + limbs, may attack), Passives, Reactions & Boosts, and Lore.
 *
 * Uses an **Activities** model: an ability holds zero or more activities, each independently an
 * attack (rolls to-hit), a save (prompts a target check vs the user's Check DC), a bare damage
 * source, or utility. Damage is **structured** — `(count)d(denomination)` where `count` is a
 * formula (so stat-scaled dice like "Madness-many d4" are `count: "@madness"`) — with a freeform
 * override; this keeps die-step buffs (Phase 5) to a denomination bump rather than string-parsing.
 * Cross-ability modifiers become Active Effects (Phase 5), not schema.
 */
export default class SacadiaAbility extends SacadiaItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const stat = () => new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.stats) });
    const schema = super.defineSchema(); // description

    schema.tag = new fields.StringField({
      required: true, blank: false, initial: 'action',
      choices: Object.keys(CONFIG.SACADIA.abilityTags),
    });

    // Consolidated costs. `ap` is the base Action-Point cost (most Actions/Focus cost 1, p.237),
    // spent when an Active ability is used in combat; limbs are the granular action cost that
    // drives exhaustion (and the +1-AP penalty for reusing an exhausted limb).
    schema.costs = new fields.SchemaField({
      ap: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      csp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      madness: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Signature-pool cost (e.g. 1 Arrangement point). `key` is a `CONFIG.SACADIA.pools` id. When
      // `variable` (e.g. "expend X" / "any number of" / "up to your Proficiency"), the player is
      // prompted for the amount on use; `max` is an optional `@ref` formula bounding that prompt
      // (blank = bounded only by the current pool value). `amount` is the fixed cost otherwise.
      pool: new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.pools) }),
        amount: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        variable: new fields.BooleanField({ initial: false }),
        max: new fields.StringField({ required: true, blank: true }),
      }),
      limbs: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false, choices: Object.keys(CONFIG.SACADIA.limbs) })
      ),
    });

    // Range. `value` is a distance in feet (null for non-numeric ranges); `type` classifies it
    // (self/touch/melee/ranged/area). Shown on the card; a numeric range warns (but allows) when the
    // targeted token is beyond it. Most catalog ranges are auto-detected from "within N ft" prose.
    schema.range = new fields.SchemaField({
      value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
      type: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.rangeTypes) }),
    });

    // Catalog metadata. `prerequisite` is display-only for now (structured validation is a later,
    // now-feasible upgrade — see PLANNING).
    schema.meta = new fields.SchemaField({
      profession: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.professions) }),
      subpath: new fields.StringField({ required: true, blank: true }),
      prerequisite: new fields.StringField({ required: true, blank: true }),
    });

    // Activities. One SchemaField shape carries every activity type's fields; `type` selects which
    // are meaningful (Foundry has no clean discriminated-union field, so unused blocks stay default).
    schema.activities = new fields.ArrayField(new fields.SchemaField({
      type: new fields.StringField({
        required: true, blank: false, initial: 'attack', choices: Object.keys(CONFIG.SACADIA.activityTypes),
      }),
      label: new fields.StringField({ required: true, blank: true }),
      // type: attack — `defense` is which defense the to-hit is compared against (AD/PD/TD/MD).
      // It drives the card display now and the hit/miss resolution in the Phase 10 combat model.
      attack: new fields.SchemaField({
        category: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.attackCategories) }),
        trait: stat(),
        defense: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.defenseStat) }),
      }),
      // type: save — target rolls d20 + `trait` vs `dc` (null dc → the user's Check DC at use time).
      save: new fields.SchemaField({
        trait: stat(),
        dc: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
      }),
      // Damage parts (attack/save/damage activities). `(count)d(denomination)` unless `formula` set.
      damage: new fields.ArrayField(new fields.SchemaField({
        count: new fields.StringField({ required: true, blank: true, initial: '1' }),
        denomination: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        formula: new fields.StringField({ required: true, blank: true }),
        trait: stat(),
        type: new fields.StringField({ required: true, blank: true }),
      })),
      // Leveled conditions this activity inflicts on a hit. `amount` is a formula (e.g. "@proficiency"
      // or "ceil(@proficiency/2)"), evaluated at use; the GM applies it from the resolution whisper.
      inflict: new fields.ArrayField(new fields.SchemaField({
        condition: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.conditions) }),
        amount: new fields.StringField({ required: true, blank: true, initial: '1' }),
      })),
    }));

    // Per-use choice (e.g. "gain temp PD, MD, or TD — choose one"). When `options` is non-empty,
    // activating the ability prompts the player to pick one; the pick becomes a
    // `self:choice:<catalogId>:<value>` roll option for this turn, so authored modifiers can gate on
    // it (see docs/conditional-modifiers.md). Cleared when the action log clears (turn start).
    schema.choice = new fields.SchemaField({
      prompt: new fields.StringField({ required: true, blank: true }),
      options: new fields.ArrayField(new fields.SchemaField({
        value: new fields.StringField({ required: true, blank: false }),
        label: new fields.StringField({ required: true, blank: true }),
      })),
    });

    // Target mark (Layer B, see docs/conditional-modifiers.md). When `key` is set, activating this
    // ability records the current target(s) under `actor.system.marks[key]`, so later abilities can
    // gate a modifier on `target:mark:<key>`. `exclusive` (default) makes each use replace the prior
    // marked set (the "moving mark"); clear it to accumulate marks across uses instead.
    schema.mark = new fields.SchemaField({
      key: new fields.StringField({ required: true, blank: true }),
      exclusive: new fields.BooleanField({ initial: true }),
    });

    // Focus-maintenance behavior (distinct from the `tag: 'focus'`). `breaksOnMove` = this ability's
    // Focus ends the moment you move ("if you leave the square", Stood Ground), so movement drops its
    // maintenance streak (`combatState.focusRounds`) and any per-round ramp gated on it.
    schema.focus = new fields.SchemaField({
      breaksOnMove: new fields.BooleanField({ initial: false }),
    });

    // Ally grant (see docs/conditional-modifiers.md — "granted effects"). A buff this ability applies
    // to *other* tokens (the caster's own effects use `modifiers`). Each `change` is an Active-Effect
    // change placed on the target: `key` is a sink (e.g. `system.bonuses.defense.md`), `mode` an AE
    // mode (2 = ADD), `value` a formula resolved against the *caster's* numbers at cast time (the buff
    // scales off the caster, then is a fixed number on the ally). `duration.type: 'focus'` ties the
    // grant to a caster-side anchor effect: it lives only while the caster maintains Focus, and the
    // reap sweep deletes it the moment that anchor is gone (no orphans).
    schema.grant = new fields.SchemaField({
      scope: new fields.StringField({ required: true, blank: true, choices: ['', 'ally', 'allies'] }),
      label: new fields.StringField({ required: true, blank: true }),
      duration: new fields.SchemaField({
        type: new fields.StringField({ required: true, blank: true, choices: ['', 'focus', 'rounds', 'consumed'] }),
        rounds: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
        on: new fields.StringField({ required: true, blank: true }),
      }),
      changes: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true }),
        mode: new fields.NumberField({ required: true, integer: true, initial: 2 }),
        value: new fields.StringField({ required: true, blank: true, initial: '0' }),
      })),
      // Optional variable-resource spend that scales the grant (e.g. Blessing of Hot Coal — "reduce
      // your Madness by up to M; add 1 die type per level expended"). When `resource` is set, using
      // the ability prompts for an amount (capped by `max`, a formula over the caster's numbers),
      // deducts it from the caster's matching leveled condition, and exposes the chosen amount to the
      // grant's change formulas as `@spent`.
      spend: new fields.SchemaField({
        resource: new fields.StringField({ required: true, blank: true }),
        max: new fields.StringField({ required: true, blank: true }),
      }),
    });

    // Oracle Madness annotations (book p120; transcribed from the PDF in `src/madness.mjs` — the Roll20
    // catalog lacked them). `insaneOnly` = `P:I` (usable only while Insane). `prereq` = `P:MX` (minimum
    // Madness to use; a Focus ability ends if it later falls below). `gain`/`spend` are `M+X`/`M-X`
    // amount formulas rolled at end of action (`1d3-1` standard; `N` = player-chosen; `M` = all Madness).
    schema.madness = new fields.SchemaField({
      insaneOnly: new fields.BooleanField({ initial: false }),
      prereq: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
      gain: new fields.StringField({ required: true, blank: true }),
      spend: new fields.StringField({ required: true, blank: true }),
    });

    // Conditional modifiers — the unified "buff that applies only when X" model (see
    // docs/conditional-modifiers.md). Each is an EFFECT (a number moving a roll) gated by a
    // PREDICATE (atoms over roll options). Replaces the ad-hoc `flags.sacadia.modifiesDamage`.
    schema.modifiers = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      // What number moves: toHit | damage | defense.{ad,pd,td,md,dr} | advantage.{toHit,trait} | dieStep.
      target: new fields.StringField({ required: true, blank: false, initial: 'damage' }),
      // Where it lands: a global bucket (all/melee/ranged/magic) or a catalogId (per-ability).
      scope: new fields.StringField({ required: true, blank: true, initial: 'all' }),
      // add = flat; step = die-ladder steps (damage/dieStep only).
      mode: new fields.StringField({ required: true, blank: false, initial: 'add', choices: ['add', 'step'] }),
      // A number or a simple `@ref` formula resolved against rollData + counters.
      value: new fields.StringField({ required: true, blank: true, initial: '1' }),
      // Predicate: atoms over roll options, all of which must hold. Empty array = unconditional; a
      // blank atom is allowed (mid-edit) and reads as vacuously true. Each atom is wrapped in a
      // SchemaField (`{atom}`) rather than a bare string so the item sheet's form round-trips it —
      // an array-of-scalars doesn't serialize reliably, an array-of-objects does.
      predicate: new fields.ArrayField(new fields.SchemaField({
        atom: new fields.StringField({ required: true, blank: true }),
      })),
    }));

    return schema;
  }

  /** Active abilities (cost AP + limbs, live on the Active sub-list). */
  get isActive() {
    return ['action', 'focus', 'ceremony'].includes(this.tag);
  }

  prepareDerivedData() {
    this.hasAttack = false;
    this.hasSave = false;
    for (const act of this.activities) {
      if (act.type === 'attack') {
        this.hasAttack = true;
        // Effective to-hit trait: explicit > category default (Power melee / Finesse ranged /
        // Wiles magic, p.218) > none.
        act.attack.effectiveTrait = act.attack.trait || CONFIG.SACADIA.attackCategories[act.attack.category]?.trait || '';
      }
      if (act.type === 'save') this.hasSave = true;
      for (const part of act.damage) {
        part.diceFormula = SacadiaAbility.#partFormula(part);
      }
    }
  }

  /** Resolve a damage part to a roll formula: freeform wins, else `(count)d(denomination)`. */
  static #partFormula(part) {
    if (part.formula?.trim()) return part.formula.trim();
    if (!part.denomination) return '';
    const count = String(part.count ?? '1').trim() || '1';
    return `(${count})d${part.denomination}`;
  }
}
