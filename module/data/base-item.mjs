import SacadiaDataModel from "./base-model.mjs";

export default class SacadiaItemBase extends SacadiaDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = {};

    schema.description = new fields.StringField({ required: true, blank: true });

    return schema;
  }

  /**
   * The **weapon facet** — the fields that make an item attackable. Shared by `gear` (weapons) and
   * `armor` (shields, which are armor that can Bash), so the same binding/generation logic (see
   * module/sacadia.mjs, actor-sheet #resolveWeapon) drives both. Inert until `weaponType` is set:
   * blank means the item is plain inventory / armor, not a weapon. `weaponDamage` mirrors an ability
   * damage part so it flows into the damage roll; `defense` is the targeted defense; `range` the
   * reach/throw for the out-of-range check; `hands` supports dual-wield / sword+shield reasoning.
   */
  /**
   * Item slots (book pp.180–181): how many slots the item takes, and where it's kept — a Readied Item Slot (RIS: at hand
   * in combat; you start with 5) or a Stored Item Slot (SIS: in your bags, reachable only on a rest). `providesSis` is a
   * bag's storage. Shared by gear and armor.
   */
  static slotFacet() {
    const fields = foundry.data.fields;
    return {
      slots: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
      storage: new fields.StringField({ required: true, blank: false, initial: 'ris', choices: ['ris', 'sis'] }),
      providesSis: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    };
  }

  static weaponFacet() {
    const fields = foundry.data.fields;
    return {
      weaponType: new fields.StringField({
        required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.weaponTypes),
      }),
      weaponDamage: new fields.SchemaField({
        count: new fields.StringField({ required: true, blank: true, initial: '1' }),
        denomination: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        trait: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.stats) }),
      }),
      hands: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1, max: 2 }),
      defense: new fields.StringField({
        required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.defenseLabels),
      }),
      damageType: new fields.StringField({ required: true, blank: true }),
      range: new fields.SchemaField({
        type: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.rangeTypes) }),
        value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
      }),
    };
  }

}