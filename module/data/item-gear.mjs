import SacadiaItemBase from "./base-item.mjs";

/**
 * Plain inventory item. Its sheet/UI is fleshed out with the Inventory tab in Phase 5.
 */
export default class SacadiaGear extends SacadiaItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema(); // description

    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.weight = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });
    schema.value = new fields.NumberField({ required: true, nullable: false, initial: 0, min: 0 });

    // Whether this item is currently wielded/worn — gates its `self:wielding:*` roll options.
    schema.equipped = new fields.BooleanField({ initial: false });
    // Freeform weapon/item traits (comma- or space-separated), e.g. "sword, one-handed, melee" or
    // "heavy". The book's weapon taxonomy is open (players name the type they're trained in), so this
    // is a tag list, not a fixed enum. Each trait becomes a `self:wielding:<trait>` roll option while
    // equipped (see docs/conditional-modifiers.md).
    schema.traits = new fields.StringField({ required: true, blank: true });

    // Weapon facet (shared with armor/shields — see SacadiaItemBase.weaponFacet). Inert until
    // `weaponType` is set; a set type turns this gear into a weapon (base dice + reach + `self:wielding:
    // <type>` gating), and adding it to a character auto-creates its attack ability.
    Object.assign(schema, SacadiaItemBase.weaponFacet());
    Object.assign(schema, SacadiaItemBase.slotFacet());

    return schema;
  }
}
