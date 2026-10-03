import { test } from "node:test";
import assert from "node:assert/strict";
import { critLayout, damageVariantDieStep, CRIT_EFFECTS } from "../module/helpers/crit-effects.mjs";

test("no crit abilities → just the universal Maximize pick, budget 1, no riders", () => {
  const L = critLayout([]);
  assert.equal(L.choices.length, 1);
  assert.equal(L.choices[0].variant, "maximize");
  assert.equal(L.budget, 1);
  assert.deepEqual(L.riders, []);
  assert.deepEqual(L.damageMods, []);
});

test("riders auto-apply; a superseded base rider drops out when its upgrade is owned", () => {
  // Harmful Shadow alone → it's the rider.
  assert.deepEqual(critLayout(["thug_harmful_shadow"]).riders.map((r) => r.id), ["thug_harmful_shadow"]);
  // Owning Deadlier Shadow too → only the upgrade rides (no double-dip).
  assert.deepEqual(critLayout(["thug_harmful_shadow", "thug_deadlier_shadow"]).riders.map((r) => r.id), ["thug_deadlier_shadow"]);
});

test("budget raisers stack; choices/mods/riders sort into the right buckets", () => {
  const L = critLayout(["critical_harm", "nicking_touch", "fumbling_slice", "slamming_critical", "overwhelm"]);
  assert.equal(L.budget, 2); // 1 + Overwhelm
  assert.deepEqual(L.choices.map((c) => c.label), ["Maximize Damage", "Critical Harm", "Slamming Critical"]);
  assert.deepEqual(L.damageMods.map((m) => m.id), ["nicking_touch"]);
  assert.deepEqual(L.riders.map((r) => r.id), ["fumbling_slice"]);
});

test("damage-mods gate by required variant: Nicking Touch only helps Maximize, Crushing Blow any", () => {
  const L = critLayout(["nicking_touch", "crushing_blow"]);
  assert.equal(damageVariantDieStep(L.damageMods, "maximize"), 2); // both
  assert.equal(damageVariantDieStep(L.damageMods, "double"), 1);   // Crushing only (Nicking requires maximize)
});

test("Critical Harm is a Double damage choice; Maximize is never gated behind an ability", () => {
  assert.equal(CRIT_EFFECTS.critical_harm.variant, "double");
  const L = critLayout(["critical_harm"]);
  assert.ok(L.choices.some((c) => c.variant === "maximize")); // baseline present
  assert.ok(L.choices.some((c) => c.variant === "double"));   // Critical Harm adds Double
});
