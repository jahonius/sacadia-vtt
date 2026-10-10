import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdventures, loadCatalog } from "../src/build-adventures.mjs";
import { maxCspForLevel } from "../module/helpers/derivation.mjs";

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

test("adventure: the prologue's world map carries Indy Route's two routes and where the Nexus site goes", () => {
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
  }
  const road = routes.find((r) => r.id === cfg.road);
  const selthimor = heroes.find((a) => a.name === "Selthimor");
  assert.equal(road.settings.dotTokenUuid, `Actor.${selthimor._id}`, "Selthimor rides the road");
  // Sacadia's speeds (rulebook p.287): five methods × three road types, a 4 km hex; the road's mode is one of them.
  assert.equal(cfg.travelModes.length, 15);
  assert.ok(cfg.travelModes.some((m) => m.id === road.settings.travelMode));
  const foot = cfg.travelModes.find((m) => m.id === "sacadia-foot-dirt-road");
  assert.ok(Math.abs(foot.perDayMiles - 4 * 4 * 0.621371) < 0.01, "on foot, a dirt road: 4 hexes a day");
  // About 140 km from Tianois to the wall (the scale the GM guide states), measured in the scene's own miles.
  const px = road.points.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - road.points[i].x, p.y - road.points[i].y), 0);
  const km = (px / world.grid.size) * world.grid.distance / 0.621371;
  assert.ok(km > 120 && km < 160, `${Math.round(km)} km`);
  const macro = breach.macros.find((m) => m.name === "Prologue: The Road to the Wall");
  assert.match(macro.command, /getFlag\('sacadia', 'prologue'\)/);
  assert.match(macro.command, /createLinkedSceneSite/);
  assert.match(macro.command, /playRoute\(cfg\.road\)/);
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
      for (const part of (i.system.meta?.prerequisite ?? "").split(/,\s*/).filter((x) => x && !/^none$/i.test(x))) {
        const m = /^(Power|Finesse|Wiles|Courage|Fate)\s+(\d+)$/i.exec(part);
        if (m) assert.ok(s.stats[m[1].toLowerCase()].value >= Number(m[2]), `${a.name}: ${i.name} needs ${part}`);
        else if (!/^Level \d+$|Cultural Heritage/.test(part)) assert.ok(owned.has(part.toLowerCase()), `${a.name}: ${i.name} needs ${part}`);
      }
    }
    // One Level 5 Mastery and Rousing Success; the Tianqi cultural talent.
    assert.equal(a.items.filter((i) => i.flags?.sacadia?.mastery).length, 1, `${a.name} mastery`);
    assert.ok(a.items.some((i) => i.flags?.sacadia?.catalogId === "rousing_success"));
    assert.equal(s.identity.culture, "Tianqi");
    assert.equal(s.specialties[0].talent, "religion");
  }
});

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
