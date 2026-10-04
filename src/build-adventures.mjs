/**
 * Build the Adventure compendium (`packs/adventures`) from `src/adventures/<key>/index.mjs`.
 *
 * Each adventure module default-exports `build(kit)` returning Adventure data (actors, items, journal, scenes, tables,
 * folders). The kit copies abilities and equipment out of the built compendium sources (`src/packs/<pack>/*.json`), so
 * run this after `node src/build-packs.mjs`: owned copies then carry the compendium's `buildHash` and stay current
 * (helpers/refresh.mjs offers a refresh when they don't). Every id is derived from the adventure key and a stable name,
 * so rebuilding doesn't churn ids and an imported world's links (@UUID, token actor ids) survive a re-import.
 *
 * Run: `node src/build-adventures.mjs` (also part of `npm run build:packs`).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ClassicLevel } from 'classic-level';
import { markdownToHtml } from './manual.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PACKS = path.join(ROOT, 'src', 'packs');
const ADVENTURES = path.join(ROOT, 'src', 'adventures');
const PACK = 'adventures';
const SYSTEM_PATH = 'systems/sacadia';
const SKIP_PACKS = new Set([PACK, 'user-manual']);
const SYSTEM = JSON.parse(fs.readFileSync(path.join(ROOT, 'system.json'), 'utf8'));

/**
 * Index the built compendium sources by catalog id. Each item is reachable as `<pack>:<catalogId>` and, when the id is
 * unique across packs, as plain `<catalogId>`.
 * @returns {Map<string, {pack: string, doc: object}>}
 */
export function loadCatalog(dir = SRC_PACKS) {
  const byKey = new Map();
  const count = new Map();
  for (const pack of fs.readdirSync(dir)) {
    const packDir = path.join(dir, pack);
    if (SKIP_PACKS.has(pack) || !fs.statSync(packDir).isDirectory()) continue;
    for (const f of fs.readdirSync(packDir)) {
      if (!f.endsWith('.json')) continue;
      const doc = JSON.parse(fs.readFileSync(path.join(packDir, f), 'utf8'));
      const cid = doc.flags?.sacadia?.catalogId;
      if (!cid) continue;
      byKey.set(`${pack}:${cid}`, { pack, doc });
      count.set(cid, (count.get(cid) ?? 0) + 1);
      if (count.get(cid) === 1) byKey.set(cid, { pack, doc });
      else byKey.delete(cid);
    }
  }
  return byKey;
}

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(target, source) {
  for (const [k, v] of Object.entries(source ?? {})) {
    if (isObject(v) && isObject(target[k])) merge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

/**
 * The helpers an adventure definition builds with.
 * @param {string} key  the adventure's folder name
 * @param {Map} catalog from loadCatalog()
 */
export function makeKit(key, catalog) {
  const id = (...parts) => sha(`adventure:${key}:${parts.join(':')}`);
  const asset = (p) => `${SYSTEM_PATH}/assets/adventures/${key}/${p}`;
  const names = new Map(); // `<kind>:<key>` → { uuid, name }, for {{links}} in journal text

  function compendium(ref) {
    const hit = catalog.get(ref);
    if (!hit) throw new Error(`${key}: no compendium item "${ref}" (rebuild packs, or qualify it as <pack>:<id>)`);
    return hit;
  }

  /**
   * An owned copy of a compendium item (`ref` = catalogId or `pack:catalogId`) for the actor `owner`. `opts` may set
   * `key` (to own one item twice), `name`, and `system`/`flags` overrides merged onto the copy.
   */
  function owned(owner, ref, opts = {}) {
    const { pack, doc } = compendium(ref);
    const data = structuredClone(doc);
    delete data._key;
    const cid = data.flags.sacadia.catalogId;
    data._id = id(owner, 'item', opts.key ?? cid);
    data._stats = { compendiumSource: `Compendium.sacadia.${pack}.Item.${doc._id}` };
    if (opts.name) data.name = opts.name;
    if (opts.system) merge(data.system, opts.system);
    if (opts.flags) merge(data.flags.sacadia, opts.flags);
    return data;
  }

  /**
   * A weapon or shield from the equipment packs, plus the attack abilities the system generates for it on a character
   * (helpers/weapon-attacks.mjs: "<weapon> Attack", "<shield> Bash", and "Throw <weapon>" for a Versatile weapon), so a
   * pregen arrives complete. Returns [weapon, ...attacks].
   */
  function weapon(owner, ref, opts = {}) {
    const w = owned(owner, ref, { system: { equipped: true }, ...opts });
    // Heavy weapons carry the `heavy` trait (Heavy Weapons Mastery) — set by build-packs too; kept here for sources
    // built before that change.
    if (/heavy/i.test(w.system.description ?? '') && !/\bheavy\b/.test(w.system.traits ?? '') && w.type === 'gear') {
      w.system.traits = [w.system.traits, 'heavy'].filter(Boolean).join(', ');
    }
    const s = w.system;
    const category = s.defense === 'md' ? 'magic' : s.range?.type === 'ranged' ? 'ranged' : 'melee';
    const attack = (name, thrown) => ({
      _id: id(owner, 'item', w.flags.sacadia.catalogId, thrown ? 'throw' : 'attack'),
      name, type: 'ability', img: w.img,
      system: {
        tag: 'action',
        costs: { ap: 1, limbs: !thrown && s.hands >= 2 ? ['twoArm'] : ['oneArm'] },
        range: thrown ? { type: 'ranged', value: 40 } : { type: s.range?.type || (category === 'ranged' ? 'ranged' : 'melee'), value: s.range?.value ?? null },
        activities: [{ type: 'attack', attack: { category: thrown ? 'ranged' : category, defense: s.defense || 'pd' }, damage: [] }],
      },
      flags: { sacadia: { weapon: w._id, weaponAttack: w._id, ...(thrown ? { thrown: true } : {}) } },
    });
    const out = [w, attack(s.weaponType === 'shield' ? `${w.name} Bash` : `${w.name} Attack`, false)];
    if (/\bversatile\b/i.test(s.traits ?? '')) out.push(attack(`Throw ${w.name}`, true));
    return out;
  }

  /** An item that exists only in this adventure; `key` makes its id (and its catalogId when it has none). */
  function item(owner, itemKey, data) {
    const out = structuredClone(data);
    out._id = id(owner, 'item', itemKey);
    out.system ??= {};
    out.effects = (out.effects ?? []).map((e, i) => ({ _id: id(owner, 'item', itemKey, 'effect', i), ...e }));
    out.flags = merge({ sacadia: {} }, out.flags ?? {});
    return out;
  }

  /** Register a document for `{{kind:key}}` links in journal Markdown. */
  function register(kind, docKey, uuid, name) { names.set(`${kind}:${docKey}`, { uuid, name }); }

  /**
   * Journal Markdown → HTML, with `{{actor:key}}`, `{{journal:key}}`, `{{page:journal/page}}`, `{{scene:key}}` and
   * `{{table:key}}` turned into @UUID links (`{{actor:key|label}}` overrides the label).
   */
  function markdown(md) {
    const linked = md.replace(/\{\{(\w+):([\w/-]+)(?:\|([^}]+))?\}\}/g, (m, kind, ref, label) => {
      const hit = names.get(`${kind}:${ref}`);
      if (!hit) throw new Error(`${key}: unknown link ${m}`);
      return `@UUID[${hit.uuid}]{${label ?? hit.name}}`;
    });
    return markdownToHtml(linked);
  }

  /** A system compendium document's id, as src/build-packs.mjs makes it (`makeId(pack, key)`). */
  const packId = (pack, docKey) => sha(`${pack}:${docKey}`);

  return { key, id, asset, owned, weapon, item, register, markdown, compendium, merge, packId };
}

/** Load every adventure under src/adventures and build its Adventure document. */
export async function buildAdventures({ catalog = loadCatalog() } = {}) {
  const docs = [];
  for (const key of fs.readdirSync(ADVENTURES).sort()) {
    const entry = path.join(ADVENTURES, key, 'index.mjs');
    if (!fs.existsSync(entry)) continue;
    const { default: build } = await import(pathToFileURL(entry).href);
    const kit = makeKit(key, catalog);
    const adventure = await build(kit);
    adventure._id ??= kit.id('adventure');
    adventure._key = `!adventures!${adventure._id}`;
    // The versions the data is written for, so Foundry runs only migrations newer than these.
    const stats = { coreVersion: SYSTEM.compatibility.verified, systemId: SYSTEM.id, systemVersion: SYSTEM.version };
    adventure._stats = { ...stats };
    for (const field of ['actors', 'items', 'journal', 'scenes', 'tables', 'macros', 'cards', 'playlists', 'folders', 'combats']) {
      for (const d of adventure[field] ?? []) {
        d._stats = { ...stats, ...(d._stats ?? {}) };
        for (const i of d.items ?? []) i._stats = { ...stats, ...(i._stats ?? {}) };
      }
    }
    docs.push(adventure);
  }
  return docs;
}

async function writePack(docs) {
  const srcDir = path.join(SRC_PACKS, PACK);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  for (const d of docs) fs.writeFileSync(path.join(srcDir, `${d._key.split('!').pop()}-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`), JSON.stringify(d, null, 2));
  // Open first (takes the lock; throws if Foundry has the pack open), then clear and rewrite — see build-packs.mjs.
  const db = new ClassicLevel(path.join(ROOT, 'packs', PACK), { keyEncoding: 'utf8', valueEncoding: 'json' });
  try {
    await db.open();
  } catch (err) {
    throw new Error(`Cannot open pack "${PACK}" — is Foundry running with the world loaded?\n  ${err.message}`);
  }
  await db.clear();
  const batch = db.batch();
  for (const d of docs) batch.put(d._key, d);
  await batch.write();
  await db.close();
}

async function main() {
  const docs = await buildAdventures();
  await writePack(docs);
  for (const d of docs) {
    const n = (k) => d[k]?.length ?? 0;
    console.log(`  ${'adventures'.padEnd(24)} ${d.name}: ${n('actors')} actors, ${n('items')} items, ${n('journal')} journals, `
      + `${n('scenes')} scenes, ${n('tables')} tables`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
