/**
 * Rests (book p.235): what a Quick/Short Rest and a Long/Nightly Rest recover — pools, conditions, Rend, Health and HP
 * pools, Lore points, broken armor — and Slightly Cracked's roll at each quick rest.
 */
import { deleteKey } from '../helpers/update-ops.mjs';
import { ownsAbility } from '../helpers/actor-utils.mjs';
import { cardHead } from '../helpers/chat-cards.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';

/**
 * Common rest effects (both rest types): recover ability pools to max, remove most leveled
 * conditions, and reduce armor Rend by 1 (Rend isn't fully cleared on a Quick Rest).
 * @returns {object} an update payload to merge
 */
function restRecovery(actor) {
  const update = {};
  // Temp HP is a combat buffer (book p.223) — cleared at combat end, but also on rest as a backstop
  // for fights run without the initiative tracker.
  if ((actor.system.health?.temp ?? 0) > 0) update['system.health.temp'] = 0;
  // Battle Fatigue (book p.230) is shed by resting, not by checks or turn ends.
  if ((actor.system.battleFatigue ?? 0) > 0) update['system.battleFatigue'] = 0;
  // Miss Recovery's once-per-quick-rest AP refund re-arms on a rest (its trigger flag lives on the actor).
  if (actor.getFlag('sacadia', 'missRecoveryUsed')) update['flags.sacadia.missRecoveryUsed'] = false;
  // Once-per-rest options (Lucky Strike, Mastery of the Critical …) re-arm on a rest.
  if (actor.getFlag('sacadia', 'restFlags')) update['flags.sacadia.restFlags'] = deleteKey();
  if (actor.getFlag('sacadia', 'uses')?.rest) update['flags.sacadia.uses.rest'] = deleteKey();
  if (actor.getFlag('sacadia', 'yarrowstem')) update['flags.sacadia.yarrowstem'] = deleteKey();
  for (const key of Object.keys(CONFIG.SACADIA.pools)) {
    const p = actor.system.classPools?.[key];
    if (p) update[`system.classPools.${key}.value`] = p.max;
  }
  for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
    if (key === 'rended' || CONFIG.SACADIA.enduringConditions.includes(key)) continue;
    if ((actor.system.conditions?.[key]?.value ?? 0) > 0) update[`system.conditions.${key}.value`] = 0;
  }
  return update;
}

/**
 * Slightly Cracked (Oracle L3): "At the start of each quick rest, roll XD3 and save the die roll, where X is
 * equal to your Proficiency Score" (+1 with Mastery of Temperament). Replaces any unspent rolls.
 */
async function rollSlightlyCracked(actor) {
  const owns = (id) => ownsAbility(actor, id);
  if (!owns('oracle_slightly_cracked')) return null;
  const n = Math.max(0, (actor.system.proficiency ?? 0) + (owns('mastery_temperament') ? 1 : 0));
  if (!n) return null;
  const r = await new Roll(`${n}d3`).evaluate();
  await actor.update({ 'system.professionResources.oracle.cracked': r.dice[0].results.map((x) => x.result) });
  return r; // shown on the rest card
}

/** Quick/Short Rest: pool + condition recovery, Rend −1, and optional HP-pool healing. */
export async function shortRest(actor) {
  const before = restSnapshot(actor);
  const update = restRecovery(actor);
  const rend = actor.system.conditions?.rended?.value ?? 0;
  if (rend > 0) update['system.conditions.rended.value'] = rend - 1;
  await actor.update(update);
  const cracked = await rollSlightlyCracked(actor);
  await promptHealPools(actor);
  await restMessage(actor, 'short', before, { cracked });
}

/** Long/Nightly Rest: full HP + HP-pool + Lore refill, all Rend cleared, plus the common recovery. */
export async function longRest(actor) {
  const before = restSnapshot(actor);
  const update = restRecovery(actor);
  update['system.health.value'] = actor.system.health.max;
  update['system.healthPools.value'] = actor.system.healthPools.max;
  update['system.lorePoints.value'] = actor.system.lorePoints.max;
  update['system.conditions.rended.value'] = 0;
  await actor.update(update);
  // "Recover all rend in your armor" (book p.235): every piece is whole again, and broken adornments (Brittlework) are
  // repaired.
  const whole = actor.items.filter((i) => i.type === 'armor' && Object.values(i.system.rend ?? {}).some((v) => v > 0))
    .map((i) => ({ _id: i.id, 'system.rend': { ad: 0, pd: 0, td: 0, md: 0, dr: 0 } }));
  if (whole.length) await actor.updateEmbeddedDocuments('Item', whole);
  const broken = actor.items.filter((i) => i.getFlag('sacadia', 'broken'));
  for (const b of broken) await b.unsetFlag('sacadia', 'broken');
  const cracked = await rollSlightlyCracked(actor);
  await restMessage(actor, 'long', before, { cracked, repaired: whole.length + broken.length });
}

/**
 * Spend HP pools to heal: each pool recovers HP equal to the primary profession's HP/level, capped
 * at Max HP (book p.235). Prompts for how many of the available pools to spend.
 */
async function promptHealPools(actor) {
  const available = actor.system.healthPools?.value ?? 0;
  if (available <= 0) return;
  const profKey = actor.system.professions?.primary?.key;
  // Healthy Vigor (General): "Increase the size of your HP pool by 2."
  const perPool = (CONFIG.SACADIA.professionHpPerLevel[profKey] ?? 0)
    + (ownsAbility(actor, 'healthy_vigor') ? 2 : 0)
    // Mastery of Feather and Hide: "increase the size of your HP pools by the same amount" (1 per level).
    + (ownsAbility(actor, 'mastery_feather_and_hide') ? (actor.system.level ?? 0) : 0);
  const spend = await sacDialog.wait({
    window: { title: game.i18n.localize('SACADIA.Rest.HealTitle') },
    content: `<div class="adv-prompt">
      <label>${game.i18n.format('SACADIA.Rest.HealPrompt', { per: perPool, available })}</label>
      <input type="number" name="pools" value="${available}" min="0" max="${available}"/>
    </div>`,
    buttons: [
      { action: 'skip', label: game.i18n.localize('SACADIA.Rest.HealSkip'), callback: () => 0 },
      { action: 'heal', label: game.i18n.localize('SACADIA.Rest.HealDo'), default: true,
        callback: (e, b, d) => Math.round(Number(d.element.querySelector('[name="pools"]')?.value) || 0) },
    ],
    rejectClose: false,
  });
  const n = Math.min(Math.max(0, spend ?? 0), available);
  if (!n) return;
  const healed = Math.min(n * perPool, (actor.system.health.max ?? 0) - (actor.system.health.value ?? 0));
  await actor.update({
    'system.healthPools.value': available - n,
    'system.health.value': (actor.system.health.value ?? 0) + Math.max(0, healed),
  });
}

/** What a rest can change, read before and after it so the rest card can say what came back. */
function restSnapshot(actor) {
  const sys = actor.system;
  return {
    hp: sys.health?.value ?? 0, temp: sys.health?.temp ?? 0, hpPools: sys.healthPools?.value ?? 0, lore: sys.lorePoints?.value ?? 0,
    battleFatigue: sys.battleFatigue ?? 0,
    conditions: Object.fromEntries(Object.keys(CONFIG.SACADIA.conditions).map((k) => [k, sys.conditions?.[k]?.value ?? 0])),
    pools: Object.fromEntries(Object.keys(CONFIG.SACADIA.pools).filter((k) => sys.classPools?.[k]).map((k) => [k, sys.classPools[k].value ?? 0])),
  };
}

/**
 * The rest card: what the rest recovered (Health, HP pools spent, conditions cleared, Rend, ability pools, Lore, armor
 * repaired), compared with the snapshot taken before it, and the Slightly Cracked dice it rolled.
 */
async function restMessage(actor, kind, before, { cracked = null, repaired = 0 } = {}) {
  const loc = (k) => game.i18n.localize(k);
  const now = restSnapshot(actor);
  const rows = [];
  const row = (label, value) => rows.push(`<li><span class="rest-label">${label}</span><span class="rest-value">${value}</span></li>`);
  if (now.hp !== before.hp) row(loc('SACADIA.Rest.Health'), `${before.hp} → <b>${now.hp}</b> / ${actor.system.health?.max ?? now.hp}`);
  if (now.hpPools < before.hpPools) row(loc('SACADIA.Rest.HpPools'), game.i18n.format('SACADIA.Rest.PoolsSpent', { n: before.hpPools - now.hpPools, left: now.hpPools }));
  else if (now.hpPools > before.hpPools) row(loc('SACADIA.Rest.HpPools'), `${before.hpPools} → <b>${now.hpPools}</b>`);
  const cleared = Object.keys(before.conditions).filter((k) => k !== 'rended' && now.conditions[k] < before.conditions[k])
    .map((k) => `${loc(CONFIG.SACADIA.conditions[k].label)} ${before.conditions[k]}`);
  if (now.battleFatigue < before.battleFatigue) cleared.push(`${loc('SACADIA.Rest.BattleFatigue')} ${before.battleFatigue}`);
  if (now.temp < before.temp) cleared.push(`${loc('SACADIA.Rest.TempHp')} ${before.temp}`);
  if (cleared.length) row(loc('SACADIA.Rest.Cleared'), cleared.join(', '));
  const rend = [now.conditions.rended !== before.conditions.rended ? `${before.conditions.rended} → <b>${now.conditions.rended}</b>` : '',
    repaired ? loc('SACADIA.Rest.RendRepaired') : ''].filter(Boolean);
  if (rend.length) row(loc('SACADIA.Rest.Rend'), rend.join(' · '));
  const refilled = Object.keys(now.pools).filter((k) => now.pools[k] > (before.pools[k] ?? 0)).map((k) => `${loc(CONFIG.SACADIA.pools[k])} ${now.pools[k]}`);
  if (refilled.length) row(loc('SACADIA.Rest.Refilled'), refilled.join(', '));
  if (now.lore > before.lore) row(loc('SACADIA.Rest.Lore'), `${before.lore} → <b>${now.lore}</b>`);
  if (cracked) row(loc('SACADIA.Rest.Cracked'), cracked.dice[0].results.map((x) => `<b>${x.result}</b>`).join(' · '));
  const content = `<div class="sacadia chat-card rest-card">`
    + cardHead({ icon: kind === 'long' ? 'fa-solid fa-bed' : 'fa-solid fa-mug-hot', title: loc(kind === 'long' ? 'SACADIA.Rest.Long' : 'SACADIA.Rest.Short') })
    + (rows.length ? `<ul class="rest-list">${rows.join('')}</ul>` : `<div class="rc-sub">${loc('SACADIA.Rest.Nothing')}</div>`) + '</div>';
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls: cracked ? [cracked] : [] });
}
