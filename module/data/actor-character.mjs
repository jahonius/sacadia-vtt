import SacadiaActorBase from "./base-actor.mjs";
import {
  proficiencyForLevel,
  maxApForLevel,
  maxCspForLevel,
  checkDc,
  suggestedMaxHealth,
  suggestedMaxHealthPools,
} from "../helpers/derivation.mjs";

/**
 * The player character. Adds level/progression, professions, talents, conditions, exhaustion,
 * action pools and Oracle profession resources on top of the shared stats/defenses in
 * {@link SacadiaActorBase}. Proficiency / Max AP / CSP / Check DC are all derived.
 */
export default class SacadiaCharacter extends SacadiaActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.level = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 });

    // Current Action Points (max is derived from level).
    schema.ap = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 2, min: 0 })
    });

    // Health Pools — like Health, max stays player-editable; a suggested max is derived.
    schema.healthPools = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // Freeform action pools (mana / ki / Prescient Points …).
    schema.pools = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    }));

    // Primary/secondary profession. `key` is bounded to the seven professions; blank = unset.
    const professionKeys = Object.keys(CONFIG.SACADIA.professions);
    const professionField = (initialLevel) => new fields.SchemaField({
      key: new fields.StringField({ required: true, blank: true, choices: professionKeys }),
      level: new fields.NumberField({ ...requiredInteger, initial: initialLevel, min: 0 })
    });
    schema.professions = new fields.SchemaField({
      primary: professionField(1),
      secondary: professionField(0)
    });

    // Trait Expertise: two reroll-one-failed-d20 toggles (labeled from the primary profession).
    schema.traitExpertise = new fields.SchemaField({
      slot1: new fields.BooleanField({ initial: false }),
      slot2: new fields.BooleanField({ initial: false })
    });

    // 29 talents, each a proficiency toggle (governing stat/category live in CONFIG, not schema).
    schema.talents = new fields.SchemaField(Object.keys(CONFIG.SACADIA.talents).reduce((obj, key) => {
      obj[key] = new fields.SchemaField({
        proficient: new fields.BooleanField({ initial: false })
      });
      return obj;
    }, {}));

    // 12 dice-severity conditions, each a 0–6 track.
    schema.conditions = new fields.SchemaField(Object.keys(CONFIG.SACADIA.conditions).reduce((obj, key) => {
      obj[key] = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: CONFIG.SACADIA.conditionMax })
      });
      return obj;
    }, {}));

    // Limb-exhaustion tracker (7 boolean slots).
    schema.exhaustion = new fields.SchemaField(Object.keys(CONFIG.SACADIA.exhaustionSlots).reduce((obj, key) => {
      obj[key] = new fields.BooleanField({ initial: false });
      return obj;
    }, {}));

    // Profession-scoped resources, shown by active profession. Oracle: Insanity flag + saved
    // Slightly Cracked d3 rolls. (Madness itself lives in `conditions.madness`.)
    schema.professionResources = new fields.SchemaField({
      oracle: new fields.SchemaField({
        insane: new fields.BooleanField({ initial: false }),
        cracked: new fields.ArrayField(new fields.NumberField({ ...requiredInteger, min: 1, max: 3 }))
      })
    });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData(); // stats + defenses
    this._prepareProgression();
    this._prepareCheckDc();
  }

  /** Proficiency, Max AP, CSP budget, and suggested Health/Health-Pool maxes. */
  _prepareProgression() {
    const level = this.level;
    this.proficiency = proficiencyForLevel(level);
    this.ap.max = maxApForLevel(level);

    // CSP: max from level; spent = Σ owned ability `cspCost` (Phase 4 → 0 until ability Items
    // exist); current is fully derived, so a level-up never silently un-spends bought points.
    const max = maxCspForLevel(level);
    const spent = this._cspSpent();
    this.csp = { max, spent, current: max - spent };

    // Suggested maxes (hints only — the real maxes stay player-editable).
    const { primary, secondary } = this.professions;
    const hp = CONFIG.SACADIA.professionHpPerLevel;
    this.health.suggestedMax = suggestedMaxHealth([
      { hpPerLevel: hp[primary.key], level: primary.level },
      { hpPerLevel: hp[secondary.key], level: secondary.level }
    ]);
    this.healthPools.suggestedMax = suggestedMaxHealthPools(level, this.stats.power?.value ?? 0);
  }

  /**
   * Σ `cspCost` across owned ability Items. Ability Items arrive in Phase 4; until then no item
   * is of type `ability`, so this is 0.
   * @returns {number}
   */
  _cspSpent() {
    let spent = 0;
    for (const item of this.parent?.items ?? []) {
      if (item.type === "ability") spent += item.system?.cspCost ?? 0;
    }
    return spent;
  }

  /** Check DC per profession slot (book p.218). `null` when that slot has no profession set. */
  _prepareCheckDc() {
    const courage = this.stats.courage?.value ?? 0;
    this.checkDc = {};
    for (const slot of ["primary", "secondary"]) {
      const key = this.professions[slot].key;
      const statKey = CONFIG.SACADIA.professionCheckDcStat[key];
      this.checkDc[slot] = (key && statKey)
        ? checkDc({ professionStat: this.stats[statKey]?.value ?? 0, proficiency: this.proficiency, courage })
        : null;
    }
  }

  /* -------------------------------------------- */

  getRollData() {
    const data = super.getRollData(); // raw stat values
    data.proficiency = this.proficiency;
    data.level = data.lvl = this.level;
    return data;
  }
}
