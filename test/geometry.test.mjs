import { test } from "node:test";
import assert from "node:assert/strict";
import { angleDeg, largestGapDegrees, isSurrounded } from "../module/helpers/geometry.mjs";

const O = { x: 0, y: 0 };
const at = (deg, r = 10) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) });

test("angleDeg is orientation-consistent", () => {
  assert.equal(Math.round(angleDeg(O, { x: 1, y: 0 })), 0);
  assert.equal(Math.round(angleDeg(O, { x: 0, y: 1 })), 90);
  assert.equal(Math.round(angleDeg(O, { x: -1, y: 0 })), 180);
});

test("largestGapDegrees: empty/single is a full circle; cyclic wrap counted", () => {
  assert.equal(largestGapDegrees([]), 360);
  assert.equal(largestGapDegrees([45]), 360);
  assert.equal(largestGapDegrees([0, 90, 180, 270]), 90);
  assert.equal(largestGapDegrees([0, 45, 90]), 270); // all bunched on one side
});

test("isSurrounded: 4 enemies on all sides → surrounded", () => {
  assert.equal(isSurrounded(O, [at(0), at(90), at(180), at(270)]), true);
});

test("isSurrounded: 3 enemies spread evenly (120° apart) → surrounded", () => {
  assert.equal(isSurrounded(O, [at(0), at(120), at(240)]), true);
});

test("isSurrounded: 3 enemies bunched within a half-plane → not surrounded", () => {
  assert.equal(isSurrounded(O, [at(0), at(45), at(90)]), false);
});

test("isSurrounded: enemies spanning exactly 180° still fit the sightline → not surrounded", () => {
  // Gap of exactly 180° means a sightline contains all centers (book: centers on the line count as within).
  assert.equal(isSurrounded(O, [at(0), at(90), at(180)]), false);
});

test("isSurrounded: two or fewer enemies never surround (a ≥180° gap always remains)", () => {
  assert.equal(isSurrounded(O, [at(0), at(180)]), false);
  assert.equal(isSurrounded(O, [at(90)]), false);
  assert.equal(isSurrounded(O, []), false);
});
