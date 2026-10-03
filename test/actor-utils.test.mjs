import { test } from "node:test";
import assert from "node:assert/strict";
import { gearId, gearSlug, findGear, inferMaterial, inferShieldSize, armorMaterial, shieldSize, ownsAbility, opposed } from "../module/helpers/actor-utils.mjs";

const item = (name, type = "gear", catalogId = "", system = {}) => ({ name, type, system, flags: { sacadia: catalogId ? { catalogId } : {} } });

test("gear identity: the catalog id, so a renamed item keeps working; homebrew items match by name", () => {
  assert.equal(gearId(item("Grandma's Earrings", "gear", "moonstone_earrings")), "moonstone_earrings");
  assert.equal(gearId(item("Rabbit's Paw")), "rabbit_s_paw");
  assert.equal(gearSlug(item("Woad Facepaint", "gear", "woad_facepaint")), "woad-facepaint");
});

test("findGear: by id or prefix, at hand or equipped", () => {
  const actor = { items: [item("My Smudge", "gear", "smudge_lavender", { equipped: false, storage: "ris" }),
    item("Paint", "gear", "woad_facepaint", { storage: "sis" }), item("Woad Facepaint", "ability", "woad_facepaint")] };
  assert.ok(findGear(actor, "smudge", { prefix: true }));
  assert.equal(findGear(actor, "smudge", { prefix: true, where: "equipped" }), null);
  assert.equal(findGear(actor, "woad_facepaint", { where: "hand" }), null); // stored, and the ability doesn't count
  assert.ok(findGear(actor, "woad_facepaint"));
});

test("armor material and shield size: the field, else read from the name", () => {
  assert.equal(inferMaterial("Professional Iron Set"), "iron");
  assert.equal(inferMaterial("Shoddy Dye Set"), "dye");
  assert.equal(inferMaterial("Fancy Clothes"), ""); // "clothes" isn't the Cloth armor type
  assert.equal(inferShieldSize("Heavy Tower Shield"), "tower");
  assert.equal(inferShieldSize("Light Buckler"), "buckler");
  assert.equal(armorMaterial(item("Lucky Coat", "armor", "", { material: "iron" })), "iron");
  assert.equal(armorMaterial(item("Basic Leather Set", "armor")), "leather");
  assert.equal(shieldSize(item("Big Board", "armor", "", { weaponType: "shield", shieldSize: "tower" })), "tower");
  assert.equal(shieldSize(item("Tower Plate", "armor", "", {})), ""); // not a shield
});

test("ownsAbility and opposed", () => {
  const actor = { items: [item("Lodestone", "gear", "lodestone"), item("Blade Aura", "ability", "blade_aura")] };
  assert.ok(ownsAbility(actor, "blade_aura"));
  assert.ok(!ownsAbility(actor, "lodestone"));
  assert.ok(opposed({ disposition: 1 }, { disposition: -1 }));
  assert.ok(!opposed({ disposition: 1 }, { disposition: 0 }));
  assert.ok(!opposed({ document: { disposition: -1 } }, { disposition: -1 }));
});
