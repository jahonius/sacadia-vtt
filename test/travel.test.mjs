import { test } from "node:test";
import assert from "node:assert/strict";
import { METHODS, dailyHexes, dailySupply, isLaden, pxPerHex, pathLength, pointAt, subpath } from "../module/helpers/travel.mjs";

test("travel: a day's hexes are the method's speed on that road (p.287)", () => {
  assert.equal(dailyHexes({ method: "foot", road: "offRoad" }), 3);
  assert.equal(dailyHexes({ method: "foot", road: "dirtRoad" }), 4);
  assert.equal(dailyHexes({ method: "lightMount", road: "stoneRoad" }), 7);
  assert.equal(dailyHexes({ method: "heavyCart", road: "dirtRoad" }), 2);
  assert.equal(dailyHexes({ method: "mountRelay", road: "stoneRoad" }), 12);
});

test("travel: pushing it is a hex faster, slow a hex slower (p.286); weather and terrain slow it (p.292)", () => {
  assert.equal(dailyHexes({ method: "foot", road: "dirtRoad", pace: "fast" }), 5);
  assert.equal(dailyHexes({ method: "foot", road: "dirtRoad", pace: "slow" }), 3);
  assert.equal(dailyHexes({ method: "foot", road: "dirtRoad", weather: -1 }), 3, "rain");
  assert.equal(dailyHexes({ method: "foot", road: "offRoad", weather: -1, terrain: -2 }), 0, "rain in a jungle: stuck");
  assert.equal(dailyHexes({ method: "heavyCart", road: "offRoad", terrain: -3 }), 0, "never below 0");
});

test("travel: a laden wagon or heavy cart moves at half speed, rounded up (p.297); a mount isn't a cart", () => {
  assert.ok(isLaden("wagon", 41));
  assert.ok(!isLaden("wagon", 40));
  assert.ok(!isLaden("lightMount", 12));
  assert.equal(dailyHexes({ method: "wagon", road: "stoneRoad", supply: 45 }), 3, "5 halved, rounded up");
});

test("travel: a day eats 1 food and 1 water, as much again for each set of mounts, one more pushing it, no water by fresh water (p.288)", () => {
  assert.deepEqual(dailySupply({ method: "foot" }), { food: 1, water: 1 });
  assert.deepEqual(dailySupply({ method: "lightMount" }), { food: 2, water: 2 });
  assert.deepEqual(dailySupply({ method: "wagon", pace: "fast" }), { food: 3, water: 3 });
  assert.deepEqual(dailySupply({ method: "foot", freshWater: true }), { food: 1, water: 0 });
  assert.equal(METHODS.foot.maxSupply, 5);
});

test("travel: a 4 km hex in canvas pixels, from the scene's grid", () => {
  assert.ok(Math.abs(pxPerHex({ size: 100, distance: 50, units: "km" }) - 8) < 1e-9);
  assert.ok(Math.abs(pxPerHex({ size: 100, distance: 31.07, units: "mi" }) - 8) < 0.01);
  assert.equal(pxPerHex({ size: 100, distance: 5, units: "ft" }), 100, "a grid space is a hex");
});

test("travel: a stretch of a route between two distances along it", () => {
  const route = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.equal(pathLength(route), 20);
  assert.deepEqual(pointAt(route, 15), { x: 10, y: 5 });
  assert.deepEqual(subpath(route, 5, 15), [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], "keeps the corner");
  assert.deepEqual(subpath(route, 2, 6), [{ x: 2, y: 0 }, { x: 6, y: 0 }]);
  assert.deepEqual(pointAt(route, 99), { x: 10, y: 10 }, "past the end is the end");
});
