/**
 * Placed zones (book: "You create a sphere with radius 5Mft centered on a point you choose …", "choose an X by X
 * square within your ranged weapon range …"). A zone is a Scene Region carrying a `zone` behavior (a system
 * RegionBehavior subtype) that fires the zone's effect when a creature enters it or starts its turn inside.
 *
 * Lifetime: a zone made by a Focus lives while its caster maintains that Focus (the turn-start Focus prune and
 * the end-of-Insanity Focus teardown both drop it — see `pruneZones`); a zone from a plain action lasts until
 * the start of its caster's next turn; every zone is removed when combat ends. Moving a zone ("move the
 * center of this sphere 10ft every turn") is done by dragging the Region (GM).
 *
 * Effects (the `zone` behavior's `effect` object, authored per ability in src/modifiers.mjs ZONE_OVERRIDES and
 * resolved against the caster at cast time):
 *   - `check`: a Trait Check card vs the caster's Check DC — `{ trait, damage, onSuccess, inflict }`;
 *   - `damage`: automatic damage, no check (Focal Point);
 *   - `insideStatus`: a token status while inside (`shadowed` in Stygian Abyss, `obscured` in God's Mist);
 *   - `attackDisadvantage`: creatures inside make attacks at 1× disadvantage (Suppressing Fire) — read by the
 *     attacker's sheet;
 *   - `exitCheck`: a check to leave (Swirling Ink) — a save card; stopping the move is the GM's;
 *   - `affects`: 'enemies' (default — hostile to the caster), 'all', or 'allies'.
 * Difficult terrain rides a core Modify Movement Cost behavior on the same Region.
 */

import { ownsAbility, maintainsFocus } from './actor-utils.mjs';

/** Helpers the zone handler needs from the main module (damage, save cards), injected at init. */
let hooks = {};
export function configureZones(h) { hooks = h; }

/** Is `token` affected by a zone of `caster` under `affects`? Neutral tokens count as neither side. */
function affected(token, casterToken, affects) {
  if (!token?.actor) return false;
  const tDisp = token.disposition ?? token.document?.disposition ?? 0;
  const cDisp = casterToken?.disposition ?? casterToken?.document?.disposition ?? 0;
  if (affects === 'all') return true;
  if (affects === 'allies') return tDisp === cDisp;
  return tDisp !== cDisp && tDisp !== 0;
}

/**
 * The `zone` Region behavior type. Defined on demand (at init) rather than at import, so the pure helpers in this
 * module stay importable outside Foundry (tests).
 */
export function defineZoneBehavior() {
  const { REGION_EVENTS } = CONST;
  return class ZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    const f = foundry.data.fields;
    return {
      events: this._createEventsField({ events: [REGION_EVENTS.TOKEN_ENTER, REGION_EVENTS.TOKEN_EXIT, REGION_EVENTS.TOKEN_TURN_START],
        initial: [REGION_EVENTS.TOKEN_ENTER, REGION_EVENTS.TOKEN_EXIT, REGION_EVENTS.TOKEN_TURN_START] }),
      casterUuid: new f.StringField({ required: true, blank: true }),
      casterTokenUuid: new f.StringField({ required: true, blank: true }),
      ability: new f.StringField({ required: true, blank: true }),
      label: new f.StringField({ required: true, blank: true }),
      effect: new f.ObjectField({ required: true, initial: {} }),
    };
  }

  /** @override */
  async _handleRegionEvent(event) {
    if (game.users.activeGM !== game.user) return; // one authority applies effects
    const token = event.data?.token;
    if (!token?.actor) return;
    const caster = await fromUuid(this.casterUuid);
    const casterActor = caster?.actor ?? caster;
    const casterToken = await fromUuid(this.casterTokenUuid);
    if (!casterActor) return;
    // Layers that only apply while the caster maintains another Focus (Sharp Cloud on a Clouded Foe).
    const e = activeEffect(this.effect ?? {}, casterActor);
    // Each part may name its own audience (Stygian Abyss shadows everyone but only its Shrieking check hits enemies).
    const isCaster = token.actor === casterActor;
    const hits = (aff, incCaster = false) => (isCaster ? incCaster : affected(token, casterToken, aff ?? e.affects));
    const name = event.name;
    if (e.insideStatus && (name === REGION_EVENTS.TOKEN_ENTER || name === REGION_EVENTS.TOKEN_EXIT) && hits(e.statusAffects ?? e.affects, e.includeCaster)) {
      await token.actor.toggleStatusEffect(e.insideStatus, { active: name === REGION_EVENTS.TOKEN_ENTER });
    }
    if (name === REGION_EVENTS.TOKEN_EXIT && e.exitCheck && hits(e.exitCheck.affects ?? 'enemies')) {
      await hooks.saveCard?.({ caster: casterActor, target: token, trait: e.exitCheck.trait,
        text: game.i18n.format('SACADIA.Zone.Exit', { name: token.name, zone: this.label }) });
    }
    // "enters this space or starts their turn in it" — each at most once per turn per creature.
    const fires = (name === REGION_EVENTS.TOKEN_ENTER && e.onEnter !== false) || (name === REGION_EVENTS.TOKEN_TURN_START && e.onTurnStart !== false);
    if (!fires || (!e.check && !e.damage) || !hits(e.check?.affects)) return;
    const key = `${this.parent.id}:${game.combat?.round ?? 0}:${game.combat?.turn ?? 0}`;
    const seen = token.actor.getFlag('sacadia', 'zoneHits') ?? [];
    if (seen.includes(key)) return;
    await token.actor.setFlag('sacadia', 'zoneHits', [...seen.slice(-20), key]);
    if (e.check) {
      await hooks.saveCard?.({ caster: casterActor, target: token, trait: e.check.trait, damage: e.check.damage,
        onSuccess: e.check.onSuccess, inflict: e.check.inflict,
        text: game.i18n.format('SACADIA.Zone.Check', { name: token.name, zone: this.label }) });
    } else if (e.damage) {
      await hooks.zoneDamage?.({ caster: casterActor, target: token, formula: e.damage, label: this.label });
    }
  }
};
}

/** Is this token inside a zone that imposes attack disadvantage on it (Suppressing Fire)? */
export function zoneAttackDisadvantage(tokenDoc) {
  for (const region of tokenDoc?.regions ?? []) {
    for (const b of region.behaviors ?? []) {
      if (b.type === 'zone' && !b.disabled && b.system.effect?.attackDisadvantage) return b.system.label || region.name;
    }
  }
  return null;
}

/**
 * Create a zone Region (GM-side). `shape`: {type:'circle', x, y, radius} or {type:'rectangle', x, y, width, height}
 * in scene pixels. `difficult`: add a Modify Movement Cost behavior (×2).
 */
export async function createZone({ scene, casterUuid, casterTokenUuid, ability, label, shape, shapes, effect, difficult, focus,
  followCaster = false, radiusPerMadness = false, casterTurnDamage = 0, cloud = '', carry = false, followTokenUuid = '' }) {
  scene ??= canvas.scene;
  if (!scene) return null;
  // One cloud of each kind per caster: re-initiating replaces the old one.
  if (cloud) for (const r of zonesOf(casterUuid).filter((z) => z.flags.sacadia.zone.cloud === cloud)) await deleteZone(r);
  const behaviors = [{ type: 'zone', name: label, system: { casterUuid, casterTokenUuid, ability, label, effect } }];
  if (difficult) behaviors.push({ type: 'modifyMovementCost', name: `${label} (difficult terrain)`, system: { difficulties: { walk: 2 } } });
  const [region] = await scene.createEmbeddedDocuments('Region', [{
    name: label, color: effect?.affects === 'allies' ? '#4f9d69' : '#8a3b52', shapes: shapes ?? [shape], behaviors,
    flags: { sacadia: { zone: { casterUuid, casterTokenUuid, ability, focus: !!focus, followCaster, radiusPerMadness, casterTurnDamage,
      cloud, carry, followTokenUuid } } },
  }]);
  // Creatures already inside take the inside-status now (Stygian Abyss dropped onto them).
  if (region && effect?.insideStatus) {
    const casterToken = await fromUuid(casterTokenUuid);
    const casterActor = (await fromUuid(casterUuid))?.actor ?? await fromUuid(casterUuid);
    for (const t of region.tokens ?? []) {
      const ok = t.actor === casterActor ? !!effect.includeCaster : affected(t, casterToken, effect.affects);
      if (t.actor && ok) await t.actor.toggleStatusEffect(effect.insideStatus, { active: true });
    }
  }
  return region;
}

/** All zone Regions on the active scene, optionally for one caster. */
export function zonesOf(casterUuid) {
  return (canvas.scene?.regions ?? []).filter((r) => r.flags?.sacadia?.zone && (!casterUuid || r.flags.sacadia.zone.casterUuid === casterUuid));
}

/** Remove a zone, clearing the inside-statuses it (or its layers) gave, and Rolling Fog's speed lock. */
const deleting = new Set();
export async function deleteZone(region) {
  // Safe to call twice (a turn-start prune and a Focus sync can both reach the same zone).
  if (!region?.id || deleting.has(region.uuid) || !region.parent?.regions?.has(region.id)) return;
  deleting.add(region.uuid);
  try {
    await removeZone(region);
  } finally {
    deleting.delete(region.uuid);
  }
}

async function removeZone(region) {
  const b = region.behaviors?.find((x) => x.type === 'zone');
  const z = region.flags?.sacadia?.zone ?? {};
  const statuses = [b?.system?.effect?.insideStatus, ...(z.layerStatus ?? []).map((e) => e.split(':')[1])].filter(Boolean);
  for (const st of new Set(statuses)) for (const t of region.tokens ?? []) if (t.actor?.statuses?.has(st)) await t.actor.toggleStatusEffect(st, { active: false });
  if (z.followTokenUuid && z.casterUuid) {
    const c = await fromUuid(z.casterUuid);
    const ca = c?.actor ?? c;
    if (ca?.getFlag('sacadia', 'rollingFog')) await ca.unsetFlag('sacadia', 'rollingFog');
  }
  await region.delete();
}

/**
 * Drop the zones a caster no longer sustains: Focus zones whose Focus isn't running (`focusRounds` pruned at turn
 * start or cleared on going Insane), and action zones at the start of the caster's next turn.
 */
export async function pruneZones(actor, { turnStart = false } = {}) {
  const fr = actor.system.combatState?.focusRounds ?? {};
  for (const r of zonesOf(actor.uuid)) {
    const z = r.flags.sacadia.zone;
    if (z.focus ? !(fr[z.ability] > 0) : turnStart) await deleteZone(r);
  }
}

/**
 * The caster's turn start, for the zones that survive the prune: God's Mist "moves to you at the start of your
 * turn"; Stygian Abyss costs its caster HP each turn it stands (returned so the caller can apply it).
 * @returns {Promise<{label:string, damage:number}[]>}
 */
export async function casterZoneTurn(actor) {
  const costs = [];
  const tok = actor.getActiveTokens?.()[0];
  for (const r of zonesOf(actor.uuid)) {
    const z = r.flags.sacadia.zone;
    if (z.followCaster && tok) {
      const s = r._source.shapes?.[0];
      if (s?.type === 'circle') await r.update({ shapes: [{ ...s, x: tok.center.x, y: tok.center.y }] });
    }
    if (z.casterTurnDamage > 0) costs.push({ label: r.name, damage: z.casterTurnDamage });
  }
  return costs;
}

/** Madness-sized zones ("If your Madness changes, the radius of the aura changes"): 5ft per level. */
export async function resizeMadnessZones(actor) {
  const m = actor.system.conditions?.madness?.value ?? 0;
  for (const r of zonesOf(actor.uuid)) {
    if (!r.flags.sacadia.zone.radiusPerMadness) continue;
    const s = r._source.shapes?.[0];
    if (s?.type !== 'circle') continue;
    await r.update({ shapes: [{ ...s, radius: Math.max(1, m * 5 * canvas.dimensions.distancePixels) }] });
  }
}

/* -------------------------------------------- */
/*  Swarm clouds (v1.2 Clouded Foe / Clouded Ally) */
/* -------------------------------------------- */

const focusing = maintainsFocus;
const ownsId = ownsAbility;

/**
 * The zone effect with its live layers folded in. A layer `{ whileFocus, ownsAll?, …fields }` applies while the caster
 * maintains that Focus (and owns every ability in `ownsAll`); its fields override the base effect's. Pure but for the
 * actor read.
 */
export function activeEffect(effect, caster) {
  const out = { ...effect };
  delete out.layers;
  for (const layer of effect?.layers ?? []) {
    if (layer.whileFocus && !focusing(caster, layer.whileFocus)) continue;
    if ((layer.ownsAll ?? []).some((id) => !ownsId(caster, id))) continue;
    const { whileFocus, ownsAll, key, difficult, ...fields } = layer;
    Object.assign(out, fields);
  }
  return out;
}

/**
 * The clouds a token stands in, from its side: `hostileFoe` — owners of an enemy Clouded Foe it's inside (so it's
 * Surrounded, and Blackcloud / Sharp Cloud can reach it); `friendlyAlly` — owners of an allied Clouded Ally it's
 * inside (Partial Cover, Birdshield, Guiding Wingbeats). The cloud's own caster isn't "inside" its cloud.
 * @param {TokenDocument} tokenDoc
 * @returns {{hostileFoe: Actor[], friendlyAlly: Actor[], regions: RegionDocument[]}}
 */
export function cloudContext(tokenDoc) {
  const out = { hostileFoe: [], friendlyAlly: [], regions: [] };
  if (!tokenDoc) return out;
  const disp = tokenDoc.disposition ?? 0;
  for (const region of tokenDoc.regions ?? []) {
    const z = region.flags?.sacadia?.zone;
    if (!z?.cloud) continue;
    const ownerTok = fromUuidSync(z.casterTokenUuid);
    const owner = ownerTok?.actor ?? fromUuidSync(z.casterUuid);
    if (!owner || owner === tokenDoc.actor) continue;
    const oDisp = ownerTok?.disposition ?? 0;
    if (z.cloud === 'foe' && oDisp !== disp && disp !== 0) out.hostileFoe.push(owner);
    if (z.cloud === 'ally' && oDisp === disp) out.friendlyAlly.push(owner);
    out.regions.push(region);
  }
  return out;
}

/** Tokens inside a caster's cloud of a kind ('foe' | 'ally'), optionally only those hostile to the caster. */
export function tokensInCloud(casterUuid, kind, { hostileOnly = false } = {}) {
  const out = [];
  for (const r of zonesOf(casterUuid).filter((z) => z.flags.sacadia.zone.cloud === kind)) {
    const ownerTok = fromUuidSync(r.flags.sacadia.zone.casterTokenUuid);
    const cDisp = ownerTok?.disposition ?? 0;
    for (const t of r.tokens ?? []) {
      if (!t.actor || t.uuid === ownerTok?.uuid) continue;
      if (hostileOnly && ((t.disposition ?? 0) === cDisp || (t.disposition ?? 0) === 0)) continue;
      out.push(t);
    }
  }
  return out;
}

/**
 * A carried zone moves with its token: every tile shifts by the token's move (Clouded Foe: "all tiles move together").
 * Rolling Fog carries the cloud on its target instead of the caster. GM-side, from the token-update hook.
 */
export async function carryZones(tokenDoc, dx, dy) {
  if (!dx && !dy) return;
  for (const r of canvas.scene?.regions ?? []) {
    const z = r.flags?.sacadia?.zone;
    if (!z?.carry || (z.followTokenUuid || z.casterTokenUuid) !== tokenDoc.uuid) continue;
    const shapes = (r._source.shapes ?? []).map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    await r.update({ shapes });
  }
}

/**
 * Re-apply a caster's cloud layers (GM-side): statuses and difficult terrain that hold only while another Focus runs
 * (Dark Cloud → everyone inside treats the area as Dim, i.e. Obscured; Dark Steps → difficult terrain). Called when
 * a layer Focus is used and at the caster's turn start (after the Focus prune).
 */
export async function refreshCloudLayers(caster) {
  for (const r of zonesOf(caster.uuid).filter((z) => z.flags.sacadia.zone.cloud)) {
    const b = r.behaviors?.find((x) => x.type === 'zone');
    const z = r.flags.sacadia.zone;
    const layers = b?.system?.effect?.layers ?? [];
    // `key:status` pairs, kept as an array so a lapsed layer's entry is really removed (object updates merge).
    const layerStatus = new Set(z.layerStatus ?? []);
    for (const layer of layers) {
      const key = layer.key ?? layer.whileFocus;
      const live = (!layer.whileFocus || focusing(caster, layer.whileFocus)) && !(layer.ownsAll ?? []).some((id) => !ownsId(caster, id));
      if (layer.insideStatus) {
        for (const t of r.tokens ?? []) {
          if (!t.actor || t.actor === caster) continue;
          if (live !== !!t.actor.statuses?.has(layer.insideStatus)) await t.actor.toggleStatusEffect(layer.insideStatus, { active: live });
        }
        if (live) layerStatus.add(`${key}:${layer.insideStatus}`); else layerStatus.delete(`${key}:${layer.insideStatus}`);
      }
      if (layer.difficult) {
        const name = `${r.name} (${key})`;
        const existing = r.behaviors.find((x) => x.type === 'modifyMovementCost' && x.name === name);
        if (live && !existing) await r.createEmbeddedDocuments('RegionBehavior', [{ type: 'modifyMovementCost', name, system: { difficulties: { walk: 2 } } }]);
        if (!live && existing) await existing.delete();
      }
    }
    await r.update({ 'flags.sacadia.zone.layerStatus': [...layerStatus] });
  }
}
