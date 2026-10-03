import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale, refreshUpdate, weaponCopyChanged } from "../module/helpers/refresh.mjs";

test("refresh: an owned copy is stale when its build hash differs or predates the hash", () => {
  assert.equal(isStale({ flags: { sacadia: { buildHash: "abc" } } }, { buildHash: "abc" }), false);
  assert.equal(isStale({ flags: { sacadia: { buildHash: "abc" } } }, { buildHash: "def" }), true);
  assert.equal(isStale({ flags: { sacadia: {} } }, { buildHash: "def" }), true);
  assert.equal(isStale({ flags: { sacadia: {} } }, { buildHash: "" }), false);
});

test("refresh: armor takes the compendium's stats but keeps equipped, storage, rend, its name and the player's flags", () => {
  const owned = { _id: "a1", type: "armor", name: "Grandma's Mail",
    system: { equipped: true, storage: "ris", defenses: { pd: 3 }, rend: { pd: 2 }, slots: 1 },
    flags: { sacadia: { catalogId: "iron_mail", buildHash: "old", broken: true, legendary: true } } };
  const source = { name: "Iron Mail", img: "icons/mail.webp",
    system: { equipped: false, storage: "ris", defenses: { pd: 4, td: 1 }, rend: {}, slots: 2 },
    flags: { sacadia: { catalogId: "iron_mail", buildHash: "new", kind: "armor" } } };
  const u = refreshUpdate(owned, source, { del: () => "DELETE" });
  assert.equal(u._id, "a1");
  assert.equal(u.name, undefined); // equipment keeps the player's name
  assert.deepEqual(u.system.defenses, { pd: 4, td: 1 });
  assert.equal(u.system.slots, 2);
  assert.equal(u.system.equipped, true);
  assert.deepEqual(u.system.rend, { pd: 2 });
  assert.equal(u["flags.sacadia.buildHash"], "new");
  assert.equal(u["flags.sacadia.kind"], "armor");
  assert.equal(u["flags.sacadia.legendary"], "DELETE"); // a catalog flag the compendium dropped
  assert.ok(!("flags.sacadia.broken" in u)); // the player's state stays
  assert.equal(u.img, "icons/mail.webp");
});

test("refresh: abilities take the compendium name and all of their system data", () => {
  const owned = { _id: "b1", type: "ability", name: "Supressing Fire", system: { tag: "action" },
    flags: { sacadia: { catalogId: "suppressing_fire", pickValue: "x" } } };
  const source = { name: "Suppressing Fire", img: "i.webp", system: { tag: "focus" }, flags: { sacadia: { catalogId: "suppressing_fire", buildHash: "h" } } };
  const u = refreshUpdate(owned, source, { del: () => "DELETE" });
  assert.equal(u.name, "Suppressing Fire");
  assert.equal(u.system.tag, "focus");
  assert.ok(!Object.keys(u).some((k) => k.includes("pickValue")));
});

test("refresh: a weapon's generated attacks rebuild only when what they copy changed", () => {
  const before = { weaponType: "sword", traits: "Versatile", range: { type: "melee", value: null }, hands: 1, defense: "pd", slots: 1 };
  assert.equal(weaponCopyChanged(before, { ...before, slots: 2 }), false);
  assert.equal(weaponCopyChanged(before, { ...before, hands: 2 }), true);
  assert.equal(weaponCopyChanged(before, { ...before, range: { type: "ranged", value: 40 } }), true);
});
