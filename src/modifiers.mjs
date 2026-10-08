import { PRESTIGE } from './prestige-overrides.mjs';
import { LORE } from './lore-overrides.mjs';
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
  // Forced-movement family — the *save + condition* is automated; the actual displacement is DM-adjudicated
  // (see the forced-movement note in the ledger). Sweep's Power-save Prone was missed by the detector.
  sweep: [{ condition: 'prone', amount: '1' }],            // Power save → knocked Prone (area)

  // Bladedancer save-inflicts whose condition the detector didn't attach (the save trait *was* detected;
  // only the inflicted condition was missing). Amounts from prose; simple conditions apply as a status.
  // Bleedstep → 1 Hemorrhage, upgraded to ½Prof levels by Bleeding Dance (inflict-amount upgrade: a
  // supersede pair — exactly one entry's predicate holds for the caster's owned-ability options).
  bd_bleedstep: [
    { condition: 'hemorrhage', amount: '1', predicate: [{ atom: '!self:ability:bd_bleeding_dance' }] },
    { condition: 'hemorrhage', amount: 'ceil(@proficiency/2)', predicate: [{ atom: 'self:ability:bd_bleeding_dance' }] },
  ],
  bd_calculations: [{ condition: 'surprised', amount: '1' }],     // Wiles → Surprise (X targets)
  bd_tripping_blade: [{ condition: 'prone', amount: '1' }],       // Finesse → knocked Prone
  bd_cheststep: [{ condition: 'prone', amount: '1' }],            // Power → kept Prone (fails to stand)
  // Treacherous Throw → 1D4 Fumble, die-stepped to 1D6 by Slickthrow (+1 dice type; supersede pair).
  bd_treacherous_throw: [
    { condition: 'fumbled', amount: '1d4', predicate: [{ atom: '!self:ability:bd_slickthrow' }] },
    { condition: 'fumbled', amount: '1d6', predicate: [{ atom: 'self:ability:bd_slickthrow' }] },
  ],

  // Thug save-inflicts (the save trait was detected; the inflicted condition — a *simple* condition —
  // wasn't attached). Applied as a token status on a failed save. Natural Wrestler is the grapple
  // primer: a Finesse save that gives Wrestle Pin (the leveled `pinned` condition) at ½ Proficiency,
  // which the rest of the class then scales its damage off of (see MODIFIER_OVERRIDES, Harm, Render).
  thug_natural_wrestler: [{ condition: 'pinned', amount: 'ceil(@proficiency/2)' }], // Finesse → Pin ½Prof
  thug_feint: [{ condition: 'surprised', amount: '1' }],            // Wiles → Surprised (within 5ft)
  thug_bully: [{ condition: 'prone', amount: '1' }],               // Finesse → knocked Prone (pinned target)
  thug_blinding_strike: [{ condition: 'blinded', amount: '1' }],   // Finesse → Blinded (pinned target)
  thug_forceful_pinnings: [                                        // Power → Dragged + Prone (within 5ft)
    { condition: 'dragged', amount: '1' }, { condition: 'prone', amount: '1' },
  ],

  // Fatebound save-inflicts (the save trait was detected; the inflicted condition wasn't attached —
  // Fumble is dice-valued, and the simple conditions the detector skips). Amounts from prose.
  // Lucky Break → 1D6 Fumble, die-stepped +1 by Divine Fates and again by God-Given Luck (each "+1 dice
  // type"; they stack to 1D10). A four-entry supersede chain — exactly one matches any ownership combo.
  lucky_break: [
    { condition: 'fumbled', amount: '1d6',  predicate: [{ atom: '!self:ability:divine_fates' }, { atom: '!self:ability:god_given_luck' }] },
    { condition: 'fumbled', amount: '1d8',  predicate: [{ atom: 'self:ability:divine_fates' }, { atom: '!self:ability:god_given_luck' }] },
    { condition: 'fumbled', amount: '1d8',  predicate: [{ atom: '!self:ability:divine_fates' }, { atom: 'self:ability:god_given_luck' }] },
    { condition: 'fumbled', amount: '1d10', predicate: [{ atom: 'self:ability:divine_fates' }, { atom: 'self:ability:god_given_luck' }] },
  ],
  // Treacherous Throw → 1D4 Fumble, die-stepped to 1D6 by Slickthrow (+1 dice type; supersede pair).
  treacherous_throw: [
    { condition: 'fumbled', amount: '1d4', predicate: [{ atom: '!self:ability:slickthrow' }] },
    { condition: 'fumbled', amount: '1d6', predicate: [{ atom: 'self:ability:slickthrow' }] },
  ],
  fumbling_wander: [{ condition: 'fumbled', amount: '1d8' }],   // Fate → 1D8 Fumble (reaction)
  flourishing_touch: [{ condition: 'surprised', amount: '1' }], // Wiles → Surprised

  // Soldier — Taunting Call gives ½Prof Taunt, raised to full Proficiency by Extra Taunt, and +1 more level
  // by Big Target ("+1 additional level when you give Taunt"). A 2×2 supersede matrix over the two owned
  // upgrades — exactly one entry holds. (Big Target also boosts the multi-target Taunt Boosts, but those
  // are DM-adjudicated distribution; here it's realized on the one automated Taunt source.)
  taunting_call: [
    { condition: 'taunt', amount: 'ceil(@proficiency/2)',     predicate: [{ atom: '!self:ability:extra_taunt' }, { atom: '!self:ability:big_target' }] },
    { condition: 'taunt', amount: 'ceil(@proficiency/2) + 1', predicate: [{ atom: '!self:ability:extra_taunt' }, { atom: 'self:ability:big_target' }] },
    { condition: 'taunt', amount: '@proficiency',             predicate: [{ atom: 'self:ability:extra_taunt' }, { atom: '!self:ability:big_target' }] },
    { condition: 'taunt', amount: '@proficiency + 1',         predicate: [{ atom: 'self:ability:extra_taunt' }, { atom: 'self:ability:big_target' }] },
  ],

  // Bladedancer — Disruption (Courage save vs your Check DC to break a target's Focus). "Losing Focus" is
  // narrative (no tracked condition), so the base save carries no inflict; Surprise Disruption adds a
  // Surprised inflict on a failed save, gated on ownership (predicated inflict — fires only when owned).
  bd_disruption: [
    { condition: 'surprised', amount: '1', predicate: [{ atom: 'self:ability:bd_surprise_disruption' }] },
  ],
  blinding_divinity: [{ condition: 'blinded', amount: '1' }],   // Fate → Blinded
  bludgeonmaster: [{ condition: 'prone', amount: '1' }],        // Finesse → knocked Prone (5ft AoE slam)

  // Hulinari save-inflicts (save trait detected; the condition — simple, or a dice/variable amount — was
  // not attached). Amounts from prose.
  body_slam: [{ condition: 'prone', amount: '1' }],             // Finesse → knocked Prone
  meatclub: [{ condition: 'prone', amount: '1' }],              // Finesse → Prone (thrown enemy)
  mighty_roar: [{ condition: 'fatigue', amount: 'ceil(@proficiency/2)' }], // Courage → Fatigue ½Prof (vs prone)
  // Hulinari Deafening Caw (v1.2: enemies within 10ft) — Fate → 1D4 Fumble, 1D6 at level 5, 1D8 at level 11.
  deafening_caw: [
    { condition: 'fumbled', amount: '1d4', predicate: [{ atom: 'self:level<5' }] },
    { condition: 'fumbled', amount: '1d6', predicate: [{ atom: 'self:level>=5' }, { atom: 'self:level<11' }] },
    { condition: 'fumbled', amount: '1d8', predicate: [{ atom: 'self:level>=11' }] },
  ],
  // Bladedancer Sands and Wind: failers are Dim (vision — the GM's) … or, with Grittier Sand, Blinded.
  bd_sands_and_wind: [{ condition: 'blinded', amount: '1', predicate: [{ atom: 'self:ability:bd_grittier_sand' }] }],
  // Bladedancer Artery Strike — Hemorrhage = Proficiency; Jagged Blade (the named weapon wielded): "the first
  // time per quick rest … attempt to give them one extra level" (same attempt — merged).
  bd_artery_strike: [
    { condition: 'hemorrhage', amount: '@proficiency' },
    { condition: 'hemorrhage', amount: '1', restFlag: 'jaggedBlade', predicate: [{ atom: 'self:wielding:named:bd_jagged_blade' }] },
  ],
};

/**
 * Authored *activities*, keyed by catalogId — replaces the prose-detected activities at build. For
 * abilities the detector can't build correctly: a ranged attack whose target defense isn't named in
 * prose, an attack that inflicts a condition *instead of* damage (`noDamage`), or a save-inflict the
 * detector missed. Each entry is a full activities array (same shape as `buildActivities`).
 */
export const ACTIVITY_OVERRIDES = {
  // "Make a ranged weapon attack. If you hit, rend the target's armor by X (½ Prof) instead of dealing
  // damage." A ranged attack vs PD that inflicts Rend and deals no damage (`noDamage` suppresses the
  // bound weapon's dice). The prose names no defense, so the detector left it blank.
  destrap: [{
    type: 'attack', label: '',
    attack: { category: 'ranged', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [], noDamage: true,
    inflict: [{ condition: 'rended', amount: 'ceil(@proficiency/2)' }],
  }],

  // Thug "Frightening Berserker" — "When you are raging, … attempt to give a single target within 5ft X levels
  // of Panic, where X is the number of successful attacks you have made this turn against that target (max
  // ½ Proficiency)." Giving a condition is the target's per-level checks (book p.258): Courage vs your DC.
  thug_frightening_berserker: [{
    type: 'save', label: '',
    attack: { category: '', trait: '', defense: '' },
    save: { trait: 'courage', dc: null, onSuccess: 'none' },
    damage: [],
    inflict: [{ condition: 'panic', amount: 'min(@target.hits, ceil(@proficiency/2))' }],
  }],
  // Hulinari "Sweeping Claws" — "When in Brute Form, make an unarmed melee attack using your claws against
  // every creature within 5ft." One attack per targeted creature (MULTIATTACK 'each'); the claws' dice come
  // from the bound unarmed weapon, one type lower (MODIFIER_OVERRIDES.sweeping_claws).
  sweeping_claws: [{
    type: 'attack', label: '',
    attack: { category: 'melee', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [], inflict: [],
  }],
  // Hulinari "Reaching Claw" — "Make a melee attack against an enemy 15' from you in Brute Form. If successful,
  // move them to within 10' of you. Treat them as prone for your next attack made this turn." The pull is the
  // GM's (forced movement); the Prone-for-next-attack rides NEXT_ATTACK_OVERRIDES.
  reaching_claw: [{
    type: 'attack', label: '',
    attack: { category: 'melee', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [], inflict: [],
  }],

  // Thug "Chokehold" (reaction) — "if they fail [their Make Trait Check against your Pin] … deal XD4 damage,
  // where X is the levels of Pin they currently have. XD6 at level 5, XD8 at level 11." (+1 type Steadied —
  // MODIFIER_OVERRIDES.) The trigger is the player's; the roll is here.
  thug_chokehold: [{
    type: 'damage', label: '',
    attack: { category: '', trait: '', defense: '' }, save: { trait: '', dc: null },
    damage: [{ count: '@target.pinned', denomination: 4, formula: '', trait: '', type: '' }], inflict: [],
  }],
  // Thug "Gut Punch" (reaction) — "deal Harm damage" to the Pinned target an ally just hit: (Pin)D10.
  thug_gut_punch: [{
    type: 'damage', label: '',
    attack: { category: '', trait: '', defense: '' }, save: { trait: '', dc: null },
    damage: [{ count: '@target.pinned', denomination: 10, formula: '', trait: '', type: '' }], inflict: [],
  }],
  // Soldier "Pushback" — Power check vs being pushed 5ft (the push is the GM's). Stab Back: "…and the target
  // fails their Power Check, deal spear damage" → the bound spear's dice ride this save when owned.
  pushback: [{
    type: 'save', label: '',
    attack: { category: '', trait: '', defense: '' }, save: { trait: 'power', dc: null, onSuccess: 'none' },
    damage: [], inflict: [], weaponDamageWith: 'stab_back',
  }],

  // Sentinel "Slinger" — "Make a ranged attack with your sling. If you hit, instead of dealing damage
  // attempt to give the target X Fatigue (½ Prof). Finesse Check negates." A ranged attack that deals no
  // damage (`noDamage`) and, on a hit, inflicts Fatigue the target can negate with a Finesse Check vs your
  // Check DC (`saveNegate` — resolveAttack surfaces the save button to the defender). Detector read it as
  // passive prose. Damaging Slingblow / Slingstunner are the same attack+save-on-hit shape once walked.
  slinger: [{
    type: 'attack', label: '',
    attack: { category: 'ranged', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [], noDamage: true,
    // Slingstunner (a per-use pick, asked only when owned; once per quick rest is the player's): Fatigue =
    // Proficiency instead of ½.
    inflict: [
      { condition: 'fatigue', amount: 'ceil(@proficiency/2)', saveNegate: 'finesse', predicate: [{ atom: '!self:choice:slinger:stun' }] },
      { condition: 'fatigue', amount: '@proficiency', saveNegate: 'finesse', predicate: [{ atom: 'self:choice:slinger:stun' }] },
    ],
  }],

  // Bladedancer Domino Effect — "push your target into a second creature; that creature makes a Finesse
  // Check against your Check DC or also falls Prone." The push is DM-adjudicated; the *save + Prone* is the
  // roll portion, authored here (the prose reads as passive, so the detector built nothing). Used against
  // the second creature after Tripping Blade sets up the shove.
  bd_domino_effect: [{
    type: 'save', label: '',
    attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null },
    damage: [],
    inflict: [{ condition: 'prone', amount: '1' }],
  }],

  // "Choose one target within sling range. Attempt to give X Slowed (½ Prof). Finesse Checks negate."
  // A pure save-inflict (no attack roll) the detector didn't build (it reads as passive prose).
  reflex_test: [{
    type: 'save', label: '',
    attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null },
    damage: [],
    inflict: [{ condition: 'slowed', amount: 'ceil(@proficiency/2)' }],
  }],

  // Thug "Harm" — "Choose a pinned target within melee range. Finesse Check or take 1D10 damage per
  // level of Pin they have." The detector built a flat 1D10; the damage scales off the target's Pin, so
  // the die *count* is `@target.pinned` (mirrored into `numbers` at roll time). Zero Pin → 0d10 → 0, so
  // it's inert without a pinned target — as intended. Strength of Giants / Raging Harm die-step the d10.
  thug_harm: [{
    type: 'save', label: '',
    attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null },
    damage: [{ count: '@target.pinned', denomination: 10, formula: '', trait: '', type: '' }],
    inflict: [],
  }],

  // Thug "Render" — "Make a melee attack against a pinned target. On a hit, instead of damage, Rend once
  // per level of Pin they have." A melee attack that deals no damage and inflicts Rend equal to the
  // target's Pin. Defense is left blank → the weapon-attack fallback resolves it against the bound
  // weapon's target defense (PD for a fist).
  thug_render: [{
    type: 'attack', label: '',
    attack: { category: 'melee', trait: '', defense: '' },
    save: { trait: '', dc: null },
    damage: [], noDamage: true,
    inflict: [{ condition: 'rended', amount: '@target.pinned' }],
  }],

  /* ---- Hulinari form attacks: the detector built the attack + target defense but did not parse the
         damage dice from prose ("deals 1D10+Power damage"), so they resolved to *zero* damage. Authored
         here with their base dice. The level die-growth ("2D6 at level 5, 2D8 at level 11") is a
         selfScaling flag the detector never set → base dice only (backlog:self-scaling-authoring). ---- */

  // "Brute Form unarmed Bite — 1D10+Power on a hit." No defense named → PD via the weapon fallback.
  bite: [{
    type: 'attack', label: '',
    attack: { category: 'melee', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [{ count: '1', denomination: 10, formula: '', trait: 'power', type: '' }],
    inflict: [],
  }],

  // "Pack Form Headbutt — melee vs PD, 1D8+Finesse on a hit."
  headbutt: [{
    type: 'attack', label: '',
    attack: { category: 'melee', trait: '', defense: 'pd' },
    save: { trait: '', dc: null },
    damage: [{ count: '1', denomination: 8, formula: '', trait: 'finesse', type: '' }],
    inflict: [],
  }],

  // Call of Healing gives *temp HP*, not damage — the detector saw "XD4" and built a damage activity.
  // Clear it (the grant rides `TEMPHP_OVERRIDES` below instead).
  call_of_healing: [],
  // Astonishing Shout has no roll of its own — it grants temp HP (TEMPHP_OVERRIDES) and banks a next-
  // attack damage buff (NEXT_ATTACK_OVERRIDES). Clear the "increase damage by X" false-positive activity.
  astonishing_shout: [],
  // Dagger Threat makes two melee attacks (MULTIATTACK_OVERRIDES) but the parser built no activity — give
  // it a bare melee attack that falls back to the bound dagger's dice/defense; multiAttack rolls it twice.
  dagger_threat: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: '' } }],
  // Soldier Spear Throw — "throw a one-handed spear at a target ≤30ft, +2 damage dice." A ranged attack
  // that falls back to the bound spear's dice; the +2 die-steps ride MODIFIER_OVERRIDES below. "Treat them
  // as surprised" (advantage) is taken via the roll's advantage prompt; the once/combat + weapon-lock are DM.
  spear_throw: [{ type: 'attack', label: '', attack: { category: 'ranged', trait: '', defense: '' } }],
  // Hulinari Ribcrack — "Boost to Kick: on a failed check, deal XD6 damage, X = Finesse." Kick is a basic
  // action, so the trait-check gate is DM; the damage is the roll portion (Finesse d6, no attack roll).
  // Fatebound (Greater Elemental Weapon, Rot) — "They make a Fate Check. If they fail, reduce their HP by XD6
  // and gain temporary HP equal to half the damage dealt (X = ½ Proficiency, rounded up)." No damage on a
  // success (the prose's "half" is the drain, not a half-on-success).
  vampiric_weapon: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'fate', dc: null, onSuccess: 'none', drain: 0.5 },
    damage: [{ count: 'ceil(@proficiency/2)', denomination: 6, formula: '', trait: '', type: '' }], inflict: [] }],
  // Horn Butting / Ribcrack are Kick boosts — their damage rides Kick's failed check (BOOST_OVERRIDES
  // `special.saveDamage`), so they carry no activity of their own.
  ribcrack: [],
  thug_horn_butting: [],

  // Soldier L3 — "Attempt to give one enemy within 10ft of you Taunt equal to half your Proficiency (rounded
  // up). They roll Courage Checks against the effect."
  sol_imposing_figure: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'courage', dc: null }, damage: [], inflict: [{ condition: 'taunt', amount: 'ceil(@proficiency/2)' }] }],
  // Hulinari L3 — the beast's Fate Check (the alliance itself is the GM's).
  hul_bestial_respect: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'fate', dc: null }, damage: [], inflict: [] }],

  // Thug Pained Bash — "If you hit, lose X HP and deal XD4+Power damage, where X is your Proficiency."
  thug_pained_bash: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: 'pd' }, save: { trait: '', dc: null },
    damage: [{ count: '@proficiency', denomination: 4, formula: '', trait: 'power', type: '' }], inflict: [], selfCostOnHit: '@proficiency' }],

  // Hulinari Charge the Line — "Any creature along that line … must make a Finesse Check or be knocked 5ft
  // away from that line." The check (the knock-away is the GM's, per the forced-movement policy); Momentum
  // adds Prone to the failure; Hoofstomp deals XD4 (X = ½ Prof; Flattened Earth: Prof; The Stompening: D6 —
  // a die-step modifier) to failers — zero dice unless Hoofstomp is owned.
  charge_the_line: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null, onSuccess: 'none' },
    damage: [{ count: '@owns.hoofstomp * max(ceil(@proficiency/2), @owns.flattened_earth * @proficiency)', denomination: 4, formula: '', trait: '', type: '' }],
    inflict: [{ condition: 'prone', amount: '1', predicate: [{ atom: 'self:ability:momentum' }] }] }],

  // Oracle Sphere Insanium — the prose's Wiles Check is the caster's own end-of-turn check (turn hooks), not
  // a save it forces; the Delirium is given without checks at the caster's turn start.
  sphere_insanium: [],

  // Hulinari Beastly Presence — "Expense X Savage Points (X up to ½ Proficiency, rounded up). Attempt to give
  // one target within 5ft of you that many levels of Panic or Taunt." X is the variable Savage spend; both are
  // mental conditions, resisted with Courage (the book's default for Panic/Taunt).
  beastly_presence: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'courage', dc: null }, damage: [], inflict: [{ condition: '@choice', amount: '@spent' }] }],

  // Fatebound Blade Aura — same text as the Bladedancer's: Finesse check or 1D6 slashing (1D8 @5, 1D10 @11).
  blade_aura: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null, onSuccess: 'none' }, damage: [{ count: '1', denomination: 6, formula: '', trait: '', type: '' }], inflict: [] }],
  // Fatebound Blaze of Glory — "Finesse Check against 1D8+Fate elemental damage, taking half as much on a
  // successful check. 1D10 at level 5, 2D6 at level 11." (The 2D6 is one ladder step past 1D10 — a level-11
  // die-step modifier below.)
  blaze_of_glory: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null, onSuccess: 'half' }, damage: [{ count: '1', denomination: 8, formula: '', trait: 'fate', type: '' }], inflict: [] }],
  // Sentinel Low Slingblow — "If you hit, instead of dealing damage attempt to give the target X levels of
  // Fatigue equal to your Proficiency. Power Check negates."
  low_slingblow: [{ type: 'attack', label: '', attack: { category: 'ranged', trait: '', defense: 'pd' }, save: { trait: '', dc: null },
    damage: [], noDamage: true, inflict: [{ condition: 'fatigue', amount: '@proficiency', saveNegate: 'power' }] }],

  // Bladedancer Tripped Up — "attempt to give one target within your versatile weapon's range levels of Pulled
  // equal to half your Proficiency, rounded up." A Finesse Check (designer's ruling; v1.2 names no trait). The Weapon
  // Tail prerequisite and the weapon lockout are the player's.
  bd_tripped_up: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' },
    save: { trait: 'finesse', dc: null }, damage: [], inflict: [{ condition: 'pulled', amount: 'ceil(@proficiency/2)' }] }],

  // Sentinel Hide Behind Hide — a Focus that makes you Hidden (sheet); the prose's "make an attack" is what
  // *ends* it, not a roll it makes.
  hide_behind_hide: [],

  // Zone abilities roll from their zone (ZONE_OVERRIDES), when a creature enters or starts its turn inside — not
  // on cast.
  draining_aura: [],
  focal_point: [],

  /* ---- Hulinari Swarm, v1.2 (Clouded Foe / Clouded Ally — see ZONE_OVERRIDES) ---- */
  // The clouds and their Focus layers have no roll of their own: their effects ride the cloud zone.
  clouded_foe: [], clouded_ally: [], sharp_cloud: [], blackcloud: [], dark_cloud: [], birdshield: [],
  guiding_wingbeats: [], swarm_effects: [], beak_blade: [], thundercloud: [], clouded_walk: [], explosive_swarm: [],
  // "Make an unarmed attack against all enemy targets inside your Swarm. Roll to-hit and damage separately against
  // each." One attack per enemy in your Clouded Foe (auto-targeted when you have no targets) with your unarmed weapon.
  birdbite: [{ type: 'attack', label: '', attack: { category: 'melee', trait: '', defense: 'pd' }, save: { trait: '', dc: null }, damage: [], inflict: [] }],
  // "All enemies within Clouded Foe make Wiles Checks against Delirium equal to half your Proficiency, rounded up."
  delirious_flock: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' }, save: { trait: 'wiles', dc: null },
    damage: [], inflict: [{ condition: 'delirium', amount: 'ceil(@proficiency/2)' }] }],
  // "Attempt to give one target within 5ft of you X levels of Delirium, where X is your Proficiency (Wiles Check negates)."
  delirius_flying: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' }, save: { trait: 'wiles', dc: null },
    damage: [], inflict: [{ condition: 'delirium', amount: '@proficiency' }] }],
  // "Move a target from one part of your Swarm to another … They make a Finesse Check against this." (The move is the GM's.)
  maneuver_cloud: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' }, save: { trait: 'finesse', dc: null }, damage: [], inflict: [] }],
  // "Choose a target … who is using the Focus action. They make a Wiles Check … losing Focus … with a failed Check." A
  // failure ends all their Focus (which one they were using is the table's).
  mimicked_caw: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' }, save: { trait: 'wiles', dc: null, ext: { onFail: { endFocus: true } } }, damage: [], inflict: [] }],
  // "Give one of the following one-word commands … They make a Wiles Check … or use their next action to follow the
  // command." Drop knocks them Prone; Stop / Flee / Attack are the GM's to run.
  absolute_mimicry: [{ type: 'save', label: '', attack: { category: '', trait: '', defense: '' }, save: { trait: 'wiles', dc: null },
    damage: [], inflict: [{ condition: 'prone', amount: '1', predicate: [{ atom: 'self:choice:absolute_mimicry:drop' }] }] }],
};

/**
 * Temp-HP grant definitions (book p.223), keyed by catalogId → `{formula, target, scaleLevels?}`. Using
 * the ability rolls `formula` once (Lifeguard / `scaleLevels` step the die) and grants that many Temp HP
 * to `self`, the targeted `allies`, or `both`. Non-stacking (a new grant takes the higher).
 */
export const TEMPHP_OVERRIDES = {
  // Soldier — "Expend a Call point and give XD4 (X = ½Prof) temp HP to you and all allies within 15ft."
  call_of_healing: { formula: '(ceil(@proficiency/2))d4', target: 'both', scaleLevels: [] },
  // Soldier — "As a reaction to an ally closing within 5ft, give them 1D4 temp HP (1D6@5, 1D8@11)."
  // The reaction trigger is manual; activating it grants to the targeted ally.
  come_and_heal: { formula: '1d4', target: 'allies', scaleLevels: [5, 11] },
  // Oracle — "remove any amount of Madness and give 1D4 temporary HP to that ally for each level of Madness
  // removed. 1D6 at level 5, 1D8 at level 11."
  blessing_of_the_hallowed_vale: { formula: '(@spent)d4', target: 'allies', scaleLevels: [5, 11], spendMadness: true },
  // Fatebound — "For each ally within 5ft (max ½Prof), gain X temp HP; X = ½Prof (rounded up)." The
  // self temp-HP half of Astonishing Shout, scaling off the positional `@adjacentAllies` count (capped
  // at ½Prof). The per-adjacent-enemy next-attack damage half rides `NEXT_ATTACK_OVERRIDES` below.
  astonishing_shout: { formula: 'ceil(@proficiency/2)*min(@adjacentAllies,ceil(@proficiency/2))', target: 'self', scaleLevels: [] },
};

/**
 * Next-attack buffs, keyed by catalogId (item `nextAttack`) — a one-shot bonus banked onto the actor's *next* attack this
 * turn (base-actor `schema.pendingAttack`), when the ability is used (`on: 'use'`) or when its attack lands (`on: 'hit'`).
 * Formulas resolve against the user's numbers at use (positional scalers included). Distinct from a Boost (which the
 * player arms and the *next matching action* consumes) — this is banked unconditionally.
 */
export const NEXT_ATTACK_OVERRIDES = {
  // Fatebound — "For each enemy within 5ft (max ½Prof), increase damage by X on your next attack this
  // turn if it hits; X = ½Prof (rounded up)." Per-adjacent-enemy flat damage banked for the next attack.
  astonishing_shout: { on: 'use', damage: 'ceil(@proficiency/2)*min(@adjacentEnemies,ceil(@proficiency/2))', label: 'Astonishing Shout' },
  // Hulinari Reaching Claw — on a landed hit: "Treat them as prone for your next attack made this turn."
  reaching_claw: { on: 'hit', targetCondition: 'prone', label: 'Reaching Claw' },
};

/**
 * On-use inflicts (no attack/save roll), keyed by catalogId — leveled conditions applied the moment the
 * ability is used, to the actor (`self`) and/or the current target(s) (`target`, auto-applied GM-side
 * since these carry no save). Amounts are `@ref` formulas resolved against the caster's numbers.
 */
/**
 * Kill triggers, keyed by catalogId — an effect that fires when the actor drops a target to 0 HP (see
 * the kill seam in sacadia.mjs). `condition` banks a next-target pending buff; `tempHp` grants temp HP
 * from the highest level tier ≤ the actor's level.
 */
export const KILLTRIGGER_OVERRIDES = {
  // Thug — "If you kill a target on your turn and make an additional attack, treat your next target as
  // Surprised for your first attack." The kill banks a next-target Surprised pending buff; the "additional
  // attack" clause is satisfied naturally — the buff rides the next attack if one is made this turn.
  thug_killing_frenzy: { condition: 'surprised' },
  // Hulinari — "Every time you kill a creature with a Bite attack, gain 1D10 temp HP (2D6 @5, 2D8 @11)."
  // Simplification: fires on *any* kill (the killing attack's ability isn't threaded through the damage-
  // apply seam) — acceptable since the Hulinari's signature attack is the Bite. Non-stacking temp HP.
  indomitable_beast: { tempHp: [{ minLevel: 0, formula: '1d10' }, { minLevel: 5, formula: '2d6' }, { minLevel: 11, formula: '2d8' }] },
};

/**
 * Multi-attack definitions, keyed by catalogId — an action that rolls its attack activity several times
 * for one AP. `count` base attacks, `targeting` split (different targets) or same (one target); `upgrade`
 * bumps the count when the actor owns the named passive (Third Arm rides Wild Strike).
 */
export const MULTIATTACK_OVERRIDES = {
  // Sweeping Claws: one claw attack against every creature within 5ft (one per targeted token).
  sweeping_claws: { count: 0, targeting: 'each', requiresAbility: '', upgrade: { ability: '', count: 0 } },
  // Bladedancer / Fatebound — "Holding a versatile weapon in each hand, make a melee attack with each for
  // one AP, against different targets." Two split attacks; Third Arm (its own variant per profession)
  // raises it to three.
  bd_wild_strike: { count: 2, targeting: 'split', upgrade: { ability: 'bd_third_arm', count: 3 } },
  wild_strike: { count: 2, targeting: 'split', upgrade: { ability: 'third_arm', count: 3 } },
  // General — "Wielding two daggers, make two melee attacks against the same target for one action."
  dagger_threat: { count: 2, targeting: 'same' },
  // Oracle — Forbidden Knowledge is single-target, but Forbidden Web (a Boost) lets it "roll against each
  // enemy in one action" (up to Proficiency). Treated as a standard multi-attack: one roll per targeted
  // token, enabled only when Forbidden Web is owned. Forbidden Web's per-target damage die-reduction and
  // the Proficiency target cap stay DM-adjudicated (owner steer), consistent with player-set-state.
  forbidden_knowledge: { targeting: 'each', requiresAbility: 'forbidden_web' },
  // Bladedancer — "Ranged attack with a versatile weapon against two targets within 5ft of each other,
  // roll to-hit separately, 1D6+Finesse each." A two-target throw (its damage die grows by level via
  // SELFSCALING below); Triple Throw raises it to three.
  bd_plural_throw: { count: 2, targeting: 'split', upgrade: { ability: 'bd_triple_throw', count: 3 } },
  // Hulinari Birdbite (v1.2): one attack per enemy inside your Swarm.
  birdbite: { count: 1, targeting: 'each', requiresAbility: '', upgrade: { ability: '', count: 0 } },
};

/**
 * Level self-scaling of a damage die, keyed by catalogId → `[{level, ladderIndex}]` (highest reached
 * wins; grows the die *denomination*, keeping the count). Baked into `flags.sacadia.selfScaling`, read by
 * #rollDamage. For overrides whose scaling the Roll20 catalog didn't encode.
 */
export const SELFSCALING_OVERRIDES = {
  // Chokehold XD4 → XD6 @5 → XD8 @11; Vision of Snapping Turtle MD4 → MD6 @6 → MD8 @11.
  thug_chokehold: [{ level: 5, ladderIndex: 2 }, { level: 11, ladderIndex: 3 }],
  vision_of_snapping_turtle: [{ level: 6, ladderIndex: 2 }, { level: 11, ladderIndex: 3 }],
  // Plural Throw: 1D6 base → 1D8 at 5 → 1D10 at 11 (ladder d8=index 3, d10=index 4).
  bd_plural_throw: [{ level: 5, ladderIndex: 3 }, { level: 11, ladderIndex: 4 }],
  blade_aura: [{ level: 5, ladderIndex: 3 }, { level: 11, ladderIndex: 4 }],
  blaze_of_glory: [{ level: 5, ladderIndex: 4 }],
};

export const ONUSE_OVERRIDES = {
  // Soldier Call of Fury: "choose one ally … as well as a number of unspent AP up to half your maximum AP (rounded up).
  // Expend those AP now. On your chosen ally's next turn, they receive additional AP equal to the number you expended."
  call_of_fury: { self: [], target: [], selfGain: { hp: '', ap: '0 - @spent', lore: '', reactions: '' }, apNext: '@spent' },
  // Fatebound Spring Weapon: "exhaust any number of unused reactions. They gain 1AP per reaction you exhaust".
  spring_weapon: { self: [], target: [], selfGain: { hp: '', ap: '', lore: '', reactions: '0 - @spent' }, apGain: '@spent' },
  // Oracle Open the Third Eye: hidden creatures within 5 × Madness ft are revealed, with their creature type.
  open_the_third_eye: { self: [], target: [], revealWithin: '5*@madness' },
  // Soldier Standards Elite: −1 Panic or Fatigue on the targeted creature (target yourself for yourself).
  standards_elite: { self: [], target: [{ condition: '@choice', amount: '-1' }] },
  // Soldier Call to Overcome: "Reduce all adversarial conditions on yourself or one ally within 5ft by 1 level."
  call_to_overcome: { self: [], target: [{ condition: '*adversarial', amount: '-1' }] },
  // Oracle Bloodlet: "When you initiate this ability, lose HP equal to your Fate." (Its turn-end HP-for-
  // Madness swap runs in reduceConditions while the Focus is maintained.)
  bloodlet: { self: [], target: [], selfDamage: '@fate' },
  // Oracle Quieted Mind: "remove all levels of any mental adversarial conditions as well as all Madness and
  // Insanity." Mental conditions here; the Madness (spend M) and Insanity (its latch at 0) ride the Madness
  // annotation.
  quieted_mind: { self: [{ condition: '*mental', amount: '-6' }], target: [] },
  // Oracle Bloodsapper: exhaust the chosen limb of the mover.
  bloodsapper: { self: [], target: [], exhaust: '@choice' },
  // Soldier Cornered Animal: the chosen condition doesn't reduce at the target's turn end.
  cornered_animal: { self: [], target: [], holdDecay: ['@choice'] },
  // Hulinari Protective Instinct: "Each creature chosen is given the effects of half cover until the start of
  // your next turn." Bladedancer Covering Dance: allies you encircle gain Half Cover until then.
  protective_instinct: { self: [], target: [], cover: 'half' },
  bd_covering_dance: { self: [], target: [], cover: 'half' },
  // Hulinari Steed and Rider (with Carrying the Team's advantage): "you may give the attack 2× advantage
  // instead … If you do this, gain 1 Fatigue."
  carrying_the_team: { self: [{ condition: 'fatigue', amount: '1', predicate: [{ atom: 'self:ability:steed_and_rider' }, { atom: 'self:choice:carrying_the_team:boost' }] }], target: [] },
  // Thug "Aggressive Pin" — "increase the enemy's level of Pin by one (to a max of your Proficiency). They do
  // not roll a Trait Check." A no-save, explicitly stacking +1 (0 once the Pin already equals your Proficiency).
  thug_aggressive_pin: { self: [], target: [{ condition: 'pinned', amount: 'min(1, max(0, @proficiency - @target.pinned))', stacks: true }] },
  // Sentinel — "As a reaction to a creature landing a melee attack on you, give them X Sting (½Prof,
  // rounded up); immediately take the same amount of Sting." Symmetric Sting to the attacker and self.
  predator_and_prey: {
    self: [{ condition: 'sting', amount: 'ceil(@proficiency/2)' }],
    target: [{ condition: 'sting', amount: 'ceil(@proficiency/2)' }],
  },
  // Oracle — "When an enemy within 30ft tries to move, reduce their move speed to half for that move."
  // Approximated as Slowed 1 on the mover (the tracked speed-reduction condition); the "to 5ft if
  // Steadied" clause and the per-move duration are adjudicated. Trigger auto-prompted by the move hook.
  that_sluggish_feeling: { target: [{ condition: 'slowed', amount: '1' }] },
  // Bladedancer Surprising Dance — "Give 1D4 Fumble to X targets (X = your Proficiency) within 5ft of you at
  // any point of this movement. 1D6 at level 5, 1D8 at level 11. Roll Fumble for each target separately."
  // The player targets whom the dance passed; each rolls its own die GM-side.
  bd_surprising_dance: { self: [], target: [
    { condition: 'fumbled', amount: '1d4', predicate: [{ atom: 'self:level<5' }] },
    { condition: 'fumbled', amount: '1d6', predicate: [{ atom: 'self:level>=5' }, { atom: 'self:level<11' }] },
    { condition: 'fumbled', amount: '1d8', predicate: [{ atom: 'self:level>=11' }] },
  ] },
  // Oracle Stygian Abyss — "Take X damage each turn you maintain Focus … (including the turn you initiate it)":
  // the cast turn here; later turns from the zone's upkeep at your turn start.
  stygian_abyss: { self: [], target: [], selfDamage: '@proficiency' },
  // Oracle Balanced Scale — "Choose one target … with up to N levels of Hemorrhage, Delirium, or Nausea … Reduce your
  // Madness by N. That condition gains the Enduring Condition." The Madness spend rides its annotation (M−N); the
  // chosen condition turns Enduring on the target (checking N against its level is the player's).
  balanced_scale: { self: [], target: [], enduring: '@choice' },
};

/**
 * Reaction-grant amounts, keyed by catalogId — abilities that hand the actor extra reaction(s) on use
 * (base-actor `schema.reaction`, applied in #useAbility). Distinct from the passive `reactions` modifier
 * (Rapid Reaction), which raises the per-round *max*; these bank a one-off extra for the current round.
 */
export const REACTION_GRANT_OVERRIDES = {
  // Soldier — "As an action, gain one reaction usable before the start of your next turn." (Legendary
  // Reactionary would raise this to two, but it chains off Reactionary — deferred, needs the upgrade hook.)
  reactionary: 1,
};

/**
 * Ally-grant definitions (see docs/conditional-modifiers.md — "granted effects"), keyed by catalogId.
 * A buff the ability places on *other* tokens: `changes` are Active-Effect changes whose `value` is a
 * formula resolved against the *caster's* numbers at cast time. `duration.type: 'focus'` anchors the
 * grant to a caster-side Focus effect so it's reaped the moment the caster stops maintaining.
 */
// Permanent picks (catalogId → {kind, options?}) — see item-ability `pick`. The player chooses once on the
// ability card; modifiers gate on `self:attack:picked:<id>` / `self:checking:picked:<id>` etc.
const ONE_HANDED_FAMILIES = ['dagger', 'sword', 'axe', 'bludgeon', 'unarmed', 'other']; // Swordwork: not shield/spear
const TWO_HANDED_MELEE = ['sword', 'axe', 'spear', 'bludgeon', 'other'];
const DRAIN_TOLERANT = ['corroded', 'debilitated', 'delirium', 'hemorrhage', 'jinxed', 'nausea', 'pinned', 'paralysis', 'pulled', 'slowed', 'sting'];
const NOT_IMPRESSED = ['paralysis', 'pinned', 'pulled'];
// The adversarial conditions a creature can be given (not Madness, which is your own).
const ADVERSARIAL = ['nausea', 'pinned', 'paralysis', 'corroded', 'debilitated', 'pulled', 'hemorrhage', 'delirium', 'jinxed', 'slowed', 'silenced',
  'sting', 'fatigue', 'frenzy', 'panic', 'taunt', 'fumbled', 'rended'];
export const PICK_OVERRIDES = {
  swordwork: { kind: 'weaponType', options: ONE_HANDED_FAMILIES },
  bd_harmful_hand: { kind: 'weaponType' },
  sharp_weaponry: { kind: 'weaponType' },
  big_guns_expert: { kind: 'weaponType', options: TWO_HANDED_MELEE },
  heavy_damage: { kind: 'weaponType' },
  poisontouch: { kind: 'condition', options: ['delirium', 'nausea', 'frenzy', 'hemorrhage', 'jinxed', 'slowed', 'sting'] },
  bd_not_impressed: { kind: 'condition', options: NOT_IMPRESSED },
  bd_caffeinated: { kind: 'condition', options: NOT_IMPRESSED },
  drain_tolerant: { kind: 'condition', options: DRAIN_TOLERANT },
  bolers_ban: { kind: 'condition', options: DRAIN_TOLERANT },
  poolmonger: { kind: 'pool' },
  muscle_and_memory: { kind: 'limb' },
  // Elemental Weapon (Fatebound L3): "Your divine weapon does elemental damage (choose one …: Earth, Air, Fire, Water, Rot,
  // Salt) instead of normal damage. Elemental damage overcomes physical weapon resistances."
  fb_elemental_weapon: { kind: 'element' },
  // Clever Rend: "choose one armor type (PD, TD, or MD). You rend that first." A standing pick.
  clever_rend: { kind: 'defense', options: ['pd', 'td', 'md'] },
  // The Vengeance: "one single enemy (selected when you gain this ability)" — a specific creature.
  bd_the_vengeance: { kind: 'creature', label: 'SACADIA.Pick.Label.Enemy' },
  // Bigger Stones: "You may take this ability up to twice. Each time, choose one type of ranged weapon (bow, crossbow,
  // or sling)." Taken twice, it's two copies, each with its own pick (both on the crossbow is +2 steps on it).
  bigger_stones: { kind: 'weaponType', options: ['bow', 'crossbow', 'sling'] },
  // A Favored Enemy type: "Select an enemy type when you take this", and "Choose an additional favored enemy" (I Favor
  // All Enemies, Favored Mastery). Each pick adds one type to the Sentinel's favored set (`target:favored`).
  favored_enemy: { kind: 'favored' },
  i_favor_all_enemies: { kind: 'favored' },
  legendary_favored: { kind: 'favored', label: 'SACADIA.Pick.Label.Favored' },
  // Favored Style's Fontmade option: "Choose 1 element (Rot, Salt, Earth, Fire, Air, Water); gain resistance to this damage
  // type equal to your Proficiency." Only shown when you favor Fontmade.
  favored_style: { kind: 'element', label: 'SACADIA.Pick.Label.Fontmade', requires: ['self:favored:fontmade'] },
  // Sling Mastery: "Choose one condition; increase the Check DC made against you giving a target that condition by 1."
  mastery_sling: { kind: 'condition', options: ADVERSARIAL },
  // Fated Strike: "Choose one melee basic or military weapon when you take this aspect. It becomes your divine weapon."
  fated_strike: { kind: 'divineWeapon' },
  // Bladedancer Named Weapons: "Name one versatile weapon you own" (each ability names one weapon, each weapon one name).
  bd_sharp_weapon: { kind: 'namedWeapon' },
  bd_exploding_weapon: { kind: 'namedWeapon' },
  bd_jagged_blade: { kind: 'namedWeapon' },
  bd_tricky_boy: { kind: 'namedWeapon' },
  bd_weapon_tail: { kind: 'namedWeapon' },
};

// Second picks, for an ability that makes two choices when it's taken.
export const PICK2_OVERRIDES = {
  // Favored Mastery: "Choose one favored enemy type, and add half your Wiles to your to-hit and damage against that type."
  legendary_favored: { kind: 'ownFavored', label: 'SACADIA.Pick.Label.HalfWilesVs' },
  // The Vengeance names a versatile weapon too (its first pick is the enemy).
  bd_the_vengeance: { kind: 'namedWeapon', label: 'SACADIA.Pick.Label.Weapon' },
};

// Usage overrides (catalogId → partial `usage`), layered over the build's "once per …" detection: raised
// limits (Nip and Tuck: Artery Strike twice per turn) and preconditions the prose states as a trigger.
export const USAGE_OVERRIDES = {
  bd_artery_strike: { requires: [], requiresLabel: '' }, // limit detected from prose; Nip and Tuck raises it (see USAGE_UPGRADES)
  // "You may only use this ability once per quick rest on a single target": once per quick rest per target (owner ruling).
  beastly_presence: { perTarget: true },
  bd_spreadstep: { requires: [{ atom: 'self:combat:unique-hits>=4' }], requiresLabel: 'damaged 4 separate targets this turn' },
  thug_frightening_berserker: { requires: [{ atom: 'self:raging' }], requiresLabel: 'raging' },
  thug_aggressive_pin: { requires: [{ atom: 'self:raging' }], requiresLabel: 'raging' },
  hide_behind_hide: { requires: [{ atom: 'self:combat:first-round' }], requiresLabel: 'your first turn in combat' },
  // Hulinari Swarm: the clouds and Deafening Caw need Swarm Form.
  clouded_foe: { requires: [{ atom: 'self:form:swarm' }], requiresLabel: 'in Swarm Form' },
  clouded_ally: { requires: [{ atom: 'self:form:swarm' }], requiresLabel: 'in Swarm Form' },
  deafening_caw: { requires: [{ atom: 'self:form:swarm' }], requiresLabel: 'in Swarm Form' },
};
// A passive that raises another ability's usage max (catalogId → {ability, max}).
export const USAGE_UPGRADES = {
  // Patla's Touch: "You may use the 'Divine Strike' ability a number of times equal to half your proficiency per short rest."
  patlas_touch: { ability: 'divine_strike', maxFormula: 'ceil(@proficiency/2)' },
  bd_nip_and_tuck: { ability: 'bd_artery_strike', max: 2 },
  bd_spreaderstep: { ability: 'bd_spreadstep', requires: [{ atom: 'self:combat:unique-hits>=3' }], requiresLabel: 'damaged 3 separate targets this turn' },
};

// Aid-resist (catalogId → item `aidResist`): Trait Checks made for an ally against their conditions.
export const AID_RESIST_OVERRIDES = {
  // "Make trait checks against one level of any adversarial condition from up to X targets within 15ft (X =
  // ½ Proficiency)." Relaxed Call: 1× advantage on them. Final Calm: don't roll — remove a level.
  call_of_respite: { levels: '1', maxTargets: 'ceil(@proficiency/2)', autoWith: 'final_calm', advantageWith: 'relaxed_call' },
  // "…spend a Prescient Point to roll a Trait Check against one level. If you have Steadied, you may
  // automatically succeed." (A reaction to an ally being given a mental condition.)
  vision_of_moss: { levels: '1', maxTargets: '1', autoIfSteadied: true, mentalOnly: true },
  // "Remove any number of your Madness levels and roll that number of Trait Checks against one of that
  // ally's conditions."
  blessing_of_the_burning_incense: { levels: '@spent', maxTargets: '1', spendMadness: true },
  // Witch Funnel Energy: "Make Fate Checks against the Check DC of the target with Fatigue. For every successful Trait
  // Check, remove one level of Fatigue from that target, and give the other target 1 additional AP to use on their next
  // turn." You roll one check per level of their Fatigue (owner ruling). `funnel` runs it (actor-sheet #funnelEnergy).
  wt_funnel_energy: { levels: 'fatigue', maxTargets: '2', funnel: true },
};

// Profession reaction attacks that *are* opportunity attacks (flags.sacadia.opportunity) — they emit
// `self:attack:opportunity` like the four basic ones. (The crit-when-Steadied rule is the basic four's own
// `steadiedCrit` flag; Close Quarter's Steadied benefit is boosts, not a crit.)
export const OPPORTUNITY_IDS = ['close_quarter'];


// grant-choice-redirect (catalogId → redirect spec): when `requiresAbility` is owned and an ally is
// targeted, using the ability may apply its per-use choice buff to that ally instead of the caster. The
// `<choice>` placeholder in `key` is filled by the pick. See item-ability `choiceRedirect` + #useAbility.
export const CHOICEREDIRECT_OVERRIDES = {
  // Oracle "Shared Blessing" — "When you use Blessing of the Iron Wall, choose an ally within 5ft and apply
  // its effect to them instead of you, while you maintain Focus." The Iron Wall picks a defense (PD/MD/TD);
  // the redirect keys the ally's grant off that pick, at the same ½Madness magnitude, focus-anchored to the
  // caster's Iron Wall (so it lasts exactly as long as the caster maintains it).
  blessing_of_the_iron_wall: {
    requiresAbility: 'shared_blessing',
    key: 'system.bonuses.defense.<choice>',
    value: 'ceil(@madness/2)',
    label: 'Shared Blessing',
  },
};

export const GRANT_OVERRIDES = {
  // Soldier Guard Them: "they ignore the effects of the Surrounded condition … When you lose Focus on Guard Them, gain one
  // Fatigue." (The 5ft tether is the table's.)
  guard_them: { scope: 'ally', label: 'Guard Them', duration: { type: 'focus' }, changes: [{ key: 'system.bonuses.ignoreSurrounded', mode: 2, value: '1' }],
    onEnd: { casterFatigue: 1 } },
  // Soldier Call of the Quick Blade: "X allies … within 15ft of you get one additional reaction until this call ends provided
  // they remain within the aura" (target up to Proficiency allies; leaving the aura drops it at their turn start).
  call_of_the_quick_blade: { scope: 'allies', label: 'Call of the Quick Blade', duration: { type: 'focus' }, changes: [{ key: 'system.bonuses.reactions', mode: 2, value: '1' }] },
  // Oracle Curse of the Shared Mind: those allies' failed mental checks against an enemy succeed (onSaveRoll reads it).
  curse_of_the_shared_mind: { scope: 'allies', label: 'Curse of the Shared Mind', duration: { type: 'focus' }, changes: [], marker: true },
  // Oracle Mindmeld: the soulbound target's next attack at 1× disadvantage — or an ally's next check at 1× adv.
  mindmeld: {
    scope: 'ally', label: 'Mindmeld', duration: { type: 'consumed', on: 'roll' },
    changes: [
      { key: 'system.advantage.toHit', mode: 2, value: '-1', predicate: [{ atom: 'self:choice:mindmeld:hinder' }] },
      { key: 'system.advantage.trait', mode: 2, value: '1', predicate: [{ atom: 'self:choice:mindmeld:aid' }] },
    ],
  },
  // Hulinari Confused Dance (Skittish target): 1× disadvantage on its next Trait Check.
  confused_dance: {
    scope: 'ally', label: 'Confused Dance', duration: { type: 'consumed', on: 'roll' },
    changes: [{ key: 'system.advantage.trait', mode: 2, value: '-1' }],
  },
  // Hulinari Carrying the Team: the rider's next attack at 1× advantage (2× with Steed and Rider) — or the
  // next attack against the rider at 1× disadvantage (consumed when they're attacked).
  carrying_the_team: {
    // Used in response to the triggering roll, so "whichever comes first" is exactly the intended one.
    scope: 'ally', label: 'Carrying the Team', duration: { type: 'consumed', on: 'roll|attacked' },
    changes: [
      { key: 'system.advantage.toHit', mode: 2, value: '1', predicate: [{ atom: 'self:choice:carrying_the_team:boost' }, { atom: '!self:ability:steed_and_rider' }] },
      { key: 'system.advantage.toHit', mode: 2, value: '2', predicate: [{ atom: 'self:choice:carrying_the_team:boost' }, { atom: 'self:ability:steed_and_rider' }] },
      { key: 'system.bonuses.incomingAdvantage', mode: 2, value: '-1', predicate: [{ atom: 'self:choice:carrying_the_team:shield' }] },
    ],
  },
  // Hulinari Stot: "The enemy gains 1× Disadvantage to their first attack against you on their turn."
  stot: {
    scope: 'ally', label: 'Stot', duration: { type: 'consumed', on: 'attack' },
    changes: [{ key: 'system.advantage.toHit', mode: 2, value: '-1' }],
  },
  // Soldier Call of the Raised Shield: "impose 1× advantage on X targets (you or allies) within 15ft on Trait
  // Checks against one effect" — each target's next Trait Check.
  call_of_the_raised_shield: {
    scope: 'allies', label: 'Call of the Raised Shield', duration: { type: 'consumed', on: 'roll' },
    changes: [{ key: 'system.advantage.trait', mode: 2, value: '1' }],
  },
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

  // Oracle "Partial Drivel" — "While maintaining Focus, reduce your Madness by any amount; gain that much
  // DR." A *self* focus grant whose magnitude is a variable Madness spend: the caster is prompted for how
  // much Madness to burn (capped at their current Madness, `@madness`), that many levels are deducted, and
  // `@spent` DR rides the caster's own defenses while Focus is maintained. Absolute Drivel is the same buff
  // redirected to an ally — the grant's normal `ally` path, walked when that ability is authored.
  partial_drivel: {
    // Absolute Drivel: "you may use it on an ally within 30ft of you instead of yourself" (target the ally).
    scope: 'self', label: 'Partial Drivel', allyWith: 'absolute_drivel',
    duration: { type: 'focus' },
    spend: { resource: 'madness', max: '@madness' },
    changes: [{ key: 'system.bonuses.defense.dr', mode: 2, value: '@spent' }],
  },

  /* ---- Soldier: leader / ally-support grants (same focus-maintained ally-buff shape as Blessing of
         Dreams — the player targets the ally, the number scales off the caster at cast time) ---- */

  // "For as long as you maintain Focus, an ally within 5ft adds half your Courage (rounded up) to all
  // Trait Checks." (Focus ally grant → the flat `bonuses.trait` sink.) Standing Strike upgrades it: the
  // same ally also adds half your Courage to attack damage — folded in only when the caster owns it
  // (the change's caster-side predicate).
  stand_by_me: {
    scope: 'ally', label: 'Stand By Me',
    duration: { type: 'focus' },
    changes: [
      { key: 'system.bonuses.trait', mode: 2, value: 'ceil(@courage/2)' },
      { key: 'system.bonuses.damage.all', mode: 2, value: 'ceil(@courage/2)',
        predicate: [{ atom: 'self:ability:standing_strike' }] },
    ],
  },

  // "You and all allies who can hear you within 15ft add half your Proficiency (rounded up) to all
  // damage until your Focus ends." The *self* half is a modifier (see MODIFIER_OVERRIDES.call_of_power);
  // this is the ally half — a focus grant to each targeted ally.
  call_of_power: {
    scope: 'allies', label: 'Call of Power',
    duration: { type: 'focus' },
    changes: [{ key: 'system.bonuses.damage.all', mode: 2, value: 'ceil(@proficiency/2)' }],
  },

  // "As a reaction to an ally making an attack roll within 15ft, add your Courage to that to-hit. If you
  // have Steadied, also add half your Power (rounded up)." A consumed-on-attack to-hit grant on the ally;
  // the Steadied bonus rides a caster-side `self:steadied` predicate.
  courageous_command: {
    scope: 'ally', label: 'Courageous Command',
    duration: { type: 'consumed', on: 'attack' },
    changes: [
      { key: 'system.bonuses.toHit.all', mode: 2, value: '@courage' },
      { key: 'system.bonuses.toHit.all', mode: 2, value: 'ceil(@power/2)',
        predicate: [{ atom: 'self:steadied' }] },
    ],
  },

  // "As a reaction to an enemy attacking an ally within 30ft, reduce the to-hit by half your Courage
  // (rounded up). If you have Steadied, reduce it by your full Courage." A consumed-on-attack *debuff*
  // placed on the attacking enemy (a grant applies to whichever token is targeted); the Steadied clause
  // adds the other half (ceil + floor = full) via a caster-side predicate.
  trained_tactics: {
    scope: 'ally', label: 'Trained Tactics',
    duration: { type: 'consumed', on: 'attack' },
    changes: [
      { key: 'system.bonuses.toHit.all', mode: 2, value: '-ceil(@courage/2)' },
      { key: 'system.bonuses.toHit.all', mode: 2, value: '-floor(@courage/2)',
        predicate: [{ atom: 'self:steadied' }] },
    ],
  },
  // Thug Underpinning — "Decrease the PD or TD (choose one) of a target to whom you have given Wrestle Pin by
  // half your Finesse Score (rounded up) until the start of your next turn." A debuff placed on the target.
  thug_underpinning: {
    scope: 'ally', label: 'Underpinning', duration: { type: 'rounds', rounds: 1, on: '' },
    changes: [
      { key: 'system.bonuses.defense.pd', mode: 2, value: '0 - ceil(@finesse/2)', predicate: [{ atom: 'self:choice:thug_underpinning:pd' }] },
      { key: 'system.bonuses.defense.td', mode: 2, value: '0 - ceil(@finesse/2)', predicate: [{ atom: 'self:choice:thug_underpinning:td' }] },
    ],
  },
  // Hulinari Beak & Blade — "Choose one ally within Clouded Ally … increase the damage dice of all melee attacks they
  // deal by X dice types" (X = Trickster Points spent, ≤ ½Prof). A Focus grant on the targeted ally.
  beak_blade: {
    scope: 'ally', label: 'Beak & Blade', duration: { type: 'focus', on: '' },
    changes: [{ key: 'system.bonuses.dieStepBy.melee', mode: 2, value: '@spent' }],
  },
};

/**
 * Boost definitions (see docs/conditional-modifiers.md — "boosts"), keyed by catalogId. A boost is
 * *armed* on the sheet and consumed by the next matching action, folding its `effects` (modifier-shaped
 * — target/mode/scope/value/predicate) into that action's roll. `appliesTo` matches the action: `kind`
 * `ability` targets a specific ability catalogId; `attack` (optionally a `category`) any attack; `save`
 * any save. `once` limits it to one consume per turn. Cost (if any) rides the ability's normal `costs`.
 */
export const BOOST_OVERRIDES = {
  // Soldier Call of the Enemy: "As a boost to Imposing Figure, expend X call points … Attempt to give Taunt to X enemies"
  // — target them all; each rolls the save. Call of the Drain raises X to your Proficiency (POOL_OVERRIDES).
  call_of_the_enemy: { appliesTo: { kind: 'ability', ability: 'sol_imposing_figure' } },
  // General — "Once per quick rest, add your Fate Score to any to-hit as a Boost to that attack." A flat
  // to-hit boost of `@fate` on any attack. The quick-rest limit is the detected usage limit (checked when
  // the boost is consumed); `once` also stops re-arming it this turn. Patla's Touch (use it ½Prof/short-rest)
  // rides this descriptively.
  divine_strike: {
    appliesTo: { kind: 'attack' },
    once: true,
    effects: [{ label: 'Divine Strike', target: 'toHit', mode: 'add', value: '@fate' }],
  },

  // Fatebound — "Expend one Glory point as a Boost to any melee attack against a single target. On a hit,
  // deal an additional XD6 elemental damage, where X is your Proficiency." A dice-valued damage bump on a
  // melee attack (damage lands on a hit anyway). The Glory pool cost rides the ability's baked `costs`.
  hot_iron: {
    appliesTo: { kind: 'attack', category: 'melee' },
    effects: [{ label: 'Hot Iron', target: 'damageDice', mode: 'dice', value: '(@proficiency)d6' }],
  },

  // Soldier — "As a boost to Stepping Strike, increase the damage dealt by your one-handed melee weapon
  // by one dice type." A die-step folded into Stepping Strike's damage. Punching Slide is a *passive*
  // upgrade to this boost (a second die-step, gated on owning it — the caster-side predicate) rather
  // than a boost of its own, since you can't apply two boosts to one action.
  step_and_slide: {
    appliesTo: { kind: 'ability', ability: 'stepping_strike' },
    effects: [
      { label: 'Step and Slide', target: 'damage', mode: 'step', value: '1' },
      { label: 'Punching Slide', target: 'damage', mode: 'step', value: '1',
        predicate: [{ atom: 'self:ability:punching_slide' }] },
    ],
  },

  // Soldier — "As a boost to Stepping Strike, rend the enemy 1 if you successfully hit." An inflict-only
  // boost: no roll effect, it adds Rend 1 to Stepping Strike's on-hit resolution.
  thrustforth: {
    appliesTo: { kind: 'ability', ability: 'stepping_strike' },
    inflict: [{ condition: 'rended', amount: '1' }],
  },

  // Soldier — "Once per turn as a Boost to a melee attack with a one-handed weapon, gain 1X disadvantage.
  // If you hit, increase the base damage dice of your attack by two dice types." Disadvantage on the
  // to-hit + a 2-step damage bump (damage only lands on a hit, so the "if you hit" is implicit).
  targeted_strike: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    effects: [
      { label: 'Targeted Strike', target: 'advantage.toHit', mode: 'add', value: '-1' },
      { label: 'Targeted Strike', target: 'damage', mode: 'step', value: '2' },
    ],
  },

  // Bladedancer — "Once per turn as a Boost to a melee attack, increase damage by half your Proficiency
  // (rounded up) for each enemy within 5ft of you if it hits." A per-adjacent-enemy flat damage bump,
  // scaling off the positional `@adjacentEnemies` count (computed from token geometry at use). Damage
  // only lands on a hit, so the "if it hits" is implicit.
  bd_surrounded_by_me: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    // Surrounded by Friends: "Count all creatures (not just enemies)".
    effects: [
      { label: 'Surrounded by Me', target: 'damage', mode: 'add', value: 'ceil(@proficiency/2)*@adjacentEnemies', predicate: [{ atom: '!self:ability:bd_surrounded_by_friends' }] },
      { label: 'Surrounded by Me', target: 'damage', mode: 'add', value: 'ceil(@proficiency/2)*@adjacentCreatures', predicate: [{ atom: 'self:ability:bd_surrounded_by_friends' }] },
    ],
  },

  // Thug — "When you have a target surrounded, you may use a Boost to gain 1X advantage on the first
  // melee attack made against them each turn." Advantage on a melee attack, gated on the *target* being
  // Surrounded (positional); `once` approximates the "first each turn" clause.
  thug_flanking_forces: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    effects: [{ label: 'Flanking Forces', target: 'advantage.toHit', mode: 'add', value: '1', predicate: [{ atom: 'target:surrounded' }] }],
  },

  /* ---- Sentinel: Trickshot-pool ranged boosts (the variable-spend `@spent` machinery's real
         consumers). Each rides the ability's baked Trickshot `costs.pool`; a variable cost prompts at
         consume and exposes the amount as `@spent`. ---- */

  // "Expend any number of Trickshot points (up to your Proficiency) as a Boost to a consistent ranged
  // attack. Increase your advantage by one per point expended (to a maximum of 6)." Variable spend →
  // `@spent` advantage, capped at 6. (Pool cost is variable, max @proficiency — already baked.)
  charging_strike: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    effects: [{ label: 'Charging Strike', target: 'advantage.toHit', mode: 'add', value: 'min(@spent,6)' }],
  },

  // "As a Boost to a ranged weapon attack, expend a Trickshot point. If you hit, give the target Fumble
  // equal to your Proficiency in addition to damage." Fixed 1-point cost + an on-hit Fumble inflict.
  fumbling_strike: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    inflict: [{ condition: 'fumbled', amount: '@proficiency' }],
  },

  // "Expend one Trickshot point, apply Head Strike to a ranged weapon attack. If you hit, deal an extra
  // XD8, X = half your Proficiency (rounded up)." A bonus damage die-pool. Head-Off is a *passive*
  // upgrade (X → full Proficiency), folded here via caster-side predicates: the ½-Prof pool applies
  // unless you own Head-Off, the full-Prof pool when you do (they never both apply).
  head_strike: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    effects: [
      { label: 'Head Strike', target: 'damageDice', value: '(ceil(@proficiency/2))d8',
        predicate: [{ atom: '!self:ability:head_off' }] },
      { label: 'Head Strike', target: 'damageDice', value: '(@proficiency)d8',
        predicate: [{ atom: 'self:ability:head_off' }] },
    ],
  },

  // Fatebound — the same text as Bladedancer's Surrounded by Me ("for each enemy within 5ft of you").
  surrounded_by_me: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    effects: [
      { label: 'Surrounded by Me', target: 'damage', mode: 'add', value: 'ceil(@proficiency/2)*@adjacentEnemies', predicate: [{ atom: '!self:ability:surrounded_by_friends' }] },
      { label: 'Surrounded by Me', target: 'damage', mode: 'add', value: 'ceil(@proficiency/2)*@adjacentCreatures', predicate: [{ atom: 'self:ability:surrounded_by_friends' }] },
    ],
  },

  // Hulinari — "As a Boost to Body Slam, you may expend additional AP up to half your Proficiency (rounded
  // up). For each additional AP … attempt to knock an additional target Prone." The AP is chosen and paid;
  // the extra targets are the player's targeting (Body Slam's check applies to each).
  shockwave: {
    appliesTo: { kind: 'ability', ability: 'body_slam' },
    special: { prompt: { label: 'Shockwave (extra AP)', max: 'ceil(@proficiency/2)' }, onConsume: { ap: '@spent' } },
  },

  /* ---- Thug: Harm / Natural Wrestler boosts ---- */

  // "Whenever you Pin someone using 'Natural Wrestler', you may use a Boost to attempt to give one extra
  // level of the condition (to a maximum of your Proficiency)." +1 attempted Pin level, capped.
  thug_starter: {
    appliesTo: { kind: 'ability', ability: 'thug_natural_wrestler' },
    special: { inflictBonus: { pinned: 1 } },
  },

  // "As a Boost to Harm, increase the damage dice of Harm by two types. Then, reduce the target's Pin by one."
  thug_tangled_harm: {
    appliesTo: { kind: 'ability', ability: 'thug_harm' },
    effects: [{ label: 'Tangled Harm', target: 'damage', mode: 'step', value: '2' }],
    special: { targetDelta: { pinned: -1 } },
  },

  // "If the target fails a Power Check against Harm by more than 5 below the Check DC, increase the dice
  // type of Harm by one." Pre-rolls the stepped variant; the saver's roll picks it when the margin holds.
  thug_backpress: {
    appliesTo: { kind: 'ability', ability: 'thug_harm' },
    special: { marginStep: { margin: 5, steps: 1 } },
  },

  // "You may only apply this Boost to Harm. Store the target's D20 roll against your Harm … The next time
  // someone other than the target you have pinned attempts to hit you … if the D20 roll surpasses the D20
  // used in their attack, their attack hits your wrestling target instead." The saver's first raw d20 is
  // stored on the Thug (replacing any earlier one); resolveAttack spends it on the next non-Pinned attacker.
  thug_stored_momentum: {
    appliesTo: { kind: 'ability', ability: 'thug_harm' },
    special: { storeMomentum: true },
  },

  // "After making at least 4 successful melee attacks against that target in a turn, as a boost to giving
  // them Pin you may deal 1D6 damage for each level of Pin that the target takes. 1D8 at level 11." (The
  // Extra Bite steps it one more type.)
  thug_biting_pankration: {
    appliesTo: { kind: 'ability', ability: 'thug_natural_wrestler' },
    special: { requires: ['target:hits>=4'], perLevelDamage: '1d6', perLevelScale: [11], perLevelStepWith: 'thug_the_extra_bite' },
  },

  // "Once per turn when you make a melee attack against a Surprised creature, you may use a Boost to force
  // that creature to make a Wiles Check against your Check DC. If they fail, they remain Surprised." The
  // extra save re-applies Surprised on a failure (stacking allowed — it's a keep, not a new application).
  thug_unpredictability: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    special: { requires: ['target:condition:surprised'], extraSave: { trait: 'wiles', inflict: [{ condition: 'surprised', amount: '1', stacks: true }] } },
  },

  // "As a Boost to Kick … if they fail the trait check … deal 1D10+Power damage … 2D6+Power at level 5, and
  // 2D8+Power at level 11."
  thug_horn_butting: {
    appliesTo: { kind: 'ability', ability: 'basic_kick' },
    special: { saveDamage: [{ level: 1, formula: '1d10 + @power' }, { level: 5, formula: '2d6 + @power' }, { level: 11, formula: '2d8 + @power' }] },
  },

  // "When you use Kick on an enemy and they fail the trait check against it, you may expend a Boost to deal
  // XD6 damage to them, where X is your Finesse."
  ribcrack: {
    appliesTo: { kind: 'ability', ability: 'basic_kick' },
    special: { saveDamage: [{ level: 1, formula: '(@finesse)d6' }] },
  },

  // "When you use Kick on an enemy and they fail the trait check against it, you may expend a Boost to
  // knock them Prone." Prone joins Kick's check — applied on the same failure.
  tripping_kick: {
    appliesTo: { kind: 'ability', ability: 'basic_kick' },
    inflict: [{ condition: 'prone', amount: '1' }],
  },

  /* ---- Hulinari / beast boosts ---- */

  // "As a Boost to Bludgeonmaster, rend one armor on all targets who fail the Bludgeonmaster Check DC."
  concussive_slam: {
    appliesTo: { kind: 'ability', ability: 'bludgeonmaster' },
    inflict: [{ condition: 'rended', amount: '1' }],
  },

  // "Once per turn as a Boost to Lucky Break, gain +1 to your next to-hit this turn for each enemy to which
  // you give Fumble." (Sapping Strike adds +1 damage per enemy as well.)
  sapped_fates: {
    appliesTo: { kind: 'ability', ability: 'lucky_break' },
    once: true,
    special: { pendingPerFail: { toHit: 1, damageWith: 'sapping_strike' } },
  },

  // "As a Boost to an action made against a single target, you may expense one Savage Point. Treat that
  // target as prone for that action." Prone's melee advantage and Prone-gated riders see it.
  barreling_stature: {
    appliesTo: { kind: 'any' },
    special: { targetAs: 'prone' },
  },

  // "As a Boost to Body Slam, expense one Savage Point for each creature Body Slam would affect. All targets
  // … roll a Power Check against being knocked prone at 1X disadvantage."
  enormity: {
    appliesTo: { kind: 'ability', ability: 'body_slam' },
    effects: [{ label: 'Enormity', target: 'saveAdvantage', value: '-1' }],
  },

  // "As a Boost to any action that imposes a trait check on an enemy that will move them if they fail … each
  // target … makes this Trait Check at 1X Disadvantage." (Herd per target rides the baked pool cost.)
  hoofslam: {
    appliesTo: { kind: 'save' },
    effects: [{ label: 'Hoofslam', target: 'saveAdvantage', value: '-1' }],
  },

  // "As a Boost to any attack made against a single target, if you kill that target, you rip them apart.
  // All enemies within 5ft of you gain the Surprised Condition." (Tearing Fright adds a Panic save.)
  tear_apart: {
    appliesTo: { kind: 'attack' },
    special: { onKill: { adjacentSurprised: true, panicWith: 'tearing_fright' } },
  },

  /* ---- Fatebound: divine-weapon boosts ---- */

  // "As a Boost to an attack made with a divine weapon, increase the damage dice … by one type if you hit."
  // Damaging Weapon is "a unique Boost from Boosted Damage" (so both can ride one attack under Boosted Attack).
  boosted_damage: {
    appliesTo: { kind: 'attack' },
    effects: [{ label: 'Boosted Damage', target: 'damage', mode: 'step', value: '1' }],
    special: { requires: ['self:attack:divine'] },
  },
  damaging_weapon: {
    appliesTo: { kind: 'attack' },
    effects: [{ label: 'Damaging Weapon', target: 'damage', mode: 'step', value: '1' }],
    special: { requires: ['self:attack:divine'] },
  },

  // "Reduce your to-hit by X to increase damage if you successfully hit by 2X (X up to your Proficiency)."
  boosted_fury: {
    appliesTo: { kind: 'attack' },
    effects: [
      { label: 'Boosted Fury', target: 'toHit', value: '0 - @spent' },
      { label: 'Boosted Fury', target: 'damage', value: '2*@spent' },
    ],
    special: { requires: ['self:attack:divine'], prompt: { label: 'Boosted Fury (X)', max: '@proficiency' } },
  },

  // "Expend two Boosts on a melee attack with your divine weapon. If you miss but your to-hit is ≥ 5 below
  // the target's defense, reduce your weapon's base damage by two dice types and deal that damage." Modeled
  // as a single boost carrying the graze (the second Boost slot is the player's to leave empty).
  boostbane: {
    appliesTo: { kind: 'attack', category: 'melee' },
    special: { requires: ['self:attack:divine'], graze: { margin: 5, steps: -2 } },
  },

  // "Once per turn … expend one additional AP to make that attack against two targets. Only apply the base
  // weapon damage dice." Solar Arc adds one more target. Target adjacency is the player's to honor.
  long_arc: {
    appliesTo: { kind: 'attack' },
    once: true,
    special: { requires: ['self:attack:divine'], extraAttacks: '1 + @owns.solar_arc', baseOnly: true, onConsume: { ap: 1 } },
  },

  // "Once per turn when you make a weapon attack with a Versatile weapon, you may use a Boost to attempt a
  // 1x disadvantage attack against one additional target within 5ft of the first target."
  rebound: {
    appliesTo: { kind: 'attack' },
    once: true,
    special: { extraAttacks: '1', extraAttackAdvantage: -1 },
  },

  /* ---- Sentinel: Trickshot boosts ---- */

  // "Expend any number of Trickshot points as a boost to a frenzied ranged attack. Make an additional
  // frenzied ranged attack for every two Trickshot points expended."
  freefire: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    special: { extraAttacks: 'floor(@spent/2)' },
  },

  // "Expend any number of Trickshot points as a Boost to a ranged attack that causes adversarial conditions.
  // Increase your Check DC by two for each Trickshot point." Raises the DC of the attack's save-to-negate
  // inflicts (and any save it forces).
  conditioned_strike: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    effects: [{ label: 'Conditioned Strike', target: 'saveDc', value: '2*@spent' }],
  },

  // "Expend one Trickshot point and make all attacks on this turn at 1X advantage. Until the start of your
  // next turn, all attacks are made against you at 2X advantage."
  reckless_loosing: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    special: { onConsume: { turnFlags: { turnAdvantage: { value: 1, label: 'Reckless Loosing' } }, exposed: { adv: 2 } } },
  },

  // "Expend a Boost on a melee attack made on your turn against PD to get 1x advantage on all melee attacks
  // you make against PD during your turn. All attacks made against your PD until your next turn are made at
  // 1x advantage."
  reckless_physical_attack: {
    appliesTo: { kind: 'attack', category: 'melee' },
    special: { onConsume: { turnFlags: { turnAdvantage: { value: 1, category: 'melee', vs: 'pd', label: 'Reckless Physical Attack' } }, exposed: { adv: 1, vs: 'pd' } } },
  },

  /* ---- Fatebound: Glory ---- */

  // "Expend a Glory point as a Boost to any action to ignore the effects of all conditions for your turn,
  // including any Exhaustion from being Wounded. You may still roll Trait Checks." (Pin-size movement is
  // the GM's, per the movement policy.)
  glory_of_storms: {
    appliesTo: { kind: 'any' },
    special: { onConsume: { turnFlags: { ignoreConditions: true } } },
  },

  /* ---- Oracle: Madness boosts ---- */

  // "Expend one Prescient point as a boost to a Mind action. Do not reduce your Madness by 1 at the end of
  // this turn."
  voices_that_shriek: {
    appliesTo: { kind: 'any' },
    special: { onConsume: { holdDecay: ['madness'] } },
  },

  // "Instead of rolling to determine the Madness you gain from a single action, expend one Prescient Point
  // … to gain the maximum amount." / Quiet Smirk: the minimum.
  cracked_laughter: { appliesTo: { kind: 'any' }, special: { madnessRoll: 'max' } },
  quiet_smirk: { appliesTo: { kind: 'any' }, special: { madnessRoll: 'min' } },

  // "As a Boost to a single attack, increase your Madness by 1D3-1 and then take damage equal to your
  // Madness. Increase your to-hit and damage for this attack by your Madness."
  mad_smear: {
    appliesTo: { kind: 'attack' },
    effects: [
      { label: 'Mad Smear', target: 'toHit', value: '@madness' },
      { label: 'Mad Smear', target: 'damage', value: '@madness' },
    ],
    special: { onConsume: { madness: '1d3-1', selfDamage: '@madness' } },
  },

  // "As a Boost to a single action, increase your Madness by 1D3-1 and take damage equal to three times your
  // Madness. Increase your Check DC by your Madness for this action."
  mad_spector: {
    appliesTo: { kind: 'any' },
    effects: [{ label: 'Mad Spector', target: 'saveDc', value: '@madness' }],
    special: { onConsume: { madness: '1d3-1', selfDamage: '3*@madness' } },
  },

  // "As a Boost to any ability which raises Madness, increase Madness by an additional 1, then take damage
  // equal to M." / Blood for God: "… which lowers Madness, take damage equal to M before reducing your
  // Madness. After the ability resolves, add 1D3-1." / Bleeding Eyes: "once per turn … when you are insane,
  // reduce your HP by your Proficiency, then do not reduce your Madness."
  blood_for_blood: { appliesTo: { kind: 'any' }, special: { madnessExtra: 1 } },
  blood_for_god: { appliesTo: { kind: 'any' }, special: { madnessBeforeSpend: true, madnessAfterSpend: '1d3-1' } },
  bleeding_eyes_bloodsage: { appliesTo: { kind: 'any' }, once: true, special: { madnessSpendInstead: true } },

  // "When you have less than half HP, add your Madness to all Forbidden Knowledge damage you deal as a
  // Boost to that attack."
  bloodied_cruelty: {
    appliesTo: { kind: 'ability', ability: 'forbidden_knowledge' },
    effects: [{ label: 'Bloodied Cruelty', target: 'damage', value: '@madness' }],
    special: { requires: ['self:hp-below-half'] },
  },

  /* ---- Bladedancer ---- */

  // "As a Boost to an attack action, increase the damage dice of your attack by the number of times you have
  // used the 5ft adjust action this turn (to a maximum of your Proficiency)."
  bd_whisperglide: {
    appliesTo: { kind: 'attack' },
    effects: [{ label: 'Whisperglide', target: 'damage', mode: 'step', value: 'min(@combat.basic.fiveFootAdjust, @proficiency)' }],
  },

  // Fatebound Piercing Pin — "When you use Piercemaster, … Make a melee attack roll against two creatures in a
  // line. … full damage to the first target in the line, and … half that damage to the second (rounded up)."
  // Target both (first = first targeted); one roll resolves against each.
  piercing_pin: {
    appliesTo: { kind: 'ability', ability: 'piercemaster' },
    special: { pierce: true },
  },
  // Soldier Call of Effort — "As a Boost to Call of Power, expend one additional call point. For the duration
  // of Call of Power, allies affected by the call add 1 to damage for each AP expended on an effect."
  call_of_effort: {
    appliesTo: { kind: 'ability', ability: 'call_of_power' },
    special: { grantExtra: [{ key: 'system.bonuses.damagePerAp', mode: 2, value: '1' }] },
  },

  /* ---- Profession level features (src/progression.mjs) ---- */
  // "Expend one lore point. You critically succeed at that action." Free (no Boost slot), any action; an
  // attack it rides is a critical hit. ("After rolling" use is the player's to declare before the roll here.)
  rousing_success: {
    appliesTo: { kind: 'any' },
    special: { free: true, forceCrit: true, onConsume: { lore: 1 } },
  },
  // Oracle L3 — "As a boost to an oracle ability that requires you to gain or lose 1D3-1 Madness, … use a
  // reserved roll instead of rolling for Madness." The saved d3s are rolled at each rest (sheet).
  oracle_slightly_cracked: {
    appliesTo: { kind: 'any' },
    special: { useCracked: true },
  },
  // "Once per quick rest, you may increase the damage dice of an attack by two dice types as a Boost."
  fb_boon_of_the_gods: {
    appliesTo: { kind: 'attack' },
    once: true,
    effects: [{ label: 'Boon of the Gods', target: 'damage', mode: 'step', value: '2' }],
  },
  // "Once per turn, you may add your Wiles Score to any ranged to-hit you roll."
  sen_skilled_warrior: {
    appliesTo: { kind: 'attack', category: 'ranged' },
    once: true,
    effects: [{ label: 'Skilled Warrior', target: 'toHit', value: '@wiles' }],
  },
  // "Once per turn as a boost to an action, you may recover a single AP."
  sen_legendary_ap: {
    appliesTo: { kind: 'any' },
    once: true,
    special: { onConsume: { ap: -1 } },
  },
  // "Once per turn as a boost to your first melee attack in a turn, reduce the cost of that attack by 1AP."
  thug_fast_reflexes: {
    appliesTo: { kind: 'attack', category: 'melee' },
    once: true,
    special: { requires: ['self:combat:attacks-this-turn=0'], onConsume: { ap: -1 } },
  },

  /* ---- Hulinari Swarm, v1.2 ---- */
  // Razorbite — "As a Boost to Birdbite, instead of making attacks against all enemy targets, make a single Unarmed
  // attack against one target in Clouded Foe. Increase the damage dice of this attack X times (X = Proficiency)."
  razorbite: {
    appliesTo: { kind: 'ability', ability: 'birdbite' },
    effects: [{ label: 'Razorbite', target: 'damage', mode: 'step', value: '@proficiency' }],
    special: { singleAttack: true },
  },
  // Cloudsurge — "Expend X Trickster Points as a Boost to initiating Clouded Foe or Clouded Ally (to a maximum of half
  // your Proficiency rounded up). Increase the tiles … by X."
  cloudsurge: {
    appliesTo: { kind: 'ability', ability: 'clouded_foe|clouded_ally' },
    special: { zoneTiles: '@spent' },
  },
  // Rolling Fog — "put all tiles … on or as close as possible to that target … set your own Move Speed to 0. Each time
  // the target would move outside your Swarm, you may expend a reaction to move with the target." The cloud is placed
  // around and carried with the targeted creature; your speed is 0 while it lasts.
  rolling_fog: {
    appliesTo: { kind: 'ability', ability: 'clouded_foe|clouded_ally' },
    special: { zoneFollowTarget: true },
  },
};

export const MARK_OVERRIDES = {
  // Sentinel — "Choose one target. For each turn you maintain Focus on that target, reduce damage
  // they deal to you…" The chosen target is the mark; Fight Reflex reads it. (The per-attacker damage
  // reduction on the *self* side isn't automatable — our DR sink is global, not per-source — so Stood
  // Ground's automated footprint is the mark it sets; the defensive ramp stays descriptive.)
  stood_ground: { key: 'stood-ground', exclusive: true },

  // Oracle A Boiled Leech — "Choose a number of targets … up to half your Proficiency. For as long as you
  // maintain focus, whenever you would lose HP from an insane effect, those targets also lose that HP."
  a_boiled_leech: { key: 'leech' },

  // Sentinel Focused Enemy — "For each turn you maintain Focus on a Favored Enemy, increase all to-hits
  // against the target by 1 (max Proficiency)." The focused target is the mark; the ramp (below) reads it.
  focused_enemy: { key: 'focused-enemy', exclusive: true },

  // Fatebound Targeted Foe — "Choose one target. As long as you maintain Focus, add ½ Fate (Tighten
  // Focus: full Fate) to all to-hit and damage rolls against that target." The chosen target is the
  // mark; the buff (below) reads it. Exclusive — a moving single-target focus.
  targeted_foe: { key: 'targeted-foe', exclusive: true },
  // Oracle Soulbinding: the bound target shares half of every hit the caster takes (post-roll redirect).
  soulbinding: { key: 'soulbound', exclusive: true },
  // Hulinari Pack: the Skittish target — Skittish Step reduces its damage to you; Confused Dance debuffs it.
  skittish: { key: 'skittish', exclusive: true },
};

export const CHOICE_OVERRIDES = {
  // Rend Armor: "rend 1 armor (PD, MD, or TD - your choice)" — the Rend lands on that type first.
  basic_rend_armor: { prompt: 'Rend which armor?', options: [{ value: 'pd', label: 'PD' }, { value: 'md', label: 'MD' }, { value: 'td', label: 'TD' }] },
  // Soldier Standards Elite: "remove one level of Panic or Fatigue from yourself or an ally" (the on-use reads @choice).
  standards_elite: { prompt: 'Remove a level of', options: [{ value: 'panic', label: 'Panic' }, { value: 'fatigue', label: 'Fatigue' }] },
  // Oracle Bloodsapper: "exhaust one of the following limbs of that target: One Arm or Leg (choose one)".
  bloodsapper: { prompt: 'Exhaust which limb?', options: [{ value: 'oneArm', label: 'One Arm' }, { value: 'leg', label: 'Leg' }] },
  // Soldier Cornered Animal: "prevent them from reducing either Taunt or Panic (choose one) at the end of their turn".
  cornered_animal: { prompt: 'Hold which condition?', options: [{ value: 'taunt', label: 'Taunt' }, { value: 'panic', label: 'Panic' }] },
  // Oracle Mindmeld: "impose 1× disadvantage on any attack they make, or 1× advantage to any allied Trait Check".
  mindmeld: { prompt: 'Mindmeld', options: [{ value: 'hinder', label: 'Their attack at disadvantage (target them)' }, { value: 'aid', label: "An ally's check at advantage (target the ally)" }] },
  // Hulinari Carrying the Team: "impose 1× advantage on any attack your riding teammate makes or 1× disadvantage
  // on an attack made against them".
  carrying_the_team: { prompt: 'Carrying the Team', options: [{ value: 'boost', label: "Rider's attack at advantage" }, { value: 'shield', label: 'Attack against the rider at disadvantage' }] },
  // Hulinari Ironhide: "ignore the effects of Nausea, Frenzy, Taunt, or Panic (choose one when you initiate
  // Focus)". The pick rides the action log; the actor's condition fold skips that condition's effects.
  ironhide: {
    prompt: 'Choose the condition to ignore',
    options: [
      { value: 'nausea', label: 'Nausea' }, { value: 'frenzy', label: 'Frenzy' },
      { value: 'taunt', label: 'Taunt' }, { value: 'panic', label: 'Panic' },
    ],
  },
  blessing_of_the_iron_wall: {
    prompt: 'Choose a defense to reinforce',
    options: [
      { value: 'pd', label: 'Physical Defense' },
      { value: 'md', label: 'Mental Defense' },
      { value: 'td', label: 'Toughness Defense' },
    ],
  },
  // Thug Underpinning: "Decrease the PD or TD (choose one) of a target to whom you have given Wrestle Pin".
  thug_underpinning: { prompt: 'Decrease which defense?', options: [{ value: 'pd', label: 'PD' }, { value: 'td', label: 'TD' }] },
  // Hulinari Headbutt — whether you charged ("move in a straight line at least 20ft to an enemy prior to
  // attacking"), asked only when Skullcharge is owned.
  headbutt: { prompt: 'Headbutt', requires: 'skullcharge', options: [{ value: 'plain', label: 'No charge' }, { value: 'charge', label: 'Charged 20ft+ in a straight line' }] },
  // Hulinari Beastly Presence: "that many levels of Panic or Taunt".
  beastly_presence: { prompt: 'Give which condition?', options: [{ value: 'panic', label: 'Panic' }, { value: 'taunt', label: 'Taunt' }] },
  // Sentinel Slinger — Slingstunner's once-per-rest heavier Fatigue, asked only when owned.
  slinger: { prompt: 'Slinger', requires: 'slingstunner', options: [{ value: 'normal', label: 'Normal' }, { value: 'stun', label: 'Slingstunner (once per quick rest)' }] },
  // Hulinari A Deeper Rend: "choose a limb (one arm or one leg)".
  a_deeper_rend: { prompt: 'Which limb?', options: [{ value: 'oneArm', label: 'One Arm' }, { value: 'leg', label: 'Leg' }] },
  // Wild Strike — with Wild Throws: "you may make Versatile throws with one or either weapon" (thrown attacks
  // roll as ranged and count as throws).
  wild_strike: { prompt: 'Wild Strike', requires: 'wild_throws', options: [{ value: 'melee', label: 'Melee' }, { value: 'thrown', label: 'Thrown (Versatile throws)' }] },
  bd_wild_strike: { prompt: 'Wild Strike', requires: 'bd_wild_throws', options: [{ value: 'melee', label: 'Melee' }, { value: 'thrown', label: 'Thrown (Versatile throws)' }] },
  // Oracle Balanced Scale: which of the target's conditions becomes Enduring.
  balanced_scale: { prompt: 'Which condition becomes Enduring?', options: [{ value: 'hemorrhage', label: 'Hemorrhage' }, { value: 'delirium', label: 'Delirium' }, { value: 'nausea', label: 'Nausea' }] },
  // Hulinari Absolute Mimicry: "give one of the following one-word commands".
  absolute_mimicry: { prompt: 'Command', options: [{ value: 'stop', label: 'Stop' }, { value: 'flee', label: 'Flee' }, { value: 'attack', label: 'Attack' }, { value: 'drop', label: 'Drop (Prone)' }] },
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

  /* ---- Thug: Wrestle Pin scaling (Layer A — gated on the target's Pin level, `target:condition:pinned`,
         and scaled by it via `@target.pinned`; both come from the target-condition injection in
         #useAbility). Pin is the leveled `pinned` condition Natural Wrestler applies. ---- */

  // "When you have pinned a target and then melee attack or Harm them, increase the damage of both by X,
  // where X is the amount of Pin that target has." One flat damage bonus per scope (melee attacks + the
  // Harm ability), value = the target's Pin. Superseded by Pankration's Champion (which doubles it).
  thug_pankration: ['melee', 'thug_harm'].map((scope) => ({
    label: 'Pankration', target: 'damage', mode: 'add', scope, value: '@target.pinned',
    predicate: [{ atom: 'target:condition:pinned>=1' }, { atom: '!self:ability:thug_pankrations_champion' }],
  })),

  // "When you benefit from Pankration, instead increase the damage of Harm and melee attacks by 2X." The
  // supersede upgrade: 2× the target's Pin, replacing the base Pankration bonus while owned.
  thug_pankrations_champion: ['melee', 'thug_harm'].map((scope) => ({
    label: "Pankration's Champion", target: 'damage', mode: 'add', scope, value: '2*@target.pinned',
    predicate: [{ atom: 'target:condition:pinned>=1' }],
  })),

  // "When a pinned target has only one level of Pin, increase your melee damage dice by one type." A
  // die-step on melee attacks gated on the target holding exactly one Pin (`=1`).
  thug_kneejerk: [{
    label: 'Kneejerk', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'target:condition:pinned=1' }],
  }],

  // "When you have given a Prone target Wrestle Pin, increase the damage dice of Harm by one type." A
  // die-step on Harm gated on the target being both pinned and Prone.
  thug_suplex: [{
    label: 'Suplex', target: 'damage', mode: 'step', scope: 'thug_harm', value: '1',
    predicate: [{ atom: 'target:condition:pinned>=1' }, { atom: 'target:condition:prone' }],
  }],

  /* ---- Thug: base-damage & rage self-buffs ---- */

  // "Your base damage when you make a melee attack is increased by half your Finesse (rounded up)."
  // Superseded by Gutwrenching Twist (which raises it to full Finesse), so it drops out while owned.
  thug_gutwrenching_strike: [{
    label: 'Gutwrenching Strike', target: 'damage', mode: 'add', scope: 'melee', value: 'ceil(@finesse/2)',
    predicate: [{ atom: '!self:ability:thug_gutwrenching_twist' }],
  }],

  // "Increase the effect of Gutwrenching Strike from half your Finesse to your Finesse." The upgrade:
  // full Finesse on every melee attack (supersede pair, above).
  thug_gutwrenching_twist: [{
    label: 'Gutwrenching Twist', target: 'damage', mode: 'add', scope: 'melee', value: '@finesse',
    predicate: [],
  }],

  // "Your unarmed weapons do 1D6 damage instead of 1D4 base damage dice." A single die-step on attacks
  // made with the bound unarmed weapon (d4 → d6).
  thug_strong_fists: [{
    label: 'Strong Fists', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:unarmed' }],
  }],

  // "When you are raging, you may Focus on your damaging strikes — increase the damage dice of all melee
  // attacks by one type." Gated on the Raging state (`self:raging`). Freaking Strong stacks a second step.
  thug_focused_rage: [{
    label: 'Focused Rage', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:raging' }],
  }],

  // "When you use Focused Rage, increase the damage dice of all melee attacks by one additional type."
  // A second die-step while raging (owning this implies owning Focused Rage), for +2 total.
  thug_freaking_strong: [{
    label: 'Freaking Strong', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:raging' }],
  }],

  // "Increase the dice type of Harm by one dice type when you are Raging." A die-step on Harm gated on
  // the Raging state.
  thug_raging_harm: [{
    label: 'Raging Harm', target: 'damage', mode: 'step', scope: 'thug_harm', value: '1',
    predicate: [{ atom: 'self:raging' }],
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

  /* ---- Ability-scoped damage buffs: one ability modifies another ability's damage, keyed by the
     target's catalogId (`scope`). Either steps its dice up the ladder (`mode: 'step'`) or adds a flat
     boost (`mode: 'add'`), optionally gated by a predicate (e.g. `self:hp-below-half`). ---- */

  // "Increase the damage of Mad Chanting from MD4 to MD6." One die-step up its damage dice.
  madder_chanting: [{
    label: 'Madder Chanting',
    target: 'damage', mode: 'step', scope: 'mad_chanting', value: '1',
    predicate: [],
  }],

  // Soldier healing upgrades — each steps Call of Healing's dice up one type (D4→D6→D8). Both are
  // owned-and-stacking passives, so a Soldier with both reaches D8 (matching the book's tiered upgrades).
  greater_healing: [{
    label: 'Greater Healing',
    target: 'damage', mode: 'step', scope: 'call_of_healing', value: '1',
    predicate: [],
  }],
  supreme_healing: [{
    label: 'Supreme Healing',
    target: 'damage', mode: 'step', scope: 'call_of_healing', value: '1',
    predicate: [],
  }],

  // Bladedancer — Stabby Aura and Blindstab each step Blade Aura's damage dice up one type.
  bd_stabby_aura: [{
    label: 'Stabby Aura',
    target: 'damage', mode: 'step', scope: 'bd_blade_aura', value: '1',
    predicate: [],
  }],
  bd_blindstab: [{
    label: 'Blindstab',
    target: 'damage', mode: 'step', scope: 'bd_blade_aura', value: '1',
    predicate: [],
  }],

  // Thug — "Increase the base damage dice of Harm by one type."
  thug_strength_of_giants: [{
    label: 'Strength of Giants',
    target: 'damage', mode: 'step', scope: 'thug_harm', value: '1',
    predicate: [],
  }],

  // Oracle Tome Mastery (Level-5) — "increase the damage dice dealt by Forbidden Knowledge by one dice
  // type." Same die-step as Past the Web; keyed by the mastery's id (see masteries.mjs).
  mastery_tome: [{
    label: 'Tome Mastery',
    target: 'damage', mode: 'step', scope: 'forbidden_knowledge', value: '1',
    predicate: [],
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

  /* ---- Level-5 weapon masteries: a +1 to-hit and/or die/damage bump gated on the *bound* weapon's
         family (`self:attack:weapon:<type>`, roll-time). The non-numeric riders (crit push, parry
         stance, ambush-AP) are descriptive. ---- */

  // Sentinel — "Increase the base damage dice of bow attacks by one dice type." A die-step on the bow.
  mastery_bow: [{
    label: 'Bow Mastery', target: 'damage', mode: 'step', scope: 'ranged', value: '1',
    predicate: [{ atom: 'self:attack:weapon:bow' }],
  }],

  // Soldier — "Gain +1 to melee to-hit and damage with weapons in the spear family." (Crit-push rider is
  // a crit-effect → descriptive.)
  mastery_spear: [
    { label: 'Spear Mastery', target: 'toHit', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:spear' }] },
    { label: 'Spear Mastery', target: 'damage', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:spear' }] },
  ],

  // Soldier — "Gain +1 to melee to-hit and damage with weapons in the sword family." (Parry-stance rider
  // is a reaction → descriptive.)
  mastery_sword: [
    { label: 'Sword Mastery', target: 'toHit', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:sword' }] },
    { label: 'Sword Mastery', target: 'damage', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:sword' }] },
  ],

  // Thug — "+1 to attack rolls with unarmed weapons vs PD." (Unarmed attacks are vs PD anyway; the
  // ambush-AP rider is action-economy → descriptive.)
  mastery_fist: [{
    label: 'Fist Mastery', target: 'toHit', mode: 'add', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:unarmed' }],
  }],

  // Hulinari — "Gain +1 to unarmed melee attacks and damage." (Stacks with Fist Mastery if a Thug
  // multiclass owns both — both gate on the bound unarmed weapon.)
  mastery_tooth_and_claw: [
    { label: 'Mastery of Tooth and Claw', target: 'toHit', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:unarmed' }] },
    { label: 'Mastery of Tooth and Claw', target: 'damage', mode: 'add', scope: 'melee', value: '1',
      predicate: [{ atom: 'self:attack:weapon:unarmed' }] },
  ],

  // Sentinel — "+1 to attack rolls with a sling. Choose one condition; increase the Check DC made against you giving a
  // target that condition by 1." The condition is the pick: +1 to the saves you force that give it, and to the Trait
  // Checks a target makes against the levels of it you give (as Mastery of the Pin does for Pin).
  mastery_sling: [
    { label: 'Sling Mastery', target: 'toHit', mode: 'add', scope: 'ranged', value: '1', predicate: [{ atom: 'self:attack:weapon:sling' }] },
    { label: 'Sling Mastery', target: 'saveDc', mode: 'add', value: '1', predicate: [{ atom: 'inflict:picked:mastery_sling' }] },
    { label: 'Sling Mastery', target: 'checkDcVs', mode: 'add', value: '1', predicate: [{ atom: 'vs:saving:picked:mastery_sling' }] },
  ],

  // Hulinari — "Increase your HP by 1 for every two levels." A max-HP bump scaling at half level (same
  // `health.max` sink as Living Wall / Healthy Vim). The matching HP-pool-size growth is structural →
  // descriptive.
  mastery_feather_and_hide: [{
    label: 'Mastery of Feather and Hide', target: 'health.max', mode: 'add', scope: 'all',
    value: '@level', predicate: [], // v1.2: +1 HP per level (v1.0: per two levels)
  }],

  /* ---- Hulinari self-buffs ---- */

  // "As long as you maintain Focus (Brute Form), you are resistant to all physical attacks by half your
  // Courage (rounded up)." A maintained-Focus DR self-buff (same shape as Thickskin / Hide of Beasts).
  // Our DR sink is global, so it also covers magic damage — a minor over-application (Brute is a melee
  // bruiser). Stacks with Toughhide as the prose says (separate additive modifiers).
  brute_adrenaline: [{
    label: 'Brute Adrenaline', target: 'defense.dr', mode: 'add', scope: 'all', value: 'ceil(@courage/2)',
    predicate: [{ atom: 'self:used:brute_adrenaline' }],
  }],

  // "Your Bite deals an additional XD6 necrotic damage, where X is half your Proficiency (rounded up)."
  // A dice-valued damage bonus scoped to the Bite ability (folds into Bite's own damage roll).
  necrotic_bite: [{
    label: 'Necrotic Bite', target: 'damageDice', mode: 'add', scope: 'bite',
    value: '(ceil(@proficiency/2))d6', predicate: [],
  }],

  // "Increase the damage of Headbutt by 1 dice type." Two separate abilities with identical text (Gorier
  // has a Power-4 prereq); each is a die-step scoped to the now-authored Headbutt attack, so owning both
  // stacks to +2. (Headbutt's damage is authored in ACTIVITY_OVERRIDES, so these have dice to step.)
  // Skullcharge — "When you use 'Headbutt' and move in a straight line at least 20ft … add XD6 to your damage,
  // where X is half your Proficiency (rounded up)." Gorehorn: X = Proficiency. Gated on Headbutt's charge pick.
  skullcharge: [{ label: 'Skullcharge', target: 'damageDice', mode: 'dice', scope: 'headbutt', value: '(ceil(@proficiency/2))d6',
    predicate: [{ atom: 'self:choice:headbutt:charge' }, { atom: '!self:ability:gorehorn' }] }],
  gorehorn: [{ label: 'Gorehorn', target: 'damageDice', mode: 'dice', scope: 'headbutt', value: '(@proficiency)d6',
    predicate: [{ atom: 'self:choice:headbutt:charge' }, { atom: 'self:ability:skullcharge' }] }],
  // Fatebound Stabby Aura / Blindstab — each steps Blade Aura's dice one type; Elemental Rage steps Blaze of Glory.
  stabby_aura: [{ label: 'Stabby Aura', target: 'damage', mode: 'step', scope: 'blade_aura', value: '1', predicate: [] }],
  blindstab: [{ label: 'Blindstab', target: 'damage', mode: 'step', scope: 'blade_aura', value: '1', predicate: [] }],
  elemental_rage: [{ label: 'Elemental Rage', target: 'damage', mode: 'step', scope: 'blaze_of_glory', value: '1', predicate: [] }],
  // Blaze of Glory's own level-11 step (1D10 → 2D6) — carried by the ability so it applies to everyone who has it.
  blaze_of_glory: [{ label: 'Blaze of Glory (level 11)', target: 'damage', mode: 'step', scope: 'blaze_of_glory', value: '1', predicate: [{ atom: 'self:level>=11' }] }],
  // A Deeper Rend (Focus) — "increase the damage dice dealt by all attacks made with that limb by one type."
  a_deeper_rend: [
    { label: 'A Deeper Rend', target: 'damage', mode: 'step', value: '1', predicate: [{ atom: 'self:deeper-rend:oneArm' }, { atom: 'self:attack:limb:oneArm' }] },
    { label: 'A Deeper Rend', target: 'damage', mode: 'step', value: '1', predicate: [{ atom: 'self:deeper-rend:leg' }, { atom: 'self:attack:limb:leg' }] },
  ],
  // Versatile weapons (the `versatile` weapon trait — the throwable ones).
  throwing_hand: [{ label: 'Throwing Hand', target: 'damage', mode: 'step', value: '1', predicate: [{ atom: 'self:attack:trait:versatile' }] }],
  mastery_versatile_weapon: [
    { label: 'Mastery of the Versatile Weapon', target: 'toHit', value: '1', predicate: [{ atom: 'self:attack:trait:versatile' }] },
    { label: 'Mastery of the Versatile Weapon', target: 'damage', value: '1', predicate: [{ atom: 'self:attack:trait:versatile' }] },
  ],
  // Fatebound Divine Protection — "Increase your TD by 1 when you wear a Cloth armor set."
  divine_protection: [{ label: 'Divine Protection', target: 'defense.td', value: '1', predicate: [{ atom: 'self:armor:cloth' }] }],
  // Bladedancer The Vengeance (named weapon): "damage dice one dice type lower against all enemies, except one
  // single enemy … Gain 1X Advantage on all to-hits against that single target with this blade, and increase
  // the damage dice of this weapon by 1 against them." The enemy is the ability's creature pick.
  bd_the_vengeance: [
    { label: 'The Vengeance', target: 'damage', mode: 'step', value: '-1', predicate: [{ atom: 'self:attack:named-by:bd_the_vengeance' }, { atom: '!target:pick:bd_the_vengeance' }] },
    { label: 'The Vengeance', target: 'damage', mode: 'step', value: '1', predicate: [{ atom: 'self:attack:named-by:bd_the_vengeance' }, { atom: 'target:pick:bd_the_vengeance' }] },
    { label: 'The Vengeance', target: 'advantage.toHit', value: '1', predicate: [{ atom: 'self:attack:named-by:bd_the_vengeance' }, { atom: 'target:pick:bd_the_vengeance' }] },
  ],
  gorier: [{ label: 'Gorier', target: 'damage', mode: 'step', scope: 'headbutt', value: '1', predicate: [] }],
  hornier: [{ label: 'Hornier', target: 'damage', mode: 'step', scope: 'headbutt', value: '1', predicate: [] }],

  /* ---- Unconditional defense passives (always-on while owned; empty predicate) ---- */

  // "Increase your PD/MD/TD/AD by 1 on top of any armor." Taken up to twice for the Trained line —
  // we author a single +1 (a second instance isn't representable without a times-taken mechanic).
  trained_body: [{ label: 'Trained Body', target: 'defense.pd', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  trained_mind: [{ label: 'Trained Mind', target: 'defense.md', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  trained_finesse: [{ label: 'Trained Finesse', target: 'defense.td', mode: 'add', scope: 'all', value: '1', predicate: [] }],
  just_luck: [{ label: 'Just Luck', target: 'defense.ad', mode: 'add', scope: 'all', value: '1', predicate: [] }],

  /* ---- General (cross-class) passives ---- */

  // "Add your Fate Score to all Trait Checks you make." Folds into the flat Trait-Check sink
  // (`bonuses.trait`, appended as `@traitBonus` on Trait/talent/Resist-Condition rolls). The "double
  // Fate on a Fate Check" clause isn't representable as a single flat bonus → left for manual-prompt.
  graceful_saving: [{ label: 'Graceful Saving', target: 'trait', mode: 'add', scope: 'all', value: '@fate', predicate: [] }],

  // "Increase your Trait Check DC by 1." A flat bump to the DC targets roll against when you force a
  // save (feeds `checkDc`, which is the default `save.dc` for your save-inflict abilities).
  check_please: [{ label: 'Check, Please', target: 'checkDc', mode: 'add', scope: 'all', value: '1', predicate: [] }],

  // "Increase your HP by 2 per level." A flat max-HP bump scaling with level (same sink as Living Wall).
  healthy_vim: [{ label: 'Healthy Vim', target: 'health.max', mode: 'add', scope: 'all', value: '2*@level', predicate: [] }],

  // "Gain one additional reaction." A permanent +1 to the per-round reaction max (base-actor derives
  // reaction.max = 1 + this). Passive, always on.
  rapid_reaction: [{ label: 'Rapid Reaction', target: 'reactions', mode: 'add', scope: 'all', value: '1', predicate: [] }],

  // "Gain an additional 1× Advantage when you have Half Cover." Reads the character's own player-set
  // Cover state (`self:cover:half`, which Full cover also satisfies). A roll-time self-gate.
  carmine_approach: [{
    label: 'Carmine Approach', target: 'advantage.toHit', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: 'self:cover:half' }],
  }],

  // "When you wield both a shield and a spear-family weapon, increase your PD by 1."
  shield_and_spear: [{
    label: 'Shield and Spear', target: 'defense.pd', mode: 'add', scope: 'all', value: '1',
    predicate: [{ atom: 'self:wielding:shield' }, { atom: 'self:wielding:spear' }],
  }],

  /* ---- Soldier: weapon-family base-damage die-steps ----
     "Increase the base damage dice done by <family> by one type." Each gates on the *bound weapon*
     of the attack being rolled (`self:attack:weapon:<type>`, emitted only for that single weapon at
     roll time) — not `self:wielding:*`, so a shield+spear soldier's shield-bash doesn't wrongly pick
     up the spear step and vice-versa. Scope `melee` since every soldier weapon is a melee attack. */

  // "Increase the base damage dice done by spears by one type."
  midas_spear: [{
    label: 'Midas Spear', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:spear' }],
  }],

  // "Increase the damage dice of your shield by one dice type." (Frontline.)
  shield_bash: [{
    label: 'Shield Bash', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:shield' }],
  }],

  // "Increase the base damage dice done by shields by one type." (Vanguard — a separate ability from
  // Shield Bash; RAW both apply, so a soldier with both steps their shield damage twice.)
  shield_warrior: [{
    label: 'Shield Warrior', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:shield' }],
  }],

  // "When you wield both a shield and a one-handed melee weapon, add your shield's Defense to the damage
  // dealt by your non-shield melee weapon." Flat `@shieldDefense` (equipped shield's PD+TD) on melee
  // attacks that are *not* the shield itself (`!self:attack:weapon:shield` → roll-time fold).
  sword_and_shield: [{
    label: 'Sword and Shield', target: 'damage', mode: 'add', scope: 'melee', value: '@shieldDefense',
    predicate: [{ atom: 'self:wielding:shield' }, { atom: '!self:attack:weapon:shield' }],
  }],

  // "For every two melee attacks you make using your shield, increase the damage dice of your other-hand
  // one-handed weapon by one type until the start of your next turn." A die-step = ⌊shield-attacks / 2⌋
  // on non-shield melee attacks (the counter increments GM-side in resolveAttack, resets each turn).
  flurry_of_shields: [{
    label: 'Flurry of Shields', target: 'damage', mode: 'step', scope: 'melee',
    value: 'floor(@combat.shieldAttacks/2)',
    predicate: [{ atom: 'self:wielding:shield' }, { atom: '!self:attack:weapon:shield' }],
  }],

  // "For each attack you successfully make with a shield, gain +1 to-hit and damage with your other-hand
  // one-handed weapon until the start of your next turn." Flat +shield-hits to both, on non-shield melee.
  one_two_bash: [
    { label: 'One-Two Bash', target: 'toHit', mode: 'add', scope: 'melee', value: '@combat.shieldHits',
      predicate: [{ atom: 'self:wielding:shield' }, { atom: '!self:attack:weapon:shield' }] },
    { label: 'One-Two Bash', target: 'damage', mode: 'add', scope: 'melee', value: '@combat.shieldHits',
      predicate: [{ atom: 'self:wielding:shield' }, { atom: '!self:attack:weapon:shield' }] },
  ],

  // Soldier — "Raise your HP by 2 per level you have now." An always-on max-HP bump (the book's
  // per-level increase is just the derived total). Folds into `bonuses.healthMax` → max HP.
  living_wall: [{
    label: 'Living Wall', target: 'health.max', mode: 'add', scope: 'all', value: '2*@level',
    predicate: [],
  }],

  /* ---- Maintain-Focus self-buffs (gated on `self:used:*`; the log clears at turn start, which is
         exactly "as long as you maintain Focus" / "until the start of your next turn") ---- */

  // "As long as you maintain Focus, gain DR equal to half your Proficiency (rounded up)." Superseded by
  // Legendary Resistance (which raises the same DR to full Proficiency), so it drops out while owned.
  thug_thickskin: [{
    label: 'Thickskin', target: 'defense.dr', mode: 'add', scope: 'all', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:used:thug_thickskin' }, { atom: '!self:ability:thug_legendary_resistance' }],
  }],

  // "Increase your Thickskin damage resistance to your Proficiency score for as long as you maintain
  // Focus." Rides Thickskin's own maintenance flag (`self:used:thug_thickskin`), replacing the ½ with
  // full Proficiency (supersede pair, above).
  thug_legendary_resistance: [{
    label: 'Legendary Resistance', target: 'defense.dr', mode: 'add', scope: 'all', value: '@proficiency',
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

  // Soldier Spear Throw — "increase the damage dice of your weapon by two dice types." Two die-steps on
  // this ability's own thrown-spear attack (scoped to its catalogId). The attack activity is authored in
  // ACTIVITY_OVERRIDES; here we bump its damage. (Always-on for the throw — no predicate.)
  spear_throw: [{ label: 'Spear Throw', target: 'damage', mode: 'step', scope: 'spear_throw', value: '2', predicate: [] }],

  // Soldier — "For each ally behind you while using Protectorate, increase the damage dice of all melee
  // attacks you make by one dice type." A melee die-step scaling by adjacent allies (the positional
  // `@adjacentAllies` count), gated on maintaining Protectorate (`self:used:protectorate`) this turn.
  // *Simplification:* "behind you" (a facing/arc test) is approximated as allies within 5ft — the same
  // player-visible-state spirit as Cover, without exact facing geometry. The `@adjacentAllies` in the
  // value routes this to the roll-time fold.
  propped_up: [{
    label: 'Propped Up', target: 'damage', mode: 'step', scope: 'melee', value: '@adjacentAllies',
    predicate: [{ atom: 'self:used:protectorate' }],
  }],

  /* ---- Named / Divine weapon, designated on the weapon from the ability's card: a Fatebound's divine weapon is
         `flags.sacadia.signature` (Fated Strike's pick → `self:attack:divine` when it's the bound weapon); a Bladedancer's
         named weapon is `flags.sacadia.namedAs` (the Named Weapon ability's pick → `self:attack:named-by:<id>`). ---- */

  // Bladedancer — "Name one versatile weapon you own. Increase the dice type of that weapon by one." A Named
  // Weapon ability (v1.2: one name per weapon): the weapon whose "Named as" is Sharp Weapon.
  bd_sharp_weapon: [{
    label: 'Sharp Weapon', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:named-by:bd_sharp_weapon' }],
  }],
  // Bladedancer — "Increase the damage dice type of your named Sharp weapon by one additional type."
  bd_extra_sharp: [{
    label: 'Extra Sharp', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:named-by:bd_sharp_weapon' }],
  }],
  // Fatebound — "Increase the base damage of your divine weapon by one dice type provided it is a heavy
  // (two-handed) weapon." Gated on the divine weapon being the bound weapon *and* two-handed.
  humongous: [{
    label: 'Humongous', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:divine' }, { atom: 'self:attack:hands:2' }],
  }],
  // Fatebound — "Increase the base damage die of your heavy Divine Weapon by one additional type."
  // Rides Humongous (prerequisite) → a second step on the same heavy divine weapon.
  ridiculous_size: [{
    label: 'Ridiculous Size', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:divine' }, { atom: 'self:attack:hands:2' }],
  }],
  // Fatebound — "When you melee with your bludgeoning divine weapon against a Prone creature, increase
  // the base damage dice by one type." Divine + bludgeon-family + a Prone target.
  slamstrike: [{
    label: 'Slamstrike', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:divine' }, { atom: 'self:attack:weapon:bludgeon' }, { atom: 'target:condition:prone' }],
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

  /* ---- Fatebound: Targeted Foe (mark-gated Focus buff vs one target) + its upgrade ---- */

  // "Add half your Fate (rounded up) to all to-hit and damage rolls against the Targeted Foe, while
  // maintained." Gated on this turn's maintenance (`self:used:targeted_foe`) + the marked target. Both
  // halves drop out once Tighten Focus is owned (it re-authors them at full Fate — supersede pair).
  targeted_foe: ['toHit', 'damage'].map((target) => ({
    label: 'Targeted Foe', target, mode: 'add', scope: 'all', value: 'ceil(@fate/2)',
    predicate: [
      { atom: 'self:used:targeted_foe' }, { atom: 'target:mark:targeted-foe' },
      { atom: '!self:ability:tighten_focus' },
    ],
  })),

  // "When you use Targeted Foe, add your *full* Fate to to-hit and damage against that target instead of
  // half." The upgrade — same mark/maintenance gate, full Fate (supersede pair, above).
  tighten_focus: ['toHit', 'damage'].map((target) => ({
    label: 'Tighten Focus', target, mode: 'add', scope: 'all', value: '@fate',
    predicate: [{ atom: 'self:used:targeted_foe' }, { atom: 'target:mark:targeted-foe' }],
  })),

  /* ---- Fatebound: crit-range wideners (lower the natural-d20 crit floor via `critThreshold`) ---- */

  // "Your attacks critically hit on a natural 19 or 20." −1 to the crit floor (20 → 19). Superseded by
  // Divine Criticality (which lowers it to 18), so it drops out while that's owned.
  criticality: [{
    label: 'Criticality', target: 'critThreshold', mode: 'add', scope: 'all', value: '-1',
    predicate: [{ atom: '!self:ability:divine_criticality' }],
  }],

  // "Your attacks critically hit on a natural 18, 19, or 20." −2 to the crit floor (20 → 18).
  divine_criticality: [{
    label: 'Divine Criticality', target: 'critThreshold', mode: 'add', scope: 'all', value: '-2', predicate: [],
  }],

  /* ---- Fatebound: Focus / divine-weapon self-buffs ---- */

  // "Expend a Glory point. You are resistant to all damage by half your Proficiency (rounded up) for as
  // long as you maintain Focus." A maintained-Focus DR self-buff (same shape as Thug's Thickskin).
  hide_of_beasts: [{
    label: 'Hide of Beasts', target: 'defense.dr', mode: 'add', scope: 'all', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:used:hide_of_beasts' }],
  }],

  // "When you attack using your divine weapon, add your Fate score to damage (in addition to Power or
  // Finesse)." The divine weapon is Fated Strike's pick (the weapon's `signature` flag → `self:attack:divine`).
  fated_strike: [{
    label: 'Fated Strike', target: 'damage', mode: 'add', scope: 'all', value: '@fate', predicate: [{ atom: 'self:attack:divine' }],
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

  /* ---- Sentinel: bow-ramp combat counters (per-turn state → roll-time modifiers, gated on the bow
         being the bound weapon of the attack). `@combat.*` counters are maintained GM-side in
         resolveAttack and reset at turn start. ---- */

  // "For each subsequent missed bow attack this turn, add half your Wiles (rounded up) to your next
  // To-Hit." Scales with the missed-attack count; applies to bow attacks.
  aim_calibration: [{
    label: 'Aim Calibration', target: 'toHit', mode: 'add', scope: 'ranged',
    value: 'ceil(@wiles/2)*@combat.missedAttacks',
    predicate: [{ atom: 'self:attack:weapon:bow' }],
  }],

  // "For each bow hit against a target not attacked yet this turn, add ½ Proficiency (rounded up) to
  // To-Hit against future new targets." A per-new-target-hit to-hit ramp, applied when attacking a new
  // target (`target:new`).
  hawkeye: [{
    label: 'Hawkeye', target: 'toHit', mode: 'add', scope: 'ranged',
    value: 'ceil(@proficiency/2)*@combat.newTargets',
    predicate: [{ atom: 'self:attack:weapon:bow' }, { atom: 'target:new' }],
  }],

  // "…add your Proficiency to damage dealt to new targets." Same new-target ramp, on damage.
  bowman: [{
    label: 'Bowman', target: 'damage', mode: 'add', scope: 'ranged',
    value: '@proficiency*@combat.newTargets',
    predicate: [{ atom: 'self:attack:weapon:bow' }, { atom: 'target:new' }],
  }],

  // Sentinel — "Take up to twice; each time choose bow/crossbow/sling and increase that weapon's damage
  // dice by one size." A permanent weapon-type pick (PICK_OVERRIDES); each copy is one die-step on attacks
  // with its picked weapon, so two copies on the crossbow are two steps.
  bigger_stones: [{ label: 'Bigger Stones', target: 'damage', mode: 'step', scope: 'ranged', value: '1',
    predicate: [{ atom: 'self:attack:picked:bigger_stones' }] }],

  /* ---- Sentinel: Cover-interaction (the defensive Cover penalty — Half −1 / Full −2 to attacks
         against a covered target — is applied in #useAbility; these negate/reduce it). ---- */

  // "When you make a ranged attack, do not gain 1× disadvantage vs creatures with half cover." Cancels
  // the Half-cover penalty (+1 advantage), but not Full (gated `!target:cover:full`).
  expert_marksman: [{
    label: 'Expert Marksman', target: 'advantage.toHit', mode: 'add', scope: 'ranged', value: '1',
    predicate: [{ atom: 'target:cover:half' }, { atom: '!target:cover:full' }],
  }],

  // "You may attack creatures in full cover; gain 1× disadvantage against them." Reduces the Full-cover
  // penalty (−2) to 1× by adding back +1 advantage vs a full-cover target.
  curving_shots: [{
    label: 'Curving Shots', target: 'advantage.toHit', mode: 'add', scope: 'ranged', value: '1',
    predicate: [{ atom: 'target:cover:full' }],
  }],

  /* ---- Sentinel: Boltshot family (crossbow advantage → bonus damage per advantage stack) ---- */

  // Boltshot (book p.170): "For every 1× advantage on a Consistent crossbow attack (≥2 AP), add X damage
  // on a hit, where X = ½ Proficiency." Boltshot Pro raises X to full Proficiency. Pullback turns the flat
  // per-stack X into XD4; Greatpull into XD6. Realized as advantage-gated damage modifiers on the *Boltshot*
  // item (so the whole chain fires only when Boltshot is owned), refined by Pro/Pullback/Greatpull ownership.
  // Gate: `self:attack:weapon:crossbow` + `self:attack:has-advantage` + `self:attack:ap:2plus` (the per-attack
  // AP cost + net advantage `@advantageStacks`, set in #useAbility before the damage fold). Two X variants
  // (½Prof / Prof) × three forms (flat / XD4 / XD6), each a clean ownership-superseded pair — six modifiers.
  boltshot: (() => {
    const gate = [
      { atom: 'self:attack:weapon:crossbow' },
      { atom: 'self:attack:has-advantage' },
      { atom: 'self:attack:ap:2plus' },
    ];
    // X per advantage stack: ½Prof, superseded by full Prof once Boltshot Pro is owned.
    const xVariants = [
      { x: 'ceil(@proficiency/2)', pred: [{ atom: '!self:ability:boltshot_pro' }] },
      { x: '@proficiency', pred: [{ atom: 'self:ability:boltshot_pro' }] },
    ];
    const mods = [];
    for (const { x, pred } of xVariants) {
      // Flat X · advantage stacks (no Pullback).
      mods.push({ label: 'Boltshot', target: 'damage', mode: 'add', scope: 'ranged',
        value: `${x}*@advantageStacks`, predicate: [...gate, ...pred, { atom: '!self:ability:pullback' }] });
      // Pullback → (X · stacks)D4 (has Pullback, not yet Greatpull).
      mods.push({ label: 'Pullback', target: 'damageDice', mode: 'add', scope: 'ranged',
        value: `(${x}*@advantageStacks)d4`, predicate: [...gate, ...pred, { atom: 'self:ability:pullback' }, { atom: '!self:ability:greatpull' }] });
      // Greatpull → (X · stacks)D6.
      mods.push({ label: 'Greatpull', target: 'damageDice', mode: 'add', scope: 'ranged',
        value: `(${x}*@advantageStacks)d6`, predicate: [...gate, ...pred, { atom: 'self:ability:greatpull' }] });
    }
    return mods;
  })(),

  // Loose Morals (book p.170): "A frenzied ranged crossbow attack rolls with 1× advantage." A gated
  // advantage grant (frenzy + bound crossbow). Its "increases damage dice size" clause *is* that extra
  // advantage stack feeding the Boltshot/Pullback/Greatpull dice above — no separate die-step is authored.
  loose_morals: [{
    label: 'Loose Morals', target: 'advantage.toHit', mode: 'add', scope: 'ranged', value: '1',
    predicate: [{ atom: 'self:condition:frenzy' }, { atom: 'self:attack:weapon:crossbow' }],
  }],

  /* ---- resist-advantage: conditional advantage on the Make-Trait-Check to shed a condition (book p.258).
         The `resistAdvantage` target is folded only by #onResistCondition, gated on the condition being
         resisted (`self:resisting:<key>` / `self:resisting:physical|mental`) + any self-state. ---- */

  // "Roll all Trait Checks against Fatigue … at 1× advantage." (Sentinel — this IS the Make-Trait-Check.)
  enduring_animal: [{
    label: 'Enduring Animal', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:resisting:fatigue' }],
  }],
  // "When raging, 1× advantage on trait checks against physical adversarial conditions." (Thug.)
  thug_rage_in_pain: [{
    label: 'Rage in Pain', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:raging' }, { atom: 'self:checking:physical' }],
  }],
  // "Gain 1× Advantage against Panic." (Soldier Defensive Mastery; its tower-shield move clause is descriptive.)
  mastery_defensive: [{
    label: 'Defensive Mastery', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:checking:panic' }],
  }],

  /* ---- Condition checks — the checker's own side (see module/helpers/check-pool.mjs). `self:saving:*` is
         the check when a condition is first given, `self:resisting:*` the Make Trait Check action,
         `self:checking:*` either. ---- */

  // "Add your Wiles score to any Trait Check you make against mental conditions. If the Trait Check you
  // must make is a Wiles Check, add your Wiles score again." (Oracle.)
  mental_fortitude: [
    { label: 'Mental Fortitude', target: 'resistBonus', mode: 'add', value: '@wiles', predicate: [{ atom: 'self:checking:mental' }] },
    { label: 'Mental Fortitude', target: 'resistBonus', mode: 'add', value: '@wiles',
      predicate: [{ atom: 'self:checking:mental' }, { atom: 'self:checking:trait:wiles' }] },
  ],
  // "When you have less than half HP, gain 1× advantage to all Trait Checks against Mental Conditions." (Oracle.)
  bloodied_mind: [{
    label: 'Bloodied Mind', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:checking:mental' }, { atom: 'self:hp-below-half' }],
  }],
  // "1× advantage on checks against Pin when it is first given to you (but not on … Make Trait Check)." (Thug.)
  thug_anointed: [{
    label: 'Anointed', target: 'resistAdvantage', mode: 'add', value: '1', predicate: [{ atom: 'self:saving:pinned' }],
  }],
  // "1× advantage to any Make Trait Check action to reduce a condition given to you by a targeted foe." (Fatebound.)
  aware_foe: [{
    label: 'Aware Foe', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:resisting:from:targeted-foe' }],
  }],

  /* ---- Condition checks — the caster's side: debuffs on the save an ability forces (`saveAdvantage`,
         negative = disadvantage to the saver) and its DC (`saveDc`), gated on `inflict:<cond>` / target
         state; and a Check-DC bump against the target's later Make Trait Check (`checkDcVs`). ---- */

  // "Whenever you attempt to give a target Pin, they roll against the effect with 1× disadvantage." (Thug.)
  thug_tough_starter: [{
    label: 'Tough Starter', target: 'saveAdvantage', mode: 'add', value: '-1', predicate: [{ atom: 'inflict:pinned' }],
  }],
  // "When you attempt to give Wrestle Pin to a target who is Prone, they make their Finesse Checks at 1× Disadvantage."
  thug_ground_wrestle: [{
    label: 'Ground Wrestle', target: 'saveAdvantage', mode: 'add', value: '-1',
    predicate: [{ atom: 'inflict:pinned' }, { atom: 'target:condition:prone' }],
  }],
  // "They make Trait Checks against the effect at 1× disadvantage for every 3 levels of Hemorrhage you
  // attempt to give them." (Fatebound + Bladedancer versions.)
  bloodletter: [{
    label: 'Bloodletter', target: 'saveAdvantage', mode: 'add', value: '0 - floor(@inflict.hemorrhage/3)',
    predicate: [{ atom: 'inflict:hemorrhage' }],
  }],
  bd_bloodletter: [{
    label: 'Bloodletter', target: 'saveAdvantage', mode: 'add', value: '0 - floor(@inflict.hemorrhage/3)',
    predicate: [{ atom: 'inflict:hemorrhage' }],
  }],
  // "When you use the Kick action on an enemy, they gain 1× Disadvantage on the Trait Check against Kick." (Hulinari.)
  hindkick: [{
    label: 'Hindkick', target: 'saveAdvantage', mode: 'add', value: '-1', scope: 'basic_kick',
  }],
  // "Gain 1× Advantage on opportunity attacks of any kind. When you attempt to Kick a target, they roll
  // their Trait Check against being moved at 1× Disadvantage." (Thug.)
  thug_lightning_shove: [
    { label: 'Lightning Shove', target: 'advantage.toHit', mode: 'add', value: '1', predicate: [{ atom: 'self:attack:opportunity' }] },
    { label: 'Lightning Shove', target: 'saveAdvantage', mode: 'add', value: '-1', scope: 'basic_kick' },
  ],
  // "When you have Pinned an enemy through Natural Wrestler and they make a Trait Check against your Check
  // DC, they treat your Check DC as one higher." (Thug Mastery.) Both the saves you force on a Pinned target
  // and their Make Trait Checks against your Pin.
  mastery_pin: [
    { label: 'Mastery of the Pin', target: 'saveDc', mode: 'add', value: '1',
      predicate: [{ atom: 'target:condition:pinned' }, { atom: 'self:ability:thug_natural_wrestler' }] },
    { label: 'Mastery of the Pin', target: 'checkDcVs', mode: 'add', value: '1',
      predicate: [{ atom: 'vs:checking:pinned' }, { atom: 'self:ability:thug_natural_wrestler' }] },
  ],

  /* ---- The defender's side of an incoming attack: `incomingAdvantage` (evaluated at the attacker's roll
         from the target's point of view — attack:melee|ranged, attack:opportunity, attack:defense:<k>,
         attack:attacker:pinned, self:surrounded) and `incomingDr` (at GM resolution — also
         attack:from:mark:<key> when the attacker is one of your marked foes). ---- */

  // "Creatures do not get advantage to hit you when you are Surrounded." (General.) Cancels the core
  // Surrounded melee advantage.
  swarm_defense: [{
    label: 'Swarm Defense', target: 'incomingAdvantage', mode: 'add', value: '-1',
    predicate: [{ atom: 'self:surrounded' }, { atom: 'attack:melee' }],
  }],
  // "Reactions used to grab or make an Attack of Opportunity on you are made at 1× disadvantage." (Bladedancer.)
  // The Grab half: the grabber's reaction is at disadvantage → your check against it is easier.
  bd_agile_dance: [
    { label: 'Agile Dance', target: 'incomingAdvantage', mode: 'add', value: '-1', predicate: [{ atom: 'attack:opportunity' }] },
    { label: 'Agile Dance', target: 'resistAdvantage', mode: 'add', value: '1', predicate: [{ atom: 'self:saving:ability:basic_grab' }] },
  ],
  // "…an enemy within 5 feet who attempts an attack of opportunity against you … gets 1× disadvantage." (Sentinel.)
  close_marksman: [{
    label: 'Close Marksman', target: 'incomingAdvantage', mode: 'add', value: '-1', predicate: [{ atom: 'attack:opportunity' }],
  }],
  // "All creatures who make an attack of opportunity against you when you use Charge the Line do so with
  // 1× Disadvantage." (Hulinari.)
  erratic_charge: [{
    label: 'Erratic Charge', target: 'incomingAdvantage', mode: 'add', value: '-1',
    predicate: [{ atom: 'attack:opportunity' }, { atom: 'self:used:charge_the_line' }],
  }],
  // "As long as you maintain focus and have Pinned an enemy, melee attacks against you from anyone other
  // than the enemy who you have Pinned are made at 1× disadvantage." (Thug.) "The enemy you Pinned" is read
  // as an attacker who is currently Pinned.
  thug_greased_and_wily: [{
    label: 'Greased and Wily', target: 'incomingAdvantage', mode: 'add', value: '-1',
    predicate: [{ atom: 'attack:melee' }, { atom: 'self:used:thug_greased_and_wily' }, { atom: '!attack:attacker:pinned' }],
  }],
  // "As long as you maintain focus, you are treated as under half cover against any ranged attack." (Sentinel.)
  deflect_arrows: [{
    label: 'Deflect Arrows', target: 'incomingAdvantage', mode: 'add', value: '-1',
    predicate: [{ atom: 'attack:ranged' }, { atom: 'self:used:deflect_arrows' }],
  }],
  // "You are resistant to attack damage dealt against your MD by your Power Score." (Thug Mastery.)
  mastery_mageslayer: [{
    label: 'Mage-Slayer', target: 'incomingDr', mode: 'add', value: '@power', predicate: [{ atom: 'attack:defense:md' }],
  }],
  // "You are resistant to all damage dealt by a targeted foe by your Proficiency." (Fatebound.)
  resilient_foe: [{
    label: 'Resilient Foe', target: 'incomingDr', mode: 'add', value: '@proficiency',
    predicate: [{ atom: 'attack:from:mark:targeted-foe' }],
  }],
  // "Whenever you are Skittish to a target and they deal damage against you, reduce that damage by your
  // Proficiency." (Hulinari.)
  skittish_step: [{
    label: 'Skittish Step', target: 'incomingDr', mode: 'add', value: '@proficiency',
    predicate: [{ atom: 'attack:from:mark:skittish' }],
  }],
  // "When you are surrounded and in Brute Form, gain 1 damage resistance to all physical attacks." (Hulinari.)
  toughhide: [{
    label: 'Toughhide', target: 'incomingDr', mode: 'add', value: '1',
    predicate: [{ atom: 'self:surrounded' }, { atom: 'attack:physical' }, { atom: 'self:form:brute' }],
  }],
  // "When you are Prone, you do not receive 1× disadvantage to attacks you make." (Thug.) Offsets Prone's
  // standing −1 to-hit.
  thug_kato_champion: [{
    label: 'Kato Champion', target: 'advantage.toHit', mode: 'add', value: '1', predicate: [{ atom: 'self:prone' }],
  }],

  /* ---- Permanent picks (see PICK_OVERRIDES): the bound weapon is the picked type → `self:attack:picked:<id>`;
         the checked condition is the picked one → `self:checking|saving:picked:<id>`. ---- */

  // "Choose one family of one-handed melee weapons … Increase the base damage dice … by one type." (Soldier.)
  swordwork: [{ label: 'Swordwork', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:picked:swordwork' }] }],
  // "Choose one weapon type … Increase the base damage die of using this weapon by one type." (Bladedancer.)
  bd_harmful_hand: [{ label: 'Harmful Hand', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:picked:bd_harmful_hand' }] }],
  // "Increase the damage dice of the same weapon from Harmful Hand by one additional damage die."
  bd_devastating_hand: [{ label: 'Devastating Hand', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:picked:bd_harmful_hand' }] }],
  // "Choose one weapon type … Increase the base damage die of this weapon by one type." (General.)
  sharp_weaponry: [{ label: 'Sharp Weaponry', target: 'damage', mode: 'step', scope: 'all', value: '1',
    predicate: [{ atom: 'self:attack:picked:sharp_weaponry' }] }],
  // "Choose one two-handed melee weapon you wield. Increase the damage dice of the chosen weapon by one type."
  big_guns_expert: [{ label: 'Big Guns Expert', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:picked:big_guns_expert' }, { atom: 'self:attack:hands:2' }] }],
  // "You may wield a basic club using two hands … If you do so, increase the damage dice by one type."
  // (Set the club's Hands to 2 on the weapon when wielding it that way.)
  club_enthusiast: [{ label: 'Club Enthusiast', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:bludgeon' }, { atom: 'self:attack:hands:2' }] }],
  // "Choose one: Paralysis, Pinned, Pulled. Gain 1× Advantage on trait checks against this condition and on
  // the Make Trait Check action against it." (Bladedancer.)
  bd_not_impressed: [{ label: 'Not Even Impressed', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:checking:picked:bd_not_impressed' }] }],
  // "When someone attempts to give you that condition, make your initial Trait Check against the effect at
  // 1× advantage. Choosing the same condition each time stacks." (General; one instance per pick.)
  drain_tolerant: [{ label: 'Drain Tolerant', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:saving:picked:drain_tolerant' }] }],

  /* ---- Opportunity / reaction attacks (`self:attack:opportunity` from the four Opportunity Attacks;
         `self:attack:reaction` from any reaction-tag attack). ---- */

  // "When you make an attack of opportunity against a target, increase the damage dice by one type." (Hulinari.)
  hidebite: [{ label: 'Hidebite', target: 'damage', mode: 'step', scope: 'all', value: '1', predicate: [{ atom: 'self:attack:opportunity' }] }],
  // "Increase the dice type of attacks of opportunity you make by one additional type."
  grand_hidebite: [{ label: 'Grand Hidebite', target: 'damage', mode: 'step', scope: 'all', value: '1', predicate: [{ atom: 'self:attack:opportunity' }] }],
  // "When you make an opportunity attack, increase the damage dice you deal by 1 dice type." (Thug.)
  thug_shove_and_twist: [{ label: 'Shove and Twist', target: 'damage', mode: 'step', scope: 'all', value: '1', predicate: [{ atom: 'self:attack:opportunity' }] }],
  // "When you are Focusing on Protectorate and make an opportunity attack, +1 melee damage dice type." (Soldier.)
  porcupine: [{ label: 'Porcupine', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:opportunity' }, { atom: 'self:used:protectorate' }] }],
  // "When you make a reaction attack … using a ranged weapon and are Surrounded, +1 dice type." (Sentinel.)
  unrelenting_accident: [{ label: 'Unrelenting Accident', target: 'damage', mode: 'step', scope: 'ranged', value: '1',
    predicate: [{ atom: 'self:attack:reaction' }, { atom: 'self:surrounded' }] }],
  // "When you are Surrounded and make a ranged reaction attack … you may make an additional ranged reaction
  // attack against a second creature … at 1× disadvantage." I've Always Wanted to Be Here lifts it.
  im_not_supposed_to_be_here: [{ label: "I'm Not Supposed to Be Here", target: 'advantage.toHit', mode: 'add', scope: 'ranged', value: '-1',
    predicate: [{ atom: 'self:attack:reaction' }, { atom: 'self:surrounded' }, { atom: 'self:combat:reaction-attacks>=1' },
      { atom: '!self:ability:ive_always_wanted_to_be_here' }] }],

  /* ---- Counters: per-target hits this turn (`@target.hits`), unique targets hit under a Focus
         (`@combat.focusTargets.<id>`), enemies in the fight (`@combat.enemies`). ---- */

  // Multiplicity: "whenever you deal damage to a new unique target enemy, increase the damage you deal in all
  // attacks by 1 (to a maximum of your Proficiency) for as long as you maintain Focus." (Bladedancer.)
  bd_multiplicity: [{ label: 'Multiplicity', target: 'damage', mode: 'add', scope: 'all',
    value: 'min(@combat.focusTargets.bd_multiplicity, @proficiency)', predicate: [{ atom: 'self:used:bd_multiplicity' }] }],
  // Completionist: "…have hit every enemy target, increase the damage you deal to all targets by 1."
  bd_completionist: [{ label: 'Completionist', target: 'damage', mode: 'add', scope: 'all',
    value: 'min(1, @combat.enemies) * min(1, max(0, @combat.focusTargets.bd_multiplicity - @combat.enemies + 1))',
    predicate: [{ atom: 'self:used:bd_multiplicity' }] }],
  // Boss Energy: "If you focus on Multiplicity and there is only one enemy, +½ Proficiency damage."
  bd_boss_energy: [{ label: 'Boss Energy', target: 'damage', mode: 'add', scope: 'all',
    value: 'ceil(@proficiency/2) * max(0, 2 - @combat.enemies) * min(1, @combat.enemies)',
    predicate: [{ atom: 'self:used:bd_multiplicity' }] }],
  // Reverse Pankration: "For every 2 successful melee attacks you have made against a target this turn,
  // increase your Check DC by 1." (Thug — against that target's checks.)
  thug_reverse_pankration: [{ label: 'Reverse Pankration', target: 'saveDc', mode: 'add', value: 'floor(@target.hits/2)' }],
  // Wrestling Friends: "For each ally within 5ft of a target to whom you have given Wrestle Pin, add half your
  // Finesse (rounded up) to damage you deal with Harm."
  thug_wrestling_friends: [{ label: 'Wrestling Friends', target: 'damage', mode: 'add', scope: 'thug_harm',
    value: 'ceil(@finesse/2) * @targetAdjacentAllies', predicate: [{ atom: 'target:condition:pinned' }] }],
  // Gliding Strike: "If you recover a use of 5ft adjust through Glidestep on an attack … add your Finesse to
  // damage" — Glidestep recovers it on a melee hit on a new target after you've 5ft-adjusted this turn.
  bd_gliding_strike: [{ label: 'Gliding Strike', target: 'damage', mode: 'add', scope: 'melee', value: '@finesse',
    predicate: [{ atom: 'target:new' }, { atom: 'self:used:basic:fiveFootAdjust' }, { atom: 'self:ability:bd_glidestep' }] }],
  // Cornered Courage: "When you are Surrounded, add half your Courage to damage dealt through Sweeping Claws."
  cornered_courage: [{ label: 'Cornered Courage', target: 'damage', mode: 'add', scope: 'sweeping_claws',
    value: 'ceil(@courage/2)', predicate: [{ atom: 'self:surrounded' }] }],
  // Sweeping Claws: "Reduce damage dealt this way by one dice type."
  sweeping_claws: [{ label: 'Sweeping Claws', target: 'damage', mode: 'step', scope: 'sweeping_claws', value: '-1' }],

  // Chokehold: "If you are Steadied, you may increase the dice type of this damage by one type."
  thug_chokehold: [{ label: 'Chokehold (Steadied)', target: 'damage', mode: 'step', scope: 'thug_chokehold', value: '1',
    predicate: [{ atom: 'self:steadied' }] }],

  // Hulinari Skittish: "declare a target. When you do so, gain 1× advantage to all Trait Checks that enemy
  // makes you roll." (Skittish marks its target; the save knows its caster.)
  skittish: [{ label: 'Skittish', target: 'resistAdvantage', mode: 'add', value: '1',
    predicate: [{ atom: 'self:saving:from:mark:skittish' }] }],

  /* ---- Hulinari Swarm, v1.2 ---- */
  // Focused Bite — "Increase the damage of Birdbite by 1 Dice Type for every Focus Action you are actively maintaining."
  focused_bite: [{ label: 'Focused Bite', target: 'damage', mode: 'step', scope: 'birdbite', value: '@combat.focusMaintained', predicate: [] }],

  /* ---- Move Speed (derived `speed`; book: every Heritage 30ft base) ---- */
  bd_fleetfeet: [{ label: 'Fleetfeet', target: 'speed', value: '5', predicate: [] }],
  bd_rapidfeet: [{ label: 'Rapidfeet', target: 'speed', value: '5', predicate: [] }],
  bd_flashfeet: [{ label: 'Flashfeet', target: 'speed', value: '5', predicate: [] }],
  bd_flitting_feet: [{ label: 'Flitting Feet', target: 'speed', value: '5', predicate: [] }],
  bd_dancing_feet: [{ label: 'Dancing Feet', target: 'speed', value: '5', predicate: [] }],
  bd_speed_of_the_gods: [{ label: 'Speed of the Gods', target: 'speed', value: '10', predicate: [] }],
  legendary_step: [{ label: 'Mastery of the Step', target: 'speed', value: '5', predicate: [] }],
  mastery_paw_and_wing: [{ label: 'Mastery of Paw and Wing', target: 'speed', value: '5', predicate: [] }],
  need_for_speed: [{ label: 'Need for Speed', target: 'speed', value: '10', predicate: [{ atom: 'self:form:pack' }] }],
  bulk_muscle: [{ label: 'Bulk Muscle', target: 'speed', value: '10', predicate: [{ atom: 'self:form:pack' }] }],
  faster_still: [{ label: 'Faster Still', target: 'speed', value: '10', predicate: [{ atom: 'self:form:pack' }] }],

  /* ---- Profession level features & Legendary Masteries (src/progression.mjs) ---- */
  // "When you are Surrounded or Cornered, creatures do not gain 1X Advantage on attacks made against you." The Cornered
  // half; Surrounded's melee advantage is simply not given (AbilityUse, with Surrounded Brute), so the two don't add up.
  legendary_cornered: [
    { label: 'Mastery of the Cornered', target: 'incomingAdvantage', value: '-1', predicate: [{ atom: 'self:cornered' }] },
  ],
  // Hulinari — "All of your attacks gain 1X advantage when you are Cornered." (Cornered: an environmental
  // token status.)
  cornered_cat: [{ label: 'Cornered Cat', target: 'advantage.toHit', value: '1', predicate: [{ atom: 'self:cornered' }] }],
  // Sentinel — "When you have height advantage over targets, you are treated as having Half Cover." Half
  // Cover = attacks against you at 1× disadvantage.
  i_have_the_high_ground: [{ label: 'I Have the High Ground', target: 'incomingAdvantage', value: '-1', predicate: [{ atom: 'self:height' }] }],
  // "Increase the damage … by half your Proficiency (rounded up) when you apply three Boosts to an attack."
  legendary_boost: [{ label: 'Boost Mastery', target: 'damage', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:attack:boosts>=3' }] }],
  // "When you make an unarmed attack in Beast form, change the damage dice from 1D4 to 1D8." (+2 types)
  hul_antlers_claws_and_talons: [{ label: 'Antlers, Claws, and Talons', target: 'damage', mode: 'step', scope: 'melee', value: '2',
    predicate: [{ atom: 'self:attack:weapon:unarmed' }, { atom: 'self:form:beast' }] }],
  legendary_brute: [{ label: 'Mastery of the Brute', target: 'damage', mode: 'step', scope: 'melee', value: '1',
    predicate: [{ atom: 'self:attack:weapon:unarmed' }, { atom: 'self:form:brute' }] }],
  legendary_swarm: [{ label: 'Mastery of the Swarm', target: 'incomingDr', value: 'ceil(@proficiency/2)',
    predicate: [{ atom: 'self:form:swarm' }, { atom: 'attack:physical' }] }],
  oracle_minds_eye: [{ label: 'Mind’s Eye', target: 'checkDc', value: '1', predicate: [] }],
  legendary_blood: [{ label: 'Blood Mastery', target: 'health.max', value: '6', predicate: [] }],
  legendary_armor_oracle: [{ label: 'Armor Mastery', target: 'defense.pd', value: '2', predicate: [{ atom: '!self:armor:any' }] }],
  legendary_weapon: [{ label: 'Weapon Mastery', target: 'damage', mode: 'step', scope: 'ranged', value: '1', predicate: [] }],
  // "Add half your Wiles to your to-hit and damage against that favored enemy type." (Rounded down — the
  // book doesn't say up.) The extra favored type is this ability's first pick, the bonus type its second
  // (`target:pick2:legendary_favored`), which must still be one you favor.
  legendary_favored: [
    { label: 'Favored Mastery', target: 'toHit', value: 'floor(@wiles/2)', predicate: [{ atom: 'target:favored' }, { atom: 'target:pick2:legendary_favored' }] },
    { label: 'Favored Mastery', target: 'damage', value: 'floor(@wiles/2)', predicate: [{ atom: 'target:favored' }, { atom: 'target:pick2:legendary_favored' }] },
  ],
  sol_tower_training: [{ label: 'Tower Training', target: 'defense.pd', value: '1', predicate: [{ atom: 'self:wielding:tower-shield' }] }],
  sol_legendary_shield: [
    { label: 'Legendary Shield', target: 'defense.pd', value: '1', predicate: [] },
    { label: 'Legendary Shield', target: 'defense.td', value: '1', predicate: [] },
    { label: 'Legendary Shield', target: 'defense.md', value: '1', predicate: [] },
    { label: 'Legendary Shield', target: 'damage', mode: 'step', scope: 'melee', value: '1', predicate: [{ atom: 'self:wielding:shield' }] },
  ],
  legendary_reactive: [{ label: 'Reactive Mastery', target: 'reactions', value: '1', predicate: [] }],
  // The Stompening — "Increase the damage dealt by Hoofstomp to XD6." (Charge the Line's Hoofstomp dice.)
  the_stompening: [{ label: 'The Stompening', target: 'damage', mode: 'step', scope: 'charge_the_line', value: '1', predicate: [] }],
  thug_toxic_masculinity: [{ label: 'Toxic Masculinity', target: 'damage', mode: 'step', scope: 'melee', value: '1', predicate: [] }],
};

/**
 * Placed zones (module/helpers/zones.mjs), keyed by catalogId → item `zone`. Resolved against the caster when the
 * ability is used, then created as a Scene Region with a `zone` behavior.
 *  - `shape`: 'circle' (size = radius, ft) or 'square' (size = side, ft); `size` a formula over the caster's numbers;
 *  - `anchor`: 'point' (click the map; Esc → the target or yourself) or 'caster'; `followCaster` recentres it on the
 *    caster at the start of their turn; `radiusPerMadness` resizes it when the caster's Madness changes (5ft each);
 *  - `effect`: the behavior's effect (see zones.mjs). Parts may carry `requires` (atoms over the caster's options at
 *    cast — an upgrade that must be owned) and dice as `damageTiers` [{level, formula}] (highest reached wins);
 *  - `difficult`: difficult terrain inside (true, or an atom list that must hold at cast);
 *  - `casterTurnDamage`: HP the caster loses at the start of each turn the zone stands (Stygian Abyss).
 * A zone made by a Focus lasts while the Focus is maintained; one from an action lasts until the caster's next turn.
 */
export const ZONE_OVERRIDES = {
  // Fatebound Crystaline Weapon: "all enemies within 5Xft of you … treat the area as Bright" — and "Targets in bright light
  // are Obscured" (p.255), so you and your allies inside are Obscured to them.
  crystaline_weapon: { shape: 'circle', size: '5*ceil(@proficiency/2)', anchor: 'caster', followCaster: true,
    effect: { affects: 'allies', includeCaster: true, insideStatus: 'obscured' } },
  // Oracle Draining Aura — "sphere with radius 5Mft … all enemies who start their turn inside this region or enter
  // the region on their turn make a Courage Check against one level of Fatigue. If your Madness changes, the radius
  // of the aura changes."
  draining_aura: { shape: 'circle', size: '5*@madness', anchor: 'point', radiusPerMadness: true,
    effect: { affects: 'enemies', check: { trait: 'courage', inflict: [{ condition: 'fatigue', level: 1 }] } } },

  // Oracle Stygian Abyss — "light does not penetrate into or out of this sphere" (everyone inside is Shadowed) and
  // "Take X damage each turn you maintain Focus (X = Proficiency, including the turn you initiate it)". Its upgrades:
  // Shrieking Abyss — enemies starting their turn inside: Fate Check or MD2 (MD4 @5, MD6 @11); Pooled Ink — difficult
  // terrain at 3+ Madness; Swirling Ink — leaving takes a Wiles Check at 3+ Madness (the stop is the GM's).
  stygian_abyss: { shape: 'circle', size: '5*@madness', anchor: 'point', radiusPerMadness: true, casterTurnDamage: '@proficiency',
    difficult: [{ atom: 'self:ability:pooled_ink' }, { atom: 'self:condition:madness>=3' }],
    effect: { affects: 'all', insideStatus: 'shadowed', onEnter: false,
      check: { requires: [{ atom: 'self:ability:shrieking_abyss' }], affects: 'enemies', trait: 'fate',
        damageTiers: [{ level: 1, formula: '(@madness)d2' }, { level: 5, formula: '(@madness)d4' }, { level: 11, formula: '(@madness)d6' }] },
      exitCheck: { requires: [{ atom: 'self:ability:swirling_ink' }, { atom: 'self:condition:madness>=3' }], trait: 'wiles' } } },

  // Oracle Voidsphere — "no spells may penetrate this sphere (from either direction)". Marked on the map; which spells
  // it stops (Piercing Gaze's MD attacks pass) is the GM's.
  voidsphere: { shape: 'circle', size: '5*@madness', anchor: 'point', radiusPerMadness: true, effect: { affects: 'all' } },

  // Sentinel Suppressing Fire — "an X by X square (X = ½ Proficiency tiles, rounded up) … Every creature within this
  // space gets 1X disadvantage on all attacks they make while inside the space, and the terrain is treated as
  // difficult terrain." A Focus action (owner ruling, TAG_OVERRIDES), so the square stands while the Focus does.
  suppressing_fire: { shape: 'square', size: '5*ceil(@proficiency/2)', anchor: 'point', difficult: true,
    effect: { affects: 'all', attackDisadvantage: true } },

  // Sentinel Focal Point — "a 10x10ft square … When a creature enters this square or starts their turn in it, they
  // take XD6 damage (X = ½ Proficiency, rounded up)."
  focal_point: { shape: 'square', size: '10', anchor: 'point',
    effect: { affects: 'all', damageTiers: [{ level: 1, formula: '(ceil(@proficiency/2))d6' }] } },

  // Fatebound God's Mist — "a divine mist … radius of 5X (X = ½ Proficiency, rounded up) centered on you. Inside of this
  // area it is Dim. The mists move to you at the start of your turn, and do not affect you or your allies." Dim makes
  // those inside Obscured; read as shrouding you and your allies (see BACKLOG rules questions).
  gods_mist: { shape: 'circle', size: '5*ceil(@proficiency/2)', anchor: 'caster', followCaster: true,
    effect: { affects: 'allies', includeCaster: true, insideStatus: 'obscured' } },

  // Hulinari Clouded Foe / Clouded Ally (v1.2) — the swarm spreads over X contiguous tiles (X = Proficiency, +1 Grey
  // Cloud, +2 Stormcloud, +X Cloudsurge), including your own, carried with you as you move. Enemies inside Clouded
  // Foe are Surrounded; allies inside Clouded Ally have Partial Cover (both read from the cloud by the attack code).
  // Focus layers ride the cloud while their own Focus is maintained:
  //  - Sharp Cloud: enemies starting their turn in it or moving into it make a Power Check or take (Finesse)D10;
  //  - Dark Cloud: creatures inside treat the area as Dim (Obscured); with Dark Steps it's difficult terrain;
  //  - Blackcloud, Birdshield, Guiding Wingbeats, Swarm Effects: read directly by checks, DR and attacks.
  clouded_foe: { shape: 'tiles', size: '@proficiency + @owns.grey_cloud + 2*@owns.stormcloud', anchor: 'caster', carry: true, cloud: 'foe',
    effect: { affects: 'enemies', layers: [
      { whileFocus: 'sharp_cloud', check: { trait: 'power', damage: '(@finesse)d10', affects: 'enemies' } },
      { whileFocus: 'dark_cloud', insideStatus: 'obscured', statusAffects: 'all' },
      { key: 'dark_steps', whileFocus: 'dark_cloud', ownsAll: ['dark_steps'], difficult: true },
    ] } },
  clouded_ally: { shape: 'tiles', size: '@proficiency + @owns.grey_cloud + 2*@owns.stormcloud', anchor: 'caster', carry: true, cloud: 'ally',
    effect: { affects: 'allies' } },
};

/**
 * Ability tags the catalog has wrong (catalogId → tag). Suppressing Fire is printed as an Action, but the owner ruled it a
 * Focus action that lasts until the Focus is lost (2026-10-02).
 */
export const TAG_OVERRIDES = {
  suppressing_fire: 'focus',
};

/**
 * Ability text revised in ruleset v1.2 (catalogId → the v1.2 description), for abilities whose source catalog
 * still carries the v1.0 wording. Applied by the build in place of the catalog text.
 */
export const TEXT_OVERRIDES = {
  bd_named_weapons: 'You may take each Named Weapon ability below once, and may only have a number of Named Weapon abilities up to your Proficiency at any given time. Each ability must correspond to a single unique weapon, and each weapon can only have one name. Whenever you take a Named Weapons ability, name one Versatile weapon you own. If it breaks for any reason, you may rename an unnamed versatile weapon during a Nightly or Long Rest to regain the ability.',
  bd_axehappy: 'If all of your combat-readied items are versatile weapons, equipped armor, equipped clothes, or a dagger belt, increase the number of readied item slots (RIS) you have by 3.',
  // The designer's corrections to v1.2 (2026-10-03).
  surrounded_brute: 'Having the Surrounded Condition does not affect you: creatures gain no advantage on melee attacks against you for it.',
  bd_tripped_up: 'As an action while you are wielding your named weapon with the Weapon Tail property, attempt to give one target within your versatile weapon\'s range levels of Pulled equal to half your Proficiency, rounded up. The target makes Finesse Checks against this effect. You cannot use your Weapon Tail weapon for as long as this enemy has any levels of Pulled.',
};

/* ------------------------------------------------------------------------------------------------------------ */
/*  Prestige professions (Magus / Witch) — authored in src/prestige-overrides.mjs, merged into the maps above.     */
/* ------------------------------------------------------------------------------------------------------------ */

/** Extra AP on a consistent action (Clotsnipe, Bloomgift, Into Fire) → item `extraAp`. */
export const EXTRAAP_OVERRIDES = { ...PRESTIGE.extraAp };
/** Lore Madness annotations (merged into the build's MADNESS map for the Lore pack). */
export const LORE_MADNESS = { ...LORE.madness };
/** Pool costs the prose detector can't read (prestige abilities) → item `costs.pool`. */
export const POOL_OVERRIDES = { ...PRESTIGE.pool,
  // Call of the Enemy: X up to half your Proficiency; with Call of the Drain, up to your Proficiency.
  call_of_the_enemy: { key: 'call', amount: 0, variable: true, max: 'ceil(@proficiency/2) + @owns.call_of_the_drain*(@proficiency - ceil(@proficiency/2))' },
};
/** A number chosen at use (`@spent`) → item `amountPrompt`. */
export const AMOUNTPROMPT_OVERRIDES = { ...PRESTIGE.amountPrompt, ...LORE.amountPrompt,
  call_of_fury: { label: 'AP to give', max: 'ceil(@apMax/2)' },
  spring_weapon: { label: 'Unused reactions to exhaust', max: '@reactions' },
};

Object.assign(ACTIVITY_OVERRIDES, PRESTIGE.activity);
Object.assign(GRANT_OVERRIDES, PRESTIGE.grant);
Object.assign(ONUSE_OVERRIDES, PRESTIGE.onUse);
Object.assign(TEMPHP_OVERRIDES, PRESTIGE.tempHp);
Object.assign(BOOST_OVERRIDES, PRESTIGE.boost);
Object.assign(CHOICE_OVERRIDES, PRESTIGE.choice);
Object.assign(PICK_OVERRIDES, PRESTIGE.pick);
Object.assign(FOCUS_OVERRIDES, PRESTIGE.focus);
Object.assign(USAGE_OVERRIDES, PRESTIGE.usage);
Object.assign(MULTIATTACK_OVERRIDES, PRESTIGE.multiAttack);
Object.assign(SELFSCALING_OVERRIDES, PRESTIGE.selfScaling);
Object.assign(ZONE_OVERRIDES, PRESTIGE.zone);
for (const [id, mods] of Object.entries(PRESTIGE.modifier)) MODIFIER_OVERRIDES[id] = [...(MODIFIER_OVERRIDES[id] ?? []), ...mods];

// Lore abilities (src/lore-overrides.mjs).
Object.assign(ACTIVITY_OVERRIDES, LORE.activity);
Object.assign(ONUSE_OVERRIDES, LORE.onUse);
Object.assign(GRANT_OVERRIDES, LORE.grant);
Object.assign(TEMPHP_OVERRIDES, LORE.tempHp);
Object.assign(BOOST_OVERRIDES, LORE.boost);
Object.assign(ZONE_OVERRIDES, LORE.zone);
Object.assign(CHOICE_OVERRIDES, LORE.choice);
Object.assign(USAGE_OVERRIDES, LORE.usage);
Object.assign(PICK_OVERRIDES, LORE.pick);
Object.assign(MULTIATTACK_OVERRIDES, LORE.multiAttack);
