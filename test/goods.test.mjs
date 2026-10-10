import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { priceGc, goodsCapacity, castLight, jewelryCheckItems, runeDeltas, runeChosen, runeSummary, bargainPrices } from "../module/helpers/goods.mjs";
import { BARGAIN_TYPES, formatCoins } from "../module/helpers/downtime.mjs";
import { PERSONAL_GOODS, TRINKET_GOODS, HOME_GOODS, PROPERTIES } from "../src/goods.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDocs = (pack) => fs.readdirSync(path.join(ROOT, "src/packs", pack)).filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/packs", pack, f), "utf8")));
const GOODS_PACKS = ["equipment-goods", "equipment-trinkets", "equipment-home"];
const byId = (pack, id) => packDocs(pack).find((d) => d.flags.sacadia.catalogId === id);

test("goods: prices in gold or silver, priced at the world's silver rate", () => {
  const candle = byId("equipment-goods", "candle");
  assert.deepEqual([candle.system.value, candle.system.coin], [1, "sc"]);
  assert.equal(priceGc(candle.system, 100), 0.01);
  assert.equal(formatCoins(priceGc(candle.system, 10), 10), "1sc", "a silver is a silver at any rate");
  assert.equal(formatCoins(priceGc(byId("equipment-goods", "torch").system, 100)), "2sc");
  assert.equal(priceGc(byId("equipment-goods", "boots").system, 100), 30);
  assert.equal(priceGc({ value: 55 }), 55, "armor has no coin: gold");
  assert.equal(byId("equipment-home", "home_home_purchase_wealthy").system.value, 100000);
});

test("goods: every table transcribed, the item ids the system looks for", () => {
  const count = (cats) => cats.reduce((n, c) => n + c.items.length, 0);
  assert.equal(count(PERSONAL_GOODS), 126);
  assert.equal(count(TRINKET_GOODS), 37);
  assert.equal(count(HOME_GOODS), 90);
  for (const id of ["holy_symbol", "offering", "offering_token", "flint_and_tinder", "lantern_oil", "healing_date", "rations", "sandals", "gold_wings"]) {
    assert.ok(byId("equipment-goods", id), id);
  }
  // The trinkets the system already reads by id keep them (Woad Facepaint's initiative, the Saltstone's Check DC …).
  for (const id of ["woad_facepaint", "saltstone", "rabbit_s_paw", "lodestone", "informative_scroll", "ivory_charm", "smudge_lavender", "smudge_sage", "brass_horn"]) {
    assert.ok(byId("equipment-trinkets", id), id);
  }
  for (const pack of GOODS_PACKS) {
    const folders = JSON.parse(fs.readFileSync(path.join(ROOT, "src/packs", pack, "_folders.json"), "utf8"));
    for (const d of packDocs(pack)) assert.ok(folders.some((f) => f._id === d.folder), `${d.name} is in a folder`);
  }
});

test("goods: descriptions carry the item's rules and its properties'", () => {
  const boots = byId("equipment-goods", "boots");
  assert.equal(boots.system.traits, "worn, shoes, winter");
  for (const p of ["Worn", "Shoes", "Winter"]) assert.ok(boots.system.description.includes(PROPERTIES[p][1].slice(0, 40)), p);
  assert.match(boots.system.description, /1 Item Slot · 30gc · Clothing, rulebook p\.198/);
  const torch = byId("equipment-goods", "torch");
  assert.equal(torch.system.weaponType, "bludgeon", "a torch is a club");
  assert.deepEqual([torch.system.weaponDamage.denomination, torch.system.defense], [6, "pd"]);
  assert.match(byId("equipment-goods", "pocket").system.description, /You may only place a Trinket/);
  assert.equal(byId("equipment-goods", "pocket").system.slots, 0, "an add-on takes no slot");
});

test("goods: bags give SIS (only the largest of a kind), readied baggage and pockets give RIS", () => {
  const item = (id, system) => ({ system: { storage: "ris", providesSis: 0, providesRis: 0, ...system }, flags: { sacadia: { goods: byId("equipment-goods", id)?.flags.sacadia.goods ?? {} } } });
  const small = item("backpack_small", { providesSis: 20 });
  const large = item("backpack_large", { providesSis: 60 });
  const jar = item("jar_glass", { providesSis: 3, storage: "sis" });
  const chest = item("simple_chest_small", { providesSis: 4, storage: "sis" });
  const box = item("ornate_box_large", { providesSis: 6, storage: "sis" });
  assert.deepEqual(goodsCapacity([small, large, jar, chest, box]), { sis: 60 + 3 + 6, ris: 0 });
  const bandolier = item("bandolier_small", { providesRis: 3 });
  const stowed = item("bandolier_large", { providesRis: 6, storage: "sis" });
  const pocket = item("pocket", { providesRis: 1 });
  assert.deepEqual(goodsCapacity([bandolier, stowed, pocket]), { sis: 0, ris: 4 }, "a stowed bandolier gives nothing");
});

test("goods: the light cast (p.200): a lantern and its add-on, Shimmering Polish, a glow", () => {
  const goods = (id) => byId("equipment-goods", id).flags.sacadia.goods.light;
  const lantern = goods("lantern");
  assert.deepEqual(castLight([{ light: lantern }]), { bright: 20, dim: 40, angle: 360, glow: false });
  assert.deepEqual(castLight([{ light: lantern, addOn: goods("black_lens") }]), { bright: 10, dim: 20, angle: 360, glow: false });
  assert.deepEqual(castLight([{ light: lantern, addOn: goods("lantern_diffuser") }]), { bright: 0, dim: 50, angle: 360, glow: false });
  assert.deepEqual(castLight([{ light: lantern, addOn: goods("lantern_hood") }]), { bright: 40, dim: 40, angle: 30, glow: false });
  assert.deepEqual(castLight([{ light: goods("torch"), addOn: goods("lantern_hood") }]), { bright: 10, dim: 20, angle: 360, glow: false }, "only a lantern takes an add-on");
  assert.deepEqual(castLight([{ light: goods("candle") }], { polish: true }), { bright: 5, dim: 10, angle: 360, glow: false });
  assert.deepEqual(castLight([{ light: goods("candle") }, { light: goods("torch") }]).dim, 20, "the brightest source");
  assert.deepEqual(castLight([], { glow: { bright: 5, dim: 5 } }), { bright: 5, dim: 5, angle: 360, glow: true });
  assert.equal(castLight([]), null);
});

test("goods: jewelry guards against its condition, worn", () => {
  const amber = byId("equipment-trinkets", "amber_jewelry");
  assert.equal(amber.flags.sacadia.goods.jewelry, "nausea");
  const worn = jewelryCheckItems([amber, { ...amber, name: "Stowed", system: { ...amber.system, storage: "sis" } }]);
  assert.equal(worn.length, 1);
  assert.deepEqual(worn[0].modifiers[0].predicate, [{ atom: "self:checking:nausea" }]);
  assert.equal(worn[0].modifiers[0].target, "resistAdvantage");
  const keys = packDocs("equipment-trinkets").filter((d) => d.flags.sacadia.goods.jewelry).map((d) => d.flags.sacadia.goods.jewelry);
  assert.equal(new Set(keys).size, 14, "fourteen conditions");
});

test("goods: a rune's changes, as chosen when bought (p.209)", () => {
  const rune = (id) => byId("equipment-trinkets", id).flags.sacadia.goods.rune;
  assert.deepEqual(runeDeltas(rune("moon_rune"), { plus: ["pd"] }), { ad: -2, pd: 3, td: 0, md: 0, dr: 0 });
  assert.deepEqual(runeDeltas(rune("moon_rune"), {}), { ad: -2, pd: 0, td: 0, md: 0, dr: 0 }, "the fixed part alone until chosen");
  assert.ok(!runeChosen(rune("moon_rune"), {}));
  assert.ok(runeChosen(rune("moon_rune"), { plus: { 0: "md" } }), "a form's index-keyed choice");
  const greater = rune("solar_rune_greater");
  assert.deepEqual(runeDeltas(greater, { minus: ["ad", "ad", "dr"], plus: ["pd", "pd", "md"] }), { ad: -2, pd: 1, td: 0, md: 1, dr: -1 },
    "the −1s may repeat, the +1s must differ");
  assert.deepEqual(runeDeltas(rune("lunar_eclipse_rune"), { minus: ["ad"], plus: ["dr"] }), { ad: 0, pd: 0, td: 0, md: 0, dr: 2 }, "AD isn't a Lunar Eclipse choice");
  assert.equal(runeSummary({ ad: -2, pd: 3, td: 0, md: 0, dr: 0 }), "AD −2 · PD +3");
});

test("goods: Shop for Bargains rolls real items, and its deals", () => {
  const docs = fs.readdirSync(path.join(ROOT, "src/packs")).filter((p) => !["adventures", "user-manual", "cultures-journal"].includes(p)).flatMap(packDocs);
  const tables = {};
  for (const d of docs) if (d.flags?.sacadia?.bargain) tables[d.flags.sacadia.bargain] = (tables[d.flags.sacadia.bargain] ?? 0) + 1;
  for (const t of BARGAIN_TYPES.filter((b) => b.table)) assert.ok(tables[t.table] > 0, `${t.name} has items`);
  // Where v1.2's table matches the printed die row for row.
  const exact = { illumination: 7, travel: 10, literary: 9, mounts: 13, "crafting-kits": 4, homes: 12, cooking: 10, shields: 12,
    "basic-weapons": 10, "military-weapons": 10, "imbued-weapons": 8 };
  for (const [t, die] of Object.entries(exact)) {
    assert.equal(tables[t], die, t);
    assert.equal(BARGAIN_TYPES.find((b) => b.table === t).die, die, `${t}'s printed die`);
  }
  assert.ok(!docs.some((d) => d.flags.sacadia.inheritance && d.flags.sacadia.bargain), "no inheritance on a market table");
  assert.deepEqual(bargainPrices(30, 20), { sale: 24, buy: 18 });
});

test("goods: the compendiums' images exist", { skip: !fs.existsSync(path.join(os.homedir(), ".foundryvtt/public/icons")) }, () => {
  for (const pack of GOODS_PACKS) {
    for (const d of packDocs(pack)) assert.ok(fs.existsSync(path.join(os.homedir(), ".foundryvtt/public", d.img)), `${d.name}: ${d.img}`);
  }
});
