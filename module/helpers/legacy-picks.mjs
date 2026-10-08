/**
 * 0.3.6 moved the choices some abilities make when they're taken onto those abilities' cards (picks). `migratePicks` brings
 * an existing actor along, once, on the GM's load:
 * - an owned copy of an ability that gained a pick is refreshed from the compendium (an older copy has no pick to show);
 * - a Sentinel's old Favored Enemy and Bigger Stones settings move onto the abilities (`moveLegacySentinelPicks`);
 * - a Fatebound with Fated Strike and no divine weapon marked, who owns one melee weapon, has it marked
 *   (`markLoneDivineWeapon`): Fated Strike's +Fate used to apply to every melee attack, and now applies to the divine one.
 */

import { refreshItems, staleItems } from './refresh.mjs';

/** The abilities that gained a pick (or a second one) in 0.3.6. */
const GAINED_PICK = ['favored_enemy', 'i_favor_all_enemies', 'legendary_favored', 'bigger_stones', 'favored_style', 'mastery_sling',
  'fated_strike', 'bd_sharp_weapon', 'bd_exploding_weapon', 'bd_jagged_blade', 'bd_tricky_boy', 'bd_weapon_tail'];
const GAINED_PICK2 = ['legendary_favored', 'bd_the_vengeance'];

const FAVORED_HOLDERS = ['favored_enemy', 'i_favor_all_enemies', 'legendary_favored'];
const STONE_TYPES = ['bow', 'crossbow', 'sling'];

const cid = (item) => item.flags?.sacadia?.catalogId;
const pickOf = (item) => item.flags?.sacadia?.pickValue ?? '';

/**
 * @param {Actor} actor
 * @returns {Promise<boolean>}  whether anything changed
 */
export async function migratePicks(actor) {
  if (actor?.type !== 'character') return false;
  const old = actor.items.filter((i) => i.type === 'ability' && ((GAINED_PICK.includes(cid(i)) && !i.system.pick?.kind)
    || (GAINED_PICK2.includes(cid(i)) && !i.system.pick2?.kind)));
  const refreshed = old.length ? await refreshItems(actor, { items: old }) : 0;
  const moved = await moveLegacySentinelPicks(actor);
  const marked = await markLoneDivineWeapon(actor);
  return !!refreshed || moved || marked;
}

/**
 * Fated Strike with no divine weapon marked: when the actor owns exactly one melee weapon, it becomes the divine weapon.
 * @returns {Promise<boolean>}  whether one was marked
 */
export async function markLoneDivineWeapon(actor) {
  if (!actor.items.some((i) => cid(i) === 'fated_strike')) return false;
  const weapons = actor.items.filter((w) => ['gear', 'armor'].includes(w.type) && w.system.weaponType);
  if (weapons.some((w) => w.flags?.sacadia?.signature)) return false;
  const melee = weapons.filter((w) => !['shield', 'bow', 'crossbow', 'sling'].includes(w.system.weaponType));
  if (melee.length !== 1) return false;
  await melee[0].setFlag('sacadia', 'signature', true);
  return true;
}

/**
 * Before 0.3.6 a Sentinel's Favored Enemy types and Bigger Stones counts were set on the Abilities tab and stored on the
 * actor (`system.professionResources.sentinel`). This moves an actor's old values onto its abilities, once:
 * - each favored type fills an empty pick on Favored Enemy, then I Favor All Enemies, then Favored Mastery;
 * - each Bigger Stones count fills an empty Bigger Stones pick, adding the second copy the character took (two at most).
 * Those abilities are refreshed from the compendium first: an older copy has no pick, and its Bigger Stones modifiers
 * read the counts. What moved is cleared from the actor. A favored type with no ability to hold it stays there (unread),
 * so nothing is lost; Bigger Stones counts without the ability never did anything, and are cleared.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  whether anything changed (false once it has run: what's left has nowhere to go)
 */
export async function moveLegacySentinelPicks(actor) {
  const legacy = actor?.type === 'character' ? actor.system.professionResources?.sentinel : null;
  if (!legacy) return false;
  const favored = [...(legacy.favored ?? [])];
  const stones = STONE_TYPES.flatMap((wt) => Array(legacy.biggerStones?.[wt] ?? 0).fill(wt));
  if (!favored.length && !stones.length) return false;

  const ids = new Set([...FAVORED_HOLDERS, 'bigger_stones']);
  const stale = (await staleItems(actor)).filter((i) => ids.has(cid(i)));
  if (stale.length) await refreshItems(actor, { items: stale });

  const updates = [];
  const creates = [];

  // Favored types, into the empty picks of the abilities that grant one (skipping a type already picked on one).
  const holders = FAVORED_HOLDERS.flatMap((id) => actor.items.filter((i) => cid(i) === id));
  const picked = new Set(holders.map(pickOf).filter(Boolean));
  const free = holders.filter((i) => !pickOf(i));
  const keep = [];
  for (const type of favored) {
    if (picked.has(type)) continue;
    const holder = free.shift();
    if (holder) updates.push({ _id: holder.id, 'flags.sacadia.pickValue': type });
    else keep.push(type);
  }

  // Bigger Stones: one copy per pick, the second one added (its CSP was already being charged).
  const copies = actor.items.filter((i) => cid(i) === 'bigger_stones');
  if (copies.length) {
    for (const value of copies.map(pickOf).filter(Boolean)) {
      const at = stones.indexOf(value);
      if (at >= 0) stones.splice(at, 1);
    }
    const empty = copies.filter((i) => !pickOf(i));
    for (const type of stones) {
      const copy = empty.shift();
      if (copy) updates.push({ _id: copy.id, 'flags.sacadia.pickValue': type });
      else if (copies.length + creates.length < 2) {
        const data = copies[0].toObject();
        delete data._id;
        foundry.utils.setProperty(data, 'flags.sacadia.pickValue', type);
        creates.push(data);
      }
    }
  }

  const hadStones = STONE_TYPES.some((wt) => legacy.biggerStones?.[wt]);
  if (!updates.length && !creates.length && !hadStones && keep.length === favored.length) return false;
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  if (creates.length) await actor.createEmbeddedDocuments('Item', creates);
  await actor.update({
    'system.professionResources.sentinel.favored': keep,
    'system.professionResources.sentinel.biggerStones': { bow: 0, crossbow: 0, sling: 0 },
  });
  return true;
}
