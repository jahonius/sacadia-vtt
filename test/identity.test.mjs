import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { originGrants, heritageOwes, reconcileSpecialties } from "../module/rules/identity.mjs";
import { originMatch, checkPrerequisites } from "../module/helpers/derivation.mjs";
import { CULTURES } from "../src/identity/cultures.mjs";
import { HERITAGE_ABILITIES, ANCESTRIES } from "../src/identity/heritages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDocs = (pack) => fs.readdirSync(path.join(ROOT, "src/packs", pack)).filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/packs", pack, f), "utf8")));
const HERITAGE_KEYS = ["human", "curiot", "daemonai", "fixerfolk", "fontborne", "hulinari"];

test("identity: an origin grants what's tied to no option, or to the one taken", () => {
  const culture = { type: "culture", system: { choice: "farmer", grants: [{ uuid: "A", option: "" }, { uuid: "B", option: "farmer" }, { uuid: "C", option: "marble" }] } };
  assert.deepEqual(originGrants(culture), ["A", "B"]);
  // An ancestry's grant follows the Heritage's choice (a Fontborne ancestry's Lightly / Heavily Warped ability).
  const ancestry = { type: "ancestry", system: { choice: "", grants: [{ uuid: "L", option: "light" }, { uuid: "H", option: "heavy" }] } };
  assert.deepEqual(originGrants(ancestry, "heavy"), ["H"]);
  assert.deepEqual(originGrants(ancestry, ""), []);
  // A culture never reads the Heritage's choice.
  assert.deepEqual(originGrants({ type: "culture", system: { choice: "", grants: [{ uuid: "L", option: "light" }] } }, "light"), []);
});

test("identity: a heritage ability is owed for its Heritage, and a choice's only when taken", () => {
  const charisma = { flags: { sacadia: { heritage: "daemonai" } } };
  const intuit = { flags: { sacadia: { heritage: "daemonai", heritageChoice: "intuit" } } };
  assert.ok(heritageOwes(charisma, "daemonai", ""));
  assert.ok(!heritageOwes(charisma, "human", ""));
  assert.ok(!heritageOwes(intuit, "daemonai", "speak"));
  assert.ok(heritageOwes(intuit, "daemonai", "intuit"));
});

test("identity: a cultural talent's specialty rank is added, stacks with the player's, and is given back", () => {
  const owed = [{ source: "tianqi_heibrim_lore", name: "Demon Lore", talent: "religion" }];
  // A new row …
  assert.deepEqual(reconcileSpecialties([], owed), [{ name: "Demon Lore", talent: "religion", rank: 1, source: "tianqi_heibrim_lore" }]);
  // … or the player's own row for it, its rank stacking.
  const mine = [{ name: "Demon Lore (Heibrim Lore)", talent: "religion", rank: 2 }];
  assert.deepEqual(reconcileSpecialties(mine, owed), [{ name: "Demon Lore (Heibrim Lore)", talent: "religion", rank: 3, source: "tianqi_heibrim_lore" }]);
  // Nothing changes when it's already there.
  assert.equal(reconcileSpecialties([{ name: "Demon Lore", talent: "religion", rank: 1, source: "tianqi_heibrim_lore" }], owed), null);
  // Losing the culture takes the granted rank back: the row goes, or stays as the player's own.
  assert.deepEqual(reconcileSpecialties([{ name: "Demon Lore", talent: "religion", rank: 1, source: "tianqi_heibrim_lore" }], []), []);
  assert.deepEqual(reconcileSpecialties([{ name: "Demon Lore", talent: "religion", rank: 3, source: "tianqi_heibrim_lore" }], []),
    [{ name: "Demon Lore", talent: "religion", rank: 2, source: "" }]);
});

test("identity: prerequisites about culture, subculture, ancestry and Heritage", () => {
  const heritageNames = Object.fromEntries(HERITAGE_KEYS.map((k) => [k, k]));
  const cunei = { cultures: ["cunei myrgha", "cunei"], subcultures: ["white cunei", "black cunei"], subculture: "white cunei",
    ancestry: "marblekin", heritage: "fixerfolk", heritageNames, heritageChoice: "" };
  assert.equal(originMatch("cunei cultural heritage", cunei), true);
  assert.equal(originMatch("cunei myrgha cultural heritage", cunei), true);
  assert.equal(originMatch("tianqi cultural heritage", cunei), false);
  assert.equal(originMatch("white cunei subculture", cunei), true);
  assert.equal(originMatch("black cunei subculture", cunei), false);
  assert.equal(originMatch("white cunei myrgha", cunei), true);
  assert.equal(originMatch("marblekin fixerfolk ancestry", cunei), true);
  assert.equal(originMatch("withered human ancestry", cunei), false);
  assert.equal(originMatch("fixerfolk heritage", cunei), true);
  assert.equal(originMatch("human", cunei), false);
  assert.equal(originMatch("a nature fixerfolk ancestry", cunei), null, "the table's call");
  assert.equal(originMatch("power 3", cunei), null);
  const warped = { ...cunei, heritage: "fontborne", heritageChoice: "heavy" };
  assert.equal(originMatch("heavily corrupted fontborne heritage", warped), true);
  assert.equal(originMatch("weakly corrupted fontborne heritage", warped), false);
  // A culture's profession ("Tianqi Oracle"), through the checker.
  const tianqi = { ...cunei, cultures: ["tianqi"], subcultures: [], subculture: "" };
  const ctx = (professions) => ({ origin: tianqi, professions, professionNames: ["oracle", "soldier"], stats: {}, abilities: new Set() });
  assert.deepEqual(checkPrerequisites("Tianqi Oracle", ctx(["oracle"])).unmet, []);
  assert.deepEqual(checkPrerequisites("Tianqi Oracle", ctx(["soldier"])).unmet, ["Tianqi Oracle"]);
  assert.deepEqual(checkPrerequisites("Myrgha Oracle", ctx(["oracle"])).unmet, ["Myrgha Oracle"]);
});

test("identity: every Heritage has its abilities, and every ancestry a Heritage and something to grant", () => {
  for (const k of HERITAGE_KEYS) assert.ok(HERITAGE_ABILITIES.some((a) => a.heritage === k && !a.choice), `${k} has an ability`);
  for (const a of [...ANCESTRIES, ...CULTURES.flatMap((c) => c.ancestries)]) {
    assert.ok(HERITAGE_KEYS.includes(a.heritage), a.name);
    assert.ok((a.grants ?? a.abilities ?? []).length, `${a.name} grants something`);
  }
});

test("identity: the five starter cultures are complete", () => {
  assert.deepEqual(CULTURES.map((c) => c.name), ["Myrgha", "Cunei Myrgha", "Olganyar", "Tianqi", "Kishai"]);
  for (const c of CULTURES) {
    assert.ok(c.laws.length >= 4, `${c.name} laws`);
    assert.ok(c.talents.length && c.language?.id, `${c.name} talent and language`);
    assert.ok(c.inheritance.length >= 14, `${c.name} inheritance`);
    for (const o of c.options) assert.ok(c.talents.some((t) => t.id === o.grant), `${c.name} option ${o.key}`);
    assert.match(c.markdown, /^# Cultural Tapestry$/m, `${c.name} tapestry`);
    for (const e of c.inheritance) {
      assert.ok(["business", "craft", "traded", "ingredient"].includes(e.section), `${e.name} section`);
      assert.ok(e.description && e.rarity !== undefined, e.name);
      assert.doesNotMatch(JSON.stringify(e), /�|\bY ou\b|\bT he\b|Stats$/, `${e.name}: extraction artifacts`);
    }
  }
});

test("identity: the built packs' grants and journal links all resolve", () => {
  const ids = new Map(); // pack → Set of document ids
  for (const pack of ["heritages", "cultures", "abilities-lore"]) ids.set(pack, new Set(packDocs(pack).map((d) => d._id)));
  const journal = packDocs("cultures-journal");
  ids.set("cultures-journal", new Set(journal.map((e) => e._id)));
  const resolves = (uuid) => {
    const m = /^Compendium\.sacadia\.([\w-]+)\.(?:Item|JournalEntry)\.(\w{16})$/.exec(uuid);
    return !!m && !!ids.get(m[1])?.has(m[2]);
  };
  const origins = [...packDocs("heritages"), ...packDocs("cultures")].filter((d) => ["culture", "ancestry"].includes(d.type));
  assert.equal(origins.filter((d) => d.type === "culture").length, 5);
  for (const o of origins) {
    assert.ok(o.system.grants.length, `${o.name} grants`);
    for (const g of o.system.grants) assert.ok(resolves(g.uuid), `${o.name}: ${g.uuid}`);
    if (o.type === "culture") assert.ok(resolves(o.system.journal), `${o.name} journal`);
  }
  const links = [...origins, ...packDocs("cultures")].flatMap((d) => [...String(d.system.description).matchAll(/@UUID\[([^\]]+)\]/g)].map((m) => m[1]))
    .concat(journal.flatMap((e) => e.pages.flatMap((p) => [...p.text.content.matchAll(/@UUID\[([^\]]+)\]/g)].map((m) => m[1]))));
  assert.ok(links.length > 100);
  for (const l of links) assert.ok(resolves(l), l);
  // Every heritage ability names its Heritage; the ones that go with a choice name a choice of that Heritage.
  const choices = { daemonai: ["intuit", "speak"], fontborne: ["light", "heavy"] };
  for (const d of packDocs("heritages").filter((x) => x.type === "ability" && x.flags.sacadia.heritage)) {
    const c = d.flags.sacadia.heritageChoice;
    if (c) assert.ok(choices[d.flags.sacadia.heritage]?.includes(c), d.name);
  }
});

test("identity: the new compendiums' images exist", { skip: !fs.existsSync(path.join(os.homedir(), ".foundryvtt/public/icons")) }, () => {
  for (const pack of ["heritages", "cultures"]) {
    for (const d of packDocs(pack)) {
      const file = d.img.startsWith("systems/sacadia/") ? path.join(ROOT, d.img.slice("systems/sacadia/".length)) : path.join(os.homedir(), ".foundryvtt/public", d.img);
      assert.ok(fs.existsSync(file), `${d.name}: ${d.img}`);
    }
  }
});
