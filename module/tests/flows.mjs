/**
 * Quench batches for whole flows the targeted tests in quench.mjs don't reach: a combat played turn by turn (turn
 * automation), and the reaction, Boost, no-roll effect, kill-trigger and Insanity paths.
 */
import { until, sleep, fromCatalog, stubDialogs, autoAnswer, answeringMapPicks, settle, fixture, arena, target } from './support.mjs';
import { onPostRoll } from '../rules/reactions.mjs';
import { resetActionEconomy } from '../rules/turn.mjs';
import { gearId } from '../helpers/actor-utils.mjs';

const linked = (disposition) => ({ prototypeToken: { actorLink: true, disposition } });

async function give(actor, ...ids) {
  return actor.createEmbeddedDocuments('Item', await Promise.all(ids.map((id) => fromCatalog(id))));
}

/** The dagger, equipped, and its generated attack. */
async function armWithDagger(actor) {
  const data = await fromCatalog('dagger');
  data.system.equipped = true;
  const [weapon] = await actor.createEmbeddedDocuments('Item', [data]);
  return until(() => actor.items.find((i) => i.getFlag('sacadia', 'weaponAttack') === weapon.id && !i.getFlag('sacadia', 'thrown')),
    { what: 'the dagger attack' });
}

export function registerFlows(quench) {
  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.combat', (context) => {
    const { describe, it, before, after, assert } = context;
    describe('A combat, turn by turn', function () {
      this.timeout(60000);
      const fx = fixture();
      let rager;
      let bleeder;
      let scene;
      let tok;
      let combat;
      let stub;
      const zones = () => scene.regions.filter((r) => r.flags?.sacadia?.zone?.ability === 'suppressing_fire');
      const combatantOf = (actor) => combat.combatants.find((c) => c.actorId === actor.id);

      before(async () => {
        fx.start();
        rager = await fx.actor('Rager', 'character', {}, linked(1));
        bleeder = await fx.actor('Bleeder', 'npc', { health: { value: 40, max: 40 } }, linked(-1));
        ({ scene, tok } = await arena(fx, [['rager', rager, 300, 300, 1], ['bleeder', bleeder, 600, 300, -1]]));
        stub = stubDialogs(autoAnswer);
        // A Focus zone placed before the fight: its use is in the action log, so it counts as maintained at the first
        // turn start and lapses at the next one.
        const [fire] = await give(rager, 'suppressing_fire');
        target(tok.bleeder);
        await answeringMapPicks(() => rager.sheet.useAbility(fire), { x: 750, y: 750 });
        await until(() => zones().length === 1, { what: 'the zone' });
        await give(rager, 'woad_facepaint');
        await rager.toggleStatusEffect('raging', { active: true });
        await rager.setFlag('sacadia', 'rage', { rounds: 1 });
        await rager.update({ 'system.conditions.panic.value': 2, 'system.ap.value': 0 });
        await bleeder.update({ 'system.conditions.hemorrhage.value': 1 });
        combat = fx.track(await Combat.create({ scene: scene.id }));
        await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tok.rager.id, sceneId: scene.id, actorId: rager.id },
          { tokenId: tok.bleeder.id, sceneId: scene.id, actorId: bleeder.id }]);
      });
      after(async () => { stub?.restore(); for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false }); await fx.cleanup(); });

      it('setting initiative uses up a Woad Facepaint', async () => {
        await combat.setInitiative(combatantOf(rager).id, 20);
        await combat.setInitiative(combatantOf(bleeder).id, 10);
        await until(() => !rager.items.some((i) => gearId(i) === 'woad_facepaint'), { what: 'the facepaint to be used up' });
      });

      it('the first turn start refills AP and keeps a Focus that was maintained', async () => {
        await combat.startCombat();
        await until(() => combat.combatant?.actorId === rager.id && rager.system.ap.value === rager.system.ap.max && rager.system.ap.max > 0,
          { what: "the rager's AP" });
        await sleep(300);
        assert.equal(zones().length, 1);
      });

      it("the turn's end lowers conditions by one, then ends a rage that has run out with all its Fatigue", async () => {
        await combat.nextTurn();
        await until(() => !rager.statuses.has('raging'), { what: 'the rage to end' });
        await until(() => rager.system.conditions.panic.value === 1, { what: 'Panic to drop to 1' });
        // The rage's Fatigue comes after the reduction, so none of it is lost before the rager's next turn.
        const fatigue = Math.ceil((rager.system.proficiency ?? 0) / 2);
        assert.isAbove(fatigue, 0);
        await until(() => rager.system.conditions.fatigue.value === fatigue, { what: `Fatigue ${fatigue} from the rage` });
      });

      it('a turn start deals the Hemorrhage damage', async () => {
        await until(() => bleeder.system.health.value < 40, { what: 'Hemorrhage damage' });
      });

      it('a Focus not maintained lapses at its next turn start, and its zone goes with it', async () => {
        await combat.nextTurn(); // round 2: the rager's turn, nothing used since the last one
        await until(() => !(rager.system.combatState.focusRounds.suppressing_fire > 0), { what: 'the Focus to lapse' });
        await until(() => zones().length === 0, { what: 'the zone to go' });
      });

      it('ending the combat clears marks, temp HP and once-per-combat uses', async () => {
        await rager.update({ 'system.health.temp': 5, 'system.marks': { quarry: [bleeder.uuid] }, 'flags.sacadia.uses.combat.q_once': 1 });
        await combat.delete();
        await until(() => rager.system.health.temp === 0 && !rager.getFlag('sacadia', 'uses')?.combat
          && !Object.keys(rager.system.marks ?? {}).length, { what: 'the end-of-combat cleanup' });
      });
    });
  }, { displayName: 'Sacadia: a combat, turn by turn' });

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.flows', (context) => {
    const { describe, it, before, after, afterEach, assert } = context;
    describe('Reactions, Boosts, no-roll effects, kills and Insanity', function () {
      this.timeout(60000);
      const fx = fixture();
      let fighter;
      let attack;
      let tok;
      let stub;
      const actors = {};

      before(async () => {
        fx.start();
        fighter = await fx.actor('Fighter', 'character', { ap: { value: 10 } }, linked(1));
        actors.blocker = await fx.actor('Blocker', 'npc', { health: { value: 40, max: 40 }, defenses: { ad: 0, pd: 0, td: 0, md: 0, dr: 0 } }, linked(-1));
        actors.victim = await fx.actor('Victim', 'npc', { health: { value: 40, max: 40 }, defenses: { ad: 0, pd: 0, td: 0, md: 0, dr: 0 } }, linked(-1));
        ({ tok } = await arena(fx, [['fighter', fighter, 300, 300, 1], ['blocker', actors.blocker, 400, 300, -1],
          ['victim', actors.victim, 300, 400, -1]]));
        attack = await armWithDagger(fighter);
        stub = stubDialogs(autoAnswer);
      });
      afterEach(() => resetActionEconomy(fighter));
      after(async () => { stub?.restore(); for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false }); await fx.cleanup(); });

      /**
       * Attack the target with the dagger until a hit lands; returns the messages of that attack. Hit or miss is read from
       * the card once the GM has resolved it (not guessed from Health, which lands a moment later on a busy client).
       */
      async function hit(targetKey) {
        target(tok[targetKey]);
        const victim = actors[targetKey];
        for (let i = 0; i < 6; i++) {
          const since = Date.now();
          const hp = victim.system.health.value;
          await fighter.sheet.useAbility(attack);
          const card = await until(() => game.messages.contents.find((m) => (m.timestamp ?? 0) >= since && m.flags?.sacadia?.attack),
            { timeout: 15000, what: 'the attack card' });
          await until(() => /class="(hit|miss)"/.test(card.content), { timeout: 15000, what: 'the GM to resolve the attack' });
          await settle(since);
          if (/class="hit"/.test(card.content)) {
            await until(() => victim.system.health.value < hp, { timeout: 15000, what: 'the damage to land' });
            return game.messages.contents.filter((m) => (m.timestamp ?? 0) >= since);
          }
          await resetActionEconomy(fighter);
        }
        throw new Error('no hit in six attacks against an undefended target');
      }

      it("Block, offered to a Steadied defender after a hit, can turn it aside and gives back the Health", async () => {
        const blocker = actors.blocker;
        await give(blocker, 'basic_block');
        await blocker.toggleStatusEffect('steadied', { active: true });
        await blocker.update({ 'system.reaction.value': 1 });
        const msgs = await hit('blocker');
        const html = msgs.map((m) => m.content).join('');
        const button = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-action="postRoll"][data-key="basic_block"]');
        assert.ok(button, 'the GM is offered Block');
        // Any reduction now misses: the defense the attack went against equals its to-hit.
        await blocker.update({ [`system.defenses.${button.dataset.defense}`]: Number(button.dataset.tohit), 'system.defenses.ad': 0 });
        await onPostRoll({ preventDefault() {}, currentTarget: button });
        await until(() => blocker.system.health.value === Number(button.dataset.hp), { timeout: 15000, what: 'the Health to come back' });
        assert.equal(blocker.system.reaction.value, 0, 'the reaction is spent');
      });

      it('an armed Boost rides the next attack and is used up', async () => {
        await give(fighter, 'bd_whisperglide');
        await fighter.update({ 'system.armedBoosts': ['bd_whisperglide'] });
        target(tok.victim);
        const since = Date.now();
        await fighter.sheet.useAbility(attack);
        await settle(since);
        assert.deepEqual([...fighter.system.armedBoosts], []);
      });

      it('a no-roll effect gives the target its condition through the GM', async () => {
        const [sluggish] = await give(fighter, 'that_sluggish_feeling');
        await fighter.update({ 'system.reaction.value': 1 });
        target(tok.victim);
        const since = Date.now();
        await fighter.sheet.useAbility(sluggish);
        await settle(since);
        await until(() => actors.victim.system.conditions.slowed.value > 0, { timeout: 15000, what: 'Slowed on the target' });
      });

      it('a kill sets off kill triggers (Killing Frenzy banks a Surprised next target)', async () => {
        await give(fighter, 'thug_killing_frenzy');
        await actors.victim.update({ 'system.health.value': 1 });
        await hit('victim');
        await until(() => (fighter.system.pendingAttack ?? []).some((p) => p.targetCondition === 'surprised'), { timeout: 15000, what: 'the banked Surprised' });
      });

      it('Madness reaching 6 makes an Oracle Insane, and losing it all ends Insanity with Fatigue', async () => {
        const oracle = await fx.actor('Oracle', 'character', {}, linked(1));
        await oracle.update({ 'system.conditions.madness.value': 6 });
        await until(() => oracle.statuses.has('insane'), { what: 'Insanity' });
        await oracle.update({ 'system.conditions.madness.value': 0 });
        await until(() => !oracle.statuses.has('insane') && oracle.system.conditions.fatigue.value > 0, { what: 'Insanity to end with Fatigue' });
      });
    });
  }, { displayName: 'Sacadia: reactions, Boosts, effects, kills, Insanity' });

  /* ---------------------------------------------------------------------------------------------------------- */
  quench.registerBatch('sacadia.rulings', (context) => {
    const { describe, it, before, after, assert } = context;
    describe("The designer's rulings on live documents", function () {
      this.timeout(60000);
      const fx = fixture();
      let caster;
      let foe;
      let tok;
      let stub;

      before(async () => {
        fx.start();
        caster = await fx.actor('Caster', 'character', { ap: { value: 10 }, lorePoints: { value: 3 } }, linked(1));
        foe = await fx.actor('Stared', 'npc', { health: { value: 200, max: 200 } }, linked(-1));
        ({ tok } = await arena(fx, [['caster', caster, 300, 300, 1], ['foe', foe, 600, 300, -1]]));
        stub = stubDialogs(autoAnswer);
      });
      after(async () => { stub?.restore(); for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false }); await fx.cleanup(); });

      it('Greater Glaring: two dice types a round while you stay still since Barbed Stare began, one a round after you move', async () => {
        const stare = (await give(caster, 'mg_barbed_stare', 'mg_greater_glaring')).find((i) => i.flags?.sacadia?.catalogId === 'mg_barbed_stare');
        const combat = fx.track(await Combat.create({ scene: canvas.scene.id, active: true }));
        await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tok.caster.id, sceneId: canvas.scene.id, actorId: caster.id }]);
        await combat.startCombat();
        const steps = () => caster.system.abilityDamageSteps?.mg_barbed_stare ?? 0;
        const round = async () => {
          target(tok.foe);
          const since = Date.now();
          await caster.sheet.useAbility(stare);
          await settle(since);
          await resetActionEconomy(caster); // the next turn: the Focus was used, so its streak carries on
        };
        await round();
        assert.equal(steps(), 0, 'round 1: 1D6');
        await round();
        assert.equal(steps(), 2, 'round 2, still: one from Barbed Stare, one from Greater Glaring');
        await round();
        assert.equal(steps(), 4, 'round 3, still');
        await tok.caster.update({ x: 400 });
        await until(() => caster.getFlag('sacadia', 'stillFocus')?.mg_barbed_stare?.moved, { what: 'the move to be noticed' });
        await round();
        assert.equal(steps(), 5, 'round 4, moved: only Barbed Stare\'s own step');
        await round();
        assert.equal(steps(), 6, 'round 5');
        await combat.delete();
      });

      it("Coordinated Flock doubles Clouded Foe's tiles", async () => {
        await give(caster, 'clouded_foe', 'lore_coordinated_flock');
        await caster.update({ 'system.armedBoosts': ['lore_coordinated_flock'], 'system.lorePoints.value': 3 });
        const foeCloud = caster.items.find((i) => i.flags?.sacadia?.catalogId === 'clouded_foe');
        const base = Math.max(1, caster.system.proficiency ?? 0);
        // Answer the tile pick with clicks along the row east of the caster, one adjacent tile at a time.
        const listeners = canvas.stage.listenerCount('pointerdown');
        let done = false;
        let k = 1;
        const clicker = (async () => {
          while (!done) {
            if (canvas.stage.listenerCount('pointerdown') > listeners) {
              const x = tok.caster.x + (k++) * canvas.grid.size + 50;
              canvas.stage.emit('pointerdown', { getLocalPosition: () => ({ x, y: tok.caster.y + 50 }) });
            }
            await sleep(40);
          }
        })();
        const since = Date.now();
        try { await caster.sheet.useAbility(foeCloud); } finally { done = true; await clicker; }
        await settle(since);
        const cloud = await until(() => canvas.scene.regions.find((r) => r.flags?.sacadia?.zone?.ability === 'clouded_foe'), { what: 'the cloud' });
        assert.equal(cloud.shapes.length, 2 * base);
        assert.equal(caster.system.lorePoints.value, 2, 'the Lore point is spent');
      });
    });
  }, { displayName: "Sacadia: the designer's rulings" });
}

