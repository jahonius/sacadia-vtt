import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionDescriptor,
  boostApplies,
  matchArmedBoosts,
  foldBoostEffects,
} from "../module/helpers/boosts.mjs";
import { BOOST_OVERRIDES } from "../src/modifiers.mjs";

// Load the *actual baked* ability data so the tests exercise the real pilot boosts (not hand-copies).
const SOLDIER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/packs/abilities-soldier");
function ability(catalogId) {
  for (const f of fs.readdirSync(SOLDIER)) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(path.join(SOLDIER, f), "utf8"));
    if (d.flags?.sacadia?.catalogId === catalogId) return d;
  }
  throw new Error(`ability ${catalogId} not found in built pack`);
}

const stepAndSlide = ability("step_and_slide");   // boost → Stepping Strike
const targetedStrike = ability("targeted_strike"); // boost → melee attack
const thrustforth = ability("thrustforth");        // inflict-only boost → Stepping Strike
const steppingStrike = ability("stepping_strike"); // the melee-attack action both match
const sweep = ability("sweep");                    // a save action (no attack)

// A synthetic ranged attack, to prove category-scoped matching.
const rangedAttack = {
  type: "ability", flags: { sacadia: { catalogId: "ranged_x" } },
  system: { activities: [{ type: "attack", attack: { category: "ranged" } }] },
};

test("the pilot data is shaped as expected (Stepping Strike is a melee attack)", () => {
  const desc = actionDescriptor(steppingStrike);
  assert.equal(desc.catalogId, "stepping_strike");
  assert.ok(desc.attackCategories.has("melee"), "Stepping Strike should be a melee attack");
  assert.equal(targetedStrike.system.boost.appliesTo.kind, "attack");
  assert.equal(stepAndSlide.system.boost.appliesTo.ability, "stepping_strike");
});

test("boostApplies: ability-, attack-category-, and save-kind matching", () => {
  const stepDesc = actionDescriptor(steppingStrike);
  const sweepDesc = actionDescriptor(sweep);
  const rangedDesc = actionDescriptor(rangedAttack);

  // Step and Slide targets a specific ability.
  assert.equal(boostApplies(stepAndSlide.system.boost.appliesTo, stepDesc), true);
  assert.equal(boostApplies(stepAndSlide.system.boost.appliesTo, sweepDesc), false);

  // Targeted Strike targets any melee attack — matches Stepping Strike, not a ranged attack, not a save.
  assert.equal(boostApplies(targetedStrike.system.boost.appliesTo, stepDesc), true);
  assert.equal(boostApplies(targetedStrike.system.boost.appliesTo, rangedDesc), false);
  assert.equal(boostApplies(targetedStrike.system.boost.appliesTo, sweepDesc), false);
});

test("matchArmedBoosts: only armed + matching boosts, deconfliction count, self-exclusion", () => {
  const items = [stepAndSlide, targetedStrike];

  // Both armed → both match Stepping Strike (drives the deconfliction picker).
  const both = matchArmedBoosts(steppingStrike, items, ["step_and_slide", "targeted_strike"]);
  assert.equal(both.length, 2);

  // Only one armed → single auto-apply.
  const one = matchArmedBoosts(steppingStrike, items, ["step_and_slide"]);
  assert.equal(one.length, 1);
  assert.equal(one[0].flags.sacadia.catalogId, "step_and_slide");

  // Armed but nothing matches the action (Sweep is a save; neither boost targets it).
  assert.equal(matchArmedBoosts(sweep, items, ["step_and_slide", "targeted_strike"]).length, 0);

  // A ranged attack: the melee boost is excluded by category, the ability boost by catalogId.
  assert.equal(matchArmedBoosts(rangedAttack, items, ["step_and_slide", "targeted_strike"]).length, 0);

  // Nothing armed → nothing matches, even though the boosts exist on the actor.
  assert.equal(matchArmedBoosts(steppingStrike, items, []).length, 0);

  // A boost never matches the very action it's attached to (can't boost itself).
  assert.equal(matchArmedBoosts(stepAndSlide, items, ["step_and_slide"]).length, 0);
});

test("foldBoostEffects: Step and Slide folds a +1 damage die-step", () => {
  const out = foldBoostEffects(stepAndSlide.system.boost.effects, {}, "melee", {});
  assert.equal(out.dieStep, 1);
  assert.equal(out.damage, 0);
  assert.equal(out.advToHit, 0);
  assert.equal(out.notes.length, 1);
  assert.equal(out.notes[0].target, "damage");
  assert.equal(out.notes[0].mode, "step");
});

test("foldBoostEffects: Targeted Strike folds 1× disadvantage + 2 damage die-steps", () => {
  const out = foldBoostEffects(targetedStrike.system.boost.effects, {}, "melee", {});
  assert.equal(out.advToHit, -1); // 1× disadvantage on the to-hit
  assert.equal(out.dieStep, 2);   // +2 damage die-steps
  // Two card receipts: the disadvantage and the die-step.
  assert.equal(out.notes.length, 2);
  assert.ok(out.notes.some((n) => n.target === "advantage.toHit" && n.value === -1));
  assert.ok(out.notes.some((n) => n.target === "damage" && n.value === 2));
});

test("foldBoostEffects: predicate gating (an 'If you have Steadied' style clause)", () => {
  const effects = [{ target: "damage", mode: "add", scope: "all", value: "2", label: "Braced",
    predicate: [{ atom: "self:steadied" }] }];
  // Without the option → skipped.
  assert.equal(foldBoostEffects(effects, {}, "melee", {}).damage, 0);
  // With the option → applied.
  assert.equal(foldBoostEffects(effects, {}, "melee", { "self:steadied": true }).damage, 2);
});

test("foldBoostEffects: category scope gating", () => {
  const effects = [{ target: "damage", mode: "step", scope: "ranged", value: "1", label: "Ranged only" }];
  // A ranged-scoped effect must not fold into a melee activity.
  assert.equal(foldBoostEffects(effects, {}, "melee", {}).dieStep, 0);
  // …but does on a ranged one.
  assert.equal(foldBoostEffects(effects, {}, "ranged", {}).dieStep, 1);
});

test("foldBoostEffects: value formulas resolve against the numbers map", () => {
  const effects = [{ target: "toHit", mode: "add", scope: "all", value: "ceil(@proficiency/2)", label: "Scaled" }];
  assert.equal(foldBoostEffects(effects, { proficiency: 5 }, "melee", {}).toHit, 3);
});

test("foldBoostEffects: variable-spend boosts feed @spent", () => {
  const effects = [{ target: "advantage.toHit", mode: "add", scope: "all", value: "min(@spent,6)", label: "Charging" }];
  assert.equal(foldBoostEffects(effects, { spent: 3 }, "ranged", {}).advToHit, 3);
  assert.equal(foldBoostEffects(effects, { spent: 9 }, "ranged", {}).advToHit, 6); // capped
});

test("Punching Slide upgrades Step and Slide only when owned (caster predicate)", () => {
  const effects = stepAndSlide.system.boost.effects;
  // Without owning Punching Slide → just the base +1 die-step.
  assert.equal(foldBoostEffects(effects, {}, "melee", {}).dieStep, 1);
  // Owning it (self:ability:punching_slide) → the gated second die-step folds in → +2 total.
  assert.equal(foldBoostEffects(effects, {}, "melee", { "self:ability:punching_slide": true }).dieStep, 2);
});

test("Thrustforth is an inflict-only boost matching Stepping Strike", () => {
  // Matches by target-ability id, and carries no roll effect — only the Rend inflict.
  assert.equal(matchArmedBoosts(steppingStrike, [thrustforth], ["thrustforth"]).length, 1);
  assert.equal(foldBoostEffects(thrustforth.system.boost.effects, {}, "melee", {}).dieStep, 0);
  assert.deepEqual(thrustforth.system.boost.inflict, [{ condition: "rended", amount: "1" }]);
});

// --- Sentinel Trickshot boost cluster (authored in BOOST_OVERRIDES; asserted at the source so the
//     tests don't depend on a world-closed pack rebuild). ---

test("Charging Strike: +1 advantage per Trickshot spent, capped at 6", () => {
  const eff = BOOST_OVERRIDES.charging_strike.effects;
  assert.equal(BOOST_OVERRIDES.charging_strike.appliesTo.category, "ranged");
  assert.equal(foldBoostEffects(eff, { spent: 3 }, "ranged", {}).advToHit, 3);
  assert.equal(foldBoostEffects(eff, { spent: 9 }, "ranged", {}).advToHit, 6); // capped
  assert.equal(foldBoostEffects(eff, { spent: 0 }, "ranged", {}).advToHit, 0);
});

test("Fumbling Strike: fixed cost, inflicts Fumble = Proficiency on hit", () => {
  assert.equal(BOOST_OVERRIDES.fumbling_strike.appliesTo.category, "ranged");
  assert.deepEqual(BOOST_OVERRIDES.fumbling_strike.inflict, [{ condition: "fumbled", amount: "@proficiency" }]);
});

test("Head Strike ½-Prof pool, upgraded to full Prof by Head-Off (mutually exclusive)", () => {
  const eff = BOOST_OVERRIDES.head_strike.effects;
  // Without Head-Off → only the ½-Proficiency die pool folds.
  const base = foldBoostEffects(eff, {}, "ranged", {});
  assert.deepEqual(base.dice.map((d) => d.formula), ["(ceil(@proficiency/2))d8"]);
  // With Head-Off → only the full-Proficiency die pool folds (never both).
  const upgraded = foldBoostEffects(eff, {}, "ranged", { "self:ability:head_off": true });
  assert.deepEqual(upgraded.dice.map((d) => d.formula), ["(@proficiency)d8"]);
});
