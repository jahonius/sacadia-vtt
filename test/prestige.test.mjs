import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boostApplies, actionDescriptor } from "../module/helpers/boosts.mjs";
import { POST_ROLL, ladderDie } from "../module/helpers/post-roll.mjs";
import { detectPoolCost } from "../src/build-packs.mjs";
import { PRESTIGE } from "../src/prestige-overrides.mjs";
import { ACTIVITY_OVERRIDES, GRANT_OVERRIDES, CHOICE_OVERRIDES, BOOST_OVERRIDES, EXTRAAP_OVERRIDES, POOL_OVERRIDES, AMOUNTPROMPT_OVERRIDES } from "../src/modifiers.mjs";
import { PROGRESSION } from "../src/progression.mjs";

const prestige = JSON.parse(fs.readFileSync(new URL("../src/prestige.json", import.meta.url), "utf8"));
const known = new Set([...prestige.magus, ...prestige.witch].map((e) => e.id).concat(PROGRESSION.filter((f) => f.prestige).map((f) => f.id)));

const ctx = (over = {}) => ({
  owned: new Set(over.owned ?? []), opts: {}, level: over.level ?? 1, prof: over.prof ?? 3, stats: {}, madness: 0,
  reactionAvailable: over.reactionAvailable ?? true, pools: over.pools ?? {}, flags: {}, focusRounds: {}, reactorMarks: {},
  sub: { melee: false, category: "magic", natural: 8, toHitTotal: 12, damage: 9, defenseKey: "md", ...(over.sub ?? {}) },
});

test("prestige overrides: every key names a transcribed Magus / Witch ability or feature", () => {
  for (const [map, entries] of Object.entries(PRESTIGE)) {
    for (const id of Object.keys(entries)) assert.ok(known.has(id), `${map}.${id}`);
  }
  // …and they reach the shared maps the build reads.
  assert.ok(ACTIVITY_OVERRIDES.mg_siphon_soul && GRANT_OVERRIDES.wt_razorleaf && CHOICE_OVERRIDES.wt_witchs_finger && BOOST_OVERRIDES.mg_blood_for_bane);
  assert.ok(EXTRAAP_OVERRIDES.mg_clotsnipe && POOL_OVERRIDES.mg_animate_dead && AMOUNTPROMPT_OVERRIDES.mg_life_transference);
});

test("prestige overrides: an `@choice` inflict or `<choice>` grant key always has a per-use choice", () => {
  for (const [id, acts] of Object.entries(PRESTIGE.activity)) {
    if (acts.some((a) => (a.inflict ?? []).some((i) => i.condition === "@choice"))) assert.ok(PRESTIGE.choice[id], id);
  }
  for (const [id, g] of Object.entries(PRESTIGE.grant)) {
    if ((g.changes ?? []).some((c) => c.key.includes("<choice>")) || (g.onEnd?.unEndure ?? []).includes("<choice>")) assert.ok(PRESTIGE.choice[id], id);
    if ((g.changes ?? []).some((c) => c.key.includes("<picks>"))) assert.ok(PRESTIGE.pick[id], id);
  }
  for (const [id, o] of Object.entries(PRESTIGE.onUse)) {
    if ([...o.target, ...o.self].some((e) => e.condition === "@choice") || o.enduring === "@choice") assert.ok(PRESTIGE.choice[id], id);
  }
  // A formula reading `@spent` needs something to set it: a variable pool cost, an amount prompt, or a boost prompt.
  const variablePool = new Set(prestige.magus.concat(prestige.witch).filter((e) => /expend (x|any number of)\b/i.test(e.description)).map((e) => e.id));
  for (const [id, acts] of Object.entries(PRESTIGE.activity)) {
    if (JSON.stringify(acts).includes("@spent")) assert.ok(variablePool.has(id) || PRESTIGE.amountPrompt[id] || PRESTIGE.pool[id], id);
  }
});

test("prestige overrides: save-gated grants are Focus grants, and Shield Transference covers every lower/raise pair", () => {
  for (const [id, acts] of Object.entries(PRESTIGE.activity)) {
    if (acts.some((a) => a.save?.ext?.grantOnFail)) assert.equal(PRESTIGE.grant[id]?.duration?.type, "focus", id);
  }
  const pairs = CHOICE_OVERRIDES.wt_shield_transference.options.map((o) => o.value);
  assert.equal(pairs.length, 6);
  for (const p of pairs) {
    const changes = GRANT_OVERRIDES.wt_shield_transference.changes.filter((c) => c.predicate[0].atom.endsWith(`:${p}`));
    assert.equal(changes.length, 4, p);
    // Greater Transference's extra half only on an ally (owner ruling): never through Foe Transference.
    const greater = changes.filter((c) => c.predicate.some((q) => q.atom === "self:ability:wt_greater_transference"));
    assert.equal(greater.length, 2, p);
    for (const c of greater) assert.ok(c.predicate.some((q) => q.atom === "!target:hostile"), p);
  }
});

test("boostApplies: several target abilities ('|') and any action spending a pool (Blood for Bane)", () => {
  const desc = (catalogId, pool = "") => actionDescriptor({ flags: { sacadia: { catalogId } }, system: { activities: [], costs: { pool: { key: pool } } } });
  assert.ok(boostApplies({ kind: "ability", ability: "a|b" }, desc("b")));
  assert.ok(!boostApplies({ kind: "ability", ability: "a|b" }, desc("c")));
  assert.ok(boostApplies({ kind: "pool", pool: "spell" }, desc("mg_hex", "spell")));
  assert.ok(!boostApplies({ kind: "pool", pool: "spell" }, desc("wt_nettle", "divine")));
  assert.ok(!boostApplies({ kind: "pool", pool: "spell" }, desc("mg_chill_touch")));
});

test("detectPoolCost: Spell Slots / Divine Touch Points, and 'X maxes at half your Proficiency'", () => {
  assert.deepEqual(detectPoolCost("Expend X Spell Slots and attempt to give a target 2X Fatigue (X maxes at half your Proficiency, rounded up)."),
    { key: "spell", amount: 0, variable: true, max: "ceil(@proficiency/2)" });
  assert.deepEqual(detectPoolCost("Choose an ally within 5ft and expend a Divine Touch Point."), { key: "divine", amount: 1, variable: false, max: "" });
  assert.deepEqual(detectPoolCost("Expend X Divine Touch Points (where X is any number up to half your Proficiency)"),
    { key: "divine", amount: 0, variable: true, max: "ceil(@proficiency/2)" });
});

test("post-roll: Checkered Shield's die climbs 1D8 → 1D10 @5 → 2D6 @11, +1 type per upgrade", () => {
  const e = POST_ROLL.mg_checkered_shield;
  assert.equal(e.die(ctx({ level: 1 })), "1d8");
  assert.equal(e.die(ctx({ level: 5 })), "1d10");
  assert.equal(e.die(ctx({ level: 11 })), "2d6");
  assert.equal(e.die(ctx({ level: 11, owned: ["mg_greater_shield", "mg_shield_of_delatia"] })), "2d10");
  assert.equal(e.minDamage, 1);
  assert.equal(ladderDie(0, 99), "3d10");
});

test("post-roll: Absorb Attack needs a Spell Slot and an elemental / mental attack; XD4 (XD6 Greater Absorption)", () => {
  const e = POST_ROLL.mg_absorb_attack;
  assert.ok(e.eligible(ctx({ pools: { spell: 1 } })));
  assert.ok(!e.eligible(ctx({ pools: { spell: 0 } })));
  assert.ok(!e.eligible(ctx({ pools: { spell: 1 }, sub: { category: "melee", defenseKey: "pd" } })));
  assert.equal(e.die(ctx({ prof: 4 })), "4d4");
  assert.equal(e.die(ctx({ prof: 4, owned: ["mg_greater_absorption"] })), "4d6");
});

test("post-roll: Balanced Fare can't save a natural 1; Harmed Fare can't stop a natural 20; Reduced Fare uses d4s", () => {
  const b = POST_ROLL.wt_balanced_fare;
  const h = POST_ROLL.wt_harmed_fare;
  assert.ok(b.eligible(ctx({ sub: { natural: 2 } })));
  assert.ok(!b.eligible(ctx({ sub: { natural: 1 } })));
  assert.ok(h.eligible(ctx({ owned: ["wt_balanced_fare"], sub: { natural: 19 } })));
  assert.ok(!h.eligible(ctx({ owned: ["wt_balanced_fare"], sub: { natural: 20 } })));
  assert.equal(b.fareDie(ctx({})), "d6");
  assert.equal(b.fareDie(ctx({ owned: ["wt_reduced_fare"] })), "d4");
  assert.equal(b.side, "attackerAlly");
  assert.equal(h.side, "defenderAlly");
});

/* ---- Lore abilities (book v1.2 pp.168–177) ---- */
import { LORE, LORE_NO_COST } from "../src/lore-overrides.mjs";
const lore = JSON.parse(fs.readFileSync(new URL("../src/lore.json", import.meta.url), "utf8"));

test("lore: 71 transcribed abilities with unique ids, and every override names one", () => {
  assert.equal(lore.length, 71);
  const ids = new Set(lore.map((e) => e.id));
  assert.equal(ids.size, lore.length);
  for (const [map, entries] of Object.entries(LORE)) for (const id of Object.keys(entries)) assert.ok(ids.has(id), `${map}.${id}`);
  for (const id of LORE_NO_COST) assert.ok(ids.has(id), id);
  // The two Infallibles differ: the general one lasts to the end of your turn, the Fatebound one to your next turn.
  assert.equal(LORE.grant.lore_infallible.duration.on, "turnEnd");
  assert.equal(LORE.grant.lore_fb_infallible.duration.type, "rounds");
});

test("lore: Lore Boosts are free and charge their point on consume; tags follow the book's superscripts", () => {
  for (const [id, b] of Object.entries(LORE.boost)) {
    assert.ok(b.special.free, id);
    assert.equal(b.special.onConsume.lore, 1, id);
    assert.ok(LORE_NO_COST.has(id), id);
  }
  const tag = Object.fromEntries(lore.map((e) => [e.id, e.tag]));
  assert.equal(tag.lore_still_up, "lore");
  assert.equal(tag.lore_kickbuck, "action");
  assert.equal(tag.lore_summon_beasts, "focus");
  assert.equal(tag.lore_saptouched, "passive");
  assert.equal(tag.lore_the_sauce, "reaction");
  // Fateful Fumble's level tiers are mutually exclusive.
  const tiers = LORE.onUse.lore_fateful_fumble.target.map((e) => e.predicate.map((p) => p.atom).join("&"));
  assert.deepEqual(tiers, ["self:level<5", "self:level>=5&self:level<11", "self:level>=11"]);
});
