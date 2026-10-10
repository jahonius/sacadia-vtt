/**
 * Refreshing owned items from the system compendiums. An ability's behavior (activities, grants, boosts …) and an
 * item's stats are copied onto the actor when it's dragged in, so a fix to the compendium never reaches a character on
 * its own. Every built item carries `flags.sacadia.buildHash` (a hash of its name, image and system data, stamped by
 * src/build-packs.mjs); an owned copy whose hash differs from the compendium's — or that predates the hash — is out of
 * date, and refreshing it takes the compendium's data while keeping what belongs to the player.
 *
 * Pure helpers first (unit-tested); the runtime below touches Foundry only inside functions.
 */

import { deleteKey, replaceWith } from './update-ops.mjs';

/** System fields that are the player's state, kept through a refresh (by item type). */
export const KEEP_SYSTEM = {
  gear: ['equipped', 'storage', 'quantity'],
  armor: ['equipped', 'storage', 'rend'],
  ability: [],
  culture: ['choice', 'subculture'],
  ancestry: ['choice'],
};

/**
 * Flags the build writes (catalog metadata). A refresh takes these from the compendium and drops any the compendium no
 * longer has; every other `flags.sacadia` key (a pick, a named weapon, a broken piece, a researched spell …) is kept.
 */
export const STATIC_FLAGS = ['catalogId', 'buildHash', 'selfScaling', 'opportunity', 'transcribed', 'mastery', 'basic', 'postRoll',
  'steadiedCrit', 'feature', 'level', 'legendary', 'prestige', 'tome', 'research', 'lore', 'kind', 'armorPrereq',
  'heritage', 'heritageChoice', 'culture', 'grantsSpecialty', 'expertise', 'resistance', 'hulinariForm', 'inheritance', 'talentBonus', 'business',
  'goods', 'bargain'];

/** Is an owned item out of date against its compendium entry (`{buildHash}` from the index)? */
export function isStale(owned, entry) {
  if (!entry?.buildHash) return false; // no comparable source
  return owned?.flags?.sacadia?.buildHash !== entry.buildHash;
}

/**
 * The update that brings an owned item in line with its compendium source: the source's system data with the player's
 * state kept, the source's catalog flags (stale ones removed), its image, and — for abilities, which players don't
 * rename — its name. Equipment keeps the owned name.
 * @param {{_id: string, type: string, name: string, system: object, flags?: object}} owned  owned item data
 * @param {{name: string, img: string, system: object, flags?: object}} source               compendium item data
 * @param {{del?: () => any}} [opts]  the deletion operator (injected in tests)
 */
export function refreshUpdate(owned, source, { del = deleteKey } = {}) {
  const system = structuredClone(source.system ?? {});
  for (const k of KEEP_SYSTEM[owned.type] ?? []) if (owned.system && k in owned.system) system[k] = structuredClone(owned.system[k]);
  const upd = { _id: owned._id, system, img: source.img };
  if (owned.type === 'ability') upd.name = source.name;
  const src = source.flags?.sacadia ?? {};
  const mine = owned.flags?.sacadia ?? {};
  for (const [k, v] of Object.entries(src)) upd[`flags.sacadia.${k}`] = structuredClone(v);
  for (const k of STATIC_FLAGS) if (k in mine && !(k in src)) upd[`flags.sacadia.${k}`] = del();
  return upd;
}

/** The weapon fields its generated attack and throw copy; a change to any of them rebuilds those. */
export const WEAPON_COPY_FIELDS = ['weaponType', 'traits', 'range', 'hands', 'defense'];

/** Did a refresh change something a weapon's generated attacks copy? */
export function weaponCopyChanged(beforeSystem, afterSystem) {
  return WEAPON_COPY_FIELDS.some((k) => JSON.stringify(beforeSystem?.[k] ?? null) !== JSON.stringify(afterSystem?.[k] ?? null));
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

let indexPromise = null;

/**
 * catalogId → `{uuid, buildHash, type}` across this system's Item compendiums. Built once per session (the packs don't
 * change while the world runs).
 */
export function catalogIndex() {
  indexPromise ??= (async () => {
    const out = new Map();
    const packs = game.packs.filter((p) => p.metadata.packageType === 'system' && p.metadata.packageName === game.system.id
      && p.documentName === 'Item');
    for (const pack of packs) {
      const index = await pack.getIndex({ fields: ['flags.sacadia.catalogId', 'flags.sacadia.buildHash', 'type'] });
      for (const e of index) {
        const id = e.flags?.sacadia?.catalogId;
        if (id && !out.has(id)) out.set(id, { uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, buildHash: e.flags?.sacadia?.buildHash ?? '', type: e.type });
      }
    }
    return out;
  })();
  return indexPromise;
}

/** The actor's items with a newer compendium version (matched by catalogId and type). */
export async function staleItems(actor) {
  const index = await catalogIndex();
  return actor.items.filter((i) => {
    const e = index.get(i.flags?.sacadia?.catalogId);
    return e && e.type === i.type && isStale(i, e);
  });
}

/**
 * Refresh `items` (default: every stale one) on `actor` from the compendium. Weapons whose copied fields changed get
 * their generated attacks rebuilt through `rebuildWeapon`. Returns the number refreshed.
 * @param {Actor} actor
 * @param {{items?: Item[], rebuildWeapon?: (weapon: Item) => Promise<void>}} [opts]
 */
export async function refreshItems(actor, { items = null, rebuildWeapon = null } = {}) {
  const list = items ?? await staleItems(actor);
  if (!list.length) return 0;
  const index = await catalogIndex();
  const updates = [];
  const weapons = [];
  for (const item of list) {
    const entry = index.get(item.flags?.sacadia?.catalogId);
    const source = entry ? await fromUuid(entry.uuid) : null;
    if (!source) continue;
    const before = item.toObject();
    const upd = refreshUpdate(before, source.toObject());
    updates.push(upd);
    if (['gear', 'armor'].includes(item.type) && weaponCopyChanged(before.system, upd.system)) weapons.push(item.id);
    // The whole system data is the compendium's (an update would merge into object fields and keep removed keys).
    upd.system = replaceWith(upd.system);
  }
  if (!updates.length) return 0;
  await actor.updateEmbeddedDocuments('Item', updates, { sacadiaRefresh: true });
  for (const id of weapons) {
    const w = actor.items.get(id);
    if (w && rebuildWeapon) await rebuildWeapon(w);
  }
  return updates.length;
}
