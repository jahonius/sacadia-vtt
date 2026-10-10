/**
 * The Breach — a level-5 combat one-shot by Connor Brashar, converted to Sacadia's Art of War v1.2.
 *
 * Four pregenerated Tianqi wall guards defend Chuni's Wall against Wanabbul the Vast (or one of three optional
 * demons). The 2024 one-shot used a simplified pre-1.0 ruleset; here the pregens are rebuilt as rules-legal level-5
 * characters from the system's compendiums (34 CSP, trait points capped at 2), the demons keep their stat blocks
 * (monsters aren't built from player rules) with v1.2 terms, and the map's siege engines and pit trap are actors and
 * Regions the system automates. What changed and why is in the GM guide's "Conversion Notes" page
 * (journal/gm/90-conversion-notes.md).
 *
 * Built by src/build-adventures.mjs into the `adventures` compendium.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUND_WALLS, TOP_WALLS, LEVEL_CHANGES, KINDS, WALL, LIGHTS, LIGHT_KINDS, CLEAR_OF_FOG, FOG_LINE } from './battlefield.mjs';
import { WORLD, GRID as WORLD_GRID, WALL_FORT, ROAD, SMOKE, JOURNEY, ROAD_STYLE, SMOKE_STYLE } from './prologue.mjs';
import { FACTIONS, PEOPLE, QUEST } from './nexus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * The battle map: the author's original, resampled to 100 px a 5ft square by tools/breach-assets.mjs. Tokens, Regions and
 * pins are placed in squares counted from its top-left corner.
 */
const MAP = { file: 'map.webp', thumb: 'map-thumb.webp', grid: 100, cols: 20, rows: 48 };
const GRID = MAP.grid;
const sq = (c) => c * GRID;

const DISPOSITION = { hostile: -1, neutral: 0, friendly: 1 };
const DISPLAY = { none: 0, hover: 30, owner: 40, always: 50 };
const OWNER = 3, OBSERVER = 2, NONE = 0;

export default function build(kit) {
  const { id, asset } = kit;

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Folders                                                                                                    */
  /* ---------------------------------------------------------------------------------------------------------- */

  const folder = (key, name, type, parent = null, sort = 0, color = null) =>
    ({ _id: id('folder', key), name, type, folder: parent, sorting: 'm', sort, color, flags: {} });
  const F = {
    actors: folder('actors', 'The Breach', 'Actor', null, 0, '#2f4f8f'),
    items: folder('items', 'The Breach', 'Item', null, 0, '#2f4f8f'),
    journal: folder('journal', 'The Breach', 'JournalEntry', null, 0, '#2f4f8f'),
    scenes: folder('scenes', 'The Breach', 'Scene', null, 0, '#2f4f8f'),
    tables: folder('tables', 'The Breach', 'RollTable', null, 0, '#2f4f8f'),
  };
  F.heroes = folder('heroes', 'Defenders of the Wall', 'Actor', F.actors._id, 100);
  F.demons = folder('demons', 'Demons', 'Actor', F.actors._id, 200, '#8c1d18');
  F.optional = folder('optional', 'Optional Demons', 'Actor', F.demons._id, 100, '#8c1d18');
  F.props = folder('props', 'Siege Engines & Hazards', 'Actor', F.actors._id, 300);
  F.supplies = folder('supplies', 'Supplies', 'Item', F.items._id, 200);

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Adventure items: supplies. The Tianqi culture is in the system's Cultures compendium.                      */
  /* ---------------------------------------------------------------------------------------------------------- */

  const p = (...paras) => paras.map((t) => `<p>${t}</p>`).join('');
  const SUPPLIES = {
    healing_date: {
      name: 'Healing Date', type: 'gear', img: 'icons/consumables/fruit/berry-dates-jujube-red.webp',
      system: { description: p('<strong>Date (Healing)</strong> (Action): Expend one Healing Date from a RIS and choose one target within 5ft '
        + '(you can choose yourself). Remove one level of Battle Fatigue from that target. A target may benefit from a Healing Date '
        + 'no more than once per quick rest. <em>(First Aid, rulebook p.203.)</em>'), quantity: 1, value: 0, storage: 'ris', slots: 1 },
      flags: { sacadia: { catalogId: 'breach_healing_date', goods: { table: 'first-aid', use: true } } },
    },
    torch: {
      name: 'Torch', type: 'gear', img: 'icons/magic/light/torch-fire-orange.webp',
      system: { description: p('<strong>Torch</strong> (Passive, Action): When you hold a lit torch in one hand it gives off 10ft of bright '
        + 'light and 20ft of dim. In combat you may treat it as a club (5ft melee, 1D6 Bludgeon vs. PD; Fire damage while lit). '
        + 'If you critically fail to hit with it, it goes out. It burns out after one hour, or with a quick rest. <em>(Rulebook p.200.)</em>',
      '<strong>On Chuni\'s Wall:</strong> touch or throw a lit torch onto a creature soaked by an Oil Barrel to ignite it — use the '
        + 'Oil Barrel\'s <em>Ignite</em> ability for the 6D10 Fire damage.'), quantity: 3, value: 0, storage: 'ris', slots: 1 },
      // A light source (rules/goods.mjs): lit on the sheet, it lights the pregen's token on the night scene.
      flags: { sacadia: { catalogId: 'breach_torch', goods: { table: 'illumination', light: { bright: 10, dim: 20, burnsOut: true } } } },
    },
  };

  /** A copy of an adventure item, owned by `owner` (or loose in the Items folder when `owner` is null). */
  const local = (owner, key, defs, overrides = {}) => {
    const data = kit.merge(structuredClone(defs[key]), overrides);
    return kit.item(owner ?? 'items', key, data);
  };

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Pregenerated heroes                                                                                        */
  /* ---------------------------------------------------------------------------------------------------------- */

  const HP_PER_LEVEL = { soldier: 11, sentinel: 7, thug: 11, fatebound: 9 };
  const TALENT_KEYS = ['alchemy', 'art', 'construction', 'cooking', 'herbalism', 'ritual', 'smithing', 'tailor', 'literary', 'fables',
    'society', 'history', 'magic', 'religion', 'wilderness', 'other', 'acrobatics', 'athletics', 'nimblehands', 'performance', 'stealth',
    'survival', 'economy', 'medicine', 'perception', 'socialgraces', 'strategy', 'tools', 'transport'];

  // What each pregen's Heritage and ancestry grant (rules/identity.mjs grants them on a sheet; the pregens arrive with
  // them, as with their weapons' attacks). The Tianqi culture grants Heibrim Lore and Old Bushiu.
  const HERITAGE_GRANTS = { human: ['her_industrial'], fixerfolk: ['her_fae_attunement'] };
  const ANCESTRY_GRANTS = { anc_craftsman: ['anc_artisanal_crafting'], anc_talented: ['anc_extra_talents'],
    anc_resilient: ['anc_strong_constitution'], anc_sylnfolk: ['anc_elemental_resistance'] };
  const HERITAGE_HP = { human: 10, fixerfolk: 6 };
  const originSource = (pack, ref) => `Compendium.sacadia.${pack}.Item.${kit.packId(pack, ref)}`;

  /**
   * A level-5 Tianqi wall guard. `abilities` are compendium refs (with optional per-item options), `weapons`/`armor`
   * equipment refs, `gear` adventure supplies, `ancestry` an ancestry's catalog id (`picks` sets its grants' picks).
   * HP = profession HP × 5 + the Heritage's HP at Level 1 (+ Strong Constitution), all derived on the sheet.
   */
  function pregen(key, s) {
    const owner = `actor:${key}`;
    const items = [];
    for (const a of s.abilities) {
      const [ref, opts] = Array.isArray(a) ? a : [a, {}];
      items.push(kit.owned(owner, ref, opts));
    }
    for (const w of s.weapons ?? []) {
      const [ref, opts] = Array.isArray(w) ? w : [w, {}];
      items.push(...kit.weapon(owner, ref, opts));
    }
    for (const a of s.armor ?? []) items.push(kit.owned(owner, a, { system: { equipped: true } }));
    for (const [g, o] of s.gear ?? []) items.push(local(owner, g, SUPPLIES, o));
    // An inherited item from the Cultures compendium. The Red Glyph of Armor's Armor of Blood marks a defense (`effectDefense`).
    for (const [ref, { effectDefense, ...o }] of s.inherited ?? []) {
      const it = kit.owned(owner, ref, o);
      if (effectDefense) {
        it.effects = it.effects.map((e) => ({ ...e, name: `Armor of Blood (${effectDefense.toUpperCase()})`,
          changes: e.changes.map((c) => ({ ...c, key: `system.bonuses.defense.${effectDefense}` })) }));
      }
      items.push(it);
    }
    // Heritage, ancestry and culture, and what they grant.
    items.push(kit.owned(owner, 'culture_tianqi', { flags: { originSource: originSource('cultures', 'culture_tianqi') } }));
    items.push(kit.owned(owner, s.ancestry, { flags: { originSource: originSource('heritages', s.ancestry) } }));
    for (const ref of [...HERITAGE_GRANTS[s.heritage], ...ANCESTRY_GRANTS[s.ancestry], 'tianqi_heibrim_lore', 'tianqi_old_bushiu']) {
      items.push(kit.owned(owner, ref, { flags: { identityGrant: true, grantKey: ref, ...(s.picks?.[ref] ? { pickValue: s.picks[ref] } : {}) } }));
    }

    const level = 5;
    const maxHp = HP_PER_LEVEL[s.profession] * level + HERITAGE_HP[s.heritage] + (s.ancestry === 'anc_resilient' ? level : 0);
    const ancestryName = kit.compendium(s.ancestry).doc.name;
    const talents = Object.fromEntries(TALENT_KEYS.map((t) => [t, { proficient: s.talents.includes(t) }]));
    const actorId = id('actor', key);
    kit.register('actor', key, `Actor.${actorId}`, s.name);
    return {
      _id: actorId, name: s.name, type: 'character', img: asset(`${key}.webp`), folder: F.heroes._id, sort: s.sort,
      system: {
        level,
        stats: Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, { value: v }])),
        health: { value: maxHp, max: maxHp, bonus: 0, temp: 0 },
        healthPools: { value: level + Math.floor(s.stats.power / 2), max: level + Math.floor(s.stats.power / 2) },
        ap: { value: 3, max: 3 },
        lorePoints: { value: 1 },
        professions: { primary: { key: s.profession, level }, secondary: { key: '', level: 0 } },
        identity: { culture: 'Tianqi', heritage: s.heritage, ancestry: ancestryName, age: s.age ?? '', size: 'Medium' },
        background: s.background,
        biography: s.biography,
        talents,
        // Heibrim Lore's rank of Religion: Demon Lore (and any the hero bought on top).
        specialties: [{ name: 'Demon Lore', talent: 'religion', rank: 1 + (s.demonLore ?? 0), source: 'tianqi_heibrim_lore' }, ...(s.specialties ?? [])],
        classPools: s.classPools ?? {},
        professionResources: s.professionResources ?? {},
        resistances: s.resistances ?? '',
      },
      prototypeToken: token(s.name, `tokens/${key}.webp`, { disposition: DISPOSITION.friendly, actorLink: true, displayName: DISPLAY.hover, vision: true }),
      items,
      // They start the fight on the wall walkway: the Wall Top zone keeps Height in step once they move.
      effects: [{ _id: id(owner, 'effect', 'height'), name: 'Height', img: 'icons/svg/up.svg', statuses: ['height'], transfer: false,
        disabled: false, changes: [], flags: {} }],
      ownership: { default: OBSERVER },
      flags: { sacadia: { pregen: true, heritageHpMoved: true } },
    };
  }

  function token(name, img, { disposition, actorLink, displayName = DISPLAY.owner, size = 1, scale = 1, vision = false } = {}) {
    return {
      name, actorLink, disposition, displayName, displayBars: DISPLAY.owner, width: size, height: size,
      texture: { src: asset(img), scaleX: scale, scaleY: scale },
      // Vision for the heroes: with the scene's global light they see everything in line of sight.
      bar1: { attribute: 'health' }, bar2: { attribute: null }, sight: { enabled: vision, range: 0 },
      lockRotation: true,
    };
  }

  const heroes = [
    pregen('selthimor', {
      name: 'Selthimor', sort: 100, profession: 'thug', heritage: 'fixerfolk', ancestry: 'anc_sylnfolk',
      stats: { power: 2, finesse: 2, wiles: 0, courage: 2, fate: 0 },
      // A Sylnid of the lake mists: Elemental Resistance to Water (DR equal to Proficiency, rulebook p.88).
      picks: { anc_elemental_resistance: 'water' },
      talents: ['athletics', 'acrobatics'],
      specialties: [{ name: 'Climber', talent: 'athletics', rank: 3 }, { name: 'Falling', talent: 'acrobatics', rank: 3 }],
      abilities: [
        'thug_strong_fists', 'thug_natural_wrestler',
        'thug_consecutive_threat', 'thug_chained_advance', 'thug_flanking_forces', 'thug_drunken_fisticuff',
        'thug_gutwrenching_strike', 'thug_pained_bash', 'thug_tough_skull', 'thug_bloodthreat', 'thug_kneejerk', 'thug_lightning_shove',
        'thug_semper_steady', 'rousing_success', 'mastery_fist',
      ],
      weapons: [['fist_wraps', { system: { quantity: 2 } }]],
      armor: ['professional_leather_set'],
      gear: [['healing_date', {}], ['torch', {}]],
      background: {
        appearance: 'Pale grey-blue eyes and hair, pale off-white skin. White trousers and a white shirt; never wears a cloak, even on the wall.',
        connections: 'Newer among the wall guards. From Tian Chun, a religious capital of the Tianqi. Mans the great ballista atop the wall.',
        beliefs: 'The demons of Qianpo can be beaten one punch at a time.',
        secrets: 'Born of the union of a human and a Sylnid of the lake mists — the mist still clings to him on cold mornings.',
        culturalTies: 'Tian Chun\'s temples and their tales of the Ascendant heroes.',
        mementos: '',
      },
      biography: p('<em>Thug, level 5 — Fixerfolk (Sylnfolk of the Mist).</em> Selthimor hits harder every time he hits in a row: get next to '
        + 'the enemy and keep swinging. See the <strong>How to Play</strong> pages of the player handout.'),
    }),
    pregen('chunrudar', {
      name: 'Chunrudar', sort: 200, profession: 'fatebound', heritage: 'human', ancestry: 'anc_craftsman', demonLore: 1,
      stats: { power: 2, finesse: 0, wiles: 0, courage: 2, fate: 2 },
      talents: ['perception', 'medicine', 'religion'],
      specialties: [{ name: 'Medic', talent: 'medicine', rank: 3 }],
      abilities: [
        'fated_strike', 'heavy_weaponry', 'targeted_foe', 'resilient_foe', 'aware_foe', 'crushing_blow', 'imbued_fury',
        'lucky_break', 'longing_fates',
        ['fb_elemental_weapon', { flags: { pickValue: 'rot' } }], 'rousing_success', 'mastery_heavy_weapons',
      ],
      // The Greatsword is his divine weapon (Fated Strike), wreathed in rot-mist by his Elemental Weapon.
      weapons: [['greatsword', { flags: { signature: true } }]],
      armor: ['professional_leather_set'],
      gear: [['healing_date', {}], ['torch', {}]],
      background: {
        appearance: 'Blue, flowering robes over leather; short black hair. His eyes are a misty blue — they were earthy brown before his pact.',
        connections: 'A wall guard alongside Selthimor at the great ballista.',
        beliefs: 'A bargain with a demon of the mists is a fair price for the power to hold the wall.',
        secrets: 'He made a pact with a demon of the mists. His misty sword answers when he calls it.',
        culturalTies: 'Intricately tied to the land of the Heibrim.',
        mementos: '',
      },
      biography: p('<em>Fatebound, level 5 — Human (Craftsman).</em> Chunrudar wields a divine greatsword of mist and twists fate to fumble '
        + 'his enemies. Use Lucky Break from range, then close in and declare Wanabbul your Targeted Foe.'),
    }),
    pregen('honnasusara', {
      name: 'Honnasusara', sort: 300, profession: 'soldier', heritage: 'human', ancestry: 'anc_talented',
      stats: { power: 2, finesse: 1, wiles: 0, courage: 2, fate: 1 },
      talents: ['perception', 'athletics'],
      specialties: [{ name: 'Sight', talent: 'perception', rank: 3 }, { name: 'Climber', talent: 'athletics', rank: 3 },
        { name: 'Hearing', talent: 'perception', rank: 1 }],
      abilities: [
        'courageous_command', 'call_to_action', 'call_of_healing', 'call_of_respite', 'call_of_fury', 'voice_of_the_leader',
        'sacrifice', 'standard_bearer', 'stand_by_me', 'shield_warrior',
        'sol_imposing_figure', 'rousing_success', 'mastery_spear',
      ],
      weapons: ['spear', 'armored_buckler'],
      // The glyph's Armor of Blood guards her weakest defense (MD); her iron set and buckler cover PD.
      armor: ['professional_iron_set'],
      gear: [['healing_date', {}]],
      inherited: [['tianqi_red_glyph_of_armor', { effectDefense: 'md' }]],
      classPools: { call: { value: 6, max: 6 } },
      background: {
        appearance: 'A breastplate emblazoned with the sigil of the Tianqi — a red and white flower over a blue painted field. A glyphic sigil '
          + 'of protection sticks out from behind her armor.',
        connections: 'An honored soldier who has manned Chuni\'s Wall since she was a youth. Mother of Manchuthara.',
        beliefs: 'The wall holds as long as its people hold together.',
        secrets: '',
        culturalTies: 'Firstborn and sworn to the military, as Tianqi law demands. Her glyph is a protective totem for her and her warriors.',
        mementos: 'The Red Glyph of Armor, written in her own blood.',
      },
      biography: p('<em>Soldier, level 5 — Human (Talented).</em> A frontline tank and the party\'s support: stay close to your allies and '
        + 'spend your calls on them.'),
    }),
    pregen('manchuthara', {
      name: 'Manchuthara', sort: 400, profession: 'sentinel', heritage: 'human', ancestry: 'anc_resilient',
      stats: { power: 0, finesse: 2, wiles: 2, courage: 2, fate: 0 },
      talents: ['perception', 'acrobatics'],
      specialties: [{ name: 'Hearing', talent: 'perception', rank: 3 }, { name: 'Falling', talent: 'acrobatics', rank: 3 }],
      abilities: [
        'reactive_mind', ['favored_enemy', { flags: { pickValue: 'demon' } }], 'trickshot',
        // Bigger Stones taken twice, both on the crossbow (1D4 → 1D8).
        ['bigger_stones', { flags: { pickValue: 'crossbow' } }], ['bigger_stones', { key: 'bigger_stones_2', flags: { pickValue: 'crossbow' } }],
        'boltshot', 'pullback', 'pinning_bolt', 'head_strike', 'forceful_strike', 'striking_savant', 'favoritism',
        'sen_skilled_warrior', 'rousing_success', 'mastery_crossbow',
      ],
      weapons: ['crossbow'],
      armor: ['professional_dye_set'],
      gear: [['healing_date', {}], ['torch', {}]],
      classPools: { trickshot: { value: 6, max: 6 } },
      background: {
        appearance: 'Long brown hair and deep brown eyes; brown trousers tied at the waist and a straw cloak.',
        connections: 'The younger daughter of Honnasusara.',
        beliefs: 'One bolt, well placed, is worth a dozen loosed in fear.',
        secrets: '',
        culturalTies: 'An accomplished crossbowman and expert marksman of the wall.',
        mementos: '',
      },
      biography: p('<em>Sentinel, level 5 — Human (Resilient).</em> The party\'s ranged damage: stand your ground on the wall and spend your '
        + 'whole turn on one charged crossbow shot.'),
    }),
  ];

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  NPCs: demons, siege engines, hazards                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** "2d10+5" → structured damage parts of `type`. */
  function damage(formula, type = '') {
    const m = /^(\d+)d(\d+)(?:\s*\+\s*(\d+))?$/i.exec(formula.replace(/\s+/g, ''));
    if (!m) throw new Error(`bad damage "${formula}"`);
    const parts = [{ count: m[1], denomination: Number(m[2]), formula: '', trait: '', type }];
    if (m[3]) parts.push({ count: '', denomination: null, formula: m[3], trait: '', type });
    return parts;
  }

  const SAVE = (trait, inflict = [], extra = {}) => ({ type: 'save', label: '', save: { trait, dc: null, onSuccess: 'none' },
    damage: extra.damage ? damage(extra.damage, extra.type) : [], inflict });

  /**
   * One NPC ability. `toHit` is the stat block's full to-hit: the gap above the attack's trait is a modifier scoped to
   * this ability (NPCs have no Proficiency, so their stats hold the stat-block check modifiers).
   */
  function npcAbility(owner, stats, key, s) {
    const catalogId = `breach_${owner}_${key}`;
    const activities = [];
    const modifiers = [];
    if (s.attack) {
      const category = s.attack.category ?? 'melee';
      const trait = { melee: 'power', ranged: 'finesse', magic: 'wiles' }[category];
      activities.push({ type: 'attack', label: '', attack: { category, trait: '', defense: s.attack.defense ?? 'pd' },
        damage: s.attack.noDamage ? [] : damage(s.attack.damage, s.attack.type), inflict: s.attack.inflict ?? [],
        noDamage: !!s.attack.noDamage, autoHit: !!s.attack.autoHit });
      const gap = (s.attack.toHit ?? stats[trait]) - stats[trait];
      if (gap && !s.attack.autoHit) modifiers.push({ label: s.name, target: 'toHit', mode: 'add', scope: catalogId, value: String(gap), predicate: [] });
    }
    if (s.save) activities.push(s.save);
    return kit.item(`actor:${owner}`, key, {
      name: s.name, type: 'ability', img: s.img ?? 'icons/creatures/abilities/fangs-teeth-bite.webp',
      system: {
        description: p(...[].concat(s.text)), tag: s.tag ?? 'action',
        costs: { ap: s.ap ?? ((s.tag ?? 'action') === 'action' || s.tag === 'focus' ? 1 : 0), csp: 0, madness: 0, limbs: s.limbs ?? [] },
        range: s.range ?? { value: null, type: '' },
        meta: { profession: '', subpath: '', prerequisite: '' },
        activities, modifiers,
        ...(s.choice ? { choice: s.choice } : {}),
        ...(s.usage ? { usage: { per: '', max: 1, perTarget: false, requires: [], requiresLabel: '', upgrades: [], ...s.usage } } : {}),
      },
      effects: s.effects ?? [],
      flags: { sacadia: { catalogId } },
    });
  }

  /** Condition immunities as a transferred effect on a passive (read via `bonuses.immune`, helpers/conditions.mjs). */
  const immunity = (label, conditions) => [{ name: label, img: 'icons/svg/aura.svg', transfer: true, disabled: false,
    changes: conditions.map((c) => ({ key: `system.bonuses.immune.${c}`, mode: 2, value: '1', priority: null })) }];
  /** Advantage on Trait Checks of one trait (the stat blocks' "Roll with NX Advantage"). */
  const traitAdvantage = (trait, n) => ({ label: `${trait[0].toUpperCase()}${trait.slice(1)} Checks (${n}X advantage)`, target: 'resistAdvantage',
    mode: 'add', scope: 'all', value: String(n), predicate: [{ atom: `self:checking:trait:${trait}` }] });
  /** Natural armor that can be rended (the stat blocks' "PD 19(3)"); the stored defenses already count it. */
  const hide = (owner, pd) => kit.item(`actor:${owner}`, 'natural_armor', {
    name: 'Demonic Hide', type: 'armor', img: 'icons/commodities/leather/scales-brown.webp',
    system: { description: p(`Natural armor: ${pd} points of this creature's PD can be rended (the stat block's "(${pd})").`),
      equipped: true, category: '', defenses: { ad: 0, pd, td: 0, md: 0, dr: 0 }, maxStat: null, slots: 0, storage: 'ris' },
  });

  function npc(key, s) {
    const owner = key;
    const actorId = id('actor', key);
    kit.register('actor', key, `Actor.${actorId}`, s.name);
    const items = Object.entries(s.abilities).map(([k, a]) => npcAbility(owner, s.stats, k, a));
    if (s.traitAdvantage) {
      items.push(kit.item(`actor:${owner}`, 'trait_expertise', {
        name: 'Trait Expertise', type: 'ability', img: 'icons/svg/upgrade.svg',
        system: { description: p(s.traitAdvantage.map(([t, n]) => `Rolls ${t[0].toUpperCase()}${t.slice(1)} Checks with ${n}X Advantage.`).join(' ')),
          tag: 'passive', costs: { ap: 0, csp: 0, madness: 0, limbs: [] }, modifiers: s.traitAdvantage.map(([t, n]) => traitAdvantage(t, n)) },
        flags: { sacadia: { catalogId: `breach_${owner}_trait_expertise` } },
      }));
    }
    if (s.rend) items.push(hide(owner, s.rend));
    const size = { small: 1, medium: 1, large: 2, huge: s.tokenSize ?? 3, gigantic: 5 }[s.size ?? 'medium'];
    return {
      _id: actorId, name: s.name, type: 'npc', img: s.img ? asset(s.img) : (s.icon ?? 'icons/svg/mystery-man.svg'),
      folder: s.folder, sort: s.sort ?? 0,
      system: {
        stats: Object.fromEntries(Object.entries(s.stats).map(([k, v]) => [k, { value: v }])),
        health: { value: s.hp, max: s.hp, bonus: 0, temp: 0 },
        ap: { value: s.ap, max: s.ap },
        defenses: s.defenses, checkDc: s.checkDc, cr: s.level ?? 0, role: s.role ?? '', creatureType: s.creatureType ?? '',
        size: s.size ?? 'medium', speed: s.speed ?? 30, resistances: s.resistances ?? '',
        biography: s.biography ?? '',
      },
      prototypeToken: token(s.name, s.token ?? `tokens/${key}.webp`, { disposition: s.disposition ?? DISPOSITION.hostile,
        actorLink: s.linked ?? true, size, scale: s.tokenScale ?? 1 }),
      items,
      effects: [],
      ownership: { default: s.ownership ?? NONE },
      flags: { sacadia: { adventure: 'the-breach' } },
    };
  }

  const L = { mind: ['mind'], oneArm: ['oneArm'], twoArm: ['twoArm'], body: ['body'], leg: ['leg'], focus: ['focus'] };
  const melee = (value = 5) => ({ value, type: 'melee' });
  const area = (value) => ({ value, type: 'area' });
  const ranged = (value) => ({ value, type: 'ranged' });
  const below = { requires: [{ atom: 'self:hp-below-half' }], requiresLabel: 'Only below half health' };

  const wanabbul = npc('wanabbul', {
    name: 'Wanabbul the Vast', img: 'wanabbul.webp', folder: F.demons._id, sort: 100, level: 9, role: 'Demon of Qianpo (solo)',
    creatureType: 'demon', size: 'gigantic', hp: 600, ap: 3, speed: 20, checkDc: 17,
    defenses: { ad: 14, pd: 19, td: 19, md: 14, dr: 0 }, rend: 3,
    stats: { power: 8, finesse: 6, wiles: 4, courage: 6, fate: 4 },
    traitAdvantage: [['power', 3]],
    biography: p('<em>Level 9 Demon · Gigantic (5×5) · Prof. +5 · 3 AP (plus a 20ft move each turn) · Talents: Perception +13, Athletics +13.</em>',
      'A gigantic, demonic figure who looms up to the height of the top of the wall — a shadowy shape trailing whisps of black smoke. '
      + 'Illuminated in a flash of fire, he appears almost hollow.',
      '<strong>Behavior.</strong> Wanabbul moves forward 20ft every round, through any obstacle. When he reaches the wall he destroys '
      + 'it in a single turn, then tries to Grab one nearby character. Once he is reduced to half health he sprouts more arms on his '
      + 'next turn and uses Draining Aura. <em>Optional:</em> speed him up to 25ft or 30ft below half health for a faster, slightly '
      + 'easier fight.',
      '<strong>Death.</strong> A humanoid skeleton — the last remnant of his once-human form — falls to the ground while the rest of '
      + 'him dissipates into mist.'),
    abilities: {
      bite: { name: 'Bite', limbs: L.mind, range: melee(5), img: 'icons/creatures/abilities/mouth-teeth-long-red.webp',
        attack: { defense: 'pd', toHit: 12, damage: '2d10+5', type: 'piercing' },
        text: '+12 to-hit against PD. Deal 2D10+5 Piercing on a hit. 5ft range.' },
      punch: { name: 'Punch', limbs: L.oneArm, range: melee(15), img: 'icons/skills/melee/unarmed-punch-fist.webp',
        attack: { defense: 'pd', toHit: 12, damage: '2d6+5', type: 'bludgeoning' },
        text: '+12 to-hit against PD. Deal 2D6+5 Bludgeoning on a hit. 15ft range.' },
      stomp: { name: 'Stomp', limbs: L.leg, range: area(30), img: 'icons/skills/movement/feet-winged-boots-brown.webp',
        save: SAVE('power', [{ condition: 'prone', amount: '1' }]),
        text: 'All creatures within 30ft of you on the ground beneath you make a Power Check or are knocked Prone.' },
      grab: { name: 'Grab', limbs: L.oneArm, range: { value: 20, type: 'ranged' }, usage: { per: 'combat', max: 1 }, img: 'icons/magic/control/debuff-chains-ropes-net-red-orange.webp',
        save: SAVE('finesse', [{ condition: 'pinned', amount: '3' }]),
        text: ['Once in combat as you are near the wall, choose one target within 20ft of you. Attempt to give that target 3 levels of Pin '
          + '(Finesse Check negates). If they take at least one level of Pin, move them to you. They are held in your hand.',
        'If they lose all Pin while in your hand, they may choose to cling to you (make a DC15 Finesse Check to do so) or drop to the '
          + 'ground below (taking 6D6 damage from the fall).'] },
      drop: { name: 'Drop', tag: 'boost', img: 'icons/skills/movement/arrow-down-pink.webp',
        text: 'As a Boost to an action while you are holding a creature, you may drop that creature. They may use a reaction to make a '
          + 'DC15 Finesse Check to cling to you, or they fall to the ground, taking 6D6 damage from the fall.' },
      draining_aura: { name: 'Draining Aura', limbs: L.body, range: area(30), usage: { per: 'combat', max: 1, ...below }, img: 'icons/magic/unholy/strike-body-life-soul-purple.webp',
        save: SAVE('power', [{ condition: 'fatigue', amount: '2' }]),
        text: 'Once per combat, every creature within 30ft of you makes Power Checks against 2 levels of Fatigue. Only use this when you '
          + 'have less than half health.' },
      sprouting_arms: { name: 'Sprouting Arms', tag: 'passive', img: 'icons/creatures/tentacles/tentacles-octopus-black-pink.webp',
        text: 'When you have less than half HP, you sprout additional arms on your body. Do not exhaust each one-arm limb the first time you '
          + 'would use them in combat.' },
      gigantic_beast: { name: 'Gigantic Beast', tag: 'passive', img: 'icons/creatures/magical/humanoid-giant-forest-blue.webp',
        text: ['As a gigantic creature, you have 3X advantage against any physical condition (e.g., Pin, Prone) — the v1.2 size rule, '
          + 'applied automatically against Medium creatures.',
        'Creatures may climb onto and stand on this creature. If they do, all movement on it is difficult terrain, and they must make '
          + 'a Power Check to climb (following the Climb Rules), treating it as a slow-moving creature (1X disadvantage).'] },
      wallbreaker: { name: 'Wallbreaker', tag: 'passive', img: 'icons/environment/settlement/city-wall.webp',
        text: 'Wanabbul moves forward 20ft per round through any obstacle. When he reaches Chuni\'s Wall, he destroys it in a single turn, '
          + 'leaving a wide hole that stops anyone crossing east–west along the wall top.' },
    },
  });

  // "Whisps of black smoke trailing from his form": a darkening haze around him. A light with low luminosity darkens
  // without hiding him (a darkness source would, and the heroes couldn't target him in it).
  wanabbul.prototypeToken.light = { dim: 25, bright: 0, color: '#2b1d2e', alpha: 0.75, luminosity: 0.15, attenuation: 0.8, coloration: 1,
    animation: { type: 'smokepatch', speed: 2, intensity: 6 } };

  const grubnut = npc('grubnut', {
    name: 'Grubnut', img: 'grubnut.webp', folder: F.optional._id, sort: 100, level: 9, role: 'Demon of Qianpo (optional, harder)',
    creatureType: 'demon', size: 'huge', tokenSize: 3, hp: 700, ap: 4, speed: 20, checkDc: 17,
    defenses: { ad: 15, pd: 20, td: 20, md: 15, dr: 0 }, rend: 3,
    stats: { power: 7, finesse: 7, wiles: 4, courage: 5, fate: 6 },
    traitAdvantage: [['power', 1]],
    biography: p('<em>Level 9 Demon · Huge (3×3) · Prof. +5 · 4 AP · Talents: Perception +8, Athletics +13.</em>',
      'A writhing, pustulous worm creature. Not as physically intimidating as Wanabbul, but faster: a 20ft move plus Slam\'s 15ft '
      + 'carries him 35ft a turn.',
      '<strong>Behavior.</strong> Above half health he won\'t move past the characters — anyone who stands in front of him gets his '
      + 'attention. Below half HP he races for the southern edge of the map.',
      '<strong>The wall.</strong> Grubnut can\'t breach the wall at once: on his first turn attacking it, it splinters; on the second it '
      + 'shatters; on the third he moves through.',
      '<strong>Death.</strong> He melts, leaving a strong stench, a sizzling corpse of boils and green ooze, and the outline of a '
      + 'dangerously warped human skeleton.'),
    abilities: {
      bite: { name: 'Bite', limbs: L.mind, range: melee(5), img: 'icons/creatures/abilities/mouth-teeth-long-red.webp',
        attack: { defense: 'pd', toHit: 12, damage: '3d8+6', type: 'piercing' }, text: '+12 to-hit against PD. Deal 3D8+6 Piercing on a hit. 5ft range.' },
      writhe: { name: 'Writhe', limbs: L.body, range: melee(10), img: 'icons/creatures/abilities/tail-swipe-green.webp',
        attack: { defense: 'pd', toHit: 12, damage: '1d10+5', type: 'bludgeoning' },
        text: '+12 to-hit against PD. Deal 1D10+5 Bludgeoning on a hit. 10ft range. Make this attack against every creature within 10ft of you.' },
      pustule_fumes: { name: 'Pustule (Fumes)', limbs: L.body, range: ranged(10), img: 'icons/magic/acid/projectile-smoke-glowing.webp',
        choice: { prompt: 'Which condition?', requires: '', options: [{ value: 'delirium', label: 'Delirium' }, { value: 'nausea', label: 'Nausea' }] },
        save: SAVE('courage', [{ condition: '@choice', amount: '4' }]),
        text: ['A pustule bursts out this creature\'s side. Choose one target within 10ft of this creature to make a Courage Check against '
          + '4 levels of either Delirium or Nausea.', '<em>The same Pustule action as Pustule (Bile) — pick one per use.</em>'] },
      pustule_bile: { name: 'Pustule (Bile)', limbs: L.body, range: ranged(10), img: 'icons/magic/acid/dissolve-bone-white.webp',
        save: SAVE('finesse', [{ condition: 'hemorrhage', amount: '2' }]),
        text: ['A pustule bursts out this creature\'s side. Choose one target within 10ft of this creature to make a Finesse Check against '
          + '2 levels of Hemorrhage.', '<em>The same Pustule action as Pustule (Fumes) — pick one per use.</em>'] },
      stench: { name: 'Stench', limbs: L.body, range: area(60), usage: { per: 'combat', max: 1 }, img: 'icons/magic/unholy/projectile-smoke-tendril-green.webp',
        save: SAVE('courage', [{ condition: 'nausea', amount: '6' }]),
        text: 'Once in combat, all creatures within 60ft of you must make Courage Checks against 6 levels of Nausea.' },
      slam: { name: 'Slam', limbs: L.body, range: area(15), usage: { per: 'turn', max: 1 }, img: 'icons/skills/melee/strike-hammer-destructive-orange.webp',
        save: SAVE('finesse', [], { damage: '3d10', type: 'bludgeoning' }),
        text: ['Move 15ft forward. All creatures in the 15×15 square you move into make a 1X disadvantaged Finesse Check against this '
          + 'creature\'s Check DC or take 3D10 damage. Can use at most once per turn.',
        'If you slam a wall, the wall takes 5D10 damage and all creatures within 30ft of the point of impact along the wall make a Finesse '
          + 'Check against your Check DC or are knocked Prone. <em>(Apply the 1X disadvantage from the save card.)</em>'] },
      squirming_beast: { name: 'Squirming Beast', tag: 'passive', img: 'icons/environment/creatures/bug-worm-toothed-grey.webp',
        effects: immunity('Squirming Beast', ['fatigue', 'prone']),
        text: 'This creature is immune to Fatigue and Prone. It has 1X advantage against any physical condition (e.g., Pin) — in v1.2 its '
          + 'Huge size already gives it 2X against Medium creatures, which applies instead.' },
    },
  });

  const swarmText = 'This creature is immune to all Physical Adversarial Conditions as well as Prone, Blinded, and Surrounded. It may not be rended.';
  const SWARM_IMMUNE = ['nausea', 'pinned', 'paralysis', 'corroded', 'debilitated', 'pulled', 'hemorrhage', 'prone', 'blinded'];
  const csenorrasAbilities = (biteDamage, swallowPin, extra = {}) => ({
    bite: { name: 'Bite', limbs: L.mind, range: melee(5), img: 'icons/creatures/abilities/mouth-teeth-long-red.webp',
      attack: { defense: 'pd', toHit: 12, damage: biteDamage, type: 'piercing' },
      text: `+12 to-hit against PD. Deal ${biteDamage.toUpperCase()} Piercing on a hit. 5ft range. You may use this on a creature you have swallowed.` },
    oozing_worms: { name: 'Oozing Worms', tag: 'focus', limbs: L.focus, img: 'icons/magic/acid/pouring-gas-smoke-liquid.webp',
      text: 'As long as you maintain Focus, wherever you move you leave a trail of ooze. The trail remains for as long as combat continues '
        + 'and is difficult terrain.' },
    split_merge: { name: 'Split / Merge', limbs: L.body, img: 'icons/environment/creatures/bug-worm-toothed-grey.webp',
      text: ['This creature may split into multiple parts and merge back together, up to twice. Each split replaces its token with two swarm '
        + 'tokens, each one square smaller than the summed mass, splits its current HP evenly between them, and both keep every level of '
        + 'every condition it had. Every dice type a swarm deals drops by two dice types, and each swarm has 1 less AP.',
      'As an action, a swarm can merge with another of the same size into a larger swarm, reversing all splitting effects (keeping the '
        + 'maximum set of conditions from either swarm). <em>Use the "Csenorras Swarm" actors for the split forms.</em>'] },
    swallow: { name: 'Swallow', limbs: L.body, range: melee(5), img: 'icons/magic/control/debuff-chains-ropes-net-red-orange.webp',
      save: SAVE('finesse', [{ condition: 'pinned', amount: String(swallowPin) }]),
      text: [`Choose one target within 5ft. That target makes Finesse Checks against ${swallowPin} levels of Pin. If they take at least 1, move `
        + 'over that target\'s square (centering on it). For as long as that creature has any levels of Pin, they cannot sense anything '
        + `outside of Csenorras or take reactions, and they take ${extra.swallowDamage ?? '3D10'} Piercing Damage at the start of each of their turns.`,
      'Only usable while at least 3×3 in size, and only once per unique target. (Attempts one level less Pin once Csenorras has split.)'] },
    swarm_beast: { name: 'Swarm Beast', tag: 'passive', img: 'icons/environment/creatures/bug-worm-toothed-grey.webp',
      effects: immunity('Swarm Beast', SWARM_IMMUNE), text: swarmText },
  });
  const csenorrasBio = (form) => p(`<em>${form}</em>`, 'A giant writhing mass of black worms, loosely organized around a human skull somewhere deep '
    + 'within. It keeps a semblance of collective intelligence, but it is alien now.',
  '<strong>Behavior.</strong> It moves forward each turn; once split, only one mass presses forward while the others hunt characters to '
    + 'slow the party. At the wall it splits in two: one part breaks the wall down over two turns while the other climbs the 40ft wall '
    + 'and starts overrunning characters. Treat each split as its own monster — abilities that target a single monster choose a swarm.',
  '<strong>Death.</strong> It shrinks as its health drops. When it dies, the last worms wriggle to the ground, leaving a single human skull '
    + 'stained black. Held to an ear, it murmurs faintly.');

  const csenorras = npc('csenorras', {
    name: 'Csenorras the Manyworm', img: 'csenorras.webp', folder: F.optional._id, sort: 200, level: 9, role: 'Demon of Qianpo (optional, hardest swarm)',
    creatureType: 'demon', size: 'huge', tokenSize: 4, hp: 640, ap: 5, speed: 20, checkDc: 17, linked: false,
    defenses: { ad: 15, pd: 20, td: 20, md: 15, dr: 0 },
    stats: { power: 6, finesse: 7, wiles: 4, courage: 4, fate: 5 },
    traitAdvantage: [['finesse', 1]],
    biography: csenorrasBio('Level 9 Demon · Huge (4×4) · Prof. +5 · 5 AP · Move 20ft, Climb 20ft · Talents: Perception +10, Acrobatics +10.'),
    abilities: csenorrasAbilities('2d10+4', 5),
  });
  // The split forms: one square smaller, dice two types lower, 1 AP less, and one less Pin on Swallow (ladder: 2D10 → 2D6 → 1D8).
  const swarm1 = npc('csenorras_swarm_1', {
    name: 'Csenorras Swarm (split once)', img: 'csenorras.webp', token: 'tokens/csenorras.webp', folder: F.optional._id, sort: 210, level: 9,
    role: 'Split swarm', creatureType: 'demon', size: 'huge', tokenSize: 3, hp: 320, ap: 4, speed: 20, checkDc: 17, linked: false,
    defenses: { ad: 15, pd: 20, td: 20, md: 15, dr: 0 }, stats: { power: 6, finesse: 7, wiles: 4, courage: 4, fate: 5 },
    traitAdvantage: [['finesse', 1]],
    biography: csenorrasBio('Csenorras after one split · 3×3 · 4 AP. Set HP to half of Csenorras\'s current HP when it splits.'),
    abilities: csenorrasAbilities('2d6+4', 4, { swallowDamage: '2D8' }),
  });
  const swarm2 = npc('csenorras_swarm_2', {
    name: 'Csenorras Swarm (split twice)', img: 'csenorras.webp', token: 'tokens/csenorras.webp', folder: F.optional._id, sort: 220, level: 9,
    role: 'Split swarm', creatureType: 'demon', size: 'large', hp: 160, ap: 3, speed: 20, checkDc: 17, linked: false,
    defenses: { ad: 15, pd: 20, td: 20, md: 15, dr: 0 }, stats: { power: 6, finesse: 7, wiles: 4, courage: 4, fate: 5 },
    traitAdvantage: [['finesse', 1]],
    biography: csenorrasBio('Csenorras after two splits · 2×2 · 3 AP. Too small to Swallow (needs 3×3). Set HP to half of its parent swarm\'s current HP.'),
    abilities: csenorrasAbilities('1d8+4', 4, { swallowDamage: '2D6' }),
  });

  const weaver = npc('weavers_daughter', {
    name: 'The Weaver\'s Daughter', img: 'weavers-daughter.webp', token: 'tokens/weavers-daughter.webp', folder: F.optional._id, sort: 300, level: 8, role: 'Demon of Qianpo (optional, deadliest)',
    creatureType: 'demon', size: 'medium', hp: 400, ap: 4, speed: 20, checkDc: 18,
    defenses: { ad: 15, pd: 18, td: 18, md: 15, dr: 0 }, rend: 2,
    stats: { power: 4, finesse: 4, wiles: 8, courage: 5, fate: 8 },
    biography: p('<em>Level 8 Demon · Medium · Prof. +4 · 4 AP · Talents: Perception +8, Religion +10.</em>',
      'The most intelligent, cunning and dangerous of these demons; her strategy targets the most powerful characters.',
      '<strong>Behavior.</strong> She won\'t breach the wall. She summons four Weaverspools: half go after the characters and the '
      + 'ballista, half make for the door and unlock it (an action), letting her wander in.',
      '<strong>Her true form.</strong> She first appears as an old, frail woman, so the Weaverspools look like the real threat. Below '
      + 'half HP she reveals her sewn-together maw, row after row of rending teeth. If she nears the end of the map and thinks she has '
      + 'won, she takes the form of one of the characters with Change Shape, ready to walk into the town beyond.',
      '<strong>Death.</strong> She crumples into a pile of magic yarn in shades of blood red, black ichor and yellow bile.'),
    abilities: {
      rending_bite: { name: 'Rending Bite', limbs: L.mind, range: melee(5), usage: { per: '', ...below }, img: 'icons/creatures/abilities/mouth-teeth-long-red.webp',
        attack: { defense: 'pd', toHit: 10, damage: '2d8', type: 'piercing', inflict: [{ condition: 'hemorrhage', amount: '3', saveNegate: 'power' }] },
        text: '+10 to-hit against PD. Deal 2D8 Piercing on a hit. 5ft range. The target makes a Power Check against 3 levels of Hemorrhage. '
          + 'Can only use when below half health.' },
      claw: { name: 'Claw', limbs: L.oneArm, range: melee(5), img: 'icons/creatures/claws/claw-curved-jagged-gray.webp',
        attack: { defense: 'pd', toHit: 9, damage: '2d6+4', type: 'slashing' }, text: '+9 to-hit against PD. Deal 2D6+4 Slashing on a hit. 5ft range.' },
      spearing_thoughts: { name: 'Spearing Thoughts', limbs: L.mind, range: ranged(30), img: 'icons/magic/control/hypnosis-mesmerism-eye.webp',
        attack: { category: 'magic', defense: 'md', toHit: 9, damage: '2d10', type: 'mental' },
        text: '+9 to-hit against MD. Deal 2D10 Force damage on a hit (Mental damage in v1.2 terms). 30ft range.' },
      fatiguing_touch: { name: 'Fatiguing Touch', limbs: L.oneArm, range: melee(5), usage: { per: 'combat', max: 1, perTarget: true }, img: 'icons/magic/unholy/hand-claw-glow-orange.webp',
        save: SAVE('power', [{ condition: 'fatigue', amount: '3' }]),
        text: 'Choose one target within 5ft of you. They make Power Checks against 3 levels of Fatigue. Once they have made this check, you '
          + 'may not use Fatiguing Touch on that creature again.' },
      summon_weaverspools: { name: 'Summon Weaverspools', limbs: L.mind, img: 'icons/creatures/mammals/rodent-rat-diseaed-gray.webp',
        text: 'The Weaver\'s Daughter may summon 4 Weaverspools in total. They appear in squares adjacent to her. <em>(Drag Weaverspool '
          + 'tokens from the Actors directory; each is its own unlinked creature.)</em>' },
      bolster_swarm: { name: 'Bolster Swarm', tag: 'focus', limbs: L.focus, range: area(60), img: 'icons/magic/control/buff-strength-muscle-damage-orange.webp',
        text: 'As long as you maintain Focus, increase the damage of the Bite attack of all Weaverspools within 60ft of you by 1 dice type. '
          + 'Additionally increase their to-hit by +2 and their Check DC by 1.' },
      change_shape: { name: 'Change Shape', tag: 'focus', limbs: L.focus, img: 'icons/magic/control/silhouette-hold-change-blue.webp',
        text: 'The Weaver\'s Daughter may take on the form of any humanoid creature with a Focus action, maintaining the effect until her Focus ends.' },
      demon_resistances: { name: 'Demon Resistances', tag: 'passive', img: 'icons/svg/aura.svg',
        effects: immunity('Demon Resistances', ['fatigue']),
        text: 'This creature is immune to Fatigue and has 1X advantage against Panic or Taunt.' },
    },
  });
  // Demon Resistances' 1X advantage against Panic and Taunt rides on the passive as check modifiers.
  const dr = weaver.items.find((i) => i.flags.sacadia.catalogId === 'breach_weavers_daughter_demon_resistances');
  dr.system.modifiers = ['panic', 'taunt'].map((c) => ({ label: 'Demon Resistances', target: 'resistAdvantage', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: `self:checking:${c}` }] }));

  const weaverspool = npc('weaverspool', {
    name: 'Weaverspool', img: 'weavers-daughter.webp', token: 'tokens/weaverspool.webp', folder: F.optional._id, sort: 310, level: 2,
    role: 'Summoned demon', creatureType: 'demon', size: 'small', hp: 100, ap: 3, speed: 30, checkDc: 15, linked: false, tokenScale: 0.8,
    defenses: { ad: 13, pd: 16, td: 16, md: 13, dr: 0 },
    stats: { power: 2, finesse: 5, wiles: 3, courage: 3, fate: 2 },
    biography: p('<em>Level 2 Demon · Small · Prof. +2 · 3 AP · Move 30ft, Climb 30ft · Talents: Perception +8, Acrobatics +8, Nimble Hands +8, Stealth +8.</em>',
      'The Weaver\'s Daughter\'s needle-fingered familiars. The Weaver\'s Daughter summons four of them in total.'),
    abilities: {
      bite: { name: 'Bite', limbs: L.mind, range: melee(5), img: 'icons/creatures/abilities/mouth-teeth-long-red.webp',
        attack: { defense: 'pd', toHit: 5, damage: '1d8+4', type: 'piercing' }, text: '+5 to-hit against PD. Deal 1D8+4 Piercing Damage if you hit. 5ft range.' },
      needlepoint: { name: 'Needlepoint', limbs: L.twoArm, range: melee(5), usage: { per: 'combat', max: 1, perTarget: true }, img: 'icons/tools/hand/needle-grey.webp',
        save: SAVE('finesse', [{ condition: 'pinned', amount: '4' }]),
        text: 'Choose one target within 5ft. They make a Finesse Check against 4 levels of Pin. Once given Pin this way, for each level of Pin '
          + 'the target loses from any effect (including normal reduction at the end of their turn) except the Make Trait Check action, '
          + 'they take 1D8 damage. Once a target has broken all Pin, this cannot be used against them again.' },
      restorative_needlework: { name: 'Restorative Needlework', limbs: L.twoArm, range: melee(5), usage: { per: 'turn', max: 1 }, img: 'icons/tools/hand/needle-grey.webp',
        attack: { defense: 'pd', toHit: 5, noDamage: true, inflict: [{ condition: 'pinned', amount: '1', stacks: true }] },
        text: '+5 to-hit against PD. If you hit, the target gains one level of Pin (in addition to Pin they already have been given through '
          + 'Needlepoint) to a maximum of 4. You may only use this once per turn.' },
    },
  });

  // Siege engines and hazards — "objects": players own the engines and fire them; the operator pays the AP and limbs
  // (spend them on your own sheet), so the engine's own abilities cost nothing.
  const operate = (cost) => `<em>Operating it costs you (the crew member) ${cost} — spend it on your own sheet.</em>`;
  const ballista = npc('wall_ballista', {
    name: 'Wall Ballista', icon: 'icons/weapons/artillery/ballista-wood-green.webp', folder: F.props._id, sort: 100,
    role: 'Siege engine', size: 'large', hp: 1, ap: 0, speed: 0, checkDc: 10, linked: true, disposition: DISPOSITION.neutral, ownership: OWNER,
    defenses: { ad: 10, pd: 10, td: 10, md: 10, dr: 0 }, stats: { power: 0, finesse: 8, wiles: 0, courage: 0, fate: 0 },
    biography: p('The great ballista atop the tower (map key 1). It begins the one-shot loaded. If a demon deals damage to it, it breaks.',
      'It can only be fired at targets north of the wall — it cannot be aimed south of the front gate. Range 150ft.'),
    abilities: {
      aim: { name: 'Aim the Ballista', ap: 0, img: 'icons/skills/targeting/crosshair-pointed-orange.webp',
        text: ['Aim the ballista at a target north of the wall. It must be aimed again each time its target moves, or it automatically misses.', operate('1 AP and both arms')] },
      fire: { name: 'Fire the Ballista', ap: 0, range: ranged(150), img: 'icons/weapons/ammunition/arrow-broadhead-glowing-orange.webp',
        attack: { category: 'ranged', defense: 'pd', toHit: 8, damage: '8d10', type: 'piercing' },
        text: ['To-Hit 1D20+8 against PD; deals 8D10 Piercing Damage if it hits. 150ft range. It must be loaded, and aimed at a target that '
          + 'hasn\'t moved since.', operate('1 AP and both arms')] },
      reload: { name: 'Reload the Ballista', ap: 0, img: 'icons/weapons/ammunition/arrows-bodkin-yellow-red.webp',
        text: ['Load a bolt into the ballista.', operate('1 AP and both arms')] },
    },
  });
  ballista.prototypeToken.texture.src = 'icons/weapons/artillery/ballista-wood-green.webp';
  const fixedBallista = npc('fixed_ballista', {
    name: 'Fixed Ballista', icon: 'icons/weapons/artillery/ballista-wood-green.webp', folder: F.props._id, sort: 200,
    role: 'Siege engine', size: 'large', hp: 1, ap: 0, speed: 0, checkDc: 10, linked: true, disposition: DISPOSITION.neutral, ownership: OWNER,
    defenses: { ad: 10, pd: 10, td: 10, md: 10, dr: 0 }, stats: { power: 0, finesse: 8, wiles: 0, courage: 0, fate: 0 },
    biography: p('The wagon-mounted ballista south of the wall (map key 4). It cannot be aimed — it only points at the pit trap — and can '
      + 'only be fired once. It begins the one-shot loaded. If an enemy deals damage to it, it breaks.'),
    abilities: {
      fire: { name: 'Fire the Fixed Ballista', ap: 0, usage: { per: 'combat', max: 1 }, img: 'icons/weapons/ammunition/arrow-broadhead-glowing-orange.webp',
        attack: { category: 'ranged', defense: 'pd', toHit: 8, damage: '12d10', type: 'piercing' },
        text: ['To-Hit 1D20+8 against PD; deals 12D10 Piercing Damage if it hits. It only fires at a creature at the pit trap, and only once.',
          operate('1 AP and both arms')] },
    },
  });
  fixedBallista.prototypeToken.texture.src = 'icons/weapons/artillery/ballista-wood-green.webp';
  const oil = npc('oil_barrel', {
    name: 'Oil Barrel', icon: 'icons/containers/barrels/barrel-drum-steel-oil.webp', folder: F.props._id, sort: 300,
    role: 'Hazard', size: 'medium', hp: 1, ap: 0, speed: 0, checkDc: 10, linked: false, disposition: DISPOSITION.neutral, ownership: OWNER,
    defenses: { ad: 10, pd: 10, td: 10, md: 10, dr: 0 }, stats: { power: 0, finesse: 0, wiles: 0, courage: 0, fate: 0 },
    biography: p('Barrels of oil on the wall and by the picnic table (map key 2). Pour one down on creatures below the wall or onto the ground. '
      + 'If oil is poured on a creature and they are then set alight with a torch, that creature immediately takes 6D10 Fire Damage.'),
    abilities: {
      pour: { name: 'Pour Oil', ap: 0, img: 'icons/magic/acid/pouring-gas-smoke-liquid.webp',
        text: ['Pour the barrel down onto a creature below the wall, or onto the ground. The creature (or the ground) is soaked in oil until it '
          + 'burns. Each barrel can be poured once.', operate('1 AP and both arms')] },
      ignite: { name: 'Ignite', ap: 0, img: 'icons/magic/fire/flame-burning-campfire-orange.webp',
        attack: { category: 'ranged', defense: 'pd', autoHit: true, damage: '6d10', type: 'fire' },
        text: ['When an oil-soaked creature is set alight with a torch, it immediately takes 6D10 Fire Damage. Target it and use this when the '
          + 'torch lands (lighting or throwing the torch is the crew member\'s action).', 'The rulebook\'s Fire in Combat rules (p.246) cover '
          + 'what happens to burning ground afterwards.'] },
    },
  });
  oil.prototypeToken.texture.src = 'icons/containers/barrels/barrel-drum-steel-oil.webp';
  const pit = npc('pit_trap', {
    name: 'Pit Trap', icon: 'icons/environment/traps/pressure-plate.webp', folder: F.props._id, sort: 400,
    role: 'Hazard', size: 'medium', hp: 1, ap: 0, speed: 0, checkDc: 18, linked: true, disposition: DISPOSITION.friendly,
    defenses: { ad: 10, pd: 10, td: 10, md: 10, dr: 0 }, stats: { power: 0, finesse: 0, wiles: 0, courage: 0, fate: 0 },
    biography: p('A covered pit on the road south of the camp (map key 5, the grate). A demon that makes it this far falls in, taking 3D10 damage, '
      + 'then makes Finesse Checks against 5 levels of Pin (if it can take Pin). Check DC 18 negates.',
    'On the scene, two Regions over the road spring it automatically when an enemy token enters: one deals the 3D10 and one posts the '
      + 'Finesse Check card (DC 18, this actor\'s Check DC). Disable the Regions\' behaviors once it has sprung.'),
    abilities: {},
  });
  pit.prototypeToken.texture.src = 'icons/environment/traps/pressure-plate.webp';
  const wall = npc('chunis_wall', {
    name: 'Chuni\'s Wall', icon: 'icons/environment/settlement/city-wall.webp', folder: F.props._id, sort: 500,
    role: 'Terrain', size: 'medium', hp: 1, ap: 0, speed: 0, checkDc: 10, linked: true, disposition: DISPOSITION.friendly,
    defenses: { ad: 10, pd: 10, td: 10, md: 10, dr: 0 }, stats: { power: 0, finesse: 0, wiles: 0, courage: 0, fate: 0 },
    biography: p('Chuni\'s Wall: a fortified stone wall about 40ft tall. This actor only anchors the scene\'s <strong>Wall Top</strong> Region: '
      + 'friendly creatures standing on the walkway or the ballista tower have Height (1X advantage on attacks against creatures below). '
      + 'Its hidden token sits in the east gatehouse; leave it there.'),
    abilities: {},
  });
  wall.prototypeToken.texture.src = 'icons/environment/settlement/city-wall.webp';

  const actors = [...heroes, wanabbul, grubnut, csenorras, swarm1, swarm2, weaver, weaverspool, ballista, fixedBallista, oil, pit, wall];
  const actorId = Object.fromEntries(actors.map((a) => [a.name, a._id]));

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Journal                                                                                                    */
  /* ---------------------------------------------------------------------------------------------------------- */

  const sceneId = id('scene', 'chunis-wall');
  const worldId = id('scene', 'ardus-yauga');
  const tableId = id('table', 'which-demon');
  kit.register('scene', 'chunis-wall', `Scene.${sceneId}`, 'Chuni\'s Wall');
  kit.register('scene', 'ardus-yauga', `Scene.${worldId}`, 'The Ardus Yauga');
  kit.register('table', 'which-demon', `RollTable.${tableId}`, 'Which Demon Attacks?');
  kit.register('manual', 'manual', `Compendium.sacadia.user-manual.JournalEntry.${kit.packId('user-manual', 'manual')}`, 'Sacadia User Manual');

  const JOURNALS = [
    { key: 'gm', name: 'The Breach — GM Guide', dir: 'gm', ownership: NONE, sort: 100 },
    { key: 'players', name: 'The Breach — Player Handouts', dir: 'players', ownership: OBSERVER, sort: 200 },
  ];
  // Register every page first so pages can link to each other.
  const pageFiles = {};
  for (const j of JOURNALS) {
    const entryId = id('journal', j.key);
    kit.register('journal', j.key, `JournalEntry.${entryId}`, j.name);
    pageFiles[j.key] = fs.readdirSync(path.join(HERE, 'journal', j.dir)).filter((f) => f.endsWith('.md')).sort();
    for (const f of pageFiles[j.key]) {
      const slug = f.replace(/^\d+-|\.md$/g, '');
      const title = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(HERE, 'journal', j.dir, f), 'utf8'))?.[1] ?? slug;
      kit.register('page', `${j.key}/${slug}`, `JournalEntry.${entryId}.JournalEntryPage.${id('page', j.key, slug)}`, title);
    }
  }
  const journal = JOURNALS.map((j) => {
    const entryId = id('journal', j.key);
    const pages = pageFiles[j.key].map((f, i) => {
      const slug = f.replace(/^\d+-|\.md$/g, '');
      const { title, html } = kit.markdown(fs.readFileSync(path.join(HERE, 'journal', j.dir, f), 'utf8').replaceAll('{{asset}}', asset('')));
      return { _id: id('page', j.key, slug), name: title || slug, type: 'text', sort: (i + 1) * 100000,
        title: { show: true, level: 1 }, text: { format: 1, content: html }, ownership: { default: -1 }, flags: {} };
    });
    return { _id: entryId, name: j.name, folder: F.journal._id, sort: j.sort, pages, ownership: { default: j.ownership }, flags: { sacadia: { adventure: 'the-breach' } } };
  });
  const pageId = (j, slug) => id('page', j, slug);

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Scene: Chuni's Wall                                                                                        */
  /* ---------------------------------------------------------------------------------------------------------- */

  // Two Scene Levels (battlefield.mjs): the Ground, and the Wall Top 40ft up. Each sees the other; their walls differ.
  const GROUND = id('level', 'ground');
  const TOP = id('level', 'wall-top');
  const HEIGHT = 40;
  // v14 checks a sightline between levels against each level's walls only along the stretch of it inside that level's
  // elevation range, and walls are as tall as their level. Ending the Ground at head height means a defender looking
  // down from 40ft meets ground walls only in the last eighth of the line, where it drops below 5ft. So the defenders
  // see over the wall they stand on (otherwise its faces, which surround them on the Ground, hide everything) and over
  // the tents, except something tucked right behind one. Tokens still change level to 0ft and 40ft.
  const GROUND_TOP = 5;
  // Placeables live in canvas coordinates, which include the scene's padding around the map (Foundry's square-grid
  // formula: padding × size, rounded up to whole squares). X()/Y() turn map pixels into canvas coordinates.
  const PADDING = 0.1;
  const pad = (size) => Math.ceil((PADDING * size) * (1 / GRID)) * GRID;
  const OFF = { x: pad(sq(MAP.cols)), y: pad(sq(MAP.rows)) };
  const X = (x) => OFF.x + x;
  const Y = (y) => OFF.y + y;
  const tok = (actor, key, c, r, extra = {}) => {
    const proto = actor.prototypeToken;
    return { _id: id('token', key), ...structuredClone(proto), actorId: actor._id, x: X(sq(c)), y: Y(sq(r)), level: GROUND, elevation: 0, ...extra };
  };
  const onTop = { level: TOP, elevation: HEIGHT };
  const pitToken = tok(pit, 'pit-trap', 10, 40, { hidden: true });
  const wallToken = tok(wall, 'chunis-wall', 19, 17, { hidden: true, ...onTop });
  const tokens = [
    tok(heroes[0], 'selthimor', 2, 6, onTop), tok(heroes[1], 'chunrudar', 4, 9, onTop),
    tok(heroes[2], 'honnasusara', 7, 17, onTop), tok(heroes[3], 'manchuthara', 17, 17, onTop),
    tok(wanabbul, 'wanabbul', 8, 0),
    tok(ballista, 'wall-ballista', 4, 6, { width: 2, height: 2, ...onTop }),
    tok(fixedBallista, 'fixed-ballista', 2, 31, { width: 2, height: 2 }),
    tok(oil, 'oil-west', 5, 16, onTop), tok(oil, 'oil-east', 16, 16, onTop), tok(oil, 'oil-camp', 10, 29),
    pitToken, wallToken,
  ];
  const tokenUuid = (t) => `Scene.${sceneId}.Token.${t._id}`;
  const rect = (c, r, w, h) => ({ type: 'rectangle', x: X(sq(c)), y: Y(sq(r)), width: sq(w), height: sq(h), rotation: 0, hole: false });
  const pxRect = ([x0, y0, x1, y1]) => ({ type: 'rectangle', x: X(x0), y: Y(y0), width: x1 - x0, height: y1 - y0, rotation: 0, hole: false });
  const zone = (name, effect, caster, casterToken) => ({ _id: id('behavior', name), type: 'zone', name, disabled: false,
    system: { casterUuid: `Actor.${caster._id}`, casterTokenUuid: tokenUuid(casterToken), ability: '', label: name, effect } });
  // Core Display Scrolling Text: shown to everyone when a token's movement animation enters the Region. Its own `once`
  // option throws in Foundry 14.364 (it calls `includedInLevel` on the behavior instead of its Region) and the text never
  // shows, so "once" is a core Toggle Behavior that switches the text off when the token leaves the Region.
  const scrolling = (key, text, color) => ({ _id: id('behavior', 'text', key), type: 'displayScrollingText', name: text, disabled: false,
    system: { events: ['tokenAnimateIn'], text, color, visibility: 2, once: false } });
  const onceOnly = (regionKey, textKey) => ({ _id: id('behavior', 'once', textKey), type: 'toggleBehavior', name: 'Show it once', disabled: false,
    system: { events: ['tokenExit'], enable: [],
      disable: [`Scene.${sceneId}.Region.${id('region', regionKey)}.RegionBehavior.${id('behavior', 'text', textKey)}`] } });
  const region = (key, name, color, shapes, behaviors, levels) => ({ _id: id('region', key), name, color, shapes, behaviors, visibility: 0,
    elevation: { bottom: null, top: null, topInclusive: false }, levels, restriction: { enabled: false, type: 'move', priority: 0 },
    highlightMode: 'shapes', displayMeasurements: false, hidden: false, locked: false, flags: {} });
  const regions = [
    region('wall-top', 'Wall Top (Height)', '#3f6fb5', [rect(0, 16, 20, 3), rect(2, 6, 4, 10)],
      [zone('Wall Top', { insideStatus: 'height', affects: 'allies' }, wall, wallToken)], [TOP]),
    region('pit-damage', 'Pit Trap (fall)', '#8c1d18', [rect(9, 39, 3, 3)],
      [zone('Pit Trap', { damage: '3d10', affects: 'enemies', onTurnStart: false }, pit, pitToken),
        scrolling('pit', 'The ground gives way!', '#ff6b4a')], [GROUND]),
    // The wall holds back the mist of the Upper Heibrim: no fog south of it.
    region('clear-of-fog', 'Clear of the Mist', '#7fa6d9', [pxRect(CLEAR_OF_FOG)],
      [{ _id: id('behavior', 'clear-of-fog'), type: 'suppressWeather', name: 'Clear of the Mist', disabled: false, system: {} }], [GROUND, TOP]),
    region('fog-line', 'The Fog Line', '#7fa6d9', [pxRect(FOG_LINE)],
      [scrolling('fog-line', 'A shape looms out of the mist…', '#cfd8ff'), onceOnly('fog-line', 'fog-line')], [GROUND]),
    region('pit-pin', 'Pit Trap (pinned)', '#8c1d18', [rect(9, 39, 3, 3)],
      [zone('Pit Trap (Pin)', { check: { trait: 'finesse', inflict: [{ condition: 'pinned', level: 5 }] }, affects: 'enemies', onTurnStart: false }, pit, pitToken)], [GROUND]),
    // Core Change Level behaviors: the stairs for any movement; the hay and the tents only when jumping down.
    ...LEVEL_CHANGES.map((c) => region(c.key, c.name, '#c9a227', [pxRect(c.rect)],
      [{ _id: id('behavior', c.key), type: 'changeLevel', name: c.name, disabled: false, system: { movementActions: c.actions } }], [GROUND, TOP])),
  ];
  // Tokens record the Regions they start in (`_regions`); without it Foundry fires no exit event on their first move
  // off the wall, and the Height a defender starts with would stick.
  const center = (t) => ({ x: t.x + (t.width * GRID) / 2, y: t.y + (t.height * GRID) / 2 });
  const contains = (rg, pt) => rg.shapes.some((sh) => pt.x >= sh.x && pt.x < sh.x + sh.width && pt.y >= sh.y && pt.y < sh.y + sh.height);
  for (const t of tokens) t._regions = regions.filter((rg) => contains(rg, center(t)) && (!rg.levels.length || rg.levels.includes(t.level))).map((rg) => rg._id);

  // Walls: each polyline becomes segments on its level. The front gate is a locked door.
  const walls = [];
  for (const [level, list] of [[GROUND, GROUND_WALLS], [TOP, TOP_WALLS]]) {
    list.forEach((w, i) => w.points.slice(1).forEach((pt, j) => {
      const [a, b] = [w.points[j], pt];
      walls.push({ _id: id('wall', level, i, j), c: [X(a[0]), Y(a[1]), X(b[0]), Y(b[1])], levels: [level], ...KINDS[w.kind], dir: 0,
        door: w.door ? 1 : 0, ds: w.door ? 2 : 0, flags: w.breach ? { sacadia: { breach: true } } : {} });
    }));
  }

  // Ambient lights (battlefield.mjs): glyphs on every level, torches on the wall top, lanterns in the camp.
  const lights = LIGHTS.map((l, i) => ({ _id: id('light', i), name: `${l.kind[0].toUpperCase()}${l.kind.slice(1)}`, x: X(l.at[0]), y: Y(l.at[1]),
    elevation: l.top ? HEIGHT : 0, levels: l.top ? [TOP] : [], rotation: 0, walls: true, vision: false, hidden: false, locked: false,
    config: { ...LIGHT_KINDS[l.kind], angle: 360, coloration: 1, saturation: 0, contrast: 0, shadows: 0, negative: false, priority: 0,
      darkness: { min: 0, max: 1 } }, flags: {} }));

  const note = (key, c, r, page, text, icon) => ({ _id: id('note', key), entryId: id('journal', 'gm'), pageId: pageId('gm', page),
    x: X(sq(c) + GRID / 2), y: Y(sq(r) + GRID / 2), texture: { src: icon }, iconSize: 48, text, fontSize: 24, textAnchor: 1, global: false, flags: {} });
  const notes = [
    note('ballista', 6, 7, 'battlefield', '1 · Ballista', 'icons/svg/target.svg'),
    note('oil', 6, 15, 'battlefield', '2 · Oil Barrels', 'icons/svg/fire.svg'),
    note('hay', 13, 21, 'battlefield', '3 · Hay', 'icons/svg/falling.svg'),
    note('tents', 3, 23, 'battlefield', '3 · Tents', 'icons/svg/falling.svg'),
    note('fixed-ballista', 4, 33, 'battlefield', '4 · Fixed Ballista', 'icons/svg/target.svg'),
    note('pit', 12, 40, 'battlefield', '5 · Pit Trap', 'icons/svg/trap.svg'),
    note('start', 0, 5, 'running-the-encounter', 'Starting positions', 'icons/svg/book.svg'),
  ];
  const scene = {
    _id: sceneId, name: 'Chuni\'s Wall', navName: 'The Breach', folder: F.scenes._id, sort: 100, navigation: true, navOrder: 1,
    thumb: asset(MAP.thumb),
    width: sq(MAP.cols), height: sq(MAP.rows), padding: PADDING,
    levels: [
      { _id: GROUND, name: 'Ground', sort: 100, elevation: { bottom: null, top: GROUND_TOP }, background: { src: asset(MAP.file), color: '#1b1f1a' },
        visibility: { levels: [TOP] } },
      { _id: TOP, name: 'Wall Top', sort: 200, elevation: { bottom: HEIGHT, top: null }, background: { src: null, color: '#1b1f1a' },
        visibility: { levels: [GROUND] } },
    ],
    initialLevel: TOP,
    initial: { x: X(sq(10)), y: Y(sq(12)), scale: 0.6 },
    grid: { type: 1, size: GRID, distance: 5, units: 'ft', color: '#000000', alpha: 0.15 },
    // Line of sight: the players see what their heroes see (the GM sees everything). Turn Token Vision off in the scene
    // settings to share the whole map.
    tokenVision: true, fog: { mode: 0 },
    // Night on the wall, graded cold blue. Dim "moonlight" everywhere keeps everyone visible within line of sight; the
    // glyphs, torches and lanterns make the bright pools.
    environment: { darknessLevel: 0.9, darknessLock: false, cycle: true,
      globalLight: { enabled: true, bright: false, color: null, alpha: 0, coloration: 1, luminosity: 0, saturation: 0, contrast: 0, shadows: 0,
        darkness: { min: 0, max: 1 } },
      dark: { hue: 220 / 360, intensity: 0.3, luminosity: -0.45, saturation: -0.2, shadows: 0.2 } },
    weather: 'fog',
    journal: id('journal', 'gm'), journalEntryPage: pageId('gm', 'battlefield'),
    tokens, regions, notes, walls, lights, drawings: [], sounds: [], tiles: [],
    ownership: { default: NONE },
    flags: { sacadia: { adventure: 'the-breach',
      // Read by the Breach Chuni's Wall macro.
      breach: { ground: GROUND, top: TOP, north: Y(WALL.north), south: Y(WALL.south), topNorth: Y(WALL.topNorth), topSouth: Y(WALL.topSouth), kinds: KINDS } } },
  };

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Scene: the prologue's world map (prologue.mjs)                                                             */
  /* ---------------------------------------------------------------------------------------------------------- */

  // The Ardus Yauga, for an optional opening on the road to the wall. Its two routes are Indy Route's (scene flags, as
  // its Route Manager saves them). The Travel Ledger moves the party (a token of its own, at Tianqis) along the road a day
  // at a time. The Prologue macro files the area in Augur: Nexus through its API: the map as the Nexus scene, Chuni's
  // Wall as a site that opens the battle map, and the organizations, people and quest in nexus.mjs. Without the modules
  // it's a map to talk over, and the ledger still moves the token.
  const WORLD_LEVEL = id('level', 'ardus-yauga');
  const xy = ([x, y]) => ({ x, y });
  const route = (key, name, points, settings) => ({ id: id('route', key), name, points: points.map(xy), settings, createdAt: 0, updatedAt: 0 });
  // The party marker: a token with no actor, so no hero's conditions or bars ride along on the map. 30 px, where a day
  // on foot is about 32 px.
  const PARTY_SIZE = 0.3;
  const partyToken = { _id: id('token', 'world-party'), name: 'The Party', actorId: null, actorLink: false,
    texture: { src: 'icons/environment/people/group.webp' }, width: PARTY_SIZE, height: PARTY_SIZE,
    x: ROAD[0][0] - (PARTY_SIZE * WORLD_GRID.size) / 2, y: ROAD[0][1] - (PARTY_SIZE * WORLD_GRID.size) / 2,
    level: WORLD_LEVEL, elevation: 0, disposition: 1, displayName: 30, displayBars: 0, lockRotation: true, _regions: [], flags: {} };
  // What the macro files in Nexus, built here (Markdown, actor links) for it to read from the scene's flags.
  const actorOf = (key) => actors.find((a) => a._id === id('actor', key));
  const html = (md) => kit.markdown(md).html;
  const nexus = {
    factions: FACTIONS.map(({ md, ...f }) => ({ ...f, html: html(md) })),
    people: PEOPLE.map(({ md, actor, ...p }) => {
      const a = actor ? actorOf(actor) : null;
      return { ...p, name: p.name ?? a.name, img: p.img ?? a.img, actorUuid: a ? `Actor.${a._id}` : null, html: html(md) };
    }),
    quest: { ...QUEST, md: undefined, image: asset(QUEST.image), html: html(QUEST.md) },
  };
  const worldScene = {
    _id: worldId, name: 'The Ardus Yauga', navName: 'Prologue', folder: F.scenes._id, sort: 50, navigation: true, navOrder: 0,
    thumb: asset(WORLD.thumb), width: WORLD.width, height: WORLD.height, padding: 0,
    levels: [{ _id: WORLD_LEVEL, name: 'The Ardus Yauga', sort: 100, elevation: { bottom: null, top: null },
      background: { src: asset(WORLD.file), color: '#c8d3c4' }, visibility: { levels: [] } }],
    initialLevel: WORLD_LEVEL,
    initial: { x: WORLD.width / 2, y: WORLD.height / 2, scale: 0.5 },
    grid: { type: 0, size: WORLD_GRID.size, distance: WORLD_GRID.miles, units: 'mi', color: '#000000', alpha: 0 },
    tokenVision: false, fog: { mode: 0 },
    environment: { darknessLevel: 0, darknessLock: true, cycle: false },
    journal: id('journal', 'gm'), journalEntryPage: pageId('gm', 'prologue'),
    notes: [], tokens: [partyToken], regions: [], walls: [], lights: [], drawings: [], sounds: [], tiles: [],
    ownership: { default: NONE },
    flags: {
      sacadia: { adventure: 'the-breach',
        // Read by the Prologue macro: the routes, where the Nexus site goes, and what it files in Nexus.
        prologue: { road: id('route', 'road'), smoke: id('route', 'smoke'),
          site: { name: 'Chuni\'s Wall', x: WALL_FORT[0], y: WALL_FORT[1], iconSize: 48 }, nexus },
        // The Travel Ledger's journey (apps/travel-ledger.mjs), ready on the road.
        travel: { ...JOURNEY, routeId: id('route', 'road'), tokenId: partyToken._id, travelled: 0, log: [] } },
      'indy-route': { routes: [
        route('road', 'The Road to the Wall', ROAD, ROAD_STYLE),
        route('smoke', 'Smoke Along the Wall', SMOKE, SMOKE_STYLE),
      ] },
    },
  };

  // The fight, ready in the Combat Tracker in the one-shot's turn order (the heroes 4 → 1, Wanabbul after them): the GM
  // only presses Begin Combat.
  const combatant = (t, initiative) => ({ _id: id('combatant', t._id), actorId: t.actorId, tokenId: t._id, sceneId, initiative, hidden: false,
    defeated: false, flags: {} });
  const combat = { _id: id('combat', 'the-breach'), name: 'The Breach', scene: sceneId, active: true, round: 0, turn: null, sort: 0, flags: {},
    combatants: [combatant(tokens[0], 4), combatant(tokens[1], 3), combatant(tokens[2], 2), combatant(tokens[3], 1), combatant(tokens[4], 0)] };

  // The GM's macro for the moment the demon smashes through.
  F.macros = folder('macros', 'The Breach', 'Macro', null, 0, '#2f4f8f');
  const macros = [{ _id: id('macro', 'breach'), name: 'Breach Chuni\'s Wall', type: 'script', scope: 'global', folder: F.macros._id,
    img: 'icons/environment/settlement/building-rubble.webp', command: fs.readFileSync(path.join(HERE, 'macros', 'breach-the-wall.js'), 'utf8'),
    ownership: { default: NONE }, flags: { sacadia: { adventure: 'the-breach' } } },
  // The prologue: the world map for everyone, and the area filed in Augur: Nexus.
  { _id: id('macro', 'prologue'), name: 'Prologue: The Ardus Yauga', type: 'script', scope: 'global', folder: F.macros._id, sort: -2,
    img: 'icons/tools/navigation/map-chart-tan.webp', command: fs.readFileSync(path.join(HERE, 'macros', 'prologue.js'), 'utf8'),
    ownership: { default: NONE }, flags: { sacadia: { adventure: 'the-breach' } } },
  // The Travel Ledger, for the scene in view.
  { _id: id('macro', 'travel-ledger'), name: 'Travel Ledger', type: 'script', scope: 'global', folder: F.macros._id, sort: -1,
    img: 'icons/tools/navigation/compass-brass-blue-red.webp',
    command: '// The Travel Ledger: Sacadia\'s travel rules a day at a time, for the party on the scene you\'re viewing (the GM).\ngame.sacadia.travelLedger(canvas.scene);\n',
    ownership: { default: NONE }, flags: { sacadia: { adventure: 'the-breach' } } }];

  /* ---------------------------------------------------------------------------------------------------------- */
  /*  Roll table: the full one-shot draws its demon at random                                                    */
  /* ---------------------------------------------------------------------------------------------------------- */

  const result = (n, actor) => ({ _id: id('result', n), type: 'document', name: actor.name, img: actor.img,
    documentUuid: `Actor.${actor._id}`, range: [n, n], weight: 1, drawn: false, description: '', flags: {} });
  const table = {
    _id: tableId, name: 'Which Demon Attacks?', img: 'icons/svg/d20-grey.svg', folder: F.tables._id, sort: 100,
    description: p('The full one-shot pits the defenders against a randomly chosen demon. The introductory variant always uses Wanabbul; '
      + 'the others are each harder than the last. The pregens are balanced around Wanabbul.'),
    formula: '1d4', replacement: true, displayRoll: true,
    results: [result(1, wanabbul), result(2, grubnut), result(3, csenorras), result(4, weaver)],
    ownership: { default: NONE }, flags: {},
  };

  /* ---------------------------------------------------------------------------------------------------------- */

  const looseItems = [
    ...Object.keys(SUPPLIES).map((k) => ({ ...local(null, k, SUPPLIES), folder: F.supplies._id })),
  ];

  return {
    _id: id('adventure'),
    name: 'The Breach',
    img: asset('cover.webp'),
    caption: '<p>A level-5 combat one-shot on Chuni\'s Wall, for four players — by Connor Brashar, converted to Sacadia\'s Art of War v1.2.</p>',
    description: p('Chuni\'s Wall is a pale and desolate place. Your station here is an isolated and cold one, as you watch northward into the '
      + 'Upper Heibrim. Demons prowl the lands north of here. You have seen them in the night. They wander aimlessly, forever hungering '
      + 'for the flesh of humanity — hungry for you. It is a quiet and tense post. Until it isn\'t.',
    '<strong>Contents:</strong> a world map for an optional prologue on the road to the wall; the Chuni\'s Wall battle map with tokens, '
      + 'siege engines and an automated pit trap; four pregenerated '
      + 'level-5 Tianqi wall guards; Wanabbul the Vast and three optional demons; and a GM guide and player handouts.'),
    sort: 0,
    folders: Object.values(F),
    actors,
    items: looseItems,
    journal,
    scenes: [worldScene, scene],
    tables: [table],
    macros, cards: [], playlists: [], combats: [combat],
    flags: { sacadia: { adventure: 'the-breach', actorIds: actorId } },
  };
}
