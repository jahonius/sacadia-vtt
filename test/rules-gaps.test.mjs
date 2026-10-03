import { test } from "node:test";
import assert from "node:assert/strict";
import { rendLeft, rendCapacity, distributeRend, restoreRend } from "../module/helpers/rend.mjs";
import { normalizeDamageType, parseResistances, typedResistance, sizeAdvantage, checkPrerequisites, trendToArcana } from "../module/helpers/derivation.mjs";
import { scorePool } from "../module/helpers/check-pool.mjs";
import { SACADIA } from "../module/helpers/config.mjs";

const T = SACADIA.damageTypes;
// A deterministic rng: always the first option.
const first = () => 0;

test("rend: capacity is the armor points not yet rended; a full piece moves on to the next", () => {
  const pieces = [
    { id: "iron", points: { td: 2, pd: 7 }, rend: { pd: 6 } },
    { id: "dye", points: { ad: 3 }, rend: {} },
  ];
  assert.deepEqual(rendLeft(pieces[0]), { ad: 0, pd: 1, td: 2, md: 0 });
  assert.equal(rendCapacity(pieces), 6);
  const { add, applied } = distributeRend(pieces, 10, { rng: first });
  assert.equal(applied, 6);
  const total = Object.values(add).flatMap((k) => Object.values(k)).reduce((a, b) => a + b, 0);
  assert.equal(total, 6);
});

test("rend: the preferred type goes first (Clever Rend / Rend Armor's choice)", () => {
  const pieces = [{ id: "leather", points: { td: 4, pd: 1, md: 1 }, rend: {} }];
  const { add } = distributeRend(pieces, 2, { prefer: "md", rng: first });
  assert.equal(add.leather.md, 1);
  assert.equal((add.leather.td ?? 0) + (add.leather.pd ?? 0), 1);
});

test("rend: a rest takes points back off the most-rended piece first", () => {
  const pieces = [{ id: "a", points: { pd: 5 }, rend: { pd: 1 } }, { id: "b", points: { td: 5 }, rend: { td: 3 } }];
  const { sub, restored } = restoreRend(pieces, 2);
  assert.equal(restored, 2);
  assert.equal(sub.b.td, 2);
});

test("rend: DR is never rended (designer's ruling); a piece's other points still are", () => {
  const pieces = [{ id: "hide", points: { dr: 2, pd: 1 }, rend: {} }];
  assert.equal(rendCapacity(pieces), 1);
  const { add, applied } = distributeRend(pieces, 3, { rng: first });
  assert.equal(applied, 1);
  assert.deepEqual(add.hide, { pd: 1 });
  assert.equal(rendCapacity([{ id: "plate", points: { dr: 3 }, rend: {} }]), 0);
});

test("damage types: weapon names normalize; elemental damage skips physical resistance; negatives are vulnerabilities", () => {
  assert.equal(normalizeDamageType("Bludgeon", T), "bludgeoning");
  assert.equal(normalizeDamageType("Piercing", T), "piercing");
  assert.equal(normalizeDamageType("", T), "");
  const r = parseResistances("physical 2, fire 5; rot immune, mental -2, all 1");
  assert.equal(typedResistance(r, "slashing", T), 3);
  assert.equal(typedResistance(r, "fire", T), 6);
  assert.equal(typedResistance(r, "water", T), 1);
  assert.equal(typedResistance(r, "mental", T), -1);
  assert.ok(typedResistance(r, "rot", T) > 900);
  assert.equal(typedResistance(r, "", T), 1);
});

test("size: the bigger creature gets 1X advantage per step against physical effects, capped at 3", () => {
  assert.equal(sizeAdvantage(4, 3), 1);
  assert.equal(sizeAdvantage(3, 5), -2);
  assert.equal(sizeAdvantage(7, 0), 3);
  assert.equal(sizeAdvantage(3, 3), 0);
});

test("prerequisites: traits, levels, specializations, professions and abilities; unknown parts are never unmet", () => {
  const ctx = {
    stats: { power: 3, fate: 2, wiles: 1 }, level: 5, proficiency: 3,
    professions: ["magus"], professionLevels: { magus: 4 }, professionNames: ["magus", "witch", "bladedancer", "fatebound"],
    abilities: new Set(["bloodsight"]), knownAbilities: new Set(["bloodsight", "life transference"]),
    specialties: { handcopy: 2, astrology: 1 }, talents: new Set(["literary"]), ownedTalents: new Set(),
  };
  assert.deepEqual(checkPrerequisites("Power 3, Bloodsight", ctx).unmet, []);
  assert.deepEqual(checkPrerequisites("Wiles[3], Life Transference", ctx).unmet, ["Wiles[3]", "Life Transference"]);
  assert.deepEqual(checkPrerequisites("Religion: Astrology[3]", ctx).unmet, ["Religion: Astrology[3]"]);
  assert.deepEqual(checkPrerequisites("Handcopy[2]", ctx).unmet, []);
  assert.deepEqual(checkPrerequisites("Magus Level 5", ctx).unmet, ["Magus Level 5"]);
  assert.deepEqual(checkPrerequisites("Bladedancer, Level 9", ctx).unmet, ["Bladedancer", "Level 9"]);
  const odd = checkPrerequisites("Heibrim in Empire, Literary", ctx);
  assert.deepEqual(odd.unmet, ["Literary"]);
  assert.deepEqual(odd.unknown, ["Heibrim in Empire"]);
});

test("Trend to Arcana: allies' d10s and paired d6s become d12s; enemies' paired d6s and d8s do", () => {
  assert.equal(trendToArcana("1d10 + 2d6 + @power", "ally"), "1d12 + 1d12 + @power");
  assert.equal(trendToArcana("4d6 + 2d8 + 1d10", "enemy"), "2d12 + 1d12 + 1d10");
  assert.equal(trendToArcana("1d6 + 3d6", "ally"), "1d6 + 3d6");
  assert.equal(trendToArcana("2d8", ""), "2d8");
});

test("check pool: Bureaucrat's Blessing puts Guidance's bonus on more dice", () => {
  const one = scorePool([8, 9, 10], { levels: 3, mod: 0, dc: 12, bonusOne: 3 });
  assert.equal(one.successes, 1);
  const three = scorePool([8, 9, 10], { levels: 3, mod: 0, dc: 12, bonusOne: 3, bonusCount: 2 });
  assert.equal(three.successes, 2); // 8+3 still misses 12; 9+3 and 10+3 pass
});
