/**
 * Card requests to the GM's client: the flags a card carries for the active GM to apply (GM_REQUESTS), how they're
 * claimed, guarded and recovered when no GM was connected, and error reporting for GM-side automation.
 */
import { applyAllianceShare, endFocus } from '../helpers/prestige.mjs';
import { applyConditionDeltas } from '../helpers/conditions.mjs';
import { applyGainOn, applyOnUseInflict, applyPendingOn, applyTempHpGrant, explodeAround, revealWithin } from './effects.mjs';
import { applyGrant } from './grants.mjs';
import { createZone, refreshCloudLayers } from '../helpers/zones.mjs';
import { resolveAttack } from './attack.mjs';
import { resolveResist } from './saves.mjs';

/** Card flags that ask the GM's client to apply something (each resolved once, by the active GM). */
export const GM_REQUESTS = ['attack', 'explodeAt', 'grant', 'resist', 'tempHp', 'onUse', 'pendingOn', 'zone', 'gainOn', 'allianceShare', 'endFocus',
  'reveal', 'deltasOn', 'heal', 'cloudRefresh', 'storeMomentum'];

export const hasGmRequest = (s) => !!s && GM_REQUESTS.some((k) => s[k] != null && s[k] !== '');

/**
 * Apply a card's GM requests (GM-side). The card is claimed first (`flags.sacadia.handled`), so a reload or a second
 * call never applies it twice; each part runs on its own, and one that fails is reported to the GM (whispered, with the
 * error) instead of silently leaving the others half-done.
 */
export function resolveRequests(message) {
  const run = applyRequests(message);
  inFlight.add(run);
  run.finally(() => inFlight.delete(run));
  return run;
}

/** Resolutions still running (in memory, this client): tests wait on them before checking the results. */
const inFlight = new Set();
export const requestsSettled = () => Promise.allSettled([...inFlight]);

async function applyRequests(message) {
  const s = message.flags?.sacadia;
  if (!hasGmRequest(s) || s.handled) return;
  await message.update({ 'flags.sacadia.handled': true });
  const actorOf = async (uuid) => { const d = await fromUuid(uuid); return d?.actor ?? d; };
  const parts = {
    attack: () => resolveAttack(message, s.attack),
    explodeAt: async () => {
      if (!(s.explodeAt.damage > 0)) return;
      await explodeAround(await actorOf(s.explodeAt.attackerUuid), s.explodeAt.attackerUuid, s.explodeAt, { point: { x: s.explodeAt.x, y: s.explodeAt.y } });
    },
    grant: () => applyGrant(s.grant),
    resist: () => resolveResist(message, s.resist),
    tempHp: () => applyTempHpGrant(s.tempHp),
    onUse: () => applyOnUseInflict(s.onUse),
    pendingOn: () => applyPendingOn(s.pendingOn),
    zone: () => createZone(s.zone),
    gainOn: () => applyGainOn(s.gainOn),
    allianceShare: () => applyAllianceShare(s.allianceShare),
    endFocus: () => endFocus(s.endFocus),
    reveal: () => revealWithin(s.reveal),
    deltasOn: async () => { const a = await actorOf(s.deltasOn.uuid); if (a) await applyConditionDeltas(a, s.deltasOn.entries); },
    heal: async () => {
      const a = await actorOf(s.heal.uuid);
      if (a) await a.update({ 'system.health.value': Math.min(a.system.health?.max ?? Infinity, (a.system.health?.value ?? 0) + s.heal.amount) });
    },
    cloudRefresh: async () => { const a = await actorOf(s.cloudRefresh); if (a) await refreshCloudLayers(a); },
    storeMomentum: async () => (await actorOf(s.storeMomentum.uuid))?.setFlag('sacadia', 'storedMomentum',
      { d20: s.storeMomentum.d20, pinned: s.storeMomentum.pinned }),
  };
  // Started together, as before (none waits on another); each failure is caught on its own.
  const keys = GM_REQUESTS.filter((k) => s[k] != null && s[k] !== '');
  const results = await Promise.allSettled(keys.map((k) => Promise.resolve().then(parts[k])));
  const failed = results.map((r, i) => (r.status === 'rejected' ? { part: keys[i], error: r.reason } : null)).filter(Boolean);
  if (failed.length) {
    // Recorded on the card first, so the record survives whatever the reporting below runs into.
    await message.update({ 'flags.sacadia.failed': failed.map((f) => f.part) });
    for (const f of failed) reportError(`card ${message.id} (${f.part})`, f.error);
    await ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
      content: `<div class="sacadia gm-note">${game.i18n.format('SACADIA.Requests.Failed', {
        parts: failed.map((f) => f.part).join(', '), error: foundry.utils.escapeHTML(String(failed[0].error?.message ?? failed[0].error)) })}</div>` });
  }
}

/** Report an error from GM-side automation: the console keeps the stack, and the GM sees where it happened. */
export function reportError(where, error) {
  console.error(`Sacadia | ${where}:`, error);
  // A report must never become a second failure (a notification can throw while the UI is still drawing).
  try {
    if (game.user.isGM) ui.notifications.error(game.i18n.format('SACADIA.Requests.AutomationError', { where, error: String(error?.message ?? error) }));
  } catch { /* the console has it */ }
}

/**
 * Cards posted while no GM was connected (or that the GM's client missed) haven't been applied. On a GM's load, offer to
 * apply them in order; each such card also shows an Apply button to the GM. Only cards since tracking began count
 * (`requestsSince`, set on the first load with this version), so older cards are never re-applied.
 */
export function pendingRequests() {
  const since = game.settings.get('sacadia', 'requestsSince') || Infinity;
  return game.messages.contents.filter((m) => (m.timestamp ?? 0) >= since && hasGmRequest(m.flags?.sacadia) && !m.flags.sacadia.handled);
}
