/**
 * Shared helpers for the Quench batches (quench.mjs, sweep.mjs): waiting, compendium lookups, answering dialogs and
 * picking on the map without a person, recording errors, and tidying up what a batch creates.
 */
import { catalogIndex } from '../helpers/refresh.mjs';
import { replaceWith } from '../helpers/update-ops.mjs';
import { requestsSettled } from '../rules/requests.mjs';

export const PREFIX = '[Quench]';

/** Wait until `fn` returns something truthy (polling), or fail after `timeout` ms. */
export async function until(fn, { timeout = 8000, step = 50, what = 'a condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, step));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A compendium item's data by catalog id (any of the system's Item packs), without its _id. */
export async function fromCatalog(catalogId) {
  const e = (await catalogIndex()).get(catalogId);
  if (!e) throw new Error(`no compendium item ${catalogId}`);
  const data = (await fromUuid(e.uuid)).toObject();
  delete data._id;
  return data;
}

/**
 * Answer dialogs without a person: `responder(kind, options)` returns what the dialog would (kind is 'wait' or
 * 'confirm'). Every call is recorded. Call `restore()` when done.
 */
export function stubDialogs(responder) {
  const api = foundry.applications.api.DialogV2;
  const orig = { wait: api.wait, confirm: api.confirm };
  const calls = [];
  api.wait = async (o) => { calls.push({ kind: 'wait', title: o?.window?.title ?? '' }); return responder('wait', o); };
  api.confirm = async (o) => { calls.push({ kind: 'confirm', title: o?.window?.title ?? '' }); return responder('confirm', o); };
  return { calls, restore: () => Object.assign(api, orig) };
}

/**
 * What a person pressing Enter would get: a confirmation is accepted; a dialog with buttons runs its default (else
 * first) button's callback against the dialog's own content, so its fields' default values come through.
 */
export function autoAnswer(kind, o) {
  if (kind === 'confirm') return true;
  const buttons = o?.buttons ?? [];
  const button = buttons.find((b) => b.default) ?? buttons[0];
  if (!button) return null;
  if (typeof button.callback !== 'function') return button.action;
  const element = document.createElement('div');
  element.innerHTML = o.content ?? '';
  const form = element.querySelector('form') ?? element;
  return button.callback(new Event('click'), { dataset: { action: button.action }, form }, { element, form });
}

/**
 * Run `fn` while answering any map pick it starts: a point pick gets a click at `point`, and a tile pick (Swarm clouds)
 * is finished with Escape, keeping the tiles it starts with.
 */
export async function answeringMapPicks(fn, point) {
  const base = canvas?.stage?.listenerCount('pointerdown') ?? 0;
  let finished = false;
  const watcher = (async () => {
    while (!finished) {
      if ((canvas?.stage?.listenerCount('pointerdown') ?? 0) > base) {
        canvas.stage.emit('pointerdown', { getLocalPosition: () => ({ ...point }) });
        await sleep(30);
        if ((canvas?.stage?.listenerCount('pointerdown') ?? 0) > base) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      }
      await sleep(40);
    }
  })();
  try {
    return await fn();
  } finally {
    finished = true;
    await watcher;
  }
}

/**
 * Record errors while a test runs: uncaught errors, rejected promises, and console errors (the system and Foundry log
 * failed updates and failed GM requests there). Foundry's notification area throwing in a headless page is ignored.
 */
export function recordErrors() {
  const errors = [];
  const ignore = (text) => /setting 'hidden'|ResizeObserver/.test(text);
  const push = (text) => { if (!ignore(text)) errors.push(text); };
  const onError = (e) => push(`${e.message ?? e.error?.message}\n${e.error?.stack ?? ''}`);
  const onRejection = (e) => push(`unhandled rejection: ${e.reason?.message ?? e.reason}\n${e.reason?.stack ?? ''}`);
  const original = console.error;
  console.error = (...args) => { push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ')); original.apply(console, args); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return {
    errors,
    clear: () => { errors.length = 0; },
    stop: () => { console.error = original; window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); },
  };
}

/** Wait for the GM's handling of every card posted since `since` to finish (resolutions and their hooks). */
export async function settle(since) {
  await until(() => game.messages.contents.every((m) => (m.timestamp ?? 0) < since || !m.flags?.sacadia || m.flags.sacadia.handled
    || !Object.keys(m.flags.sacadia).some((k) => ['attack', 'grant', 'resist', 'tempHp', 'onUse', 'zone', 'heal', 'deltasOn', 'gainOn', 'pendingOn',
      'explodeAt', 'allianceShare', 'endFocus', 'reveal', 'cloudRefresh', 'storeMomentum'].includes(k))), { timeout: 10000, what: 'the GM to claim the cards' });
  await requestsSettled();
  await sleep(60); // hooks the requests set off (updates, Focus sync)
}

/** Put a test actor back to a clean state between uses: full Health and AP, no conditions, effects, marks or flags. */
export async function resetActor(actor, { keepItems = [], madness = 0 } = {}) {
  const drop = actor.items.filter((i) => !keepItems.includes(i.id)).map((i) => i.id);
  if (drop.length) await actor.deleteEmbeddedDocuments('Item', drop);
  if (actor.effects.size) await actor.deleteEmbeddedDocuments('ActiveEffect', actor.effects.map((e) => e.id));
  const upd = {
    'system.health.value': actor.system.health?.max ?? 10, 'system.health.temp': 0, 'system.ap.value': 10, 'system.actionLog': [],
    'system.combatState.focusRounds': replaceWith({}), 'system.combatState.focusTargets': replaceWith({}),
    'system.combatState.hitsByTarget': replaceWith({}), 'system.marks': replaceWith({}), 'system.pendingAttack': [],
    'system.armedBoosts': [], 'system.boostsUsed': [], 'system.reaction.value': 1, 'system.battleFatigue': 0, 'flags.sacadia': replaceWith({}),
  };
  for (const k of Object.keys(CONFIG.SACADIA.conditions)) upd[`system.conditions.${k}.value`] = k === 'madness' ? madness : 0;
  for (const k of Object.keys(actor.system.exhaustion ?? {})) upd[`system.exhaustion.${k}`] = false;
  await actor.update(upd);
}

/** Tracks what a batch creates and deletes it afterwards (actors, scenes, and the chat messages posted meanwhile). */
export function fixture() {
  const docs = [];
  let since = 0;
  return {
    start() { since = Date.now(); },
    get since() { return since; },
    track(doc) { docs.push(doc); return doc; },
    async actor(name, type, system = {}, extra = {}) {
      return this.track(await Actor.create({ name: `${PREFIX} ${name}`, type, system, ...extra }));
    },
    async clearMessages() {
      const msgs = game.messages.filter((m) => (m.timestamp ?? 0) >= since).map((m) => m.id);
      if (msgs.length) await ChatMessage.deleteDocuments(msgs);
    },
    async cleanup() {
      // Stop canvas animations first (damage numbers, token moves): deleting the scene under one leaves it drawing a
      // destroyed object.
      if (docs.some((d) => d?.documentName === 'Scene')) await foundry.canvas.animation.CanvasAnimation.terminateAll?.();
      for (const d of docs.reverse()) { try { if (d && !d.deleted && d.collection?.has?.(d.id)) await d.delete(); } catch { /* already gone */ } }
      await this.clearMessages();
    },
  };
}

/**
 * A scene with tokens for the given actors (`[key, actor, x, y, disposition]`), viewed on the canvas. Returns the scene
 * and the token documents by key.
 */
export async function arena(fx, placements) {
  const scene = fx.track(await Scene.create({ name: `${PREFIX} Arena`, width: 1400, height: 1400, grid: { size: 100, distance: 5 } }));
  await scene.view();
  await until(() => canvas.ready && canvas.scene?.id === scene.id, { timeout: 20000, what: 'the canvas' });
  const docs = [];
  for (const [, actor, x, y, disposition] of placements) docs.push((await actor.getTokenDocument({ x, y, disposition })).toObject());
  const created = await scene.createEmbeddedDocuments('Token', docs);
  const tok = Object.fromEntries(placements.map(([key], i) => [key, created[i]]));
  await until(() => Object.values(tok).every((t) => canvas.tokens.get(t.id)), { what: 'the tokens on the canvas' });
  return { scene, tok };
}

/** Target the given token documents (replacing any targets). */
export function target(...tokenDocs) {
  for (const t of [...game.user.targets]) t.setTarget(false, { releaseOthers: false });
  tokenDocs.forEach((d, i) => canvas.tokens.get(d.id)?.setTarget(true, { releaseOthers: i === 0 }));
}
