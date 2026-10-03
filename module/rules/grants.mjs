/**
 * Granted effects (book: buffs and hindrances one creature gives another), GM-side: placing a grant and its Focus
 * anchor, consuming one-shot grants on their trigger, and reaping grants whose anchor is gone.
 */
import { everyActor } from '../helpers/actor-utils.mjs';

// Apply an ally-grant request (from a card flag): place a `grantedBy`-tagged Active Effect on each
// target. Focus grants also anchor to a caster-side effect (reaped when it dies); consumed grants have
// no anchor and persist until their trigger fires (see consumeGrants) or combat ends. GM-side.
export async function applyGrant({ casterUuid, ability, label, targets, changes, changesByTarget, duration, onEnd, statuses }) {
  const casterDoc = await fromUuid(casterUuid);
  const caster = casterDoc?.actor ?? casterDoc;
  if (!caster) return;
  const focus = duration?.type === 'focus';
  if (focus) {
    // Ensure a single anchor for this (caster, ability) — the authority for "still maintaining".
    let anchor = caster.effects.find((e) => e.flags?.sacadia?.anchor?.ability === ability);
    if (!anchor) {
      [anchor] = await caster.createEmbeddedDocuments('ActiveEffect', [{
        name: game.i18n.format('SACADIA.Grant.Anchor', { label }),
        img: 'icons/svg/aura.svg', changes: [],
        flags: { sacadia: { anchor: { ability } } },
      }]);
    }
    // What happens to the recipients when this Focus ends (Poured Mold, Winter Frost, Armor of Itthoa) rides the
    // anchor, so it fires once when the Focus truly drops (not when a grant's lease lapses) — see onAnchorEnded.
    if (onEnd && anchor) {
      const prior = anchor.flags?.sacadia?.onEnd?.targets ?? [];
      await anchor.update({ 'flags.sacadia.onEnd': { ...onEnd, targets: Array.from(new Set([...prior, ...targets])) } });
    }
  }
  // Focus grants are anchor-reaped; consumed grants are trigger-reaped (`on` = 'attack'/'damage-taken').
  const grantedBy = focus
    ? { casterUuid, ability, kind: 'focus' }
    : { casterUuid, ability, kind: duration?.type === 'rounds' ? 'rounds' : 'consumed', on: duration?.on || '' };
  for (const uuid of targets) {
    const doc = await fromUuid(uuid);
    const target = doc?.actor ?? doc;
    if (!target) continue;
    // Replace any prior grant from this caster+ability (no stacking on re-cast).
    const stale = target.effects.filter((e) => {
      const gb = e.flags?.sacadia?.grantedBy;
      return gb && gb.casterUuid === casterUuid && gb.ability === ability;
    }).map((e) => e.id);
    if (stale.length) await target.deleteEmbeddedDocuments('ActiveEffect', stale);
    await target.createEmbeddedDocuments('ActiveEffect', [{
      name: label, img: 'icons/svg/aura.svg',
      // A grant that puts the creature in a state (Catnap: Unconscious) while it lasts.
      ...(statuses?.length ? { statuses } : {}),
      changes: (changesByTarget?.[uuid] ?? changes ?? []).map((c) => ({ key: c.key, mode: c.mode, value: c.value })),
      // focus: lease backstop; rounds: expires with the combat clock (the turn-change sweep); consumed:
      // lives until its trigger.
      // A save-gated Focus grant (Bane, Catnap) isn't re-given on renewal, so it has no lease: the anchor reaps it.
      ...(focus && !duration?.noLease ? { duration: { rounds: 1 } } : duration?.type === 'rounds' ? { duration: { rounds: duration.rounds || 1 } } : {}),
      flags: { sacadia: { grantedBy } },
    }]);
  }
}

/** Delete an actor's consumed grants whose trigger matches `on` ('attack' / 'damage-taken'). GM-side. */
export async function consumeGrants(actor, on) {
  if (!actor) return;
  const ids = actor.effects.filter((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    return gb && gb.kind === 'consumed' && String(gb.on ?? '').split('|').includes(on);
  }).map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
}

/** Delete every embedded effect matching `pred` across the scene's tokens (GM-side). */
export async function removeSacadiaEffects(pred) {
  for (const actor of everyActor()) {
    const ids = actor.effects.filter(pred).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  }
}

// Backstop sweep: delete any grant whose anchor no longer exists anywhere (covers a caster token being
// removed without a per-effect delete hook). Runs on turn advance and token deletion.
export async function reapOrphanGrants() {
  if (game.users.activeGM !== game.user) return;
  const live = new Set();
  for (const actor of everyActor()) {
    for (const e of actor.effects) {
      const a = e.flags?.sacadia?.anchor;
      if (a) live.add(`${actor.uuid}|${a.ability}`);
    }
  }
  await removeSacadiaEffects((e) => {
    const gb = e.flags?.sacadia?.grantedBy;
    // Only anchor-backed (focus) grants are reaped here; consumed grants have no anchor and are
    // removed by their trigger (consumeGrants) or at combat end.
    return gb && gb.kind === 'focus' && !live.has(`${gb.casterUuid}|${gb.ability}`);
  });
}
