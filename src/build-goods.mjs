/**
 * Build the Personal Goods, Trinkets and Home Goods compendiums from src/goods.mjs (called by src/build-packs.mjs, which
 * hands over its id maker). Each table is a compendium folder; each row a `gear` Item with its price (in gc or sc), Item
 * Slots, slot notes and properties as traits, the storage it provides, and its rules as the description.
 *
 * What the sheet works with rides in `flags.sacadia.goods` (light, storageGroup, jewelry, rune, use) and the Shop for
 * Bargains table in `flags.sacadia.bargain` (rules/goods.mjs reads both).
 */
import { PERSONAL_GOODS, TRINKET_GOODS, HOME_GOODS, PROPERTIES } from './goods.mjs';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const tagSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "1 Item Slot (Small, Quickdraw)" / "No Item Slot", and the price: what the description's last line says. */
function factLine(e) {
  const slots = e.slots ? `${e.slots} Item Slot${e.slots === 1 ? '' : 's'}` : 'No Item Slot';
  const tags = e.tags?.length ? ` (${e.tags.join(', ')})` : '';
  return `${slots}${tags} · ${e.value}${e.coin ?? 'gc'}`;
}

/** The item's description: its prerequisite, its own rules, its properties' rules, then its slots, price and source. */
function describe(cat, e) {
  const parts = [];
  if (e.prereq) parts.push(`<p><em>Prerequisite: ${e.prereq}.</em></p>`);
  for (const [tag, title, text] of e.rules ?? []) parts.push(`<p><strong>${title}</strong> (${tag}): ${text}</p>`);
  for (const p of e.props ?? []) {
    const [tag, text] = PROPERTIES[p] ?? [];
    if (!text) throw new Error(`goods: no rules for the property "${p}" (${e.name})`);
    parts.push(`<p><strong>${p}</strong> (${tag}): ${text}</p>`);
  }
  parts.push(`<p class="goods-facts">${factLine(e)} · ${cat.name}, rulebook p.${cat.page}</p>`);
  return parts.join('');
}

/**
 * Build the three packs.
 * @param {{makeId: (pack: string, key: string) => string}} kit
 * @returns {Record<string, {items: object[], folders: object[]}>}  by pack name
 */
export function buildGoods({ makeId }) {
  const folder = (pack, cat, sort) => ({
    _id: makeId(pack, `folder:${cat.key}`), _key: `!folders!${makeId(pack, `folder:${cat.key}`)}`, name: cat.name, type: 'Item',
    folder: null, sorting: 'm', sort, color: null, description: cat.note ? `<p>${cat.note}</p>` : '', flags: {},
  });

  const toItem = (pack, kind, cat, e, folderId, sort, idPrefix) => {
    const catalogId = e.id ?? `${idPrefix}${slug(e.name)}`;
    const _id = makeId(pack, catalogId);
    const traits = [...(e.tags ?? []), ...(e.props ?? []).filter((p) => p !== 'Add-On')].map(tagSlug);
    const goods = {
      table: cat.key,
      ...(e.light ? { light: e.light } : {}),
      ...(e.storageGroup ? { storageGroup: e.storageGroup } : {}),
      ...(e.jewelry ? { jewelry: e.jewelry } : {}),
      ...(e.rune ? { rune: e.rune } : {}),
      ...(e.use ? { use: true } : {}),
    };
    const bargain = e.noBargain ? null : (e.bargain ?? cat.bargain ?? null);
    const w = e.weapon;
    return {
      _id, _key: `!items!${_id}`, name: e.name, type: 'gear', img: e.img ?? 'icons/svg/item-bag.svg', folder: folderId, sort,
      system: {
        description: describe(cat, e), quantity: 1, weight: 0, value: e.value ?? 0, coin: e.coin ?? 'gc', equipped: false,
        traits: [...new Set(traits)].join(', '),
        slots: e.slots ?? 1, storage: e.storage ?? cat.storage ?? 'ris', providesSis: e.providesSis ?? 0, providesRis: e.providesRis ?? 0,
        ...(w ? {
          weaponType: w.type, weaponDamage: { count: String(w.count ?? 1), denomination: w.denom, trait: 'power' }, hands: 1,
          defense: w.defense, damageType: w.damageType, range: { type: 'melee', value: w.reach ?? 5 },
        } : {}),
      },
      effects: [],
      flags: { sacadia: { catalogId, kind, goods, ...(bargain ? { bargain } : {}) } },
    };
  };

  const build = (pack, kind, cats, idPrefix = '') => {
    const out = { items: [], folders: [] };
    cats.forEach((cat, i) => {
      const f = folder(pack, cat, (i + 1) * 1000);
      out.folders.push(f);
      cat.items.forEach((e, j) => out.items.push(toItem(pack, kind, cat, e, f._id, (j + 1) * 10, idPrefix)));
    });
    const ids = out.items.map((it) => it.flags.sacadia.catalogId);
    const dupe = ids.find((id, k) => ids.indexOf(id) !== k);
    if (dupe) throw new Error(`goods: two ${pack} items share the id "${dupe}"`);
    return out;
  };

  return {
    'equipment-goods': build('equipment-goods', 'goods', PERSONAL_GOODS),
    'equipment-trinkets': build('equipment-trinkets', 'trinket', TRINKET_GOODS),
    // Home goods share some names with personal goods (Candle, Blanket): their ids are `home_…`.
    'equipment-home': build('equipment-home', 'home', HOME_GOODS, 'home_'),
  };
}
