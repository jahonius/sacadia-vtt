/**
 * Personal goods (helpers/goods.mjs, rules/goods.mjs) in a live world: buying an item dropped on the purse, the slots bags
 * and baggage give, lighting a torch and a lantern (the token's light follows, and a rest burns them out), a Chickenglitter
 * glow, using up a consumable, a rune's chosen changes (one active at a time, chosen on its sheet), jewelry on a condition
 * check, the Brass Horn and Gold Wings, and the Long Rest's Offering, Holy Symbol and Shop for Bargains with real items.
 * Everything it makes is deleted afterwards.
 */
import { until, sleep, fixture, recordErrors, stubDialogs, autoAnswer, arena, fromCatalog } from './support.mjs';
import { catalogIndex } from '../helpers/refresh.mjs';
import { checkContext, foldCheckModifiers } from '../helpers/check-pool.mjs';
import { jewelryCheckItems } from '../helpers/goods.mjs';
import { toggleLight, useGoods } from '../rules/goods.mjs';
import { shortRest, fitfulRest } from '../rules/rest.mjs';
import { takeLongRest } from '../rules/downtime.mjs';

export function registerGoods(quench) {
  quench.registerBatch('sacadia.goods', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Personal goods', function () {
      this.timeout(60000);
      const fx = fixture();
      let errors, stub;
      const card = () => game.messages.contents.filter((m) => (m.timestamp ?? 0) >= fx.since).at(-1);
      // The items made, in the order asked for (v14 doesn't always return them in order).
      const give = async (a, ...ids) => {
        const made = await a.createEmbeddedDocuments('Item', await Promise.all(ids.map((id) => fromCatalog(id))));
        return ids.map((id) => made.find((i) => i.flags?.sacadia?.catalogId === id));
      };
      const openTab = async (a, tab) => {
        a.sheet.tabGroups ??= {};
        a.sheet.tabGroups.primary = tab;
        await a.sheet.render(true);
        return until(() => a.sheet.rendered && a.sheet.element?.querySelector(`.tab[data-tab="${tab}"]`), { what: `the ${tab} tab` });
      };

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

      it('an item dropped on the purse is bought: paid for, then added', async () => {
        const a = await fx.actor('Buyer', 'character', { money: { gc: 1, sc: 0 } });
        await openTab(a, 'inventory');
        const drop = async (cid) => {
          const dt = new DataTransfer();
          dt.setData('text/plain', JSON.stringify({ type: 'Item', uuid: (await catalogIndex()).get(cid).uuid }));
          a.sheet.element.querySelector('.purse').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        };
        await drop('torch');
        await until(() => a.items.some((i) => i.name === 'Torch'), { what: 'the torch bought' });
        assert.deepEqual({ gc: a.system.money.gc, sc: a.system.money.sc }, { gc: 0, sc: 98 }, '2sc from a gold');
        assert.match(card().content, /buys Torch for 2sc/);
        await drop('boots');
        await sleep(500);
        assert.ok(!a.items.some((i) => i.name === 'Boots'), "30gc boots can't be afforded, and aren't added");
        await a.sheet.close();
      });

      it('bags give stored slots (the largest backpack only), readied baggage and pockets give readied ones', async () => {
        const a = await fx.actor('Packer', 'character');
        const before = { ris: a.system.itemSlots.ris.max, sis: a.system.itemSlots.sis.max };
        await give(a, 'backpack_small', 'backpack_medium', 'jar_glass', 'bandolier_small', 'pocket');
        assert.equal(a.system.itemSlots.sis.max, before.sis + 40 + 3, 'the medium backpack and the jar');
        assert.equal(a.system.itemSlots.ris.max, before.ris + 3 + 1, 'the bandolier and the pocket');
        assert.equal(a.system.itemSlots.sis.used, 1, 'the jar sits in a stored slot');
        const bandolier = a.items.find((i) => i.name === 'Bandolier (Small)');
        await bandolier.update({ 'system.storage': 'sis' });
        assert.equal(a.system.itemSlots.ris.max, before.ris + 1, 'a stowed bandolier gives nothing');
      });

      it('a lit torch lights the token; a Quick Rest burns it out and the token goes dark again', async () => {
        const a = await fx.actor('Torchbearer', 'character', {}, { prototypeToken: { actorLink: true, light: { bright: 0, dim: 0 } } });
        const { tok } = await arena(fx, [['t', a, 300, 300]]);
        const [torch] = await give(a, 'torch', 'flint_and_tinder');
        await torch.update({ 'system.quantity': 2 });
        await openTab(a, 'inventory');
        const flame = await until(() => a.sheet.element.querySelector(`[data-item-id="${torch.id}"] [data-action="toggleLight"]`), { what: 'the flame control' });
        flame.click();
        await until(() => tok.t.light.dim === 20 && tok.t.light.bright === 10, { what: 'the token lit 10/20' });
        assert.ok(torch.getFlag('sacadia', 'lit'));
        assert.equal(torch.system.damageType, 'Fire', 'a lit torch burns');
        await until(() => a.prototypeToken.light.dim === 20, { what: 'the prototype token lit too' });
        await until(() => a.sheet.element.querySelector(`[data-item-id="${torch.id}"] .sac-chip.lit`), { what: 'the Lit chip' });
        await shortRest(a);
        await until(() => tok.t.light.dim === 0 && !tok.t.getFlag('sacadia', 'baseLight'), { what: 'the token dark again' });
        assert.equal(a.items.get(torch.id).system.quantity, 1, 'one torch burnt out');
        assert.ok(!a.items.get(torch.id).getFlag('sacadia', 'lit'));
        assert.equal(a.items.get(torch.id).system.damageType, 'Bludgeon');
        assert.match(card().content, /Torch \(burnt out\)/);
        await a.sheet.close();
      });

      it('a lantern needs oil; its hood narrows the light; a Chickenglitter glow lasts until a Nightly Rest', async () => {
        const a = await fx.actor('Lamplighter', 'character', {}, { prototypeToken: { actorLink: true } });
        const { tok } = await arena(fx, [['l', a, 500, 500]]);
        const [lantern, hood] = await give(a, 'lantern', 'lantern_hood', 'flint_and_tinder', 'chickenglitter_dye');
        assert.ok(!(await toggleLight(lantern)), 'no oil, no light');
        const [oil] = await give(a, 'lantern_oil');
        await hood.update({ 'system.equipped': true });
        assert.ok(await toggleLight(lantern));
        await until(() => tok.l.light.bright === 40 && tok.l.light.angle === 30, { what: 'the hooded lantern' });
        assert.ok(!a.items.get(oil.id), 'its oil burnt');
        await toggleLight(lantern);
        await until(() => tok.l.light.dim !== 40, { what: 'the lantern out' });
        const dye = a.items.find((i) => i.name === 'Chickenglitter Dye');
        await toggleLight(dye);
        await until(() => tok.l.light.dim === 5, { what: 'the glow' });
        assert.ok(!a.items.get(dye.id), 'the dye used up');
        await shortRest(a);
        assert.ok(a.getFlag('sacadia', 'glow'), 'a Quick Rest leaves the glow');
        await fitfulRest(a);
        await until(() => !a.getFlag('sacadia', 'glow') && tok.l.light.dim !== 5, { what: 'the glow gone with a night' });
      });

      it('a consumable is used up with a card', async () => {
        const a = await fx.actor('Snacker', 'character');
        const [date] = await give(a, 'healing_date');
        await date.update({ 'system.quantity': 2 });
        await openTab(a, 'inventory');
        const use = await until(() => a.sheet.element.querySelector(`[data-item-id="${date.id}"] [data-action="useGoods"]`), { what: 'the Use control' });
        use.click();
        await until(() => a.items.get(date.id)?.system.quantity === 1, { what: 'one eaten' });
        assert.match(card().content, /uses Date \(Healing\)/);
        assert.match(card().content, /Battle Fatigue/);
        await useGoods(a.items.get(date.id));
        assert.ok(!a.items.get(date.id), 'the last one gone');
        await a.sheet.close();
      });

      it('a rune changes the defenses as chosen on its sheet, worn on armor; activating one puts the other out', async () => {
        const a = await fx.actor('Runed', 'character', { level: 3, professions: { primary: { key: 'soldier', level: 3 } } });
        const [armor, moon, solar] = await give(a, 'basic_dye_set', 'moon_rune', 'solar_rune_lesser');
        await armor.update({ 'system.equipped': true });
        const base = { ad: a.system.defenses.ad.value, pd: a.system.defenses.pd.value, td: a.system.defenses.td.value };
        // Choose on the rune's sheet: +3 to PD.
        await moon.sheet.render(true);
        const select = await until(() => moon.sheet.element?.querySelector('select[name="flags.sacadia.runeChoice.plus.0"]'), { what: 'the rune choice' });
        select.value = 'pd';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => moon.getFlag('sacadia', 'runeChoice')?.plus?.[0] === 'pd', { what: 'the choice saved' });
        await moon.sheet.close();
        assert.equal(a.system.defenses.pd.value, base.pd, 'not until it is activated');
        await moon.update({ 'system.equipped': true });
        assert.equal(a.system.defenses.pd.value, base.pd + 3);
        assert.equal(a.system.defenses.ad.value, base.ad - 2);
        await solar.update({ 'flags.sacadia.runeChoice': { minus: ['ad'], plus: ['td'] } });
        await solar.update({ 'system.equipped': true });
        await until(() => !a.items.get(moon.id).system.equipped, { what: 'the Moon Rune put out' });
        assert.equal(a.system.defenses.pd.value, base.pd);
        assert.equal(a.system.defenses.td.value, base.td + 1);
        await armor.update({ 'system.equipped': false });
        const noArmor = a.system.defenses.td.value;
        await armor.update({ 'system.equipped': true });
        assert.equal(a.system.defenses.td.value, noArmor + (armor.system.defenses.td ?? 0) + 1, 'only while armor is worn');
      });

      it('jewelry gives 1X Advantage on checks against its condition', async () => {
        const a = await fx.actor('Jeweled', 'character');
        await give(a, 'amber_jewelry');
        const fold = (cond, mode) => foldCheckModifiers(jewelryCheckItems([...a.items]),
          checkContext(cond, CONFIG.SACADIA.conditions[cond].group, mode), {});
        assert.equal(fold('nausea', 'save').adv, 1, 'when first given');
        assert.equal(fold('nausea', 'resist').adv, 1, 'on Make Trait Check');
        assert.equal(fold('panic', 'save').adv, 0, 'only its own condition');
      });

      it('the Brass Horn held at the start of combat, and Gold Wings on sandals', async () => {
        const a = await fx.actor('Herald', 'character', {}, { prototypeToken: { actorLink: true } });
        const { scene, tok } = await arena(fx, [['h', a, 700, 300]]);
        const combat = fx.track(await Combat.create({ scene: scene.id, active: true }));
        const [c] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tok.h.id, sceneId: scene.id, actorId: a.id }]);
        const [horn] = await give(a, 'brass_horn');
        assert.match(c._getInitiativeFormula(), /^1d20/);
        await horn.update({ 'system.equipped': true });
        assert.match(c._getInitiativeFormula(), /^2d20kh/);
        const speed = a.system.speed.value;
        await give(a, 'gold_wings');
        assert.equal(a.system.speed.value, speed, 'no sandals, no wings');
        await give(a, 'sandals');
        assert.equal(a.system.speed.value, speed + 5);
      });

      it('a Long Rest: an Offering counts at its price, a Holy Symbol at hand, and bargains on real items', async () => {
        const a = await fx.actor('Pilgrim', 'character', { level: 2, professions: { primary: { key: 'oracle', level: 2 } },
          talents: { religion: { proficient: true }, economy: { proficient: true } } });
        const [offering] = await give(a, 'offering', 'holy_symbol');
        await takeLongRest(a, { weeks: [{ kind: 'offering', offeringItem: offering.id, gold: 0, religion: '' }, { kind: 'pray' }, { kind: 'shop' }] });
        const c = card();
        assert.match(c.content, /100gc offered/);
        assert.notMatch(c.content, /no Holy Symbol/i);
        assert.ok(!a.items.get(offering.id), 'the Offering given');
        assert.match(c.content, /Bargain Sale/);
        // Unless the d20 lands on Magic Items, the bargains name compendium items with their deal prices.
        const links = (c.content.match(/@UUID\[Compendium\.sacadia\.[^\]]+\]/g) ?? []).length;
        if (!/Magic Items/.test(c.content)) assert.isAtLeast(links, 2, 'items on both deals');
      });

      it('nothing errored', () => {
        assert.deepEqual(errors.errors, []);
      });
    });
  });
}
