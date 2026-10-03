/**
 * Focus lifetime. A Focus is running while its ability has a streak in `system.combatState.focusRounds` — that counter is
 * the one source of truth (#spendAction raises it; the turn start drops what wasn't maintained). Whatever hangs off a
 * Focus is torn down here once the counter loses its ability, whichever path removed it (turn start, going Insane,
 * Confusion, Death Ward, Swarm Effects' cap, being found while Hidden, stepping off Stood Ground):
 *   - its anchor effect, whose deletion reaps the grants it gave and runs their `onEnd` (sacadia.mjs onAnchorEnded);
 *   - its mark (`system.marks[mark.key]`) and its per-Focus target set (`combatState.focusTargets`);
 *   - the zone it placed, and any Swarm cloud layer it fed.
 * GM-side (zones are scene Regions), called from the updateActor hook in sacadia.mjs. Runs are queued per actor, so two
 * changes in a row never try to delete the same anchor or zone twice.
 */
import { pruneZones, refreshCloudLayers } from './zones.mjs';
import { deleteKey } from './update-ops.mjs';

/** The abilities whose Focus is running (a positive streak). */
export function liveFocus(focusRounds) {
  return new Set(Object.entries(focusRounds ?? {}).filter(([, n]) => n > 0).map(([k]) => k));
}

/**
 * What ending Focus would remove, as plain data (unit-tested): anchors (effect ids) whose ability isn't live, the marks
 * those abilities set (by mark key), and the per-Focus target sets of abilities that aren't live.
 * @param {{focusRounds: object, anchors: {id: string, ability: string}[], markKeys: object, marks: object, focusTargets: object}} s
 */
export function focusTeardown({ focusRounds, anchors, markKeys, marks, focusTargets }) {
  const live = liveFocus(focusRounds);
  const ended = (anchors ?? []).filter((a) => !live.has(a.ability));
  const dropMarks = [...new Set(ended.map((a) => markKeys?.[a.ability]).filter((k) => k && k in (marks ?? {})))];
  const dropTargets = Object.keys(focusTargets ?? {}).filter((k) => !live.has(k));
  return { anchorIds: ended.map((a) => a.id), dropMarks, dropTargets };
}

const queues = new Map();

/** Tear down what hung off any Focus this actor no longer maintains (queued per actor; idempotent). */
export function syncFocus(actor) {
  if (!actor) return Promise.resolve();
  const key = actor.uuid;
  const run = (queues.get(key) ?? Promise.resolve()).then(() => teardown(actor));
  const settled = run.catch(() => {});
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return run;
}

async function teardown(actor) {
  const markKeys = {};
  for (const i of actor.items) {
    const k = i.system?.mark?.key;
    if (k) markKeys[i.flags?.sacadia?.catalogId ?? i.id] = k;
  }
  const anchors = actor.effects.filter((e) => e.flags?.sacadia?.anchor?.ability).map((e) => ({ id: e.id, ability: e.flags.sacadia.anchor.ability }));
  const { anchorIds, dropMarks, dropTargets } = focusTeardown({ focusRounds: actor.system.combatState?.focusRounds, anchors, markKeys,
    marks: actor.system.marks, focusTargets: actor.system.combatState?.focusTargets });
  const update = {};
  for (const k of dropMarks) update[`system.marks.${k}`] = deleteKey();
  for (const k of dropTargets) update[`system.combatState.focusTargets.${k}`] = deleteKey();
  if (Object.keys(update).length) await actor.update(update);
  const stillThere = anchorIds.filter((id) => actor.effects.has(id));
  if (stillThere.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stillThere);
  await pruneZones(actor);
  await refreshCloudLayers(actor);
}
