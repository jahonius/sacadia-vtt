/**
 * In-Foundry integration tests, run with the Quench module (https://github.com/Ethaks/FVTT-Quench). They register only
 * when Quench is active: open Quench (the flask button in the sidebar) and run the "sacadia" batches. Each batch creates
 * its own actors, items, messages and scene, prefixed "[Quench]", and deletes them afterwards — run them in a test world,
 * not a campaign. The Foundry-free helpers have unit tests (`npm test`); these cover what only a live world can: document
 * updates, hooks, GM requests, the ability pipeline and the canvas.
 *
 * `npm run test:quench` runs them headless (tools/quench/run.mjs). The broad sweeps live in sweep.mjs; shared helpers in
 * support.mjs.
 */
import { deleteKey, replaceWith } from '../helpers/update-ops.mjs';
import { syncFocus } from '../helpers/focus.mjs';
import { staleItems, refreshItems } from '../helpers/refresh.mjs';
import { rebuildWeaponAttacks } from '../helpers/weapon-attacks.mjs';
import { applyConditionDeltas } from '../helpers/conditions.mjs';
import { resolveRequests } from '../rules/requests.mjs';
import { resetActionEconomy } from '../rules/turn.mjs';
import { applyDamageTo } from '../rules/damage.mjs';
import { onSaveRoll } from '../rules/saves.mjs';
import { PREFIX, until, fromCatalog, stubDialogs, fixture } from './support.mjs';
import { shortRest, longRest } from '../rules/rest.mjs';
import { registerSweeps } from './sweep.mjs';
import { registerFlows } from './flows.mjs';

function registerBatches(quench) {
  const opts = (displayName) => ({ displayName: `Sacadia: ${displayName}` });

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.updates', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Object-field updates (the platform behavior the system relies on)', function () {
      this.timeout(20000);
      const fx = fixture();
      let actor;
      before(async () => { fx.start(); actor = await fx.actor('Updates', 'npc'); });
      after(() => fx.cleanup());

      it('a plain object merges: keys left out are kept', async () => {
        await actor.update({ 'system.combatState.focusRounds': { a: 1, b: 2 } });
        await actor.update({ 'system.combatState.focusRounds': { a: 1 } });
        assert.deepEqual({ ...actor.system.combatState.focusRounds }, { a: 1, b: 2 });
      });
      it('replaceWith replaces the whole value', async () => {
        await actor.update({ 'system.combatState.focusRounds': replaceWith({ a: 1 }) });
        assert.deepEqual({ ...actor.system.combatState.focusRounds }, { a: 1 });
        await actor.update({ 'system.marks': replaceWith({}) });
        assert.deepEqual({ ...actor.system.marks }, {});
      });
      it('deleteKey removes one key, in system data and in flags', async () => {
        await actor.update({ 'system.combatState.focusRounds.a': deleteKey() });
        assert.notProperty(actor.system.combatState.focusRounds, 'a');
        await actor.setFlag('sacadia', 'turnFlags', { x: 1 });
        await actor.update({ 'flags.sacadia.turnFlags': deleteKey() });
        assert.isUndefined(actor.getFlag('sacadia', 'turnFlags'));
      });
    });
  }, opts('object-field updates'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.focus', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Focus lifetime', function () {
      this.timeout(20000);
      const fx = fixture();
      let caster;
      let ally;
      before(async () => {
        fx.start();
        caster = await fx.actor('Caster', 'character');
        ally = await fx.actor('Ally', 'character');
        await caster.createEmbeddedDocuments('Item', [
          { name: 'Bane', type: 'ability', system: { tag: 'focus', mark: { key: 'baned', exclusive: true } }, flags: { sacadia: { catalogId: 'q_bane' } } },
          { name: 'Shield', type: 'ability', system: { tag: 'focus' }, flags: { sacadia: { catalogId: 'q_shield' } } },
        ]);
      });
      after(() => fx.cleanup());

      it('dropping a Focus counter removes its anchor, the grant it gave and its mark — and leaves a live Focus alone', async () => {
        await caster.createEmbeddedDocuments('ActiveEffect', [
          { name: 'anchor bane', flags: { sacadia: { anchor: { ability: 'q_bane' } } } },
          { name: 'anchor shield', flags: { sacadia: { anchor: { ability: 'q_shield' } } } },
        ]);
        await ally.createEmbeddedDocuments('ActiveEffect', [
          { name: 'bane grant', flags: { sacadia: { grantedBy: { casterUuid: caster.uuid, ability: 'q_bane', kind: 'focus' } } } },
        ]);
        await caster.update({ 'system.combatState.focusRounds': replaceWith({ q_bane: 2, q_shield: 1 }), 'system.marks': replaceWith({ baned: [ally.uuid] }) });
        await caster.update({ 'system.combatState.focusRounds.q_bane': deleteKey() });
        await syncFocus(caster);
        const anchors = () => caster.effects.map((e) => e.flags?.sacadia?.anchor?.ability).filter(Boolean);
        assert.deepEqual(anchors(), ['q_shield']);
        assert.notProperty(caster.system.marks, 'baned');
        await until(() => !ally.effects.some((e) => e.flags?.sacadia?.grantedBy?.ability === 'q_bane'), { what: 'the grant to be reaped' });
      });

      it('the turn reset drops a streak that was not maintained and keeps one that was', async () => {
        await caster.update({ 'system.combatState.focusRounds': replaceWith({ q_shield: 3, q_bane: 1 }),
          'system.actionLog': [{ label: 'Shield', key: 'q_shield', choice: '', ap: 1, spent: 1, exhausted: [] }],
          'system.combatState.hitsByTarget': { someone: 2 } });
        await resetActionEconomy(caster);
        assert.deepEqual({ ...caster.system.combatState.focusRounds }, { q_shield: 3 });
        assert.deepEqual({ ...caster.system.combatState.hitsByTarget }, {});
      });
    });
  }, opts('Focus lifetime'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.refresh', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Refreshing owned items from the compendium', function () {
      this.timeout(30000);
      const fx = fixture();
      let actor;
      before(async () => { fx.start(); actor = await fx.actor('Refresh', 'character'); });
      after(() => fx.cleanup());

      it('armor takes the compendium stats and keeps the player state (name, equipped, rend, flags)', async () => {
        const src = await fromCatalog('basic_iron_set');
        const data = foundry.utils.mergeObject(foundry.utils.deepClone(src), { name: "Grandma's Mail",
          system: { equipped: true, defenses: { pd: 1 }, rend: { pd: 2 } }, flags: { sacadia: { buildHash: 'old', broken: false, signature: true } } });
        delete data._id;
        const [item] = await actor.createEmbeddedDocuments('Item', [data]);
        assert.include((await staleItems(actor)).map((i) => i.id), item.id);
        assert.equal(await refreshItems(actor, { items: [item] }), 1);
        const it2 = actor.items.get(item.id);
        assert.equal(it2.system.defenses.pd, src.system.defenses.pd);
        assert.equal(it2.name, "Grandma's Mail");
        assert.isTrue(it2.system.equipped);
        assert.equal(it2.system.rend.pd, 2);
        assert.isTrue(it2.flags.sacadia.signature);
        assert.equal(it2.flags.sacadia.buildHash, src.flags.sacadia.buildHash);
        assert.notInclude((await staleItems(actor)).map((i) => i.id), item.id);
      });

      it('an ability takes the compendium data and name, and keeps its pick', async () => {
        const src = await fromCatalog('suppressing_fire');
        const data = foundry.utils.mergeObject(foundry.utils.deepClone(src), { name: 'Supressing Fire', system: { tag: 'action' },
          flags: { sacadia: { buildHash: 'old', pickValue: 'kept' } } });
        delete data._id;
        const [item] = await actor.createEmbeddedDocuments('Item', [data]);
        await refreshItems(actor, { items: [item] });
        const it2 = actor.items.get(item.id);
        assert.equal(it2.system.tag, 'focus');
        assert.equal(it2.name, src.name);
        assert.equal(it2.flags.sacadia.pickValue, 'kept');
      });

      it("a weapon whose copied stats changed gets its generated attacks rebuilt, without duplicates", async () => {
        const src = await fromCatalog('dagger');
        const data = foundry.utils.deepClone(src);
        delete data._id;
        const [weapon] = await actor.createEmbeddedDocuments('Item', [data]);
        const companions = () => actor.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id);
        await until(() => companions().length === 2, { what: 'the dagger attack and throw' });
        await weapon.update({ 'system.range.value': 999, 'flags.sacadia.buildHash': 'old' });
        await rebuildWeaponAttacks(weapon); // the generated attack now copies the wrong reach
        assert.equal(companions().find((i) => !i.getFlag('sacadia', 'thrown')).system.range.value, 999);
        await refreshItems(actor, { items: [actor.items.get(weapon.id)], rebuildWeapon: rebuildWeaponAttacks });
        await until(() => companions().length === 2, { what: 'the rebuilt attacks' });
        assert.equal(companions().find((i) => !i.getFlag('sacadia', 'thrown')).system.range.value, src.system.range.value);
      });
    });
  }, opts('compendium refresh'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.requests', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Card requests to the GM', function () {
      this.timeout(20000);
      const fx = fixture();
      let npc;
      before(async () => { fx.start(); npc = await fx.actor('Patient', 'npc', { health: { value: 5, max: 20 } }); });
      after(() => fx.cleanup());

      it('a request is applied once and marked handled', async () => {
        const msg = await ChatMessage.create({ content: `${PREFIX} heal`, flags: { sacadia: { heal: { uuid: npc.uuid, amount: 3 } } } });
        await until(() => msg.flags?.sacadia?.handled && npc.system.health.value === 8, { what: 'the heal to apply' });
        await resolveRequests(msg); // a second call (a reload, the Apply button) does nothing
        assert.equal(npc.system.health.value, 8);
      });

      it('a part that throws is recorded on the card, and the other parts still apply', async () => {
        // (A document update Foundry rejects doesn't throw — it's logged and resolves — so the broken part here is one the
        // system's own code fails on: a condition list that isn't a list.)
        const msg = await ChatMessage.create({ content: `${PREFIX} broken`, flags: { sacadia: {
          heal: { uuid: npc.uuid, amount: 2 },
          deltasOn: { uuid: npc.uuid, entries: 5 } } } });
        await until(() => msg.flags?.sacadia?.failed, { what: 'the failure to be recorded' });
        assert.deepEqual(msg.flags.sacadia.failed, ['deltasOn']);
        await until(() => npc.system.health.value === 10, { what: 'the heal to apply' });
      });
    });
  }, opts('GM requests'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.use', (context) => {
    const { describe, it, assert, before, after, afterEach } = context;
    describe('Using an ability: ask, then pay', function () {
      this.timeout(30000);
      const fx = fixture();
      let actor;
      let attack;
      let stub;
      before(async () => {
        fx.start();
        actor = await fx.actor('Fighter', 'character', { ap: { value: 3 } });
        const data = await fromCatalog('dagger');
        delete data._id;
        data.system.equipped = true;
        const [weapon] = await actor.createEmbeddedDocuments('Item', [data]);
        attack = await until(() => actor.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && !i.getFlag('sacadia', 'thrown')),
          { what: 'the generated attack' });
      });
      afterEach(() => stub?.restore());
      after(() => fx.cleanup());

      const cardsBy = (a) => game.messages.filter((m) => m.speaker?.actor === a.id).length;

      it('dismissing the advantage prompt spends nothing and posts nothing', async () => {
        const before = cardsBy(actor);
        stub = stubDialogs(() => null);
        await actor.sheet.useAbility(attack);
        assert.isAtLeast(stub.calls.length, 1, 'a prompt was shown');
        assert.equal(actor.system.ap.value, 3);
        assert.lengthOf(actor.system.actionLog, 0);
        assert.equal(cardsBy(actor), before);
      });

      it('answering it spends the AP and posts the card', async () => {
        const before = cardsBy(actor);
        stub = stubDialogs((kind) => (kind === 'wait' ? 0 : true));
        await actor.sheet.useAbility(attack);
        assert.equal(actor.system.ap.value, 2);
        assert.lengthOf(actor.system.actionLog, 1);
        await until(() => cardsBy(actor) > before, { what: 'the attack card' });
      });
    });
  }, opts('ability use'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.rules', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Rules on live documents', function () {
      this.timeout(30000);
      const fx = fixture();
      before(() => fx.start());
      after(() => fx.cleanup());

      it('Rend lands on worn armor and shields (never DR), is capped at what is left, and a long rest repairs it', async () => {
        const pc = await fx.actor('Rended', 'character');
        const made = await pc.createEmbeddedDocuments('Item', [
          { name: 'Hide Coat', type: 'armor', system: { equipped: true, defenses: { pd: 2, dr: 1 } } },
          { name: 'Buckler', type: 'armor', system: { equipped: true, weaponType: 'shield', defenses: { ad: 1 } } }]);
        // (Not in the order asked for: look them up.)
        const armor = made.find((i) => i.name === 'Hide Coat');
        const shield = made.find((i) => i.name === 'Buckler');
        await pc.update({ 'system.conditions.rended.value': 5 });
        assert.equal(pc.system.conditions.rended.value, 3, 'capped at the 3 rendable points there are (not the DR)');
        const rendOf = (id) => { const r = pc.items.get(id).system.rend; return r.ad + r.pd + r.td + r.md + r.dr; };
        await until(() => rendOf(armor.id) + rendOf(shield.id) === 3, { what: 'the Rend to land on the armor and shield' });
        assert.equal(pc.items.get(armor.id).system.rend.dr, 0);
        assert.equal(pc.items.get(shield.id).system.rend.ad, 1);
        assert.equal(pc.system.defenses.dr.value, 1);
        await longRest(pc);
        assert.equal(rendOf(armor.id) + rendOf(shield.id), 0);
        assert.equal(pc.system.conditions.rended.value, 0);
      });

      it("a creature wearing no armor can't be rended; an NPC's worn armor comes off its stat-block defenses", async () => {
        const bare = await fx.actor('Bare', 'npc', { defenses: { ad: 11, pd: 16, td: 11, md: 11, dr: 2 } });
        await bare.update({ 'system.conditions.rended.value': 2 });
        assert.equal(bare.system.conditions.rended.value, 0);
        assert.equal(bare.system.defenses.pd.value, 16);
        const knight = await fx.actor('Knight', 'npc', { defenses: { ad: 11, pd: 17, td: 11, md: 11, dr: 0 } });
        await knight.createEmbeddedDocuments('Item', [{ name: 'Plate', type: 'armor', system: { equipped: true, defenses: { pd: 3 } } }]);
        await knight.update({ 'system.conditions.rended.value': 2 });
        await until(() => knight.system.defenses.pd.value === 15, { what: "the knight's PD to drop by the Rend" });
      });

      it('DR and a typed resistance reduce damage, to a minimum of 1', async () => {
        const npc = await fx.actor('Target', 'npc', { health: { value: 20, max: 20 }, defenses: { dr: 2 }, resistances: 'fire 5' });
        await applyDamageTo(npc, npc.uuid, 10, null, '', { damageType: 'fire' });
        assert.equal(npc.system.health.value, 17); // 10 − (2 + 5)
        await applyDamageTo(npc, npc.uuid, 3, null, '', { damageType: 'fire' });
        assert.equal(npc.system.health.value, 16); // minimum 1
        await applyDamageTo(npc, npc.uuid, 4, null, '', { damageType: 'slashing' });
        assert.equal(npc.system.health.value, 14); // 4 − 2
      });

      it('a held condition is not given again unless the source stacks', async () => {
        const npc = await fx.actor('Panicky', 'npc');
        await applyConditionDeltas(npc, [{ condition: 'panic', amount: 2 }]);
        assert.equal(npc.system.conditions.panic.value, 2);
        await applyConditionDeltas(npc, [{ condition: 'panic', amount: 1 }]);
        assert.equal(npc.system.conditions.panic.value, 2);
        await applyConditionDeltas(npc, [{ condition: 'panic', amount: 1, stacks: true }]);
        assert.equal(npc.system.conditions.panic.value, 3);
      });

      it('a condition you give yourself stacks onto the levels you have', async () => {
        const pc = await fx.actor('Self-starter', 'character');
        await pc.update({ 'system.conditions.sting.value': 1 });
        await applyConditionDeltas(pc, [{ condition: 'sting', amount: 2, self: true }]);
        assert.equal(pc.system.conditions.sting.value, 3);
      });

      it('a short rest clears conditions, refills pools and takes one point of Rend back off the armor', async () => {
        const pc = await fx.actor('Resting', 'character');
        const [armor] = await pc.createEmbeddedDocuments('Item', [{ name: 'Mail', type: 'armor', system: { equipped: true, defenses: { pd: 3 } } }]);
        await pc.update({ 'system.conditions.panic.value': 2, 'system.conditions.rended.value': 2 });
        await until(() => pc.items.get(armor.id).system.rend.pd === 2, { what: 'the Rend on the armor' });
        const stub = stubDialogs(() => 0); // spend no HP pools
        try { await shortRest(pc); } finally { stub.restore(); }
        assert.equal(pc.system.conditions.panic.value, 0);
        assert.equal(pc.system.conditions.rended.value, 1);
        await until(() => pc.items.get(armor.id).system.rend.pd === 1, { what: 'one point of Rend restored' });
      });

      it('gear is recognized by its catalog id, so a renamed trinket still works; armor material comes from its data', async () => {
        const pc = await fx.actor('Collector', 'character');
        const earrings = await fromCatalog('moonstone_earrings');
        delete earrings._id;
        earrings.name = 'Lucky Studs';
        const cloth = await fromCatalog('basic_cloth_set');
        delete cloth._id;
        cloth.name = 'My Robes';
        cloth.system.equipped = true;
        await pc.createEmbeddedDocuments('Item', [earrings, cloth]);
        const opts2 = pc.system._rollOptions();
        assert.isTrue(!!opts2['self:gear:moonstone-earrings']);
        assert.isTrue(!!opts2['self:armor:cloth']);
      });
    });
  }, opts('rules on live documents'));

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.canvas', (context) => {
    const { describe, it, assert, before, after, afterEach } = context;
    describe('On the canvas, end to end', function () {
      this.timeout(60000);
      const fx = fixture();
      let fighter;
      let dummy;
      let ally1;
      let ally2;
      const tok = {};
      let stub;
      const give = async (actor, catalogId, patch = {}) => {
        const data = foundry.utils.mergeObject(await fromCatalog(catalogId), patch);
        delete data._id;
        const [item] = await actor.createEmbeddedDocuments('Item', [data]);
        return item;
      };
      const target = (...names) => {
        for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
        names.forEach((n, i) => canvas.tokens.get(tok[n].id).setTarget(true, { releaseOthers: i === 0 }));
      };
      before(async () => {
        fx.start();
        const linked = (disposition) => ({ prototypeToken: { actorLink: true, disposition } });
        fighter = await fx.actor('Attacker', 'character', { ap: { value: 10 } }, linked(1));
        ally1 = await fx.actor('Ally One', 'character', { ap: { value: 3 } }, linked(1));
        ally2 = await fx.actor('Ally Two', 'character', { ap: { value: 3 } }, linked(1));
        dummy = await fx.actor('Dummy', 'npc', { health: { value: 50, max: 50 }, defenses: { ad: 0, pd: 0, td: 0, md: 0, dr: 0 },
          stats: { finesse: { value: 0 } } }, linked(-1));
        const scene = fx.track(await Scene.create({ name: `${PREFIX} Arena`, width: 1200, height: 1200, grid: { size: 100, distance: 5 } }));
        await scene.view();
        await until(() => canvas.ready && canvas.scene?.id === scene.id, { timeout: 20000, what: 'the canvas' });
        const place = [[fighter, 200, 200, 1], [dummy, 300, 200, -1], [ally1, 200, 300, 1], [ally2, 300, 300, 1]];
        const docs = [];
        for (const [a, x, y, disposition] of place) docs.push((await a.getTokenDocument({ x, y, disposition })).toObject());
        const created = await scene.createEmbeddedDocuments('Token', docs);
        // By actor, not position: v14 doesn't always return created documents in the order they were asked for.
        for (const [k, a] of [['fighter', fighter], ['dummy', dummy], ['ally1', ally1], ['ally2', ally2]]) tok[k] = created.find((t) => t.actorId === a.id);
        await until(() => Object.values(tok).every((t) => canvas.tokens.get(t.id)), { what: 'the tokens on the canvas' });
        stub = stubDialogs((kind) => (kind === 'wait' ? 0 : true));
      });
      afterEach(() => resetActionEconomy(fighter));
      after(async () => { stub?.restore(); for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false }); await fx.cleanup(); });

      it('an attack card is resolved by the GM: a hit against an undefended target takes its Health down', async () => {
        const data = await fromCatalog('dagger');
        data.system.equipped = true;
        const [weapon] = await fighter.createEmbeddedDocuments('Item', [data]);
        const attack = await until(() => fighter.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && !i.getFlag('sacadia', 'thrown')),
          { what: 'the generated attack' });
        target('dummy');
        // Hit or miss is read from the resolved card; a natural 1 can still miss, so a handful of attacks is plenty.
        const seen = [];
        for (let i = 0; i < 6; i++) {
          const since = Date.now();
          await fighter.sheet.useAbility(attack);
          const card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack),
            { timeout: 15000, what: 'the attack card' });
          await until(() => /class="(hit|miss)"/.test(card.content), { timeout: 15000, what: 'the GM to resolve the attack' });
          seen.push(/class="hit"/.test(card.content) ? 'hit' : 'miss');
          if (seen.at(-1) === 'hit') {
            await until(() => dummy.system.health.value < 50, { timeout: 15000,
              what: `the damage to land (scene ${canvas.scene?.id}/${tok.dummy.parent?.id}; targets ${card.flags.sacadia.attack.attacks?.map((a) => a.targetUuids)}; `
                + `dummy ${dummy.uuid} at ${dummy.system.health.value}; card: ${card.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-160)})` });
            return;
          }
          await resetActionEconomy(fighter);
        }
        assert.fail(`no hit in six attacks against an undefended target (${seen.join(', ')})`);
      });

      it("a save card: the target's failed save gives it the condition", async () => {
        const reflex = await give(fighter, 'reflex_test');
        target('dummy');
        for (let i = 0; i < 4 && !(dummy.system.conditions.slowed?.value > 0); i++) {
          const since = Date.now();
          await fighter.sheet.useAbility(reflex);
          const msg = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.content.includes('data-action="rollSave"')),
            { timeout: 15000, what: 'the save card' });
          const button = new DOMParser().parseFromString(msg.content, 'text/html').querySelector('[data-action="rollSave"]');
          button.dataset.dc = '99'; // a failure (barring a natural 20)
          const placeable = canvas.tokens.get(tok.dummy.id);
          placeable.control({ releaseOthers: true });
          await until(() => canvas.tokens.controlled[0]?.actor === dummy, { what: `the dummy to be selected (selected: ${canvas.tokens.controlled.map((t) => t.name)})` });
          await onSaveRoll({ preventDefault() {}, currentTarget: button });
          await resetActionEconomy(fighter);
        }
        await until(() => dummy.system.conditions.slowed.value > 0, { timeout: 15000, what: 'Slowed on the dummy' });
      });

      it("an ally grant lands on the targeted ally", async () => {
        const command = await give(fighter, 'courageous_command');
        target('ally1');
        await fighter.sheet.useAbility(command);
        await until(() => ally1.effects.some((e) => e.flags?.sacadia?.grantedBy?.ability === 'courageous_command'), { what: 'the grant on the ally' });
      });

      it('a Focus zone (Suppressing Fire) is placed on the map, and goes when its Focus ends', async () => {
        const fire = await give(fighter, 'suppressing_fire');
        const zones = () => canvas.scene.regions.filter((r) => r.flags?.sacadia?.zone?.ability === 'suppressing_fire');
        const before = canvas.stage.listenerCount('pointerdown');
        const using = fighter.sheet.useAbility(fire);
        await until(() => canvas.stage.listenerCount('pointerdown') > before, { what: 'the map to ask for a point' });
        canvas.stage.emit('pointerdown', { getLocalPosition: () => ({ x: 650, y: 650 }) });
        await using;
        await until(() => zones().length === 1, { what: 'the zone' });
        assert.isTrue(!!zones()[0].flags.sacadia.zone.focus);
        await fighter.update({ 'system.combatState.focusRounds.suppressing_fire': deleteKey() });
        await until(() => zones().length === 0, { what: 'the zone to go with its Focus' });
      });

      it("Funnel Energy moves Fatigue off one creature and banks AP for the other, at the tired one's Check DC", async () => {
        const funnel = await give(fighter, 'wt_funnel_energy');
        await ally1.update({ 'system.conditions.fatigue.value': 2 });
        target('ally1', 'ally2');
        const n = game.messages.size;
        await fighter.sheet.useAbility(funnel);
        const card = await until(() => game.messages.contents.slice(n).find((m) => m.flags?.sacadia?.resist?.funnelTo), { what: 'the Funnel Energy card' });
        await until(() => !card.content.includes('data-resolution'), { what: 'the GM to resolve the checks' });
        const removed = 2 - ally1.system.conditions.fatigue.value;
        assert.equal(ally2.getFlag('sacadia', 'apBonusNext') ?? 0, removed);
      });
    });
  }, opts('on the canvas'));
}

// Registration order is run order: the targeted batches first, the long sweeps (about 8 minutes) last.
Hooks.on('quenchReady', (quench) => {
  registerBatches(quench);
  registerFlows(quench);
  registerSweeps(quench);
});
