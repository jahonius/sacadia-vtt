/**
 * Broad Quench sweeps: every ability in the system's compendiums used once, and every sheet rendered. They don't check
 * rules — the targeted batches in quench.mjs do — but they catch a use or a sheet that throws, hangs, logs an error or
 * leaves a GM request failing, across the whole catalog. The abilities run on a canvas with a hostile dummy and two
 * allies; dialogs are answered as a person pressing Enter would, and map picks are answered with a click on the dummy.
 */
import { until, sleep, fromCatalog, stubDialogs, autoAnswer, answeringMapPicks, recordErrors, settle, resetActor, fixture, arena,
  target } from './support.mjs';

/** The system's Item compendiums, read from their loaded indexes (so tests can be listed synchronously). */
function systemPacks() {
  return game.packs.filter((p) => p.metadata.packageType === 'system' && p.metadata.packageName === game.system.id && p.documentName === 'Item');
}

/** Run `promise`, failing if it takes longer than `ms` (a use waiting on something that never comes). */
function withTimeout(promise, ms, what) {
  return Promise.race([promise, sleep(ms).then(() => { throw new Error(`${what} didn't finish within ${ms / 1000}s`); })]);
}

/** Does the ability act on an ally (so the sweep targets one)? */
function aimsAtAlly(sys) {
  return ['ally', 'allies'].includes(sys.grant?.scope) || !!sys.aidResist?.levels || !!sys.choiceRedirect?.key
    || ['allies', 'both'].includes(sys.tempHp?.target);
}

export function registerSweeps(quench) {
  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.sweep.abilities', (context) => {
    const { describe, it, before, after, assert } = context;
    describe('Every ability, used once', function () {
      this.timeout(30000);
      const fx = fixture();
      const rig = {};
      let rec;
      let stub;
      let used = 0;

      before(async function () {
        this.timeout(120000);
        fx.start();
        const linked = (disposition) => ({ prototypeToken: { actorLink: true, disposition } });
        rig.caster = await fx.actor('Sweeper', 'character', { ap: { value: 10 } }, linked(1));
        rig.dummy = await fx.actor('Dummy', 'npc', { health: { value: 60, max: 60 } }, linked(-1));
        rig.ally1 = await fx.actor('Ally One', 'character', {}, linked(1));
        rig.ally2 = await fx.actor('Ally Two', 'character', {}, linked(1));
        ({ tok: rig.tok } = await arena(fx, [['caster', rig.caster, 300, 300, 1], ['dummy', rig.dummy, 400, 300, -1],
          ['ally1', rig.ally1, 300, 400, 1], ['ally2', rig.ally2, 400, 400, 1]]));
        const dagger = await fromCatalog('dagger');
        dagger.system.equipped = true;
        const [weapon] = await rig.caster.createEmbeddedDocuments('Item', [dagger]);
        await until(() => rig.caster.items.filter((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id).length === 2, { what: 'the dagger attacks' });
        rig.keep = rig.caster.items.map((i) => i.id);
        rig.attack = rig.caster.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && !i.getFlag('sacadia', 'thrown'));
        rig.throw = rig.caster.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && i.getFlag('sacadia', 'thrown'));
        stub = stubDialogs(autoAnswer);
        rec = recordErrors();
      });
      after(async () => { rec?.stop(); stub?.restore(); for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false }); await fx.cleanup(); });

      async function resetRig() {
        if (canvas.scene?.regions.size) await canvas.scene.deleteEmbeddedDocuments('Region', canvas.scene.regions.map((r) => r.id));
        await resetActor(rig.caster, { keepItems: rig.keep, madness: 3 });
        for (const a of [rig.dummy, rig.ally1, rig.ally2]) await resetActor(a);
        if (++used % 40 === 0) await fx.clearMessages();
      }

      /** A Boost: arm it, then use an action it rides (its named ability, a save, a throw, or the dagger attack). */
      async function boostCarrier(boost) {
        await rig.caster.update({ 'system.armedBoosts': [boost.flags.sacadia.catalogId] });
        const at = boost.system.boost?.appliesTo ?? {};
        const add = async (id) => { try { const [i] = await rig.caster.createEmbeddedDocuments('Item', [await fromCatalog(id)]); return i; } catch { return null; } };
        if (at.kind === 'ability' && at.ability) return (await add(at.ability.split('|')[0])) ?? rig.attack;
        if (at.kind === 'save') return (await add('reflex_test')) ?? rig.attack;
        if (at.kind === 'attack' && at.category === 'ranged') return rig.throw;
        return rig.attack;
      }

      async function sweep(pack, id) {
        await resetRig();
        rec.clear();
        const since = Date.now();
        const data = (await pack.getDocument(id)).toObject();
        delete data._id;
        const [item] = await rig.caster.createEmbeddedDocuments('Item', [data]);
        const sys = item.system;
        if (sys.aidResist?.funnel) {
          await rig.ally1.update({ 'system.conditions.fatigue.value': 2 });
          target(rig.tok.ally1, rig.tok.ally2);
        } else target(aimsAtAlly(sys) ? rig.tok.ally1 : rig.tok.dummy);
        const use = sys.tag === 'boost' ? await boostCarrier(item) : item;
        const d = rig.tok.dummy;
        await answeringMapPicks(() => withTimeout(rig.caster.sheet.useAbility(use), 15000, 'the use'), { x: d.x + 50, y: d.y + 50 });
        await settle(since);
        const failed = game.messages.contents.filter((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.failed).flatMap((m) => m.flags.sacadia.failed);
        if (failed.length) rec.errors.push(`GM request parts failed: ${failed.join(', ')}`);
        if (rec.errors.length) assert.fail(rec.errors.map((e) => e.slice(0, 600)).join('\n---\n'));
      }

      // `sacadiaSweepFilter` (set by the headless runner's second argument) limits the sweep: a pattern over "pack name".
      const only = globalThis.sacadiaSweepFilter ? new RegExp(globalThis.sacadiaSweepFilter, 'i') : null;
      for (const pack of systemPacks()) {
        const entries = [...pack.index.values()].filter((e) => e.type === 'ability' && (!only || only.test(`${pack.metadata.label} ${e.name}`)))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!entries.length) continue;
        describe(pack.metadata.label, function () {
          for (const e of entries) it(e.name, () => sweep(pack, e._id));
        });
      }
    });
  }, { displayName: 'Sacadia: sweep — every ability' });

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.sweep.sheets', (context) => {
    const { describe, it, before, after, assert } = context;
    describe('Every sheet renders', function () {
      this.timeout(120000);
      const fx = fixture();
      let rec;
      before(() => { fx.start(); rec = recordErrors(); });
      after(async () => { rec?.stop(); await fx.cleanup(); });

      /** Render a sheet, visit each of its tabs, and close it; fail on any error. */
      async function renderSheet(sheet, label) {
        rec.clear();
        await sheet.render({ force: true });
        await until(() => sheet.rendered && sheet.element, { what: `${label} to render` });
        const tabs = [...(sheet.element.querySelectorAll('nav [data-tab][data-group]') ?? [])].map((a) => [a.dataset.tab, a.dataset.group]);
        for (const [tab, group] of tabs) { sheet.changeTab(tab, group); await sleep(10); }
        await sheet.close();
        if (rec.errors.length) assert.fail(`${label}: ${rec.errors.map((e) => e.slice(0, 600)).join('\n---\n')}`);
      }

      for (const pack of systemPacks()) {
        it(`a character sheet holding everything in ${pack.metadata.label}`, async () => {
          const pc = await fx.actor(`Collector ${pack.metadata.label}`, 'character');
          const docs = await pack.getDocuments();
          await pc.createEmbeddedDocuments('Item', docs.map((d) => { const o = d.toObject(); delete o._id; return o; }));
          await renderSheet(pc.sheet, `character with ${pack.metadata.label}`);
          await pc.delete();
        });
      }

      it("a character sheet's layout holds: the header its height, headings their style, the Conditions tab its count", async () => {
        const pc = await fx.actor('Layout', 'character', { conditions: { panic: { value: 2 } } });
        await pc.sheet.render({ force: true, position: { width: 720, height: 760 } });
        await until(() => pc.sheet.rendered && pc.sheet.element, { what: 'the sheet to render' });
        try {
          const el = pc.sheet.element;
          // The portrait runs the header's height (at least 136px): a stray rule collapsing it shows here.
          assert.isAtLeast(el.querySelector('.sheet-header').getBoundingClientRect().height, 120, 'the header keeps its height');
          // Section headings are small tracked capitals, not display headlines.
          const h3 = el.querySelector('.tab[data-tab="stats"] h3');
          const style = getComputedStyle(h3);
          assert.equal(style.textTransform, 'uppercase', 'section headings are capitals');
          assert.isBelow(parseFloat(style.fontSize), 16, 'section headings are small');
          // Conditions have their own tab, which counts what's held.
          assert.ok(el.querySelector('.tab[data-tab="conditions"] [data-action="resistCondition"][data-key="panic"]'), 'the tracker is on the Conditions tab');
          assert.notOk(el.querySelector('.tab[data-tab="stats"] [data-action="resistCondition"]'), 'and not on the Stats tab');
          assert.equal(el.querySelector('[data-tab="conditions"] .tab-count')?.textContent.trim(), '1', 'the tab counts the held condition');
        } finally {
          await pc.sheet.close();
        }
      });

      it('an NPC sheet with abilities, weapons and armor', async () => {
        const npc = await fx.actor('Monster', 'npc', { health: { value: 30, max: 30 }, resistances: 'fire 2', size: 'large' });
        await npc.createEmbeddedDocuments('Item', await Promise.all(['dagger', 'basic_iron_set', 'reflex_test', 'suppressing_fire', 'bd_blade_aura']
          .map((id) => fromCatalog(id))));
        await renderSheet(npc.sheet, 'NPC');
      });

      it('the refresh notice shows on a sheet with an out-of-date item', async () => {
        const pc = await fx.actor('Stale', 'character');
        const data = await fromCatalog('suppressing_fire');
        data.flags.sacadia.buildHash = 'old';
        await pc.createEmbeddedDocuments('Item', [data]);
        await pc.sheet.render({ force: true });
        await until(() => pc.sheet.element?.querySelector('.refresh-notice'), { what: 'the refresh notice' });
        await pc.sheet.close();
      });

      for (const pack of systemPacks()) {
        it(`every item sheet in ${pack.metadata.label}`, async () => {
          const failures = [];
          for (const doc of await pack.getDocuments()) {
            rec.clear();
            try {
              await doc.sheet.render({ force: true });
              await until(() => doc.sheet.rendered, { timeout: 4000, what: doc.name });
              await doc.sheet.close();
            } catch (err) { rec.errors.push(err.message); }
            if (rec.errors.length) failures.push(`${doc.name}: ${rec.errors[0].slice(0, 300)}`);
          }
          if (failures.length) assert.fail(failures.slice(0, 10).join('\n') + (failures.length > 10 ? `\n… and ${failures.length - 10} more` : ''));
        });
      }
    });
  }, { displayName: 'Sacadia: sweep — every sheet' });
}

