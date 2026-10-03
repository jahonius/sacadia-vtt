import SacadiaItemBase from "./base-item.mjs";
import { ARMOR_MATERIALS } from "../helpers/actor-utils.mjs";

/**
 * Armor Item. When equipped, its flat defense bonuses sum into the actor's defenses and its
 * `maxStat` caps how much of each governing stat counts (book pp.192–194). Styles / adornments /
 * trinkets (the deeper armor content, incl. the "adornment as a triggered effect" treatment,
 * Roll20 gap #8) are deferred to a later Phase-5 slice / Phase 9.
 */
export default class SacadiaArmor extends SacadiaItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const int = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema(); // description

    schema.equipped = new fields.BooleanField({ initial: false });
    // Armor weight class (book pp.192–194). Blank = unclassified. Each equipped armor advertises
    // `self:armor:<category>`; a derived `self:armor:only-light` fires when every worn armor is light.
    schema.category = new fields.StringField({
      required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.armorCategories),
    });
    // What it's made of (book p.190 armor types): Lodestone reads iron, Divine Protection cloth. Set by the build; a
    // homebrew piece left blank is read from its name (helpers/actor-utils.mjs armorMaterial).
    schema.material = new fields.StringField({ required: true, blank: true, choices: ARMOR_MATERIALS });
    // A shield's size (book p.195): bucklers take 1 item slot, shields 2, tower shields 3 (−5ft Move).
    schema.shieldSize = new fields.StringField({ required: true, blank: true, choices: ['buckler', 'shield', 'tower'] });
    schema.defenses = new fields.SchemaField({
      ad: new fields.NumberField({ ...int, initial: 0 }),
      pd: new fields.NumberField({ ...int, initial: 0 }),
      td: new fields.NumberField({ ...int, initial: 0 }),
      md: new fields.NumberField({ ...int, initial: 0 }),
      dr: new fields.NumberField({ ...int, initial: 0 }),
    });
    // Rend taken by this piece (book p.258): points removed from each defense until a rest repairs them. A piece with
    // every point rended is broken. Written by module/helpers/rend.mjs as the wearer's Rended level changes.
    schema.rend = new fields.SchemaField({
      ad: new fields.NumberField({ ...int, initial: 0, min: 0 }),
      pd: new fields.NumberField({ ...int, initial: 0, min: 0 }),
      td: new fields.NumberField({ ...int, initial: 0, min: 0 }),
      md: new fields.NumberField({ ...int, initial: 0, min: 0 }),
      dr: new fields.NumberField({ ...int, initial: 0, min: 0 }),
    });
    // Max Stat cap (null = uncapped); caps the governing stat contribution to each defense.
    schema.maxStat = new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 });

    // Weapon facet (shared with gear — see SacadiaItemBase.weaponFacet). A *shield* is armor whose flat
    // PD/TD sums into defenses (with no Max Stat, so it doesn't count against the cap — book p.196) AND
    // carries a Shield Bash: set `weaponType` to 'shield' with bash dice, and it gains a generated attack
    // like any weapon. Blank on normal armor.
    Object.assign(schema, SacadiaItemBase.weaponFacet());
    Object.assign(schema, SacadiaItemBase.slotFacet());

    return schema;
  }
}
