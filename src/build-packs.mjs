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
 *  - Per-ability damage buffs (die-steps / flat boosts that one ability grants another) are authored
 *    as unified `system.modifiers` in src/modifiers.mjs (MODIFIER_OVERRIDES), keyed by catalogId.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ClassicLevel } from 'classic-level';
import { MASTERIES } from './masteries.mjs';
import { BASICS } from './basics.mjs';
import { PROGRESSION } from './progression.mjs';
import { buildManual } from './manual.mjs';
import { ADORNMENTS, WEAPONS, ARMORS, SHIELDS } from './equipment.mjs';
import { SHIPPED_DIR, hasIcons, iconGroup, iconPattern, systemPath } from './icons.mjs';
import { inferMaterial, inferShieldSize } from '../module/helpers/actor-utils.mjs';
import { MODIFIER_OVERRIDES, CHOICE_OVERRIDES, MARK_OVERRIDES, FOCUS_OVERRIDES, INFLICT_OVERRIDES, GRANT_OVERRIDES, BOOST_OVERRIDES, ACTIVITY_OVERRIDES, TEMPHP_OVERRIDES, REACTION_GRANT_OVERRIDES, NEXT_ATTACK_OVERRIDES, ONUSE_OVERRIDES, KILLTRIGGER_OVERRIDES, MULTIATTACK_OVERRIDES, SELFSCALING_OVERRIDES, CHOICEREDIRECT_OVERRIDES, PICK_OVERRIDES, PICK2_OVERRIDES, ZONE_OVERRIDES, TEXT_OVERRIDES, TAG_OVERRIDES, EXTRAAP_OVERRIDES, POOL_OVERRIDES, AMOUNTPROMPT_OVERRIDES, LORE_MADNESS, USAGE_OVERRIDES, USAGE_UPGRADES, AID_RESIST_OVERRIDES, OPPORTUNITY_IDS } from './modifiers.mjs';
import { MADNESS_ANNOTATIONS } from './madness.mjs';
import { LORE_NO_COST } from './lore-overrides.mjs';
import { buildIdentity } from './build-identity.mjs';
import { buildGoods } from './build-goods.mjs';

// Pool-granting abilities (one per pool): they set the pool's max, never charge it. Their pool cost is
// blanked at build so the detector's "consumes a point" flavour doesn't mis-charge them.
const POOL_GRANT_IDS = new Set([
  'bd_arrangement', 'tighten_focus', 'future_visions', 'trickshot',
  'steeltip', 'get_down', 'call_to_action', 'thug_wrestling_trick',
  'trickster_tactics', 'mg_spell_slots', 'wt_divine_touch_slots',
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

// Generated icons (src/generate-icons.mjs; locations in src/icons.mjs): when one exists for an item, its img points
// at it; otherwise the item keeps its svg default. The 256 px WebP is preferred over any older format. Folder
// listings are cached per icon group.
const _iconDirCache = new Map();
function iconFor(pack, catalogId) {
  if (!hasIcons(pack)) return null;
  const group = iconGroup(pack);
  if (!_iconDirCache.has(group)) {
    const dir = path.join(SHIPPED_DIR, group);
    _iconDirCache.set(group, fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  }
  const matches = _iconDirCache.get(group).filter((f) => iconPattern(catalogId).test(f));
  const file = matches.find((f) => f.endsWith('.webp')) ?? matches[0];
  return file ? systemPath(group, file) : null;
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

// Catalog text defects: Roll20 sheet notes ("[Adds a Temporary Modifier below …]") and the next section's
// heading bled onto the end of an entry ("… Aoean", "… Heavy Hitter", "… Fated").
const TRAILING_HEADING = /\s+(?:Aoean|Heavy Hitter|Fated)\s*$/;
const cleanDescription = (s) => deref(s).replace(/\s*\[Adds a [^\]]*\]\s*$/, '').replace(/\s*\((?:Add|Toggle|Set|Auto-managed) [^)]*(?:manually|tempbuff)[^)]*\)\s*$/i, '')
  .replace(TRAILING_HEADING, '').trim();

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
const POOL_NAMES = { arrangement: 'arrangement', glory: 'glory', prescient: 'prescient', trickshot: 'trickshot', savage: 'savage', herd: 'herd', call: 'call', trick: 'trick', trickster: 'trickster', spell: 'spell', divine: 'divine' };
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * Detect a pool cost: "expend [N|a|one|two|X|any number of] <Pool> point(s)". Returns `{ key, amount,
 * variable, max }`. A player-chosen quantity ("X", "any number of", "up to …") is `variable: true`
 * (prompted on use); `max` captures an "up to <@ref>" bound (e.g. "up to your Proficiency" → `@proficiency`).
 * Case-insensitive (prose often opens a sentence with "Expend").
 */
function detectPoolCost(desc) {
  // "expend" — and the Hulinari catalog's "expense" ("Expense one Savage Point").
  // "<Pool> Point(s)", plus the prestige pools' "Spell Slot(s)" (Magus) and "Divine Touch Point(s)" (Witch).
  const m = /\bexpen[ds][a-z]*\s+(\d+|a number of|any number of|any|an|a|one|two|three|four|five|six|your|x)\s+(?:additional\s+|more\s+)?([a-z]+)(?:\s+touch)?\s+(?:points?|slots?)\b/i.exec(desc);
  const key = m && POOL_NAMES[m[2].toLowerCase()];
  if (!key) return { key: '', amount: 0, variable: false, max: '' };
  const q = m[1].toLowerCase();
  // "one Savage Point for each creature" / "one Herd Point per target" — a per-target price, chosen at use.
  const perEach = /^\s*(?:for each|per)\b/i.test(desc.slice(m.index + m[0].length, m.index + m[0].length + 12));
  const variable = perEach || q === 'x' || q === 'any' || q === 'any number of' || q === 'a number of';
  // "up to (half )?your <Stat>" bound following the phrase → an @ref for the prompt ceiling.
  // "up to (half) your X" or "(to a maximum of half your X …)" (Beak & Blade, Cloudsurge).
  // "(X maxes at half your Proficiency, rounded up)" (Siphon Soul).
  const upTo = /(?:up to|to a maximum of|maxes at)\s+(half\s+)?your\s+(\w+)/i.exec(desc.slice(m.index, m.index + 130));
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
      // "…taking half damage on success" → a successful save halves the damage instead of negating it.
      const onSuccess = /half (?:the )?damage|takes? half|half as much/i.test(desc) ? 'half' : 'none';
      return [{ type: 'save', label: '', attack: blankAtk, save: { trait: saveTrait, dc: null, onSuccess }, damage, inflict }];
    }
  }

  if (damage.length) return [{ type: 'damage', label: '', attack: blankAtk, save: blankSave, damage, inflict }];
  return [];
}

/**
 * The override-derived `system` fields keyed by catalogId, shared by both the main `toItem` and the
 * `extraToItem` used for the Fatebound/Hulinari catalogs — so authored modifiers/mechanics apply to
 * *every* profession, not just the six in `CATALOGS`. (INFLICT + ACTIVITY overrides mutate `activities`
 * and are applied by the callers.)
 */
/** "Once per turn / quick rest / combat" (and "twice per turn") → a usage limit. */
function detectUsage(description) {
  const d = description ?? '';
  if (/twice per turn/i.test(d)) return { per: 'turn', max: 2 };
  if (/once per turn/i.test(d)) return { per: 'turn', max: 1 };
  if (/once per (?:quick |fitful |nightly |long )?rest/i.test(d)) return { per: 'rest', max: 1 };
  if (/once per (?:combat|encounter|fight)/i.test(d)) return { per: 'combat', max: 1 };
  return null;
}

/** The owned-passive upgrades that target this ability's usage (USAGE_UPGRADES, keyed by the upgrader). */
function usageUpgradesFor(catalogId) {
  return Object.entries(USAGE_UPGRADES).filter(([, u]) => u?.ability === catalogId)
    .map(([ability, u]) => ({ ability, max: u.max ?? null, maxFormula: u.maxFormula ?? '', requires: u.requires ?? [], requiresLabel: u.requiresLabel ?? '' }));
}

function overrideFields(catalogId, tag, description) {
  const reactionTrigger = tag === 'reaction' && /\bmov(e|es|ing|ement)\b/i.test(description) && !/turn end/i.test(description) ? 'move' : '';
  return {
    modifiers: MODIFIER_OVERRIDES[catalogId] ?? [],
    ...(CHOICE_OVERRIDES[catalogId] ? { choice: CHOICE_OVERRIDES[catalogId] } : {}),
    ...(MARK_OVERRIDES[catalogId] ? { mark: MARK_OVERRIDES[catalogId] } : {}),
    ...(FOCUS_OVERRIDES[catalogId] ? { focus: FOCUS_OVERRIDES[catalogId] } : {}),
    ...(GRANT_OVERRIDES[catalogId] ? { grant: GRANT_OVERRIDES[catalogId] } : {}),
    ...(TEMPHP_OVERRIDES[catalogId] ? { tempHp: TEMPHP_OVERRIDES[catalogId] } : {}),
    ...(REACTION_GRANT_OVERRIDES[catalogId] ? { grantsReaction: REACTION_GRANT_OVERRIDES[catalogId] } : {}),
    ...(reactionTrigger ? { reactionTrigger } : {}),
    ...(NEXT_ATTACK_OVERRIDES[catalogId] ? { nextAttack: { on: '', advantage: '', toHit: '', damage: '', targetCondition: '', label: '', ...NEXT_ATTACK_OVERRIDES[catalogId] } } : {}),
    ...(ONUSE_OVERRIDES[catalogId] ? { onUse: ONUSE_OVERRIDES[catalogId] } : {}),
    ...(KILLTRIGGER_OVERRIDES[catalogId] ? { killTrigger: KILLTRIGGER_OVERRIDES[catalogId] } : {}),
    ...(MULTIATTACK_OVERRIDES[catalogId] ? { multiAttack: MULTIATTACK_OVERRIDES[catalogId] } : {}),
    ...(CHOICEREDIRECT_OVERRIDES[catalogId] ? { choiceRedirect: CHOICEREDIRECT_OVERRIDES[catalogId] } : {}),
    ...(PICK_OVERRIDES[catalogId] ? { pick: { options: [], ...PICK_OVERRIDES[catalogId] } } : {}),
    ...(PICK2_OVERRIDES[catalogId] ? { pick2: { options: [], ...PICK2_OVERRIDES[catalogId] } } : {}),
    ...(ZONE_OVERRIDES[catalogId] ? { zone: ZONE_OVERRIDES[catalogId] } : {}),
    ...(EXTRAAP_OVERRIDES[catalogId] ? { extraAp: { max: '', label: '', selfDamagePerAp: '', ...EXTRAAP_OVERRIDES[catalogId] } } : {}),
    ...(AMOUNTPROMPT_OVERRIDES[catalogId] ? { amountPrompt: { label: '', max: '', ...AMOUNTPROMPT_OVERRIDES[catalogId] } } : {}),
    ...(TEXT_OVERRIDES[catalogId] ? { description: `<p>${TEXT_OVERRIDES[catalogId]}</p>` } : {}),
    ...(AID_RESIST_OVERRIDES[catalogId] ? { aidResist: { levels: '1', maxTargets: '1', autoWith: '', autoIfSteadied: false, advantageWith: '',
      spendMadness: false, mentalOnly: false, funnel: false, ...AID_RESIST_OVERRIDES[catalogId] } } : {}),
    ...((detectUsage(description) || USAGE_OVERRIDES[catalogId] || usageUpgradesFor(catalogId).length) ? { usage: { per: '', max: 1, requires: [], requiresLabel: '',
      ...(detectUsage(description) ?? {}), ...(USAGE_OVERRIDES[catalogId] ?? {}), upgrades: usageUpgradesFor(catalogId) } } : {}),
    ...(BOOST_OVERRIDES[catalogId] ? { boost: BOOST_OVERRIDES[catalogId] } : {}),
    ...(MADNESS_ANNOTATIONS[catalogId] ? { madness: MADNESS_ANNOTATIONS[catalogId] } : {}),
  };
}

/** Transform one Roll20 catalog entry into a Sacadia `ability` Item document. */
function toItem(pack, cfg, catalogId, entry) {
  const _id = makeId(pack, catalogId);
  const tag = TAG_OVERRIDES[catalogId] ?? TAG_MAP[String(entry.tag ?? '').toLowerCase()] ?? 'action';
  const limbs = entry.limb != null && LIMB_MAP[entry.limb] ? [LIMB_MAP[entry.limb]] : [];
  const madness = Number(entry.madness);
  // Authored activities (ACTIVITY_OVERRIDES) replace the prose-detected set when the detector can't
  // build it correctly (unnamed target defense, inflict-instead-of-damage, a missed save-inflict).
  const activities = ACTIVITY_OVERRIDES[catalogId] ?? buildActivities(entry, cfg, tag);
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
      description: entry.description ? `<p>${cleanDescription(entry.description)}</p>` : '',
      tag,
      costs: {
        ap: ACTIVE_TAGS.has(tag) ? 1 : 0,
        csp: Number(entry.cspCost) || 0,
        madness: Number.isFinite(madness) ? madness : 0,
        limbs,
        // A pool-granting ability *creates* the pool; it never spends it — so blank the cost the
        // detector reads from its "using a call consumes a point" flavour (see POOL_GRANT_IDS).
        pool: POOL_OVERRIDES[catalogId] ?? (POOL_GRANT_IDS.has(catalogId)
          ? { key: '', amount: 0, variable: false, max: '' }
          : detectPoolCost(entry.description ?? '')),
      },
      range: detectRange(entry.description ?? ''),
      meta: {
        profession: cfg.profession,
        subpath: entry.subpath ?? '',
        prerequisite: entry.prerequisite ?? '',
      },
      activities,
      // Unified conditional modifiers + all authored mechanic overrides, keyed by catalogId (shared with
      // extraToItem so every profession gets them). `selfScaling` stays a flag — a different mechanism.
      ...overrideFields(catalogId, tag, entry.description ?? ''),
    },
    effects: [],
    flags: {
      sacadia: {
        catalogId,
        ...(OPPORTUNITY_IDS.includes(catalogId) ? { opportunity: true } : {}),
        ...((entry.damage?.selfScaling || SELFSCALING_OVERRIDES[catalogId]) ? { selfScaling: entry.damage?.selfScaling ?? SELFSCALING_OVERRIDES[catalogId] } : {}),
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
      modifiers: MODIFIER_OVERRIDES[m.id] ?? [],
      // A permanent choice (Sling Mastery's condition).
      ...(PICK_OVERRIDES[m.id] ? { pick: { options: [], ...PICK_OVERRIDES[m.id] } } : {}),
    },
    effects: [],
    flags: { sacadia: { catalogId: m.id, mastery: true } },
  };
}

/** A profession level feature or Legendary Mastery (src/progression.mjs) → an `ability` Item, run through the
 *  same override pipeline as the catalog abilities (modifiers, boosts, activities …). */
function featureToItem(f) {
  const _id = makeId('profession-features', f.id);
  const activities = ACTIVITY_OVERRIDES[f.id] ?? [];
  return {
    _id,
    _key: `!items!${_id}`,
    name: f.name,
    type: 'ability',
    img: iconFor('profession-features', f.id) ?? (f.legendary ? 'icons/svg/upgrade.svg' : 'icons/svg/book.svg'),
    system: {
      description: `<p>${f.description}</p>`,
      tag: f.tag,
      costs: { ap: ACTIVE_TAGS.has(f.tag) ? 1 : 0, csp: 0, madness: 0, limbs: [],
        pool: { key: '', amount: 0, variable: false, max: '' } },
      range: detectRange(f.description),
      // Prestige features gate on the profession's own level ("according to your Magus level").
      meta: { profession: f.profession, subpath: f.legendary ? 'Legendary Mastery' : 'Level Feature',
        prerequisite: f.prestige ? `${f.profession[0].toUpperCase()}${f.profession.slice(1)} Level ${f.level}` : `Level ${f.level}` },
      activities,
      ...overrideFields(f.id, f.tag, f.description),
    },
    effects: [],
    flags: { sacadia: { catalogId: f.id, feature: true, level: f.level, ...(f.legendary ? { legendary: true } : {}) } },
  };
}

/** Human labels for the prestige sub-sections (Magus Tomes, Witch branches). */
const PRESTIGE_SECTIONS = {
  core: '', tome: 'Tome', any: 'Any Tome', blood: 'Blood Tome', contract: 'Contract Tome', elder: 'Elder Tome',
  general: '', promise: 'Promise', wellspring: 'Wellspring', balancer: 'Balancer', conditionmaker: 'Conditionmaker', calming_hands: 'Calming Hands',
};

/**
 * A prestige profession ability (src/prestige.json — transcribed from the Prestige Classes addendum) → an `ability`
 * Item. Rolls come only from authored overrides (no prose detection: the addendum's wording is too varied); the
 * research requirement rides the prerequisite text and `flags.sacadia.research`, the Magus Tome in `flags.sacadia.tome`.
 */
function prestigeToItem(pack, profession, e) {
  const _id = makeId(pack, e.id);
  const prereq = [e.prerequisite, e.research ? `Research: ${e.research}` : ''].filter(Boolean).join(' · ');
  return {
    _id,
    _key: `!items!${_id}`,
    name: e.name,
    type: 'ability',
    img: iconFor(pack, e.id) ?? DEFAULT_IMG,
    system: {
      description: `<p>${e.description}</p>${e.note ? `<p><em>${e.note}</em></p>` : ''}`,
      tag: e.tag,
      costs: { ap: ACTIVE_TAGS.has(e.tag) ? 1 : 0, csp: e.cspCost || 0, madness: 0, limbs: [],
        pool: POOL_OVERRIDES[e.id] ?? (POOL_GRANT_IDS.has(e.id) ? { key: '', amount: 0, variable: false, max: '' } : detectPoolCost(e.description || '')) },
      range: detectRange(e.description || ''),
      meta: { profession, subpath: PRESTIGE_SECTIONS[e.section] ?? '', prerequisite: prereq },
      activities: ACTIVITY_OVERRIDES[e.id] ?? [],
      ...overrideFields(e.id, e.tag, e.description || ''),
    },
    effects: [],
    flags: { sacadia: { catalogId: e.id, transcribed: true, prestige: profession,
      ...(profession === 'magus' && e.section !== 'core' ? { tome: e.section } : {}),
      ...(e.research ? { research: e.research } : {}),
      ...(OPPORTUNITY_IDS.includes(e.id) ? { opportunity: true } : {}),
      ...(SELFSCALING_OVERRIDES[e.id] ? { selfScaling: SELFSCALING_OVERRIDES[e.id] } : {}) } },
  };
}

/** Human labels for the Lore sections (who may take them, book pp.168–177; ancestry uses from the culture chapters). */
const LORE_SECTIONS = {
  general: 'General', ancestry: 'Ancestry', human: 'Human', daemonai: 'Daemonai', curiot: 'Curiot', fixerfolk: 'Fixerfolk',
  fontborne: 'Fontborne', hulinari: 'Hulinari Heritage', bladedancer: 'Bladedancer', fatebound: 'Fatebound', oracle: 'Oracle',
  hulinari_warrior: 'Hulinari Warrior', soldier: 'Soldier', sentinel: 'Sentinel', thug: 'Thug',
};

/**
 * A Lore ability (src/lore.json, transcribed from v1.2) → an `ability` Item. Each costs one Lore point (`costs.lore`)
 * unless its point is charged elsewhere (a Lore Boost on consume, Oozing Flow's post-roll button) or it costs none.
 * Abilities marked L cost no AP (tag `lore`); those marked A / F (Kickbuck, Summon Beasts) are actions / Focus too.
 */
function loreToItem(e) {
  const _id = makeId('abilities-lore', e.id);
  const prereq = [e.prerequisite, `p.${e.page}`].filter(Boolean).join(' · ');
  return {
    _id,
    _key: `!items!${_id}`,
    name: e.name,
    type: 'ability',
    img: iconFor('abilities-lore', e.id) ?? 'icons/svg/book.svg',
    system: {
      description: `<p>${e.description}</p>`,
      tag: e.tag,
      costs: { ap: ACTIVE_TAGS.has(e.tag) ? 1 : 0, csp: 0, madness: 0, lore: LORE_NO_COST.has(e.id) ? 0 : 1, limbs: [],
        pool: { key: '', amount: 0, variable: false, max: '' } },
      range: detectRange(e.description),
      meta: { profession: '', subpath: LORE_SECTIONS[e.section] ?? '', prerequisite: prereq },
      activities: ACTIVITY_OVERRIDES[e.id] ?? [],
      ...overrideFields(e.id, e.tag, e.description),
      ...(LORE_MADNESS[e.id] ? { madness: LORE_MADNESS[e.id] } : {}),
    },
    effects: [],
    flags: { sacadia: { catalogId: e.id, transcribed: true, lore: true } },
  };
}

/** A basic action/reaction (src/basics.mjs, book pp.237–240) → an `ability` Item. Auto-granted to every
 *  character (flags.sacadia.basic) — see reconcileBasicGrants in sacadia.mjs. */
function basicToItem(b) {
  const _id = makeId('basic-actions', b.id);
  return {
    _id,
    _key: `!items!${_id}`,
    name: b.name,
    type: 'ability',
    img: iconFor('basic-actions', b.id) ?? (b.tag === 'reaction' ? 'icons/svg/shield.svg' : 'icons/svg/combat.svg'),
    system: {
      description: `<p>${b.description}</p>`,
      tag: b.tag,
      costs: { ap: b.ap ?? 0, csp: 0, madness: 0, limbs: b.limbs ?? [] },
      meta: { profession: '', subpath: 'basic', prerequisite: '' },
      activities: b.activities ?? [],
      modifiers: MODIFIER_OVERRIDES[b.id] ?? [],
      ...(b.grant ? { grant: b.grant } : {}),
      // Rend Armor: "rend 1 armor (PD, MD, or TD — your choice)".
      ...(CHOICE_OVERRIDES[b.id] ? { choice: CHOICE_OVERRIDES[b.id] } : {}),
    },
    effects: [],
    flags: { sacadia: { catalogId: b.id, basic: true, ...(b.flags ?? {}) } },
  };
}

/** A hand-transcribed profession entry (professions-extra.json) → an `ability` Item. Limbs are
 *  absent (PDF drops the icons) — flagged `transcribed` and addable via the sheet's limb picker. */
function extraToItem(pack, cfg, entry) {
  const id = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const _id = makeId(pack, id);
  const tag = entry.tag;
  // Same override pipeline as toItem, so Fatebound/Hulinari authoring (modifiers, activities, inflicts,
  // temp-HP / kill-trigger / multi-attack / on-use / pool-grant) actually reaches the compendium.
  const activities = ACTIVITY_OVERRIDES[id] ?? buildActivities(entry, cfg, tag);
  if (INFLICT_OVERRIDES[id] && activities.length) activities[0].inflict = INFLICT_OVERRIDES[id];
  return {
    _id,
    _key: `!items!${_id}`,
    name: entry.name,
    type: 'ability',
    img: iconFor(pack, id) ?? DEFAULT_IMG,
    system: {
      description: entry.description ? `<p>${cleanDescription(entry.description)}</p>` : '',
      tag,
      costs: { ap: ACTIVE_TAGS.has(tag) ? 1 : 0, csp: entry.cspCost || 0, madness: 0, limbs: [],
        pool: POOL_OVERRIDES[id] ?? (POOL_GRANT_IDS.has(id) ? { key: '', amount: 0, variable: false, max: '' } : detectPoolCost(entry.description || '')) },
      range: detectRange(entry.description || ''),
      meta: { profession: cfg.profession, subpath: '', prerequisite: entry.prerequisite || '' },
      activities,
      ...overrideFields(id, tag, entry.description || ''),
    },
    effects: [],
    flags: { sacadia: { catalogId: id, transcribed: true,
      ...(OPPORTUNITY_IDS.includes(id) ? { opportunity: true } : {}),
      ...(SELFSCALING_OVERRIDES[id] ? { selfScaling: SELFSCALING_OVERRIDES[id] } : {}) } },
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
    flags: { sacadia: { catalogId: id, kind, ...(e.armor ? { armorPrereq: e.armor } : {}), ...(kind === 'adornment' ? { bargain: 'adornments' } : {}) } },
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
      // Versatile weapons (the throwable ones) carry the trait, read as `self:attack:trait:versatile`.
      // Heavy weapons carry the `heavy` trait, read as `self:wielding:heavy` (Heavy Weapons Mastery).
      description: descParts.join(''), quantity: 1, weight: 0, value: e.value ?? 0, equipped: false,
      traits: [e.throw ? 'versatile' : '', /heavy/i.test(e.prereq ?? '') ? 'heavy' : ''].filter(Boolean).join(', '),
      // Item slots (book p.187): basic weapons 1, military 2, heavy 3.
      slots: /heavy/i.test(e.prereq ?? '') ? 3 : /military/i.test(e.prereq ?? '') ? 2 : 1, storage: 'ris', providesSis: 0,
      weaponType: e.type,
      weaponDamage: { count: e.denom ? String(e.count ?? 1) : '', denomination: e.denom ?? null, trait: e.denom ? weaponTrait(e) : '' },
      hands: e.hands ?? 1,
      defense: e.defense ?? '',
      damageType: e.damageType ?? '',
      range: { type: ranged ? 'ranged' : 'melee', value: ranged ? e.range : (e.reach ?? 5) },
    },
    effects: [],
    // Shop for Bargains (p.266) rolls the Basic, Military and Imbued tables; the cultural examples aren't on one.
    flags: { sacadia: { catalogId: id, kind: 'weapon', ...(e.cultural ? {} : { bargain: !e.prereq ? 'basic-weapons' : /Training/.test(e.prereq) ? 'military-weapons' : 'imbued-weapons' }) } },
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
      equipped: false, category: e.category, material: inferMaterial(e.name), defenses, maxStat: e.maxStat ?? null, slots: 1, storage: 'ris', providesSis: 0,
      value: e.value ?? 0,
    },
    effects: [],
    flags: { sacadia: { catalogId: id, kind: 'armor', bargain: 'armor' } },
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
      equipped: false, category: '', material: inferMaterial(e.name), shieldSize: inferShieldSize(e.name), defenses, maxStat: null, value: e.value ?? 0,
      // Item slots (book p.195): bucklers 1, shields 2, tower shields 3.
      slots: { buckler: 1, shield: 2, tower: 3 }[inferShieldSize(e.name)], storage: 'ris', providesSis: 0,
      // Shield Bash: a Bludgeon attack vs PD (Power), reach 5ft.
      weaponType: 'shield',
      weaponDamage: { count: String(e.count ?? 1), denomination: e.denom, trait: 'power' },
      hands: 1, defense: 'pd', damageType: 'Bludgeon', range: { type: 'melee', value: 5 },
    },
    effects: [],
    flags: { sacadia: { catalogId: id, kind: 'shield', bargain: 'shields' } },
  };
}

/** Write reviewable per-item source JSON, then compile a LevelDB compendium Foundry loads natively. */
/**
 * Write a JournalEntry pack: each entry at `!journal!<id>` (its `pages` as ids) and each page at
 * `!journal.pages!<entryId>.<pageId>` — Foundry's LevelDB layout for embedded pages.
 */
async function writeJournalPack(pack, entry, pages) {
  const srcDir = path.join(SRC_PACKS, pack);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'manual.json'), JSON.stringify({ ...entry, pages }, null, 2));
  const db = new ClassicLevel(path.join(OUT_PACKS, pack), { keyEncoding: 'utf8', valueEncoding: 'json' });
  try {
    await db.open();
  } catch (err) {
    throw new Error(`Cannot open pack "${pack}" — is Foundry running with the world loaded?\n  ${err.message}`);
  }
  await db.clear();
  const batch = db.batch();
  batch.put(entry._key, entry);
  for (const p of pages) batch.put(p._key, p);
  await batch.write();
  await db.close();
}

/**
 * Stamp an item with a hash of its content (`flags.sacadia.buildHash`): an owned copy whose hash differs from the
 * compendium's is out of date, and the system offers to refresh it (module/helpers/refresh.mjs).
 */
function stampBuildHash(item) {
  const content = JSON.stringify({ name: item.name, img: item.img, system: item.system,
    flags: Object.fromEntries(Object.entries(item.flags?.sacadia ?? {}).filter(([k]) => k !== 'buildHash')) });
  item.flags.sacadia.buildHash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
}

async function writePack(pack, items, folders = []) {
  for (const item of items) stampBuildHash(item);
  const srcDir = path.join(SRC_PACKS, pack);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  for (const item of items) {
    fs.writeFileSync(path.join(srcDir, `${item.flags.sacadia.catalogId}.json`), JSON.stringify(item, null, 2));
  }
  if (folders.length) fs.writeFileSync(path.join(srcDir, '_folders.json'), JSON.stringify(folders, null, 2));
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
  for (const f of folders) batch.put(f._key, f);
  for (const item of items) batch.put(item._key, item);
  await batch.write();
  await db.close();
}

/** Write a JournalEntry pack of several entries (see writeJournalPack): one source file per entry, with its pages. */
async function writeJournalEntries(pack, entries, pages) {
  const srcDir = path.join(SRC_PACKS, pack);
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.mkdirSync(srcDir, { recursive: true });
  for (const entry of entries) {
    const own = pages.filter((p) => entry.pages.includes(p._id));
    fs.writeFileSync(path.join(srcDir, `${entry.flags?.sacadia?.culture ?? 'intro'}.json`), JSON.stringify({ ...entry, pages: own }, null, 2));
  }
  const db = new ClassicLevel(path.join(OUT_PACKS, pack), { keyEncoding: 'utf8', valueEncoding: 'json' });
  try {
    await db.open();
  } catch (err) {
    throw new Error(`Cannot open pack "${pack}" — is Foundry running with the world loaded?\n  ${err.message}`);
  }
  await db.clear();
  const batch = db.batch();
  for (const e of entries) batch.put(e._key, e);
  for (const p of pages) batch.put(p._key, p);
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
  const prestige = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'prestige.json'), 'utf8'));
  const fbCfg = { profession: 'fatebound', atkCategory: 'melee' };
  const hulCfg = { profession: 'hulinari_warrior', atkCategory: 'melee' };
  const extra = [
    ['abilities-fatebound', prof.fatebound.map((e) => extraToItem('abilities-fatebound', fbCfg, e)), 'abilities'],
    ['abilities-hulinari', prof.hulinari_warrior.map((e) => extraToItem('abilities-hulinari', hulCfg, e)), 'abilities'],
    ['abilities-masteries', MASTERIES.map(masteryToItem), 'masteries'],
    ['basic-actions', BASICS.map(basicToItem), 'basic actions'],
    ['profession-features', PROGRESSION.map(featureToItem), 'profession features'],
    ['abilities-magus', prestige.magus.map((e) => prestigeToItem('abilities-magus', 'magus', e)), 'abilities'],
    ['abilities-witch', prestige.witch.map((e) => prestigeToItem('abilities-witch', 'witch', e)), 'abilities'],
    ['abilities-lore', JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lore.json'), 'utf8')).map(loreToItem), 'lore abilities'],
    ['equipment-adornments', ADORNMENTS.map((e) => equipmentToItem('equipment-adornments', 'adornment', e)), 'adornments'],
    ['equipment-weapons', WEAPONS.map((e) => weaponToItem('equipment-weapons', e)), 'weapons'],
    ['equipment-armor', ARMORS.map((e) => armorToItem('equipment-armor', e)), 'armor'],
    ['equipment-shields', SHIELDS.map((e) => shieldToItem('equipment-shields', e)), 'shields'],
  ];
  for (const [pack, items, noun] of extra) {
    await writePack(pack, items);
    grand += items.length;
    console.log(`  ${pack.padEnd(24)} ${String(items.length).padStart(3)} ${noun}`);
  }

  // Heritages & Ancestries, Cultures, and the Cultures of the Ardus Yauga journal (src/identity/).
  const identity = buildIdentity({ makeId, buildActivities, overrideFields, detectRange, ACTIVE_TAGS, ACTIVITY_OVERRIDES,
    weaponToItem, armorToItem, WEAPONS, ARMORS, lore: JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lore.json'), 'utf8')) });
  for (const [pack, { items, folders }] of [['heritages', identity.heritages], ['cultures', identity.cultures]]) {
    await writePack(pack, items, folders);
    grand += items.length;
    console.log(`  ${pack.padEnd(24)} ${String(items.length).padStart(3)} heritage, ancestry and culture items`);
  }
  await writeJournalEntries('cultures-journal', identity.journal.entries, identity.journal.pages);
  console.log(`  ${'cultures-journal'.padEnd(24)} ${String(identity.journal.pages.length).padStart(3)} pages`);

  // Personal Goods, Trinkets and Home Goods (src/goods.mjs), a compendium folder per table.
  for (const [pack, { items, folders }] of Object.entries(buildGoods({ makeId }))) {
    await writePack(pack, items, folders);
    grand += items.length;
    console.log(`  ${pack.padEnd(24)} ${String(items.length).padStart(3)} goods`);
  }

  // The User Manual (src/manual/*.md → one JournalEntry).
  const manual = buildManual(path.join(ROOT, 'src', 'manual'), (k) => makeId('user-manual', k));
  await writeJournalPack('user-manual', manual.entry, manual.pages);
  console.log(`  ${'user-manual'.padEnd(24)} ${String(manual.pages.length).padStart(3)} manual pages`);

  console.log(`\nBuilt ${Object.keys(CATALOGS).length + extra.length + 7} packs, ${grand} items total.`);
  console.log(`  (range auto-detected on ${ranged} catalog abilities)`);
}

// Run the build only when invoked directly (`node src/build-packs.mjs`), so tools can import the
// detectors/parser below without triggering a LevelDB write.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { extractCatalog, buildActivities, detectSaveTrait, detectInflict, detectRange, detectPoolCost, CATALOGS, ACTIONABLE_TAGS, TAG_MAP };
