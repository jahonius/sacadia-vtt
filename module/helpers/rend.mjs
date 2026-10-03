/**
 * Rend and Corroded (book p.258, pp.189–190). Rend removes armor points: "Randomly determines a piece of armor … that
 * provides them AD, MD, TD, or PD; randomly removes 1 PD, MD, TD, or AD provided from that piece of armor for each level
 * of Rend received. A creature must apply all levels of Rend to available armor (i.e., if a creature completely rends
 * one piece of armor, they move on to the next piece)." A fully rended piece breaks. Corroded gives a level of Rend per
 * level at the start of each turn, and "When a character cannot be Rended any further, all levels of Corroded
 * immediately turn into levels of Hemorrhage." The designer's ruling: Rend removes AD, MD, TD and PD only (never DR,
 * despite p.189), shields can be rended, and a creature wearing no armor can't be rended at all.
 *
 * The Rended condition's level stays the count of rend applied; this module moves the matching points onto the
 * creature's equipped armor pieces and shields (`system.rend` per piece) — an NPC's too, which its stat-block defenses
 * already count. Pure helpers first (unit-tested); the runtime below touches Foundry only inside functions.
 */

import { gearId, findGear } from './actor-utils.mjs';

export const REND_KEYS = ['ad', 'pd', 'td', 'md'];

/** Points left to rend on a piece: `{key: n}` (armor points minus the rend already taken). */
export function rendLeft(piece) {
  const out = {};
  for (const k of REND_KEYS) out[k] = Math.max(0, (piece.points?.[k] ?? 0) - (piece.rend?.[k] ?? 0));
  return out;
}

/** Total points left to rend across pieces. */
export function rendCapacity(pieces) {
  return (pieces ?? []).reduce((n, p) => n + Object.values(rendLeft(p)).reduce((a, b) => a + b, 0), 0);
}

/**
 * Spread `n` levels of Rend over armor pieces: a random piece (one with the preferred type left, if any — Clever Rend /
 * Rend Armor's choice), one random point per level from it (the preferred type first), moving to another piece once
 * it's empty. Returns `{ add: {pieceId: {key: n}}, applied }`; `applied` < `n` when the armor runs out.
 * @param {{id: string, points: object, rend: object}[]} pieces
 * @param {number} n
 * @param {{prefer?: string, rng?: () => number}} [opts]
 */
export function distributeRend(pieces, n, { prefer = '', rng = Math.random } = {}) {
  const state = (pieces ?? []).map((p) => ({ id: p.id, left: rendLeft(p) }));
  const add = {};
  const pick = (list) => list[Math.floor(rng() * list.length) % list.length];
  const total = (s) => Object.values(s.left).reduce((a, b) => a + b, 0);
  let applied = 0;
  let current = null;
  for (let i = 0; i < n; i++) {
    if (!current || total(current) === 0) {
      const open = state.filter((s) => total(s) > 0);
      if (!open.length) break;
      const preferred = prefer ? open.filter((s) => s.left[prefer] > 0) : [];
      current = pick(preferred.length ? preferred : open);
    }
    const keys = REND_KEYS.filter((k) => current.left[k] > 0);
    const key = prefer && current.left[prefer] > 0 ? prefer : pick(keys);
    current.left[key] -= 1;
    add[current.id] ??= {};
    add[current.id][key] = (add[current.id][key] ?? 0) + 1;
    applied += 1;
  }
  return { add, applied };
}

/**
 * Take `n` points of Rend back off armor (a rest; book p.234: "Reduce your armor Rend by 1"), from the most-rended piece
 * first. Returns `{ sub: {pieceId: {key: n}}, restored }`.
 */
export function restoreRend(pieces, n) {
  const state = (pieces ?? []).map((p) => ({ id: p.id, rend: { ...(p.rend ?? {}) } }));
  const sub = {};
  let restored = 0;
  for (let i = 0; i < n; i++) {
    const s = state.filter((x) => REND_KEYS.some((k) => (x.rend[k] ?? 0) > 0))
      .sort((a, b) => REND_KEYS.reduce((t, k) => t + (b.rend[k] ?? 0), 0) - REND_KEYS.reduce((t, k) => t + (a.rend[k] ?? 0), 0))[0];
    if (!s) break;
    const key = REND_KEYS.filter((k) => (s.rend[k] ?? 0) > 0).sort((a, b) => s.rend[b] - s.rend[a])[0];
    s.rend[key] -= 1;
    sub[s.id] ??= {};
    sub[s.id][key] = (sub[s.id][key] ?? 0) + 1;
    restored += 1;
  }
  return { sub, restored };
}

/* -------------------------------------------- */
/*  Runtime                                     */
/* -------------------------------------------- */

/** The rendable pieces of an actor: its equipped armor and shields (characters and NPCs alike). */
export function armorPieces(actor) {
  return actor.items.filter((i) => i.type === 'armor' && i.system.equipped)
    .map((i) => ({ id: i.id, points: { ...i.system.defenses }, rend: { ...(i.system.rend ?? {}) } }));
}

/** Total rend on an actor's equipped pieces, per armor type (an NPC's stat-block defenses lose these points). */
export function rendTotals(actor) {
  const out = Object.fromEntries(REND_KEYS.map((k) => [k, 0]));
  for (const p of armorPieces(actor)) for (const k of REND_KEYS) out[k] += Math.min(p.rend[k] ?? 0, p.points[k] ?? 0);
  return out;
}

/** Brittlework (adornment): "The first Rend dealt to you is dealt to this item and breaks it." The unbroken one, if any. */
function brittlework(actor) {
  return actor.items.find((i) => i.type !== 'ability' && gearId(i) === 'brittlework' && !i.getFlag('sacadia', 'broken'));
}

/**
 * preUpdateActor (every client): a rise in the Rended level is capped at what the armor can still take (plus an
 * unbroken Brittlework); the change and the attacker's preference ride `options.sacadiaRend` to the post-update step.
 */
export function rendPreUpdate(actor, changes, options) {
  const next = foundry.utils.getProperty(changes, 'system.conditions.rended.value');
  if (next == null) return;
  const cur = actor.system.conditions?.rended?.value ?? 0;
  const delta = next - cur;
  if (!delta) return;
  if (delta < 0) { options.sacadiaRend = { delta }; return; }
  const room = rendCapacity(armorPieces(actor)) + (brittlework(actor) ? 1 : 0);
  const applied = Math.min(delta, room);
  if (applied !== delta) foundry.utils.setProperty(changes, 'system.conditions.rended.value', cur + applied);
  options.sacadiaRend = { delta: applied, overflow: delta - applied, prefer: options.sacadiaRendPrefer ?? '' };
}

/**
 * updateActor (on the client that changed it): put the Rend on the armor (or take it back off), and when the armor
 * can take no more, turn Corroded into Hemorrhage.
 */
export async function rendPostUpdate(actor, options, userId) {
  const r = options?.sacadiaRend;
  if (!r || userId !== game.user.id) return;
  if (r.delta > 0) {
    let n = r.delta;
    const brittle = brittlework(actor);
    if (brittle && n > 0) { await brittle.setFlag('sacadia', 'broken', true); n -= 1; }
    const { add } = distributeRend(armorPieces(actor), n, { prefer: r.prefer });
    await writeRend(actor, add, 1);
    if (findGear(actor, 'stamped_feathers') && rendCapacity(armorPieces(actor)) === 0 && armorPieces(actor).length) {
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Rend.StampedFeathers', { name: actor.name })}</div>` });
    }
  } else if (r.delta < 0) {
    const { sub } = restoreRend(armorPieces(actor), -r.delta);
    await writeRend(actor, sub, -1);
  }
  // "When a character cannot be Rended any further, all levels of Corroded immediately turn into levels of Hemorrhage."
  const corroded = actor.system.conditions?.corroded?.value ?? 0;
  if (corroded > 0 && (r.overflow > 0 || (r.delta > 0 && rendCapacity(armorPieces(actor)) === 0 && !brittlework(actor)))) {
    const hem = actor.system.conditions?.hemorrhage?.value ?? 0;
    await actor.update({ 'system.conditions.corroded.value': 0,
      'system.conditions.hemorrhage.value': Math.min(CONFIG.SACADIA.conditionStoreMax, hem + corroded) });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Rend.CorrodedToHemorrhage', { name: actor.name, n: corroded })}</div>` });
  }
}

/** Apply per-piece rend changes (`sign` +1 adds, −1 removes). */
async function writeRend(actor, perPiece, sign) {
  const entries = Object.entries(perPiece ?? {});
  if (!entries.length) return;
  const updates = entries.map(([id, keys]) => {
    const item = actor.items.get(id);
    const u = { _id: id };
    for (const [k, n] of Object.entries(keys)) u[`system.rend.${k}`] = Math.max(0, (item?.system.rend?.[k] ?? 0) + sign * n);
    return u;
  });
  await actor.updateEmbeddedDocuments('Item', updates);
}

/** Corroded at a creature's turn start: one level of Rend per level (GM-side; the hooks above do the rest). */
export async function corrodedTurnStart(actor) {
  const n = actor.system.conditions?.corroded?.value ?? 0;
  if (!n) return;
  // No armor left to rend (or none at all): the Corroded turns into Hemorrhage straight away.
  if (rendCapacity(armorPieces(actor)) === 0 && !brittlework(actor)) {
    const hem = actor.system.conditions?.hemorrhage?.value ?? 0;
    await actor.update({ 'system.conditions.corroded.value': 0, 'system.conditions.hemorrhage.value': Math.min(CONFIG.SACADIA.conditionStoreMax, hem + n) });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Rend.CorrodedToHemorrhage', { name: actor.name, n })}</div>` });
  }
  const cur = actor.system.conditions?.rended?.value ?? 0;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia">${game.i18n.format('SACADIA.Rend.Corroded', { name: actor.name, n })}</div>` });
  await actor.update({ 'system.conditions.rended.value': cur + n });
}

/** The preferred armor type a giver rends first: Clever Rend's standing pick (PD / TD / MD), or ''. */
export function rendPreference(giver) {
  const clever = giver?.items?.find((i) => i.flags?.sacadia?.catalogId === 'clever_rend');
  return clever?.flags?.sacadia?.pickValue ?? '';
}
