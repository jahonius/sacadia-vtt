import SacadiaItemBase from "./base-item.mjs";

/**
 * Where a character comes from (book Section I): their **Culture** and their **Ancestry** within a Heritage. A character
 * holds one of each, as an item; the Heritage itself is the `identity.heritage` key (six, fixed: CONFIG.SACADIA.heritageInfo).
 * The rulebook's are in the Cultures and Heritages & Ancestries compendiums; a table makes its own the same way (Myths of
 * Sacadia's cultures, the book's "Making New Humans").
 *
 * Both grant abilities while held (rules/identity.mjs): `grants` are ability uuids, each optionally tied to one of the
 * item's `options` (a choice made when you take it: the Cunei cultural talent). An ancestry's grant may instead name the
 * Heritage's choice (a Fontborne ancestry's Lightly / Heavily Warped ability).
 */
class SacadiaOriginBase extends SacadiaItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema(); // description
    schema.grants = new fields.ArrayField(new fields.SchemaField({
      uuid: new fields.StringField({ required: true, blank: true }),
      // Blank: always granted. Otherwise an `options` key (or, for an ancestry, a Heritage choice key).
      option: new fields.StringField({ required: true, blank: true }),
    }));
    schema.options = new fields.ArrayField(new fields.SchemaField({
      key: new fields.StringField({ required: true, blank: false }),
      label: new fields.StringField({ required: true, blank: true }),
    }));
    // The option taken (on a character's copy).
    schema.choice = new fields.StringField({ required: true, blank: true });
    return schema;
  }
}

/** A culture (book Chapter II): its Binding Laws and Customs, its language and cultural talent, and its subcultures. */
export class SacadiaCulture extends SacadiaOriginBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    // Other names the rulebook's prerequisites use for it ("Cunei" for the Cunei Myrgha), comma-separated.
    schema.aliases = new fields.StringField({ required: true, blank: true });
    // Binding Laws and Customs: "If you play a Tianqi, you are bound by these". Some are optional (the Cunei prejudices).
    schema.laws = new fields.ArrayField(new fields.SchemaField({
      name: new fields.StringField({ required: true, blank: true }),
      text: new fields.StringField({ required: true, blank: true }),
      optional: new fields.BooleanField({ initial: false }),
    }));
    // Subcultures (the White and Black Cunei), and the one a character belongs to.
    schema.subcultures = new fields.ArrayField(new fields.StringField({ required: true, blank: false }));
    schema.subculture = new fields.StringField({ required: true, blank: true });
    // Its Cultural Tapestry: a journal entry's uuid.
    schema.journal = new fields.StringField({ required: true, blank: true });
    return schema;
  }
}

/** An ancestry (book Chapter III, and the culture chapters' unique ancestries): its Heritage, size and lifespan. */
export class SacadiaAncestry extends SacadiaOriginBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();
    schema.heritage = new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.heritages) });
    // Blank: the Heritage's (CONFIG.SACADIA.heritageInfo).
    schema.size = new fields.StringField({ required: true, blank: true });
    schema.lifespan = new fields.StringField({ required: true, blank: true });
    return schema;
  }
}
