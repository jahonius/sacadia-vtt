/**
 * World-level upkeep run by the GM: refreshing out-of-date items from the compendiums, and adding the basic actions and
 * profession features a character is owed.
 */
import { catalogIndex, refreshItems, staleItems } from '../helpers/refresh.mjs';
import { rebuildWeaponAttacks } from '../helpers/weapon-attacks.mjs';
import { everyActor } from '../helpers/actor-utils.mjs';

/** Every actor a world-wide refresh covers: the world's actors and the scenes' unlinked token actors. */
export const refreshableActors = everyActor;

/** The GM's "Refresh compendium items" (Actors tab): refresh every out-of-date item on every actor. */
export async function refreshWorldItems() {
  await catalogIndex();
  const pending = [];
  for (const actor of refreshableActors()) {
    const stale = await staleItems(actor);
    if (stale.length) pending.push({ actor, stale });
  }
  if (!pending.length) return ui.notifications.info(game.i18n.localize('SACADIA.Refresh.NothingStale'));
  const list = pending.map(({ actor, stale }) => `<li><b>${foundry.utils.escapeHTML(actor.name)}</b>: ${stale.length}</li>`).join('');
  const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: game.i18n.localize('SACADIA.Refresh.Title') }, rejectClose: false,
    content: `<p>${game.i18n.localize('SACADIA.Refresh.Confirm')}</p><ul class="refresh-list">${list}</ul>` });
  if (!ok) return;
  let items = 0;
  for (const { actor, stale } of pending) items += await refreshItems(actor, { items: stale, rebuildWeapon: rebuildWeaponAttacks });
  ui.notifications.info(game.i18n.format('SACADIA.Refresh.WorldDone', { n: items, actors: pending.length }));
}

/**
 * Add any basic action/reaction (compendium `sacadia.basic-actions`) the character doesn't already own.
 * Additive only: never removes one (a player may have deleted a reaction they don't use — they'd lose
 * it again on the next backfill, so we only add ones never granted before, tracked by a flag list).
 */
export async function reconcileBasicGrants(actor) {
  const pack = game.packs.get('sacadia.basic-actions');
  if (!pack) return;
  const granted = new Set(actor.getFlag('sacadia', 'basicGranted') ?? []);
  const owned = new Set(actor.items.map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
  const additions = [];
  for (const doc of await pack.getDocuments()) {
    const cid = doc.flags?.sacadia?.catalogId ?? doc.id;
    if (owned.has(cid) || granted.has(cid)) continue;
    const data = doc.toObject();
    delete data._id;
    foundry.utils.setProperty(data, 'flags.sacadia.basicGrant', true);
    additions.push(data);
    granted.add(cid);
  }
  if (!additions.length) return;
  await actor.createEmbeddedDocuments('Item', additions);
  await actor.setFlag('sacadia', 'basicGranted', [...granted]);
}

/** Map a profession key to its compendium pack (only Hulinari's key/pack names differ). */
export function professionPack(key) {
  return game.packs.get(`sacadia.abilities-${key === 'hulinari_warrior' ? 'hulinari' : key}`);
}

/**
 * Add the current professions' baseline ("starting" subpath) abilities that aren't already owned, and
 * remove previously auto-granted ones no longer matching a set profession. Auto-grants are tagged
 * `flags.sacadia.professionGrant` so a player's own (bought) abilities are never touched; an ability the
 * player already has (bought or granted) is never duplicated. Reads the pack live, so completing a
 * profession's `starting` set in the source + rebuilding automatically flows through here.
 */
export async function reconcileProfessionGrants(actor) {
  const keys = ['primary', 'secondary'].map((s) => actor.system.professions?.[s]?.key).filter(Boolean);
  const desired = new Map(); // catalogId -> source ability document
  for (const key of new Set(keys)) {
    const pack = professionPack(key);
    if (!pack) continue;
    for (const doc of await pack.getDocuments()) {
      if (/starting/i.test(doc.system?.meta?.subpath ?? '')) desired.set(doc.flags?.sacadia?.catalogId ?? doc.id, doc);
    }
  }
  const owned = new Set(actor.items.map((i) => i.flags?.sacadia?.catalogId).filter(Boolean));
  const stale = actor.items
    .filter((i) => i.getFlag('sacadia', 'professionGrant') && !desired.has(i.flags?.sacadia?.catalogId))
    .map((i) => i.id);
  const additions = [];
  for (const [cid, doc] of desired) {
    if (owned.has(cid)) continue;
    const data = doc.toObject();
    delete data._id;
    foundry.utils.setProperty(data, 'flags.sacadia.professionGrant', true);
    additions.push(data);
  }
  if (stale.length) await actor.deleteEmbeddedDocuments('Item', stale);
  if (additions.length) await actor.createEmbeddedDocuments('Item', additions);
}
