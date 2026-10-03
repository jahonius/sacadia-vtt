/**
 * Build overrides for the prestige professions (SAoW Prestige Classes addendum v0.2-3): the Magus (`mg_`) and the Witch
 * (`wt_`), keyed by catalogId like the maps in src/modifiers.mjs, which merges them in. Their abilities come from
 * src/prestige.json (features from src/progression.mjs); nothing here is detected from prose, because the addendum's
 * wording is too varied. Anything not listed is descriptive (the ledger, docs/coverage-ledger.md, says why).
 *
 * Runtime pieces these lean on: save extensions (`save.ext`, see onSaveRoll), grant markers / per-target sets / onEnd
 * (applyGrant, onAnchorEnded), on-use bursts and conversions (applyOnUseInflict), module/helpers/prestige.mjs (Law of
 * Alliance, Death Ward, Catnap, Crown of Insanity, Armor of Itthoa, live Hemorrhage), auras.mjs (Witch auras, Hallow's
 * Calm / Gale, Confusion), and post-roll.mjs (Checkered Shield, Absorb Attack, Balanced / Harmed Fare).
 */

/* ---------- small builders ---------- */

const NO_ATTACK = { category: '', trait: '', defense: '' };
/** A save activity: the target checks `trait` against your Check DC. */
const save = (trait, inflict = [], { damage = [], onSuccess = 'none', drain = null, ext = {} } = {}) => ({
  type: 'save', label: '', attack: NO_ATTACK, save: { trait, dc: null, onSuccess, ...(drain ? { drain } : {}), ext }, damage, inflict,
});
/** A spell attack (no weapon): `category` magic, the to-hit trait and the defense it targets. */
const attack = (trait, defense, damage, extra = {}) => ({
  type: 'attack', label: '', attack: { category: 'magic', trait, defense }, save: { trait: '', dc: null }, damage, inflict: [], ...extra,
});
const dmg = (count, denomination, trait = '') => ({ count: String(count), denomination, formula: '', trait, type: '' });
const inf = (condition, amount, extra = {}) => ({ condition, amount: String(amount), ...extra });
const when = (...atoms) => atoms.map((atom) => ({ atom }));
const half = 'ceil(@proficiency/2)';

const label = (k) => k[0].toUpperCase() + k.slice(1);
const WEAK = ['nausea', 'pinned', 'paralysis', 'delirium', 'jinxed', 'slowed', 'sting'];
const ADVERSARIAL = ['nausea', 'pinned', 'paralysis', 'corroded', 'debilitated', 'pulled', 'hemorrhage', 'delirium', 'jinxed',
  'slowed', 'silenced', 'sting', 'fatigue', 'frenzy', 'panic', 'taunt', 'fumbled', 'rended'];
const WEAPON_TYPES = ['unarmed', 'dagger', 'sword', 'axe', 'spear', 'bludgeon', 'sling', 'bow', 'crossbow', 'shield', 'other'];
const options = (keys, note = {}) => keys.map((k) => ({ value: k, label: `${label(k)}${note[k] ? ` (${note[k]})` : ''}` }));
const conditionChoice = (prompt, extra = []) => ({ prompt, options: options([...ADVERSARIAL, ...extra]) });

/** Focus grant on targeted creature(s). */
const focusGrant = (lbl, changes, extra = {}) => ({ scope: 'ally', label: lbl, duration: { type: 'focus' }, changes, ...extra });
const ch = (key, value, predicate) => ({ key, mode: 2, value: String(value), ...(predicate ? { predicate } : {}) });

export const PRESTIGE = {
  /* ======================================================================================================== */
  /*  Activities (rolls)                                                                                      */
  /* ======================================================================================================== */
  activity: {
    // ---- Magus: Blood Tome ----
    // "Expend X Spell Slots and attempt to give a target 2X Fatigue … Courage Checks. For every level of Fatigue they
    // gain from this effect, gain 1 AP" (X = the slots spent, `@spent`).
    mg_siphon_soul: [save('courage', [inf('fatigue', '2*@spent')], { ext: { casterGain: { ap: 1 } } })],
    // "They make Fate Checks against X levels of Frenzied, where X is half your Proficiency, rounded up."
    mg_hypnotic_gaze: [save('fate', [inf('frenzy', half)])],
    // "That target makes Fate Checks against X levels of Hemorrhage. For each level of Hemorrhage they take, gain 1
    // Spell Slot back."
    mg_bloodsight: [save('fate', [inf('hemorrhage', '@spent')], { ext: { casterGain: { pool: 'spell' } } })],
    // "Make a Melee attack vs. MD … 1D10+Wiles Damage. 2D6 at Level 5, and 2D8 at Level 11" (SELFSCALING).
    mg_chill_touch: [attack('wiles', 'md', [dmg(1, 10, 'wiles')])],
    // "They make a Fate Check … or take 2XD10 damage, where X is your Proficiency (no damage on a successful save)."
    mg_finger_of_death: [save('fate', [], { damage: [dmg('2*@proficiency', 10)] })],
    // "If they fail, Roll XD8, where X is your Proficiency … Gain half the damage dealt (rounded up) as temporary HP."
    mg_ennervation: [save('fate', [], { damage: [dmg('@proficiency', 8)], drain: 0.5, ext: { drainCeil: true } })],
    // "They make a Courage Check … or expend a reaction to take a below action you choose": Drop (Prone) is applied;
    // Attack / Approach / Flee are the GM's (forced movement and the attack are adjudicated).
    mg_command: [save('courage', [inf('prone', 1, { predicate: when('self:choice:mg_command:drop') })])],
    // "Make a ranged attack vs. TD in a 30ft line … 1D10+Wiles damage to any target it hits." One attack per targeted
    // creature in the line (MULTIATTACK 'each'); extra AP step the die (EXTRAAP).
    mg_clotsnipe: [attack('wiles', 'td', [dmg(1, 10, 'wiles')])],

    // ---- Magus: Contract Tome ----
    // "Attempt to give them X levels of Jinxed (Fate Check negates), where X is your Proficiency." (Luckless Hold makes
    // them Enduring.)
    mg_surge_of_bad_luck: [save('fate', [inf('jinxed', '@proficiency')])],
    // "Choose up to X targets within 60ft (X = ½ Proficiency, rounded up). Each target takes 1D4+Wiles mental damage.
    // You may choose the same target for all Missives." No to-hit: each missile lands (MULTIATTACK countFormula).
    mg_magic_missive: [attack('', 'md', [dmg(1, 4, 'wiles')], { autoHit: true })],
    // "force them to make a Wiles Check. If they fail … cancel the effects of that spell or mental attack" (the cancel
    // is the GM's).
    mg_counterspell: [save('wiles')],
    // "They make a Fate Check … If they fail, for as long as you maintain Focus, that target cannot enter the
    // Hallowfell." A marker grant on those who fail.
    mg_forbid_hallowing: [save('fate', [], { ext: { grantOnFail: true } })],
    // Confusion: every time you renew it, the creatures within range (target them) "must make a Wiles Check … to
    // maintain Focus" — a failure ends theirs (Mastery of Focus is immune).
    mg_confusion: [save('wiles', [], { ext: { onFail: { endFocus: true } } })],
    // "They make a Fate Check … If they fail, they are banished to the Hallowfell until the start of your next turn"
    // (the banishment itself is the GM's).
    mg_banish_to_hallow: [save('fate')],

    // ---- Magus: Elder Tome ----
    // "That target makes a Courage Check against X Fumble, where X is your Proficiency." Bleeding Barbs: "The target
    // instead makes Wiles Checks against X levels of Jinxed" (the boost swaps the trait and the condition).
    mg_viscous_mockery: [save('courage', [
      inf('fumbled', '@proficiency', { predicate: when('!self:boost:mg_bleeding_barbs') }),
      inf('jinxed', '@proficiency', { predicate: when('self:boost:mg_bleeding_barbs') }),
    ])],
    // "If they fail, they take XD4 damage, where X is the difference between their roll and your Check DC."
    mg_runic_scars: [save('fate', [], { ext: { marginDice: 'd4' } })],
    // "That target takes 1D6 damage. Each turn you maintain Focus on this effect, deal 1D6 damage to that target.
    // Increase the dice type … by 1 Dice Type each turn" (the ramp is a MODIFIER on the Focus streak). No to-hit.
    mg_barbed_stare: [attack('', 'md', [dmg(1, 6)], { autoHit: true })],
    mg_hex: [save('wiles', [inf('sting', '@proficiency')])],
    mg_attempt_hold: [save('wiles', [inf('paralysis', '@proficiency')])],
    // "If they fail, at the start of each of their turns that you maintain Focus, the target takes 2D8 damage" and an
    // Insane Table effect (prestigeTurnStart reads the grant).
    mg_crown_of_insanity: [save('fate', [], { ext: { grantOnFail: true } })],
    // "losing all Reactions before the start of their next turn if they fail."
    mg_hallowfells_whisper: [save('fate', [], { ext: { onFail: { reactions: 0 } } })],
    // "Each target makes a Fate Check … all enemies who fail this Trait Check subtract your Fate score from all Trait
    // Checks and Attack Rolls."
    mg_bane: [save('fate', [], { ext: { grantOnFail: true } })],
    mg_compelled_duel: [save('wiles', [inf('taunt', half)])],
    // "If they fail, they treat all allies as enemies … The affected target makes a Wiles Check against this effect
    // every time you renew Focus … When it passes the Check, the effect ends."
    mg_enemies_abound: [save('wiles', [], { ext: { grantOnFail: true, resaveOnRenew: true } })],
    // "Any target who fails falls unconscious and prone. They remain unconscious until they take any damage, or your
    // Focus ends." (The end-of-turn re-check and the wake-ups are prestige.mjs.)
    mg_catnap: [save('fate', [inf('prone', 1)], { ext: { grantOnFail: true } })],

    // ---- Witch ----
    // "They make a Fate Check … If they fail, they gain one level (to a maximum of your Proficiency)." Explicitly
    // stacking, on a condition they already have.
    wt_witchs_finger: [save('fate', [inf('@choice', 1, { stacks: true })], { ext: { capAt: '@proficiency' } })],
    // "They make a Finesse Check … or take XD4 damage, where X is the number of unique conditions they possess";
    // Greater Twist counts each level.
    wt_baneful_scratch: [save('finesse', [], { damage: [dmg('@target.uniqueConditions + @owns.wt_greater_twist * (@target.conditionLevels - @target.uniqueConditions)', 4)] })],
    // "They make X Fate Checks … (X = ½ Proficiency, rounded up). For each failed Check, deal 1D6 damage to them …
    // Then, choose a second target … They gain HP equal to the damage dealt." Target the first, then the second.
    wt_olive_branch: [save('fate', [], { ext: { checks: half, perFailDie: 6, perFailDieWith: { ability: 'wt_oldgrove', die: 8 }, healTo: '@target2' } })],
    // "For each level of Fumble they possess (up to your Proficiency), they make a Finesse Check (they do not apply
    // their Fumbled to these Checks). For each failed Finesse Check made, they gain 1 Jinxed, and lose 1 Fumbled."
    wt_clumsy_touch: [save('finesse', [], { ext: { checks: 'min(@target.fumbled, @proficiency)', ignoreFumble: true, perFail: { self: { jinxed: 1, fumbled: -1 } } } })],
    // "force them to make a Power Check … If they fail, they remain Prone" (keeping them down is the GM's).
    wt_cheststep: [save('power')],
    // "For every level of Hemorrhage they possess, they make a Fate Check against one level of Corrosion … Whether they
    // succeed or fail, they then lose all levels of Hemorrhage" (the loss is ONUSE).
    wt_corrosive_burns: [save('fate', [inf('corroded', '@target.hemorrhage')])],
    wt_vomiting_touch: [save('fate', [inf('debilitated', '@target.nausea')])],
    // "If they fail, they do not remove the Surprised Condition" (the GM keeps it on).
    wt_fools_gold: [save('fate')],
    // "They immediately make X Trait Checks against levels of the Condition … They remove a level of the Condition for
    // each successful trait check made. For each Trait Check they fail, you gain 1 Fatigue."
    wt_give_of_thyself: [save('', [inf('@choice', 1)], { ext: { mode: 'reduce', checks: '@spent', casterGain: { condition: 'fatigue' } } })],
    wt_banebalm: [save('finesse', [inf('sting', '@proficiency')])],
    // "They make a Fate Check … If they fail, for as long as you maintain Focus on Waspnest, Sting increases the damage
    // they take by 2 per level, instead of 1."
    wt_waspnest: [save('fate', [], { ext: { grantOnFail: true } })],
    // "The second target must make Fate Checks against X levels of that condition. For each level of the condition they
    // take, the first target loses one level of the condition, and you gain 1 level of Fatigue." Target the first, then
    // the second (who rolls).
    wt_transmute_trauma: [save('fate', [inf('@choice', '@spent')], { ext: { perFail: { other: { uuid: '@target1', deltas: { '@choice': -1 } } }, casterGain: { condition: 'fatigue' } } })],
    // "That target makes Fate Checks against X additional levels of that Condition" — explicitly stacking.
    wt_springs_surge: [save('fate', [inf('@choice', '@spent', { stacks: true })])],
    // "If they fail the Make Trait Check action, they take XD10 damage, where X is the number of levels of that
    // condition they possess" (X chosen at use).
    wt_heretics_bane: [{ type: 'damage', label: '', attack: NO_ATTACK, save: { trait: '', dc: null }, damage: [dmg('@spent', 10)], inflict: [] }],
    // Foe Transference: "You may target an enemy with Shield Transference. If you use this on an enemy, they may make a
    // Finesse Check against your Check DC to prevent the effect when you initiate and each round you renew the effect."
    // Only against an enemy; a success on renewal ends it.
    wt_shield_transference: [{ ...save('finesse', [], { ext: { grantOnFail: true, resaveOnRenew: true } }),
      predicate: when('target:hostile', 'self:ability:wt_foe_transference') }],
    // Pinetar (Witch L3): "They make Finesse Checks against your Check DC or lose one AP to use on their next turn."
    wt_pinetar: [save('finesse', [], { ext: { onFail: { apDebt: 1 } } })],
  },

  /* ======================================================================================================== */
  /*  Grants (effects placed on creatures)                                                                    */
  /* ======================================================================================================== */
  grant: {
    // ---- Magus ----
    // Partial Revivify: "they ignore the effects of their Enduring Fatigue accumulated from Dying".
    mg_partial_revivify: focusGrant('Partial Revivify', [ch('system.bonuses.ignoreBattleFatigue', 1)]),
    // Enfeeblement: "reduce the damage dice of that weapon by one dice type" (read as all its weapon damage; the one
    // weapon is the GM's). Greater Enfeeblement's extra AP add steps (BOOST grantExtra).
    mg_enfeeblement: focusGrant('Enfeeblement', [ch('system.bonuses.dieStep', -1)]),
    // Guidance: "the first time they have to make a Trait Check, they add your Fate Score to one die rolled … Then, end
    // Guidance." Spent by their next roll.
    mg_guidance: { scope: 'ally', label: 'Guidance', duration: { type: 'consumed', on: 'roll' }, changes: [ch('system.bonuses.traitBonusOne', '@fate')] },
    // Bureaucrat's Blessing (reaction, while guiding them): "For every Spell Slot expended, they add your Fate to one
    // additional roll" — Guidance's bonus on that many more dice of their check.
    mg_bureaucrats_blessing: { scope: 'ally', label: "Bureaucrat's Blessing", duration: { type: 'consumed', on: 'roll' }, changes: [ch('system.bonuses.traitBonusCount', '@spent')] },
    // Law of Alliance (Greater: up to three allies): damage is shared (prestigePreUpdate reads the marker).
    mg_law_of_alliance: { scope: 'allies', label: 'Law of Alliance', duration: { type: 'focus' }, changes: [], marker: true },
    // Armor of Itthoa: "If you drop Focus, lose all Temporary HP immediately" — the temp HP is TEMPHP; this self marker
    // carries the reflection (afterHit) and the end.
    mg_armor_of_itthoa: { scope: 'self', label: 'Armor of Itthoa', duration: { type: 'focus' }, changes: [], marker: true, onEnd: { clearTemp: true } },
    // Law of Exchange: "All attacks against one gain Advantage. All attacks against the other gain Disadvantage."
    // Target the favored-against creature first. (Attacks against you: MODIFIER.)
    mg_law_of_exchange: { scope: 'allies', label: 'Law of Exchange', duration: { type: 'focus' }, changes: [],
      perTarget: [[ch('system.bonuses.incomingAdvantage', 1)], [ch('system.bonuses.incomingAdvantage', -1)]] },
    // Lawful Sanctuary: attackers of the target make a Wiles Check first (the sheet's #lawfulSanctuary).
    mg_lawful_sanctuary: focusGrant('Lawful Sanctuary', [], { marker: true }),
    mg_forbid_hallowing: focusGrant('Forbid Hallowing', [], { marker: true }),
    // Death Ward (Greater: up to three targets): "The next time they would drop to 0HP or below, they drop to 1HP
    // instead, and your Focus ends."
    mg_death_ward: { scope: 'allies', label: 'Death Ward', duration: { type: 'focus' }, changes: [], marker: true },
    // Baneful Trade: "they critically hit with their first attack each turn."
    mg_baneful_trade: focusGrant('Baneful Trade', [ch('system.bonuses.forceCritFirst', 1)]),
    // Heroism: "That target becomes immune to Panic."
    mg_heroism: focusGrant('Heroism', [ch('system.bonuses.immune.panic', 1)]),
    mg_crown_of_insanity: focusGrant('Crown of Insanity', [], { marker: true }),
    // Bless: "all those allies add your Fate to all Trait Checks and Attack Rolls that they make."
    mg_bless: { scope: 'allies', label: 'Bless', duration: { type: 'focus' }, changes: [ch('system.bonuses.trait', '@fate'), ch('system.bonuses.toHit.all', '@fate')] },
    // Bane: "subtract your Fate score from all Trait Checks and Attack Rolls" (only those who fail — save-gated).
    mg_bane: { scope: 'allies', label: 'Bane', duration: { type: 'focus' }, changes: [ch('system.bonuses.trait', '0 - @fate'), ch('system.bonuses.toHit.all', '0 - @fate')] },
    mg_enemies_abound: focusGrant('Enemies Abound', [], { marker: true }),
    // Catnap: asleep (Unconscious) while it lasts.
    mg_catnap: { scope: 'allies', label: 'Catnap', duration: { type: 'focus' }, changes: [], marker: true, statuses: ['unconscious'] },
    // Mind Sliver (reaction, before their check): "1X Disadvantage on the Trait Check, and takes 1D4 mental damage for
    // each failed Trait Check made. 1D6 at Level 5, and 1D8 at Level 11" (+1 type Greater Slivers). Spent by the roll.
    mg_mind_sliver: { scope: 'ally', label: 'Mind Sliver', duration: { type: 'consumed', on: 'roll' }, changes: [
      ch('system.advantage.trait', -1),
      { key: 'system.bonuses.failDamageDie', mode: 5, value: '4 + 2*min(1, floor(@level/5)) + 2*min(1, floor(@level/11)) + 2*@owns.mg_greater_slivers' },
    ] },

    // ---- Witch ----
    // Hallowed Touch: "add one die to the amount rolled" on the ally's next temp HP (Mastery of Nonviolence: one type up).
    wt_hallowed_touch: { scope: 'ally', label: 'Hallowed Touch', duration: { type: 'consumed', on: 'tempHp' }, changes: [
      ch('system.bonuses.tempHpDice', 1), ch('system.bonuses.tempHpSteps', 1, when('self:ability:wt_mastery_of_nonviolence'))] },
    // Tweak the Heart: "+1 Check DC for that effect" (Mastery of Justice: +2). Spent by their next condition attempt.
    wt_tweak_the_heart: { scope: 'ally', label: 'Tweak the Heart', duration: { type: 'consumed', on: 'inflict' }, changes: [ch('system.bonuses.checkDc', '1 + @owns.wt_mastery_of_justice')] },
    // Twisted Pin: an allied Thug's Harm "is increased by one dice type" (Greater Twistings: one more).
    wt_twisted_pin: focusGrant('Twisted Pin', [ch('system.abilityDamageSteps.thug_harm', '1 + @owns.wt_greater_twistings')]),
    // Dancerwind: "On their next turn, their Move Speed is increased by 5ft" (Dancer's Gale: +5ft per extra AP).
    wt_dancerwind: { scope: 'ally', label: 'Dancerwind', duration: { type: 'rounds', rounds: 1 }, changes: [ch('system.bonuses.speed', 5)] },
    wt_eye_for_damage: focusGrant('Eye for Damage', [], { marker: true }),
    // Shield Transference: lower one of the ally's defenses and raise another by ½ Fate (rounded up); Greater
    // Transference: by your Fate — "When you use Shield Transference on an ally", so not on an enemy through Foe
    // Transference (owner ruling).
    wt_shield_transference: focusGrant('Shield Transference', ['pd', 'md', 'td'].flatMap((lo) => ['pd', 'md', 'td'].filter((hi) => hi !== lo)
      .flatMap((hi) => [
        ch(`system.bonuses.defense.${lo}`, '0 - ceil(@fate/2)', when(`self:choice:wt_shield_transference:${lo}-${hi}`)),
        ch(`system.bonuses.defense.${hi}`, 'ceil(@fate/2)', when(`self:choice:wt_shield_transference:${lo}-${hi}`)),
        ch(`system.bonuses.defense.${lo}`, '0 - (@fate - ceil(@fate/2))',
          when(`self:choice:wt_shield_transference:${lo}-${hi}`, 'self:ability:wt_greater_transference', '!target:hostile')),
        ch(`system.bonuses.defense.${hi}`, '@fate - ceil(@fate/2)',
          when(`self:choice:wt_shield_transference:${lo}-${hi}`, 'self:ability:wt_greater_transference', '!target:hostile')),
      ]))),
    // Self Heal: "any ability they would use or effect they trigger that deals damage to themselves gives them
    // temporary HP instead."
    wt_self_heal: focusGrant('Self Heal', [ch('system.bonuses.selfHeal', 1)]),
    // Razorleaf: "increase the damage dice of all attacks they make with that weapon type by two dice types" (+1 Grasses
    // of Kish, +1 Lodestone Shards). Needlepine: decrease by two (+1 Heart of Pine, +1 Pigsqueak Tuber).
    wt_razorleaf: focusGrant('Razorleaf', [ch('system.bonuses.weaponSteps.<choice>', '2 + @owns.wt_grasses_of_kish + @owns.wt_lodestone_shards')]),
    wt_needlepine: focusGrant('Needlepine', [ch('system.bonuses.weaponSteps.<choice>', '0 - 2 - @owns.wt_heart_of_pine - @owns.wt_pigsqueak_tuber')]),
    // Field of Flowers: "Until the start of your next turn, all reaction attacks made against them are made at 1X
    // Disadvantage."
    wt_field_of_flowers: { scope: 'ally', label: 'Field of Flowers', duration: { type: 'rounds', rounds: 1 }, changes: [ch('system.bonuses.incomingReactionAdvantage', -1)] },
    // Hold the Brush: "they do not expend AP to maintain Focus" (you pay instead — spend that Focus action yourself).
    wt_hold_the_brush: focusGrant('Hold the Brush', [ch('system.bonuses.heldFocus', 1)]),
    // Fourleaf Touch: "increase their Check DC by half your Fate Score, rounded up" (Sevenleaf: your Fate); with
    // Threeleaf Touch on an enemy, reduce it by half instead.
    wt_fourleaf_touch: focusGrant('Fourleaf Touch', [
      ch('system.bonuses.checkDc', 'ceil(@fate/2) + @owns.wt_sevenleaf*(@fate - ceil(@fate/2))', when('!self:choice:wt_fourleaf_touch:enemy')),
      ch('system.bonuses.checkDc', '0 - ceil(@fate/2)', when('self:choice:wt_fourleaf_touch:enemy')),
    ]),
    // Poured Mold: "your chosen condition is treated as Stacking up to your Proficiency … if you drop Focus, they lose all
    // levels of that condition." Every Poured Mold you've taken rides one Focus (`<picks>`).
    wt_poured_mold: focusGrant('Poured Mold', [ch('system.bonuses.stackingCap.<picks>', '@proficiency')], { onEnd: { clear: ['<picks>'] } }),
    // Wellspring: "that ally attempts to give one extra level" on an attempt of at least their Proficiency (Greater
    // Wellspring: half their Proficiency, rounded up). Spent by that attempt.
    wt_wellspring: { scope: 'ally', label: 'Wellspring', duration: { type: 'consumed', on: 'inflict' }, changes: [
      ch('system.bonuses.inflictPlus', 1), ch('system.bonuses.inflictPlusHalf', 1, when('self:ability:wt_greater_wellspring'))] },
    // Blossom: "That ally does not exhaust a limb through that ability use."
    wt_blossom: { scope: 'ally', label: 'Blossom', duration: { type: 'consumed', on: 'limb' }, changes: [ch('system.bonuses.freeLimbs', 1)] },
    // Bleeding Bane: "The damage dice caused by Hemorrhage they give is increased by one dice type for as long as you
    // retain Focus" (Greater Bleed: one more) — read live when that Hemorrhage deals damage.
    wt_bleeding_bane: focusGrant('Bleeding Bane', [ch('system.bonuses.hemorrhageSteps', '1 + @owns.wt_greater_bleed')]),
    wt_waspnest: focusGrant('Waspnest', [ch('system.bonuses.stingExtra', 1)]),
    // Toxin to Tonic: the chosen condition helps instead (base-actor's `tonic` fold).
    wt_toxin_to_tonic: focusGrant('Toxin to Tonic', [ch('system.bonuses.tonic.<choice>', 1)]),
    // Allied Spirit Blade: "It attacks AD … instead of other armor types."
    wt_allied_spirit_blade: focusGrant('Allied Spirit Blade', [ch('system.bonuses.attackAd', 1)]),
    // Winter Frost: "That target's condition becomes Enduring for as long as you maintain Focus" (ONUSE sets it; the
    // Focus's end clears it).
    wt_winter_frost: focusGrant('Winter Frost', [], { marker: true, onEnd: { unEndure: ['<choice>'] } }),
  },

  /* ======================================================================================================== */
  /*  On use (no roll)                                                                                        */
  /* ======================================================================================================== */
  onUse: {
    // "Roll Hemorrhage damage according to the number of levels they have. Gain X temporary HP, where X is half the
    // damage rolled … Then, reduce their Hemorrhage by one."
    mg_vampiric_siphon: { self: [], target: [], burst: { triggers: '1', drain: 0.5 } },
    // "Remove all levels of Hemorrhage that target possesses" (deciding their first AP is the GM's).
    mg_vampiric_command: { self: [], target: [inf('hemorrhage', -6)] },
    mg_spare_the_meek: { self: [], target: [], setFlag: 'spareTheMeek' },
    // Reverse Catnap: "All targets recover 1 expended Action Pool point" (each picks the pool).
    mg_reverse_catnap: { self: [], target: [], poolRefund: '1' },
    // "remove X levels of a Lesser Mental Condition … X is half your Proficiency, rounded up" (Greater Restore: also
    // Greater Mental conditions and Surprised).
    mg_lesser_restore: { self: [], target: [inf('@choice', `0 - ${half}`)] },
    wt_corrosive_burns: { self: [], target: [inf('hemorrhage', -6)] },
    wt_vomiting_touch: { self: [], target: [inf('nausea', -6)] },
    wt_healthy_hands: { self: [], target: [], convertTemp: true },
    wt_delirious_vulnerabilities: { self: [], target: [], sourcePatch: { condition: 'delirium', patch: { toDr: true } } },
    // Nettle: "For every Divine Touch Point spent, convert up to 2 levels of that adversarial condition to Sting, Jinxed,
    // Delirium, or Nausea."
    wt_nettle: { self: [], target: [], convert: { amount: '2*@spent', to: ['sting', 'jinxed', 'delirium', 'nausea'] } },
    // Bloomgift: "For each AP you expend, that ally gains one reaction before the start of their next turn."
    wt_bloomgift: { self: [], target: [], reactions: '@extraAp' },
    // Wild Rebuke: "For every successful Trait Check your ally makes … the enemy takes one level of that condition."
    wt_wild_rebuke: { self: [], target: [inf('@choice', '@spent')] },
    // Touch the Flame: "They take Hemorrhage damage immediately … Then, remove one level" (Into Fire: once more per extra
    // AP, at the next level down).
    wt_touch_the_flame: { self: [], target: [], burst: { triggers: '1 + @extraAp', drain: 0 } },
    wt_winter_frost: { self: [], target: [], enduring: '@choice' },
  },

  /* ======================================================================================================== */
  /*  Temp HP                                                                                                 */
  /* ======================================================================================================== */
  tempHp: {
    // "Roll XD6, where X is up to half your Proficiency … Lose that HP. Give your ally Temp HP equal to twice the HP you
    // lost." (Greater Transference: XD8.)
    mg_life_transference: { formula: '(@spent)d6', target: 'allies', scaleLevels: [], selfCost: true, multiplier: 2, stepWith: 'mg_greater_transference' },
    // "Gain XD6 temporary HP, where X is half your Proficiency (rounded up)" — on initiating, not on each renewal.
    mg_armor_of_itthoa: { formula: `(${half})d6`, target: 'self', scaleLevels: [], initiateOnly: true },
    // Greater Heroism: "Each turn that you maintain Focus on Heroism on an allied target, they gain 1D4 Temporary HP …
    // 1D6 at Level 5, and 1D8 at level 11."
    mg_heroism: { formula: '1d4', target: 'allies', scaleLevels: [5, 11], requires: 'mg_greater_heroism' },
  },

  /* ======================================================================================================== */
  /*  Boosts                                                                                                  */
  /* ======================================================================================================== */
  boost: {
    // "Increase the damage dice of their first attack on their next turn by two dice types."
    mg_blood_doping: { appliesTo: { kind: 'ability', ability: 'mg_spare_the_meek' },
      special: { targetGrant: { label: 'Blood Doping', on: 'attack', changes: [ch('system.bonuses.dieStep', 2)] } } },
    // "Remove all temporary HP they possess. Damage from Chill Touch is applied after the removal."
    mg_spirit_sap: { appliesTo: { kind: 'ability', ability: 'mg_chill_touch' }, special: { stripTempHp: true } },
    // "when you are dying. Increase the dice type of Chill Touch by 2 for every level of Battle Fatigue you possess."
    mg_icy_veil: { appliesTo: { kind: 'ability', ability: 'mg_chill_touch' },
      effects: [{ label: 'Icy Veil', target: 'damage', mode: 'step', value: '2*@battleFatigue' }],
      special: { requires: when('self:wounded') } },
    // "As a Boost to an action that would use a Spell Slot, take 1D10 damage. If you take 6+ damage, do not expend a
    // Spell Slot. … 2D6 at level 6, and 2D8 at level 11."
    mg_blood_for_bane: { appliesTo: { kind: 'pool', pool: 'spell' },
      special: { onConsume: { selfDamageRoll: [{ level: 1, formula: '1d10' }, { level: 6, formula: '2d6' }, { level: 11, formula: '2d8' }], refundPoolAt: 6 } } },
    // "you may expend additional AP. For every additional AP you expend, reduce the damage dice of the target's weapon
    // by an additional dice type."
    mg_greater_enfeeblement: { appliesTo: { kind: 'ability', ability: 'mg_enfeeblement' },
      special: { prompt: { label: 'Additional AP', max: '6' }, onConsume: { ap: '@spent' }, grantExtra: [ch('system.bonuses.dieStep', '0 - @spent')] } },
    // "The Jinxed you give that target are treated as Enduring."
    mg_luckless_hold: { appliesTo: { kind: 'ability', ability: 'mg_surge_of_bad_luck' }, special: { saveExt: { enduring: true } } },
    // Silvery Barbs: "choose an ally within 5ft of the enemy target who you mock. That ally gains X to their next to-hit
    // rolled against the enemy target, where X is the amount of Fumble the enemy takes." Target the enemy, then the ally.
    mg_silvery_barbs: { appliesTo: { kind: 'ability', ability: 'mg_viscous_mockery' }, special: { saveExt: { allyToHit: { uuid: '@target2' } } } },
    // "The target instead makes Wiles Checks against X levels of Jinxed" (Viscous Mockery's inflicts swap on it).
    mg_bleeding_barbs: { appliesTo: { kind: 'ability', ability: 'mg_viscous_mockery' }, special: { saveTrait: 'wiles' } },
    // "if the target fails their Fate Check … they take 2D6 damage. 2D8 at Level 5, and 2D10 at Level 11."
    mg_damaging_whispers: { appliesTo: { kind: 'ability', ability: 'mg_hallowfells_whisper' },
      special: { saveDamage: [{ level: 1, formula: '2d6' }, { level: 5, formula: '2d8' }, { level: 11, formula: '2d10' }] } },
    // "For every extra AP you expend, increase the move speed of the target by an additional 5ft."
    wt_dancers_gale: { appliesTo: { kind: 'ability', ability: 'wt_dancerwind' },
      special: { prompt: { label: 'Extra AP', max: '6' }, onConsume: { ap: '@spent' }, grantExtra: [ch('system.bonuses.speed', '5*@spent')] } },
  },

  /* ======================================================================================================== */
  /*  Passive modifiers                                                                                       */
  /* ======================================================================================================== */
  modifier: {
    // Contract Tome: "Gain +1 to your MD, TD, or PD … (choose one when you take this ability)."
    mg_contract_tome: ['pd', 'md', 'td'].map((d) => ({ label: 'Lawful Protection', target: `defense.${d}`, mode: 'add', scope: 'all', value: '1',
      predicate: when(`self:pick:mg_contract_tome:${d}`) })),
    // Elder Tome: "Gain +1 to your Check DC".
    mg_elder_tome: [{ label: 'Lawful Protection', target: 'checkDc', mode: 'add', scope: 'all', value: '1', predicate: [] }],
    mg_torus_touch: [{ label: 'Torus Touch', target: 'damage', mode: 'step', scope: 'mg_clotsnipe', value: '1', predicate: [] }],
    mg_greater_missives: [{ label: 'Greater Missives', target: 'damage', mode: 'step', scope: 'mg_magic_missive', value: '1', predicate: [] }],
    // Barbed Stare: one dice type more for each turn the Focus has been maintained (1D6 on the first, 1D8 on the second).
    mg_barbed_stare: [{ label: 'Barbed Stare', target: 'damage', mode: 'step', scope: 'mg_barbed_stare',
      value: 'max(0, @combat.focusRounds.mg_barbed_stare - 1)', predicate: [] }],
    // Greater Glaring (designer's ruling): one more dice type for each round of the Focus after the first that you kept
    // without having moved (willingly or not) since it began; from your first move on, only Barbed Stare's own one a turn.
    mg_greater_glaring: [{ label: 'Greater Glaring', target: 'damage', mode: 'step', scope: 'mg_barbed_stare',
      value: '@combat.stillRounds.mg_barbed_stare', predicate: [] }],
    // Law of Exchange: "All attacks made against you have Advantage for as long as you maintain Focus on this."
    mg_law_of_exchange: [{ label: 'Law of Exchange', target: 'incomingAdvantage', mode: 'add', value: '1',
      predicate: when('self:combat:focus-rounds:mg_law_of_exchange>=1') }],
    // Mastery of the Body (Magus L5): "Gain 2 additional HP per level" (Magus level).
    mg_mastery_of_the_body: [{ label: 'Mastery of the Body', target: 'health.max', mode: 'add', scope: 'all', value: '2*@professionLevel.magus', predicate: [] }],
    // Mastery of the Mind (Legendary): "Gain 1X Advantage to all Wiles and Fate Checks you make."
    mg_legendary_mind_advantage: ['wiles', 'fate'].map((t) => ({ label: 'Mastery of the Mind', target: 'resistAdvantage', mode: 'add', value: '1',
      predicate: when(`self:checking:trait:${t}`) })),
    // Twisting Touch / Mastery of Vengeance: Baneful Scratch's dice one type up each.
    wt_twisting_touch: [{ label: 'Twisting Touch', target: 'damage', mode: 'step', scope: 'wt_baneful_scratch', value: '1', predicate: [] }],
    wt_mastery_of_vengeance: [{ label: 'Mastery of Vengeance', target: 'damage', mode: 'step', scope: 'wt_baneful_scratch', value: '1', predicate: [] }],
    // Traumatic Shift: "the second target gets 1X Disadvantage on Trait Checks against the effect."
    wt_traumatic_shift: [{ label: 'Traumatic Shift', target: 'saveAdvantage', mode: 'add', scope: 'wt_transmute_trauma', value: '-1', predicate: [] }],
  },

  /* ======================================================================================================== */
  /*  Per-use choices and standing picks                                                                      */
  /* ======================================================================================================== */
  choice: {
    mg_command: { prompt: 'Command', options: [{ value: 'drop', label: 'Drop (Prone)' }, { value: 'attack', label: 'Attack a target you choose' },
      { value: 'approach', label: 'Approach you' }, { value: 'flee', label: 'Flee from you' }] },
    mg_lesser_restore: { prompt: 'Remove levels of', options: options(['delirium', 'jinxed', 'slowed', 'sting', 'fatigue', 'frenzy', 'panic', 'taunt', 'surprised'],
      { fatigue: 'Greater Restore', frenzy: 'Greater Restore', panic: 'Greater Restore', taunt: 'Greater Restore', surprised: 'Greater Restore' }) },
    wt_witchs_finger: { prompt: 'Which condition?', options: options(ADVERSARIAL,
      Object.fromEntries(ADVERSARIAL.filter((k) => !WEAK.includes(k)).map((k) => [k, "Witch's Control"]))) },
    wt_shield_transference: { prompt: 'Lower one defense, raise another', options: ['pd', 'md', 'td'].flatMap((lo) => ['pd', 'md', 'td']
      .filter((hi) => hi !== lo).map((hi) => ({ value: `${lo}-${hi}`, label: `Lower ${lo.toUpperCase()}, raise ${hi.toUpperCase()}` }))) },
    wt_razorleaf: { prompt: 'Which weapon type?', options: options(WEAPON_TYPES) },
    wt_needlepine: { prompt: 'Which weapon type?', options: options(WEAPON_TYPES) },
    wt_fourleaf_touch: { prompt: 'Fourleaf Touch', requires: 'wt_threeleaf_touch', options: [{ value: 'ally', label: 'An ally (raise their Check DC)' },
      { value: 'enemy', label: 'An enemy (Threeleaf Touch: lower it)' }] },
    wt_give_of_thyself: conditionChoice('Which condition?'),
    wt_transmute_trauma: conditionChoice('Which condition moves?'),
    wt_springs_surge: conditionChoice('Which condition?', ['madness']),
    wt_wild_rebuke: conditionChoice('Which condition?'),
    wt_toxin_to_tonic: { prompt: 'Which condition becomes a tonic?', options: options(['nausea', 'paralysis', 'delirium', 'slowed', 'sting']) },
    wt_winter_frost: conditionChoice('Which condition becomes Enduring?'),
  },
  pick: {
    mg_contract_tome: { kind: 'defense', options: ['pd', 'md', 'td'] },
    wt_poured_mold: { kind: 'condition', options: ['corroded', 'debilitated', 'pulled', 'hemorrhage', 'frenzy', 'panic', 'taunt'] },
    wt_witchs_presence: { kind: 'condition', options: WEAK },
    wt_promise_of_vengeance: { kind: 'creature' },
  },

  /* ======================================================================================================== */
  /*  Costs, prompts, Focus behavior, usage                                                                   */
  /* ======================================================================================================== */
  // Signature-pool costs the prose detector can't read (`costs.pool`).
  pool: {
    // "Choose the corpses of up to X creatures … where X is half your Proficiency Score (rounded up). Expend X Spell Slots."
    mg_animate_dead: { key: 'spell', amount: 0, variable: true, max: half },
    // "Expend Divine Touch Points equal to the level of that condition they possess."
    wt_toxin_to_tonic: { key: 'divine', amount: 0, variable: true, max: '' },
    // "For every successful Trait Check your ally makes against the effect, you may expend one Divine Touch point".
    wt_wild_rebuke: { key: 'divine', amount: 0, variable: true, max: '' },
  },
  // A number chosen at use → `@spent`.
  amountPrompt: {
    mg_life_transference: { label: 'Dice to roll (XD6)', max: half },
    wt_give_of_thyself: { label: 'Trait Checks to make', max: `${half} + @owns.wt_greater_giving*(@proficiency - ${half})` },
    wt_transmute_trauma: { label: 'Levels to move', max: half },
    wt_heretics_bane: { label: 'Levels of the condition they hold', max: '6' },
  },
  // Extra AP on a consistent action → `@extraAp`.
  extraAp: {
    // "For every additional AP you expend beyond the first … (to a limit of your Proficiency), increase the dice type of
    // the attack by one dice type, and the range by 10ft. When you make this attack, lose 1D4 HP per AP expended."
    mg_clotsnipe: { max: '@proficiency', label: 'Additional AP (one dice type and 10ft each)', selfDamagePerAp: '1d4', stepPerAp: 1 },
    // "Expend AP (in addition to the AP to use Bloomgift) up to half your Proficiency, rounded up."
    wt_bloomgift: { max: half, label: 'AP for reactions (one each)' },
    // Into Fire: "You may use Touch the Flame as a consistent action. For each AP you expend beyond the first, trigger
    // the next level of Hemorrhage."
    wt_touch_the_flame: { max: '5*@owns.wt_into_fire', label: 'Additional AP (Into Fire)' },
    // Hold the Brush: "You must expend additional AP (in addition to Hold the Brush) on the Focus action you select".
    wt_hold_the_brush: { max: '6', label: 'AP for the held Focus action' },
  },
  focus: {
    mg_law_of_alliance: { endOnOwnTurn: true },
    mg_pact_of_the_earth: { endOnOwnTurn: true },
    mg_law_of_exchange: { endOnOwnTurn: true },
    mg_baneful_trade: { endOnOwnTurn: true },
    // The Witch's ally Focuses: "Every turn you maintain Focus, you can only renew Focus … within 5ft of that ally."
    ...Object.fromEntries(['wt_eye_for_damage', 'wt_shield_transference', 'wt_self_heal', 'wt_razorleaf', 'wt_needlepine', 'wt_hold_the_brush',
      'wt_fourleaf_touch', 'wt_poured_mold', 'wt_bleeding_bane', 'wt_allied_spirit_blade', 'wt_winter_frost'].map((id) => [id, { renewWithin: 5 }])),
  },
  usage: {
    // "You may only initiate Focus on this when you are below half HP."
    mg_baneful_trade: { requires: when('self:hp-below-half'), requiresLabel: 'below half HP' },
  },
  multiAttack: {
    mg_clotsnipe: { count: 0, targeting: 'each', requiresAbility: '', upgrade: { ability: '', count: 0 } },
    mg_magic_missive: { count: 0, countFormula: half, targeting: 'split', requiresAbility: '', upgrade: { ability: '', count: 0 } },
  },
  // Chill Touch: 1D10 → 2D6 @5 → 2D8 @11.
  selfScaling: {
    mg_chill_touch: [{ level: 5, ladderIndex: 5 }, { level: 11, ladderIndex: 6 }],
  },
  zone: {
    // Pact of the Earth: "all ground within 30ft of you is considered Difficult Terrain for all creatures."
    mg_pact_of_the_earth: { shape: 'circle', size: '30', anchor: 'caster', followCaster: true, difficult: true, effect: { affects: 'all' } },
  },
};
