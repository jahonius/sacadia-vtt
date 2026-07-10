import SacadiaActorBase from "./base-actor.mjs";
import {
  proficiencyForLevel,
  maxApForLevel,
  maxCspForLevel,
  checkDc,
  loreLimit,
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

    // (Action economy — ap / exhaustion / actionLog — lives on the shared base actor.)

    // Health Pools — like Health, max stays player-editable; a suggested max is derived.
    schema.healthPools = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // Lore Points — a heroic-campaign resource. Max (the Lore Limit) is derived from Level + Fate;
    // `value` is spent in play and refilled to max on a Long Rest (book pp.167–176).
    schema.lorePoints = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    // Freeform action pools (mana / ki / custom …).
    schema.pools = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    }));

    // Signature class pools (Arrangement/Glory/Prescient/…). Max stays player-editable (most are
    // ability-granted and refresh on a rest); abilities auto-spend `value`.
    schema.classPools = new fields.SchemaField(Object.keys(CONFIG.SACADIA.pools).reduce((obj, key) => {
      obj[key] = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
      });
      return obj;
    }, {}));

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

    // (Leveled conditions live on the shared base actor.)

    // (Limb-exhaustion tracker + per-turn action log also live on the shared base actor.)

    // Profession-scoped resources, shown by active profession. Oracle: Insanity flag + saved
    // Slightly Cracked d3 rolls. (Madness itself lives in `conditions.madness`.)
    schema.professionResources = new fields.SchemaField({
      oracle: new fields.SchemaField({
        insane: new fields.BooleanField({ initial: false }),
        cracked: new fields.ArrayField(new fields.NumberField({ ...requiredInteger, min: 1, max: 3 }))
      }),
      // Sentinel: the chosen Favored Enemy creature type(s). Buffs vs favored key off `target:favored`.
      sentinel: new fields.SchemaField({
        favored: new fields.ArrayField(new fields.StringField({
          required: true, blank: false, choices: Object.keys(CONFIG.SACADIA.creatureTypes),
        }))
      })
    });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    super.prepareDerivedData(); // stats + defenses
    this._prepareProgression();
    this._preparePools();
    this._prepareCheckDc();
  }

  /**
   * Derive each class point-pool's max from the ability that grants it (CONFIG.poolGrants): owning the
   * grant ability sets max to Proficiency, and the level-6 scaling passive doubles it. Ungranted pools
   * stay at max 0. Value is only clamped *down* to max — refilling to max is a rest action, not derived.
   */
  _preparePools() {
    const owns = (id) => id && this.parent?.items?.some(
      (i) => i.type === 'ability' && (i.flags?.sacadia?.catalogId ?? i.id) === id);
    for (const [pool, { grant, scale }] of Object.entries(CONFIG.SACADIA.poolGrants)) {
      const cp = this.classPools?.[pool];
      if (!cp || !owns(grant)) continue;
      cp.max = owns(scale) ? this.proficiency * 2 : this.proficiency;
      if (cp.value > cp.max) cp.value = cp.max;
    }
  }

  /** A character's base Max AP is derived from level; the base actor then subtracts Fatigue. */
  _baseMaxAp() {
    return maxApForLevel(this.level);
  }

  /** The character's set professions, for `self:profession:*` roll options. */
  _professionKeys() {
    return ['primary', 'secondary'].map((slot) => this.professions?.[slot]?.key).filter(Boolean);
  }

  /**
   * Number map for modifier `@ref` resolution — adds Proficiency + level so modifier values like
   * `min(@combat.consecutiveHits, @proficiency)` resolve. Proficiency is computed straight from level
   * (not read off `this.proficiency`, which the progression step sets *after* modifiers fold).
   */
  _modifierNumbers() {
    const n = super._modifierNumbers();
    n.proficiency = proficiencyForLevel(this.level);
    n.level = n.lvl = this.level;
    return n;
  }

  /** Proficiency, CSP budget, and suggested Health/Health-Pool maxes. (Max AP is derived in base.) */
  _prepareProgression() {
    const level = this.level;
    this.proficiency = proficiencyForLevel(level);

    // CSP: max from level; spent = Σ owned ability `cspCost` (Phase 4 → 0 until ability Items
    // exist); current is fully derived, so a level-up never silently un-spends bought points.
    const max = maxCspForLevel(level);
    const spent = this._cspSpent();
    this.csp = { max, spent, current: max - spent };

    // Lore Limit (the Lore Points max) from Level + Fate; value stays player-editable/spendable.
    this.lorePoints.max = loreLimit(level, this.stats.fate?.value ?? 0);

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
      if (item.type === "ability") spent += item.system?.costs?.csp ?? 0;
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
