/**
 * Prepare the data structure for Active Effects which are currently embedded in an Actor or Item.
 * @param {ActiveEffect[]} effects    A collection or generator of Active Effect documents to prepare sheet data for
 * @return {object}                   Data for rendering
 */
export function prepareActiveEffectCategories(effects) {
  // Define effect header categories
  const categories = {
    temporary: {
      type: 'temporary',
      label: game.i18n.localize('SACADIA.Effect.Temporary'),
      effects: [],
    },
    passive: {
      type: 'passive',
      label: game.i18n.localize('SACADIA.Effect.Passive'),
      effects: [],
    },
    inactive: {
      type: 'inactive',
      label: game.i18n.localize('SACADIA.Effect.Inactive'),
      effects: [],
    },
  };

  // Leveled-condition + cover status effects are projections of the schema tracker (see
  // syncConditionEffects). They're managed by the Stats-tab tracker / Cover selector and shown on the
  // token, so keep them out of the Effects tab to avoid a duplicate, desync-prone surface.
  const projected = new Set([
    ...Object.keys(CONFIG.SACADIA.conditions),
    ...Object.keys(CONFIG.SACADIA.coverStates).filter((k) => k !== 'none').map((k) => `cover-${k}`),
  ]);

  // Iterate over active effects, classifying them into categories
  for (let e of effects) {
    if ([...(e.statuses ?? [])].some((id) => projected.has(id))) continue;
    if (e.disabled) categories.inactive.effects.push(e);
    else if (e.isTemporary) categories.temporary.effects.push(e);
    else categories.passive.effects.push(e);
  }
  return categories;
}
