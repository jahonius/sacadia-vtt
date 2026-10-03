import { test } from "node:test";
import assert from "node:assert/strict";
import { planPool, scorePool } from "../module/helpers/check-pool.mjs";

test("planPool: one die per level; advantage adds dice, disadvantage converts to auto-failures", () => {
  assert.deepEqual(planPool(3, 0), { poolCount: 3, autoFail: 0 });
  assert.deepEqual(planPool(3, 2), { poolCount: 5, autoFail: 0 });
  assert.deepEqual(planPool(3, -1), { poolCount: 2, autoFail: 1 });
  assert.deepEqual(planPool(2, -5), { poolCount: 0, autoFail: 2 });   // capped at the level count
  assert.deepEqual(planPool(0, 0), { poolCount: 1, autoFail: 0 });    // a simple condition is one check
});

test("scorePool: +mod on every die, each failure is a level taken", () => {
  const r = scorePool([10, 3, 15], { levels: 3, mod: 5, dc: 14 });
  assert.deepEqual(r.entries.map((e) => e.total), [15, 8, 20]);
  assert.equal(r.fails, 1);
  assert.equal(r.successes, 2);
});

test("scorePool: advantage keeps the best L; disadvantage auto-failures count as failures", () => {
  const adv = scorePool([2, 18, 9, 11], { levels: 2, net: 2, mod: 0, dc: 10 });
  assert.deepEqual(adv.keptTotals.sort((a, b) => a - b), [11, 18]);
  assert.equal(adv.fails, 0);
  assert.equal(adv.entries.filter((e) => e.dropped).length, 2);
  const dis = scorePool([19], { levels: 2, net: -1, mod: 0, dc: 10 });
  assert.equal(dis.fails, 1);          // the auto-failure
  assert.equal(dis.successes, 1);
});

test("scorePool: a Fumble reduces only the first check of the sequence (p.257)", () => {
  const r = scorePool([12, 12], { levels: 2, mod: 2, fumble: 3, dc: 13 });
  assert.deepEqual(r.entries.map((e) => e.total), [11, 14]);
  assert.equal(r.fails, 1);
});

test("scorePool without a DC reports totals only (GM resolves against a hidden DC)", () => {
  const r = scorePool([7, 9], { levels: 2, mod: 1 });
  assert.equal(r.fails, null);
  assert.deepEqual(r.keptTotals, [8, 10]);
});

import { checkContext, foldCheckModifiers, availableCheckSpends } from "../module/helpers/check-pool.mjs";
import { MODIFIER_OVERRIDES } from "../src/modifiers.mjs";
import { evaluatePredicate, resolveModifierValue } from "../module/helpers/derivation.mjs";

test("checkContext distinguishes the initial save, the Make Trait Check action, and either", () => {
  const save = checkContext("pinned", "lesserPhysical", "save");
  assert.ok(save["self:checking:pinned"] && save["self:checking:physical"] && save["self:saving:pinned"] && save["self:saving:physical"]);
  assert.ok(!save["self:resisting:pinned"]);
  const mtc = checkContext("panic", "greaterMental", "resist");
  assert.ok(mtc["self:resisting:panic"] && mtc["self:resisting:mental"] && mtc["self:checking:mental"]);
  assert.ok(!mtc["self:saving:panic"]);
});

test("Mental Fortitude adds Wiles vs mental conditions, twice on a Wiles check; Anointed only on the initial Pin save", () => {
  const items = (id) => [{ name: id, modifiers: MODIFIER_OVERRIDES[id] }];
  const nums = { wiles: 4 };
  const mental = { ...checkContext("panic", "greaterMental", "save") };
  assert.equal(foldCheckModifiers(items("mental_fortitude"), mental, nums).bonus, 4);
  assert.equal(foldCheckModifiers(items("mental_fortitude"), { ...mental, "self:checking:trait:wiles": true }, nums).bonus, 8);
  assert.equal(foldCheckModifiers(items("mental_fortitude"), checkContext("pinned", "lesserPhysical", "save"), nums).bonus, 0);
  assert.equal(foldCheckModifiers(items("thug_anointed"), checkContext("pinned", "lesserPhysical", "save")).adv, 1);
  assert.equal(foldCheckModifiers(items("thug_anointed"), checkContext("pinned", "lesserPhysical", "resist")).adv, 0);
});

test("caster-side save debuffs: Tough Starter on Pin saves, Bloodletter per 3 Hemorrhage, Ground Wrestle vs Prone", () => {
  const holds = (id, opts) => evaluatePredicate((MODIFIER_OVERRIDES[id][0].predicate ?? []).map((p) => p.atom), opts);
  assert.ok(holds("thug_tough_starter", { "inflict:pinned": true }));
  assert.ok(!holds("thug_tough_starter", { "inflict:hemorrhage": true }));
  assert.ok(holds("thug_ground_wrestle", { "inflict:pinned": true, "target:condition:prone": true }));
  assert.ok(!holds("thug_ground_wrestle", { "inflict:pinned": true }));
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.bloodletter[0].value, { "inflict.hemorrhage": 7 }), -2);
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.bloodletter[0].value, { "inflict.hemorrhage": 2 }), 0);
  assert.equal(MODIFIER_OVERRIDES.hindkick[0].scope, "basic_kick");
});

test("optional check spends: Confidence needs a mental check + a Savage point; Fateful Saves once per rest", () => {
  const owned = new Set(["confidence", "fateful_saves"]);
  const mental = { "self:checking:mental": true };
  assert.deepEqual(availableCheckSpends({ owned, pools: { savage: 1 } }, mental).map((c) => c.id), ["confidence", "fateful_saves"]);
  assert.deepEqual(availableCheckSpends({ owned, pools: { savage: 0 } }, mental).map((c) => c.id), ["fateful_saves"]);
  assert.deepEqual(availableCheckSpends({ owned, pools: { savage: 1 } }, {}).map((c) => c.id), ["fateful_saves"]);
  assert.deepEqual(availableCheckSpends({ owned, restFlags: { fatefulSaves: true } }, {}).map((c) => c.id), []);
});

test("picked abilities fire per instance: Drain Tolerant ×2 with different picks gives +1, not +2", () => {
  const dt = MODIFIER_OVERRIDES.drain_tolerant;
  const items = [
    { name: "DT", modifiers: dt, id: "drain_tolerant", pickValue: "hemorrhage" },
    { name: "DT", modifiers: dt, id: "drain_tolerant", pickValue: "pinned" },
  ];
  const picks = [{ id: "drain_tolerant", value: "hemorrhage" }, { id: "drain_tolerant", value: "pinned" }];
  const hem = checkContext("hemorrhage", "greaterPhysical", "save", picks);
  assert.equal(foldCheckModifiers(items, hem).adv, 1);
  const twice = [items[0], { ...items[0] }];   // the same condition picked twice stacks (book)
  assert.equal(foldCheckModifiers(twice, hem).adv, 2);
  assert.equal(foldCheckModifiers(items, checkContext("hemorrhage", "greaterPhysical", "resist", picks)).adv, 0); // initial check only
});

test("Reactive Mind: a one-roll bonus lands on the failing die it rescues; mental checks with a reaction only", () => {
  const r = scorePool([9, 12], { levels: 2, mod: 0, dc: 13, bonusOne: 3 });
  assert.deepEqual(r.entries.map((e) => e.total), [9, 15]);   // 12 → 15 passes; 9 → 12 wouldn't
  assert.equal(r.fails, 1);
  const none = scorePool([5, 6], { levels: 2, mod: 0, dc: 13, bonusOne: 3 });
  assert.deepEqual(none.entries.map((e) => e.total), [5, 6]); // nothing it can rescue
  const owned = new Set(["reactive_mind"]);
  const mental = { "self:checking:mental": true };
  assert.deepEqual(availableCheckSpends({ owned, reaction: 1 }, mental).map((c) => c.id), ["reactive_mind"]);
  assert.deepEqual(availableCheckSpends({ owned, reaction: 0 }, mental).map((c) => c.id), []);
  assert.deepEqual(availableCheckSpends({ owned, reaction: 1 }, {}).map((c) => c.id), []);
});

import { mergeInflicts } from "../module/helpers/conditions.mjs";

test("mergeInflicts: parts of one action giving the same condition are one attempt (no stacking, p.258)", () => {
  const m = mergeInflicts([
    { condition: "hemorrhage", level: 3 },
    { condition: "hemorrhage", level: 1 },                    // Jagged Blade's extra level
    { condition: "prone", level: 1 },
    { condition: "fatigue", level: 2, saveNegate: "finesse" },
    { condition: "fatigue", level: 1, saveNegate: "power" },  // a different check stays separate
  ]);
  assert.deepEqual(m.map((x) => [x.condition, x.level, x.saveNegate ?? ""]),
    [["hemorrhage", 4, ""], ["prone", 1, ""], ["fatigue", 2, "finesse"], ["fatigue", 1, "power"]]);
});

import { conditionSource, conditionEndures } from "../module/helpers/conditions.mjs";

test("conditionSource: Hemorrhage records the giver's die-steps when given (Mastery of Hemorrhage, Bleeding Expert)", () => {
  const giver = (owned, options = {}, numbers = {}) => ({ uuid: "A", name: "Kess", owned: new Set(owned), options, numbers });
  assert.equal(conditionSource(giver([]), "hemorrhage").dieSteps, 0);
  assert.equal(conditionSource(giver(["mastery_hemorrhage"]), "hemorrhage").dieSteps, 1);
  const running = { "self:used:bd_multiplicity": true };
  const allHit = { "combat.enemies": 3, "combat.focusTargets.bd_multiplicity": 3 };
  assert.equal(conditionSource(giver(["bd_bleeding_expert"], running, allHit), "hemorrhage").dieSteps, 1);
  assert.equal(conditionSource(giver(["bd_bleeding_expert"], running, { ...allHit, "combat.focusTargets.bd_multiplicity": 2 }), "hemorrhage").dieSteps, 0);
  assert.equal(conditionSource(giver(["mastery_hemorrhage"]), "pinned", "thug_natural_wrestler").dieSteps, 0);
  assert.deepEqual(conditionSource(giver([]), "pinned", "thug_natural_wrestler"), { casterUuid: "A", name: "Kess", ability: "thug_natural_wrestler", dieSteps: 0 });
  assert.equal(conditionSource(null, "pinned"), null);
});

test("conditionEndures: a per-creature Enduring instance skips turn-end decay; an unheld condition never does", async () => {
  const actor = (c) => ({ system: { conditions: c } });
  assert.equal(await conditionEndures(actor({ delirium: { value: 2, enduring: true } }), "delirium"), true);
  assert.equal(await conditionEndures(actor({ delirium: { value: 2 } }), "delirium"), false);
  assert.equal(await conditionEndures(actor({ delirium: { value: 0, enduring: true } }), "delirium"), false);
});

import { markdownToHtml, inline } from "../src/manual.mjs";

test("manual converter: title, headings, lists, tables, inline formatting", () => {
  const { title, html } = markdownToHtml("# Title\n\nSome **bold** and *it* and `a<b`.\n\n## Part\n\n- one\n  - nested\n- two\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| x | y |\n");
  assert.equal(title, "Title");
  assert.ok(html.includes("<p>Some <strong>bold</strong> and <em>it</em> and <code>a&lt;b</code>.</p>"));
  assert.ok(html.includes("<h2>Part</h2>"));
  assert.ok(html.includes("<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>"));
  assert.ok(html.includes("<ol><li>first</li><li>second</li></ol>"));
  assert.ok(html.includes("<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody>"));
  assert.equal(inline("[link](http://x)"), '<a href="http://x">link</a>');
});
