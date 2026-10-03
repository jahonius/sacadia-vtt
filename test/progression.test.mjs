import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRESSION } from "../src/progression.mjs";
import { MODIFIER_OVERRIDES, BOOST_OVERRIDES, ACTIVITY_OVERRIDES } from "../src/modifiers.mjs";
import { detectPoolCost } from "../src/build-packs.mjs";
import { resolveModifierValue } from "../module/helpers/derivation.mjs";

test("progression: unique ids; three Legendary Masteries per profession", () => {
  const ids = PROGRESSION.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const legendary = {};
  for (const f of PROGRESSION.filter((x) => x.legendary)) legendary[f.profession] = (legendary[f.profession] ?? 0) + 1;
  for (const p of ["bladedancer", "fatebound", "hulinari_warrior", "oracle", "sentinel", "soldier", "thug"]) assert.equal(legendary[p], 3, p);
});

test("progression: speed features add feet; Pack-form speed gates on the form", () => {
  const ft = (id) => resolveModifierValue(MODIFIER_OVERRIDES[id][0].value, {});
  assert.equal(ft("bd_flitting_feet") + ft("bd_dancing_feet") + ft("bd_speed_of_the_gods"), 20);
  assert.equal(MODIFIER_OVERRIDES.need_for_speed[0].predicate[0].atom, "self:form:pack");
  assert.equal(MODIFIER_OVERRIDES.legendary_step[0].target, "speed");
});

test("progression: boosts — Rousing Success is free and Lore-paid; Legendary AP / Fast Reflexes refund AP", () => {
  assert.deepEqual(BOOST_OVERRIDES.rousing_success.special, { free: true, forceCrit: true, onConsume: { lore: 1 } });
  assert.equal(BOOST_OVERRIDES.sen_legendary_ap.special.onConsume.ap, -1);
  assert.deepEqual(BOOST_OVERRIDES.thug_fast_reflexes.special.requires, ["self:combat:attacks-this-turn=0"]);
  assert.equal(BOOST_OVERRIDES.sen_skilled_warrior.effects[0].value, "@wiles");
});

test("progression: Imposing Figure forces a Courage check for ½Prof Taunt", () => {
  const a = ACTIVITY_OVERRIDES.sol_imposing_figure[0];
  assert.equal(a.save.trait, "courage");
  assert.equal(resolveModifierValue(a.inflict[0].amount, { proficiency: 3 }), 2);
});

test("detectPoolCost: a per-target price is a chosen (variable) amount", () => {
  assert.deepEqual(detectPoolCost("expense one Savage Point for each creature Body Slam would affect"), { key: "savage", amount: 0, variable: true, max: "" });
  assert.equal(detectPoolCost("expend one Herd Point per target that rolls").variable, true);
  assert.deepEqual(detectPoolCost("Expend one Trickshot point and make all attacks"), { key: "trickshot", amount: 1, variable: false, max: "" });
});
