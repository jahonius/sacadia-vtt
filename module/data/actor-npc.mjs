import SacadiaActorBase from "./base-actor.mjs";

/**
 * Deliberately lean NPC / monster stat block: the shared stats + defenses + health from
 * {@link SacadiaActorBase} (so combat derivation "just works"), plus a challenge rating and a
 * freeform role. Attacks/abilities are embedded Items (Phase 4/6); no CSP/talent/profession
 * machinery.
 */
export default class SacadiaNPC extends SacadiaActorBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.cr = new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 });
    schema.role = new fields.StringField({ required: true, blank: true });

    return schema;
  }

  prepareDerivedData() {
    super.prepareDerivedData(); // stats + defenses
  }
}
