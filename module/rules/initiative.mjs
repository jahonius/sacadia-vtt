/**
 * Initiative from a sheet (book p.233): a Courage or Finesse Check, whichever is better, using the formula in
 * `CONFIG.Combat.initiative` (sacadia.mjs). Foundry's own roll does the work. It adds the actor's tokens on the scene to
 * the encounter if they aren't in it yet (a GM with no encounter gets one on the viewed scene), then rolls for whichever
 * of the actor's combatants have no initiative. Rolling again is the GM's call, from the Combat Tracker.
 */

/**
 * Roll initiative for an actor, or say that it already has.
 * @param {Actor} actor
 * @returns {Promise<Combat|null>} the encounter rolled in, or null if nothing was rolled
 */
export async function rollInitiative(actor) {
  const mine = (c) => (actor.isToken ? c.token === actor.token : c.actor === actor);
  const combatants = game.combat?.combatants.filter(mine) ?? [];
  const joining = actor.getActiveTokens().some((t) => !t.inCombat);
  if (combatants.length && !joining && combatants.every((c) => c.initiative !== null)) {
    ui.notifications.info(game.i18n.format('SACADIA.Initiative.AlreadyRolled',
      { name: actor.name, initiative: combatants.map((c) => c.initiative).join(', ') }));
    return null;
  }
  return actor.rollInitiative({ createCombatants: true });
}
