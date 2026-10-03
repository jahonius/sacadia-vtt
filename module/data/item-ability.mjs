import SacadiaItemBase from "./base-item.mjs";

/**
 * The `ability` Item — the centerpiece of the system. Covers every catalog entry: Actions/Focus/
 * Ceremonies (cost AP + limbs, may attack), Passives, Reactions & Boosts, and Lore.
 *
 * Uses an **Activities** model: an ability holds zero or more activities, each independently an
 * attack (rolls to-hit), a save (prompts a target check vs the user's Check DC), a bare damage
 * source, or utility. Damage is **structured** — `(count)d(denomination)` where `count` is a
 * formula (so stat-scaled dice like "Madness-many d4" are `count: "@madness"`) — with a freeform
 * override; this keeps die-step buffs (Phase 5) to a denomination bump rather than string-parsing.
 * Cross-ability modifiers become Active Effects (Phase 5), not schema.
 */
export default class SacadiaAbility extends SacadiaItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const stat = () => new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.stats) });
    const schema = super.defineSchema(); // description

    schema.tag = new fields.StringField({
      required: true, blank: false, initial: 'action',
      choices: Object.keys(CONFIG.SACADIA.abilityTags),
    });

    // Consolidated costs. `ap` is the base Action-Point cost (most Actions/Focus cost 1, p.237),
    // spent when an Active ability is used in combat; limbs are the granular action cost that
    // drives exhaustion (and the +1-AP penalty for reusing an exhausted limb).
    schema.costs = new fields.SchemaField({
      ap: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      csp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      madness: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Lore points spent on use (Lore abilities, book p.168: "only the Lore Point" — no AP, Boost, Reaction or Focus).
      lore: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Signature-pool cost (e.g. 1 Arrangement point). `key` is a `CONFIG.SACADIA.pools` id. When
      // `variable` (e.g. "expend X" / "any number of" / "up to your Proficiency"), the player is
      // prompted for the amount on use; `max` is an optional `@ref` formula bounding that prompt
      // (blank = bounded only by the current pool value). `amount` is the fixed cost otherwise.
      pool: new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.pools) }),
        amount: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        variable: new fields.BooleanField({ initial: false }),
        max: new fields.StringField({ required: true, blank: true }),
      }),
      limbs: new fields.ArrayField(
        new fields.StringField({ required: true, blank: false, choices: Object.keys(CONFIG.SACADIA.limbs) })
      ),
    });

    // Range. `value` is a distance in feet (null for non-numeric ranges); `type` classifies it
    // (self/touch/melee/ranged/area). Shown on the card; a numeric range warns (but allows) when the
    // targeted token is beyond it. Most catalog ranges are auto-detected from "within N ft" prose.
    schema.range = new fields.SchemaField({
      value: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
      type: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.rangeTypes) }),
    });

    // Catalog metadata. `prerequisite` is display-only for now (structured validation is a later,
    // now-feasible upgrade — see PLANNING).
    schema.meta = new fields.SchemaField({
      profession: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.professions) }),
      subpath: new fields.StringField({ required: true, blank: true }),
      prerequisite: new fields.StringField({ required: true, blank: true }),
    });

    // Activities. One SchemaField shape carries every activity type's fields; `type` selects which
    // are meaningful (Foundry has no clean discriminated-union field, so unused blocks stay default).
    schema.activities = new fields.ArrayField(new fields.SchemaField({
      type: new fields.StringField({
        required: true, blank: false, initial: 'attack', choices: Object.keys(CONFIG.SACADIA.activityTypes),
      }),
      label: new fields.StringField({ required: true, blank: true }),
      // type: attack — `defense` is which defense the to-hit is compared against (AD/PD/TD/MD).
      // It drives the card display now and the hit/miss resolution in the Phase 10 combat model.
      attack: new fields.SchemaField({
        category: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.attackCategories) }),
        trait: stat(),
        defense: new fields.StringField({ required: true, blank: true, choices: Object.keys(CONFIG.SACADIA.defenseStat) }),
      }),
      // type: save — target rolls d20 + `trait` vs `dc` (null dc → the user's Check DC at use time).
      save: new fields.SchemaField({
        trait: stat(),
        dc: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
        // What a *successful* save does to the activity's damage: `none` (the check negates it — the book's
        // default "X Check negates") or `half` ("taking half damage on success"). A failed check takes it all.
        onSuccess: new fields.StringField({ required: true, blank: false, initial: 'none', choices: ['none', 'half'] }),
        // Life drain: the caster gains temp HP equal to this fraction of the save damage dealt (Vampiric Weapon: ½).
        drain: new fields.NumberField({ required: false, nullable: true, initial: null, min: 0 }),
        // Prestige save extensions (checks, reduce mode, caster gains, per-failure deltas, save-gated grants …),
        // resolved at cast by the sheet and carried on the card — see onSaveRoll's `ext` note. Build-authored.
        ext: new fields.ObjectField({ required: true, initial: {} }),
      }),
      // Damage parts (attack/save/damage activities). `(count)d(denomination)` unless `formula` set.
      damage: new fields.ArrayField(new fields.SchemaField({
        count: new fields.StringField({ required: true, blank: true, initial: '1' }),
        denomination: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        formula: new fields.StringField({ required: true, blank: true }),
        trait: stat(),
        type: new fields.StringField({ required: true, blank: true }),
      })),
      // Leveled conditions this activity inflicts on a hit. `amount` is a formula (e.g. "@proficiency"
      // or "ceil(@proficiency/2)"), evaluated at use; the GM applies it from the resolution whisper.
      inflict: new fields.ArrayField(new fields.SchemaField({
        // Both leveled conditions (Hemorrhage, Fumble, …) and simple statuses (Prone, Surprised) are
        // valid inflicts — the save-resolution applies the former as levels, the latter as a token status.
        // `@choice`: the condition the user picks at use (Beastly Presence: Panic or Taunt).
        condition: new fields.StringField({ required: true, blank: true,
          choices: [...Object.keys(CONFIG.SACADIA.conditions), ...Object.keys(CONFIG.SACADIA.simpleConditions), '@choice'] }),
        amount: new fields.StringField({ required: true, blank: true, initial: '1' }),
        // Once per rest (Jagged Blade's extra Hemorrhage): the rest flag this part sets when it fires; skipped
        // while set (cleared on a rest).
        restFlag: new fields.StringField({ required: true, blank: true }),
        // Save-to-negate (Slinger: "Finesse check negates"): when set to a stat key, the on-hit inflict
        // isn't applied outright — the target rolls a <trait> Check vs the attacker's Check DC to negate it.
        // resolveAttack surfaces a "Roll Save to Negate" button (reusing onSaveRoll) instead of a direct apply.
        saveNegate: stat(),
        // Explicitly cumulative: this attempt ignores the no-re-application rule (book p.258) — e.g. Sphere
        // Insanium "even if they already have Delirium", Aggressive Pin "increase the enemy's level of Pin".
        stacks: new fields.BooleanField({ initial: false }),
        // Optional predicate over the caster's roll options (same `{atom}` shape as modifier predicates):
        // the entry contributes only when it holds. Enables inflict-amount *upgrades* as supersede pairs —
        // e.g. Taunting Call inflicts ½Prof Taunt gated `!self:ability:extra_taunt` and full Prof gated
        // `self:ability:extra_taunt`, so exactly one fires. Empty = unconditional (the common case).
        predicate: new fields.ArrayField(new fields.SchemaField({
          atom: new fields.StringField({ required: true, blank: true }),
        })),
      })),
      // Attack that inflicts a condition *instead of* damage (Destrap: "rend the target's armor …
      // instead of dealing damage"). Suppresses both the ability's own damage parts and the bound
      // weapon's base-dice injection, so only the inflict lands on a hit.
      noDamage: new fields.BooleanField({ initial: false }),
      // Roll only the bound weapon's base dice — no trait, flat bonuses, bonus dice, or die-steps (Base
      // Clobber: "deal your base weapon damage … Do not add any modifiers").
      baseDamageOnly: new fields.BooleanField({ initial: false }),
      // Hits without a to-hit roll (Magic Missive's missiles, Barbed Stare's stare): the damage just lands.
      autoHit: new fields.BooleanField({ initial: false }),
      // Add the bound weapon's base dice to this activity's damage when the named ability is owned — Stab
      // Back: "When you use Pushback and the target fails their Power Check, deal spear damage".
      weaponDamageWith: new fields.StringField({ required: true, blank: true }),
      // HP the attacker loses when this attack hits (Pained Bash: "If you hit, lose X HP"), a formula.
      selfCostOnHit: new fields.StringField({ required: true, blank: true }),
      // Run this activity only when these atoms hold for the user (Foe Transference: a save only against an enemy).
      predicate: new fields.ArrayField(new fields.SchemaField({ atom: new fields.StringField({ required: true, blank: true }) })),
    }));

    // Per-use choice (e.g. "gain temp PD, MD, or TD — choose one"). When `options` is non-empty,
    // activating the ability prompts the player to pick one; the pick becomes a
    // `self:choice:<catalogId>:<value>` roll option for this turn, so authored modifiers can gate on
    // it (see docs/conditional-modifiers.md). Cleared when the action log clears (turn start).
    schema.choice = new fields.SchemaField({
      prompt: new fields.StringField({ required: true, blank: true }),
      // Prompt only when the actor owns this ability (Headbutt's charge option exists for Skullcharge).
      requires: new fields.StringField({ required: true, blank: true }),
      options: new fields.ArrayField(new fields.SchemaField({
        value: new fields.StringField({ required: true, blank: false }),
        label: new fields.StringField({ required: true, blank: true }),
      })),
    });

    // Target mark (Layer B, see docs/conditional-modifiers.md). When `key` is set, activating this
    // ability records the current target(s) under `actor.system.marks[key]`, so later abilities can
    // gate a modifier on `target:mark:<key>`. `exclusive` (default) makes each use replace the prior
    // marked set (the "moving mark"); clear it to accumulate marks across uses instead.
    schema.mark = new fields.SchemaField({
      key: new fields.StringField({ required: true, blank: true }),
      exclusive: new fields.BooleanField({ initial: true }),
    });

    // Focus-maintenance behavior (distinct from the `tag: 'focus'`). `breaksOnMove` = this ability's
    // Focus ends the moment you move ("if you leave the square", Stood Ground), so movement drops its
    // maintenance streak (`combatState.focusRounds`) and any per-round ramp gated on it.
    schema.focus = new fields.SchemaField({
      breaksOnMove: new fields.BooleanField({ initial: false }),
      // "Every turn you maintain Focus, you can only renew Focus when you are within 5ft of that ally" (the Witch's
      // ally Focuses): renewing warns (but allows) while a creature this Focus's grant sits on is farther away.
      renewWithin: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
      // "You may only end Focus on X on your turn" (Law of Alliance, Pact of the Earth …): shown as a reminder.
      endOnOwnTurn: new fields.BooleanField({ initial: false }),
    });

    // Ally grant (see docs/conditional-modifiers.md — "granted effects"). A buff this ability applies
    // to *other* tokens (the caster's own effects use `modifiers`). Each `change` is an Active-Effect
    // change placed on the target: `key` is a sink (e.g. `system.bonuses.defense.md`), `mode` an AE
    // mode (2 = ADD), `value` a formula resolved against the *caster's* numbers at cast time (the buff
    // scales off the caster, then is a fixed number on the ally). `duration.type: 'focus'` ties the
    // grant to a caster-side anchor effect: it lives only while the caster maintains Focus, and the
    // reap sweep deletes it the moment that anchor is gone (no orphans).
    schema.grant = new fields.SchemaField({
      // `self` targets the caster (Partial Drivel — a self-buff whose magnitude is a variable Madness
      // spend); `ally`/`allies` target other tokens. A self grant needs no external target token.
      scope: new fields.StringField({ required: true, blank: true, choices: ['', 'self', 'ally', 'allies'] }),
      label: new fields.StringField({ required: true, blank: true }),
      duration: new fields.SchemaField({
        type: new fields.StringField({ required: true, blank: true, choices: ['', 'focus', 'rounds', 'consumed'] }),
        rounds: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
        // A rounds count that scales (Bloodrage: "up to X rounds, X is your Proficiency"), resolved at cast.
        roundsFormula: new fields.StringField({ required: true, blank: true }),
        on: new fields.StringField({ required: true, blank: true }),
      }),
      changes: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true }),
        mode: new fields.NumberField({ required: true, integer: true, initial: 2 }),
        value: new fields.StringField({ required: true, blank: true, initial: '0' }),
        // Optional caster-side predicate: this change folds into the grant only when the caster's own
        // roll options satisfy it (e.g. Standing Strike upgrading Stand By Me, or an "If you have
        // Steadied" clause). Same `{atom}` wrapping as modifier predicates.
        predicate: new fields.ArrayField(new fields.SchemaField({
          atom: new fields.StringField({ required: true, blank: true }),
        })),
      })),
      // Per-target change sets (Law of Exchange: the first target's attackers gain Advantage, the second's
      // Disadvantage): entry i applies to the i-th target instead of `changes`. Same change shape.
      perTarget: new fields.ArrayField(new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, blank: true }),
        mode: new fields.NumberField({ required: true, integer: true, initial: 2 }),
        value: new fields.StringField({ required: true, blank: true, initial: '0' }),
      }))),
      // A marker grant carries no number changes — it just records the effect on the target (Catnap's sleep, Death
      // Ward, Lawful Sanctuary), read by name/ability where it matters, and reaped like any other grant.
      marker: new fields.BooleanField({ initial: false }),
      // Token statuses the grant carries while it lasts (Catnap: Unconscious).
      statuses: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      // What the Focus's end does to each recipient (Poured Mold `clear`, Winter Frost `unEndure`, Armor of Itthoa
      // `clearTemp`); `<choice>` / `<picks>` resolve at cast. See onAnchorEnded.
      onEnd: new fields.SchemaField({
        clear: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
        unEndure: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
        clearTemp: new fields.BooleanField({ initial: false }),
        casterFatigue: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      }),
      // A self grant that may go to a targeted ally instead when you own this ability (Absolute Drivel redirects Partial
      // Drivel's DR).
      allyWith: new fields.StringField({ required: true, blank: true }),
      // Optional variable-resource spend that scales the grant (e.g. Blessing of Hot Coal — "reduce
      // your Madness by up to M; add 1 die type per level expended"). When `resource` is set, using
      // the ability prompts for an amount (capped by `max`, a formula over the caster's numbers),
      // deducts it from the caster's matching leveled condition, and exposes the chosen amount to the
      // grant's change formulas as `@spent`.
      spend: new fields.SchemaField({
        resource: new fields.StringField({ required: true, blank: true }),
        max: new fields.StringField({ required: true, blank: true }),
      }),
    });

    // Usage limits (the book's "once per turn / quick rest / combat" clauses) and preconditions ("when you
    // are raging", Spreadstep's "at least 4 separate targets"). Warn-but-allow when unmet or exceeded, the
    // same posture as AP overspend — the GM can rule an exception. `requires` is predicate atoms over the
    // actor's roll options (incl. `self:combat:*` counters), `requiresLabel` the reason shown.
    schema.usage = new fields.SchemaField({
      per: new fields.StringField({ required: true, blank: true, choices: ['', 'turn', 'rest', 'combat'] }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      // The limit counts per target (Beastly Presence: "once per quick rest on a single target"): each targeted creature
      // may be chosen `max` times per period, and a different creature is a fresh count.
      perTarget: new fields.BooleanField({ initial: false }),
      requires: new fields.ArrayField(new fields.SchemaField({ atom: new fields.StringField({ required: true, blank: true }) })),
      requiresLabel: new fields.StringField({ required: true, blank: true }),
      // Owned passives that change this limit (Nip and Tuck → Artery Strike twice per turn; Spreaderstep → a
      // 3-target threshold). The first owned upgrade wins.
      upgrades: new fields.ArrayField(new fields.SchemaField({
        ability: new fields.StringField({ required: true, blank: true }),
        max: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
        maxFormula: new fields.StringField({ required: true, blank: true }),
        requires: new fields.ArrayField(new fields.SchemaField({ atom: new fields.StringField({ required: true, blank: true }) })),
        requiresLabel: new fields.StringField({ required: true, blank: true }),
      })),
    });

    // A one-shot buff banked onto the actor's *next* attack this turn (base-actor `pendingAttack`, folded and consumed by
    // the next attack activity). `on: 'use'` banks it when this ability is used (Astonishing Shout's per-adjacent-enemy
    // damage); `on: 'hit'` banks it GM-side when this ability's attack lands (Reaching Claw: "treat them as prone for your
    // next attack"). The formulas resolve against the user's numbers at use; `targetCondition` treats the next target as
    // having that condition.
    schema.nextAttack = new fields.SchemaField({
      on: new fields.StringField({ required: true, blank: true, choices: ['use', 'hit'] }),
      advantage: new fields.StringField({ required: true, blank: true }),
      toHit: new fields.StringField({ required: true, blank: true }),
      damage: new fields.StringField({ required: true, blank: true }),
      targetCondition: new fields.StringField({ required: true, blank: true }),
      label: new fields.StringField({ required: true, blank: true }),
    });

    // Aid-resist: make Trait Checks *for* targeted allies against one of their conditions (Make Trait Check
    // on their behalf; each success removes a level). `levels` = checks per ally (a formula; `@spent` when
    // Madness is spent), `maxTargets` a formula; `autoWith` / `autoIfSteadied` make it automatic (remove one
    // level, no roll); `advantageWith` adds 1× advantage when that ability is owned; `mentalOnly` narrows the
    // conditions offered. Call of Respite, Vision of Moss, Blessing of the Burning Incense.
    schema.aidResist = new fields.SchemaField({
      levels: new fields.StringField({ required: true, blank: true }),
      maxTargets: new fields.StringField({ required: true, blank: true }),
      autoWith: new fields.StringField({ required: true, blank: true }),
      autoIfSteadied: new fields.BooleanField({ initial: false }),
      advantageWith: new fields.StringField({ required: true, blank: true }),
      spendMadness: new fields.BooleanField({ initial: false }),
      mentalOnly: new fields.BooleanField({ initial: false }),
      // Funnel Energy: two targets; checks against the fatigued one's Fatigue at their own Check DC, and each success
      // gives the other 1 AP on their next turn.
      funnel: new fields.BooleanField({ initial: false }),
    });

    // Permanent pick — a choice made once when the ability is taken ("choose one weapon type you use",
    // "choose one condition", "choose one Action Pool", "choose one limb"). `kind` picks the list; `options`
    // (optional) narrows it. The chosen value lives on the owned item (`flags.sacadia.pickValue`, set from
    // the ability card's select) and surfaces as `self:pick:<catalogId>:<value>`, plus the contextual
    // `self:attack:picked:<id>` (the bound weapon is the picked type) and `self:checking|saving|resisting:
    // picked:<id>` (the checked condition is the picked one).
    schema.pick = new fields.SchemaField({
      // `creature`: one specific creature (The Vengeance's chosen enemy) — the actor id, picked from the scene.
      // `defense`: one of PD / MD / TD (Contract Tome's Lawful Protection).
      // `element`: a Font element (Elemental Weapon, Corrupting Touch, Corrupted Iron).
      kind: new fields.StringField({ required: true, blank: true, choices: ['', 'weaponType', 'condition', 'pool', 'limb', 'creature', 'defense', 'element'] }),
      options: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
    });

    // grant-choice-redirect (Shared Blessing): when `requiresAbility` is owned and an ally is targeted,
    // this ability's per-use choice buff may be applied to that ally *instead of* the caster. `key` is an
    // AE change-key template with a `<choice>` placeholder filled by the per-use pick (e.g.
    // `system.bonuses.defense.<choice>`); `value` is the magnitude formula (caster numbers, snapshot at
    // cast); the resulting grant is focus-anchored to this ability. Redirecting suppresses the caster's own
    // buff by not logging the choice (its self modifiers gate on `self:choice:…`). See #useAbility.
    schema.choiceRedirect = new fields.SchemaField({
      requiresAbility: new fields.StringField({ required: true, blank: true }),
      key: new fields.StringField({ required: true, blank: true }),
      value: new fields.StringField({ required: true, blank: true }),
      label: new fields.StringField({ required: true, blank: true }),
    });

    // Temporary-HP grant (book p.223). Activating the ability rolls `formula` once and grants that many
    // Temp HP — to the caster (`self`), the targeted allies (`allies`), or both. Temp HP absorbs before
    // real HP, doesn't stack (a new grant takes the higher), and clears at combat end. `scaleLevels` are
    // die-step thresholds (Critical Recovery: 1d6→1d8@5→1d10@11); Lifeguard adds one more step.
    schema.tempHp = new fields.SchemaField({
      formula: new fields.StringField({ required: true, blank: true }),
      target: new fields.StringField({ required: true, blank: true, choices: ['', 'self', 'allies', 'both'] }),
      scaleLevels: new fields.ArrayField(new fields.NumberField({ integer: true, nullable: false })),
      // Paid in Madness chosen at use (Blessing of the Hallowed Vale: "remove any amount of Madness and give
      // 1D4 temporary HP … for each level removed") — `@spent` in the formula is the amount removed.
      spendMadness: new fields.BooleanField({ initial: false }),
      // The rolled amount is the HP the user pays, and the grant is `multiplier` × it (Life Transference: "Lose that
      // HP. Give your ally Temp HP equal to twice the HP you lost").
      selfCost: new fields.BooleanField({ initial: false }),
      multiplier: new fields.NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      // A die-step when the user owns this ability (Greater Transference: XD6 → XD8).
      stepWith: new fields.StringField({ required: true, blank: true }),
      // Only when initiating its Focus, not on each renewal (Armor of Itthoa); only while owning this (Greater Heroism).
      initiateOnly: new fields.BooleanField({ initial: false }),
      requires: new fields.StringField({ required: true, blank: true }),
    });

    // Reaction grant — an ability that hands the actor extra reaction(s) on use (Reactionary: +1 this
    // round). Applied in #useAbility; the reaction economy (base-actor `schema.reaction`) tracks the total.
    schema.grantsReaction = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Reaction trigger classification — what event opens this reaction's window, so the auto-prompt
    // system knows when to surface it. `move` reactions ("as a reaction to a creature moving…") are
    // prompted by the movement hook; the (default) blank covers attack-window reactions surfaced by the
    // attack-resolution prompt. Detected at build from the description.
    schema.reactionTrigger = new fields.StringField({ required: true, blank: true, choices: ['', 'move'] });

    // On-use inflicts — leveled conditions applied directly on use, with no attack/save roll (the shape
    // several no-roll reactions need: Predator and Prey gives the attacker + itself Sting; That Sluggish
    // Feeling slows the mover). `self` conditions apply to the actor; `target` conditions apply to the
    // currently-targeted token(s), GM-side (they're automatic — no save). Amounts are `@ref` formulas.
    // `amount` may resolve negative (remove levels) and `condition` may be a group wildcard
    // (`*adversarial` / `*mental` / `*physical`) — see helpers/conditions.mjs. `stacks` exempts the
    // attempt from the no-re-application rule (book p.258).
    // `condition` may be `@choice` (the per-use choice picked when the ability was used — Standards Elite's
    // Panic/Fatigue). An optional `predicate` (caster options, incl. `self:choice:<id>:<value>`) gates the entry.
    const inflictEntry = () => new fields.SchemaField({
      condition: new fields.StringField({ required: true, blank: false }),
      amount: new fields.StringField({ required: true, blank: true, initial: '1' }),
      stacks: new fields.BooleanField({ initial: false }),
      predicate: new fields.ArrayField(new fields.SchemaField({ atom: new fields.StringField({ required: true, blank: true }) })),
    });
    schema.onUse = new fields.SchemaField({
      self: new fields.ArrayField(inflictEntry()),
      target: new fields.ArrayField(inflictEntry()),
      // Exhaust one limb of each target (a limb kind, or `@choice` — Bloodsapper's arm or leg).
      exhaust: new fields.StringField({ required: true, blank: true }),
      // Hold these conditions' end-of-turn decay on each target through its next turn end (Cornered Animal).
      holdDecay: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      // Give each target Cover until the start of your next turn (Protective Instinct, Covering Dance).
      cover: new fields.StringField({ required: true, blank: true, choices: ['', 'half', 'full'] }),
      // Make this condition Enduring on each target (Balanced Scale) — a condition key or `@choice`.
      enduring: new fields.StringField({ required: true, blank: true }),
      // HP the user loses on use (Bloodlet: "lose HP equal to your Fate") — self-inflicted, so Mistletoe /
      // Blood Mastery resist it.
      selfDamage: new fields.StringField({ required: true, blank: true }),
      // ---- Prestige (Magus / Witch) ----
      // Trigger each target's Hemorrhage now (Vampiric Siphon, Touch the Flame): `triggers` is a formula (Into Fire:
      // one more per extra AP); `drain` the fraction of the damage the caster gains as temp HP.
      burst: new fields.SchemaField({
        triggers: new fields.StringField({ required: true, blank: true }),
        drain: new fields.NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      }),
      // Reactions each target gains (Bloomgift: one per extra AP), a formula.
      reactions: new fields.StringField({ required: true, blank: true }),
      // Each target's temp HP becomes real HP (Healthy Hands).
      convertTemp: new fields.BooleanField({ initial: false }),
      // Mark a held condition's instance with a variant (Delirious Vulnerabilities: `{toDr: true}` on Delirium).
      sourcePatch: new fields.SchemaField({
        condition: new fields.StringField({ required: true, blank: true }),
        patch: new fields.ObjectField({ required: true, initial: {} }),
      }),
      // A one-shot flag set on each target (Spare the Meek: `spareTheMeek`).
      setFlag: new fields.StringField({ required: true, blank: true }),
      // Gains for the user, as formulas: HP healed (Still Up), AP (Royal Recovery), Lore points (Cursed Contract).
      // A formula may be negative for a cost (Call of Fury spends AP now; Spring Weapon spends reactions).
      selfGain: new fields.SchemaField({
        hp: new fields.StringField({ required: true, blank: true }),
        ap: new fields.StringField({ required: true, blank: true }),
        lore: new fields.StringField({ required: true, blank: true }),
        reactions: new fields.StringField({ required: true, blank: true }),
      }),
      // AP each target gains now, up to its unwounded max (Spring Weapon), or on its next turn (Call of Fury).
      apGain: new fields.StringField({ required: true, blank: true }),
      apNext: new fields.StringField({ required: true, blank: true }),
      // Reveal hidden creatures within this many feet (Open the Third Eye: 5 × Madness).
      revealWithin: new fields.StringField({ required: true, blank: true }),
      // Each target (and you, with `refundSelf`) recovers this many points of a pool they choose (Reverse Catnap, Call
      // to Recovery).
      poolRefund: new fields.StringField({ required: true, blank: true }),
      refundSelf: new fields.BooleanField({ initial: false }),
      // Exhaust a random limb of each target for the rest of combat (Prone Gutting).
      exhaustRandomCombat: new fields.BooleanField({ initial: false }),
      // Convert levels of one held condition into another (Nettle: up to 2 per point spent → Sting, Jinxed, Delirium or
      // Nausea): prompts for the from / to conditions; `amount` is a formula, `to` the allowed results.
      convert: new fields.SchemaField({
        amount: new fields.StringField({ required: true, blank: true }),
        to: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      }),
    });

    // A number chosen at use (Life Transference's dice, Give of Thyself's checks, Transmute Trauma's levels): prompted
    // up to `max` (a formula) and exposed to this use's formulas as `@spent`.
    schema.amountPrompt = new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      max: new fields.StringField({ required: true, blank: true }),
    });

    // Kill trigger — fires when the actor reduces a target to 0 HP (the GM applies the killing damage, or
    // it auto-applies). `condition` banks a next-target pending buff (Killing Frenzy → Surprised); `tempHp`
    // grants temp HP from the highest applicable level tier (Indomitable Beast → 1d10 / 2d6@5 / 2d8@11).
    // See the kill seam in sacadia.mjs (fired from resolveAttack auto-apply + onApplyHp/onMarkDead).
    schema.killTrigger = new fields.SchemaField({
      condition: new fields.StringField({ required: true, blank: true }),
      tempHp: new fields.ArrayField(new fields.SchemaField({
        minLevel: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        formula: new fields.StringField({ required: true, blank: false }),
      })),
    });

    // Multi-attack — an action that makes several separate attacks with one AP (Wild Strike, Dagger
    // Threat). The single attack activity is rolled `count` times, each its own to-hit + damage. `targeting`
    // = 'split' (each vs a different target, in target order) or 'same' (all vs the first target). An
    // `upgrade` passive (Third Arm) raises the count when the actor owns it. Resolved in #useAbility.
    // `targeting`: 'split' (each attack vs a different target, fixed `count`), 'same' (all vs the first),
    // or 'each' (one attack per *targeted token* — a dynamic count; used for Forbidden Web-style "roll
    // against each enemy in one action"). `requiresAbility` gates the 'each' expansion on owning an enabler
    // (Forbidden Knowledge only multi-targets when you own Forbidden Web). `upgrade` bumps a fixed count.
    schema.multiAttack = new fields.SchemaField({
      count: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // A count that scales (Magic Missive: "up to X targets, X = ½ Proficiency"), resolved at use; overrides `count`.
      countFormula: new fields.StringField({ required: true, blank: true }),
      targeting: new fields.StringField({ required: true, blank: true, choices: ['', 'split', 'same', 'each'] }),
      // The most creatures it may target (a formula; Webcraft: "up to your Proficiency", one per Madness spent). Using it on
      // more warns but allows.
      maxTargets: new fields.StringField({ required: true, blank: true }),
      requiresAbility: new fields.StringField({ required: true, blank: true }),
      upgrade: new fields.SchemaField({
        ability: new fields.StringField({ required: true, blank: true }),
        count: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      }),
    });

    // Boost (see docs/conditional-modifiers.md — "boosts"). An ability tagged `boost` that, while
    // *armed*, folds its effects into the next matching action the actor takes, then is consumed.
    // `appliesTo` matches the consumed action; `effects` are modifier-shaped (target/mode/scope/value/
    // predicate) and injected into that action's roll; `once` limits it to one consume per turn. Cost
    // (if any) rides the ability's normal `costs` and is charged at consume. Book rule: at most one
    // Boost per action — the sheet deconflicts when several armed boosts match.
    schema.boost = new fields.SchemaField({
      appliesTo: new fields.SchemaField({
        // 'pool': any action that spends from `pool` (Blood for Bane: "an action that would use a Spell Slot").
        kind: new fields.StringField({ required: true, blank: true, choices: ['', 'attack', 'save', 'ability', 'any', 'pool'] }),
        category: new fields.StringField({ required: true, blank: true, choices: ['', 'melee', 'ranged', 'magic'] }),
        ability: new fields.StringField({ required: true, blank: true }), // target ability catalogId(s), '|'-separated (kind 'ability')
        pool: new fields.StringField({ required: true, blank: true }), // pool key (kind 'pool')
      }),
      once: new fields.BooleanField({ initial: false }),
      effects: new fields.ArrayField(new fields.SchemaField({
        target: new fields.StringField({ required: true, blank: true }),
        mode: new fields.StringField({ required: true, blank: true, initial: 'add' }),
        scope: new fields.StringField({ required: true, blank: true, initial: 'all' }),
        value: new fields.StringField({ required: true, blank: true, initial: '0' }),
        label: new fields.StringField({ required: true, blank: true }),
        predicate: new fields.ArrayField(new fields.SchemaField({
          atom: new fields.StringField({ required: true, blank: true }),
        })),
      })),
      // Conditions the boosted attack inflicts on a hit (Thrustforth's Rend). Merged into the action's
      // GM-side hit resolution alongside the attack's own inflicts. Amount is a roll formula.
      inflict: new fields.ArrayField(new fields.SchemaField({
        condition: new fields.StringField({ required: true, blank: true }),
        amount: new fields.StringField({ required: true, blank: true, initial: '1' }),
      })),
      // Richer boost behaviors, authored by the build (src/modifiers.mjs BOOST_OVERRIDES — see the key list
      // there): on-consume side effects, a free variable amount, extra attacks, treat-as, inflict bonuses,
      // margin/graze damage, per-level damage, an extra save, pending-per-failure, on-kill effects, and
      // Madness-roll directives. Free-form because only build data writes it.
      special: new fields.ObjectField({ required: true, initial: {} }),
    });

    // "Expend additional AP" on a consistent action (Clotsnipe, Into Fire, Dancer's Gale, Greater Enfeeblement): prompt
    // for up to `max` extra AP, add them to the cost, and expose the amount as `@extraAp` to this use's formulas.
    // `selfDamagePerAp` is HP lost per AP spent in total (Clotsnipe: 1D4 per AP).
    schema.extraAp = new fields.SchemaField({
      max: new fields.StringField({ required: true, blank: true }),
      label: new fields.StringField({ required: true, blank: true }),
      selfDamagePerAp: new fields.StringField({ required: true, blank: true }),
      // Damage die-steps per extra AP (Clotsnipe: "increase the dice type of the attack by one dice type").
      stepPerAp: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null }),
    });

    // A placed zone this ability creates (module/helpers/zones.mjs; authored in src/modifiers.mjs ZONE_OVERRIDES):
    // shape, size formula, anchor, and the zone's effect. Free-form because only build data writes it.
    schema.zone = new fields.ObjectField({ required: true, initial: {} });

    // Oracle Madness annotations (book p120; transcribed from the PDF in `src/madness.mjs` — the Roll20
    // catalog lacked them). `insaneOnly` = `P:I` (usable only while Insane). `prereq` = `P:MX` (minimum
    // Madness to use; a Focus ability ends if it later falls below). `gain`/`spend` are `M+X`/`M-X`
    // amount formulas rolled at end of action (`1d3-1` standard; `N` = player-chosen; `M` = all Madness).
    schema.madness = new fields.SchemaField({
      insaneOnly: new fields.BooleanField({ initial: false }),
      prereq: new fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
      gain: new fields.StringField({ required: true, blank: true }),
      spend: new fields.StringField({ required: true, blank: true }),
    });

    // Conditional modifiers — the unified "buff that applies only when X" model (see
    // docs/conditional-modifiers.md). Each is an EFFECT (a number moving a roll) gated by a
    // PREDICATE (atoms over roll options).
    schema.modifiers = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      // What number moves: toHit | damage | defense.{ad,pd,td,md,dr} | advantage.{toHit,trait} | dieStep.
      target: new fields.StringField({ required: true, blank: false, initial: 'damage' }),
      // Where it lands: a global bucket (all/melee/ranged/magic) or a catalogId (per-ability).
      scope: new fields.StringField({ required: true, blank: true, initial: 'all' }),
      // add = flat; step = die-ladder steps (damage/dieStep only).
      mode: new fields.StringField({ required: true, blank: false, initial: 'add', choices: ['add', 'step'] }),
      // A number or a simple `@ref` formula resolved against rollData + counters.
      value: new fields.StringField({ required: true, blank: true, initial: '1' }),
      // Predicate: atoms over roll options, all of which must hold. Empty array = unconditional; a
      // blank atom is allowed (mid-edit) and reads as vacuously true. Each atom is wrapped in a
      // SchemaField (`{atom}`) rather than a bare string so the item sheet's form round-trips it —
      // an array-of-scalars doesn't serialize reliably, an array-of-objects does.
      predicate: new fields.ArrayField(new fields.SchemaField({
        atom: new fields.StringField({ required: true, blank: true }),
      })),
    }));

    return schema;
  }

  /** Active abilities (cost AP + limbs, live on the Active sub-list). */
  get isActive() {
    return ['action', 'focus', 'ceremony'].includes(this.tag);
  }

  prepareDerivedData() {
    this.hasAttack = false;
    this.hasSave = false;
    for (const act of this.activities) {
      if (act.type === 'attack') {
        this.hasAttack = true;
        // Effective to-hit trait: explicit > category default (Power melee / Finesse ranged /
        // Wiles magic, p.218) > none.
        act.attack.effectiveTrait = act.attack.trait || CONFIG.SACADIA.attackCategories[act.attack.category]?.trait || '';
      }
      if (act.type === 'save') this.hasSave = true;
      for (const part of act.damage) {
        part.diceFormula = SacadiaAbility.#partFormula(part);
      }
    }
  }

  /** Resolve a damage part to a roll formula: freeform wins, else `(count)d(denomination)`. */
  static #partFormula(part) {
    if (part.formula?.trim()) return part.formula.trim();
    if (!part.denomination) return '';
    const count = String(part.count ?? '1').trim() || '1';
    return `(${count})d${part.denomination}`;
  }
}
