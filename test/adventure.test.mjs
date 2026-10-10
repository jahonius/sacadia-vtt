import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdventures, loadCatalog } from "../src/build-adventures.mjs";
import { maxCspForLevel, originMatch } from "../module/helpers/derivation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [breach] = (await buildAdventures({ catalog: loadCatalog() })).filter((a) => a.name === "The Breach");
const STATS = ["power", "finesse", "wiles", "courage", "fate"];
const heroes = breach.actors.filter((a) => a.type === "character");

test("adventure: The Breach builds, with unique ids in every collection", () => {
  assert.ok(breach, "The Breach is built");
  for (const key of ["actors", "items", "journal", "scenes", "tables", "folders"]) {
    const ids = breach[key].map((d) => d._id);
    assert.equal(new Set(ids).size, ids.length, key);
    for (const id of ids) assert.match(id, /^[a-f0-9]{16}$/, `${key} id`);
  }
  for (const a of breach.actors) {
    const ids = a.items.map((i) => i._id);
    assert.equal(new Set(ids).size, ids.length, `${a.name} item ids`);
  }
  assert.equal(heroes.length, 4);
});

test("adventure: folders, tokens, notes, table results and regions point at documents that exist", () => {
  const folders = new Set(breach.folders.map((f) => f._id));
  for (const d of [...breach.actors, ...breach.items, ...breach.journal, ...breach.scenes, ...breach.tables]) {
    if (d.folder) assert.ok(folders.has(d.folder), `${d.name} folder`);
  }
  const actors = new Set(breach.actors.map((a) => a._id));
  const scene = breach.scenes.find((s) => s.flags.sacadia.breach);
  for (const t of scene.tokens) assert.ok(actors.has(t.actorId), `token ${t.name}`);
  const pages = new Set(breach.journal.flatMap((j) => j.pages.map((p) => `${j._id}.${p._id}`)));
  for (const s of breach.scenes) {
    for (const n of s.notes) assert.ok(pages.has(`${n.entryId}.${n.pageId}`), `${s.name}: note ${n.text}`);
    if (s.journal) assert.ok(pages.has(`${s.journal}.${s.journalEntryPage}`), `${s.name}: its journal page`);
  }
  for (const r of breach.tables[0].results) assert.ok(actors.has(r.documentUuid.split(".")[1]), r.name);
  const tokens = new Set(scene.tokens.map((t) => `Scene.${scene._id}.Token.${t._id}`));
  for (const r of scene.regions) {
    for (const b of r.behaviors.filter((x) => x.type === "zone")) {
      assert.ok(actors.has(b.system.casterUuid.split(".")[1]), `${r.name} caster`);
      assert.ok(tokens.has(b.system.casterTokenUuid), `${r.name} caster token`);
    }
  }
});

test("adventure: Chuni's Wall is a two-level scene with walls on each level", () => {
  const scene = breach.scenes.find((s) => s.flags.sacadia.breach);
  const levels = new Set(scene.levels.map((l) => l._id));
  assert.equal(levels.size, 2);
  assert.ok(levels.has(scene.initialLevel));
  for (const t of scene.tokens) assert.ok(levels.has(t.level), `${t.name} is on a level`);
  // An empty `levels` means every level, so each wall and region names its own.
  for (const w of scene.walls) {
    assert.equal(w.levels.length, 1, "a wall belongs to one level");
    assert.ok(levels.has(w.levels[0]));
    assert.equal(w.c.length, 4);
    assert.ok(w.c.every(Number.isInteger));
  }
  for (const r of scene.regions) assert.ok(r.levels.length && r.levels.every((l) => levels.has(l)), `${r.name} names its levels`);
  for (const r of scene.regions.filter((x) => x.behaviors.some((b) => b.type === "changeLevel"))) assert.equal(r.levels.length, 2, r.name);
  const doors = scene.walls.filter((w) => w.door);
  assert.equal(doors.length, 1, "the front gate");
  assert.equal(doors[0].ds, 2, "locked");
  assert.ok(scene.walls.filter((w) => w.flags?.sacadia?.breach).length > 20, "the wall's faces can be breached");
  const flags = scene.flags.sacadia.breach;
  assert.ok(levels.has(flags.ground) && levels.has(flags.top));
  assert.match(breach.macros.find((m) => m.name === "Breach Chuni's Wall").command, /getFlag\('sacadia', 'breach'\)/);
});

test("adventure: the prologue's world map: the planned road, the party at Tianqis, the ledger's journey, and what Nexus files", () => {
  const world = breach.scenes.find((s) => s.flags.sacadia.prologue);
  assert.equal(world.levels.length, 1);
  assert.equal(world.initialLevel, world.levels[0]._id);
  assert.match(world.levels[0].background.src, /ardus-yauga\.webp$/);
  assert.equal(world.padding, 0, "map pixels are canvas coordinates");
  const inside = ({ x, y }) => x >= 0 && y >= 0 && x <= world.width && y <= world.height;
  const cfg = world.flags.sacadia.prologue;
  assert.ok(inside(cfg.site), "the site is on the map");
  const routes = world.flags["indy-route"].routes;
  assert.deepEqual(routes.map((r) => r.id).sort(), [cfg.road, cfg.smoke].sort());
  for (const r of routes) {
    assert.ok(r.name && r.points.length >= 2 && r.points.every(inside), r.name);
    assert.equal(r.settings.scaleWithMap, false, `${r.name}: the same line at every zoom`);
    // Indy Route draws over the canvas, not the scene: a line that never fades stays up over the next scene.
    assert.ok(r.settings.lingerMs > 0, `${r.name} fades`);
  }
  // The party: a token of its own (no hero's conditions on the map) at the road's start, and the Travel Ledger's journey.
  const road = routes.find((r) => r.id === cfg.road);
  const [party] = world.tokens;
  assert.equal(party.name, "The Party");
  assert.equal(party.actorId, null);
  assert.equal(party.level, world.levels[0]._id);
  const center = { x: party.x + (party.width * world.grid.size) / 2, y: party.y + (party.height * world.grid.size) / 2 };
  assert.ok(Math.hypot(center.x - road.points[0].x, center.y - road.points[0].y) < 1, "at Tianqis");
  const travel = world.flags.sacadia.travel;
  assert.equal(travel.routeId, road.id);
  assert.equal(travel.tokenId, party._id);
  assert.ok(travel.food + travel.water <= 5, "what a traveller on foot carries");
  // About 140 km from Tianqis to the wall (the scale the GM guide states): 35 hexes.
  const px = road.points.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - road.points[i].x, p.y - road.points[i].y), 0);
  const km = (px / world.grid.size) * world.grid.distance / 0.621371;
  assert.ok(km > 120 && km < 160, `${Math.round(km)} km`);
  // What the macro files in Nexus: every person's actor exists, and every link names a faction, person or objective.
  const { factions, people, quest } = cfg.nexus;
  const actorIds = new Set(breach.actors.map((a) => `Actor.${a._id}`));
  for (const p of people) {
    if (p.actorUuid) assert.ok(actorIds.has(p.actorUuid), `${p.name}'s actor`);
    assert.ok(factions.some((f) => f.key === p.faction), `${p.name}'s organization`);
    assert.ok(p.html, `${p.name}'s page`);
  }
  assert.ok(people.find((p) => p.key === "ager").leader, "Ager leads his demons");
  assert.ok(people.find((p) => p.key === "monarch").leader, "the Monarch leads the Tianqi");
  for (const name of ["Wanabbul the Vast", "Grubnut", "Csenorras the Manyworm"]) assert.ok(people.some((p) => p.name === name), name);
  const keys = new Set([...factions, ...people].map((x) => x.key));
  for (const [slot, goal, target] of quest.links) {
    assert.ok(keys.has(target), `${slot}: ${target}`);
    if (goal) assert.ok(quest.objectives.some((o) => o.key === goal), `${slot}: objective ${goal}`);
  }
  const prologue = breach.macros.find((m) => m.name === "Prologue: The Ardus Yauga");
  for (const call of ["createLinkedSceneSite", "createFaction", "createNpc", "createQuest", "connectQuestEntity"]) assert.match(prologue.command, new RegExp(call));
  assert.match(breach.macros.find((m) => m.name === "Travel Ledger").command, /game\.sacadia\.travelLedger/);
  assert.doesNotMatch(JSON.stringify(breach), /Tianois/, "the port is Tianqis");
});

test("adventure: every system asset it references ships with the system", () => {
  const text = JSON.stringify(breach);
  const paths = new Set([...text.matchAll(/systems\/sacadia\/([\w./-]+\.\w+)/g)].map((m) => m[1]));
  assert.ok(paths.size > 10);
  for (const p of paths) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
});

test("adventure: journal links all resolve to @UUID links", () => {
  for (const j of breach.journal) {
    for (const p of j.pages) assert.doesNotMatch(p.text.content, /\{\{/, `${j.name} / ${p.name}`);
  }
  const uuids = breach.journal.flatMap((j) => j.pages.flatMap((p) => [...p.text.content.matchAll(/@UUID\[([^\]]+)\]/g)].map((m) => m[1])));
  const actors = new Set(breach.actors.map((a) => a._id));
  for (const u of uuids.filter((x) => x.startsWith("Actor."))) assert.ok(actors.has(u.split(".")[1]), u);
});

test("adventure: the pregens are legal level-5 v1.2 characters", () => {
  for (const a of heroes) {
    const s = a.system;
    assert.equal(s.level, 5);
    const traits = STATS.map((k) => s.stats[k].value);
    assert.equal(traits.reduce((x, y) => x + y, 0), 6, `${a.name}: 3 Trait Points at levels 1 and 3`);
    assert.ok(Math.max(...traits) <= 2, `${a.name}: no Trait above 2 before level 6`);
    // CSP: owned abilities' costs (an ability taken twice, like Manchuthara's Bigger Stones, is two items).
    const csp = a.items.filter((i) => i.type === "ability").reduce((t, i) => t + (i.system.costs?.csp ?? 0), 0);
    assert.equal(csp, maxCspForLevel(5), `${a.name} spends exactly the level-5 budget`);
    // Prerequisites: Trait minimums and required abilities (the Tianqi culture prerequisite is the culture itself).
    const owned = new Set(a.items.map((i) => i.name.toLowerCase()));
    for (const i of a.items.filter((x) => x.type === "ability")) {
      for (const part of (i.system.meta?.prerequisite ?? "").split(/,\s*|\s*·\s*/).filter((x) => x && !/^none$/i.test(x) && !/^p\.\d+$/.test(x))) {
        const m = /^(Power|Finesse|Wiles|Courage|Fate)\s+(\d+)$/i.exec(part);
        const origin = originMatch(part.toLowerCase(), originOf(a));
        if (m) assert.ok(s.stats[m[1].toLowerCase()].value >= Number(m[2]), `${a.name}: ${i.name} needs ${part}`);
        else if (origin !== null) assert.ok(origin, `${a.name}: ${i.name} needs ${part}`);
        else if (!/^Level \d+$/.test(part)) assert.ok(owned.has(part.toLowerCase()), `${a.name}: ${i.name} needs ${part}`);
      }
    }
    // One Level 5 Mastery and Rousing Success; the Tianqi cultural talent.
    assert.equal(a.items.filter((i) => i.flags?.sacadia?.mastery).length, 1, `${a.name} mastery`);
    assert.ok(a.items.some((i) => i.flags?.sacadia?.catalogId === "rousing_success"));
    assert.equal(s.identity.culture, "Tianqi");
    // The Tianqi culture item and an ancestry of the hero's Heritage, and what they grant (rules/identity.mjs).
    const culture = a.items.filter((i) => i.type === "culture");
    const ancestry = a.items.filter((i) => i.type === "ancestry");
    assert.deepEqual(culture.map((i) => i.flags.sacadia.catalogId), ["culture_tianqi"], `${a.name}: the Tianqi culture`);
    assert.equal(ancestry.length, 1, `${a.name}: one ancestry`);
    assert.equal(ancestry[0].system.heritage, s.identity.heritage, `${a.name}: an ancestry of their Heritage`);
    assert.equal(s.identity.ancestry, ancestry[0].name);
    const granted = a.items.filter((i) => i.flags?.sacadia?.identityGrant).map((i) => i.flags.sacadia.catalogId);
    for (const id of ["tianqi_heibrim_lore", "tianqi_old_bushiu"]) assert.ok(granted.includes(id), `${a.name}: ${id}`);
    assert.equal(s.specialties[0].talent, "religion");
    assert.equal(s.specialties[0].source, "tianqi_heibrim_lore", "Heibrim Lore's rank");
    // The Heritage's HP is derived (no adjustment), and the old adjustment is never taken back out again.
    assert.equal(s.health.bonus, 0);
    assert.equal(a.flags.sacadia.heritageHpMoved, true);
  }
});

/** The origin context the prerequisite checker reads (rules/identity.mjs originContext), from built actor data. */
function originOf(a) {
  const culture = a.items.find((i) => i.type === "culture");
  const ancestry = a.items.find((i) => i.type === "ancestry");
  const names = { human: "human", curiot: "curiot", daemonai: "daemonai", fixerfolk: "fixerfolk", fontborne: "fontborne", hulinari: "hulinari" };
  return { cultures: [culture.name.toLowerCase(), ...culture.system.aliases.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)],
    subcultures: culture.system.subcultures.map((x) => x.toLowerCase()), subculture: culture.system.subculture.toLowerCase(),
    ancestry: ancestry.name.toLowerCase(), heritage: a.system.identity.heritage, heritageNames: names, heritageChoice: a.system.identity.heritageChoice ?? "" };
}

test("adventure: Manchuthara's Favored Enemy and Bigger Stones are picks on the abilities", () => {
  const m = heroes.find((a) => a.name === "Manchuthara");
  const picks = (id) => m.items.filter((i) => i.flags.sacadia.catalogId === id).map((i) => i.flags.sacadia.pickValue);
  assert.deepEqual(picks("favored_enemy"), ["demon"]);
  assert.deepEqual(picks("bigger_stones"), ["crossbow", "crossbow"]); // taken twice, both on the crossbow
  assert.equal(m.system.professionResources?.sentinel, undefined);
});

test("adventure: each weapon arrives with its generated attack, bound to it", () => {
  for (const a of heroes) {
    const weapons = a.items.filter((i) => i.system?.weaponType);
    assert.ok(weapons.length, `${a.name} has a weapon`);
    for (const w of weapons) {
      const attacks = a.items.filter((i) => i.flags?.sacadia?.weaponAttack === w._id);
      assert.ok(attacks.some((i) => !i.flags.sacadia.thrown), `${a.name}: ${w.name} attack`);
      assert.equal(attacks.some((i) => i.flags.sacadia.thrown), /\bversatile\b/.test(w.system.traits), `${a.name}: ${w.name} throw`);
    }
  }
  const chunrudar = heroes.find((a) => a.name === "Chunrudar");
  const sword = chunrudar.items.find((i) => i.name === "Greatsword");
  assert.equal(sword.flags.sacadia.signature, true, "the divine weapon");
  assert.match(sword.system.traits, /\bheavy\b/, "Heavy Weapons Mastery reads the heavy trait");
});

test("adventure: NPC attacks reach their stat-block to-hit through a scoped modifier", () => {
  const wanabbul = breach.actors.find((a) => a.name === "Wanabbul the Vast");
  const bite = wanabbul.items.find((i) => i.name === "Bite");
  const mod = bite.system.modifiers.find((m) => m.target === "toHit");
  assert.equal(mod.scope, bite.flags.sacadia.catalogId);
  assert.equal(wanabbul.system.stats.power.value + Number(mod.value), 12);
  assert.equal(wanabbul.system.speed, 20);
  assert.equal(wanabbul.system.size, "gigantic");
  assert.equal(wanabbul.prototypeToken.width, 5);
});
