import SacadiaActorBase from "./base-actor.mjs";
import { rendTotals } from "../helpers/rend.mjs";

/**
 * Deliberately lean NPC / monster stat block. Shares the five stats, Health, conditions, and the
 * action economy with {@link SacadiaActorBase}, but its **defenses are hand-authored by the GM**
 * (a monster is a stat block, not a derived character): AD/PD/TD/MD/DR are stored, editable numbers
 * rather than the `11 + stat + armor` formula. Temporary buffs/conditions still move them via the
 * `bonuses.defense` sink, so combat automation works the same on NPCs. Plus a CR and a role.
 */
export default class SacadiaNPC extends SacadiaActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.cr = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.role = new fields.StringField({ required: true, blank: true });
    // Check DC (book p218): the flat stat-block number a target rolls against when this monster
    // gives it a condition / forces a save. Characters derive `checkDc` per profession slot; a
    // monster just stores one number the GM authors. Referenced when a player resists a condition
    // from this creature (see resolveResist).
    schema.checkDc = new fields.NumberField({ ...requiredInteger, initial: 12, min: 0 });
    // Creature type (Sentinel's Favored Enemy) — drives `target:type:<t>` / `target:favored`.
    schema.creatureType = new fields.StringField({
      required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.creatureTypes),
    });
    // Base Move Speed in feet (a stat-block number; 30 when unset). The derived `speed` object that
    // `_prepareSpeed` builds replaces this at prepare time, as it does for characters.
    schema.speed = new fields.NumberField({ ...requiredInteger, initial: 30, min: 0 });

    // GM-authored base defenses (the stat-block numbers). Effect/condition bonuses add on top in
    // derived data; AD defaults to a sensible floor.
    schema.defenses = new fields.SchemaField(["ad", "pd", "td", "md", "dr"].reduce((obj, key) => {
      obj[key] = new fields.NumberField({ ...requiredInteger, initial: key === "dr" ? 0 : 11, min: 0 });
      return obj;
    }, {}));

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData(); // stats, action points, ability mods — and our _prepareDefenses below
  }

  /**
   * Build the display defenses from the GM's stored numbers plus the `bonuses.defense` sink
   * (temporary effects / conditions), instead of the character's `11 + stat` formula. AD is still a
   * floor: a defense AD exceeds is flagged `supersededByAd` for the sheet.
   * @override
   */
  _prepareDefenses() {
    // `this.defenses` holds the raw stored numbers at this point (post-AE, pre-display); capture
    // them before we replace it with the display object.
    const raw = { ad: 0, pd: 0, td: 0, md: 0, dr: 0, ...this.defenses };
    const bonus = this.bonuses?.defense ?? {};
    // Rend on the armor the creature wears (its stat-block numbers already count that armor). A creature wearing none
    // can't be rended (designer's ruling).
    const rended = this.parent ? rendTotals(this.parent) : {};
    this.defenses = {};
    for (const def of ["ad", "pd", "td", "md", "dr"]) {
      this.defenses[def] = {
        base: raw[def] ?? 0, // GM-authored number the sheet input edits
        // effective, used by combat resolution: less any Rend on its armor
        value: (raw[def] ?? 0) - (rended[def] ?? 0) + (bonus[def] ?? 0),
        rended: rended[def] ?? 0,
        label: game.i18n.localize(`SACADIA.Defense.${def.toUpperCase()}`),
      };
    }
    const ad = this.defenses.ad.value;
    for (const def of ["pd", "td", "md"]) {
      this.defenses[def].supersededByAd = ad > this.defenses[def].value;
    }
  }
}
