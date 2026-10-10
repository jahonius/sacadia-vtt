/**
 * Define a set of template paths to pre-load.
 * Pre-loaded templates are compiled and cached for fast access when rendering. ApplicationV2
 * loads its own PARTS on demand, but preloading keeps first render snappy.
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  return foundry.applications.handlebars.loadTemplates([
    // Actor sheet parts.
    'systems/sacadia/templates/actor/parts/actor-header.hbs',
    'systems/sacadia/templates/actor/parts/actor-tabs.hbs',
    'systems/sacadia/templates/actor/parts/actor-stats.hbs',
    'systems/sacadia/templates/actor/parts/actor-abilities.hbs',
    'systems/sacadia/templates/actor/parts/actor-conditions.hbs',
    'systems/sacadia/templates/actor/parts/actor-inventory.hbs',
    'systems/sacadia/templates/actor/parts/actor-biography.hbs',
    'systems/sacadia/templates/actor/parts/actor-effects.hbs',
    // Item sheet parts.
    'systems/sacadia/templates/item/parts/item-header.hbs',
    'systems/sacadia/templates/item/parts/item-tabs.hbs',
    'systems/sacadia/templates/item/parts/item-description.hbs',
    'systems/sacadia/templates/item/parts/item-attributes.hbs',
    'systems/sacadia/templates/item/parts/item-effects.hbs',
    // Chat cards.
    'systems/sacadia/templates/chat/ability-card.hbs',
    'systems/sacadia/templates/chat/check-card.hbs',
    // Applications.
    'systems/sacadia/templates/apps/travel-ledger.hbs',
    'systems/sacadia/templates/apps/long-rest.hbs',
  ]);
};
