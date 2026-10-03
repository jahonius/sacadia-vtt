/**
 * Weapon → its generated attack abilities. Adding a weapon (gear or a shield with a `weaponType`) to a character gives
 * it a companion attack ability, and a Versatile weapon a companion throw. Runs on the acting client; the item hooks
 * live in sacadia.mjs, and a compendium refresh (helpers/refresh.mjs) rebuilds them through `rebuildWeaponAttacks`.
 */

// Adding a weapon (gear with a `weaponType`) to a character gives it a companion attack ability — bound
// to the weapon, category/defense/range copied from it, damage parts left empty so it rolls the weapon's
// base dice live via the cast-time binding. Tagged `flags.sacadia.weaponAttack = <weaponId>` so it's
// removed when the weapon is deleted (or its weaponType cleared). Generate-once: the player may freely
// edit the generated ability afterwards; only creation/removal is automated. Runs on the acting client.
export function isWeaponItem(item) {
  return (item?.type === 'gear' || item?.type === 'armor') && !!item.system?.weaponType
    && item.parent?.documentName === 'Actor' && item.parent.type === 'character';
}

/**
 * The attack category (→ to-hit/damage trait) follows the book's rule, not the weapon family: Wiles for
 * magical weapons (those targeting MD), Finesse for physical ranged, Power for melee (p.218). So a thrown
 * dagger (vs TD, ranged) is Finesse and an imbued blade (vs MD) is Wiles regardless of reach.
 */
export function weaponAttackCategory(weapon) {
  if (weapon.system.defense === 'md') return 'magic';
  if (weapon.system.range?.type === 'ranged') return 'ranged';
  return 'melee';
}

/** Build the companion attack-ability document for a weapon (or a shield's Bash). */
export function buildWeaponAttack(weapon) {
  const category = weaponAttackCategory(weapon);
  const range = weapon.system.range ?? {};
  const nameKey = weapon.system.weaponType === 'shield' ? 'SACADIA.Weapon.BashName' : 'SACADIA.Weapon.AttackName';
  return {
    name: game.i18n.format(nameKey, { weapon: weapon.name }),
    type: 'ability',
    img: weapon.img,
    system: {
      tag: 'action',
      costs: { ap: 1, limbs: weapon.system.hands >= 2 ? ['twoArm'] : ['oneArm'] },
      range: { type: range.type || (category === 'ranged' ? 'ranged' : 'melee'), value: range.value ?? null },
      activities: [{
        type: 'attack',
        attack: { category, defense: weapon.system.defense || 'pd' },
        damage: [], // empty → pulls the weapon's base dice at cast time (see actor-sheet #resolveWeapon)
      }],
    },
    // `weapon` binds the attack; `weaponAttack` marks it auto-generated (for cleanup).
    flags: { sacadia: { weapon: weapon.id, weaponAttack: weapon.id } },
  };
}

/**
 * The companion *throw* for a Versatile weapon ("may be thrown up to 40ft"): a ranged attack (Finesse) with
 * the same weapon, flagged `thrown` so thrown-weapon abilities key off it (I'll Come Back, Exploding Weapon).
 */
export function buildWeaponThrow(weapon) {
  return {
    name: game.i18n.format('SACADIA.Weapon.ThrowName', { weapon: weapon.name }),
    type: 'ability',
    img: weapon.img,
    system: {
      tag: 'action',
      costs: { ap: 1, limbs: ['oneArm'] },
      range: { type: 'ranged', value: 40 },
      activities: [{ type: 'attack', attack: { category: 'ranged', defense: weapon.system.defense || 'pd' }, damage: [] }],
    },
    flags: { sacadia: { weapon: weapon.id, weaponAttack: weapon.id, thrown: true } },
  };
}

export const isVersatile = (weapon) => /\bversatile\b/i.test(weapon.system?.traits ?? '');

/** Create the companion attack (and, for a Versatile weapon, its throw) unless they already exist. */
export async function grantWeaponAttack(weapon) {
  const actor = weapon.parent;
  const mine = actor.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id);
  const docs = [];
  if (!mine.some((i) => !i.getFlag('sacadia', 'thrown'))) docs.push(buildWeaponAttack(weapon));
  if (isVersatile(weapon) && !mine.some((i) => i.getFlag('sacadia', 'thrown'))) docs.push(buildWeaponThrow(weapon));
  if (docs.length) await actor.createEmbeddedDocuments('Item', docs);
}

/** Remove any companion attacks bound to a weapon id. */
export async function removeWeaponAttack(actor, weaponId) {
  const stale = actor.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === weaponId).map((i) => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments('Item', stale);
}

/**
 * Rebuild a weapon's generated attacks from its current data (after a compendium refresh changed what they copy). Any
 * edits made to the generated attacks are replaced.
 */
export async function rebuildWeaponAttacks(weapon) {
  if (!weapon?.parent) return;
  await removeWeaponAttack(weapon.parent, weapon.id);
  if (isWeaponItem(weapon)) await grantWeaponAttack(weapon);
}
