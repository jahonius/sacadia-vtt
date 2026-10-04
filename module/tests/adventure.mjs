/**
 * The Adventure compendium (`sacadia.adventures`): import The Breach into the test world and check what a GM gets —
 * the pregens' derived numbers, the demons, the scene with its Regions (the pit trap springs), and attacks rolling the
 * stat-block numbers. Everything imported is deleted afterwards.
 */
import { until, settle, stubDialogs, autoAnswer, fixture, target, recordErrors, sleep } from './support.mjs';
import { staleItems } from '../helpers/refresh.mjs';
import { conditionImmune } from '../helpers/conditions.mjs';
import { resetActionEconomy } from '../rules/turn.mjs';

/** The to-hit roll (the one with a d20) and the damage roll on an attack card. */
function cardRolls(message) {
  const rolls = message.rolls ?? [];
  const d20 = (r) => r.dice.some((d) => d.faces === 20);
  return { toHit: rolls.find(d20), damage: rolls.find((r) => !d20(r)) };
}
/** A roll's flat part: its total less its dice. */
const flat = (roll) => roll.total - roll.dice.reduce((t, d) => t + d.total, 0);

/** Save a screenshot when the runner was started with QUENCH_SCREENSHOTS (the Quench window tucked away meanwhile). */
async function shot(name) {
  if (!window.__quenchScreenshot) return;
  const app = globalThis.quench?.app;
  const pos = app?.position ? { ...app.position } : null;
  app?.setPosition?.({ left: window.innerWidth - 260, top: window.innerHeight - 120, width: 250, height: 110 });
  await sleep(900);
  await window.__quenchScreenshot(name);
  if (pos) app.setPosition(pos);
}

export function registerAdventure(quench) {
  quench.registerBatch('sacadia.adventure', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('The Breach (Adventure compendium)', function () {
      this.timeout(90000);
      const fx = fixture();
      let adventure, created, scene, stub, errors;
      const actor = (name) => game.actors.find((a) => a.name === name && created.Actor.some((c) => c.id === a.id));
      const tokenOf = (name) => scene.tokens.find((t) => t.name === name);
      // Map pixels → canvas coordinates (the scene's padding offsets the map), and a scripted move that ignores walls
      // (v14 constrains even a GM's token update by the walls in its path).
      const at = (x, y) => ({ x: scene.dimensions.sceneX + x, y: scene.dimensions.sceneY + y });
      const moveTo = (t, x, y, extra = {}) => t.move([{ ...at(x, y), ...extra }], { constrainOptions: { ignoreWalls: true, ignoreCost: true } });
      // A move the way a player drags one: the walls apply.
      const walk = (t, x, y) => t.move([at(x, y)], { constrainOptions: { ignoreCost: true } });
      // Walk there and wait to arrive: a move resolves while the token is still on its way (it's split where it crosses
      // a Region), so this waits for its position.
      const walkTo = async (t, x, y, what) => {
        const to = at(x, y);
        await walk(t, x, y);
        await until(() => t.x === to.x && t.y === to.y, { timeout: 10000, what })
          .catch(() => assert.fail(`${what}: stopped at ${t.x - scene.dimensions.sceneX},${t.y - scene.dimensions.sceneY}`));
      };
      // A Change Level: Foundry follows the token to its new level by redrawing the canvas, and a move made during the
      // redraw is cut short. Call this before the move that changes level, and await what it returns after.
      const levelChange = (t, level) => {
        const redrawn = new Promise((resolve) => Hooks.once('canvasReady', resolve));
        return async () => {
          await Promise.race([redrawn, sleep(15000)]);
          await until(() => t.level === level.id && canvas.level?.id === level.id && canvas.ready && !canvas.loading && canvas.tokens.get(t.id),
            { timeout: 15000, step: 200, what: `${t.name} on the ${level.name} level` });
        };
      };
      // View a level and wait for the canvas to redraw with every token on it.
      const viewLevel = async (level) => {
        const missing = () => scene.tokens.filter((t) => !canvas.tokens.get(t.id)).map((t) => `${t.name}@${t.level === level.id ? 'here' : 'other'}`);
        try {
          // Scene#view does nothing while the canvas is still loading (a level change from a move may be drawing): retry.
          await until(async () => {
            if (canvas.ready && !canvas.loading && canvas.level?.id !== level.id) await scene.view({ level: level.id });
            return canvas.ready && canvas.level?.id === level.id && !missing().length;
          }, { timeout: 20000, step: 200, what: 'the canvas' });
        } catch {
          throw new Error(`the ${level.name} level never finished drawing: view ${canvas.level?.id === level.id}, ready ${canvas.ready}, missing ${missing().join(', ')}`);
        }
      };

      before(async () => {
        fx.start();
        errors = recordErrors();
        stub = stubDialogs(autoAnswer);
        const pack = game.packs.get('sacadia.adventures');
        const entry = (await pack.getIndex()).find((e) => e.name === 'The Breach');
        adventure = await pack.getDocument(entry._id);
        // Track folders first so cleanup (which goes in reverse) removes their contents before them.
        ({ created } = await adventure.import({ dialog: false }));
        for (const d of created.Folder ?? []) fx.track(d);
        for (const [name, docs] of Object.entries(created)) if (name !== 'Folder') docs.forEach((d) => fx.track(d));
        scene = created.Scene[0];
      });
      after(async () => {
        stub?.restore();
        errors?.stop();
        for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
        await fx.cleanup();
      });

      it('imports every document it holds, keeping their ids', async () => {
        for (const [field, name] of [['actors', 'Actor'], ['items', 'Item'], ['journal', 'JournalEntry'], ['scenes', 'Scene'], ['tables', 'RollTable'], ['macros', 'Macro'], ['combats', 'Combat'], ['folders', 'Folder']]) {
          assert.equal(created[name]?.length ?? 0, adventure[field].size, field);
        }
        for (const a of adventure.actors) assert.ok(game.actors.get(a._id), `${a.name} keeps its id`);
        assert.deepEqual(errors.errors, []);
      });

      it('the pregens derive their v1.2 numbers', async () => {
        const expect = {
          Selthimor: { hp: 61, pd: 16, speed: 30 },
          Chunrudar: { hp: 55, pd: 16, speed: 30 },
          Honnasusara: { hp: 65, pd: 24, md: 12, speed: 25, pool: ['call', 6] },
          Manchuthara: { hp: 50, pd: 11, ad: 15, speed: 30, pool: ['trickshot', 6] },
        };
        for (const [name, e] of Object.entries(expect)) {
          const s = actor(name).system;
          assert.equal(s.health.max, e.hp, `${name} HP`);
          assert.equal(s.health.value, e.hp, `${name} starts at full HP`);
          assert.equal(s.defenses.pd.value, e.pd, `${name} PD`);
          if (e.ad) assert.equal(s.defenses.ad.value, e.ad, `${name} AD`);
          if (e.md) assert.equal(s.defenses.md.value, e.md, `${name} MD`);
          assert.equal(s.itemSlots.overburdened, false, `${name} fits in their item slots`);
          assert.equal(s.speed.value, e.speed, `${name} speed`);
          assert.equal(s.checkDc.primary, 15, `${name} Check DC`);
          assert.equal(s.ap.max, 3, `${name} AP`);
          assert.equal(s.lorePoints.max, 1, `${name} Lore`);
          assert.equal(s.csp.spent, 34, `${name} CSP spent`);
          assert.equal(s.csp.max, 34, `${name} CSP budget`);
          if (e.pool) assert.equal(s.classPools[e.pool[0]].max, e.pool[1], `${name} ${e.pool[0]} pool`);
        }
      });

      it('the pregens get the basic actions on import, and their compendium items are current', async () => {
        for (const name of ['Selthimor', 'Chunrudar', 'Honnasusara', 'Manchuthara']) {
          const a = actor(name);
          await until(() => a.items.some((i) => i.flags?.sacadia?.catalogId === 'basic_block'), { what: `${name}'s basic actions` });
          assert.deepEqual((await staleItems(a)).map((i) => i.name), [], `${name} has no out-of-date items`);
        }
      });

      it('the demons carry their stat blocks: speed, size, rendable hide, immunities, trait advantage', () => {
        const w = actor('Wanabbul the Vast');
        assert.equal(w.system.speed.value, 20);
        assert.equal(w.system.size, 'gigantic');
        assert.equal(w.system.defenses.pd.value, 19);
        assert.equal(w.system.checkDc, 17);
        assert.ok(w.items.some((i) => i.type === 'armor' && i.system.defenses.pd === 3 && i.system.equipped), 'Demonic Hide (3 rendable PD)');
        const g = actor('Grubnut');
        assert.ok(conditionImmune(g, 'fatigue'), 'Grubnut is immune to Fatigue');
        assert.ok(conditionImmune(g, 'prone'), 'Grubnut is immune to Prone');
        const c = actor('Csenorras the Manyworm');
        assert.ok(conditionImmune(c, 'pinned'), 'Csenorras is immune to Pin');
        assert.ok(w.items.some((i) => (i.system.modifiers ?? []).some((m) => m.target === 'resistAdvantage' && m.value === '3')), '3X on Power checks');
      });

      it('the journals render with every link resolved and every image loaded', async () => {
        for (const entry of created.JournalEntry) {
          for (const page of entry.pages) {
            const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(page.text.content, { relativeTo: page });
            const doc = new DOMParser().parseFromString(html, 'text/html');
            assert.equal(doc.querySelectorAll('a.content-link.broken').length, 0, `${entry.name} / ${page.name}: broken links`);
            for (const img of doc.querySelectorAll('img')) {
              const ok = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth > 0); i.onerror = () => resolve(false); i.src = img.getAttribute('src'); });
              assert.ok(ok, `${entry.name} / ${page.name}: ${img.getAttribute('src')}`);
            }
          }
          await entry.sheet.render(true);
          await until(() => entry.sheet.rendered, { what: `${entry.name} sheet` });
          await entry.sheet.close();
        }
        for (const name of ['Selthimor', 'Chunrudar', 'Honnasusara', 'Manchuthara', 'Wanabbul the Vast']) {
          const a = actor(name);
          await a.sheet.render(true);
          await until(() => a.sheet.rendered, { what: `${name}'s sheet` });
          await a.sheet.close();
        }
        assert.deepEqual(errors.errors, []);
      });

      it('the scene opens with its tokens linked and the defenders on the wall have Height', async () => {
        await scene.view();
        await until(() => canvas.ready && canvas.scene?.id === scene.id, { timeout: 30000, what: 'the canvas' });
        assert.equal(scene.tokens.size, [...adventure.scenes][0].tokens.size);
        for (const t of scene.tokens) assert.ok(t.actor, `${t.name} has its actor`);
        for (const name of ['Selthimor', 'Chunrudar', 'Honnasusara', 'Manchuthara']) {
          assert.ok(actor(name).statuses.has('height'), `${name} starts with Height`);
          assert.ok(tokenOf(name).actorLink, `${name}'s token is linked`);
        }
        assert.equal(scene.regions.size, 8);
        assert.ok(scene.firstLevel?.background?.src?.endsWith('map.webp'), 'the map is the background');
      });

      it("Chuni's Wall has two levels: the defenders and the wall engines 40ft up on the Wall Top, the rest on the Ground", async () => {
        assert.equal(scene.levels.size, 2);
        const top = scene.levels.find((l) => l.name === 'Wall Top');
        const ground = scene.levels.find((l) => l.name === 'Ground');
        for (const name of ['Selthimor', 'Chunrudar', 'Honnasusara', 'Manchuthara', 'Wall Ballista']) {
          assert.equal(tokenOf(name).level, top.id, `${name} is on the Wall Top`);
          assert.equal(tokenOf(name).elevation, 40, `${name} stands 40ft up`);
        }
        assert.equal(tokenOf('Wanabbul the Vast').level, ground.id);
        assert.ok(scene.walls.some((w) => w.door && w.ds === CONST.WALL_DOOR_STATES.LOCKED), 'the front gate is locked');
        await canvas.animatePan({ ...at(1000, 1600), scale: 0.32, duration: 0 });
        await viewLevel(top);
        await shot('breach-1-gm-wall-top');
        canvas.walls.activate();
        await shot('breach-1b-walls-wall-top');
        await viewLevel(ground);
        canvas.walls.activate();
        await shot('breach-2b-walls-ground');
        canvas.tokens.activate();
        await shot('breach-2-gm-ground');
      });

      it('the night: fog north of the wall, glyphs, torches and lanterns, and the fight staged in the Combat Tracker', async () => {
        assert.equal(scene.weather, 'fog');
        assert.ok(scene.regions.some((r) => r.behaviors.some((b) => b.type === 'suppressWeather')), 'the fog lifts south of the wall');
        assert.ok(scene.lights.size >= 15, 'the lights');
        assert.ok(scene.environment.darknessLevel >= 0.7, 'night');
        const combat = game.combats.find((c) => c.scene?.id === scene.id);
        assert.ok(combat, 'the combat');
        assert.deepEqual(combat.turns.map((t) => t.name), ['Selthimor', 'Chunrudar', 'Honnasusara', 'Manchuthara', 'Wanabbul the Vast']);
        assert.equal(combat.round, 0, 'not started');
        const top = scene.levels.find((l) => l.name === 'Wall Top');
        await viewLevel(top);
        await canvas.animatePan({ ...at(1000, 1500), scale: 0.45, duration: 0 });
        await shot('breach-6-night-gm');
        canvas.tokens.get(tokenOf('Honnasusara').id).control({ releaseOthers: true });
        await shot('breach-7-night-honnasusara');
        canvas.tokens.releaseAll();
        await canvas.animatePan({ ...at(1000, 1600), scale: 0.32, duration: 0 });
      });

      it('the glyph by the gate lights the wall face but not the passage under the walkway', async () => {
        await viewLevel(scene.levels.find((l) => l.name === 'Ground'));
        const glyph = scene.lights.find((l) => l.name === 'Glyph' && l.x === at(1000, 0).x);
        const shape = await until(() => canvas.lighting.get(glyph.id)?.lightSource?.shape, { what: 'the glyph light' });
        assert.ok(shape.contains(...Object.values(at(1000, 1500))), 'in front of the wall');
        assert.ok(!shape.contains(...Object.values(at(1000, 1650))), 'in the gate passage');
      });

      it('line of sight: from the ground the wall blocks the view north; from the wall top it does not', async () => {
        const ground = scene.levels.find((l) => l.name === 'Ground');
        const top = scene.levels.find((l) => l.name === 'Wall Top');
        const selthimor = tokenOf('Selthimor');
        // Selthimor goes down to the camp south of the wall.
        await moveTo(selthimor, 1100, 2600, { level: ground.id, elevation: 0 });
        await viewLevel(ground);
        canvas.tokens.get(selthimor.id).control({ releaseOthers: true });
        await sleep(500);
        const north = { ...at(1150, 900), elevation: 0 };
        const camp = { ...at(1150, 2800), elevation: 0 };
        // Perception catches up a moment after the token is controlled.
        await until(() => canvas.visibility.testVisibility(camp, { tolerance: 0 }) && !canvas.visibility.testVisibility(north, { tolerance: 0 }),
          { timeout: 10000, what: 'his line of sight: the camp in view, the wall hiding the north' });
        await shot('breach-3-ground-vision');
        // Manchuthara, on the wall top, sees past it.
        const m = tokenOf('Manchuthara');
        await viewLevel(top);
        canvas.tokens.get(m.id).control({ releaseOthers: true });
        await until(() => canvas.visibility.testVisibility({ ...north, elevation: 40 }, { tolerance: 0 }),
          { timeout: 10000, what: 'from the wall top, the view north' });
        await shot('breach-4-wall-top-vision');
        canvas.tokens.releaseAll();
        await moveTo(selthimor, 200, 600, { level: top.id, elevation: 40 });
      });

      it('the Wall Top zone takes Height away off the wall and gives it back on it', async () => {
        const m = actor('Manchuthara');
        const t = tokenOf('Manchuthara');
        await moveTo(t, 1200, 2300); // off the walkway (still on the Wall Top level, clear of the stairs)
        await until(() => !m.statuses.has('height'), { timeout: 15000, what: 'Height to go' });
        await moveTo(t, 1700, 1700);
        await until(() => m.statuses.has('height'), { timeout: 15000, what: 'Height to come back' });
      });

      it('the stairs and the hay take a token between the levels (Change Level regions)', async () => {
        const ground = scene.levels.find((l) => l.name === 'Ground');
        const top = scene.levels.find((l) => l.name === 'Wall Top');
        // Answer Foundry's "change level?" prompt the way a player would: yes, to the other level, keeping the movement.
        stub.restore();
        const asked = [];
        stub = stubDialogs((kind, o) => {
          if (kind !== 'confirm' || !/name="level"/.test(o?.content?.outerHTML ?? o?.content ?? '')) return autoAnswer(kind, o);
          asked.push(o);
          const t = canvas.tokens.controlled[0]?.document;
          return { level: t?.level === top.id ? ground.id : top.id, action: t?.movementAction ?? 'walk' };
        });
        try {
          await viewLevel(top);
          const h = tokenOf('Honnasusara');
          canvas.tokens.get(h.id).control({ releaseOthers: true });
          await moveTo(h, 1650, 1700); // the walkway, at the stair head
          const down = levelChange(h, ground);
          await walk(h, 1650, 2400); // down the stairs: the level change stops her at their foot
          await down();
          assert.equal(asked.length, 1, 'the stairs asked once');
          // She lands at the foot of the stairs, not shut inside the wall: she walks off into the camp, and back up.
          await walkTo(h, 1650, 2700, 'off the stairs into the camp');
          const up = levelChange(h, top);
          await walk(h, 1650, 2400);
          await up();
          assert.equal(asked.length, 2, 'the foot of the stairs asked once');
          await walkTo(h, 1650, 1700, 'up the stairs onto the walkway');

          const m = tokenOf('Manchuthara');
          await viewLevel(top);
          canvas.tokens.get(m.id).control({ releaseOthers: true });
          await m.update({ movementAction: 'jump' });
          await moveTo(m, 1450, 2100, { action: 'jump' }); // off the wall, over the hay
          await until(() => m.level === ground.id, { timeout: 15000, what: 'Manchuthara into the hay' });
          assert.equal(asked.length, 3, 'the hay asked once');
        } finally {
          stub.restore();
          stub = stubDialogs(autoAnswer);
          canvas.tokens.releaseAll();
        }
        // Back to their posts for the tests after.
        await tokenOf('Manchuthara').update({ movementAction: 'walk' });
        await moveTo(tokenOf('Manchuthara'), 1700, 1700, { level: top.id, elevation: 40 });
        await moveTo(tokenOf('Honnasusara'), 700, 1700, { level: top.id, elevation: 40 });
      });

      it('Wanabbul bites at 1D20+12 and the Wall Ballista fires at 1D20+8 for 8D10', async () => {
        const w = actor('Wanabbul the Vast');
        await viewLevel(scene.levels.find((l) => l.name === 'Ground'));
        target(tokenOf('Selthimor'));
        await until(() => game.user.targets.size === 1, { what: 'Selthimor targeted' });
        let since = Date.now();
        await w.sheet.useAbility(w.items.find((i) => i.name === 'Bite'));
        let card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack), { timeout: 15000, what: 'the Bite card' });
        assert.equal(flat(cardRolls(card).toHit), 12, 'Bite to-hit');
        await settle(since);
        await resetActionEconomy(w);

        const b = actor('Wall Ballista');
        target(tokenOf('Wanabbul the Vast'));
        await until(() => game.user.targets.size === 1, { what: 'Wanabbul targeted' });
        since = Date.now();
        await b.sheet.useAbility(b.items.find((i) => i.name === 'Fire the Ballista'));
        card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack), { timeout: 15000, what: 'the ballista card' });
        const { toHit, damage } = cardRolls(card);
        assert.equal(flat(toHit), 8, 'ballista to-hit');
        assert.equal(damage.dice[0].number, 8);
        assert.equal(damage.dice[0].faces, 10);
        await settle(since);
      });

      it("the pregens' weapons roll their v1.2 numbers (Bigger Stones, divine weapon, Fist Mastery)", async () => {
        await viewLevel(scene.levels.find((l) => l.name === 'Ground'));
        const roll = async (name, attackName) => {
          const a = actor(name);
          target(tokenOf('Wanabbul the Vast'));
          await until(() => game.user.targets.size === 1, { what: 'Wanabbul targeted' });
          const since = Date.now();
          await a.sheet.useAbility(a.items.find((i) => i.name === attackName));
          const card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack), { timeout: 15000, what: `${attackName}` });
          await settle(since);
          await resetActionEconomy(a);
          return cardRolls(card);
        };
        // Manchuthara: crossbow 1D4 → 1D8 (Bigger Stones ×2), +5 to-hit (+1X from Height doesn't change the flat part).
        let r = await roll('Manchuthara', 'Crossbow Attack');
        assert.equal(r.damage.dice[0].faces, 8, 'Bigger Stones twice');
        assert.equal(flat(r.toHit), 5, 'crossbow to-hit');
        // Chunrudar: Greatsword 1D10 + Power 2 + Fate 2 (Fated Strike) + 1 (Heavy Weapons Mastery), +6 to-hit.
        r = await roll('Chunrudar', 'Greatsword Attack');
        assert.equal(r.damage.dice[0].faces, 10);
        assert.equal(flat(r.damage), 5, 'greatsword damage bonus');
        assert.equal(flat(r.toHit), 6, 'greatsword to-hit');
        // Selthimor: fists 1D4 → 1D6 (Strong Fists) + Power 2 + 1 (Gutwrenching Strike), +6 to-hit (Fist Mastery).
        r = await roll('Selthimor', 'Fist Wraps Attack');
        assert.equal(r.damage.dice[0].faces, 6, 'Strong Fists');
        assert.equal(flat(r.toHit), 6, 'fist to-hit');
      });

      it('"A shape looms out of the mist…" shows when Wanabbul first walks through the fog line, then switches itself off', async () => {
        const ground = scene.levels.find((l) => l.name === 'Ground');
        await viewLevel(ground);
        const fogLine = scene.regions.find((r) => r.name === 'The Fog Line');
        const text = fogLine.behaviors.find((b) => b.type === 'displayScrollingText');
        assert.notOk(text.disabled, 'armed before');
        errors.clear();
        await moveTo(tokenOf('Wanabbul the Vast'), 800, 800); // south through the fog line (map rows 5–6)
        await until(() => text.disabled, { timeout: 15000, what: 'the text to switch off after he leaves the fog line' });
        assert.deepEqual(errors.errors.filter((e) => /includedInLevel/.test(e)), [], 'no core "once" error');
      });

      it('the Breach macro smashes a hole as wide as the demon and cuts the wall top in two', async () => {
        const ground = scene.levels.find((l) => l.name === 'Ground');
        const top = scene.levels.find((l) => l.name === 'Wall Top');
        const w = tokenOf('Wanabbul the Vast');
        await moveTo(w, 800, 1300);
        await viewLevel(ground);
        canvas.tokens.get(w.id).control({ releaseOthers: true });
        const [x0, x1] = [at(800, 0).x, at(1300, 0).x];
        const [north, south] = [at(0, 1585).y, at(0, 1915).y];
        const span = (wall) => Math.min(wall.c[0], wall.c[2]) >= x0 && Math.max(wall.c[0], wall.c[2]) <= x1;
        const faces = () => scene.walls.filter((x) => x.levels.has(ground.id) && span(x) && x.c[1] === x.c[3]);
        assert.ok(faces().length > 0, 'the faces are there before');
        await game.macros.find((x) => x.name === "Breach Chuni's Wall").execute();
        await until(() => !faces().some((x) => [north, south].includes(x.c[1])), { what: 'the faces in the hole to go' });
        assert.notOk(scene.walls.some((x) => x.door), 'the gate in the hole is smashed');
        for (const x of [x0, x1]) {
          assert.ok(scene.walls.some((v) => v.levels.has(ground.id) && v.c[0] === x && v.c[2] === x), `the hole's side at ${x} (Ground)`);
          assert.ok(scene.walls.some((v) => v.levels.has(top.id) && v.c[0] === x && v.c[2] === x), `the walkway cut at ${x} (Wall Top)`);
        }
        await shot('breach-5-after-breach');
        canvas.tokens.releaseAll();
      });

      it('the pit trap springs on a demon: 3D10 and a DC 18 Finesse check against 5 Pin', async () => {
        const w = actor('Wanabbul the Vast');
        await w.update({ 'system.health.value': 600 });
        const hp = w.system.health.value;
        const since = Date.now();
        await moveTo(tokenOf('Wanabbul the Vast'), 800, 3800); // his center over the grate
        await until(() => w.system.health.value < hp, { timeout: 20000, what: 'the pit trap damage' });
        const save = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && /data-action="rollSave"/.test(m.content)
          && /data-dc="18"/.test(m.content)), { timeout: 20000, what: 'the pit trap check card' });
        assert.match(save.content, /pinned/);
        await settle(since);
      });

      it('initiative: the staged order leaves nothing to roll; after Reset Initiative, Roll All rolls 1D20 + the better of Courage and Finesse + Proficiency', async () => {
        const combat = game.combats.find((c) => c.scene?.id === scene.id);
        await combat.startCombat();
        await ui.combat.render({ force: true });
        const rollButtons = () => ui.combat.element?.querySelectorAll('[data-action="rollInitiative"]').length ?? 0;
        await until(() => ui.combat.viewed === combat && ui.combat.element?.querySelector('[data-action="rollAll"]'), { what: 'the Combat Tracker' });
        assert.equal(rollButtons(), 0, 'every combatant starts with an initiative, so Foundry offers no roll');
        await combat.resetAll();
        await until(() => rollButtons() === combat.combatants.size, { what: 'a roll button for each combatant' });
        const since = Date.now();
        ui.combat.element.querySelector('[data-action="rollAll"]').click();
        await until(() => combat.combatants.every((c) => Number.isFinite(c.initiative)), { timeout: 15000, what: 'everyone to roll' });
        for (const c of combat.combatants) {
          const message = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.core?.initiativeRoll
            && m.speaker?.token === c.tokenId), { what: `${c.name}'s initiative roll` });
          const [roll] = message.rolls;
          const data = c.actor.getRollData();
          assert.equal(roll.total, c.initiative, `${c.name}: the tracker shows the roll`);
          assert.equal(flat(roll), Math.max(data.courage, data.finesse) + data.proficiency, `${c.name}: the Check bonus`);
        }
        await settle(since);
      });
    });
  }, { displayName: 'Sacadia: The Breach (adventure import)' });
}

/**
 * A visual review of The Breach's night, for tuning (run with QUENCH_SCREENSHOTS set; otherwise it skips): imports the
 * adventure, then screenshots the wall under several environment variants.
 */
export function registerAdventureLook(quench) {
  quench.registerBatch('sacadia.adventure.look', (context) => {
    const { describe, it, before, after } = context;
    describe('The Breach: lighting review', function () {
      this.timeout(180000);
      const fx = fixture();
      let scene;
      before(async function () {
        if (!window.__quenchScreenshot) return this.skip();
        fx.start();
        const pack = game.packs.get('sacadia.adventures');
        const adventure = await pack.getDocument((await pack.getIndex()).find((e) => e.name === 'The Breach')._id);
        const { created } = await adventure.import({ dialog: false });
        for (const d of created.Folder ?? []) fx.track(d);
        for (const [name, docs] of Object.entries(created)) if (name !== 'Folder') docs.forEach((d) => fx.track(d));
        scene = created.Scene[0];
        await scene.view({ level: scene.levels.find((l) => l.name === 'Wall Top').id });
        await until(() => canvas.ready && canvas.scene?.id === scene.id, { timeout: 30000, what: 'the canvas' });
      });
      after(() => fx.cleanup());

      it('screenshots the variants', async () => {
        const at = (x, y) => ({ x: scene.dimensions.sceneX + x, y: scene.dimensions.sceneY + y });
        // The scene as built, at the wall, the fog line north of it, and the camp; add variants here to compare settings.
        const variants = [{ name: 'as-built', update: {}, pans: { wall: [1000, 1500, 0.45], north: [1000, 450, 0.45], camp: [900, 2700, 0.4] } }];
        for (const v of variants) {
          await scene.update(v.update);
          await sleep(1500);
          for (const [key, pan] of Object.entries(v.pans ?? { wall: [1000, 1500, 0.45] })) {
            await canvas.animatePan({ ...at(pan[0], pan[1]), scale: pan[2], duration: 0 });
            await shot(`look-${v.name}-${key}`);
          }
        }
      });
    });
  }, { displayName: 'Sacadia: The Breach (lighting review)' });
}
