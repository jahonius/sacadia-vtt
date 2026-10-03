import SacadiaDataModel from "./base-model.mjs";
import { gearId, gearSlug, findGear, armorMaterial, shieldSize } from "../helpers/actor-utils.mjs";
import { defenseValue, effectiveDefenseStat, evaluatePredicate, resolveModifierValue, modifierIsRollTime, parseResistances, predicateAtoms } from "../helpers/derivation.mjs";
import { REND_KEYS } from "../helpers/rend.mjs";

/** Global (bucket) modifier scopes; anything else is a per-ability catalogId scope. */
const GLOBAL_SCOPES = new Set(['all', 'melee', 'ranged', 'magic']);

/**
 * Shared schema + derived data for every Sacadia actor: the five core stats, current/max Health,
 * a biography, and the four derived defenses (+ DR). Character and NPC both use the same defense
 * derivation, so combat "just works" on either.
 */
export default class SacadiaActorBase extends SacadiaDataModel {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = {};

    // Five core stats (book p.226). The raw stat value is what gets added to rolls and defenses
    // (there is no d20-style derived modifier); `.display` is the signed string for the sheet.
    schema.stats = new fields.SchemaField(Object.keys(CONFIG.SACADIA.stats).reduce((obj, stat) => {
      obj[stat] = new fields.SchemaField({
        value: new fields.NumberField({ ...requiredInteger, initial: 0 })
      });
      return obj;
    }, {}));

    // Health. For a character, `max` is DERIVED from professions × level (the book's standard,
    // non-rolling value) plus `bonus` — a manual adjustment covering Heritage HP, a rolled-vs-average
    // delta, or a GM tweak (so rolling is still representable). For an NPC, `max` stays the editable
    // hand-authored value and `bonus` is unused. `value` is always the editable current HP.
    schema.health = new fields.SchemaField({
      // May go below 0 (book p.230): below 0 you're Wounded; at −½ max you die.
      value: new fields.NumberField({ ...requiredInteger, initial: 10 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 10, min: 0 }),
      bonus: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      // Temporary HP (book p.223): a damage buffer that absorbs before real HP, does not stack (a new
      // grant takes the higher), and is cleared when combat ends. Granted by Critical Recovery, Lifeguard-
      // boosted rolls, Astonishing Shout, Call of Healing, Indomitable Beast, etc.
      temp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });

    schema.biography = new fields.HTMLField({ required: true, blank: true });

    // Action economy — shared by both actor types (NPCs use the same AP + limb rules, book p.237).
    // `max` is the base pool: a character derives it from level (see `_baseMaxAp`); an NPC's is this
    // GM-editable value. Fatigue reduces the effective max in derived data for both.
    schema.ap = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 2, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 2, min: 0 })
    });

    // Battle Fatigue (book p.230): gained at the start of each turn while Wounded (HP below 0). It reduces
    // AP like Fatigue but is separate from it — it doesn't reduce at turn end and can't be checked against.
    // Cleared by rest once you're back above 0 HP.
    schema.battleFatigue = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Damage-type resistances (book p.222 "Circumstantial Damage Resistance"), typed in as a list: "physical 2, fire 5,
    // rot immune, mental -2" — a type, a group (physical / elemental / mental) or `all`; negative is a vulnerability.
    // Folded with equipment-granted ones (Corrupted Iron armor) into the derived `typedDr`.
    schema.resistances = new fields.StringField({ required: true, blank: true });
    // Size (book p.225): drives the size-difference advantage against physical effects. Medium for most heroes.
    schema.size = new fields.StringField({ required: true, blank: false, initial: 'medium', choices: Object.keys(CONFIG.SACADIA.sizes) });

    // Reaction economy (book p.237) — one reaction per round for everyone, refreshed at the start of
    // your turn. `max` is derived (1 + the `reactions` modifier: Rapid Reaction's passive +1); reaction
    // abilities spend `value`, and Reactionary-style grants bump it mid-round. Reset in resetActionEconomy.
    schema.reaction = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 })
    });

    // Limb-exhaustion tracker (7 boolean slots).
    schema.exhaustion = new fields.SchemaField(Object.keys(CONFIG.SACADIA.exhaustionSlots).reduce((obj, key) => {
      obj[key] = new fields.BooleanField({ initial: false });
      return obj;
    }, {}));

    // Per-turn action log (the "Actions Used" tracker). Each entry records what it spent so it can
    // be undone. `ap` is the action's nominal cost (shown in the log); `spent` is the AP actually
    // deducted — these differ on overspend (the deduction floors at 0), and undo refunds only
    // `spent`. `exhausted` lists the slots this action newly set (cleared on undo). Cleared at the
    // start of the turn.
    schema.actionLog = new fields.ArrayField(new fields.SchemaField({
      label: new fields.StringField({ required: true, blank: true }),
      // Source ability's catalogId (or item id) — drives the `self:used:<key>` roll option, which is
      // how a Focus ability's passive knows it was maintained (re-used) this turn.
      key: new fields.StringField({ required: true, blank: true }),
      // Per-use choice picked when the ability was activated → `self:choice:<key>:<choice>`.
      choice: new fields.StringField({ required: true, blank: true }),
      ap: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      spent: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      exhausted: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
    }));

    // Pending-attack buffs — one-shot bonuses that ride the actor's *next* attack, then are consumed
    // (Critical Strike: +1 advantage; Sapped/Sapping: flat to-hit/damage; Killing Frenzy / Reaching Claw:
    // treat the next target as a condition). Pushed by a trigger, drained by `#useAbility`. Cleared at
    // turn start (their scope is "this turn") and at combat end.
    schema.pendingAttack = new fields.ArrayField(new fields.SchemaField({
      advantage: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      toHit: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      damage: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      dieStep: new fields.NumberField({ ...requiredInteger, initial: 0 }),
      targetCondition: new fields.StringField({ required: true, blank: true }),
      label: new fields.StringField({ required: true, blank: true }),
    }));

    // Armed Boosts (catalogIds) — boost abilities the player has toggled on. The next matching action
    // consumes one (see docs/conditional-modifiers.md — "boosts"); the rest fizzle at turn start.
    schema.armedBoosts = new fields.ArrayField(new fields.StringField({ required: true, blank: false }));
    // `once`-per-turn boosts already consumed this turn — blocks re-arming them. Cleared at turn start.
    schema.boostsUsed = new fields.ArrayField(new fields.StringField({ required: true, blank: false }));

    // Auto-maintained combat-state counters — the observable half of the conditional-modifier roll
    // options (see docs/conditional-modifiers.md). Combat hooks keep these current; predicates read
    // them as `self:combat:*`. Not player-edited in the common case (the aggressive-automation path).
    schema.combatState = new fields.SchemaField({
      consecutiveHits: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      attacksThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Shield-attack / shield-hit counts this turn — drive the Soldier's shield combos (Flurry of
      // Shields' per-2-attacks die-step, One-Two Bash's per-hit to-hit/damage). Reset each turn.
      shieldAttacksThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      shieldHitsThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      // Sentinel bow ramps: missed attacks this turn (Aim Calibration), new targets hit this turn
      // (Bowman / Hawkeye), and the set of target uuids attacked this turn (drives `target:new`).
      missedAttacksThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      newTargetsHitThisTurn: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      attackedTargetsThisTurn: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      movedFeet: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      tookDamage: new fields.BooleanField({ initial: false }),
      // Focus-maintenance streak per Focus ability: catalogId → consecutive turns it has been used
      // ("maintained"), counting the turn it was initiated. Incremented on the first use each turn
      // (#spendAction); a streak that wasn't maintained last turn is dropped at turn start
      // (resetActionEconomy). Drives per-round ramps like Fight Reflex (`@combat.focusRounds.<id>`).
      focusRounds: new fields.ObjectField({ required: true, initial: {} }),
      // Hits landed per target token this turn (`{tokenUuid: n}`) → `@target.hits` at roll time: Reverse
      // Pankration's DC per 2 hits, Frightening Berserker's Panic, Biting Pankration / Bloodthreat's 4 hits,
      // Exhaustive Rage's 5. Its key count is the unique targets hit (Step and Stop's 3).
      hitsByTarget: new fields.ObjectField({ required: true, initial: {} }),
      // Unique targets hit while a Focus is maintained (`{catalogId: [tokenUuid]}`) — Multiplicity's
      // per-unique-target ramp. Pruned with `focusRounds` when the Focus isn't maintained.
      focusTargets: new fields.ObjectField({ required: true, initial: {} }),
      // Reaction attacks made since your last turn began (I'm Not Supposed to Be Here's second shot).
      reactionAttacks: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
    });

    // Target marks (Layer B, see docs/conditional-modifiers.md): a map of mark-key → array of the
    // token uuids this actor most recently "marked" with an ability declaring `system.mark.key`.
    // Stored on the *marker* (not the target) so re-marking simply overwrites the pointer — the old
    // target drops with no cleanup — and so a player can write it to their own actor without GM
    // routing. Read at roll time as `target:mark:<key>` when the current target is in the list.
    schema.marks = new fields.ObjectField({ required: true, initial: {} });

    // Cover state (book p239/p254): a player-controlled positional property — none / half / full —
    // set by the player rather than derived from map geometry. Drives `self:cover:*` roll options so
    // the ~dozen cover-gated abilities automate (Carmine Approach, High Ground, Covering Fire, …).
    schema.cover = new fields.StringField({
      required: true, blank: false, initial: 'none',
      choices: Object.keys(CONFIG.SACADIA.coverStates),
    });

    // Leveled conditions (0–6). Shared by both actor types so an inflicted condition automates on
    // PCs and NPCs alike; the character sheet surfaces the tracker (NPC UI in Phase 6).
    schema.conditions = new fields.SchemaField(Object.keys(CONFIG.SACADIA.conditions).reduce((obj, key) => {
      obj[key] = new fields.SchemaField({
        value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
        // Who gave these levels, recorded when the condition was first given (conditions don't stack, so one
        // source): `{casterUuid, name, ability, dieSteps}`. Hemorrhage's turn damage reads `dieSteps` (Mastery
        // of Hemorrhage, Bleeding Expert); Wrestling Focus reads `casterUuid` + `ability`. Cleared at 0.
        source: new fields.ObjectField({ required: true, initial: {} }),
        // This creature's instance is Enduring (Balanced Scale) — it doesn't drop at the end of turns. Cleared at 0.
        enduring: new fields.BooleanField({ initial: false }),
      });
      return obj;
    }, {}));

    return schema;
  }

  /* -------------------------------------------- */

  /**
   * Initialize the cross-modifier sink *before* Active Effects apply, so AE with keys like
   * `system.bonuses.toHit.all` / `system.bonuses.defense.pd` (mode ADD) accumulate into it; derived
   * data (attack rolls, defenses) then reads the populated values. This is the Foundry-native way to
   * let a temp buff "move the numbers": base-data init → AE apply → derived-data read.
   */
  prepareBaseData() {
    const buckets = () => ({ all: 0, melee: 0, ranged: 0, magic: 0 });
    this.bonuses = {
      toHit: buckets(),
      damage: buckets(),
      defense: { ad: 0, pd: 0, td: 0, md: 0, dr: 0 },
      dieStep: 0, // ladder steps applied to damage dice (die-step buffs; AE add to this)
      // Category-scoped die-steps ("all melee attacks" — Focused Rage, Toxic Masculinity), applied only to
      // attacks of that category.
      dieStepBy: { melee: 0, ranged: 0, magic: 0 },
      trait: 0,   // flat bonus added to every Trait Check (Stand By Me's +½Courage ally grant, …)
      healthMax: 0, // flat bonus to derived max HP (Living Wall's +2/level); folded in by the subclass
      checkDc: 0, // flat bonus to the character's Check DC (Check Please's +1); folded in by the subclass
      critThreshold: 0, // reduction (≤0) to the natural-d20 crit floor (Criticality −1, Divine −2); → critThreshold
      reactions: 0, // flat bonus to the per-round reaction max (Rapid Reaction's +1); → reaction.max
      // Net advantage attackers get against this actor (AE-able; −1 = "attacks against them at 1×
      // disadvantage"). Read by the attacker's #situationalAdvantage.
      incomingAdvantage: 0,
      damagePerAp: 0, // flat damage per AP an effect costs (Call of Effort's grant); read at damage roll
      // ---- Prestige (Magus / Witch) sinks, filled by their grants (AE ADD on these keys) ----
      immune: {},                 // condition → >0: immune (Heroism → Panic)
      tonic: {},                  // condition → >0: Toxin to Tonic inverts that condition's effects
      weaponSteps: {},            // weapon type → die-steps on attacks with it (Razorleaf +, Needlepine −)
      ignoreBattleFatigue: 0,     // >0: Battle Fatigue doesn't lower AP (Partial Revivify)
      forceCritFirst: 0,          // >0: the first attack each turn is a critical hit (Baneful Trade)
      selfHeal: 0,                // >0: damage you deal yourself becomes temp HP instead (Self-Heal)
      tempHpDice: 0,              // extra dice on your next temp-HP roll (Hallowed Touch)
      tempHpSteps: 0,             // die-steps on your next temp-HP roll (Mastery of Nonviolence)
      inflictPlus: 0,             // +1 level to your next big condition attempt (Wellspring)
      inflictPlusAt: 0,           // … when it attempts at least this many levels (0 → your Proficiency)
      inflictPlusHalf: 0,         // >0: … at half your Proficiency (rounded up) instead (Greater Wellspring)
      heldFocus: 0,               // >0: a Witch maintains this creature's Focus for it (Hold the Brush)
      autoHit: 0,                 // >0: your attacks that would miss hit instead (Infallible)
      untouchable: 0,             // >0: attacks against you miss (Masterful Stepping)
      stacksGiven: {},            // condition → >0: the levels you give of it stack (Toxic Touch: Hemorrhage)
      maximizeDamage: 0,          // >0: your attacks deal maximum damage (Explosive Rage)
      weaponElement: {},          // element → >0: your weapon damage is that element this turn (Corrupting Touch)
      primeCrits: 0,              // >0: prime natural d20s crit and natural 20s don't (Corrupting Touch)
      sizeStep: 0,                // size steps up (Legendary Form)
      ris: 0,                     // extra Readied Item Slots (items, abilities)
      endRageAtTurnEnd: 0,        // >0: your rage ends at the end of this turn (Explosive Rage)
      ignoreSurrounded: 0,        // >0: Surrounded has no effect on you (Guard Them)
      autoPassMental: 0,          // >0: failed mental checks against enemies succeed (Curse of the Shared Mind)
      traitBonusCount: 0,         // extra dice that get Guidance's bonus (Bureaucrat's Blessing)
      drainQuarter: 0,            // >0: a quarter of the damage you deal this turn becomes temp HP (Consumption)
      trendToArcana: 0,           // >0: you are the source of Trend to Arcana's dice change (30ft)
      failDamageDie: 0,           // die size: your next condition check deals that die per failure to you (Mind Sliver)
      freeLimbs: 0,               // >0: your next ability exhausts no limb (Blossom)
      incomingReactionAdvantage: 0, // advantage on reaction attacks against you (Field of Flowers: −1)
      attackAd: 0,                // >0: your weapon attacks target AD (Allied Spirit Blade)
      traitBonusOne: 0,           // a bonus to one die of your next Trait Check (Guidance)
      stingExtra: 0,              // extra damage taken per Sting level (Waspnest: +1)
      deliriumToDr: 0,            // >0: Delirium lowers DR instead of defenses (Delirious Vulnerabilities)
      stackingCap: {},            // condition → a held condition stacks up to this many levels (Poured Mold)
      hemorrhageSteps: 0,         // die-steps on Hemorrhage this creature gives (Bleeding Bane, + Greater Bleed)
      speed: 0, // flat feet added to Move Speed (Flitting Feet +5, Speed of the Gods +10, …); → speed.value
    };
    // Advantage / disadvantage sinks (extra kept-highest / kept-lowest d20s). Populated by AE and
    // leveled conditions; rolls net them against the player's chosen level. Any magnitude stacks.
    // Init here so AE (mode ADD) can accumulate before rolls read them.
    this.advantage = { toHit: 0, trait: 0 };
    this.disadvantage = { toHit: 0, trait: 0 };
    // Extra incoming damage (Sting); surfaced now, auto-applied to damage with Phase 10.
    this.damageTaken = 0;
    // Per-ability modifier sinks (keyed by catalogId): flat to-hit/damage and die-steps that apply
    // only when *that* ability rolls. `abilityDamageSteps` predates the unified model; the other two
    // are the flat-bonus siblings. Init here so AE could target them too if ever needed.
    this.abilityToHit = {};
    this.abilityDamage = {};
    this.abilityDamageSteps = {};
    // Dice-valued conditional damage bonuses (Consecutive Threat's `Xd4`): kept as roll *formulas*
    // (not numeric-resolved) and appended to matching damage rolls. Global by bucket, or per-ability.
    this.damageDiceBonus = { all: [], melee: [], ranged: [], magic: [] };
    this.abilityDamageDice = {};
    // Itemized list of conditional modifiers that qualified this cycle — the Tier-1 display surface
    // (the chat card / sheet read this to show "why is this +2"). {label, target, scope, value, source}.
    this.activeModifiers = [];
  }

  prepareDerivedData() {
    this._applyConditionEffects(); // fold leveled conditions into bonuses/disadvantage before defenses
    this._prepareStats();
    this._prepareModifiers();      // fold qualifying conditional modifiers into the sinks (pre-defense)
    this._prepareGearEffects();    // adornments and trinkets kept at hand (Saltstone, Finger Necklace, Tusk Headdress)
    this._prepareDefenses();
    this._prepareResistances();
    this._prepareSize();
    this._prepareItemSlots();
    this._prepareActionPoints();
    // Natural-d20 crit floor: 20 by default, lowered by `critThreshold` modifiers (Criticality → 19,
    // Divine Criticality → 18). Clamped so it can never drop below 2. Read at roll time to flag a crit
    // off the *kept* d20 (the higher die under advantage, the lower under disadvantage).
    this.critThreshold = Math.max(2, 20 + (this.bonuses.critThreshold ?? 0));
    // Reaction max: 1/round baseline, raised by passive `reactions` modifiers (Rapid Reaction). The
    // stored `value` stays authoritative and is *not* clamped to max — a Reactionary-style grant
    // legitimately pushes it above the passive cap for the round.
    // Slowed (book p.261): "Reduce reactions by 1" at levels 1–4, by 2 at 5+.
    const slowed = this._conditionIgnored('slowed') ? 0 : (this.conditions?.slowed?.value ?? 0);
    const slowedReactions = (this.bonuses?.tonic?.slowed ?? 0) > 0 ? 0 : (slowed >= 5 ? 2 : (slowed > 0 ? 1 : 0));
    this.reaction.max = Math.max(0, 1 + (this.bonuses.reactions ?? 0) - slowedReactions);
    this._prepareSpeed(slowed);
  }

  /**
   * Move Speed (derived, feet). Every Heritage's base is 30ft (book p.151ff); NPCs may override it with a
   * stored `speed` value. Adjusted by `speed` modifiers (Flitting Feet, Mastery of the Step, Pack Form …),
   * Heavy Armor (−5ft, p.267), a Tower Shield in hand or RIS (−5ft, unless Defensive Mastery), and Slowed
   * (−5ft per level, p.261). Movement itself stays manual on the canvas; this is the number to honor.
   */
  _prepareSpeed(slowed = 0) {
    const opts = this._rollOptions?.() ?? {};
    const base = Number(this._source?.speed) || 30;
    // Finesse trait boon (book p.227): "For every 3 levels of Finesse you take, gain 5ft to your Move speed."
    const finesseBoon = this.parent?.type === 'character' ? 5 * Math.floor((this.stats?.finesse?.value ?? 0) / 3) : 0;
    let value = base + finesseBoon + (this.bonuses.speed ?? 0);
    const notes = [];
    // Rolling Fog (v1.2): "For as long as you maintain Focus on Clouded Foe or Clouded Ally, set your own Move Speed to 0."
    const fogLocked = !!this.parent?.getFlag?.('sacadia', 'rollingFog')
      && ((this.combatState?.focusRounds?.clouded_foe ?? 0) > 0 || (this.combatState?.focusRounds?.clouded_ally ?? 0) > 0);
    // Ride Like the Wind: "As long as you maintain Focus in Pack Form, double your movement speed."
    if ((this.combatState?.focusRounds?.ride_like_the_wind ?? 0) > 0 && opts['self:form:pack']) { value *= 2; notes.push('double'); }
    if (opts['self:armor:heavy']) { value -= 5; notes.push('heavy'); }
    // Stamped Feathers (adornment): "Whenever your armor is fully rended, increase your Move Speed by 10ft."
    // Visaged Breastplate (adornment): "Reduce your Move Speed by 5ft."
    const items = this.parent?.items ?? [];
    const worn = items.filter((i) => i.type === 'armor' && i.system.equipped && i.system.weaponType !== 'shield');
    const fullyRended = worn.length > 0 && worn.every((i) => REND_KEYS.every((k) => (i.system.rend?.[k] ?? 0) >= (i.system.defenses?.[k] ?? 0)));
    if (fullyRended && findGear(this.parent, 'stamped_feathers')) { value += 10; notes.push('stamped-feathers'); }
    if (opts['self:gear:visaged-breastplate']) { value -= 5; notes.push('visaged-breastplate'); }
    if (opts['self:wielding:tower-shield'] && !opts['self:ability:mastery_defensive']) { value -= 5; notes.push('tower'); }
    // Toxin to Tonic turns Slowed into +5ft per level.
    if (slowed > 0) { value += ((this.bonuses?.tonic?.slowed ?? 0) > 0 ? 5 : -5) * Math.min(6, slowed); notes.push('slowed'); }
    // Overburdened (book p.181): "If you carry too many items in your bags, you move at half speed."
    if (this.itemSlots?.overburdened) { value = Math.floor(value / 2); notes.push('overburdened'); }
    if (fogLocked) { value = 0; notes.push('rolling-fog'); }
    // Flying (book p.93): "A player with the ability to fly can fly up to their move speed" — a Hulinari in Swarm Form.
    const fly = opts['self:form:swarm'] ? Math.max(0, value) : 0;
    this.speed = { base, value: Math.max(0, value), fly, notes };
  }

  /**
   * Assemble the roll options — a flat `tag → value` map of facts about the current situation that
   * predicates read (see docs/conditional-modifiers.md). Two sources here: actor-state (derived) and
   * combat-state (auto counters). The `context` (roll-time / canvas `target:*`) source is merged in
   * later by the caller at roll time; pass `extra` to fold it in.
   * @param {Record<string, number|string|boolean>} [extra]  Context options to merge (roll-time).
   * @returns {Record<string, number|string|boolean>}
   */
  /**
   * The actor's permanent picks by kind: `{ weaponType: {catalogId: value}, condition: {…}, pool: {…},
   * limb: {…} }` — read by attack/check context and the pick-driven mechanics (Poolmonger, Muscle and
   * Memory, immunities, Bolers Ban). Several instances of one ability (Drain Tolerant ×3) each count.
   * @returns {Record<string, {id:string, value:string}[]>}
   */
  _picks() {
    const out = { weaponType: [], condition: [], pool: [], limb: [], creature: [], defense: [], element: [] };
    for (const item of this.parent?.items ?? []) {
      if (item.type !== 'ability') continue;
      const kind = item.system?.pick?.kind;
      const value = item.flags?.sacadia?.pickValue;
      const id = item.flags?.sacadia?.catalogId;
      if (kind && value && id && out[kind]) out[kind].push({ id, value });
    }
    return out;
  }

  _rollOptions(extra = {}) {
    const o = {};
    // --- actor-state ---
    const hp = this.health ?? {};
    if (hp.max > 0 && hp.value * 2 <= hp.max) o['self:hp-below-half'] = true;
    if (hp.max > 0 && hp.value >= hp.max) o['self:hp-full'] = true;
    for (const [key, cond] of Object.entries(this.conditions ?? {})) {
      if (cond.value > 0) o[`self:condition:${key}`] = cond.value;
    }
    const armorCats = [];
    const armedWith = []; // equipped non-unarmed weapon types // equipped-armor categories, for the `self:armor:only-light` aggregate below.
    for (const item of this.parent?.items ?? []) {
      if (item.type === 'ability') {
        const cid = item.flags?.sacadia?.catalogId;
        if (cid) o[`self:ability:${cid}`] = true;
        // Permanent pick (Swordwork's weapon family, Drain Tolerant's condition, …) → `self:pick:<id>:<value>`.
        const pickValue = item.flags?.sacadia?.pickValue;
        if (cid && pickValue) o[`self:pick:${cid}:${pickValue}`] = true;
      }
      if (!item.system?.equipped) continue;
      // Equipped gear advertises its freeform weapon/item traits as `self:wielding:<trait>` predicates
      // (the book's weapon taxonomy is open-ended).
      if (item.type === 'gear') {
        for (const t of String(item.system.traits ?? '').split(/[,\s]+/).filter(Boolean)) {
          o[`self:wielding:${t.toLowerCase()}`] = true;
        }
      }
      // Any equipped item with a validated weapon type (a weapon, or a shield that can Bash) advertises a
      // reliable `self:wielding:<type>` for ability gating (Shield and Spear, Shield Warrior, …).
      if (item.system.weaponType) {
        o[`self:wielding:${item.system.weaponType}`] = true;
        if (item.system.weaponType !== 'unarmed') armedWith.push(item.system.weaponType);
      }
      // Equipped armor advertises its weight class → `self:armor:<category>` (shields carry no class).
      if (item.type === 'armor' && item.system.category) {
        o[`self:armor:${item.system.category}`] = true;
        armorCats.push(item.system.category);
      }
      // An equipped named weapon (Bladedancer Named Weapons) → `self:wielding:named:<ability>` (Jagged Blade
      // rides Artery Strike, which has no attack roll of its own to bind a weapon to).
      if (item.flags?.sacadia?.namedAs) o[`self:wielding:named:${item.flags.sacadia.namedAs}`] = true;
      // Cloth armor sets (Divine Protection: "+1 TD when you wear a Cloth armor set").
      if (item.type === 'armor' && item.system.category && armorMaterial(item) === 'cloth') o['self:armor:cloth'] = true;
      // Tower shields (−5ft Move; Tower Training / Defensive Mastery key off them).
      if (item.type === 'armor' && shieldSize(item) === 'tower') o['self:wielding:tower-shield'] = true;
    }
    // Wielding nothing but unarmed weapons (fists, claws) → `self:unarmed` (Improvisational's Block/Dodge
    // die-step, "when you … only wield unarmed weapons").
    if (!armedWith.length) o['self:unarmed'] = true;
    // Light Wear / Slightly Darker Wear gate on wearing *only* light armor (at least one piece, none heavier).
    if (armorCats.length && armorCats.every((c) => c === 'light')) o['self:armor:only-light'] = true;
    // Wearing any physical armor (Oracle Armor Mastery: "+2 PD when you do not wear any physical armor").
    if (armorCats.length) o['self:armor:any'] = true;
    for (const key of this._professionKeys?.() ?? []) o[`self:profession:${key}`] = true;
    // Sentinel's chosen Favored Enemy types → `self:favored:<type>` (Favored Style keys its self-buff on
    // which type you favor). Character-only; NPCs have no professionResources.
    for (const t of this.professionResources?.sentinel?.favored ?? []) o[`self:favored:${t}`] = true;
    // Token status conditions (binary, GM-tracked on the token) → `self:<key>` — e.g. Insanity
    // (`self:insane`) or the Soldier's Steadied stance (`self:steadied`). Only the simple-condition
    // keys are surfaced; leveled conditions already emit `self:condition:<key>` above.
    for (const key of this.parent?.statuses ?? []) {
      if (key in CONFIG.SACADIA.simpleConditions) o[`self:${key}`] = true;
    }
    // A Deeper Rend (Focus): the limb chosen at cast gets its die-step while the Focus runs.
    const rend = this.parent?.getFlag?.('sacadia', 'deeperRend');
    if (rend && (this.combatState?.focusRounds?.a_deeper_rend ?? 0) > 0) o[`self:deeper-rend:${rend}`] = true;
    // Semper Steady (Thug L3): "Your first reaction each turn is always treated as Steadied" — while this
    // round's reaction is still unspent.
    if (o['self:ability:thug_semper_steady'] && (this.reaction?.max ?? 0) > 0 && (this.reaction?.value ?? 0) >= (this.reaction?.max ?? 1)) o['self:steadied'] = true;
    // Character level (level-scaled boost dice — Horn Butting's 1D10 → 2D6 @5 → 2D8 @11).
    o['self:level'] = this.level ?? 0;
    // Wounded: below 0 HP (book p.230).
    if ((this.health?.value ?? 0) < 0) o['self:wounded'] = true;
    // Adornments and trinkets at hand (a Readied Item Slot) → `self:gear:<slug>` (Visaged Breastplate, Lodestone …), keyed by
    // the item's catalog id so a renamed one keeps working (helpers/actor-utils.mjs gearSlug).
    for (const item of this.parent?.items ?? []) {
      if (!['gear', 'armor'].includes(item.type) || item.system.storage === 'sis' || item.flags?.sacadia?.broken) continue;
      o[`self:gear:${gearSlug(item)}`] = true;
    }
    // Hulinari beast form: `self:form:beast`, plus the subtype (`self:form:brute` …) while in it.
    if (o['self:beastForm']) {
      o['self:form:beast'] = true;
      const form = this.professionResources?.hulinari?.form;
      if (form) o[`self:form:${form}`] = true;
    }
    // Player-set Cover: a rank (`self:cover` = 0/1/2) plus a flag per held-or-better tier, so an
    // ability can gate on `self:cover:half` and it also fires at Full (Full ⇒ Half for gating).
    const coverRank = CONFIG.SACADIA.coverStates[this.cover]?.rank ?? 0;
    o['self:cover'] = coverRank;
    if (coverRank >= 1) o['self:cover:half'] = true;
    if (coverRank >= 2) o['self:cover:full'] = true;
    // Afraid of Your Touch: "Treat Half Cover as Full Cover" (read for your own gates here; attackers read
    // it in the sheet's #targetOptions).
    if (coverRank === 1 && o['self:ability:afraid_of_your_touch']) { o['self:cover'] = 2; o['self:cover:full'] = true; }
    // Abilities activated this turn (the per-turn action log, cleared at turn start) → `self:used:*`.
    // This is how a Focus ability's passive is gated on being re-used ("maintained") this turn.
    for (const entry of this.actionLog ?? []) {
      if (entry.key) o[`self:used:${entry.key}`] = true;
      if (entry.key && entry.choice) o[`self:choice:${entry.key}:${entry.choice}`] = true;
    }
    // --- combat-state (auto counters) ---
    const cs = this.combatState ?? {};
    o['self:combat:consecutive-hits'] = cs.consecutiveHits ?? 0;
    o['self:combat:attacks-this-turn'] = cs.attacksThisTurn ?? 0;
    o['self:combat:shield-attacks'] = cs.shieldAttacksThisTurn ?? 0;
    o['self:combat:shield-hits'] = cs.shieldHitsThisTurn ?? 0;
    o['self:combat:missed-attacks'] = cs.missedAttacksThisTurn ?? 0;
    o['self:combat:new-targets'] = cs.newTargetsHitThisTurn ?? 0;
    o['self:combat:reaction-attacks'] = cs.reactionAttacks ?? 0;
    o['self:combat:unique-hits'] = Object.keys(cs.hitsByTarget ?? {}).length;
    if (game.combat?.round === 1) o['self:combat:first-round'] = true;
    o['self:combat:moved-feet'] = cs.movedFeet ?? 0;
    if ((cs.attacksThisTurn ?? 0) === 0) o['self:combat:first-attack'] = true;
    if ((cs.movedFeet ?? 0) > 0) o['self:combat:moved'] = true;
    if (cs.tookDamage) o['self:combat:took-damage'] = true;
    // Focus-maintenance streaks (turns a Focus ability has been maintained) → `self:combat:focus-rounds:<id>`.
    for (const [cid, r] of Object.entries(cs.focusRounds ?? {})) o[`self:combat:focus-rounds:${cid}`] = r;
    return { ...o, ...extra };
  }

  /**
   * Numeric map for resolving modifier `@ref` values (`@power`, `@combat.consecutiveHits`, …) — the
   * flat, synchronous counterpart to getRollData (which builds dice roll data).
   * @returns {Record<string, number>}
   */
  _modifierNumbers() {
    const n = {};
    for (const [key, stat] of Object.entries(this.stats ?? {})) n[key] = stat.value;
    // Owned abilities as 0/1 scalars (`@owns.<id>`) — formula counts that switch on an owned upgrade
    // (Hoofstomp's damage only with Hoofstomp; Flattened Earth's Proficiency dice).
    for (const item of this.parent?.items ?? []) {
      const cid = item.type === 'ability' ? item.flags?.sacadia?.catalogId : null;
      if (cid) n[`owns.${cid}`] = 1;
    }
    for (const [key, cond] of Object.entries(this.conditions ?? {})) n[key] ??= cond.value;
    // Battle Fatigue from Dying (`@battleFatigue` — Icy Veil: +2 dice types per level).
    n.battleFatigue = this.battleFatigue ?? 0;
    // Max HP / AP (`@hpMax`, `@apMax` — Still Up's ⅓ Max HP, Royal Recovery's half your AP).
    n.hpMax = this.health?.max ?? 0;
    n.apMax = this.ap?.max ?? 0;
    n.reactions = this.reaction?.value ?? 0;
    const cs = this.combatState ?? {};
    n['combat.consecutiveHits'] = cs.consecutiveHits ?? 0;
    n['combat.attacksThisTurn'] = cs.attacksThisTurn ?? 0;
    n['combat.shieldAttacks'] = cs.shieldAttacksThisTurn ?? 0;
    n['combat.shieldHits'] = cs.shieldHitsThisTurn ?? 0;
    n['combat.missedAttacks'] = cs.missedAttacksThisTurn ?? 0;
    n['combat.newTargets'] = cs.newTargetsHitThisTurn ?? 0;
    n['combat.movedFeet'] = cs.movedFeet ?? 0;
    for (const [cid, r] of Object.entries(cs.focusRounds ?? {})) n[`combat.focusRounds.${cid}`] = r;
    // Rounds a Focus has been kept without moving since it began (Greater Glaring), tracked in AbilityUse.
    for (const [cid, s] of Object.entries(this.parent?.flags?.sacadia?.stillFocus ?? {})) n[`combat.stillRounds.${cid}`] = s?.rounds ?? 0;
    for (const [cid, list] of Object.entries(cs.focusTargets ?? {})) n[`combat.focusTargets.${cid}`] = (list ?? []).length;
    n['combat.uniqueHits'] = Object.keys(cs.hitsByTarget ?? {}).length;
    // Basic actions taken this turn by kind (`@combat.basic.fiveFootAdjust` — Whisperglide).
    for (const e of this.actionLog ?? []) {
      if (e.key?.startsWith('basic:')) n[`combat.basic.${e.key.slice(6)}`] = (n[`combat.basic.${e.key.slice(6)}`] ?? 0) + 1;
    }
    // Count of distinct Focus actions maintained/initiated this turn (`@combat.focusActions`) — a log
    // entry counts when its source ability is Focus-tagged. Drives the Focused Claw / Hyperfocused ramp
    // on Clawing Talons (+1 damage die per Focus action this turn).
    const focusKeys = new Set();
    for (const e of this.actionLog ?? []) {
      if (!e.key) continue;
      const it = this.parent?.items?.find((i) => (i.flags?.sacadia?.catalogId ?? i.id) === e.key);
      if (it?.system?.tag === 'focus') focusKeys.add(e.key);
    }
    n['combat.focusActions'] = focusKeys.size;
    // Focus abilities actively maintained right now (Focused Bite: "for every Focus Action you are actively maintaining").
    n['combat.focusMaintained'] = Object.values(cs.focusRounds ?? {}).filter((r) => r > 0).length;
    // Equipped shield's Defense (flat PD+TD) → `@shieldDefense`, for Sword and Shield (add it to a
    // non-shield weapon's damage). 0 when no shield is equipped.
    let shieldDefense = 0;
    for (const item of this.parent?.items ?? []) {
      if (item.type === 'armor' && item.system.equipped && item.system.weaponType === 'shield') {
        const d = item.system.defenses ?? {};
        shieldDefense = Math.max(shieldDefense, (d.pd ?? 0) + (d.td ?? 0));
      }
    }
    n.shieldDefense = shieldDefense;
    return n;
  }

  /**
   * The unified conditional-modifier producer (see docs/conditional-modifiers.md). Walk every owned
   * ability's `system.modifiers`, keep those whose predicate holds against the current roll options,
   * and fold each qualifying effect into the right sink — global buckets (`bonuses`/`advantage`) or
   * the per-ability maps. Records the survivors in `activeModifiers` for Tier-1 display. Runs in
   * derived data (reactive; no manual sweep).
   */
  _prepareModifiers() {
    const options = this._rollOptions();
    const numbers = this._modifierNumbers();
    for (const item of this.parent?.items ?? []) {
      if (item.type !== 'ability') continue;
      for (const mod of item.system?.modifiers ?? []) {
        if (!mod?.target) continue;
        const atoms = predicateAtoms(mod.predicate);
        // Roll-time-contextual modifiers need state not known at prep time, so they're evaluated at
        // roll time in the sheet — never folded here (would double-count). Includes any `target:*`
        // atom (the current target), `self:attack:*` (the *bound weapon* of the attack being rolled),
        // `self:surrounded`, and positional `@adjacent…` value scaling — see `modifierIsRollTime`.
        if (modifierIsRollTime(mod)) continue;
        if (!evaluatePredicate(atoms, options)) continue;
        // Dice-valued damage: keep the formula (resolved in the Roll at use, so it counter-scales).
        if (mod.target === 'damageDice') {
          const formula = String(mod.value ?? '').trim();
          if (!formula) continue;
          const entry = { formula, label: mod.label || item.name };
          const scope = mod.scope || 'all';
          if (GLOBAL_SCOPES.has(scope)) this.damageDiceBonus[scope].push(entry);
          else (this.abilityDamageDice[scope] ??= []).push(entry);
          this.activeModifiers.push({ ...entry, target: 'damageDice', scope, mode: 'dice', source: item.name, value: formula });
          continue;
        }
        const v = resolveModifierValue(mod.value, numbers);
        if (!v) continue;
        this.#foldModifier(mod, v);
        this.activeModifiers.push({
          label: mod.label || item.name, target: mod.target, scope: mod.scope || 'all',
          value: v, mode: mod.mode, source: item.name,
        });
      }
    }
  }


  /** A global die-step: `all` → every damage roll; a category scope → only attacks of that category. */
  #addDieStep(scope, v) {
    if (scope in this.bonuses.dieStepBy) this.bonuses.dieStepBy[scope] += v;
    else this.bonuses.dieStep += v;
  }

  /** Fold one qualifying modifier (with resolved numeric value) into the appropriate sink. */
  #foldModifier(mod, v) {
    const scope = mod.scope || 'all';
    const global = GLOBAL_SCOPES.has(scope);
    if (mod.target === 'toHit') {
      if (global) this.bonuses.toHit[scope] += v; else this.abilityToHit[scope] = (this.abilityToHit[scope] ?? 0) + v;
    } else if (mod.target === 'damage') {
      if (mod.mode === 'step') {
        if (global) this.#addDieStep(scope, v); else this.abilityDamageSteps[scope] = (this.abilityDamageSteps[scope] ?? 0) + v;
      } else if (global) this.bonuses.damage[scope] += v;
      else this.abilityDamage[scope] = (this.abilityDamage[scope] ?? 0) + v;
    } else if (mod.target === 'dieStep') {
      if (global) this.#addDieStep(scope, v); else this.abilityDamageSteps[scope] = (this.abilityDamageSteps[scope] ?? 0) + v;
    } else if (mod.target.startsWith('defense.')) {
      const sub = mod.target.split('.')[1];
      if (sub in this.bonuses.defense) this.bonuses.defense[sub] += v;
    } else if (mod.target.startsWith('advantage.')) {
      const sub = mod.target.split('.')[1];
      if (sub in this.advantage) this.advantage[sub] += v;
    } else if (mod.target === 'trait') {
      this.bonuses.trait += v; // Trait Checks aren't category-scoped, so always the flat sink.
    } else if (mod.target === 'health.max') {
      this.bonuses.healthMax += v; // read by the character's max-HP derivation (post-fold).
    } else if (mod.target === 'checkDc') {
      this.bonuses.checkDc += v; // read by the character's Check-DC derivation (post-fold).
    } else if (mod.target === 'critThreshold') {
      this.bonuses.critThreshold += v; // reduces the natural-d20 crit floor (post-fold derivation).
    } else if (mod.target === 'reactions') {
      this.bonuses.reactions += v; // raises the per-round reaction max (post-fold → reaction.max).
    } else if (mod.target === 'ris') {
      this.bonuses.ris += v; // extra Readied Item Slots (post-fold → itemSlots.ris.max).
    } else if (mod.target === 'speed') {
      this.bonuses.speed += v; // feet of Move Speed (post-fold → speed.value).
    }
  }

  /**
   * Effective Max AP = base pool − Fatigue (book p.262), shared by both actor types. The base pool
   * comes from {@link _baseMaxAp} (level-derived for characters, the GM-set field for NPCs).
   */
  _prepareActionPoints() {
    const fatigue = this._conditionIgnored('fatigue') ? 0 : (this.conditions?.fatigue?.value ?? 0);
    // Glory of Storms also ignores "any Exhaustion you have from being Wounded".
    // Partial Revivify (Magus): the dying ally ignores the Battle Fatigue from Dying while the Focus holds.
    const battle = (this._conditionIgnored('battleFatigue') || (this.bonuses?.ignoreBattleFatigue ?? 0) > 0) ? 0 : (this.battleFatigue ?? 0);
    this.ap.max = Math.max(0, this._baseMaxAp() - fatigue - battle);
  }

  /**
   * The base (pre-Fatigue) Max AP. The NPC uses its stored, GM-editable value; the character
   * overrides this to derive it from level.
   * @returns {number}
   */
  _baseMaxAp() {
    return this._source.ap?.max ?? 0;
  }

  /**
   * Apply each leveled condition's automated effects, scaled by its 0–6 level (effects cap at 6),
   * into the already-AE-populated `bonuses` / `disadvantage` sinks. Display-only conditions (no
   * `effects`) are left for adjudication; `turnDamage` is handled by the combat hook, not here.
   */
  /**
   * Whether a condition's *effects* are being ignored right now (the levels remain; you can still roll
   * against them): Glory of Storms ignores every condition for your turn (a turn flag set when the Boost
   * is spent); Ironhide ignores the one condition chosen when its Focus was used this turn.
   */
  _conditionIgnored(key) {
    const tf = this.parent?.getFlag?.('sacadia', 'turnFlags') ?? {};
    if (tf.ignoreConditions) return true;
    return (this.actionLog ?? []).some((e) => e.key === 'ironhide' && e.choice === key);
  }

  _applyConditionEffects() {
    // Glory of Storms also lifts the simple conditions' standing penalties (Prone / Blinded to-hit),
    // which arrive as Active Effect changes before this fold.
    if ((this.parent?.getFlag?.('sacadia', 'turnFlags') ?? {}).ignoreConditions) {
      for (const status of this.parent?.statuses ?? []) {
        for (const ch of CONFIG.SACADIA.simpleConditions[status]?.changes ?? []) {
          const m = /^system\.disadvantage\.(\w+)$/.exec(ch.key);
          if (m && this.disadvantage[m[1]] != null) this.disadvantage[m[1]] -= Number(ch.value) || 0;
        }
      }
    }
    for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
      const level = Math.min(this.conditions?.[key]?.value ?? 0, CONFIG.SACADIA.conditionMax);
      if (!level || this._conditionIgnored(key)) continue;
      // Toxin to Tonic (Witch): the condition helps instead — Nausea: +1 to-hit per level; Delirium: +1 DR per level;
      // Sting: +1 damage dealt per level; Slowed: +5ft Move per level (in _prepareSpeed).
      if ((this.bonuses.tonic?.[key] ?? 0) > 0) {
        if (key === 'nausea') this.bonuses.toHit.all += level;
        else if (key === 'delirium') this.bonuses.defense.dr += level;
        else if (key === 'sting') this.bonuses.damage.all += level;
        continue;
      }
      // Delirious Vulnerabilities (Witch): "That Delirium no longer reduces their AD, MD, TD, and PD. Instead, it
      // reduces their Damage Resistance to a minimum of zero." (The floor is applied in _prepareDefenses.)
      // Delirious Vulnerabilities marks this Delirium's instance (`source.toDr`), so it ends with the condition.
      if (key === 'delirium' && ((this.bonuses.deliriumToDr ?? 0) > 0 || this.conditions?.delirium?.source?.toDr)) { this.bonuses.defense.dr -= level; continue; }
      if (!cfg.effects?.length) continue;
      for (const eff of cfg.effects) {
        if (eff.type === 'bonus') {
          const [bucket, sub] = eff.target.split('.');
          if (this.bonuses[bucket] && sub in this.bonuses[bucket]) this.bonuses[bucket][sub] += eff.perLevel * level;
        } else if (eff.type === 'disadvantage') {
          this.disadvantage[eff.target] += eff.perLevel * level;
        } else if (eff.type === 'damageTaken') {
          // Waspnest (Witch): "Sting increases the damage they take by 2 per level, instead of 1."
          this.damageTaken += (eff.perLevel + (key === 'sting' ? (this.bonuses.stingExtra ?? 0) : 0)) * level;
        }
        // `resource` (Fatigue→ap.max) is applied in the character progression; `turnDamage` in combat.
      }
    }
  }

  /** Localized label + signed display string for each stat. */
  _prepareStats() {
    for (const [key, stat] of Object.entries(this.stats)) {
      stat.label = game.i18n.localize(CONFIG.SACADIA.stats[key]) ?? key;
      stat.display = stat.value >= 0 ? `+${stat.value}` : `${stat.value}`;
    }
  }

  /**
   * Derive AD/PD/TD/MD independently (`11 + capped governing stat + armor + effect bonus`), plus
   * DR. The governing stat is capped by equipped-armor Max Stat (flagged `cappedStat`). AD is a
   * floor: where AD exceeds another defense, that defense keeps its own true value and is flagged
   * `supersededByAd` for display (never overwritten — the Roll20 `_override_note` pattern).
   */
  _prepareDefenses() {
    const armor = this._armorContribution();
    const bonus = this.bonuses?.defense ?? {};
    this.defenses = {};
    for (const [def, statKey] of Object.entries(CONFIG.SACADIA.defenseStat)) {
      const raw = this.stats[statKey]?.value ?? 0;
      const stat = effectiveDefenseStat(raw, armor.maxStat);
      this.defenses[def] = {
        value: defenseValue({ stat, armor: (armor[def] ?? 0) + (bonus[def] ?? 0) }),
        statKey,
        label: game.i18n.localize(`SACADIA.Defense.${def.toUpperCase()}`),
        cappedStat: stat < raw,
      };
    }
    this.defenses.dr = { value: Math.max(0, (armor.dr ?? 0) + (bonus.dr ?? 0)), label: game.i18n.localize("SACADIA.Defense.DR") };

    const ad = this.defenses.ad.value;
    for (const def of ["pd", "td", "md"]) {
      this.defenses[def].supersededByAd = ad > this.defenses[def].value;
    }
  }

  /**
   * Sum the flat defense/DR bonuses (and the tightest Max Stat cap) from equipped armor Items.
   * @returns {{ad: number, pd: number, td: number, md: number, dr: number, maxStat: number|null}}
   */
  _armorContribution() {
    const c = { ad: 0, pd: 0, td: 0, md: 0, dr: 0, maxStat: null };
    for (const item of this.parent?.items ?? []) {
      if (item.type !== "armor" || !item.system.equipped) continue;
      // Rend (book p.258) removes points from this piece; a fully rended piece gives nothing until repaired. DR can't
      // be rended (designer's ruling).
      const d = item.system.defenses;
      const r = item.system.rend ?? {};
      for (const k of ["ad", "pd", "td", "md", "dr"]) c[k] += Math.max(0, (d[k] ?? 0) - (REND_KEYS.includes(k) ? (r[k] ?? 0) : 0));
      if (item.system.maxStat != null) {
        c.maxStat = c.maxStat == null ? item.system.maxStat : Math.min(c.maxStat, item.system.maxStat);
      }
    }
    return c;
  }

  /**
   * Passive adornment / trinket effects (book pp.195, 207–210) while the item is at hand (in a Readied Item Slot):
   * Saltstone "+1 to your Check DC"; Finger Necklace "For each Battle Fatigue you have from being Wounded, gain 1 DR";
   * Tusk Headdress "When you add no AD, PD, MD, or TD from the armor you wear, gain +1 DR".
   */
  _prepareGearEffects() {
    const opts = this._rollOptions?.() ?? {};
    if (opts['self:gear:saltstone']) this.bonuses.checkDc += 1;
    if (opts['self:gear:finger-necklace']) this.bonuses.defense.dr += this.battleFatigue ?? 0;
    if (opts['self:gear:tusk-headdress']) {
      const a = this._armorContribution();
      if (!(a.ad + a.pd + a.td + a.md)) this.bonuses.defense.dr += 1;
    }
  }

  /**
   * Item slots (book pp.180–181) for characters: Readied (RIS — 5, +3 with Axehappy while every readied item is a
   * Versatile weapon, worn armor or clothes, + `bonuses.ris`) and Stored (SIS — what your bags provide). The Elemental
   * Weapon's divine weapon takes no RIS. Carrying more than both hold is Overburdened: half Move Speed.
   */
  _prepareItemSlots() {
    if (this.parent?.type !== 'character') { this.itemSlots = null; return; }
    const items = (this.parent.items ?? []).filter((i) => ['gear', 'armor'].includes(i.type));
    const opts = this._rollOptions?.() ?? {};
    const freeDivine = !!opts['self:ability:fb_elemental_weapon'];
    let risUsed = 0; let sisUsed = 0; let sisMax = 0;
    for (const i of items) {
      sisMax += i.system.providesSis ?? 0;
      if (freeDivine && i.flags?.sacadia?.signature) continue;
      if (i.system.storage === 'sis') sisUsed += i.system.slots ?? 1; else risUsed += i.system.slots ?? 1;
    }
    // Axehappy: "If all of your combat-readied items are versatile weapons, equipped armor, equipped clothes, or a dagger
    // belt, increase the number of readied item slots (RIS) you have by 3."
    const readied = items.filter((i) => i.system.storage !== 'sis');
    const axehappy = !!opts['self:ability:bd_axehappy'] && readied.length > 0 && readied.every((i) => (i.type === 'armor'
      ? i.system.equipped : (/\bversatile\b/i.test(i.system.traits ?? '') || /(^|_)(clothes|clothing|dagger_belt)(_|$)/.test(gearId(i)))));
    const risMax = 5 + (axehappy ? 3 : 0) + (this.bonuses?.ris ?? 0);
    this.itemSlots = { ris: { used: risUsed, max: risMax }, sis: { used: sisUsed, max: sisMax },
      overburdened: risUsed + sisUsed > risMax + sisMax, axehappy };
  }

  /**
   * Effective size index (`sizeIndex`): the chosen size, Large while in Brute Form with Larger than Life, plus any
   * temporary steps (Legendary Form: "Increase your size by one type").
   */
  _prepareSize() {
    const keys = Object.keys(CONFIG.SACADIA.sizes);
    let i = Math.max(0, keys.indexOf(this.size ?? 'medium'));
    const opts = this._rollOptions?.() ?? {};
    if (opts['self:form:brute'] && opts['self:ability:larger_than_life']) i = Math.max(i, keys.indexOf('large'));
    i = Math.max(0, Math.min(keys.length - 1, i + (this.bonuses?.sizeStep ?? 0)));
    this.sizeIndex = i;
    this.sizeKey = keys[i];
  }

  /**
   * Typed damage resistance (`typedDr`): the actor's typed-in list plus equipped armor that resists an element
   * (Corrupted Iron: `flags.sacadia.resist`). Read by damage application through `typedResistance`.
   */
  _prepareResistances() {
    const out = parseResistances(this.resistances);
    for (const item of this.parent?.items ?? []) {
      if (item.type !== "armor" || !item.system.equipped) continue;
      for (const [k, v] of Object.entries(item.flags?.sacadia?.resist ?? {})) out[k] = (out[k] ?? 0) + (Number(v) || 0);
    }
    this.typedDr = out;
  }

  /* -------------------------------------------- */

  getRollData() {
    const data = {};
    // Expose raw stat values at the top level so roll formulas can use `@power`, `@fate`, …
    for (const [key, stat] of Object.entries(this.stats)) {
      data[key] = stat.value;
    }
    // Expose leveled-condition values so damage that scales off a condition resolves — e.g. the
    // Oracle's `@madness`-many-dice abilities (`@{condition_madness}` in the source catalogs).
    for (const [key, cond] of Object.entries(this.conditions ?? {})) {
      data[key] ??= cond.value;
    }
    // Proficiency defaults to 0 here so `@proficiency` resolves for NPCs (e.g. the initiative
    // formula `max(@courage,@finesse) + @proficiency`); the character overrides it with its real
    // derived value in its own getRollData.
    data.proficiency ??= 0;
    // Flat Trait-Check bonus (ally grants like Stand By Me write into `bonuses.trait`); Trait rolls
    // append `@traitBonus`. Defaults to 0 so the ref always resolves.
    data.traitBonus = this.bonuses?.trait ?? 0;
    // Combat counters, so damage/inflict formulas can scale off live state (`@combat.consecutiveHits`).
    const cs = this.combatState ?? {};
    data.combat = {
      consecutiveHits: cs.consecutiveHits ?? 0,
      attacksThisTurn: cs.attacksThisTurn ?? 0,
      shieldAttacks: cs.shieldAttacksThisTurn ?? 0,
      shieldHits: cs.shieldHitsThisTurn ?? 0,
      missedAttacks: cs.missedAttacksThisTurn ?? 0,
      newTargets: cs.newTargetsHitThisTurn ?? 0,
      movedFeet: cs.movedFeet ?? 0,
      focusRounds: { ...(cs.focusRounds ?? {}) },
    };
    return data;
  }

  /**
   * Profession keys owned by this actor, for `self:profession:*` roll options. Base actors (NPCs)
   * have none; the character overrides this with its primary/secondary professions.
   * @returns {string[]}
   */
  _professionKeys() {
    return [];
  }
}
