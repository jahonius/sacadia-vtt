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
import { standingAdvantage, traitBonusParts } from '../helpers/roll-breakdown.mjs';
import { shortRest, fitfulRest } from '../rules/rest.mjs';
import { moveLegacySentinelPicks, migratePicks } from '../helpers/legacy-picks.mjs';
import { registerSweeps } from './sweep.mjs';
import { registerFlows } from './flows.mjs';
import { registerAdventure, registerAdventureLook } from './adventure.mjs';
import { registerIdentity } from './identity.mjs';
import { registerDowntime } from './downtime.mjs';
import { registerGoods } from './goods.mjs';

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

      it("the roll prompt's breakdown names each source of advantage and bonus, and adds up to what the roll uses", async () => {
        const pc = await fx.actor('Frenzied', 'character');
        await pc.update({ 'system.conditions.frenzy.value': 2 });
        await pc.createEmbeddedDocuments('ActiveEffect', [{ name: 'Blessed', changes: [
          { key: 'system.advantage.trait', mode: 2, value: '1' }, { key: 'system.bonuses.trait', mode: 2, value: '2' }] }]);
        const standing = standingAdvantage(pc, 'trait');
        assert.deepInclude(standing, { label: `${game.i18n.localize('SACADIA.Condition.Frenzy')} 2`, n: -2 });
        assert.deepInclude(standing, { label: 'Blessed', n: 1 });
        assert.equal(standing.reduce((a, s) => a + s.n, 0), pc.system.advantage.trait - pc.system.disadvantage.trait, 'the lines add up to the roll');
        const bonus = traitBonusParts(pc);
        assert.deepInclude(bonus, { label: 'Blessed', value: 2 });
        assert.equal(bonus.reduce((a, p) => a + p.value, 0), pc.system.bonuses.trait);
      });

      it("a Sentinel's Favored Enemy and Bigger Stones set on the old Abilities-tab boxes move onto the abilities' picks", async () => {
        const pc = await fx.actor('Old Sentinel', 'character',
          { professionResources: { sentinel: { favored: ['demon', 'undead'], biggerStones: { bow: 0, crossbow: 2, sling: 0 } } } });
        // Copies from before: no pick, and Bigger Stones' modifiers read the counts.
        const old = async (id, modifiers) => foundry.utils.mergeObject(await fromCatalog(id),
          { 'system.pick.kind': '', 'flags.sacadia.buildHash': 'old', ...(modifiers ? { 'system.modifiers': modifiers } : {}) });
        await pc.createEmbeddedDocuments('Item', [await old('favored_enemy'), await old('bigger_stones', [{ label: 'Bigger Stones', target: 'damage',
          mode: 'step', scope: 'ranged', value: '@biggerStones.crossbow', predicate: [{ atom: 'self:attack:weapon:crossbow' }] }])]);
        assert.isTrue(await moveLegacySentinelPicks(pc));
        const picks = (id) => pc.items.filter((i) => i.flags.sacadia?.catalogId === id).map((i) => i.flags.sacadia.pickValue);
        assert.deepEqual(picks('favored_enemy'), ['demon']);
        assert.deepEqual(picks('bigger_stones'), ['crossbow', 'crossbow'], 'the second pick is a second copy');
        const stones = pc.items.find((i) => i.flags.sacadia?.catalogId === 'bigger_stones');
        assert.equal(pc.system.csp.spent, 2 * stones.system.costs.csp, 'which costs its CSP, as the second pick did');
        assert.equal(stones.system.pick.kind, 'weaponType', 'refreshed from the compendium');
        assert.deepEqual(stones.system.modifiers.map((m) => m.value), ['1']);
        assert.equal(pc.items.find((i) => i.flags.sacadia?.catalogId === 'favored_enemy').system.pick.kind, 'favored');
        assert.deepEqual(pc.system.professionResources.sentinel.favored, ['undead'], 'a type with no ability to hold it stays');
        assert.equal(pc.system.professionResources.sentinel.biggerStones.crossbow, 0);
        assert.deepEqual(pc.system._favoredTypes(), ['demon']);
        assert.isTrue(pc.system._rollOptions()['self:favored:demon']);
        assert.isFalse(await moveLegacySentinelPicks(pc), 'a second run has nothing to do');
      });

      it("the divine and named weapons are chosen on the abilities' cards, and marked on the weapons", async () => {
        const pc = await fx.actor('Weapon Picker', 'character');
        const made = await pc.createEmbeddedDocuments('Item', await Promise.all(['dagger', 'longsword', 'crossbow', 'fated_strike', 'bd_sharp_weapon',
          'bd_jagged_blade'].map((id) => fromCatalog(id))));
        const by = (id) => made.find((i) => i.flags.sacadia?.catalogId === id);
        const [dagger, longsword, crossbow] = ['dagger', 'longsword', 'crossbow'].map((id) => pc.items.get(by(id).id));
        const sheet = pc.sheet;
        await sheet.render({ force: true });
        try {
          await until(() => sheet.rendered && sheet.element.querySelector('select.ability-pick'), { what: 'the sheet' });
          const select = (cid) => sheet.element.querySelector(`[data-item-id="${by(cid).id}"] select.ability-pick`);
          const options = (cid) => [...select(cid).options].map((o) => o.value).filter(Boolean);
          const choose = (cid, value) => { const s = select(cid); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); };
          assert.sameMembers(options('fated_strike'), [dagger.id, longsword.id], 'a melee weapon');
          assert.sameMembers(options('bd_sharp_weapon'), [dagger.id], 'a versatile weapon');
          choose('fated_strike', longsword.id);
          await until(() => longsword.flags.sacadia?.signature, { what: 'the longsword to be the divine weapon' });
          await until(() => select('fated_strike')?.value === longsword.id, { what: 'the card to show it' });
          choose('fated_strike', dagger.id);
          await until(() => dagger.flags.sacadia?.signature && !longsword.flags.sacadia?.signature, { what: 'the divine weapon to move' });
          await until(() => select('bd_sharp_weapon'), { what: 'the re-render' });
          choose('bd_sharp_weapon', dagger.id);
          await until(() => dagger.flags.sacadia?.namedAs === 'bd_sharp_weapon', { what: 'the dagger to be named' });
          await until(() => select('bd_jagged_blade') && !options('bd_jagged_blade').includes(dagger.id), { what: 'a weapon to carry one name' });
          assert.notInclude(options('fated_strike'), crossbow.id);
        } finally { await sheet.close(); }
      });

      it("Favored Style's Fontmade element is resisted at Proficiency, and asked for only when you favor Fontmade", async () => {
        const pc = await fx.actor('Fontmade Hunter', 'character', { level: 5 });
        const [enemy, style] = await pc.createEmbeddedDocuments('Item', [
          foundry.utils.mergeObject(await fromCatalog('favored_enemy'), { 'flags.sacadia.pickValue': 'fontmade' }),
          foundry.utils.mergeObject(await fromCatalog('favored_style'), { 'flags.sacadia.pickValue': 'fire' })]);
        assert.equal(pc.system.typedDr.fire, pc.system.proficiency);
        const sheet = pc.sheet;
        await sheet.render({ force: true });
        try {
          const pickOn = (id) => sheet.element.querySelector(`[data-item-id="${id}"] select.ability-pick`);
          await until(() => sheet.rendered && pickOn(style.id), { what: 'the Fontmade dropdown' });
          await pc.items.get(enemy.id).setFlag('sacadia', 'pickValue', 'demon');
          assert.notOk(pc.system.typedDr.fire, 'no resistance without favoring Fontmade');
          // A new character's basic actions are still arriving, re-rendering the sheet as they do: render until it's settled.
          await until(async () => { await sheet.render(); return pickOn(enemy.id) && !pickOn(style.id); },
            { timeout: 10000, step: 300, what: 'the Fontmade dropdown to go' });
        } finally { await sheet.close(); }
      });

      it("a Fatebound's older Fated Strike is refreshed on load, and a lone melee weapon becomes the divine one", async () => {
        const pc = await fx.actor('Old Fatebound', 'character');
        await pc.createEmbeddedDocuments('Item', [await fromCatalog('longsword'), await fromCatalog('crossbow'),
          foundry.utils.mergeObject(await fromCatalog('fated_strike'), { 'system.pick.kind': '', 'flags.sacadia.buildHash': 'old' })]);
        assert.isTrue(await migratePicks(pc));
        assert.equal(pc.items.find((i) => i.flags.sacadia?.catalogId === 'fated_strike').system.pick.kind, 'divineWeapon');
        assert.isTrue(pc.items.find((i) => i.flags.sacadia?.catalogId === 'longsword').flags.sacadia.signature);
        assert.notOk(pc.items.find((i) => i.flags.sacadia?.catalogId === 'crossbow').flags.sacadia?.signature);
        assert.isFalse(await migratePicks(pc), 'a second load has nothing to do');
      });

      it('Rend lands on worn armor and shields (never DR), is capped at what is left, and a fitful rest repairs it', async () => {
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
        await fitfulRest(pc);
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

      it('a Consistent Roll spends extra AP on an attack for that much advantage, and the log shows the whole spend', async () => {
        let attack = fighter.items.find((i) => i.getFlag('sacadia', 'weaponAttack') && !i.getFlag('sacadia', 'thrown'));
        if (!attack) {
          const data = await fromCatalog('dagger');
          data.system.equipped = true;
          const [weapon] = await fighter.createEmbeddedDocuments('Item', [data]);
          attack = await until(() => fighter.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && !i.getFlag('sacadia', 'thrown')),
            { what: 'the generated attack' });
        }
        await resetActionEconomy(fighter);
        await fighter.update({ 'system.ap.value': 5 }); // room for the attack and two more
        const apBefore = fighter.system.ap.value;
        // The attack's advantage prompt (it asks for a Consistent Roll when there's AP to spare): 2 extra AP.
        stub.restore();
        stub = stubDialogs((kind, o) => (kind === 'wait' && /name="consistent"/.test(o?.content ?? '') ? { level: 0, consistent: 2 } : (kind === 'wait' ? 0 : true)));
        try {
          target('dummy');
          const since = Date.now();
          await fighter.sheet.useAbility(attack);
          const card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack),
            { timeout: 15000, what: 'the attack card' });
          const cost = attack.system.costs?.ap ?? 1;
          assert.equal(fighter.system.ap.value, apBefore - cost - 2, "the ability's AP plus the two spent consistently");
          assert.equal(fighter.system.actionLog.at(-1).ap, cost + 2, 'the turn log shows the whole spend');
          const d20 = card.rolls[0]?.dice[0];
          assert.ok(d20?.number >= 3 && d20.modifiers.includes('kh1'), `rolled with 2X advantage (${card.rolls[0]?.formula})`);
          assert.match(card.content, /2× Adv · Consistent Roll/);
        } finally {
          stub.restore();
          stub = stubDialogs((kind) => (kind === 'wait' ? 0 : true));
          await resetActionEconomy(fighter);
        }
      });

      it('Bigger Stones taken twice, on the bow and on the crossbow, steps a crossbow attack once', async () => {
        const data = await fromCatalog('crossbow');
        data.system.equipped = true;
        const [xbow] = await fighter.createEmbeddedDocuments('Item', [data]);
        const attack = await until(() => fighter.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === xbow.id && !i.getFlag('sacadia', 'thrown')),
          { what: 'the generated crossbow attack' });
        const stones = [await give(fighter, 'bigger_stones', { flags: { sacadia: { pickValue: 'bow' } } }),
          await give(fighter, 'bigger_stones', { flags: { sacadia: { pickValue: 'sling' } } })];
        const faces = async () => {
          await resetActionEconomy(fighter);
          target('dummy');
          const since = Date.now();
          await fighter.sheet.useAbility(attack);
          const card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack),
            { timeout: 15000, what: 'the crossbow card' });
          return card.rolls.find((r) => !r.dice.some((d) => d.faces === 20))?.dice[0]?.faces;
        };
        try {
          const base = await faces(); // neither copy is on the crossbow
          await stones[1].setFlag('sacadia', 'pickValue', 'crossbow');
          assert.equal(await faces(), { 4: 6, 6: 8, 8: 10, 10: 12 }[base], `one step from the crossbow copy only (base d${base})`);
        } finally {
          await fighter.deleteEmbeddedDocuments('Item', [xbow.id, ...stones.map((s) => s.id)].filter((id) => fighter.items.has(id)));
        }
      });

      it("Favored Mastery's half Wiles applies against the favored type its second pick names, not the others", async () => {
        const data = await fromCatalog('dagger');
        data.system.equipped = true;
        const [dagger] = await fighter.createEmbeddedDocuments('Item', [data]);
        const attack = await until(() => fighter.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === dagger.id && !i.getFlag('sacadia', 'thrown')),
          { what: 'the dagger attack' });
        const abilities = [await give(fighter, 'favored_enemy', { flags: { sacadia: { pickValue: 'demon' } } }),
          await give(fighter, 'i_favor_all_enemies', { flags: { sacadia: { pickValue: 'undead' } } }),
          await give(fighter, 'legendary_favored', { flags: { sacadia: { pickValue: 'undead', pickValue2: 'demon' } } })];
        const wiles = fighter.system.stats.wiles.value;
        await fighter.update({ 'system.stats.wiles.value': 4 });
        const card = async (type) => {
          await dummy.update({ 'system.creatureType': type });
          await resetActionEconomy(fighter);
          target('dummy');
          const since = Date.now();
          await fighter.sheet.useAbility(attack);
          return until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack), { timeout: 15000, what: 'the card' });
        };
        try {
          assert.match((await card('demon')).content, /Favored Mastery/, 'against the chosen type');
          assert.notMatch((await card('undead')).content, /Favored Mastery/, 'not against another favored type');
        } finally {
          await dummy.update({ 'system.creatureType': '' });
          await fighter.update({ 'system.stats.wiles.value': wiles });
          await fighter.deleteEmbeddedDocuments('Item', [dagger.id, ...abilities.map((a) => a.id)].filter((id) => fighter.items.has(id)));
        }
      });

      it("Sling Mastery's chosen condition: a save that gives it is one DC harder", async () => {
        const reflex = await give(fighter, 'reflex_test'); // gives Slowed on a failed Finesse save
        const mastery = await give(fighter, 'mastery_sling', { flags: { sacadia: { pickValue: 'panic' } } });
        const dc = async () => {
          await resetActionEconomy(fighter);
          target('dummy');
          const since = Date.now();
          await fighter.sheet.useAbility(reflex);
          const msg = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.content.includes('data-action="rollSave"')),
            { timeout: 15000, what: 'the save card' });
          return Number(new DOMParser().parseFromString(msg.content, 'text/html').querySelector('[data-action="rollSave"]').dataset.dc);
        };
        try {
          const other = await dc();
          await mastery.setFlag('sacadia', 'pickValue', 'slowed');
          assert.equal(await dc(), other + 1);
        } finally {
          await fighter.deleteEmbeddedDocuments('Item', [reflex.id, mastery.id].filter((id) => fighter.items.has(id)));
        }
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
  registerIdentity(quench);
  registerDowntime(quench);
  registerGoods(quench);
  registerAdventure(quench);
  registerAdventureLook(quench);
  registerSweeps(quench);
});
