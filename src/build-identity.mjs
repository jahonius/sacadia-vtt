/**
 * Build the Heritages & Ancestries and Cultures compendiums and the Cultures of the Ardus Yauga journal from
 * src/identity/ (called by src/build-packs.mjs, which hands over its builders through `kit`).
 *
 * - `heritages` (Item): a folder per Heritage, each with its abilities (granted for the Heritage, rules/identity.mjs), its
 *   global ancestries (`ancestry` items) and their abilities.
 * - `cultures` (Item): a folder per culture: its `culture` item, the talents and language it grants, and subfolders for its
 *   ancestries, its cultural abilities, and its inheritance (gear, or armor and weapons where the item is one).
 * - `cultures-journal` (JournalEntry): the chapter's opening, then each culture: its own page and Cultural Tapestry (from
 *   Markdown), and its Ways and Inheritance (built from the rules data, linking the compendium items).
 */
import { HERITAGE_ABILITIES, ANCESTRY_ABILITIES, ANCESTRIES, HERITAGE_TEXT } from './identity/heritages.mjs';
import { CULTURES, CULTURES_INTRO } from './identity/cultures.mjs';
import { markdownToHtml } from './manual.mjs';

const HERITAGE_NAMES = { human: 'Human', curiot: 'Curiot', daemonai: 'Daemonai', fixerfolk: 'Fixerfolk', fontborne: 'Fontborne', hulinari: 'Hulinari' };
const TAG_LABELS = { P: 'Passive', A: 'Action', R: 'Reaction', B: 'Boost', F: 'Focus', C: 'Ceremony', L: 'Lore' };
const SECTIONS = { business: 'Businesses', craft: 'Crafts and Rituals', traded: 'Traded Goods', ingredient: 'Craft Ingredients' };
const SECTION_LABEL = { business: 'a business', craft: 'a craft or ritual', traded: 'a traded good', ingredient: 'a craft ingredient' };
const SECTION_IMG = { business: 'icons/environment/settlement/market-stall.webp', ingredient: 'icons/commodities/materials/bowl-powder-teal.webp' };
const NO = (v) => !v || /^(no|n\/a)$/i.test(String(v).trim());
/** Inherited items' images, by what they are (first match on the name). */
const INHERITED_IMG = [
  [/glyph/i, 'icons/sundries/scrolls/scroll-bound-sealed-black-red.webp'], [/lantern/i, 'icons/sundries/lights/lantern-bullseye-signal-copper.webp'],
  [/coin|gold$/i, 'icons/commodities/currency/coin-embossed-crown-gold.webp'], [/compass/i, 'icons/tools/navigation/compass-worn-copper.webp'],
  [/boots/i, 'icons/equipment/feet/boots-armored-leather-brown.webp'], [/lockpick/i, 'icons/tools/hand/lockpicks-steel-grey.webp'],
  [/cookbook|tome|notes|scroll|contract/i, 'icons/sundries/books/book-embossed-bound-brown.webp'], [/bag/i, 'icons/containers/bags/case-simple-leather-brown.webp'],
  [/drum/i, 'icons/tools/instruments/drum-hand-tan.webp'], [/whistle/i, 'icons/tools/instruments/flute-simple-wood.webp'],
  [/net$/i, 'icons/environment/traps/net.webp'], [/cheese/i, 'icons/consumables/food/cheese-cube-gold.webp'],
  [/goldmimic|cage/i, 'icons/environment/traps/cage-simple-wood.webp'], [/tavern|restaurant|stew/i, 'icons/environment/settlement/tavern.webp'],
  [/poison|blood$|pigsqueak/i, 'icons/consumables/potions/bottle-conical-corked-labeled-skull-poison-green.webp'],
  [/finger/i, 'icons/commodities/biological/finger-clawed-green-black.webp'], [/cloak/i, 'icons/equipment/back/cloak-brown-collared-fur-white-tied.webp'],
  [/bones|armband/i, 'icons/equipment/neck/amulet-carved-stone-eye.webp'], [/painter/i, 'icons/tools/hand/brush-paint-brown-tan.webp'],
  [/urn|bowl|pot$/i, 'icons/commodities/materials/bowl-powder-gold.webp'], [/staff|pole/i, 'icons/skills/melee/hand-grip-staff-blue.webp'],
  [/minister|position|debt|rights|suan/i, 'icons/sundries/documents/document-sealed-signatures-red.webp'],
  [/marble/i, 'icons/skills/trades/construction-mason-stonecutter-sculpture.webp'], [/ritual/i, 'icons/magic/nature/leaf-glow-maple-orange.webp'],
];

/**
 * Inherited items that are armor or weapons in the system: the equipment they're "treated as", with what differs. Their
 * stats come from src/equipment.mjs; the rest of the rules stay in the description.
 */
const INHERITED_EQUIPMENT = {
  cunei_just_a_good_suit_of_armor: { armor: 'Professional Iron Set', def: { pd: 10 } },
  olganyar_pot_of_the_disciple: { armor: 'Professional Leather Set' },
  myrgha_goldweave_armor: { armor: { name: 'Goldweave Armor', category: '', def: { ad: 5 } } },
  myrgha_goldweave_blade: { weapon: 'Longsword' },
  kishai_grass_pole: { weapon: 'Club or Staff', reach: 10 },
};

/**
 * Inherited businesses the Earn Money Long Rest Action can work instead of an odd job (rules/downtime.mjs): what they pay
 * (gc: a flat amount, a formula in @proficiency, or by the item's rarity), or `oddJobs`, a multiple of odd job pay. One
 * without `earn` asks the player for the amount. `note` is what the action card adds.
 */
const BUSINESSES = {
  tianqi_shrimp_trawler: { earn: '60', note: 'Only in a town on the Lake of Western Lights.' },
  tianqi_stonecutter: { note: 'A Construction: Stonework Check at 1X disadvantage, paid by the Ingredient Rarity chart.' },
  cunei_restaurant_of_forever_stew: { byRarity: { Common: 10, Uncommon: 20, Rare: 40, 'Very Rare': 80, 'Legendary[1]': 100, 'Legendary[2]': 120 },
    note: 'In the same city as the restaurant.' },
  cunei_minister_of_finance: { earn: '50', note: 'Take Pay, at the Ministry.' },
  cunei_minister_of_agriculture: { earn: '50', note: 'Take Pay, at the Ministry.' },
  cunei_minister_of_the_post: { earn: '50', note: 'Take Pay, at the Ministry.' },
  cunei_minister_of_diplomacy: { earn: '50', note: 'Take Pay, at the Ministry.' },
  olganyar_cheese_boat: { earn: '200', note: 'A random number of people eat the cheese.' },
  olganyar_the_red_herring_tavern: { earn: '100', note: 'Open the Bar: the Spirit Counter rises by 2, and on a 19+ on 1D20 the spirits attack.' },
  myrgha_suan_of_the_family: { oddJobs: 3, note: 'Your Oligarch may ask a quest of you for it.' },
};

/** Active effects some inherited items carry. Red Glyph of Armor: +1 to the defense marked each long rest (PD to start). */
const INHERITED_EFFECTS = {
  tianqi_red_glyph_of_armor: [{ name: 'Armor of Blood (PD)', img: 'icons/sundries/scrolls/scroll-bound-sealed-black-red.webp', transfer: true,
    disabled: false, changes: [{ key: 'system.bonuses.defense.pd', mode: 2, value: '1', priority: null }] }],
};

/**
 * @param {object} kit  build-packs internals: makeId, buildActivities, overrideFields, detectRange, ACTIVE_TAGS,
 *   ACTIVITY_OVERRIDES, weaponToItem, armorToItem, WEAPONS, ARMORS, lore (src/lore.json entries)
 * @returns {{heritages: object, cultures: object, journal: {entries: object[], pages: object[], folders: object[]}}}
 */
export function buildIdentity(kit) {
  const { makeId } = kit;
  const uuid = (pack, id, type = 'Item') => `Compendium.sacadia.${pack}.${type}.${makeId(pack, id)}`;

  // Where each ability lives and what it's called, for grants and links.
  const where = new Map();
  for (const a of [...HERITAGE_ABILITIES, ...ANCESTRY_ABILITIES]) where.set(a.id, { pack: 'heritages', name: a.name });
  for (const c of CULTURES) {
    for (const a of cultureAbilities(c)) where.set(a.id, { pack: 'cultures', name: a.name });
  }
  for (const l of kit.lore) where.set(l.id, { pack: 'abilities-lore', name: l.name });
  const abilityUuid = (id) => {
    const w = where.get(id);
    if (!w) throw new Error(`Unknown identity ability "${id}"`);
    return uuid(w.pack, id);
  };
  const link = (id) => `@UUID[${abilityUuid(id)}]{${where.get(id).name}}`;
  const folder = (pack, key, name, parent = null, sort = 0, description = '') => ({
    _id: makeId(pack, `folder:${key}`), _key: `!folders!${makeId(pack, `folder:${key}`)}`, name, type: 'Item', folder: parent, sorting: 'm', sort,
    color: null, description, flags: {},
  });

  /** An ability (heritage, ancestry or cultural) → an `ability` item, through the same overrides as the catalogs. */
  function abilityToItem(pack, e, { subpath, folderId, sort, flags = {} }) {
    const _id = makeId(pack, e.id);
    const tag = e.tag ?? 'passive';
    const activities = kit.ACTIVITY_OVERRIDES[e.id] ?? kit.buildActivities({ description: e.description }, { atkCategory: '' }, tag);
    return {
      _id, _key: `!items!${_id}`, name: e.name, type: 'ability', img: e.img ?? 'icons/svg/book.svg', folder: folderId, sort,
      system: {
        description: `<p>${e.description}</p>`, tag,
        costs: { ap: kit.ACTIVE_TAGS.has(tag) ? 1 : 0, csp: e.csp ?? 0, madness: 0, limbs: [], pool: { key: '', amount: 0, variable: false, max: '' } },
        range: kit.detectRange(e.description),
        meta: { profession: '', subpath, prerequisite: [e.prerequisite, `p.${e.page}`].filter(Boolean).join(' · ') },
        activities,
        ...kit.overrideFields(e.id, tag, e.description),
        ...(e.modifiers ? { modifiers: e.modifiers } : {}),
        ...(e.pick ? { pick: { options: [], label: '', requires: [], ...e.pick } } : {}),
        ...(e.onUse ? { onUse: e.onUse } : {}),
        ...(e.madness ? { madness: e.madness } : {}),
      },
      effects: [],
      flags: { sacadia: { catalogId: e.id, transcribed: true, ...flags,
        ...(e.grantsSpecialty ? { grantsSpecialty: e.grantsSpecialty } : {}),
        ...(e.expertise ? { expertise: e.expertise } : {}),
        ...(e.resistance ? { resistance: e.resistance } : {}),
        ...(e.talentBonus ? { talentBonus: e.talentBonus } : {}) } },
    };
  }

  /** An ancestry → an `ancestry` item granting its abilities. */
  function ancestryToItem(pack, a, { folderId, sort, culture = null }) {
    const _id = makeId(pack, a.id);
    const grants = (a.grants ?? (a.abilities ?? []).map((x) => x.id)).map((g) => (Array.isArray(g) ? g : [g, '']));
    const parts = [`<p>${a.description}</p>`];
    const attrs = [a.size && `<strong>Size:</strong> ${a.size}`, a.lifespan && `<strong>Lifespan:</strong> ${a.lifespan}`].filter(Boolean);
    if (attrs.length) parts.push(`<p>${attrs.join(' · ')}</p>`);
    const always = grants.filter(([, o]) => !o).map(([id]) => link(id));
    if (always.length) parts.push(`<p><strong>Abilities:</strong> ${always.join(', ')}</p>`);
    const chosen = grants.filter(([, o]) => o);
    if (chosen.length) parts.push(`<p><strong>By your Strength of Warp:</strong> ${chosen.map(([id, o]) => `${link(id)} (${o === 'heavy' ? 'Heavily' : 'Lightly'} Warped)`).join(', ')}</p>`);
    if (a.lore?.length) parts.push(`<p><strong>Lore uses</strong> (from level 4): ${a.lore.map(link).join(', ')}</p>`);
    parts.push(`<p><em>${culture ? `${culture.name} ancestry. ` : ''}${HERITAGE_NAMES[a.heritage]} Heritage. Rulebook p.${a.page}.</em></p>`);
    return {
      _id, _key: `!items!${_id}`, name: a.name, type: 'ancestry', img: a.img ?? 'icons/svg/mystery-man.svg', folder: folderId, sort,
      system: { description: parts.join(''), grants: grants.map(([id, option]) => ({ uuid: abilityUuid(id), option })), options: [], choice: '',
        heritage: a.heritage, size: a.size ?? '', lifespan: a.lifespan ?? '' },
      effects: [],
      flags: { sacadia: { catalogId: a.id, ...(a.hulinariForm ? { hulinariForm: a.hulinariForm } : {}), ...(culture ? { culture: culture.key } : {}) } },
    };
  }

  /* ---------------------------------------- Heritages & Ancestries ---------------------------------------- */

  const heritages = { items: [], folders: [] };
  Object.entries(HERITAGE_NAMES).forEach(([key, name], i) => {
    const f = folder('heritages', key, name, null, (i + 1) * 1000, HERITAGE_TEXT[key]);
    heritages.folders.push(f);
    let sort = 0;
    for (const a of HERITAGE_ABILITIES.filter((x) => x.heritage === key)) {
      heritages.items.push(abilityToItem('heritages', a, { subpath: `${name} Heritage`, folderId: f._id, sort: sort += 10,
        flags: { heritage: key, ...(a.choice ? { heritageChoice: a.choice } : {}) } }));
    }
    for (const anc of ANCESTRIES.filter((x) => x.heritage === key)) {
      heritages.items.push(ancestryToItem('heritages', anc, { folderId: f._id, sort: sort += 10 }));
      for (const id of (anc.grants ?? []).map((g) => (Array.isArray(g) ? g[0] : g))) {
        const ab = ANCESTRY_ABILITIES.find((x) => x.id === id);
        if (ab && !heritages.items.some((i) => i.flags.sacadia.catalogId === id)) {
          heritages.items.push(abilityToItem('heritages', ab, { subpath: `${anc.name} Ancestry`, folderId: f._id, sort: sort += 10 }));
        }
      }
    }
  });

  /* ---------------------------------------- Cultures ---------------------------------------- */

  const cultures = { items: [], folders: [] };
  const journal = { entries: [], pages: [] };
  const journalUuid = (key) => uuid('cultures-journal', key, 'JournalEntry');
  CULTURES.forEach((c, i) => {
    const root = folder('cultures', c.key, c.name, null, (i + 1) * 1000);
    const fAnc = folder('cultures', `${c.key}:ancestries`, 'Ancestries', root._id, 100);
    const fAbil = folder('cultures', `${c.key}:abilities`, 'Cultural Abilities', root._id, 200);
    const fInh = folder('cultures', `${c.key}:inheritance`, 'Inheritance', root._id, 300);
    cultures.folders.push(root, ...(c.ancestries.length ? [fAnc] : []), ...(c.groups.length ? [fAbil] : []), fInh);
    const flags = { culture: c.key };

    // The culture item: its laws, what it grants (the language, and the talents, some by the option taken), its subcultures.
    const optionOf = (id) => c.options.find((o) => o.grant === id)?.key ?? '';
    const grants = [...c.talents.map((t) => ({ uuid: abilityUuid(t.id), option: optionOf(t.id) })), { uuid: abilityUuid(c.language.id), option: '' }];
    const cid = `culture_${c.key}`;
    const _id = makeId('cultures', cid);
    cultures.items.push({
      _id, _key: `!items!${_id}`, name: c.name, type: 'culture', img: c.img, folder: root._id, sort: 0,
      system: {
        description: `<p>${c.summary}</p><p>@UUID[${journalUuid(c.key)}]{The ${c.name}: Cultural Tapestry, Ways and Inheritance}</p><p><em>Rulebook p.${c.page}.</em></p>`,
        grants, options: c.options.map(({ key, label }) => ({ key, label })), choice: '',
        aliases: c.aliases, laws: c.laws.map(([name, text, optional]) => ({ name, text, optional: !!optional })),
        subcultures: c.subcultures, subculture: '', journal: journalUuid(c.key),
      },
      effects: [],
      flags: { sacadia: { catalogId: cid, ...flags } },
    });
    let sort = 10;
    for (const t of [...c.talents, { tag: 'passive', ...c.language, img: c.language.img ?? 'icons/sundries/documents/document-letter-tan.webp' }]) {
      const subpath = t.id === c.language.id ? `${c.name} Language` : `${c.name} Cultural Talent`;
      cultures.items.push(abilityToItem('cultures', { prerequisite: `${c.name} Cultural Heritage`, ...t }, { subpath, folderId: root._id, sort: sort += 10, flags }));
    }
    sort = 0;
    for (const a of c.ancestries) {
      cultures.items.push(ancestryToItem('cultures', a, { folderId: fAnc._id, sort: sort += 10, culture: c }));
      for (const ab of a.abilities ?? []) cultures.items.push(abilityToItem('cultures', ab, { subpath: `${a.name} Ancestry`, folderId: fAnc._id, sort: sort += 10, flags }));
    }
    sort = 0;
    for (const g of c.groups) {
      for (const ab of g.abilities) cultures.items.push(abilityToItem('cultures', ab, { subpath: `${c.name}: ${g.label}`, folderId: fAbil._id, sort: sort += 10, flags }));
    }
    sort = 0;
    for (const e of c.inheritance) cultures.items.push(inheritedToItem(c, e, { folderId: fInh._id, sort: sort += 10 }));

    // The journal: the culture's own page and Cultural Tapestry, then its Ways and Inheritance.
    const entryId = makeId('cultures-journal', c.key);
    const md = c.markdown.split(/^(?=# )/m).filter((s) => s.trim());
    const pages = [
      ...md.map((s) => markdownToHtml(s)),
      { title: `${c.name} Ways`, html: waysHtml(c) },
      { title: 'Inheritance', html: inheritanceHtml(c) },
    ].map((p, n) => page(entryId, `${c.key}:${n}`, p.title, p.html, n));
    journal.pages.push(...pages);
    journal.entries.push(entry(entryId, `The ${c.name}`, pages, (i + 2) * 1000, { culture: c.key }));
  });

  // The chapter's opening, with the map, and how cultures work on the sheet.
  const introId = makeId('cultures-journal', 'intro');
  const introPages = [
    { title: 'Cultures of Sacadia', html: `<p><img src="systems/sacadia/assets/adventures/the-breach/ardus-yauga.webp" alt="Map of Cultures of the Ardus Yauga"/></p>${markdownToHtml(`# Cultures of Sacadia\n\n${CULTURES_INTRO}`).html}` },
    { title: 'The Starter Cultures', html: `<ul>${CULTURES.map((c) => `<li><strong>@UUID[${journalUuid(c.key)}]{The ${c.name}}.</strong> ${c.summary}</li>`).join('')}</ul>` },
    { title: 'On Your Character Sheet', html: markdownToHtml(SHEET_GUIDE).html },
  ].map((p, n) => page(introId, `intro:${n}`, p.title, p.html, n));
  journal.pages.unshift(...introPages);
  journal.entries.unshift(entry(introId, 'Cultures of the Ardus Yauga', introPages, 0, { intro: true }));

  return { heritages, cultures, journal };

  /* ---------------------------------------- helpers ---------------------------------------- */

  function page(entryId, key, name, html, n) {
    const pid = makeId('cultures-journal', `page:${key}`);
    return { _id: pid, _key: `!journal.pages!${entryId}.${pid}`, name, type: 'text', sort: (n + 1) * 100000,
      title: { show: true, level: 1 }, text: { format: 1, content: html }, ownership: { default: -1 }, flags: {} };
  }
  function entry(id, name, pages, sort, flags) {
    return { _id: id, _key: `!journal!${id}`, name, pages: pages.map((p) => p._id), ownership: { default: 2 }, sort, folder: null,
      flags: { sacadia: flags } };
  }

  /** An inherited item → `gear` (or armor / a weapon, INHERITED_EQUIPMENT), with its stat block as the description's head. */
  function inheritedToItem(c, e, { folderId, sort }) {
    const _id = makeId('cultures', e.id);
    const slots = Number(/^\d+/.exec(e.slots ?? '')?.[0] ?? 0);
    const props = /\(([^)]*)\)/.exec(e.slots ?? '')?.[1] ?? '';
    const slotText = /^\d/.test(e.slots ?? '') ? `${e.slots.replace(/^(\d+)/, (n) => `${n} item slot${n === '1' ? '' : 's'}`)}.`
      : `No item slots${props ? ` (${props})` : ''}.`;
    const head = [`${c.name} Inheritance: ${SECTION_LABEL[e.section]}.`, `${[e.rarity, e.element].filter((x) => !NO(x)).join(', ')}.`, slotText,
      !NO(e.attunement) ? 'Attunement.' : '', !NO(e.uses) ? `Uses: ${e.uses}.` : '', !NO(e.relic) ? 'Relic.' : '',
      !NO(e.special) ? `Special Property: ${e.special}.` : ''].filter(Boolean).join(' ');
    const parts = [`<p><em>${head}</em></p>`];
    if (!NO(e.prerequisites)) parts.push(`<p><strong>Prerequisites:</strong> ${e.prerequisites}</p>`);
    parts.push(`<p>${e.description}</p>`);
    for (const ef of e.effects) {
      const tags = ef.tags ? ` (${ef.tags.split(',').map((t) => TAG_LABELS[t] ?? t).join(', ')})` : '';
      parts.push(`<p><strong>${ef.name}</strong>${tags}${ef.text ? `: ${ef.text.split('\n').join('<br/>')}` : ''}</p>`);
    }
    if (e.abilities?.length) parts.push(`<p><strong>Its pacts:</strong> ${e.abilities.map(link).join(', ')}</p>`);
    if (e.note) parts.push(`<p>${e.note}</p>`);
    parts.push(`<p><em>Rulebook p.${e.page}.</em></p>`);
    const description = parts.join('');
    const flags = { sacadia: { catalogId: e.id, kind: 'inheritance', culture: c.key, ...(BUSINESSES[e.id] ? { business: BUSINESSES[e.id] } : {}),
      inheritance: { section: e.section, rarity: e.rarity, element: e.element, attunement: !NO(e.attunement), uses: NO(e.uses) ? '' : e.uses,
        relic: !NO(e.relic), special: NO(e.special) ? '' : e.special } } };
    const eq = INHERITED_EQUIPMENT[e.id];
    let item;
    if (eq?.armor) {
      const base = typeof eq.armor === 'string' ? kit.ARMORS.find((a) => a.name === eq.armor) : eq.armor;
      item = kit.armorToItem('cultures', { ...base, name: e.name, def: { ...(base.def ?? {}), ...(eq.def ?? {}) } });
      item.system.description = description;
    } else if (eq?.weapon) {
      item = kit.weaponToItem('cultures', { ...kit.WEAPONS.find((w) => w.name === eq.weapon), name: e.name, ...(eq.reach ? { reach: eq.reach } : {}) });
      item.system.description = description;
    } else {
      item = { name: e.name, type: 'gear', system: { description, quantity: 1, weight: 0, value: 0, slots, storage: 'ris', providesSis: 0,
        traits: /craft ingredient/i.test(props) ? 'ingredient' : '' } };
    }
    return {
      ...item, _id, _key: `!items!${_id}`, name: e.name, folder: folderId, sort,
      img: e.img ?? INHERITED_IMG.find(([re]) => re.test(e.name))?.[1] ?? SECTION_IMG[e.section] ?? (item.type === 'armor' ? 'icons/equipment/chest/breastplate-banded-steel-gold.webp' : item.img === 'icons/svg/sword.svg' ? 'icons/weapons/swords/sword-guard-gold-red.webp' : 'icons/containers/chest/chest-reinforced-steel-red.webp'),
      effects: (INHERITED_EFFECTS[e.id] ?? []).map((ef, n) => ({ _id: makeId('cultures', `${e.id}:effect:${n}`), ...ef, flags: {} })),
      // An inheritance isn't on a market's Shop for Bargains table, whatever equipment it's treated as.
      flags: { ...(item.flags ?? {}), ...flags, sacadia: { ...(({ bargain, ...rest }) => rest)(item.flags?.sacadia ?? {}), ...flags.sacadia } },
    };
  }

  /** The culture's Ways page: Binding Laws and Customs, cultural talent and language, subcultures, ancestries, abilities. */
  function waysHtml(c) {
    const out = [`<p>${c.name} gain access to the following unique abilities, customs, and ancestries. The culture item is @UUID[${uuid('cultures', `culture_${c.key}`)}]{${c.name}}: choose it on your sheet’s Character tab.</p>`];
    out.push('<h2>Binding Laws and Customs</h2>', `<p>If you play ${/^[AEIOU]/.test(c.name) ? 'an' : 'a'} ${c.name}, you are bound by these Laws and Customs:</p>`,
      `<ul>${c.laws.map(([n, t, opt]) => `<li><strong>${opt ? '(Optional) ' : ''}${n}:</strong> ${t}</li>`).join('')}</ul>`);
    out.push('<h2>Cultural Talent</h2>', c.options.length ? `<p>All ${c.name} start off with one of the following Cultural Talents:</p>` : '');
    out.push(`<ul>${c.talents.map((t) => `<li>${link(t.id)}${t.prerequisite && !/Cultural Heritage$/.test(t.prerequisite) ? ` (${t.prerequisite})` : ''}: ${t.description}</li>`).join('')}</ul>`);
    out.push('<h2>Language</h2>', `<p>${link(c.language.id)}: ${c.language.description}</p>`);
    if (c.subcultures.length) out.push('<h2>Subcultures</h2>', `<p>${c.subcultures.join(' and ')}. Choose yours with the culture on your sheet.</p>`);
    if (c.ancestries.length) {
      out.push('<h2>Unique Ancestries</h2>');
      for (const a of c.ancestries) {
        const abil = (a.grants ?? (a.abilities ?? []).map((x) => x.id)).map((g) => link(Array.isArray(g) ? g[0] : g));
        out.push(`<h3>@UUID[${uuid('cultures', a.id)}]{${a.name}} (${HERITAGE_NAMES[a.heritage]})</h3>`, `<p>${a.description}</p>`,
          `<p>${[a.size && `<strong>Size:</strong> ${a.size}`, a.lifespan && `<strong>Lifespan:</strong> ${a.lifespan}`, abil.length && `<strong>Abilities:</strong> ${abil.join(', ')}`,
            a.lore?.length && `<strong>Lore:</strong> ${a.lore.map(link).join(', ')}`].filter(Boolean).join(' · ')}</p>`);
      }
    }
    if (c.groups.length) {
      out.push('<h2>Unique Abilities</h2>');
      for (const g of c.groups) {
        out.push(`<h3>${g.label}</h3>`, g.note ? `<p>${g.note}</p>` : '',
          `<ul>${g.abilities.map((a) => `<li>${link(a.id)}${a.csp ? ` [${a.csp}]` : ''}${a.prerequisite ? ` (${a.prerequisite})` : ''}</li>`).join('')}</ul>`);
      }
    }
    return out.filter(Boolean).join('\n');
  }

  /** The culture's Inheritance page: its rules notes, then its items by section. */
  function inheritanceHtml(c) {
    const out = [`<p>The following are some magic items, businesses, rituals, and other inheritable items that you can acquire if you choose to play ${/^[AEIOU]/.test(c.name) ? 'an' : 'a'} ${c.name}, provided you meet the requirements. Drag one onto your sheet.</p>`];
    if (c.inheritanceNotes) out.push(markdownToHtml(c.inheritanceNotes).html);
    for (const [key, label] of Object.entries(SECTIONS)) {
      const items = c.inheritance.filter((e) => e.section === key);
      if (!items.length) continue;
      out.push(`<h2>${label}</h2>`, `<ul>${items.map((e) => `<li>@UUID[${uuid('cultures', e.id)}]{${e.name}} (${[e.rarity, e.element].filter((x) => !NO(x)).join(', ')})${NO(e.prerequisites) ? '' : `: ${e.prerequisites}`}</li>`).join('')}</ul>`);
    }
    return out.join('\n');
  }
}

/** Every ability a culture's data defines (talents, language, ancestries' and groups'). */
export function cultureAbilities(c) {
  return [...c.talents, { tag: 'passive', ...c.language }, ...c.ancestries.flatMap((a) => a.abilities ?? []), ...c.groups.flatMap((g) => g.abilities)];
}

/** "On Your Character Sheet", the journal's guide to choosing a heritage, ancestry and culture. */
const SHEET_GUIDE = `# On Your Character Sheet

Choose where your character comes from on the **Character** tab, under **Identity**:

- **Heritage:** one of the six. Your Heritage's HP at Level 1 is added to your Max HP, and its abilities are added to your sheet. A Daemonai chooses Intuit or Speak there (Natural Charisma), and a Fontborne chooses Lightly or Heavily Warped (Strength of Warp).
- **Ancestry:** the ancestries of your Heritage, from the **Heritages & Ancestries** compendium and every culture's unique ones. Your ancestry's abilities are added to your sheet. A Hulinari's ancestry is their form (Pack, Brute or Swarm), which also sets their Hulinari Warrior form.
- **Culture:** one of the five starter cultures, from the **Cultures** compendium. Its Binding Laws and Customs show on the Character tab, and its cultural talent and language are added to your sheet. A cultural talent that gives a level of a specialized talent (Heibrim Lore's Religion: Demon Lore) adds it to your specialized talents.

What they grant is taken back if you change them. Cultural abilities are bought like any other ability: drag them from the culture's **Cultural Abilities** folder. Their prerequisites check your culture, subculture, ancestry and Heritage. An inherited item is dragged from the culture's **Inheritance** folder.

**Your own culture.** Make a **Culture** item (Items tab → Create Item → Culture) with its laws, its language and talent abilities (drag them onto it) and any subcultures, and it's offered on every sheet. An **Ancestry** item is made the same way.`;
