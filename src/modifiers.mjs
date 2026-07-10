/**
 * Hand-authored conditional modifiers, keyed by ability `catalogId` (see
 * docs/conditional-modifiers.md). Merged into `system.modifiers` at pack-build time.
 *
 * These are **authored, not auto-detected** — each effect + predicate is transcribed by hand from
 * the book prose, because a modifier that silently misfires is worse than none. Only abilities whose
 * trigger *and* numeric effect are unambiguous belong here; everything else stays descriptive.
 *
 * Predicate atoms are `{atom}` objects to match the item schema's `predicate` ArrayField.
 */
/**
 * Per-use choice definitions, keyed by catalogId. When present, activating the ability prompts the
 * player to pick one option; the pick becomes a `self:choice:<catalogId>:<value>` roll option that
 * paired modifiers gate on (see docs/conditional-modifiers.md).
 */
/**
 * Target-mark definitions (Layer B), keyed by catalogId. When present, activating the ability records
 * the current target(s) under `actor.system.marks[key]`; later abilities gate a modifier on
 * `target:mark:<key>` (see docs/conditional-modifiers.md). `exclusive` (default) makes each use move
 * the mark to the new target set.
 */
/**
 * Focus-maintenance behavior, keyed by catalogId. `breaksOnMove` drops the ability's maintenance
 * streak (`combatState.focusRounds`) as soon as the actor moves (see docs/conditional-modifiers.md).
 */
export const FOCUS_OVERRIDES = {
  // Stood Ground — "If you leave the square … Focus ends." Moving breaks the streak, so Fight Reflex's
  // per-round ramp resets. (Hovering Foe, by contrast, moves *with* the target and would not set this.)
  stood_ground: { breaksOnMove: true },
};

/**
 * Authored inflicts, keyed by catalogId, for save abilities whose prose *describes* an effect without
 * naming a tracked condition (so `detectInflict` can't pick it up). Merged onto the ability's activity
 * at build. Each entry is `{ condition, amount }` (amount a roll formula, e.g. '1' or '@proficiency').
 */
export const INFLICT_OVERRIDES = {
  // "…they cannot speak or cast spells…" — the effect is the Silenced condition (enduring; cleared by a
  // Make-Trait-Check), never named in prose. Applied at 1 level (binary in practice).
  curse_of_the_bound_tongue: [{ condition: 'silenced', amount: '1' }],

  // Sentinel save-inflicts (pure save activities) whose condition the detector doesn't name. Simple
  // conditions (Prone, Surprised) apply as a token status on a failed save. (Slinger / Low Slingblow
  // are attack+save hybrids — the attack-inflict backlog — so they're not authored here.)
  hobbler: [{ condition: 'prone', amount: '1' }],          // Finesse save → knocked Prone (area)
  prone_strike: [{ condition: 'prone', amount: '1' }],     // Finesse save → knocked Prone
  sharp_rocks: [{ condition: 'surprised', amount: '1' }],  // Wiles save → Surprised
  flashfire: [{ condition: 'surprised', amount: '1' }],    // Wiles save → Surprised (reaction)
};

/**
 * Ally-grant definitions (see docs/conditional-modifiers.md — "granted effects"), keyed by catalogId.
 * A buff the ability places on *other* tokens: `changes` are Active-Effect changes whose `value` is a
 * formula resolved against the *caster's* numbers at cast time. `duration.type: 'focus'` anchors the
 * grant to a caster-side Focus effect so it's reaped the moment the caster stops maintaining.
 */
export const GRANT_OVERRIDES = {
  // "Choose allies up to your Madness within 60ft … they add half your Fate (rounded up) to their MD,
  // until the spell ends." A Focus-maintained ally defense buff (+MD). Ally selection / range is the
  // player's (targeting); the number scales off the caster's Fate at cast time.
  blessing_of_dreams: {
    scope: 'allies', label: 'Blessing of Dreams',
    duration: { type: 'focus' },
    changes: [{ key: 'system.bonuses.defense.md', mode: 2, value: 'ceil(@fate/2)' }],
  },

  // "Choose one target within 5ft … as long as you maintain Focus, increase the basic damage dice of
  // any weapon they use by one dice type." A Focus-maintained die-step grant. Works whether the target
  // is an ally or the caster (a grant applies to whichever token is targeted), so no self/ally split.
  blessing_of_iron: {
    scope: 'ally', label: 'Blessing of Iron',
    duration: { type: 'focus' },
    changes: [{ key: 'system.bonuses.dieStep', mode: 2, value: '1' }],
  },

  // "Choose one target within 60ft … the next time that target would take damage, reduce that damage
  // by 4X, where X is your Proficiency." A consumed-on-damage grant: a one-shot DR of 4×Proficiency
  // that feeds the target's next incoming-damage calc and is then spent (resolveAttack → consumeGrants).
  blessing_of_the_shield: {
    scope: 'ally', label: 'Blessing of the Shield',
    duration: { type: 'consumed', on: 'damage-taken' },
    changes: [{ key: 'system.bonuses.defense.dr', mode: 2, value: '4*@proficiency' }],
  },

  // "Choose a target within 60ft … reduce your Madness by up to M. Increase the damage dealt on that
  // target's next attack (if they hit) by 1 Dice Type per level of Madness expended." A consumed-on-
  // attack die-step grant whose magnitude is a variable Madness spend: the caster is prompted for how
  // much Madness to burn (capped at their current Madness, `@madness`), that many levels are deducted,
  // and `@spent` die-steps ride the target's next attack, then the grant is spent (resolveAttack).
  blessing_of_hot_coal: {
    scope: 'ally', label: 'Blessing of Hot Coal',
    duration: { type: 'consumed', on: 'attack' },
    spend: { resource: 'madness', max: '@madness' },
    changes: [{ key: 'system.bonuses.dieStep', mode: 2, value: '@spent' }],
  },
};

export const MARK_OVERRIDES = {
  // Sentinel — "Choose one target. For each turn you maintain Focus on that target, reduce damage
  // they deal to you…" The chosen target is the mark; Fight Reflex reads it. (The per-attacker damage
  // reduction on the *self* side isn't automatable — our DR sink is global, not per-source — so Stood
  // Ground's automated footprint is the mark it sets; the defensive ramp stays descriptive.)
  stood_ground: { key: 'stood-ground', exclusive: true },

  // Sentinel Focused Enemy — "For each turn you maintain Focus on a Favored Enemy, increase all to-hits
  // against the target by 1 (max Proficiency)." The focused target is the mark; the ramp (below) reads it.
  focused_enemy: { key: 'focused-enemy', exclusive: true },
};

export const CHOICE_OVERRIDES = {
  blessing_of_the_iron_wall: {
    prompt: 'Choose a defense to reinforce',
    options: [
      { value: 'pd', label: 'Physical Defense' },
      { value: 'md', label: 'Mental Defense' },
      { value: 'td', label: 'Toughness Defense' },
    ],
  },
};

export const MODIFIER_OVERRIDES = {
  // Thug — "For every successful melee attack made consecutively this turn against a single target,
  // increase your to-hit on subsequent attacks by +1 (to a max of your Proficiency)." The
  // consecutive-hit streak is the auto-counter; the Proficiency cap is `min(...)`.
  thug_chained_advance: [{
    label: 'Chained Advance',
    target: 'toHit', mode: 'add', scope: 'melee',
    value: 'min(@combat.consecutiveHits, @proficiency)',
    predicate: [{ atom: 'self:combat:consecutive-hits>=1' }],
  }],

  // Thug — "For every successful melee attack made consecutively this turn, add 1D4 to damage on
  // additional attacks (to a max of XD4 where X is your Proficiency)." A dice-valued conditional
  // damage bonus on all melee attacks; the die count is the consecutive-hit streak, capped at
  // Proficiency, and resolves at roll time so it scales as the streak grows.
  thug_consecutive_threat: [{
    label: 'Consecutive Threat',
    target: 'damageDice', mode: 'add', scope: 'melee',
    value: '(min(@combat.consecutiveHits, @proficiency))d4',
    predicate: [{ atom: 'self:combat:consecutive-hits>=1' }],
  }],

  /* ---- Oracle: Madness / Insanity cluster ----
     Madness is the auto-tracked leveled condition (`@madness`); Insanity is the token status
     (`self:insane`, see config simpleConditions). Two supersede pairs: damage (Mindmaze ⇽ Labyrinth
     Gaze) and DR (Withered Bloom ⇽ Withered Fruit). */

  // "Whenever you are Insane, add half your Proficiency (rounded up) to damage you deal." Superseded
  // by Labyrinth Gaze (which adds full Proficiency), so it drops out while that ability is owned.
  mindmaze: [{
    label: 'Mindmaze',
    target: 'damage', mode: 'add', scope: 'all',
    value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:insane' }, { atom: '!self:ability:labyrinth_gaze' }],
  }],

  // "Instead of half your Proficiency, add your full Proficiency to any damage you deal while Insane."
  labyrinth_gaze: [{
    label: 'Labyrinth Gaze',
    target: 'damage', mode: 'add', scope: 'all',
    value: '@proficiency',
    predicate: [{ atom: 'self:insane' }],
  }],

  // "Gain Damage Resistance equal to half your current Madness (rounded up) when you are not insane."
  // Superseded by Withered Fruit (which grants full Madness), so it drops out while that is owned.
  withered_bloom: [{
    label: 'Withered Bloom',
    target: 'defense.dr', mode: 'add', scope: 'all',
    value: 'ceil(@madness/2)',
    predicate: [{ atom: '!self:insane' }, { atom: '!self:ability:withered_fruit' }],
  }],

  // "Increase the benefit of Withered Bloom from half your current Madness to your full current Madness."
  withered_fruit: [{
    label: 'Withered Fruit',
    target: 'defense.dr', mode: 'add', scope: 'all',
    value: '@madness',
    predicate: [{ atom: '!self:insane' }],
  }],

  // "Apply the effects of Withered Bloom when you are insane." Extends the Madness→DR cluster (which
  // otherwise only pays out while *not* insane) to the insane case, mirroring the Bloom/Fruit split so
  // owning Withered Fruit still upgrades half→full Madness.
  withered_seed: [
    { label: 'Withered Seed', target: 'defense.dr', mode: 'add', scope: 'all',
      value: 'ceil(@madness/2)',
      predicate: [{ atom: 'self:insane' }, { atom: '!self:ability:withered_fruit' }] },
    { label: 'Withered Seed', target: 'defense.dr', mode: 'add', scope: 'all',
      value: '@madness',
      predicate: [{ atom: 'self:insane' }, { atom: 'self:ability:withered_fruit' }] },
  ],

  // "Increase the damage of Forbidden Knowledge by one dice type." An unconditional die-step scoped to
  // the Oracle's core attack — `mode: 'step'` on `damage` bumps its denomination one rung up the ladder.
  past_the_web: [{
    label: 'Past the Web',
    target: 'damage', mode: 'step', scope: 'forbidden_knowledge', value: '1',
    predicate: [],
  }],

  // "When you have less than half HP, increase the damage dice dealt by Forbidden Knowledge by one dice
  // type." Same die-step, gated on the existing `self:hp-below-half` option. Stacks with Past the Web.
  bloodied_shadows: [{
    label: 'Bloodied Shadows',
    target: 'damage', mode: 'step', scope: 'forbidden_knowledge', value: '1',
    predicate: [{ atom: 'self:hp-below-half' }],
  }],

  // "As long as you maintain Focus, gain temporary PD, MD, or TD (choose one) equal to half your
  // Madness (rounded up)." Maintained = activated this turn (`self:used:*`); the chosen defense is a
  // per-use choice (`self:choice:*`). One modifier per defense; only the chosen one's predicate holds.
  blessing_of_the_iron_wall: ['pd', 'md', 'td'].map((def) => ({
    label: 'Blessing of the Iron Wall',
    target: `defense.${def}`, mode: 'add', scope: 'all',
    value: 'ceil(@madness/2)',
    predicate: [
      { atom: 'self:used:blessing_of_the_iron_wall' },
      { atom: `self:choice:blessing_of_the_iron_wall:${def}` },
    ],
  })),

  /* ---- Weapon-family conditional buffs (require an equipped gear item tagged with the trait) ---- */

  // Fatebound mastery — "+1 to attack and damage rolls with your divine weapon if you wield a heavy
  // weapon." Gated on wielding a "heavy"-tagged weapon; two effects (to-hit and damage).
  mastery_heavy_weapons: [
    { label: 'Heavy Weapons Mastery', target: 'toHit', mode: 'add', scope: 'all', value: '1',
      predicate: [{ atom: 'self:wielding:heavy' }] },
    { label: 'Heavy Weapons Mastery', target: 'damage', mode: 'add', scope: 'all', value: '1',
      predicate: [{ atom: 'self:wielding:heavy' }] },
  ],

  /* ---- Unconditional defense passives (always-on while owned; empty predicate) ---- */

  // "Increase your PD/MD/TD/AD by 1 on top of any armor." Taken up to twice for the Trained line —
  // we author a single +1 (a second instance isn't representable without a times-taken mechanic).
  trained_body: [{ label: 'Trained Body', target: 'defense.pd', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  trained_mind: [{ label: 'Trained Mind', target: 'defense.md', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  trained_finesse: [{ label: 'Trained Finesse', target: 'defense.td', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  just_luck: [{ label: 'Just Luck', target: 'defense.ad', mode: 'add', scope: 'all', value: '1', predicate: [] }],

  // "When you wield both a shield and a spear-family weapon, increase your PD by 1."
  shield_and_spear: [{
    label: 'Shield and Spear', target: 'defense.pd', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: 'self:wielding:shield' }, { atom: 'self:wielding:spear' }],
  }],

  /* ---- Maintain-Focus self-buffs (gated on `self:used:*`; the log clears at turn start, which is
         exactly "as long as you maintain Focus" / "until the start of your next turn") ---- */

  // "As long as you maintain Focus, gain DR equal to half your Proficiency (rounded up)."
  thug_thickskin: [{
    label: 'Thickskin', target: 'defense.dr', mode: 'add', scope: 'all', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:used:thug_thickskin' }],
  }],

  // "As an action while wielding a two-handed weapon, add +2 to your PD and TD until the start of
  // your next turn." Gated on having used it this turn + wielding a two-handed weapon.
  weapon_defense: ['pd', 'td'].map((def) => ({
    label: 'Weapon Defense', target: `defense.${def}`, mode: 'add', scope: 'all', value: '2',
    predicate: [{ atom: 'self:used:weapon_defense' }, { atom: 'self:wielding:two-handed' }],
  })),

  // "You and all allies within 15ft add half your Proficiency (rounded up) to all damage." Self
  // portion only — the ally buff isn't automatable (it affects other actors).
  call_of_power: [{
    label: 'Call of Power', target: 'damage', mode: 'add', scope: 'all', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:used:call_of_power' }],
  }],

  /* ---- Target-condition modifiers (Layer A — gated on the targeted token's state at roll time) ---- */

  // "Whenever you make a melee attack against a creature with Surprise, do so with 1X advantage."
  thug_silent_strike: [{
    label: 'Silent Strike', target: 'advantage.toHit', mode: 'add', scope: 'melee', value: '1',
    predicate: [{ atom: 'target:condition:surprised' }],
  }],

  // "When you successfully hit a Surprised creature, increase the base dice type of your damage by
  // one type." Modeled as a damage die-step vs a surprised target (damage only lands on a hit anyway).
  // Sentinel — "When you attack a target within 5ft using a ranged weapon, increase the dice type by
  // one." A die-step on ranged attacks gated on the new `target:adjacent` (within-5ft) option.
  too_close: [{
    label: 'Too Close!', target: 'damage', mode: 'step', scope: 'ranged', value: '1',
    predicate: [{ atom: 'target:adjacent' }],
  }],

  // Sentinel Favored Enemy — "Increase all damage you deal to your Favored Enemy type by your Wiles
  // score." Gated on the target being one of the character's favored creature types (`target:favored`).
  favoritism: [{
    label: 'Favoritism', target: 'damage', mode: 'add', scope: 'all', value: '@wiles',
    predicate: [{ atom: 'target:favored' }],
  }],

  // Sentinel Focused Enemy — a to-hit ramp of +1 per maintained Focus round vs the focused target,
  // capped at Proficiency. Same shape as Fight Reflex (a focus ability that reads its own focus-round
  // counter, gated on this turn's maintenance + the target it marked), but to-hit with a `min(...)` cap.
  focused_enemy: [{
    label: 'Focused Enemy', target: 'toHit', mode: 'add', scope: 'all',
    value: 'min(@combat.focusRounds.focused_enemy, @proficiency)',
    predicate: [{ atom: 'self:used:focused_enemy' }, { atom: 'target:mark:focused-enemy' }],
  }],

  // Sentinel Favored Style — a passive self-buff keyed to *which* enemy type you favor (`self:favored:*`,
  // always-on). Only the two clean modifier variants are authored; the others (Beasts +50ft range, Great
  // Beast anti-Surround, Awoken Flora pin-advantage, Fontmade typed resistance, Undead Nausea immunity,
  // Demon crit-negate reaction) need sinks we don't have and stay descriptive/backlog.
  favored_style: [
    // Folk Fae — "damage resistance equal to half your Wiles (rounded up)."
    { label: 'Favored Style (Folk Fae)', target: 'defense.dr', mode: 'add', scope: 'all',
      value: 'ceil(@wiles/2)', predicate: [{ atom: 'self:favored:folkFae' }] },
    // Wild Fae — "when you attack a Surprised enemy, gain 1× advantage."
    { label: 'Favored Style (Wild Fae)', target: 'advantage.toHit', mode: 'add', scope: 'all',
      value: '1', predicate: [{ atom: 'self:favored:wildFae' }, { atom: 'target:condition:surprised' }] },
  ],

  // Sentinel — "When you wear only light armor, increase your PD by 1." Passive self-buff gated on the
  // derived `self:armor:only-light` (every equipped armor is light). Slightly Darker Wear stacks another
  // +1 on the same gate (a separate ability, so it adds independently rather than superseding).
  light_wear: [{
    label: 'Light Wear', target: 'defense.pd', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: 'self:armor:only-light' }],
  }],
  slightly_darker_wear: [{
    label: 'Slightly Darker Wear', target: 'defense.pd', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: 'self:armor:only-light' }],
  }],

  // Sentinel — "When you fight humanoid creatures, gain +1 to hit and damage." Target creature-type gate.
  most_dangerous_game: [
    { label: 'Most Dangerous Game', target: 'toHit', mode: 'add', scope: 'all', value: '1',
      predicate: [{ atom: 'target:type:humanoid' }] },
    { label: 'Most Dangerous Game', target: 'damage', mode: 'add', scope: 'all', value: '1',
      predicate: [{ atom: 'target:type:humanoid' }] },
  ],

  surprising_blow: [{
    label: 'Surprising Blow', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'target:condition:surprised' }],
  }],

  /* ---- Target marks (Layer B — a modifier gated on *which* target you marked) ---- */

  // Sentinel — "When you maintain Focus on Stood Ground, increase damage you deal to that target by 1
  // for each round you maintain Focus." Adds the full ramp (`@combat.focusRounds.stood_ground`, the
  // number of consecutive turns Stood Ground has been maintained) to damage vs the *marked* target,
  // while Stood Ground is maintained this turn (`self:used:stood_ground` + `target:mark:stood-ground`).
  fight_reflex: [{
    label: 'Fight Reflex', target: 'damage', mode: 'add', scope: 'all',
    value: '@combat.focusRounds.stood_ground',
    predicate: [{ atom: 'self:used:stood_ground' }, { atom: 'target:mark:stood-ground' }],
  }],
};
