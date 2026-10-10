/**
 * Heritage, ancestry and culture (rules/identity.mjs) in a live world: the Heritage's HP and abilities, its choice, an
 * ancestry and a culture chosen from the compendiums (and a table's own), what they grant and take back, the specialty
 * rank a cultural talent gives, prerequisites, resistances, the Character tab, the culture item sheet, and the Heritage HP
 * migration. Everything it makes is deleted afterwards.
 */
import { until, fixture, recordErrors, settle } from './support.mjs';
import { catalogIndex } from '../helpers/refresh.mjs';
import { conditionImmune } from '../helpers/conditions.mjs';
import { rollTurnDamage } from '../helpers/prestige.mjs';
import { checkPrerequisites } from '../helpers/derivation.mjs';
import { deleteKey } from '../helpers/update-ops.mjs';
import { AbilityUse } from '../rules/ability-use.mjs';
import { setOrigin, moveHeritageHp, reconcileIdentityGrants, originChoices } from '../rules/identity.mjs';

export function registerIdentity(quench) {
  quench.registerBatch('sacadia.identity', (context) => {
    const { describe, it, assert, before, after } = context;
    describe('Heritage, ancestry and culture', function () {
      this.timeout(60000);
      const fx = fixture();
      let errors;
      const uuid = async (cid) => (await catalogIndex()).get(cid)?.uuid;
      const ids = (a) => a.items.filter((i) => i.flags?.sacadia?.identityGrant).map((i) => i.flags.sacadia.catalogId).sort();
      const owns = (a, cid) => a.items.some((i) => i.flags?.sacadia?.catalogId === cid);
      const settleIdentity = (a, fn, what) => until(async () => fn(a), { timeout: 10000, what });
      const unmet = async (a, cid) => {
        const item = await fromUuid(await uuid(cid));
        return checkPrerequisites(item.system.meta.prerequisite, await new AbilityUse(a).prerequisiteContext()).unmet;
      };
      const soldier = (name, level = 3) => fx.actor(name, 'character', { level, professions: { primary: { key: 'soldier', level } } });

      before(async () => { fx.start(); errors = recordErrors(); });
      after(async () => {
        errors?.stop();
        await fx.cleanup();
      });

      it('a Heritage adds its HP once and grants its abilities; its choice grants one more', async () => {
        const a = await soldier('Heritage');
        const base = a.system.health.max;
        await a.update({ 'system.identity.heritage': 'human' });
        await settleIdentity(a, () => owns(a, 'her_industrial'), 'Industrial');
        assert.equal(a.system.health.max, base + 10, 'Human HP at Level 1');
        await a.update({ 'system.identity.heritage': 'daemonai' });
        await settleIdentity(a, () => owns(a, 'her_natural_charisma') && !owns(a, 'her_industrial'), 'the Daemonai abilities');
        assert.equal(a.system.health.max, base + 6);
        await a.update({ 'system.identity.heritageChoice': 'speak' });
        await settleIdentity(a, () => owns(a, 'her_speak'), 'Speak');
        assert.ok(!owns(a, 'her_intuit'));
        await a.update({ 'system.identity.heritageChoice': 'intuit' });
        await settleIdentity(a, () => owns(a, 'her_intuit') && !owns(a, 'her_speak'), 'Intuit for Speak');
        // A new Heritage drops the old one's choice.
        await a.update({ 'system.identity.heritage': 'fixerfolk' });
        await settleIdentity(a, () => owns(a, 'her_fae_attunement') && !owns(a, 'her_intuit'), 'the Fixerfolk abilities');
        assert.equal(a.system.identity.heritageChoice, '');
      });

      it('an ancestry sets the Heritage, grants its abilities, and gives them back when replaced', async () => {
        const a = await soldier('Ancestry');
        const base = a.system.health.max;
        await setOrigin(a, await uuid('anc_resilient'));
        assert.equal(a.system.identity.heritage, 'human');
        assert.equal(a.system.identity.ancestry, 'Resilient');
        assert.deepEqual(ids(a), ['anc_strong_constitution', 'her_industrial']);
        assert.equal(a.system.health.max, base + 10 + 3, 'Human HP + Strong Constitution (1 a level)');
        await setOrigin(a, await uuid('anc_brute_curiot'));
        assert.equal(a.items.filter((i) => i.type === 'ancestry').length, 1, 'one ancestry');
        assert.deepEqual(ids(a), ['anc_brutish_constitution', 'her_friend_of_nature']);
        assert.equal(a.system.health.max, base + 6 + 6, 'Curiot HP + Brutish Constitution');
        // A Fontborne ancestry's ability follows the Strength of Warp chosen.
        await a.update({ 'system.identity.heritage': 'fontborne', 'system.identity.heritageChoice': 'heavy' });
        await setOrigin(a, await uuid('anc_fiestal'));
        assert.deepEqual(ids(a), ['anc_corrosive_glow', 'her_heavily_warped', 'her_strength_of_warp']);
        await a.update({ 'system.identity.heritageChoice': 'light' });
        await settleIdentity(a, () => owns(a, 'anc_radiation_sickness') && !owns(a, 'anc_corrosive_glow'), 'the Lightly Warped ability');
        await setOrigin(a, null, { type: 'ancestry' });
        assert.ok(!a.items.some((i) => i.type === 'ancestry'));
        assert.ok(!owns(a, 'anc_radiation_sickness'), 'the ancestry ability went with it');
        assert.ok(owns(a, 'her_lightly_warped'), 'the Heritage’s stayed');
      });

      it('a Hulinari form is an ancestry: it sets the Hulinari Warrior form and gives its Check Expertise', async () => {
        const a = await fx.actor('Hulinari', 'character', { level: 3, professions: { primary: { key: 'hulinari_warrior', level: 3 } } });
        await setOrigin(a, await uuid('anc_swarm_form'));
        assert.equal(a.system.identity.heritage, 'hulinari');
        assert.equal(a.system.professionResources.hulinari.form, 'swarm');
        assert.deepEqual(ids(a), ['anc_fly', 'anc_smart_flock', 'anc_with_cunning', 'her_change_form', 'her_extreme_sensing']);
        assert.ok(a.system.specialties.some((s) => s.talent === 'perception' && s.source === 'her_extreme_sensing'), 'Extreme Sensing’s Perception specialization');
        await a.sheet.render(true);
        await until(() => a.sheet.rendered, { what: 'the sheet' });
        const slots = [...a.sheet.element.querySelectorAll('[name^="system.traitExpertise"]')];
        assert.equal(slots.length, 2, 'Courage from the profession, Wiles from Smart Flock');
        await a.sheet.close();
      });

      it('a culture grants its talent and language, shows its laws, and its talent’s specialty rank comes and goes', async () => {
        const a = await soldier('Culture');
        await setOrigin(a, await uuid('culture_tianqi'));
        assert.equal(a.system.identity.culture, 'Tianqi');
        assert.deepEqual(ids(a), ['tianqi_heibrim_lore', 'tianqi_old_bushiu']);
        const lore = a.system.specialties.find((s) => s.source === 'tianqi_heibrim_lore');
        assert.ok(lore && lore.name === 'Demon Lore' && lore.talent === 'religion' && lore.rank === 1, 'Religion: Demon Lore 1');
        assert.deepEqual(await unmet(a, 'tianqi_dying_strength'), [], 'Tianqi Cultural Heritage');
        assert.deepEqual(await unmet(a, 'tianqi_redwardens_bite'), ['Tianqi Oracle'], 'a Tianqi Oracle’s');
        // The Character tab: the culture chosen, its five laws, what it granted.
        a.sheet.tabGroups ??= {};
        a.sheet.tabGroups.primary = 'biography';
        await a.sheet.render(true);
        await until(() => a.sheet.rendered && a.sheet.element.querySelector('.origin-laws'), { what: 'the Identity laws' });
        const el = a.sheet.element;
        assert.equal(el.querySelectorAll('.origin-laws li').length, 5);
        assert.equal(el.querySelector('select.origin-select[data-kind="culture"]').selectedOptions[0].textContent.trim(), 'Tianqi');
        assert.equal(el.querySelectorAll('.origin-grant').length, 2);
        // A save from the sheet (a rank bought on top) keeps the granted row's source.
        a.sheet.changeTab('stats', 'primary');
        const rank = a.sheet.element.querySelector('li.specialty.granted input.rank');
        assert.ok(rank, 'the granted row is marked');
        rank.value = '2';
        rank.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => a.system.specialties.find((s) => s.name === 'Demon Lore')?.rank === 2, { what: 'the rank saved' });
        assert.equal(a.system.specialties.find((s) => s.name === 'Demon Lore').source, 'tianqi_heibrim_lore', 'the source kept');
        a.sheet.changeTab('biography', 'primary');
        // The Cunei: the subculture and the talent chosen; the Tianqi's grants and specialty rank go.
        const select = el.querySelector('select.origin-select[data-kind="culture"]');
        select.value = await uuid('culture_cunei');
        select.dispatchEvent(new Event('change'));
        await settleIdentity(a, () => a.items.find((i) => i.type === 'culture')?.name === 'Cunei Myrgha' && owns(a, 'cunei_bushiu'), 'the Cunei');
        assert.ok(!owns(a, 'tianqi_heibrim_lore'));
        assert.ok(!a.system.specialties.some((s) => s.source === 'tianqi_heibrim_lore'), 'the Demon Lore rank went back');
        assert.equal(a.system.specialties.find((s) => s.name === 'Demon Lore')?.rank, 1, 'the bought rank stays as the player’s');
        const cunei = a.items.find((i) => i.type === 'culture');
        await cunei.update({ 'system.subculture': 'Black Cunei', 'system.choice': 'farmer' });
        await settleIdentity(a, () => owns(a, 'cunei_farmers_eye'), 'Farmer’s Eye');
        assert.deepEqual(await unmet(a, 'cunei_the_root_of_a_mighty_maple'), ['Propped Up'], 'Black Cunei and Soldier met');
        assert.deepEqual(await unmet(a, 'cunei_a_spinning_maple_seed'), ['White Cunei Subculture', 'Sentinel']);
        await setOrigin(a, null, { type: 'culture' });
        assert.deepEqual(ids(a), []);
        assert.equal(a.system.identity.culture, '');
        await a.sheet.close();
      });

      it('a dropped culture replaces the one held', async () => {
        const a = await soldier('Drop');
        await setOrigin(a, await uuid('culture_kishai'));
        assert.ok(owns(a, 'kishai_song_of_the_solemn'), 'every Kishai sings the Song of the Solemn');
        await a.sheet.render(true);
        await until(() => a.sheet.rendered, { what: 'the sheet' });
        await a.sheet._onDropItem(new DragEvent('drop'), await fromUuid(await uuid('culture_olganyar')));
        await settleIdentity(a, () => owns(a, 'olganyar_naval_from_birth') && !owns(a, 'kishai_song_of_the_solemn'), 'the Olganyar');
        assert.deepEqual(a.items.filter((i) => i.type === 'culture').map((i) => i.name), ['Olganyar']);
        await a.sheet.close();
      });

      it('ancestry and culture abilities resist, step dice and grant immunity', async () => {
        const a = await soldier('Mechanics', 5);
        await setOrigin(a, await uuid('anc_sylnfolk'));
        const er = a.items.find((i) => i.flags?.sacadia?.catalogId === 'anc_elemental_resistance');
        await er.setFlag('sacadia', 'pickValue', 'water');
        assert.equal(a.system.typedDr.water, 3, 'Elemental Resistance: Proficiency against Water');
        await setOrigin(a, await uuid('cunei_marblekin'));
        assert.equal(a.system.typedDr.slashing, 2, 'Stoneskin: half Proficiency, rounded up');
        assert.equal(a.system.typedDr.piercing, 2);
        assert.equal(a.system.typedDr.water ?? 0, 0, 'Elemental Resistance went with the Sylnfolk ancestry');
        await a.createEmbeddedDocuments('Item', [(await fromUuid(await uuid('cunei_meditative_will'))).toObject(),
          (await fromUuid(await uuid('tianqi_anemic_tolerance'))).toObject()]);
        assert.ok(conditionImmune(a, 'frenzy'), 'Meditative Will');
        await a.update({ 'system.conditions.hemorrhage.value': 2 });
        assert.equal((await rollTurnDamage(a, 'hemorrhage', 2)).formula, '2d8', 'Anemic Tolerance: d10 → d8');
      });

      it('a table’s own culture: made in the world, offered on the sheet, granting by its option', async () => {
        const industrial = await uuid('her_industrial');
        const culture = fx.track(await Item.create({ name: '[Quench] The Tidefolk', type: 'culture', system: {
          laws: [{ name: 'Salt', text: 'Never refuse salt.' }], options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
          grants: [{ uuid: industrial, option: 'b' }] } }));
        assert.ok((await originChoices()).culture.some((c) => c.uuid === culture.uuid), 'offered');
        const a = await soldier('Custom');
        await setOrigin(a, culture);
        assert.deepEqual(ids(a), []);
        const held = a.items.find((i) => i.type === 'culture');
        await held.update({ 'system.choice': 'b' });
        await settleIdentity(a, () => owns(a, 'her_industrial'), 'the option’s grant');
        // The item sheet edits its grants (an option set from the form).
        await culture.sheet.render(true);
        culture.sheet.changeTab('attributes', 'primary');
        await until(() => culture.sheet.element?.querySelector('.origin-grants select'), { what: 'the culture sheet' });
        const sel = culture.sheet.element.querySelector('.origin-grants select');
        sel.value = 'a';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => culture.system.grants[0]?.option === 'a', { what: 'the grant’s option saved' });
        assert.equal(culture.system.grants[0].uuid, industrial, 'the grant kept');
        await culture.sheet.close();
      });

      it('Heritage HP typed into the adjustment before 0.3.8 is taken back out, once', async () => {
        const a = await soldier('Legacy HP');
        assert.equal(a.getFlag('sacadia', 'heritageHpMoved'), true, 'a new character is marked');
        await a.update({ 'system.identity.heritage': 'human', 'system.health.bonus': 12, 'flags.sacadia.heritageHpMoved': deleteKey() });
        assert.equal(await moveHeritageHp(a), 10);
        assert.equal(a.system.health.bonus, 2);
        assert.equal(await moveHeritageHp(a), 0, 'only once');
        const b = await soldier('Legacy HP 2');
        await b.update({ 'system.identity.heritage': 'human', 'system.health.bonus': 4, 'flags.sacadia.heritageHpMoved': deleteKey() });
        assert.equal(await moveHeritageHp(b), 0, 'an adjustment smaller than the Heritage’s HP is left alone');
        assert.equal(b.system.health.bonus, 4);
      });

      it('reconciling again changes nothing, and nothing errored', async () => {
        for (const a of game.actors.filter((x) => x.name.startsWith('[Quench]') && x.type === 'character')) {
          assert.equal(await reconcileIdentityGrants(a), false, a.name);
        }
        await settle(fx.since);
        assert.deepEqual(errors.errors, []);
      });
    });
  });
}
