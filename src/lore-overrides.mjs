/**
 * Build overrides for the Lore abilities (book v1.2 pp.168–177 and the ancestry Lore uses on pp.32–64; source text in
 * src/lore.json), keyed by catalogId like the maps in src/modifiers.mjs, which merges them in. A Lore ability costs one
 * Lore point (`costs.lore`, set by the build) and, when marked L, no AP, Boost, Reaction or Focus (p.168). Lore Boosts
 * ride the next matching action for free and charge their point when consumed. Anything not listed is descriptive (see
 * the Lore section of docs/coverage-ledger.md for why).
 */

const NO_ATTACK = { category: '', trait: '', defense: '' };
const save = (trait, inflict = [], { damage = [], onSuccess = 'none', ext = {} } = {}) => ({
  type: 'save', label: '', attack: NO_ATTACK, save: { trait, dc: null, onSuccess, ext }, damage, inflict,
});
const dmg = (count, denomination, trait = '') => ({ count: String(count), denomination, formula: '', trait, type: '' });
const flat = (formula) => ({ count: '', denomination: null, formula, trait: '', type: '' });
const inf = (condition, amount, extra = {}) => ({ condition, amount: String(amount), ...extra });
const when = (...atoms) => atoms.map((atom) => ({ atom }));
const ch = (key, value) => ({ key, mode: 2, value: String(value) });
const self = (label, changes, duration) => ({ scope: 'self', label, duration, changes });
const TURN_END = { type: 'consumed', on: 'turnEnd' };
const NEXT_TURN = { type: 'rounds', rounds: 1 };
/** A Lore Boost: free (outside the one-Boost limit), one Lore point when it's spent. */
const loreBoost = (appliesTo, extra = {}, special = {}) => ({ appliesTo, ...extra, special: { free: true, onConsume: { lore: 1 }, ...special } });

export const LORE = {
  activity: {
    // "They make an Adversarial Power Check against X levels of 'Kick' (X = Proficiency). For each level they take,
    // they take 2D6 damage and are knocked back 5ft. If they take any levels, they are knocked Prone." (Push: GM.)
    lore_sealslam: [save('power', [], { ext: { checks: '@proficiency', perFailDie: 6, perFailCount: 2, onFail: { status: 'prone' } } })],
    // "All enemies within 10 feet … make a Power Check … or take XD10 (X = Proficiency) and are knocked prone. If they
    // pass the check, they take half damage."
    lore_bearmaul: [save('power', [inf('prone', 1)], { damage: [dmg('@proficiency', 10)], onSuccess: 'half' })],
    // "all creatures within the radius … take elemental damage … XD12, where X is half your Proficiency (Power Check
    // halves)." The year-long difficult terrain is the GM's.
    lore_heavy_bloom: [save('power', [], { damage: [dmg('ceil(@proficiency/2)', 12)], onSuccess: 'half' })],
    // "All enemies within 10 feet of those points must make a Finesse Check or take XD8 (X = Proficiency)."
    lore_howl_of_the_beast: [save('finesse', [], { damage: [dmg('@proficiency', 8)] })],
    // "Make a melee weapon attack against a number of enemies … up to your Proficiency" (one per targeted creature).
    lore_bladeslam: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: '' }, save: { trait: '', dc: null }, damage: [], inflict: [] }],
    // "Every enemy within 60ft … makes a Finesse Check. On a failed check, they take X piercing damage (X = half your
    // Proficiency rounded up, times the number of enemies within 60ft)" — target them all.
    lore_every_enemy: [save('finesse', [], { damage: [flat('ceil(@proficiency/2) * @targetCount')] })],
    // "immediately deal 5M damage to X enemies within 60ft" (no to-hit).
    lore_webcraft: [{ type: 'attack', label: '', attack: { category: 'magic', trait: '', defense: 'md' }, save: { trait: '', dc: null },
      damage: [flat('5 * @madness')], inflict: [], autoHit: true }],
    // "Every enemy within 30ft … makes a Wiles Check … If they fail, they are knocked Prone and given Surprise."
    lore_shockflock: [save('wiles', [inf('prone', 1), inf('surprised', 1)])],
    // "They are pushed back 5Xft … and take 2D6 damage per 5ft moved. They are knocked Prone." The full push; the GM
    // trims the damage if they're stopped short.
    lore_kickbuck: [{ type: 'damage', label: '', attack: NO_ATTACK, save: { trait: '', dc: null }, damage: [dmg('2*@proficiency', 6)], inflict: [] }],
    // "Deal XD10 damage to that target (X = Proficiency), then exhaust that limb until all levels of Pin end."
    lore_bonebreaker: [{ type: 'damage', label: '', attack: NO_ATTACK, save: { trait: '', dc: null }, damage: [dmg('@proficiency', 10)], inflict: [] }],
    // "Creatures may make a Wiles Check against this effect … All attacks made against targets affected by Foment are
    // made at 1X advantage."
    lore_foment: [save('wiles', [], { ext: { grantOnFail: true } })],
  },
  onUse: {
    // "gain 1/3 of your Max HP (rounded up)" (use it when you would drop below 0).
    lore_still_up: { self: [], target: [], selfGain: { hp: 'ceil(@hpMax/3)', ap: '', lore: '' } },
    lore_royal_recovery: { self: [], target: [], selfGain: { hp: '', ap: 'ceil(@apMax/2)', lore: '' } },
    // "If you have no lore points, you immediately gain a Lore Point … Additionally, gain a Bane Token" (the token: GM).
    lore_cursed_contract: { self: [], target: [], selfGain: { hp: '', ap: '', lore: '1' } },
    // "fade into the shadows and disappear … No one may make an attack on you until the start of your next turn".
    lore_stealthy_step: { self: [inf('hidden', 1)], target: [] },
    // "Give all unique enemies within 120ft of you Fumble equal to your level" (target them; no check).
    lore_home_advantage: { self: [], target: [inf('fumbled', '@level')] },
    // "give 2D6 Fumble to X targets … 2D8 at level 5, and 2D10 at level 11" (no check; rolled per target).
    lore_fateful_fumble: { self: [], target: [
      inf('fumbled', '2d6', { predicate: when('self:level<5') }),
      inf('fumbled', '2d8', { predicate: when('self:level>=5', 'self:level<11') }),
      inf('fumbled', '2d10', { predicate: when('self:level>=11') }),
    ] },
    // "removing all conditions from the chosen target except those caused by the environment."
    lore_inspire_greatness: { self: [], target: [inf('*adversarial', -6), ...['prone', 'blinded', 'dragged', 'surprised'].map((c) => inf(c, -1))] },
    // "You and all allies within 5ft of you have full cover until the start of your next turn" (target yourself too).
    lore_shield_wall: { self: [], target: [], cover: 'full' },
    lore_deathlock: { self: [], target: [], enduring: 'pinned' },
    lore_kickbuck: { self: [], target: [inf('prone', 1)] },
    lore_dim_the_room: { self: [], target: [inf('blinded', 1)] },
    lore_blot_the_skies: { self: [], target: [inf('blinded', 1)] },
    lore_bonebreaker: { self: [], target: [], exhaust: '@choice' },
    // Prone Gutting: "exhaust a random limb on that target for the remainder of combat".
    lore_prone_gutting: { self: [], target: [], exhaustRandomCombat: true },
    // Call to Recovery: "You and all allies within 15ft of you recover up to X expended Action Pool points (X = ½
    // Proficiency, rounded up)" — each picks the pool.
    lore_call_to_recovery: { self: [], target: [], poolRefund: 'ceil(@proficiency/2)', refundSelf: true },
    // "Increase your Madness by X, where X is half your Proficiency, rounded up" (only while Insane).
    lore_unhinge: { self: [inf('madness', 'ceil(@proficiency/2)')], target: [] },
    // "Change your Madness to any number between 0 and 7 now."
    lore_gods_eye: { self: [inf('madness', '@spent - @madness')], target: [] },
  },
  grant: {
    // "Until the end of your turn, any attack you attempt that would miss hits instead."
    lore_infallible: self('Infallible', [ch('system.bonuses.autoHit', 1)], TURN_END),
    // Fatebound: "Until the start of your next turn".
    lore_fb_infallible: self('Infallible', [ch('system.bonuses.autoHit', 1)], NEXT_TURN),
    lore_no_holds_barred: self('No Holds Barred', [ch('system.bonuses.dieStep', 2)], TURN_END),
    // "all enemy attacks would miss you even if they would hit until the start of your next turn."
    lore_masterful_stepping: self('Masterful Stepping', [ch('system.bonuses.untouchable', 1)], NEXT_TURN),
    // "a blood rage for up to X rounds (X = Proficiency) … add Power + Fate to all damage you deal through attacks."
    lore_bloodrage: self('Bloodrage', [ch('system.bonuses.damage.all', '@power + @fate')], { type: 'rounds', roundsFormula: '@proficiency' }),
    // "Until the end of your turn, all Hemorrhage you give stacks with other levels a target might have."
    lore_toxic_touch: self('Toxic Touch', [ch('system.bonuses.stacksGiven.hemorrhage', 1)], TURN_END),
    // "For each enemy given Fumble this way, you gain +1 to all To-Hits you make for the remainder of this turn."
    lore_home_advantage: self('Home Advantage', [ch('system.bonuses.toHit.all', '@targetCount')], TURN_END),
    // Foment (on those who fail, for the next minute ≈ 10 rounds): attacks against them at 1× advantage.
    lore_foment: { scope: 'allies', label: 'Foment', duration: { type: 'rounds', rounds: 10 }, changes: [ch('system.bonuses.incomingAdvantage', 1)] },
    // "Until the start of your next turn, you and all of allies within 15ft of you gain X DR and add X to all Trait
    // Checks, where X is your Proficiency" (target yourself too).
    // Corrupting Touch: "Until the end of your turn, if you roll a Prime number on a D20 … treat it as a critical hit …
    // do not treat Nat20s rolled as Critical Hits. Also, your weapon damage changes to elemental damage (of your Font's)".
    lore_corrupting_touch: self('Corrupting Touch', [ch('system.bonuses.primeCrits', 1), ch('system.bonuses.weaponElement.<pick>', 1)], TURN_END),
    // Explosive Rage: "make all your attacks for the remainder of your turn do maximum damage if they successfully hit.
    // Immediately end your Rage at the end of this turn."
    lore_explosive_rage: self('Explosive Rage', [ch('system.bonuses.maximizeDamage', 1), ch('system.bonuses.endRageAtTurnEnd', 1)], TURN_END),
    // Consumption: "For the rest of your turn, whatever damage you do, gain one fourth that much temporary HP".
    lore_consumption: self('Consumption', [ch('system.bonuses.drainQuarter', 1)], TURN_END),
    // Trend to Arcana: the dice change around you "lasts for one minute" (10 rounds).
    lore_trend_to_arcana: self('Trend to Arcana', [ch('system.bonuses.trendToArcana', 1)], { type: 'rounds', rounds: 10 }),
    // Legendary Form: "Increase your size by one type until the start of your next turn."
    lore_legendary_form: self('Legendary Form', [ch('system.bonuses.sizeStep', 1)], NEXT_TURN),
    lore_battle_cry: { scope: 'allies', label: 'Battle Cry', duration: NEXT_TURN, changes: [ch('system.bonuses.defense.dr', '@proficiency'), ch('system.bonuses.trait', '@proficiency')] },
  },
  tempHp: {
    // "Give that ally temporary HP up to 1/4 of their maximum HP (rounded up)."
    lore_healing_war_cry: { formula: 'ceil(@target.hpMax/4)', target: 'allies', scaleLevels: [] },
  },
  boost: {
    // "double your move speed … All creatures gain 1x additional disadvantage against Charge the Line made this way."
    lore_group_charge: loreBoost({ kind: 'ability', ability: 'charge_the_line' }, { effects: [{ label: 'Group Charge', target: 'saveAdvantage', value: '-1' }] }),
    // "They automatically fail all Trait Checks against the effect" (every check becomes an automatic failure).
    lore_the_hunted: loreBoost({ kind: 'ability', ability: 'beastly_presence' }, { effects: [{ label: 'The Hunted', target: 'saveAdvantage', value: '-12' }] }),
    // "use Wild Strike (instead of actions or exhausting limbs) … increase the damage dealt to each target by 1 dice
    // type. Each target you hit is knocked back 5X feet and falls prone." The AP is refunded; limbs and the push: GM.
    lore_blasting_strike: loreBoost({ kind: 'ability', ability: 'wild_strike' },
      { effects: [{ label: 'Blasting Strike', target: 'damage', mode: 'step', value: '1' }], inflict: [{ condition: 'prone', amount: '1' }] },
      { onConsume: { lore: 1, ap: '-1' } }),
    // "Make a ranged attack against a number of enemies up to X … where X is your Proficiency" (a bow).
    lore_divine_volley: loreBoost({ kind: 'attack', category: 'ranged' }, {}, { requires: when('self:attack:weapon:bow'), extraAttacks: '@proficiency - 1' }),
    // "If you expend all of your AP in this shot, increase the dice type of your attack by 4 dice types" (a crossbow).
    lore_divine_blast: loreBoost({ kind: 'attack', category: 'ranged' }, { effects: [{ label: 'Divine Blast', target: 'damage', mode: 'step', value: '4' }] },
      { requires: when('self:attack:weapon:crossbow') }),
    // "Every creature you select makes a Wiles Check against your Check DC or takes the Surprised Condition" (a sling).
    lore_divine_sling: loreBoost({ kind: 'attack', category: 'ranged' }, {}, { requires: when('self:attack:weapon:sling'),
      extraSave: { trait: 'wiles', inflict: [{ condition: 'surprised', amount: '1' }] } }),
    // "Attempt to give your Proficiency in Wrestle Pin instead of half your Proficiency rounded up."
    // Glore: "expend any number of additional unique Boosts to that attack" (you may decide after the to-hit: arm it first).
    lore_glore: loreBoost({ kind: 'attack' }, {}, { unlimitedBoosts: true }),
    // Shot of Legend: "this attack goes right through the first enemy it would hit, and into a second one behind them.
    // Your attack must pass the defense of both targets." Target both: the one roll resolves against each.
    lore_shot_of_legend: loreBoost({ kind: 'attack' }),
    lore_no_bars_hold: loreBoost({ kind: 'ability', ability: 'thug_natural_wrestler' }, {}, { inflictBonus: { pinned: 6 } }),
    // Coordinated Flock (designer's update; the v1.2 text still targeted v1.0's Clouded Foe): "doubles the size of your
    // cloud from Clouded Foe".
    lore_coordinated_flock: loreBoost({ kind: 'ability', ability: 'clouded_foe' }, {}, { zoneTilesMult: 2 }),
  },
  zone: {
    // "Until the start of your next turn, every enemy who begins their turn within 15ft of you or moves into that range
    // must immediately make Courage Checks against Panic equal to half your Proficiency (rounded up)."
    lore_divine_aura: { shape: 'circle', size: '15', anchor: 'caster', followCaster: true,
      effect: { affects: 'enemies', check: { trait: 'courage', inflict: [{ condition: 'panic', level: 'ceil(@proficiency/2)' }] } } },
  },
  choice: {
    lore_bonebreaker: { prompt: 'Which pinned limb?', options: [{ value: 'oneArm', label: 'An arm' }, { value: 'leg', label: 'A leg' }] },
  },
  amountPrompt: {
    lore_gods_eye: { label: 'New Madness (0–7)', max: '7' },
  },
  pick: {
    // Your Font's element (Corrupting Touch's weapon damage, Corrupted Iron's warp).
    lore_corrupting_touch: { kind: 'element' },
    lore_corrupted_iron: { kind: 'element' },
  },
  usage: {
    lore_gods_eye: { requires: when('!self:insane'), requiresLabel: 'not while Insane' },
    // Explosive Rage: "When you are raging".
    lore_explosive_rage: { requires: when('self:raging'), requiresLabel: 'raging' },
  },
  multiAttack: {
    lore_bladeslam: { count: 0, targeting: 'each', requiresAbility: '', upgrade: { ability: '', count: 0 } },
    // "deal 5M damage to X enemies within 60ft, where X is a number up to your Proficiency" — one enemy per Madness spent
    // (owner ruling), so no more than your Madness either.
    lore_webcraft: { count: 0, targeting: 'each', requiresAbility: '', maxTargets: 'min(@proficiency, @madness)', upgrade: { ability: '', count: 0 } },
  },
  // Oracle Lore Madness annotations (<P: M3, M-X>, <P:I, M+X>, <P:M1>).
  madness: {
    // M-X: one Madness per enemy targeted ('T'); the 5M damage reads the Madness before it's spent (owner ruling).
    lore_webcraft: { insaneOnly: false, prereq: 3, gain: '', spend: 'T' },
    lore_unhinge: { insaneOnly: true, prereq: null, gain: '', spend: '' },
    lore_pierce_the_veil: { insaneOnly: false, prereq: 1, gain: '', spend: '' },
  },
};

/** Lore abilities whose point is charged elsewhere (a Boost's consume, a post-roll button) or that cost none. */
export const LORE_NO_COST = new Set(['lore_saptouched', 'lore_oozing_flow', 'lore_cursed_contract',
  ...Object.keys(LORE.boost)]);
