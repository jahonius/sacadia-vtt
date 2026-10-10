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
import { ownsAbility } from "../helpers/actor-utils.mjs";

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

    // Character identity (book Ch. I–III), on the Character tab. Heritage is one of the six; the culture and the
    // ancestry are items the character holds (data/item-origin.mjs). `culture` / `ancestry` are their names as written
    // before those items existed (0.3.8), shown until one is chosen. `heritageChoice` is the choice a Heritage asks for
    // (CONFIG.SACADIA.heritageInfo: Natural Charisma, Strength of Warp). Age/size are recorded as free text.
    const heritageKeys = Object.keys(CONFIG.SACADIA.heritages);
    schema.identity = new fields.SchemaField({
      culture: new fields.StringField({ required: true, blank: true }),
      heritage: new fields.StringField({ required: true, blank: true, choices: heritageKeys }),
      heritageChoice: new fields.StringField({ required: true, blank: true }),
      ancestry: new fields.StringField({ required: true, blank: true }),
      age: new fields.StringField({ required: true, blank: true }),
      size: new fields.StringField({ required: true, blank: true })
    });

    // Background prompts, taken from the book's "Creating your Background" step (p.18). Plain-text
    // (textarea) fields for quick writing; the general narrative lives in the shared `biography`.
    const noteField = () => new fields.StringField({ required: true, blank: true });
    schema.background = new fields.SchemaField({
      appearance: noteField(),
      connections: noteField(),
      beliefs: noteField(),
      secrets: noteField(),
      culturalTies: noteField(),
      mementos: noteField()
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

    // Specialized talents (book p.146): a named specialization of a general talent with 1–3 ranks (a cultural specialty
    // adds one more). Rolled as the general talent with 1X advantage per rank. Also what prerequisites like Handcopy[2]
    // and Religion: Astrology[3] check against.
    schema.specialties = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      talent: new fields.StringField({ required: true, blank: true }),
      rank: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0, max: 6 }),
      // A rank given by an ability (a cultural talent's "1 level in Economy: Appraisal, even if you do not have Economy"):
      // its catalog id. Added and taken back with that ability (rules/identity.mjs); it needs no general talent.
      source: new fields.StringField({ required: true, blank: true }),
    }));

    // Money (book p.180; helpers/downtime.mjs): gold coins (the book's gc, also written gp) and silver coins (sc). How many
    // silver make a gold is a world setting.
    schema.money = new fields.SchemaField({
      gc: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      sc: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    });

    // Influence (book p.264): favor with a group (a guild, a temple, a city's people …), gained as a Long Rest Action and
    // spent while the group is present.
    schema.influence = new fields.ArrayField(new fields.SchemaField({
      group: new fields.StringField({ required: true, blank: true }),
      value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
    }));

    // (Leveled conditions live on the shared base actor.)

    // (Limb-exhaustion tracker + per-turn action log also live on the shared base actor.)

    // Profession-scoped resources, shown by active profession. Oracle: Insanity flag + saved
    // Slightly Cracked d3 rolls. (Madness itself lives in `conditions.madness`.)
    schema.professionResources = new fields.SchemaField({
      oracle: new fields.SchemaField({
        insane: new fields.BooleanField({ initial: false }),
        cracked: new fields.ArrayField(new fields.NumberField({ ...requiredInteger, min: 1, max: 3 }))
      }),
      // Sentinel (legacy, before 0.3.6): Favored Enemy types and Bigger Stones counts. They're now picks on those
      // abilities' own cards; these fields are only read by the one-time move onto them (helpers/legacy-picks.mjs).
      sentinel: new fields.SchemaField({
        favored: new fields.ArrayField(new fields.StringField({
          required: true, blank: false, choices: Object.keys(CONFIG.SACADIA.creatureTypes),
        })),
        biggerStones: new fields.SchemaField({
          bow: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 2 }),
          crossbow: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 2 }),
          sling: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 2 }),
        }),
      }),
      // Hulinari Warrior: the subtype that shapes your beast form (Pack / Brute / Swarm).
      hulinari: new fields.SchemaField({
        form: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.hulinariForms) }),
      }),
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
    const owns = (id) => ownsAbility(this.parent, id);
    for (const [pool, { grant, scale }] of Object.entries(CONFIG.SACADIA.poolGrants)) {
      const cp = this.classPools?.[pool];
      if (!cp || !owns(grant)) continue;
      cp.max = owns(scale) ? this.proficiency * 2 : this.proficiency;
    }
    // Poolmonger: "Choose one Action Pool … Increase the number of points you have by 1" (per instance).
    for (const { id, value } of this._picks?.().pool ?? []) {
      const cp = this.classPools?.[value];
      if (id === 'poolmonger' && cp && cp.max > 0) cp.max += 1;
    }
    // Legendary Masteries that enlarge a pool by two (Aristeia → Glory, Trick → Trickshot, Vision → Prescient).
    for (const [id, pool] of [['legendary_aristeia', 'glory'], ['legendary_trick', 'trickshot'], ['legendary_vision', 'prescient']]) {
      const cp = this.classPools?.[pool];
      if (cp && cp.max > 0 && owns(id)) cp.max += 2;
    }
    // Flat per-ability additions (the Magus's "Gain 3 Spell Slots" features — each owned instance counts).
    for (const [pool, table] of Object.entries(CONFIG.SACADIA.poolBonuses ?? {})) {
      const cp = this.classPools?.[pool];
      if (!cp) continue;
      for (const i of this.parent?.items ?? []) {
        const add = i.type === 'ability' ? table[i.flags?.sacadia?.catalogId] : 0;
        if (add) cp.max += add;
      }
    }
    // Clamp down only after every bonus is in (a refill to the enlarged max must survive re-prep).
    for (const [pool, { grant }] of Object.entries(CONFIG.SACADIA.poolGrants)) {
      const cp = this.classPools?.[pool];
      if (cp && (owns(grant) || cp.max > 0) && cp.value > cp.max) cp.value = cp.max;
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
    // Each profession's own level (`@professionLevel.magus`) — prestige features scale with it.
    for (const slot of ['primary', 'secondary']) {
      const p = this.professions?.[slot];
      if (p?.key) n[`professionLevel.${p.key}`] = p.level ?? 0;
    }
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

    // Max Health: the standard (non-rolling) value — each profession track's HP/level × its level —
    // plus the manual `bonus`. Derived, so setting Oracle 7 gives 49 automatically; `value` clamps to it.
    const { primary, secondary } = this.professions;
    const hp = CONFIG.SACADIA.professionHpPerLevel;
    this.health.standardMax = suggestedMaxHealth([
      { hpPerLevel: hp[primary.key], level: primary.level },
      { hpPerLevel: hp[secondary.key], level: secondary.level }
    ]);
    // The Heritage's HP at Level 1, added once (book p.80). `bonuses.healthMax` carries owned `health.max` modifiers
    // (Living Wall's +2/level, Strong Constitution's +1/level), folded in during super.prepareDerivedData()'s
    // `_prepareModifiers` — so it's populated by the time we get here.
    this.health.heritage = CONFIG.SACADIA.heritageInfo[this.identity?.heritage]?.hp ?? 0;
    this.health.max = Math.max(0, this.health.standardMax + this.health.heritage + (this.health.bonus ?? 0) + (this.bonuses?.healthMax ?? 0));
    if (this.health.value > this.health.max) this.health.value = this.health.max;
    // Healthy Soul (General): "Increase the number of HP pools you receive by 1."
    const healthySoul = this.parent?.items?.some((i) => i.flags?.sacadia?.catalogId === 'healthy_soul') ? 1 : 0;
    this.healthPools.suggestedMax = suggestedMaxHealthPools(level, this.stats.power?.value ?? 0) + healthySoul;
  }

  /**
   * Σ `cspCost` across owned ability Items. Ability Items arrive in Phase 4; until then no item
   * is of type `ability`, so this is 0.
   * @returns {number}
   */
  _cspSpent() {
    let spent = 0;
    // An ability taken twice (Bigger Stones) is two items, so it costs twice.
    for (const item of this.parent?.items ?? []) {
      if (item.type === "ability") spent += item.system?.costs?.csp ?? 0;
    }
    return spent;
  }

  /** Check DC per profession slot (book p.218). `null` when that slot has no profession set. */
  _prepareCheckDc() {
    const courage = this.stats.courage?.value ?? 0;
    this.checkDc = {};
    // Flat Check-DC bonus (Check Please's +1), folded from `checkDc`-target modifiers during
    // _prepareModifiers (which ran in super.prepareDerivedData(), so it's populated by now).
    const dcBonus = this.bonuses?.checkDc ?? 0;
    for (const slot of ["primary", "secondary"]) {
      const key = this.professions[slot].key;
      const statKey = CONFIG.SACADIA.professionCheckDcStat[key];
      this.checkDc[slot] = (key && statKey)
        ? checkDc({ professionStat: this.stats[statKey]?.value ?? 0, proficiency: this.proficiency, courage }) + dcBonus
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
