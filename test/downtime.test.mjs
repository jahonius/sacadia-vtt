import { test } from "node:test";
import assert from "node:assert/strict";
import { oddJobPay, weekLimits, offeringAdvantage, offeringSucceeds, bargainValue, BARGAIN_TYPES, businessEarns, pay, receive,
  formatCoins, inSilver, fromSilver, sellPrice, STARTING_GOLD } from "../module/helpers/downtime.mjs";

test("downtime: odd jobs pay by Proficiency (p.265)", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(oddJobPay), [10, 20, 60, 100, 200, 250]);
  assert.equal(oddJobPay(7), 250, "past 6, as 6");
  assert.equal(oddJobPay(0), 0);
  assert.equal(STARTING_GOLD.thug, 30);
  assert.equal(STARTING_GOLD.hulinari_warrior, undefined, "the Hulinari Warrior lists none");
});

test("downtime: the Long Rest's limits (Influence 2, leads 2, Harvest to Proficiency, one pooled Offering)", () => {
  const plan = ["influence", "influence", "influence", "lead", "lead", "lead", "harvest", "harvest", "offering", "offering", "earn", "earn"]
    .map((kind) => ({ kind }));
  const out = weekLimits(plan, { proficiency: 1 }).map((w) => (w.counts ? w.reason || "ok" : `no:${w.reason}`));
  assert.deepEqual(out, ["ok", "ok", "no:max", "ok", "ok", "no:max", "ok", "no:max", "ok", "pooled", "ok", "ok"]);
});

test("downtime: Make an Offering's advantage and success", () => {
  assert.equal(offeringAdvantage({ religionRank: 2, gold: 250, weeks: 3 }), 7, "2 ranks + 2 per 100gc + 3 weeks");
  assert.equal(offeringAdvantage({ weeks: 1 }), 1);
  assert.ok(offeringSucceeds(20, 20));
  assert.ok(offeringSucceeds(12, 30));
  assert.ok(!offeringSucceeds(19, 19));
});

test("downtime: the bargain tables (p.266)", () => {
  assert.equal(BARGAIN_TYPES.length, 20);
  assert.deepEqual(BARGAIN_TYPES[0], { name: "Clothes", die: 13, table: "clothes" });
  assert.equal(BARGAIN_TYPES[19].table, null, "Magic Items are the GM's");
  assert.deepEqual(bargainValue(3), { min: 1, deal: 5, items: 1 });
  assert.deepEqual(bargainValue(17), { min: 16, deal: 20, items: 2 });
  assert.deepEqual(bargainValue(40), { min: 31, deal: 50, items: 4 });
  assert.equal(bargainValue(4, 20).deal, 50, "a natural 20 is the best deal");
});

test("downtime: what an inherited business earns", () => {
  assert.equal(businessEarns({ earn: "60" }), 60);
  assert.equal(businessEarns({ earn: "50*@proficiency" }, { proficiency: 3 }), 150);
  const stew = { byRarity: { Common: 10, "Very Rare": 80 } };
  assert.equal(businessEarns(stew, { proficiency: 2, rarity: "Very Rare" }), 160);
  assert.equal(businessEarns(stew, { proficiency: 2, rarity: "Legendary[2]" }), null);
  assert.equal(businessEarns({ note: "a check" }), null, "worked out by the player");
  assert.equal(businessEarns({ earn: "alert(1)" }), null, "only arithmetic");
});

test("downtime: a purse pays, makes change and receives", () => {
  assert.equal(inSilver({ gc: 2, sc: 30 }), 230);
  assert.deepEqual(fromSilver(230), { gc: 2, sc: 30 });
  assert.deepEqual(pay({ gc: 10, sc: 0 }, 0.25), { gc: 9, sc: 75 }, "change made from a gold");
  assert.deepEqual(pay({ gc: 10, sc: 40 }, 3.25), { gc: 7, sc: 15 }, "silver spent where it covers");
  assert.equal(pay({ gc: 1, sc: 50 }, 2), null, "can't afford it");
  assert.deepEqual(receive({ gc: 1, sc: 0 }, 2.5), { gc: 3, sc: 50 });
  assert.deepEqual(pay({ gc: 1, sc: 0 }, 0.5, 10), { gc: 0, sc: 5 }, "at 10 silver a gold");
});

test("downtime: coins for display, and what a merchant pays", () => {
  assert.equal(formatCoins(55), "55gc");
  assert.equal(formatCoins(2.5), "2gc 50sc");
  assert.equal(formatCoins(0.25), "25sc");
  assert.equal(formatCoins(0), "0gc");
  assert.equal(formatCoins(0.5, 10), "5sc");
  assert.equal(sellPrice(55), 27.5);
  assert.equal(sellPrice(55, 100), 27.5);
  assert.equal(sellPrice(0.01, 100), 0, "half a 1sc Candle is nothing");
  assert.equal(sellPrice(0.03, 100), 0.01, "down to a whole silver");
});
