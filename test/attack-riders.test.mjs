import { test } from "node:test";
import assert from "node:assert/strict";
import { attackRiders } from "../module/helpers/attack-riders.mjs";
import { MODIFIER_OVERRIDES } from "../src/modifiers.mjs";
import { resolveModifierValue, evaluatePredicate } from "../module/helpers/derivation.mjs";

const owned = (...ids) => new Set(ids);

test("treat-as: Spearpoint needs Ticket to Enter with a spear; Full Monty only on the first attack while ≥3 enemies surround you", () => {
  const sp = { "self:attack:ability:basic_ticket_to_enter": true, "self:attack:weapon:spear": true };
  assert.deepEqual(attackRiders(owned("spearpoint"), sp).treatAs.map((r) => r.condition), ["surprised"]);
  assert.equal(attackRiders(owned("spearpoint"), { ...sp, "self:attack:weapon:spear": false }).treatAs.length, 0);
  const fm = { "self:surrounded": true, "self:combat:attacks-this-turn": 0 };
  assert.equal(attackRiders(owned("full_monty"), fm, { adjacentEnemies: 3 }).treatAs.length, 1);
  assert.equal(attackRiders(owned("full_monty"), fm, { adjacentEnemies: 2 }).treatAs.length, 0);
  assert.equal(attackRiders(owned("full_monty"), { ...fm, "self:combat:attacks-this-turn": 1 }, { adjacentEnemies: 3 }).treatAs.length, 0);
});

test("Bowling Bolt: Prone on a consistent crossbow attack with ≥6× advantage", () => {
  const o = { "self:attack:weapon:crossbow": true, "self:attack:advantage-stacks": 6, "self:attack:ap:2plus": true };
  assert.deepEqual(attackRiders(owned("bowling_bolt"), o).inflicts.map((r) => r.inflict.condition), ["prone"]);
  assert.equal(attackRiders(owned("bowling_bolt"), { ...o, "self:attack:advantage-stacks": 5 }).inflicts.length, 0);
  assert.equal(attackRiders(owned(), o).inflicts.length, 0);
});

test("Completionist +1 only once every enemy has been hit; Boss Energy only vs a lone enemy", () => {
  const comp = MODIFIER_OVERRIDES.bd_completionist[0].value;
  assert.equal(resolveModifierValue(comp, { "combat.focusTargets.bd_multiplicity": 3, "combat.enemies": 3 }), 1);
  assert.equal(resolveModifierValue(comp, { "combat.focusTargets.bd_multiplicity": 2, "combat.enemies": 3 }), 0);
  assert.equal(resolveModifierValue(comp, { "combat.focusTargets.bd_multiplicity": 2, "combat.enemies": 0 }), 0); // no fight
  const boss = MODIFIER_OVERRIDES.bd_boss_energy[0].value;
  assert.equal(resolveModifierValue(boss, { proficiency: 5, "combat.enemies": 1 }), 3);
  assert.equal(resolveModifierValue(boss, { proficiency: 5, "combat.enemies": 2 }), 0);
  assert.equal(resolveModifierValue(boss, { proficiency: 5, "combat.enemies": 0 }), 0);
  const mult = MODIFIER_OVERRIDES.bd_multiplicity[0].value;
  assert.equal(resolveModifierValue(mult, { proficiency: 3, "combat.focusTargets.bd_multiplicity": 5 }), 3); // capped
});

test("the second reaction attack while Surrounded is at 1× disadvantage unless I've Always Wanted to Be Here", () => {
  const atoms = MODIFIER_OVERRIDES.im_not_supposed_to_be_here[0].predicate.map((p) => p.atom);
  const second = { "self:attack:reaction": true, "self:surrounded": true, "self:combat:reaction-attacks": 1 };
  assert.ok(evaluatePredicate(atoms, second));
  assert.ok(!evaluatePredicate(atoms, { ...second, "self:combat:reaction-attacks": 0 }));
  assert.ok(!evaluatePredicate(atoms, { ...second, "self:ability:ive_always_wanted_to_be_here": true }));
});
