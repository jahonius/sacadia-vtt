import { test } from "node:test";
import assert from "node:assert/strict";
import {
  proficiencyForLevel,
  maxApForLevel,
  maxCspForLevel,
  checkDc,
  defenseValue,
  suggestedMaxHealth,
  suggestedMaxHealthPools,
} from "../module/helpers/derivation.mjs";

// Proficiency: 1 at L1, 2 at L2, then +1 every 3 levels.
test("proficiencyForLevel", () => {
  assert.equal(proficiencyForLevel(1), 1);
  assert.equal(proficiencyForLevel(2), 2);
  assert.equal(proficiencyForLevel(3), 2);
  assert.equal(proficiencyForLevel(4), 2);
  assert.equal(proficiencyForLevel(5), 3); // +1 three levels after L2
  assert.equal(proficiencyForLevel(8), 4);
  assert.equal(proficiencyForLevel(11), 5);
});

// Max AP: 2 at L1, 3 at L2, then +1 every 4 levels.
test("maxApForLevel", () => {
  assert.equal(maxApForLevel(1), 2);
  assert.equal(maxApForLevel(2), 3);
  assert.equal(maxApForLevel(5), 3);
  assert.equal(maxApForLevel(6), 4); // +1 four levels after L2
  assert.equal(maxApForLevel(10), 5);
});

// Max CSP: 10 at L1, +6 per level thereafter.
test("maxCspForLevel", () => {
  assert.equal(maxCspForLevel(1), 10);
  assert.equal(maxCspForLevel(2), 16);
  assert.equal(maxCspForLevel(3), 22);
  assert.equal(maxCspForLevel(10), 64);
});

// Defenses (book pp.190/222): 11 + governing stat + armor, computed independently.
test("defenseValue", () => {
  assert.equal(defenseValue({ stat: 0 }), 11); // fresh character, no stat, no armor
  assert.equal(defenseValue({ stat: 5 }), 16);
  assert.equal(defenseValue({ stat: 5, armor: 2 }), 18);
  assert.equal(defenseValue({ stat: -1 }), 10);
});

// Check DC (book p.218): 9 + profession stat + Proficiency + floor(Courage/3).
test("checkDc", () => {
  assert.equal(checkDc({ professionStat: 0, proficiency: 1, courage: 0 }), 10);
  assert.equal(checkDc({ professionStat: 3, proficiency: 1, courage: 6 }), 15); // 9+3+1+2
  assert.equal(checkDc({ professionStat: 4, proficiency: 3, courage: 8 }), 18); // 9+4+3+floor(8/3)=2
});

// Suggested Max Health: Σ (profession HP/level × that track's level).
test("suggestedMaxHealth", () => {
  assert.equal(suggestedMaxHealth([{ hpPerLevel: 7, level: 3 }]), 21); // Oracle L3
  assert.equal(suggestedMaxHealth([
    { hpPerLevel: 11, level: 4 }, // Soldier 4
    { hpPerLevel: 7, level: 2 },  // Oracle 2 (multiclass)
  ]), 58);
  assert.equal(suggestedMaxHealth([{ hpPerLevel: undefined, level: 3 }]), 0); // unset profession
});

// Suggested Max Health Pools: Level + floor(Power/2).
test("suggestedMaxHealthPools", () => {
  assert.equal(suggestedMaxHealthPools(1, 0), 1);
  assert.equal(suggestedMaxHealthPools(3, 5), 5); // 3 + floor(5/2)=2
  assert.equal(suggestedMaxHealthPools(10, 8), 14);
});
