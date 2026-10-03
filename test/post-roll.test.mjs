import { test } from "node:test";
import assert from "node:assert/strict";
import { POST_ROLL, eligiblePostRolls, scaledDie } from "../module/helpers/post-roll.mjs";

// A minimal reactor context; override per case.
const ctx = (over = {}) => ({
  owned: new Set(over.owned ?? []), opts: over.opts ?? {}, level: over.level ?? 1, prof: over.prof ?? 3,
  stats: { power: 3, finesse: 2, wiles: 1, courage: 5, fate: 5, ...(over.stats ?? {}) },
  madness: over.madness ?? 0, reactionAvailable: over.reactionAvailable ?? true, pools: over.pools ?? {},
  flags: over.flags ?? {}, focusRounds: over.focusRounds ?? {}, reactorMarks: over.reactorMarks ?? {},
  targetUuid: 'T', targetPinned: over.targetPinned ?? 0,
  sub: { melee: true, category: 'melee', hands: 1, natural: 8, toHitTotal: 12, damage: 9, defenseKey: 'pd', ...(over.sub ?? {}) },
});
const ids = (list) => list.map((e) => e.id);

test("scaledDie: 1d4 → 1d6 at 5 → 1d8 at 11, plus extra steps (capped at d12)", () => {
  assert.equal(scaledDie(1), "1d4");
  assert.equal(scaledDie(5), "1d6");
  assert.equal(scaledDie(11), "1d8");
  assert.equal(scaledDie(11, 1), "1d10");
  assert.equal(scaledDie(11, 9), "1d12");
});

test("Remaneuver: 1H melee miss, once/turn unless Brace and Maneuver; cap Prof or 2× with Sticking Your Neck Out", () => {
  const r = POST_ROLL.remaneuver;
  assert.ok(r.eligible(ctx({ owned: ["remaneuver"] })));
  assert.ok(!r.eligible(ctx({ owned: ["remaneuver"], sub: { hands: 2 } })));                  // two-handed
  assert.ok(!r.eligible(ctx({ owned: ["remaneuver"], sub: { melee: false } })));              // ranged
  assert.ok(!r.eligible(ctx({ owned: ["remaneuver"], flags: { remaneuverUsed: true } })));    // used this turn
  assert.ok(r.eligible(ctx({ owned: ["remaneuver", "brace_and_maneuver"], flags: { remaneuverUsed: true } })));
  assert.equal(r.cap(ctx({ prof: 3 })), 3);
  assert.equal(r.cap(ctx({ prof: 3, owned: ["sticking_your_neck_out"] })), 6);
  assert.deepEqual(r.onUse.selfConditions, { sting: 2 });
});

test("Block: Steadied vs a melee physical hit; Swordplay/Improvisational step the die; Dodge and Weave rider", () => {
  const b = POST_ROLL.basic_block;
  assert.ok(!b.eligible(ctx({})));                                                  // not Steadied
  assert.ok(b.eligible(ctx({ opts: { "self:steadied": true } })));
  assert.ok(!b.eligible(ctx({ opts: { "self:steadied": true }, sub: { melee: false, category: "ranged" } })));
  assert.ok(!b.eligible(ctx({ opts: { "self:steadied": true }, reactionAvailable: false })));
  assert.equal(b.die(ctx({ level: 5 })), "1d6");
  assert.equal(b.die(ctx({ level: 5, owned: ["swordplay"], opts: { "self:wielding:sword": true } })), "1d8");
  assert.equal(b.die(ctx({ level: 5, owned: ["swordplay"] })), "1d6");                            // no sword
  assert.equal(b.die(ctx({ level: 1, owned: ["improvisational"], opts: { "self:unarmed": true } })), "1d6");
  assert.equal(b.onConvert(ctx({})), null);
  assert.deepEqual(b.onConvert(ctx({ owned: ["thug_dodge_and_weave"], level: 11 })), { damageToAttacker: "2d6 + 3", label: "Dodge and Weave" });
});

test("Dodge needs Steadied + Medium Armor vs ranged; Cunning of Crows adds ½ Fate", () => {
  const d = POST_ROLL.basic_dodge;
  const ok = { opts: { "self:steadied": true, "self:armor:medium": true }, sub: { melee: false, category: "ranged" } };
  assert.ok(d.eligible(ctx(ok)));
  assert.ok(!d.eligible(ctx({ ...ok, opts: { "self:steadied": true } })));      // no medium armor
  assert.equal(d.flat(ctx({ owned: ["cunning_of_crows"], stats: { fate: 5 } })), 3);
  assert.equal(d.flat(ctx({})), 0);
});

test("Sacrifice reduction: Reduced Threat ½Courage, Good Side full Courage", () => {
  const s = POST_ROLL.sacrifice;
  assert.equal(s.reduction(ctx({})), 0);
  assert.equal(s.reduction(ctx({ owned: ["reduced_threat"], stats: { courage: 5 } })), 3);
  assert.equal(s.reduction(ctx({ owned: ["reduced_threat", "good_side"], stats: { courage: 5 } })), 5);
});

test("Spider's Trap only on Forbidden Knowledge/Web at 0 Madness with a Prescient point", () => {
  const e = POST_ROLL.spiders_trap;
  const base = { sub: { abilityId: "forbidden_knowledge" }, pools: { prescient: 1 } };
  assert.ok(e.eligible(ctx(base)));
  assert.ok(!e.eligible(ctx({ ...base, madness: 2 })));
  assert.ok(!e.eligible(ctx({ ...base, pools: { prescient: 0 } })));
  assert.ok(!e.eligible(ctx({ ...base, sub: { abilityId: "other" } })));
});

test("eligiblePostRolls filters by side, outcome, and ownership", () => {
  const c = ctx({ owned: ["remaneuver", "basic_block", "lucky_strike"], opts: { "self:steadied": true } });
  assert.deepEqual(ids(eligiblePostRolls(c, { side: "attacker", hit: false })).sort(), ["lucky_strike", "remaneuver"]);
  assert.deepEqual(ids(eligiblePostRolls(c, { side: "defender", hit: true })), ["basic_block"]);
  assert.deepEqual(ids(eligiblePostRolls(c, { side: "attacker", hit: true })), []);            // nothing on a hit
  assert.deepEqual(ids(eligiblePostRolls(ctx({}), { side: "attacker", hit: false })), []);      // owns nothing
});

test("Armor Nics / Sacrificial Wing key off the target standing in your Clouded Foe / Clouded Ally (v1.2)", () => {
  const inFoe = { targetInCloud: { foe: true, ally: false } };
  assert.ok(POST_ROLL.armor_nics.eligible({ ...ctx(), ...inFoe }));
  assert.ok(POST_ROLL.armor_nics.eligible({ ...ctx({ sub: { defenseKey: "td" } }), ...inFoe }));   // v1.2: TD too
  assert.ok(!POST_ROLL.armor_nics.eligible({ ...ctx({ sub: { defenseKey: "ad" } }), ...inFoe }));
  assert.ok(!POST_ROLL.armor_nics.eligible(ctx()));
  assert.ok(POST_ROLL.sacrificial_wing.eligible({ ...ctx(), targetInCloud: { foe: false, ally: true } }));
  assert.ok(!POST_ROLL.sacrificial_wing.eligible({ ...ctx(), ...inFoe }));
  assert.equal(POST_ROLL.lend_a_wing, undefined);
});

test("Please Don't reduces by Proficiency (Excuse Me owner); Forbidden Trap forces a Steadied FK miss unless a nat 1", () => {
  assert.ok(POST_ROLL.please_dont.eligible(ctx({ owned: ["excuse_me"] })));
  assert.ok(!POST_ROLL.please_dont.eligible(ctx({})));
  assert.equal(POST_ROLL.please_dont.fixedReduce(ctx({ prof: 4 })), 4);
  const ft = POST_ROLL.forbidden_trap;
  const base = { opts: { "self:steadied": true }, sub: { abilityId: "forbidden_knowledge", natural: 9 } };
  assert.ok(ft.eligible(ctx(base)));
  assert.ok(!ft.eligible(ctx({ ...base, sub: { abilityId: "forbidden_knowledge", natural: 1 } })));
  assert.ok(!ft.eligible(ctx({ ...base, opts: {} })));
});

test("Parrying Focus retaliates Finesse on a melee hit while its Focus runs; Blend In needs a Herd point", () => {
  const pf = POST_ROLL.bd_parrying_focus;
  assert.ok(pf.eligible(ctx({ focusRounds: { bd_parrying_focus: 1 } })));
  assert.ok(!pf.eligible(ctx({})));
  assert.equal(pf.damage(ctx({ stats: { finesse: 4 } })), 4);
  assert.ok(POST_ROLL.blend_in_with_the_herd.eligible(ctx({ pools: { herd: 1 } })));
  assert.ok(!POST_ROLL.blend_in_with_the_herd.eligible(ctx({ pools: { herd: 0 } })));
});
