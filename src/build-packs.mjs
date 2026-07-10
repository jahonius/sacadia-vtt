/**
 * Build the ability compendium packs from the Roll20 sheet catalogs.
 *
 * The Roll20 `sheet.html` holds book-transcribed catalog objects (`ORACLE_ABILITY_CATALOG`, …).
 * This script extracts each one, transforms every entry into a Sacadia `ability` Item, writes a
 * reviewable per-ability source JSON under `src/packs/<pack>/`, then compiles each profession into
 * a LevelDB compendium under `packs/<pack>` (the format Foundry loads natively).
 *
 * Run: `node src/build-packs.mjs`  (also `npm run build:packs`).
 *
 * Transform fidelity notes:
 *  - Faithful: name, tag, CSP/madness/limb costs, subpath, prerequisite, description.
 *  - Structured damage is carried for the entries whose catalog encoded it (`damage` block) as a
 *    `damage` activity; attack-category / save-trait tagging lives only in prose, so it's left for
 *    a manual polish pass (recorded honestly — not guessed).
 *  - `modifiesDamage` (per-ability die-step passives) is stashed in `flags.sacadia` for a later
 *    pass; our die-step sink is global, so it isn't auto-wired to a specific target here.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ClassicLevel } from 'classic-level';
import { MASTERIES } from './masteries.mjs';
import { ADORNMENTS, TRINKETS, WEAPONS, ARMORS, SHIELDS } from './equipment.mjs';
import { MODIFIER_OVERRIDES, CHOICE_OVERRIDES, MARK_OVERRIDES, FOCUS_OVERRIDES, INFLICT_OVERRIDES, GRANT_OVERRIDES } from './modifiers.mjs';
import { MADNESS_ANNOTATIONS } from './madness.mjs';

// Pool-granting abilities (one per pool): they set the pool's max, never charge it. Their pool cost is
// blanked at build so the detector's "consumes a point" flavour doesn't mis-charge them.
const POOL_GRANT_IDS = new Set([
  'bd_arrangement', 'tighten_focus', 'future_visions', 'trickshot',
  'steeltip', 'get_down', 'call_to_action', 'thug_wrestling_trick',
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = path.join(ROOT, 'roll20sheet', 'sheet.html');
const SRC_PACKS = path.join(ROOT, 'src', 'packs');
const OUT_PACKS = path.join(ROOT, 'packs');

// catalog const name + the pack it feeds. `profession` is our bounded profession key (blank for the
// shared General catalog, which isn't a profession).
// `atkCategory` is the catalog's `defaultAtkCategory` (from ALL_CATALOG_REGISTRATIONS): the attack
// category stamped on this profession's attack abilities unless the description/entry says otherwise.
const CATALOGS = {
  'abilities-oracle': { constName: 'ORACLE_ABILITY_CATALOG', profession: 'oracle', atkCategory: 'magic', label: 'Oracle Abilities' },
  'abilities-general': { constName: 'GENERAL_ABILITY_CATALOG', profession: '', atkCategory: '', label: 'General Abilities' },
  'abilities-soldier': { constName: 'SOLDIER_ABILITY_CATALOG', profession: 'soldier', atkCategory: 'melee', label: 'Soldier Abilities' },
  'abilities-sentinel': { constName: 'SENTINEL_ABILITY_CATALOG', profession: 'sentinel', atkCategory: 'ranged', label: 'Sentinel Abilities' },
  'abilities-bladedancer': { constName: 'BLADEDANCER_ABILITY_CATALOG', profession: 'bladedancer', atkCategory: 'melee', label: 'Bladedancer Abilities' },
  'abilities-thug': { constName: 'THUG_ABILITY_CATALOG', profession: 'thug', atkCategory: 'melee', label: 'Thug Abilities' },
};

const LIMB_MAP = { 1: 'oneArm', 2: 'twoArm', 3: 'body', 4: 'mind', 5: 'focus', 6: 'leg' };
const TAG_MAP = { action: 'action', boost: 'boost', focus: 'focus', passive: 'passive', reaction: 'reaction', ceremony: 'ceremony', lore: 'lore' };
// baseLadderIndex → die denomination (single-die region of the ladder, book p.218).
const LADDER_DIE = [2, 4, 6, 8, 10];
const STAT_KEYS = ['power', 'finesse', 'wiles', 'courage', 'fate'];
const ACTIVE_TAGS = new Set(['action', 'focus', 'ceremony']);
// Tags whose ability is a thing you *use* (so "make an attack" / "make a Check vs your Check DC" in
// the text is this ability's own roll, not a passive trigger or a modifier on someone else's).
const ACTIONABLE_TAGS = new Set(['action', 'focus', 'ceremony', 'reaction']);
const DEFAULT_IMG = 'icons/svg/book.svg';

// Generated ability icons live at assets/icons/abilities/<profession>/<catalogId>_icon.<ext> (see
// src/generate-icons.mjs). When one exists, wire the ability's img to it (a Foundry data path under the
// system root); otherwise keep the svg default. Directory listings are cached per profession.
const ICON_BASE = path.join(ROOT, 'assets', 'icons', 'abilities');
const _iconDirCache = new Map();
function iconFor(pack, catalogId) {
  if (!pack.startsWith('abilities-')) return null;
  const profession = pack.replace(/^abilities-/, '');
  if (!_iconDirCache.has(profession)) {
    const dir = path.join(ICON_BASE, profession);
    _iconDirCache.set(profession, fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  }
  const safe = catalogId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${safe}(_icon)?\\.(png|jpe?g)$`, 'i');
  const file = _iconDirCache.get(profession).find((f) => re.test(f));
  return file ? `systems/sacadia/assets/icons/abilities/${profession}/${file}` : null;
}

/* -------------------------------------------- */

/** Extract a `const NAME = { … }` object literal from JS source and eval it to a real object. */
function extractCatalog(source, constName) {
  const decl = new RegExp(`const\\s+${constName}\\s*=\\s*`).exec(source);
  if (!decl) throw new Error(`Catalog ${constName} not found`);
  let i = source.indexOf('{', decl.index);
  const start = i;
  let depth = 0, str = null, esc = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { i++; break; }
  }
  const literal = source.slice(start, i);
  // Trusted local build content; eval to honour JS comments/trailing commas the catalogs use.
  return new Function(`return (${literal});`)();
}

/** Stable 16-char hex id from the pack + catalog id, so rebuilds don't churn document ids. */
function makeId(pack, catalogId) {
  return crypto.createHash('sha1').update(`${pack}:${catalogId}`).digest('hex').slice(0, 16);
}

/**
 * Convert Roll20 attribute refs to our roll-data keys: `@{proficiency}` → `@proficiency`, and
 * `@{condition_madness}` → `@madness` (our roll data exposes condition levels by bare key).
 */
const deref = (s) => String(s ?? '').replace(/@\{(?:condition_)?(\w+)\}/g, '@$1');

/** One structured damage part from a catalog `damage` block. */
function buildDamagePart({ countFormula, baseLadderIndex, suffix }) {
  // A trailing `+ @{stat}` becomes the part's trait; anything else stays in the freeform formula.
  const traitMatch = /\+\s*@\{(\w+)\}\s*$/.exec(suffix ?? '');
  const trait = traitMatch && STAT_KEYS.includes(traitMatch[1]) ? traitMatch[1] : '';
  const leftover = trait ? '' : deref(suffix ?? '').replace(/^\s*\+\s*/, '').trim();
  return { count: deref(countFormula) || '1', denomination: LADDER_DIE[baseLadderIndex] ?? null, formula: leftover, trait, type: '' };
}

// Save phrasings the catalog uses, all implying a check vs the user's Check DC. Stat-gated so the
// many non-save "<Trait> Check" mentions (Trait Boons, prerequisites, talents) don't false-match.
const SAVE_PATTERNS = [
  // "<Trait> Check against you / this effect / your Check DC" — the target rolls to resist.
  /\b(?:make|makes|roll|rolls)\s+(?:a|an)\s+(\w+)\s+(?:Check|save)\s+against\b/i,
  /\b(?:make|makes|roll|rolls)\s+(?:a|an)\s+(\w+)\s+(?:Check|save)\b[^.]{0,50}\bCheck DC\b/i,
  /\b(\w+)\s+(?:Check|save)\s+negates\b/i,
  /\bmust\s+(?:make|succeed on)\s+(?:a|an)\s+(\w+)\s+(?:Check|save)\b/i,
  // Subject-anchored: a TARGET (they/it/enemy/creature/all …) makes/rolls a <Trait> Check[s]. Catches
  // "They roll Wiles Checks against the effect", "All targets make Wiles Checks", "They make a Courage
  // Check. If they fail". The subject list excludes "Check you make" (the roller's own check).
  /\b(?:they|it|targets?|enem(?:y|ies)|creatures?|everything|all\s+(?:enemies|targets|creatures))(?:\s+\w+){0,4}?\s+(?:make|makes|roll|rolls)\s+(?:an?\s+)?(power|courage|wiles|finesse|fate)\s+(?:Check|save)s?\b/i,
];

// Prose condition names → leveled-condition keys (for auto-detecting "give <Condition>" infliction).
const CONDITION_NAMES = {
  hemorrhage: 'hemorrhage', taunt: 'taunt', panic: 'panic', pin: 'pinned', pinned: 'pinned',
  paralysis: 'paralysis', nausea: 'nausea', corroded: 'corroded', debilitated: 'debilitated',
  delirium: 'delirium', jinxed: 'jinxed', slowed: 'slowed', sting: 'sting', fatigue: 'fatigue',
  frenzy: 'frenzy', fumbled: 'fumbled', rended: 'rended', madness: 'madness', silenced: 'silenced',
};

// Refs an inflict amount may scale off (gates the "your <X>" parse so incidental "your turn/square"
// don't match). Stats + the derived scalars that condition levels commonly key on.
const AMOUNT_REFS = [...STAT_KEYS, 'proficiency', 'madness', 'level'];

/**
 * Parse the amount that scales an inflicted condition into a roll formula (default "1"). Handles
 * "equal to …", "up to …", "X is half your <Stat> (rounded up/down)", and a leading integer. The
 * "half your <Stat>" form is tried first (and wins over a bare "your <Stat>"), so e.g. Crying Maiden's
 * area radius "5x your Madness" doesn't get mistaken for the (half-Proficiency) condition amount.
 */
function parseInflictAmount(after) {
  const a = after.toLowerCase();
  const half = /half\s+(?:your\s+|the\s+)?(\w+)/.exec(a);
  if (half && AMOUNT_REFS.includes(half[1])) return `${/round(?:ed)?\s+up/.test(a) ? 'ceil' : 'floor'}(@${half[1]}/2)`;
  const stat = /(?:equal to|up to)\s+(?:your\s+)?(\w+)/.exec(a) ?? /\byour\s+(\w+)/.exec(a);
  if (stat && AMOUNT_REFS.includes(stat[1])) return `@${stat[1]}`;
  // Bare integer — but not one that's part of a distance/multiplier ("5ft", "5x your Madness"), which
  // is geometry, not a condition level.
  const n = /(?:equal to\s+)?(\d+)(?!\s*(?:ft|feet|x\b|%))/.exec(a);
  return n ? n[1] : '1';
}

/** Detect leveled conditions a description inflicts: "give [them/a/N level of] <Condition> [equal to …]". */
function detectInflict(desc) {
  // "give"/"gain" a condition; the CONDITION_NAMES gate rejects non-conditions ("gain HP", "give ground").
  const re = /\b(?:giv|gain|inflict)[a-z]*\s+(?:them\s+|it\s+|a\s+|an\s+|one\s+|1\s+|X\s+levels?\s+of\s+|X\s+|your\s+|the\s+|level\s+of\s+|\d+\s+levels?\s+of\s+)*([A-Z][a-z]+)/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(desc))) {
    const key = CONDITION_NAMES[m[1].toLowerCase()];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ condition: key, amount: parseInflictAmount(desc.slice(m.index + m[0].length, m.index + m[0].length + 130)) });
  }
  return out;
}

// Signature class point-pool names → keys (for auto-detecting "expend N <Pool> point(s)"). Includes
// Soldier "call" and Thug "trick" pools (both `CONFIG.SACADIA.pools` ids).
const POOL_NAMES = { arrangement: 'arrangement', glory: 'glory', prescient: 'prescient', trickshot: 'trickshot', savage: 'savage', herd: 'herd', call: 'call', trick: 'trick' };
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * Detect a pool cost: "expend [N|a|one|two|X|any number of] <Pool> point(s)". Returns `{ key, amount,
 * variable, max }`. A player-chosen quantity ("X", "any number of", "up to …") is `variable: true`
 * (prompted on use); `max` captures an "up to <@ref>" bound (e.g. "up to your Proficiency" → `@proficiency`).
 * Case-insensitive (prose often opens a sentence with "Expend").
 */
function detectPoolCost(desc) {
  const m = /\bexpend[a-z]*\s+(\d+|a number of|any number of|any|an|a|one|two|three|four|five|six|your|x)\s+(?:additional\s+|more\s+)?([a-z]+)\s+points?/i.exec(desc);
  const key = m && POOL_NAMES[m[2].toLowerCase()];
  if (!key) return { key: '', amount: 0, variable: false, max: '' };
  const q = m[1].toLowerCase();
  const variable = q === 'x' || q === 'any' || q === 'any number of' || q === 'a number of';
  // "up to (half )?your <Stat>" bound following the phrase → an @ref for the prompt ceiling.
  const upTo = /up to\s+(half\s+)?your\s+(\w+)/i.exec(desc.slice(m.index, m.index + 90));
  const max = upTo ? (upTo[1] ? `ceil(@${upTo[2].toLowerCase()}/2)` : `@${upTo[2].toLowerCase()}`) : '';
  if (variable) return { key, amount: 0, variable: true, max };
  const amount = /\d+/.test(q) ? parseInt(q, 10) : (WORD_NUM[q] ?? 1);
  return { key, amount, variable: false, max: '' };
}

/**
 * Detect an ability's range from prose (honest, conservative). The targeting distance is almost
 * always phrased "within N ft/feet" or "range of N ft" — take the first such number as a `ranged`
 * distance. Otherwise, an explicit melee/self/touch attack sets the type without a number. Unknown
 * ranges stay blank for a GM to fill. Returns `{ value, type }`.
 */
function detectRange(desc) {
  const m = /\b(?:within|range of|reach of)\s+(\d+)\s?(?:ft|feet)\b/i.exec(desc);
  if (m) return { value: parseInt(m[1], 10), type: 'ranged' };
  if (/\bmelee\s+(?:attack|weapon|reaction)/i.test(desc)) return { value: null, type: 'melee' };
  if (/\btouch\b/i.test(desc)) return { value: null, type: 'touch' };
  return { value: null, type: '' };
}

/** The save trait a description forces (vs the user's Check DC), or null if none. */
function detectSaveTrait(desc) {
  for (const p of SAVE_PATTERNS) {
    const m = p.exec(desc);
    if (m && STAT_KEYS.includes(m[1].toLowerCase())) return m[1].toLowerCase();
  }
  return null;
}

// Attack category comes from the *audited* structural source — a per-entry override, else the
// catalog default — NOT the prose. The descriptions say things like "make a ranged attack vs MD"
// for an Oracle spell that is mechanically a *magic* (Wiles) attack; "ranged" there is the range,
// not the category, so parsing it would mis-tag the trait. General (no default) stays blank.

/**
 * Build the activities for an ability. An *actionable* ability (Action/Focus/Ceremony/Reaction)
 * whose text says "make a … attack" becomes an `attack` activity (category structural, target
 * defense parsed from "vs XD"); one that forces a "<Trait> Check against your Check DC" becomes a
 * `save` activity; either carries any structured damage. Everything else falls back to a bare
 * `damage` activity (if the catalog encoded damage) or none.
 */
function buildActivities(entry, cfg, tag) {
  const desc = entry.description ?? '';
  const damage = entry.damage ? [buildDamagePart(entry.damage)] : [];
  const inflict = detectInflict(desc);
  const blankAtk = { category: '', trait: '', defense: '' };
  const blankSave = { trait: '', dc: null };

  if (ACTIONABLE_TAGS.has(tag)) {
    if (/\bmake[a-z]*\s+(?:a|an|one|1)\b[^.]{0,80}\battack\b/i.test(desc)) {
      const def = /\bvs\.?\s*(AD|PD|TD|MD)\b/i.exec(desc)
        || /\bagainst\s+(?:their|its|the|your|his|her)?\s*(AD|PD|TD|MD)\b/i.exec(desc);
      return [{
        type: 'attack',
        label: '',
        attack: {
          category: entry.atkCategory || cfg.atkCategory || '',
          trait: STAT_KEYS.includes(entry.atkTrait) ? entry.atkTrait : '',
          defense: def ? def[1].toLowerCase() : '',
        },
        save: blankSave,
        damage,
        inflict,
      }];
    }
    const saveTrait = detectSaveTrait(desc);
    if (saveTrait !== null) {
      return [{ type: 'save', label: '', attack: blankAtk, save: { trait: saveTrait, dc: null }, damage, inflict }];
    }
  }

  if (damage.length) return [{ type: 'damage', label: '', attack: blankAtk, save: blankSave, damage, inflict }];
  return [];
}

/** Transform one Roll20 catalog entry into a Sacadia `ability` Item document. */
/**
 * Convert the legacy per-ability die-step shape `[{target, ladderSteps}]` into unified
 * `system.modifiers` entries (see docs/conditional-modifiers.md): an unconditional die-step scoped to
 * the named ability's catalogId.
 */
function modifiesToModifiers(list = [], label = '') {
  return (list ?? []).filter((m) => m?.target).map((m) => ({
    label, target: 'damage', mode: 'step', scope: m.target, value: String(m.ladderSteps ?? 0), predicate: [],
  }));
}

function toItem(pack, cfg, catalogId, entry) {
  const _id = makeId(pack, catalogId);
  const tag = TAG_MAP[String(entry.tag ?? '').toLowerCase()] ?? 'action';
  const limbs = entry.limb != null && LIMB_MAP[entry.limb] ? [LIMB_MAP[entry.limb]] : [];
  const madness = Number(entry.madness);
  const activities = buildActivities(entry, cfg, tag);
  // Authored inflict for effects whose prose doesn't name a tracked condition (e.g. Bound Tongue's
  // "cannot speak or cast spells" → Silenced): attach to the activity that carries inflict.
  if (INFLICT_OVERRIDES[catalogId] && activities.length) activities[0].inflict = INFLICT_OVERRIDES[catalogId];
  return {
    _id,
    _key: `!items!${_id}`,
    name: entry.name ?? catalogId,
    type: 'ability',
    img: iconFor(pack, catalogId) ?? DEFAULT_IMG,
    system: {
      description: entry.description ? `<p>${deref(entry.description)}</p>` : '',
      tag,
      costs: {
        ap: ACTIVE_TAGS.has(tag) ? 1 : 0,
        csp: Number(entry.cspCost) || 0,
        madness: Number.isFinite(madness) ? madness : 0,
        limbs,
        // A pool-granting ability *creates* the pool; it never spends it — so blank the cost the
        // detector reads from its "using a call consumes a point" flavour (see POOL_GRANT_IDS).
        pool: POOL_GRANT_IDS.has(catalogId)
          ? { key: '', amount: 0, variable: false, max: '' }
          : detectPoolCost(entry.description ?? ''),
      },
      range: detectRange(entry.description ?? ''),
      meta: {
        profession: cfg.profession,
        subpath: entry.subpath ?? '',
        prerequisite: entry.prerequisite ?? '',
      },
      activities,
      // Unified conditional modifiers (docs/conditional-modifiers.md): legacy per-ability die-steps
      // plus any hand-authored overrides for this catalogId. `selfScaling` (level-based base-die
      // growth) stays a flag — it's a different mechanism, not a conditional buff.
      modifiers: [...modifiesToModifiers(entry.modifiesDamage, entry.name ?? catalogId), ...(MODIFIER_OVERRIDES[catalogId] ?? [])],
      ...(CHOICE_OVERRIDES[catalogId] ? { choice: CHOICE_OVERRIDES[catalogId] } : {}),
      ...(MARK_OVERRIDES[catalogId] ? { mark: MARK_OVERRIDES[catalogId] } : {}),
      ...(FOCUS_OVERRIDES[catalogId] ? { focus: FOCUS_OVERRIDES[catalogId] } : {}),
      ...(GRANT_OVERRIDES[catalogId] ? { grant: GRANT_OVERRIDES[catalogId] } : {}),
      ...(MADNESS_ANNOTATIONS[catalogId] ? { madness: MADNESS_ANNOTATIONS[catalogId] } : {}),
    },
    effects: [],
    flags: {
      sacadia: {
        catalogId,
        ...(entry.damage?.selfScaling ? { selfScaling: entry.damage.selfScaling } : {}),
      },
    },
  };
}

/** A Level-5 profession Mastery → a passive `ability` Item (see masteries.mjs). */
function masteryToItem(m) {
  const _id = makeId('abilities-masteries', m.id);
  return {
    _id,
    _key: `!items!${_id}`,
    name: m.name,
    type: 'ability',
    img: iconFor('abilities-masteries', m.id) ?? 'icons/svg/upgrade.svg',
    system: {
      description: `<p>${m.description}</p>`,
      tag: 'passive',
      costs: { ap: 0, csp: 0, madness: 0, limbs: [] },
      meta: { profession: m.profession, subpath: '', prerequisite: 'Level 5' },
      activities: [],
      modifiers: [...modifiesToModifiers(m.modifiesDamage, m.name), ...(MODIFIER_OVERRIDES[m.id] ?? [])],
    },
    effects: [],
    flags: { sacadia: { catalogId: m.id, mastery: true } },
  };
}

/** A hand-transcribed profession entry (professions-extra.json) → an `ability` Item. Limbs are
 *  absent (PDF drops the icons) — flagged `transcribed` and addable via the sheet's limb picker. */
function extraToItem(pack, cfg, entry) {
  const id = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  const tag = entry.tag;
  return {
    _id,
    _key: `!items!${_id}`,
    name: entry.name,
    type: 'ability',
    img: iconFor(pack, id) ?? DEFAULT_IMG,
    system: {
      description: entry.description ? `<p>${deref(entry.description)}</p>` : '',
      tag,
      costs: { ap: ACTIVE_TAGS.has(tag) ? 1 : 0, csp: entry.cspCost || 0, madness: 0, limbs: [], pool: detectPoolCost(entry.description || '') },
      range: detectRange(entry.description || ''),
      meta: { profession: cfg.profession, subpath: '', prerequisite: entry.prerequisite || '' },
      activities: buildActivities(entry, cfg, tag),
    },
    effects: [],
    flags: { sacadia: { catalogId: id, transcribed: true } },
  };
}

/** An Adornment/Trinket → a `gear` Item carrying the effect as rules text + retail value. */
function equipmentToItem(pack, kind, e) {
  const id = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  return {
    _id,
    _key: `!items!${_id}`,
    name: e.name,
    type: 'gear',
    img: kind === 'adornment' ? 'icons/svg/statue.svg' : 'icons/svg/chest.svg',
    system: { description: `<p>${e.description}</p>`, quantity: 1, weight: 0, value: e.value ?? 0 },
    effects: [],
    flags: { sacadia: { catalogId: id, kind, ...(e.armor ? { armorPrereq: e.armor } : {}) } },
  };
}

/** The damage-stat a weapon adds follows the attack category: MD→Wiles, physical ranged→Finesse, else Power. */
function weaponTrait(e) {
  if (e.defense === 'md') return 'wiles';
  if (e.range != null) return 'finesse';
  return 'power';
}

/** A weapon table row (equipment.mjs WEAPONS) → a `gear` Item with the weapon facet. */
function weaponToItem(pack, e) {
  const id = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  const ranged = e.range != null;
  const descParts = [];
  if (e.prereq) descParts.push(`<p><em>Prerequisite: ${e.prereq}</em></p>`);
  if (e.note) descParts.push(`<p>${e.note}</p>`);
  return {
    _id, _key: `!items!${_id}`, name: e.name, type: 'gear', img: 'icons/svg/sword.svg',
    system: {
      description: descParts.join(''), quantity: 1, weight: 0, value: e.value ?? 0, equipped: false, traits: '',
      weaponType: e.type,
      weaponDamage: { count: e.denom ? String(e.count ?? 1) : '', denomination: e.denom ?? null, trait: e.denom ? weaponTrait(e) : '' },
      hands: e.hands ?? 1,
      defense: e.defense ?? '',
      damageType: e.damageType ?? '',
      range: { type: ranged ? 'ranged' : 'melee', value: ranged ? e.range : (e.reach ?? 5) },
    },
    effects: [],
    flags: { sacadia: { catalogId: id, kind: 'weapon' } },
  };
}

/** An armor table row (equipment.mjs ARMORS) → an `armor` Item with defenses + weight class + Max Stat. */
function armorToItem(pack, e) {
  const id = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  const defenses = { ad: 0, pd: 0, td: 0, md: 0, dr: 0, ...e.def };
  return {
    _id, _key: `!items!${_id}`, name: e.name, type: 'armor', img: 'icons/svg/shield.svg',
    system: {
      description: e.prereq ? `<p><em>Prerequisite: ${e.prereq}</em></p>` : '',
      equipped: false, category: e.category, defenses, maxStat: e.maxStat ?? null,
    },
    effects: [],
    flags: { sacadia: { catalogId: id, kind: 'armor' } },
  };
}

/** A shield row (equipment.mjs SHIELDS) → an `armor` Item: flat defenses (no Max Stat) + a Bash weapon facet. */
function shieldToItem(pack, e) {
  const id = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  const defenses = { ad: 0, pd: 0, td: 0, md: 0, dr: 0, ...e.def };
  const descParts = [`<p><em>Prerequisite: ${e.prereq}</em></p>`];
  if (e.note) descParts.push(`<p>${e.note}</p>`);
  return {
    _id, _key: `!items!${_id}`, name: e.name, type: 'armor', img: 'icons/svg/shield.svg',
    system: {
      description: descParts.join(''),
      equipped: false, category: '', defenses, maxStat: null,
      // Shield Bash: a Bludgeon attack vs PD (Power), reach 5ft.
      weaponType: 'shield',
      weaponDamage: { count: String(e.count ?? 1), denomination: e.denom, trait: 'power' },
      hands: 1, defense: 'pd', damageType: 'Bludgeon', range: { type: 'melee', value: 5 },
    },
    effects: [],
    flags: { sacadia: { catalogId: id, kind: 'shield' } },
  };
}

/** Write reviewable per-item source JSON, then compile a LevelDB compendium Foundry loads natively. */
async function writePack(pack, items) {
  const srcDir = path.join(SRC_PACKS, pack);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  for (const item of items) {
    fs.writeFileSync(path.join(srcDir, `${item.flags.sacadia.catalogId}.json`), JSON.stringify(item, null, 2));
  }
  // Compile the LevelDB. Open *first* (this acquires the DB lock and throws if Foundry has the world
  // loaded — a safe abort), then clear + rewrite. Never `rm` the dir before opening: that destroys
  // files a running Foundry still holds open and corrupts the pack ("recovered 0 files"). Rebuild
  // packs only with the world closed.
  const dbDir = path.join(OUT_PACKS, pack);
  const db = new ClassicLevel(dbDir, { keyEncoding: 'utf8', valueEncoding: 'json' });
  try {
    await db.open();
  } catch (err) {
    throw new Error(`Cannot open pack "${pack}" — is Foundry running with the world loaded? `
      + `Return to the Setup screen (or stop the server) before rebuilding packs.\n  ${err.message}`);
  }
  await db.clear();
  const batch = db.batch();
  for (const item of items) batch.put(item._key, item);
  await batch.write();
  await db.close();
}

/* -------------------------------------------- */

async function main() {
  const source = fs.readFileSync(SHEET, 'utf8');
  let grand = 0;
  let ranged = 0; // abilities that got an auto-detected range (coverage report)

  for (const [pack, cfg] of Object.entries(CATALOGS)) {
    const catalog = extractCatalog(source, cfg.constName);
    const items = Object.entries(catalog).map(([id, entry]) => toItem(pack, cfg, id, entry));
    await writePack(pack, items);
    grand += items.length;
    ranged += items.filter((i) => i.system.range?.value != null || i.system.range?.type).length;
    console.log(`  ${pack.padEnd(24)} ${String(items.length).padStart(3)} abilities`);
  }

  // Hand-transcribed content (not in the Roll20 catalogs): the two missing profession trees,
  // Masteries, Adornments, Trinkets.
  const prof = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'professions-extra.json'), 'utf8'));
  const fbCfg = { profession: 'fatebound', atkCategory: 'melee' };
  const hulCfg = { profession: 'hulinari_warrior', atkCategory: 'melee' };
  const extra = [
    ['abilities-fatebound', prof.fatebound.map((e) => extraToItem('abilities-fatebound', fbCfg, e)), 'abilities'],
    ['abilities-hulinari', prof.hulinari_warrior.map((e) => extraToItem('abilities-hulinari', hulCfg, e)), 'abilities'],
    ['abilities-masteries', MASTERIES.map(masteryToItem), 'masteries'],
    ['equipment-adornments', ADORNMENTS.map((e) => equipmentToItem('equipment-adornments', 'adornment', e)), 'adornments'],
    ['equipment-trinkets', TRINKETS.map((e) => equipmentToItem('equipment-trinkets', 'trinket', e)), 'trinkets'],
    ['equipment-weapons', WEAPONS.map((e) => weaponToItem('equipment-weapons', e)), 'weapons'],
    ['equipment-armor', ARMORS.map((e) => armorToItem('equipment-armor', e)), 'armor'],
    ['equipment-shields', SHIELDS.map((e) => shieldToItem('equipment-shields', e)), 'shields'],
  ];
  for (const [pack, items, noun] of extra) {
    await writePack(pack, items);
    grand += items.length;
    console.log(`  ${pack.padEnd(24)} ${String(items.length).padStart(3)} ${noun}`);
  }

  console.log(`\nBuilt ${Object.keys(CATALOGS).length + extra.length} packs, ${grand} items total.`);
  console.log(`  (range auto-detected on ${ranged} catalog abilities)`);
}

// Run the build only when invoked directly (`node src/build-packs.mjs`), so tools can import the
// detectors/parser below without triggering a LevelDB write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { extractCatalog, buildActivities, detectSaveTrait, detectInflict, detectRange, detectPoolCost, CATALOGS, ACTIONABLE_TAGS, TAG_MAP };
