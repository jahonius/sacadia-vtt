/**
 * A character's Heritage, Ancestry and Culture (book Section I) and what they give: the abilities each grants while the
 * character has it, and the specialized talent ranks those abilities give (Heibrim Lore's Religion: Demon Lore).
 *
 * - The **Heritage** (`identity.heritage`) grants its abilities from the Heritages & Ancestries compendium
 *   (`flags.sacadia.heritage`), the one that goes with the Heritage's choice (`identity.heritageChoice`) only when it's
 *   the one taken (`flags.sacadia.heritageChoice`).
 * - The **Ancestry** and the **Culture** are items (data/item-origin.mjs); each grants its `grants` (ability uuids), those
 *   tied to an option only when it's the one taken.
 *
 * Granted abilities are tagged `flags.sacadia.identityGrant` (with `grantKey`, what they were granted as), added when
 * owed and taken away when not. An ability the character already has (bought, or granted by its profession) is never
 * doubled. Pure helpers first (unit-tested); the runtime below touches Foundry only inside functions.
 */

import { replaceWith } from '../helpers/update-ops.mjs';

/** The uuids an origin item grants: those tied to no option, or to the one taken (an ancestry's own, else the Heritage's). */
export function originGrants(origin, heritageChoice = '') {
  const sys = origin?.system ?? {};
  const choice = sys.choice || (origin?.type === 'ancestry' ? heritageChoice : '');
  return (sys.grants ?? []).filter((g) => g.uuid && (!g.option || g.option === choice)).map((g) => g.uuid);
}

/**
 * Whether a heritage ability (compendium index entry or document) is owed: it belongs to the Heritage and, if it goes with
 * the Heritage's choice, that's the one taken.
 */
export function heritageOwes(entry, heritage, choice = '') {
  const f = entry?.flags?.sacadia ?? {};
  if (!heritage || f.heritage !== heritage) return false;
  return !f.heritageChoice || f.heritageChoice === choice;
}

/**
 * The specialized-talent rows after the abilities that give a rank change (`specialties` on the character). Each owed
 * grant (`{source, name, talent}`: one rank, as every cultural talent gives) gets a row. The player's own row for that
 * talent and name is taken over, its ranks stacking with the granted one (book p.60: "it stacks with any other levels"),
 * else a new row is added. A row whose source is no longer owed gives its rank back: it's removed if that was all it had,
 * or kept as the player's own.
 * @param {Array<{name: string, talent: string, rank: number, source?: string}>} rows
 * @param {Array<{source: string, name: string, talent: string}>} owed
 * @returns {Array|null}  the new rows, or null when nothing changes
 */
export function reconcileSpecialties(rows, owed) {
  const out = (rows ?? []).map((r) => ({ name: r.name ?? '', talent: r.talent ?? '', rank: r.rank ?? 0, source: r.source ?? '' }));
  let changed = false;
  const owedBy = new Set(owed.map((o) => o.source));
  for (let i = out.length - 1; i >= 0; i--) {
    const r = out[i];
    if (!r.source || owedBy.has(r.source)) continue;
    changed = true;
    r.source = '';
    r.rank = Math.max(0, r.rank - 1);
    if (r.rank <= 0) out.splice(i, 1);
  }
  const norm = (s) => String(s ?? '').toLowerCase().trim();
  for (const o of owed) {
    if (out.some((r) => r.source === o.source)) continue;
    changed = true;
    // The player's row for the same specialty (a name that starts with the granted one: "Demon Lore (Heibrim Lore)").
    const mine = o.name ? out.find((r) => !r.source && r.talent === o.talent && norm(r.name).startsWith(norm(o.name))) : null;
    if (mine) { mine.source = o.source; mine.rank = Math.min(6, Math.max(mine.rank, 0) + 1); continue; }
    out.push({ name: o.name ?? '', talent: o.talent, rank: 1, source: o.source });
  }
  return changed ? out : null;
}

/**
 * What prerequisites about where a character comes from are checked against (derivation.mjs checkPrerequisites): its
 * culture's names, the subcultures it has and the one taken, its ancestry's name, and its Heritage (lower-cased).
 * @param {Actor} actor
 */
export function originContext(actor) {
  const culture = cultureOf(actor);
  const ancestry = ancestryOf(actor);
  const identity = actor?.system?.identity ?? {};
  const lower = (s) => String(s ?? '').toLowerCase().trim();
  const label = (k) => lower(globalThis.game?.i18n ? game.i18n.localize(CONFIG.SACADIA.heritages[k]) : k);
  return {
    cultures: culture ? [culture.name, ...String(culture.system.aliases ?? '').split(',')].map(lower).filter(Boolean)
      : [lower(identity.culture)].filter(Boolean),
    subcultures: (culture?.system.subcultures ?? []).map(lower),
    subculture: lower(culture?.system.subculture),
    ancestry: lower(ancestry?.name ?? identity.ancestry),
    heritage: identity.heritage ?? '',
    // Each Heritage by its key and its name ("hulinari" / "hulinari").
    heritageNames: Object.fromEntries(Object.keys(CONFIG.SACADIA.heritages).flatMap((k) => [[k, k], [label(k), k]])),
    heritageChoice: identity.heritageChoice ?? '',
  };
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

export const IDENTITY_PACKS = ['sacadia.heritages', 'sacadia.cultures'];

/** The character's culture / ancestry item (one of each). */
export const cultureOf = (actor) => actor?.items?.find((i) => i.type === 'culture') ?? null;
export const ancestryOf = (actor) => actor?.items?.find((i) => i.type === 'ancestry') ?? null;

/** What a granted ability is keyed by: its catalog id, else its source uuid. */
const grantKeyOf = (doc, uuid) => doc.flags?.sacadia?.catalogId || uuid;

/**
 * The abilities the character's Heritage, Ancestry and Culture grant: key → source document.
 * @param {Actor} actor
 * @returns {Promise<Map<string, Item>>}
 */
export async function owedGrants(actor) {
  const { heritage = '', heritageChoice = '' } = actor.system.identity ?? {};
  const owed = new Map();
  const pack = game.packs.get('sacadia.heritages');
  if (pack && heritage) {
    const index = await pack.getIndex({ fields: ['type', 'flags.sacadia.heritage', 'flags.sacadia.heritageChoice', 'flags.sacadia.catalogId'] });
    for (const e of index) {
      if (e.type !== 'ability' || !heritageOwes(e, heritage, heritageChoice)) continue;
      const doc = await pack.getDocument(e._id);
      if (doc) owed.set(grantKeyOf(doc, doc.uuid), doc);
    }
  }
  for (const origin of [ancestryOf(actor), cultureOf(actor)]) {
    for (const uuid of originGrants(origin, heritageChoice)) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc?.documentName === 'Item' && doc.type === 'ability' && !doc.parent) owed.set(grantKeyOf(doc, uuid), doc);
    }
  }
  return owed;
}

/**
 * Bring the character's granted abilities, and the specialty ranks they give, in line with its Heritage, Ancestry and
 * Culture. Runs on the acting client when one of those changes, and for every character on the GM's load.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  whether anything changed
 */
export async function reconcileIdentityGrants(actor) {
  if (actor?.type !== 'character') return false;
  const owed = await owedGrants(actor);
  const keyOf = (i) => i.flags?.sacadia?.grantKey || i.flags?.sacadia?.catalogId || '';
  const stale = actor.items.filter((i) => i.flags?.sacadia?.identityGrant && !owed.has(keyOf(i))).map((i) => i.id);
  const have = new Set(actor.items.filter((i) => !stale.includes(i.id)).flatMap((i) => [i.flags?.sacadia?.catalogId, i.flags?.sacadia?.grantKey]).filter(Boolean));
  const additions = [];
  for (const [key, doc] of owed) {
    if (have.has(key)) continue;
    const data = doc.toObject();
    delete data._id;
    foundry.utils.setProperty(data, 'flags.sacadia.identityGrant', true);
    foundry.utils.setProperty(data, 'flags.sacadia.grantKey', key);
    if (doc.pack) foundry.utils.setProperty(data, '_stats.compendiumSource', doc.uuid);
    additions.push(data);
  }
  if (stale.length) await actor.deleteEmbeddedDocuments('Item', stale);
  if (additions.length) await actor.createEmbeddedDocuments('Item', additions);

  // Specialty ranks: from every owned ability that gives one (granted or bought).
  const specialties = actor.items.filter((i) => i.type === 'ability' && i.flags?.sacadia?.grantsSpecialty)
    .map((i) => ({ source: i.flags.sacadia.catalogId || i.id, name: i.flags.sacadia.grantsSpecialty.name ?? '', talent: i.flags.sacadia.grantsSpecialty.talent }));
  const rows = reconcileSpecialties(actor.system.specialties, specialties);
  if (rows) await actor.update({ 'system.specialties': replaceWith(rows) });
  return !!(stale.length || additions.length || rows);
}

/**
 * Make `source` (an ancestry or culture item, or its uuid) the character's: it replaces the one held, and an ancestry sets
 * the Heritage. Pass `null` with a `type` to clear it.
 * @param {Actor} actor
 * @param {Item|string|null} source
 * @param {{type?: 'culture'|'ancestry'}} [opts]
 */
export async function setOrigin(actor, source, { type } = {}) {
  const doc = typeof source === 'string' ? await fromUuid(source) : source;
  const kind = doc?.type ?? type;
  if (!['culture', 'ancestry'].includes(kind)) return null;
  return enqueue(actor, async () => {
    const old = actor.items.filter((i) => i.type === kind).map((i) => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments('Item', old, { sacadiaOrigin: true });
    const identity = { [kind]: doc?.name ?? '' };
    if (kind === 'ancestry' && doc?.system?.heritage) identity.heritage = doc.system.heritage;
    let created = null;
    if (doc) {
      const data = doc.toObject();
      delete data._id;
      if (doc.pack) foundry.utils.setProperty(data, '_stats.compendiumSource', doc.uuid);
      // Where it came from, so the Character tab's list can show it as the one chosen.
      foundry.utils.setProperty(data, 'flags.sacadia.originSource', doc.uuid);
      [created] = await actor.createEmbeddedDocuments('Item', [data], { sacadiaOrigin: true });
    }
    const form = doc?.flags?.sacadia?.hulinariForm;
    await actor.update({ system: { identity, ...(form ? { professionResources: { hulinari: { form } } } : {}) } }, { sacadiaOrigin: true });
    await reconcileIdentityGrants(actor);
    return created;
  });
}

/** The cultures and ancestries a character can choose: the system's compendiums', then the world's (a table's own). */
export async function originChoices() {
  const out = { culture: [], ancestry: [] };
  for (const id of IDENTITY_PACKS) {
    const pack = game.packs.get(id);
    if (!pack) continue;
    for (const e of await pack.getIndex({ fields: ['type', 'system.heritage', 'flags.sacadia.culture', 'sort'] })) {
      if (e.type in out) out[e.type].push({ uuid: e.uuid, name: e.name, heritage: e.system?.heritage ?? '', culture: e.flags?.sacadia?.culture ?? '', sort: e.sort ?? 0 });
    }
  }
  for (const item of game.items ?? []) {
    if (item.type in out) out[item.type].push({ uuid: item.uuid, name: item.name, heritage: item.system.heritage ?? '', culture: '', world: true, sort: 0 });
  }
  return out;
}

const queues = new WeakMap();

/** Whether the character still exists (a world actor, or a token's). */
const alive = (actor) => (actor.isToken ? !!actor.token && !actor.token.deleted : !!game.actors?.get(actor.id));

/**
 * Run `fn` for a character after whatever is already queued for it: hooks fire in quick succession (several origin items
 * made at once, a Heritage changed and an ancestry chosen), and each step deletes and creates items. Inside `fn`, call
 * reconcileIdentityGrants directly: queueing from inside would wait on itself. A character deleted meanwhile is skipped.
 */
function enqueue(actor, fn) {
  const next = (queues.get(actor) ?? Promise.resolve())
    .then(() => (alive(actor) ? fn() : null))
    .catch((err) => { if (alive(actor)) console.error(`Sacadia | ${actor.name}'s heritage, ancestry and culture`, err); return null; });
  queues.set(actor, next);
  return next;
}

/** Reconcile one character's grants, after whatever is already queued for it. */
export const queueIdentity = (actor) => enqueue(actor, () => reconcileIdentityGrants(actor));

/** Resolves once everything queued for the character is done. */
export const identitySettled = (actor) => queues.get(actor) ?? Promise.resolve();

/**
 * A culture or ancestry item arrived on a character some other way than `setOrigin` (dropped on the sheet, made by a
 * macro): it replaces the one held, names the identity, and an ancestry sets the Heritage. Several arriving at once: the
 * first one queued stays, and the rest are replaced by it.
 * @param {Item} item
 */
export function adoptOrigin(item) {
  const actor = item.parent;
  if (actor?.type !== 'character' || !['culture', 'ancestry'].includes(item.type)) return Promise.resolve();
  return enqueue(actor, async () => {
    if (!actor.items.has(item.id)) return;
    const others = actor.items.filter((i) => i.type === item.type && i.id !== item.id).map((i) => i.id);
    if (others.length) await actor.deleteEmbeddedDocuments('Item', others, { sacadiaOrigin: true });
    const identity = { [item.type]: item.name };
    if (item.type === 'ancestry' && item.system.heritage) identity.heritage = item.system.heritage;
    const form = item.flags?.sacadia?.hulinariForm;
    await actor.update({ system: { identity, ...(form ? { professionResources: { hulinari: { form } } } : {}) } }, { sacadiaOrigin: true });
    await reconcileIdentityGrants(actor);
  });
}

/**
 * Before 0.3.8 a Heritage's HP at Level 1 was typed into Max HP adjustment (`health.bonus`); it's now added for you. For a
 * character from then, once, take it back out of the adjustment when the adjustment holds at least that much. A
 * character made since is marked when it's created (`heritageHpMoved`), so its own adjustment is left alone.
 * @param {Actor} actor
 * @returns {Promise<number>}  the HP moved (0 if none)
 */
export async function moveHeritageHp(actor) {
  if (actor?.type !== 'character' || actor.getFlag('sacadia', 'heritageHpMoved')) return 0;
  const hp = CONFIG.SACADIA.heritageInfo[actor.system.identity?.heritage]?.hp ?? 0;
  const bonus = actor._source.system?.health?.bonus ?? 0;
  const moved = hp && bonus >= hp ? hp : 0;
  await actor.update({ 'flags.sacadia.heritageHpMoved': true, ...(moved ? { 'system.health.bonus': bonus - moved } : {}) }, { sacadiaOrigin: true });
  return moved;
}
