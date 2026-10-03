/**
 * Critical-effect registry + helpers (see docs/coverage-ledger.md — "crit-effect"). On a natural crit
 * (kept d20 ≥ the actor's `critThreshold`) the roller picks **one** critical effect from a menu; some
 * abilities add entries to that menu, others are always-on riders that explicitly "do not count as a
 * critical effect". This module is the single source of truth for both, keyed by ability catalogId.
 *
 * Each entry: `{ label, kind, ... }`. Kinds:
 *   - `damage`     — a damage-variant *choice*. `variant: 'maximize' | 'double'`. Maximize is the
 *                    universal baseline (everyone has it, no ability needed); Critical Harm adds Double.
 *   - `damage-mod` — modifies the Maximize/damage variant when the player picks it (not its own pick):
 *                    `dieStep` (Nicking Touch: dice one higher) — gated by an optional `require`.
 *   - `condition`  — a *target* condition choice: `{ condition, amount, require? }`. Applied via the GM
 *                    whisper's apply-condition buttons (reuses the save-inflict apply plumbing).
 *   - `self`       — an effect on the *attacker*: `{ effect: 'tempHp'|'ap'|'limb'|'advantage', ... }`.
 *                    Listed on the card; applied by the roller (Phase 2b buttons) or by hand.
 *   - `rider`      — always-on, NOT a pick: folds into the crit automatically. `damageDice` adds dice to
 *                    the damage roll; `inflict` merges into the attack's on-hit conditions. `supersededBy`
 *                    drops it when the upgrade is owned.
 *   - `budget`     — raises how many effects you may pick (Overwhelm / Boosted Crit: +1).
 *   - `note`       — a positional/geometry/reaction effect we can't apply mechanically; shown as text.
 */
export const CRIT_EFFECTS = {
  /* ---- Damage-variant choices + their modifiers ---- */
  critical_harm: { kind: 'damage', variant: 'double', label: 'Critical Harm' }, // roll twice as many damage dice
  nicking_touch: { kind: 'damage-mod', dieStep: 1, require: 'maximize', label: 'Nicking Touch' }, // maximize: dice one type higher
  crushing_blow: { kind: 'damage-mod', dieStep: 1, label: 'Crushing Blow' }, // +1 divine-weapon die vs a Targeted Foe

  /* ---- Always-on riders (do NOT consume the pick) ---- */
  thug_harmful_shadow: { kind: 'rider', damageDice: '(ceil(@proficiency/2))d6', label: 'Harmful Shadow', supersededBy: 'thug_deadlier_shadow' },
  thug_deadlier_shadow: { kind: 'rider', damageDice: '(@proficiency)d6', label: 'Deadlier Shadow' },
  fumbling_slice: { kind: 'rider', inflict: { condition: 'fumbled', amount: '1d4' }, label: 'Fumbling Slice' },

  /* ---- Target-condition choices (applied via the GM whisper) ---- */
  slamming_critical: { kind: 'condition', condition: 'prone', amount: '1', label: 'Slamming Critical' }, // crit vs PD → Prone
  thug_paralytic_strike: { kind: 'condition', condition: 'paralysis', amount: '1', label: 'Paralytic Strike' },
  critical_conditions: { kind: 'condition', condition: null, amount: '1', label: 'Critical Conditions' }, // +1 to an EXISTING adversarial condition (GM picks which)
  cleaving_claw: { kind: 'condition', condition: 'rended', amount: '2', label: 'Cleaving Claw' }, // rend 2 instead of 1
  // Other-class crit-inflicts (weapon/context notes in the label; the chooser is advisory, so a
  // crossbow-only pick simply isn't taken on a sword crit).
  mindcage: { kind: 'condition', condition: 'fatigue', amount: '1', label: 'Mindcage' }, // Oracle: crit → Fatigue
  tauntingly_defended: { kind: 'condition', condition: 'taunt', amount: '1', label: 'Tauntingly Defended' }, // crit → Taunt
  pinning_bolt: { kind: 'condition', condition: 'pinned', amount: '1', label: 'Pinning Bolt' }, // Sentinel: crossbow crit → Pin
  bd_important_vein: { kind: 'condition', condition: 'hemorrhage', amount: '1', label: 'Important Vein' }, // Bladedancer: crit → Hemorrhage
  without_sin: { kind: 'condition', condition: null, amount: '1', label: 'Without Sin' }, // Sentinel: sling crit → +1 existing condition

  /* ---- Self-effect choices (attacker) ---- */
  critical_recovery: { kind: 'self', effect: 'tempHp', dice: '1d6', scaleLevels: [5, 11], label: 'Critical Recovery' }, // 1d6 → 1d8@5 → 1d10@11 (+Lifeguard)
  thug_rapidstrike: { kind: 'self', effect: 'ap', amount: 1, label: 'Rapidstrike' },
  paused_critical: { kind: 'self', effect: 'limb', label: 'Paused Critical' },
  critical_strike: { kind: 'self', effect: 'advantage', label: 'Critical Strike' }, // +1 advantage next attack

  /* ---- Budget raisers ---- */
  overwhelm: { kind: 'budget', amount: 1, label: 'Overwhelm' },
  boosted_crit: { kind: 'budget', amount: 1, label: 'Boosted Crit' },

  /* ---- Notes: positional / multi-attack / reaction crit effects, listed but not mechanized ---- */
  cleaving_critical: { kind: 'note', label: 'Cleaving Critical', text: 'base damage vs a 2nd target within 5ft' },
  cascading_cleave: { kind: 'note', label: 'Cascading Cleave', text: 'cleave adds 1D10 to the next target' },
  wild_chain: { kind: 'note', label: 'Wild Chain', text: 'Wild Strike: chain an extra attack' },
  bd_wild_chain: { kind: 'note', label: 'Wild Chain', text: 'Wild Strike: chain an extra attack' },
  goliath_punch: { kind: 'note', label: 'Goliath Punch', text: 'throw the enemy 5×½Prof ft' },
  mage_critical: { kind: 'note', label: 'Mage Critical', text: 'target rolls Wiles or loses Focus' },
  spray_of_gore: { kind: 'note', label: 'Spray of Gore', text: 'Tear Apart: damage on the Surprise' },
  slicemaster: { kind: 'note', label: 'Slicemaster', text: 'kill → cleave remainder to a new target' },
  critical_tales: { kind: 'note', label: 'Critical Tales', text: 'lore-crit → +1 critical effect' },
  last_chance: { kind: 'note', label: 'Last Chance', text: 'reroll a hit for a crit' },
};

/** The universal baseline damage choice present on every crit (Maximize), independent of any ability. */
export const MAXIMIZE_CHOICE = { id: 'maximize', kind: 'damage', variant: 'maximize', label: 'Maximize Damage' };

/**
 * Split an actor's owned crit abilities into the parts the crit pipeline needs.
 * @param {string[]} ownedIds  catalogIds the actor owns (self:ability:* without the prefix).
 * @returns {{riders: object[], choices: object[], damageMods: object[], budget: number}}
 *   - `riders`     — always-on rider descriptors (superseded ones removed), each `{id, ...}`.
 *   - `choices`    — the pick menu (Maximize first, then owned damage/condition/self/note choices).
 *   - `damageMods` — modifiers to the damage variant (Nicking Touch / Crushing Blow).
 *   - `budget`     — number of effects the player may pick (1 + Σ budget raisers).
 */
export function critLayout(ownedIds) {
  const owned = new Set(ownedIds ?? []);
  const riders = [];
  const choices = [{ ...MAXIMIZE_CHOICE }];
  const damageMods = [];
  let budget = 1;
  for (const id of owned) {
    const e = CRIT_EFFECTS[id];
    if (!e) continue;
    if (e.kind === 'rider') {
      if (e.supersededBy && owned.has(e.supersededBy)) continue; // upgrade owned → base rider drops out
      riders.push({ id, ...e });
    } else if (e.kind === 'budget') {
      budget += e.amount ?? 1;
    } else if (e.kind === 'damage-mod') {
      damageMods.push({ id, ...e });
    } else {
      choices.push({ id, ...e });
    }
  }
  return { riders, choices, damageMods, budget };
}

/**
 * Total die-step to apply to the Maximize damage variant, given the owned damage-mods and whether a
 * required condition (e.g. Nicking Touch only helps when you *choose* maximize) is met. Crushing Blow
 * has no `require`, so it always contributes; Nicking Touch requires the maximize variant.
 * @param {object[]} damageMods  from {@link critLayout}
 * @param {string} variant       the chosen damage variant ('maximize' | 'double')
 * @returns {number} extra die-steps
 */
export function damageVariantDieStep(damageMods, variant) {
  let step = 0;
  for (const m of damageMods ?? []) {
    if (m.require && m.require !== variant) continue;
    step += m.dieStep ?? 0;
  }
  return step;
}
