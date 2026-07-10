import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proficiencyForLevel,
  maxApForLevel,
  maxCspForLevel,
  checkDc,
  defenseValue,
  suggestedMaxHealth,
  suggestedMaxHealthPools,
  diceLadderFormula,
  effectiveDefenseStat,
  stepDie,
  resolveLimbSlots,
  effectiveApCost,
  loreLimit,
  effectiveDefenseValue,
  damageAfterDr,
  matchesAtom,
  evaluatePredicate,
  resolveModifierValue,
} from "../module/helpers/derivation.mjs";

// The real ladder start (book p.218): 1D2 → 1D4 → 1D6 → 1D8 → 1D10 → 2D6 → …
const LADDER = [
  { count: 1, die: 2 }, { count: 1, die: 4 }, { count: 1, die: 6 }, { count: 1, die: 8 },
  { count: 1, die: 10 }, { count: 2, die: 6 }, { count: 2, die: 8 }, { count: 2, die: 10 },
];

// Proficiency: 1 at L1, 2 at L2, then +1 every 3 levels.
test("proficiencyForLevel", () => {
  assert.equal(proficiencyForLevel(1), 1);
  assert.equal(proficiencyForLevel(2), 2);
  assert.equal(proficiencyForLevel(3), 2);
  assert.equal(proficiencyForLevel(4), 2);
  assert.equal(proficiencyForLevel(5), 3); // +1 three levels after L2
  assert.equal(proficiencyForLevel(8), 4);
  assert.equal(proficiencyForLevel(11), 5);
});

// Max AP: 2 at L1, 3 at L2, then +1 every 4 levels.
test("maxApForLevel", () => {
  assert.equal(maxApForLevel(1), 2);
  assert.equal(maxApForLevel(2), 3);
  assert.equal(maxApForLevel(5), 3);
  assert.equal(maxApForLevel(6), 4); // +1 four levels after L2
  assert.equal(maxApForLevel(10), 5);
});

// Max CSP: 10 at L1, +6 per level thereafter.
test("maxCspForLevel", () => {
  assert.equal(maxCspForLevel(1), 10);
  assert.equal(maxCspForLevel(2), 16);
  assert.equal(maxCspForLevel(3), 22);
  assert.equal(maxCspForLevel(10), 64);
});

// Defenses (book pp.190/222): 11 + governing stat + armor, computed independently.
test("defenseValue", () => {
  assert.equal(defenseValue({ stat: 0 }), 11); // fresh character, no stat, no armor
  assert.equal(defenseValue({ stat: 5 }), 16);
  assert.equal(defenseValue({ stat: 5, armor: 2 }), 18);
  assert.equal(defenseValue({ stat: -1 }), 10);
});

// Check DC (book p.218): 9 + profession stat + Proficiency + floor(Courage/3).
test("checkDc", () => {
  assert.equal(checkDc({ professionStat: 0, proficiency: 1, courage: 0 }), 10);
  assert.equal(checkDc({ professionStat: 3, proficiency: 1, courage: 6 }), 15); // 9+3+1+2
  assert.equal(checkDc({ professionStat: 4, proficiency: 3, courage: 8 }), 18); // 9+4+3+floor(8/3)=2
});

// Suggested Max Health: Σ (profession HP/level × that track's level).
test("suggestedMaxHealth", () => {
  assert.equal(suggestedMaxHealth([{ hpPerLevel: 7, level: 3 }]), 21); // Oracle L3
  assert.equal(suggestedMaxHealth([
    { hpPerLevel: 11, level: 4 }, // Soldier 4
    { hpPerLevel: 7, level: 2 },  // Oracle 2 (multiclass)
  ]), 58);
  assert.equal(suggestedMaxHealth([{ hpPerLevel: undefined, level: 3 }]), 0); // unset profession
});

// Suggested Max Health Pools: Level + floor(Power/2).
test("suggestedMaxHealthPools", () => {
  assert.equal(suggestedMaxHealthPools(1, 0), 1);
  assert.equal(suggestedMaxHealthPools(3, 5), 5); // 3 + floor(5/2)=2
  assert.equal(suggestedMaxHealthPools(10, 8), 14);
});

// Armor Max Stat cap on the governing stat.
test("effectiveDefenseStat", () => {
  assert.equal(effectiveDefenseStat(5, null), 5); // uncapped
  assert.equal(effectiveDefenseStat(5, 3), 3);    // capped down
  assert.equal(effectiveDefenseStat(2, 3), 2);    // under the cap
  assert.equal(effectiveDefenseStat(5, 0), 0);    // zero cap
});

// Die-step buffs walk the ladder (numeric count) or step the denomination (formula count).
test("stepDie", () => {
  // On-ladder numeric count walks the ladder: 1d6 → 1d8, 1d10 → 2d6.
  assert.deepEqual(stepDie(1, 6, 1, LADDER), { count: 1, denomination: 8 });
  assert.deepEqual(stepDie(1, 10, 1, LADDER), { count: 2, denomination: 6 });
  assert.deepEqual(stepDie(2, 6, 1, LADDER), { count: 2, denomination: 8 });
  // Formula count steps only the denomination, keeps the count.
  assert.deepEqual(stepDie("@madness", 4, 1, LADDER), { count: "@madness", denomination: 6 });
  // 0 steps is a no-op; clamps at the top.
  assert.deepEqual(stepDie(1, 6, 0, LADDER), { count: 1, denomination: 6 });
  assert.deepEqual(stepDie("@x", 10, 3, LADDER), { count: "@x", denomination: 10 });
});

// Limb economy: which slots an action occupies, what it newly exhausts, and whether it reused one.
test("resolveLimbSlots", () => {
  // One-arm action on a fresh turn takes the first free arm.
  assert.deepEqual(resolveLimbSlots(["oneArm"], {}),
    { occupied: ["leftArm"], newlyExhausted: ["leftArm"], reused: false });
  // Second one-arm action takes the other arm — still no reuse.
  assert.deepEqual(resolveLimbSlots(["oneArm"], { leftArm: true }),
    { occupied: ["rightArm"], newlyExhausted: ["rightArm"], reused: false });
  // Third one-arm action with both arms gone reuses an exhausted arm (→ +1 AP).
  assert.deepEqual(resolveLimbSlots(["oneArm"], { leftArm: true, rightArm: true }),
    { occupied: ["leftArm"], newlyExhausted: [], reused: true });
  // Two-arm action takes both arms at once.
  assert.deepEqual(resolveLimbSlots(["twoArm"], {}),
    { occupied: ["leftArm", "rightArm"], newlyExhausted: ["leftArm", "rightArm"], reused: false });
  // `leg` maps to the `legs` slot; non-arm limbs are direct.
  assert.deepEqual(resolveLimbSlots(["leg"], {}),
    { occupied: ["legs"], newlyExhausted: ["legs"], reused: false });
});

// Reusing an exhausted limb adds exactly +1 AP (once), else the base cost.
test("effectiveApCost", () => {
  assert.equal(effectiveApCost(1, false), 1);
  assert.equal(effectiveApCost(1, true), 2);
  assert.equal(effectiveApCost(2, true), 3);
  assert.equal(effectiveApCost(0, false), 0);
});

// Lore Limit: 1 at L4+, +1 at Fate 3+, +1 more at Fate 6+ (0 below L4).
test("loreLimit", () => {
  assert.equal(loreLimit(3, 6), 0);   // below level 4 → none
  assert.equal(loreLimit(4, 0), 1);   // level gate only
  assert.equal(loreLimit(4, 3), 2);   // + Fate 3
  assert.equal(loreLimit(10, 6), 3);  // + Fate 3 + Fate 6
  assert.equal(loreLimit(10, 5), 2);  // Fate 5 doesn't reach the second bump
});

// AD-as-floor: a to-hit beats the greater of the targeted defense and AD.
test("effectiveDefenseValue", () => {
  assert.equal(effectiveDefenseValue(15, 12), 15); // specific defense higher
  assert.equal(effectiveDefenseValue(11, 14), 14); // AD floor supersedes
  assert.equal(effectiveDefenseValue(13, 13), 13);
});

// DR soaks damage, floored at 0.
test("damageAfterDr", () => {
  assert.equal(damageAfterDr(10, 3), 7);
  assert.equal(damageAfterDr(2, 5), 0); // never negative
  assert.equal(damageAfterDr(8, 0), 8);
});

// Predicate atoms: presence, negation, numeric comparison against a roll option's value.
test("matchesAtom", () => {
  const opts = { "self:hp-below-half": true, "self:combat:consecutive-hits": 2, "self:wielding": "sword" };
  assert.equal(matchesAtom("self:hp-below-half", opts), true);
  assert.equal(matchesAtom("self:missing", opts), false);
  assert.equal(matchesAtom("!self:missing", opts), true);          // absent → negation holds
  assert.equal(matchesAtom("!self:hp-below-half", opts), false);   // present → negation fails
  assert.equal(matchesAtom("self:combat:consecutive-hits>=2", opts), true);
  assert.equal(matchesAtom("self:combat:consecutive-hits>2", opts), false);
  assert.equal(matchesAtom("self:combat:consecutive-hits<=1", opts), false);
  assert.equal(matchesAtom("self:combat:consecutive-hits=2", opts), true);
  assert.equal(matchesAtom("self:combat:consecutive-hits!=3", opts), true);
  assert.equal(matchesAtom("self:missing>=1", opts), false);       // absent counter reads as 0
  assert.equal(matchesAtom("", opts), true);                       // empty atom is vacuously true
  assert.equal(matchesAtom("self:wielding", opts), true);          // non-empty enum string is truthy
});

// A predicate is the AND of its atoms; empty/absent is unconditional.
test("evaluatePredicate", () => {
  const opts = { "self:profession:oracle": true, "self:condition:madness": 3 };
  assert.equal(evaluatePredicate([], opts), true);
  assert.equal(evaluatePredicate(undefined, opts), true);
  assert.equal(evaluatePredicate(["self:profession:oracle", "self:condition:madness>=1"], opts), true);
  assert.equal(evaluatePredicate(["self:profession:oracle", "self:condition:madness>=4"], opts), false);
  assert.equal(evaluatePredicate(["self:profession:oracle", "!self:condition:frenzy"], opts), true);
});

// Modifier value resolution: plain numbers, @refs (dotted), and add-expressions; rejects dice/exotic.
test("resolveModifierValue", () => {
  const nums = { power: 3, "combat.consecutiveHits": 2, "combat.focusRounds.stood_ground": 4 };
  assert.equal(resolveModifierValue(2, nums), 2);
  assert.equal(resolveModifierValue("2", nums), 2);
  assert.equal(resolveModifierValue("@power", nums), 3);
  assert.equal(resolveModifierValue("@combat.consecutiveHits", nums), 2);
  assert.equal(resolveModifierValue("@combat.focusRounds.stood_ground", nums), 4); // Fight Reflex ramp (underscored id)
  assert.equal(resolveModifierValue("@power+1", nums), 4);
  assert.equal(resolveModifierValue("ceil(@power/2)", nums), 2);   // "half your Power, rounded up"
  assert.equal(resolveModifierValue("floor(@power/2)", nums), 1);
  assert.equal(resolveModifierValue("min(@combat.consecutiveHits,@power)", nums), 2); // caps
  assert.equal(resolveModifierValue("@missing", nums), 0);   // unknown ref → 0
  assert.equal(resolveModifierValue("1d6", nums), 0);        // dice rejected (belongs in a damage part)
  assert.equal(resolveModifierValue("gameData", nums), 0);   // stray identifier rejected
  assert.equal(resolveModifierValue("", nums), 0);
});

// Dice-ladder position → dice string.
test("diceLadderFormula", () => {
  assert.equal(diceLadderFormula(0, LADDER), "1d2");
  assert.equal(diceLadderFormula(4, LADDER), "1d10");
  assert.equal(diceLadderFormula(5, LADDER), "2d6"); // count doubles past 1d10
  assert.equal(diceLadderFormula(null, LADDER), ""); // no ladder value
  assert.equal(diceLadderFormula(99, LADDER), "2d10"); // clamped to last
  assert.equal(diceLadderFormula(2, null), ""); // no ladder
});
