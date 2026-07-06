import SacadiaDataModel from "./base-model.mjs";
import { defenseValue } from "../helpers/derivation.mjs";

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

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    this._prepareStats();
    this._prepareDefenses();
  }

  /** Localized label + signed display string for each stat. */
  _prepareStats() {
    for (const [key, stat] of Object.entries(this.stats)) {
      stat.label = game.i18n.localize(CONFIG.SACADIA.stats[key]) ?? key;
      stat.display = stat.value >= 0 ? `+${stat.value}` : `${stat.value}`;
    }
  }

  /**
   * Derive AD/PD/TD/MD independently (`11 + governing stat + armor`), plus DR. AD is a floor:
   * where AD exceeds another defense, that defense keeps its own true value and is flagged
   * `supersededByAd` for display (never overwritten — the Roll20 `_override_note` pattern).
   */
  _prepareDefenses() {
    const armor = this._armorContribution();
    this.defenses = {};
    for (const [def, statKey] of Object.entries(CONFIG.SACADIA.defenseStat)) {
      this.defenses[def] = {
        value: defenseValue({ stat: this.stats[statKey]?.value ?? 0, armor: armor[def] ?? 0 }),
        statKey,
        label: game.i18n.localize(`SACADIA.Defense.${def.toUpperCase()}`)
      };
    }
    this.defenses.dr = { value: armor.dr ?? 0, label: game.i18n.localize("SACADIA.Defense.DR") };

    const ad = this.defenses.ad.value;
    for (const def of ["pd", "td", "md"]) {
      this.defenses[def].supersededByAd = ad > this.defenses[def].value;
    }
  }

  /**
   * Armor + effect contribution to each defense/DR. Stub for Phase 2 (returns zeroes); armor
   * Items and Active Effects wire their bonuses in here at Phase 5.
   * @returns {{ad: number, pd: number, td: number, md: number, dr: number}}
   */
  _armorContribution() {
    return { ad: 0, pd: 0, td: 0, md: 0, dr: 0 };
  }

  /* -------------------------------------------- */

  getRollData() {
    const data = {};
    // Expose raw stat values at the top level so roll formulas can use `@power`, `@fate`, …
    for (const [key, stat] of Object.entries(this.stats)) {
      data[key] = stat.value;
    }
    return data;
  }
}
