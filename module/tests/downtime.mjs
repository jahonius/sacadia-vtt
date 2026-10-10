/**
 * Money and the Long Rest (helpers/downtime.mjs, rules/downtime.mjs, apps/long-rest.mjs) in a live world: the purse,
 * starting gold and change, selling at half price, spending Influence, a Fitful Rest that leaves Lore alone, and a Long
 * Rest whose weeks earn money, gain Influence (to the limit), make an offering, shop, pray, train an ability away, and work
 * an inherited business, ending with a Fitful Rest and Lore refilled. Everything it makes is deleted afterwards.
 */
import { until, fixture, recordErrors, stubDialogs, autoAnswer } from './support.mjs';
import { catalogIndex } from '../helpers/refresh.mjs';
import { fitfulRest } from '../rules/rest.mjs';
import { takeLongRest, downtimeOptions } from '../rules/downtime.mjs';
import { LongRest } from '../apps/long-rest.mjs';

export function registerDowntime(quench) {
  quench.registerBatch('sacadia.downtime', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Money and the Long Rest', function () {
      this.timeout(60000);
      const fx = fixture();
      let errors, stub;
      const fromPack = async (cid) => { const d = (await fromUuid((await catalogIndex()).get(cid).uuid)).toObject(); delete d._id; return d; };
      const card = () => game.messages.contents.filter((m) => (m.timestamp ?? 0) >= fx.since).at(-1);

      before(async () => {
        fx.start();
        errors = recordErrors();
        stub = stubDialogs(autoAnswer);
      });
      after(async () => {
        stub?.restore();
        errors?.stop();
        await fx.cleanup();
      });

      it('the purse: starting gold from the profession, change both ways', async () => {
        const a = await fx.actor('Purse', 'character', { level: 1, professions: { primary: { key: 'thug', level: 1 } } });
        a.sheet.tabGroups ??= {};
        a.sheet.tabGroups.primary = 'inventory';
        await a.sheet.render(true);
        const button = await until(() => a.sheet.element?.querySelector('[data-action="startingGold"]'), { what: 'the starting gold button' });
        button.click();
        await until(() => a.system.money.gc === 30, { what: 'the Thug’s 30gc' });
        await until(() => !a.sheet.element.querySelector('[data-action="startingGold"]'), { what: 'the button gone once there’s money' });
        a.sheet.element.querySelector('[data-action="makeChange"]').click();
        await until(() => a.system.money.gc === 29 && a.system.money.sc === 100, { what: 'a gold changed into 100 silver' });
        a.sheet.element.querySelector('[data-action="makeChange"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        await until(() => a.system.money.gc === 30 && a.system.money.sc === 0, { what: '100 silver back into a gold' });
        await a.sheet.close();
      });

      it('selling an item to a merchant pays half its price', async () => {
        const a = await fx.actor('Seller', 'character');
        const [sword] = await a.createEmbeddedDocuments('Item', [await fromPack('longsword')]);
        assert.equal(sword.system.value, 55);
        a.sheet.tabGroups ??= {};
        a.sheet.tabGroups.primary = 'inventory';
        await a.sheet.render(true);
        const sell = await until(() => a.sheet.element?.querySelector(`[data-item-id="${sword.id}"] [data-action="sellItem"]`), { what: 'the Sell control' });
        sell.click();
        await until(() => !a.items.get(sword.id), { what: 'the sword sold' });
        assert.deepEqual({ gc: a.system.money.gc, sc: a.system.money.sc }, { gc: 27, sc: 50 }, '27½gc');
        // The card is posted after the sale (the item's gone first).
        await until(() => /sells/.test(card()?.content ?? ''), { what: 'the sale’s card' });
        const [plate] = await a.createEmbeddedDocuments('Item', [await fromPack('shoddy_iron_set')]);
        assert.equal(plate.system.value, 20, 'armor has its price too');
        await a.sheet.close();
      });

      it('spending Influence takes a point and posts what for', async () => {
        const a = await fx.actor('Influencer', 'character', { influence: [{ group: 'The Thieves’ Guild', value: 2 }] });
        a.sheet.tabGroups ??= {};
        a.sheet.tabGroups.primary = 'biography';
        await a.sheet.render(true);
        const spend = await until(() => a.sheet.element?.querySelector('.influence-row [data-action="spendInfluence"]'), { what: 'the Spend control' });
        spend.click();
        await until(() => a.system.influence[0].value === 1, { what: 'a point spent' });
        await until(() => /Thieves’ Guild/.test(card()?.content ?? ''), { what: 'the Influence card' });
        // Editing the group's name on the sheet keeps the list a list.
        const name = a.sheet.element.querySelector('.influence-row input[type="text"]');
        name.value = 'The Guild';
        name.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => a.system.influence[0]?.group === 'The Guild', { what: 'the name saved' });
        assert.equal(a.system.influence[0].value, 1);
        await a.sheet.close();
      });

      it('a Fitful Rest heals and repairs but leaves Lore for the Long Rest', async () => {
        const a = await fx.actor('Sleeper', 'character', { level: 4, professions: { primary: { key: 'soldier', level: 4 } } });
        await a.update({ 'system.health.value': 5, 'system.lorePoints.value': 0 });
        assert.equal(a.system.lorePoints.max, 1);
        await fitfulRest(a);
        assert.equal(a.system.health.value, a.system.health.max);
        assert.equal(a.system.lorePoints.value, 0, 'Lore refills at the end of a Long Rest (p.168)');
      });

      it('a Long Rest: earn, Influence to its limit, an offering, shopping, prayer, training, then a Fitful Rest and Lore', async () => {
        const a = await fx.actor('Downtime', 'character', { level: 4, professions: { primary: { key: 'soldier', level: 4 } },
          money: { gc: 150, sc: 0 }, talents: { religion: { proficient: true } } });
        await a.update({ 'system.health.value': 3, 'system.lorePoints.value': 0 });
        const [drop, offering] = await a.createEmbeddedDocuments('Item', [await fromPack('call_of_healing'),
          { name: 'Offering (Incense)', type: 'gear', system: { quantity: 2, value: 1 } }]);
        const csp = a.system.csp.spent;
        const prof = a.system.proficiency;
        await takeLongRest(a, { weeks: [
          { kind: 'earn', earn: 'odd' },
          { kind: 'influence', group: 'The Wardens' },
          { kind: 'influence', group: 'the wardens' },
          { kind: 'influence', group: 'The Monks' },
          { kind: 'offering', offeringItem: offering.id, gold: 100, religion: '' },
          { kind: 'offering' },
          { kind: 'shop' },
          { kind: 'pray', text: 'Will the wall hold?' },
          { kind: 'train', train: `item:${drop.id}` },
          { kind: 'lead', text: 'Who poisoned the well?' },
        ] });
        const odd = [0, 10, 20, 60, 100, 200, 250][prof];
        assert.equal(a.system.money.gc, 150 + odd - 100, 'odd job pay in, the offering’s gold out');
        assert.deepEqual(a.system.influence.map((g) => [g.group, g.value]), [['The Wardens', 2]], 'two Influence a Long Rest, the third no effect');
        assert.equal(a.items.get(offering.id).system.quantity, 1, 'an Offering expended');
        assert.ok(!a.items.get(drop.id), 'trained away');
        assert.equal(a.system.csp.spent, csp - (drop.system.costs.csp ?? 0), 'its CSP back');
        assert.equal(a.system.health.value, a.system.health.max, 'the Fitful Rest it ends with');
        assert.isAtLeast(a.system.lorePoints.value, 1, 'Lore refilled (plus 1 if the offering won)');
        const c = card();
        assert.match(c.content, /Long Rest: 10 week/);
        assert.match(c.content, /Bargain Sale/);
        assert.match(c.content, /Bargain Buy/);
        assert.match(c.content, /at most 2/);
        assert.match(c.content, /Religion/);
        assert.match(c.content, /Who poisoned the well/);
        assert.isAtLeast(c.rolls.length, 1 + 1 + 6, 'the offering, the prayer, and the shopping’s six rolls');
      });

      it('an inherited business works Earn Money instead of an odd job', async () => {
        const a = await fx.actor('Trawler', 'character', { level: 3, professions: { primary: { key: 'soldier', level: 3 } } });
        const [boat] = await a.createEmbeddedDocuments('Item', [await fromPack('tianqi_shrimp_trawler')]);
        const opts = downtimeOptions(a);
        assert.equal(opts.earn.find((e) => e.value === boat.id)?.amount, 60);
        await takeLongRest(a, { weeks: [{ kind: 'earn', earn: boat.id }] });
        assert.equal(a.system.money.gc, 60);
        assert.match(card().content, /Lake of Western Lights/);
      });

      it('the Long Rest window plans the weeks and takes the rest', async () => {
        const a = await fx.actor('Window', 'character', { level: 2, professions: { primary: { key: 'oracle', level: 2 } } });
        await LongRest.open(a);
        const app = await until(() => [...foundry.applications.instances.values()].find((x) => x instanceof LongRest && x.actor === a && x.rendered),
          { what: 'the window' });
        const el = app.element;
        el.querySelector('[data-action="addWeek"]').click();
        await until(() => app.element.querySelectorAll('.lr-week').length === 2, { what: 'a second week' });
        const kind = app.element.querySelector('select[name="weeks.1.kind"]');
        kind.value = 'influence';
        kind.dispatchEvent(new Event('change', { bubbles: true }));
        const group = await until(() => app.element.querySelector('input[name="weeks.1.group"]'), { what: 'the group field' });
        group.value = 'The Glass Palace';
        group.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => app.plan.weeks[1].group === 'The Glass Palace', { what: 'the plan updated' });
        app.element.querySelector('[data-action="takeRest"]').click();
        await until(() => !app.rendered, { what: 'the rest taken' });
        assert.equal(a.system.money.gc, 20, 'an Oracle of Proficiency 2’s odd jobs');
        assert.deepEqual(a.system.influence.map((g) => g.group), ['The Glass Palace']);
      });

      it('nothing errored', () => {
        assert.deepEqual(errors.errors, []);
      });
    });
  });
}
