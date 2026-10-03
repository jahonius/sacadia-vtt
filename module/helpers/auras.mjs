/**
 * Caster-centred Focus auras, read from token geometry at the moment they matter (book: "all enemies within
 * Xft of you … as long as you maintain Focus"). Placed zones and Swarm clouds are Scene Regions — see zones.mjs.
 */

import { cloudContext } from './zones.mjs';
import { ownsAbility, actorToken, tokenDistance, maintainsFocus } from './actor-utils.mjs';

// The token helpers moved to actor-utils.mjs; re-exported for the modules that import them from here.
export { actorToken, tokenDistance };

const owns = ownsAbility;
const focusing = maintainsFocus;

/**
 * Hostile actors within `radius` ft of `actor` that own `abilityId` and currently maintain its Focus.
 * Hostility = a token disposition different from the subject's (neutral tokens count as neither side's).
 */
export function hostileAuraSources(actor, abilityId, radius) {
  const radiusOf = typeof radius === 'function' ? radius : () => radius;
  const me = actorToken(actor);
  if (!me) return [];
  const out = [];
  for (const t of globalThis.canvas?.tokens?.placeables ?? []) {
    const a = t.actor;
    if (!a || a === actor || !owns(a, abilityId) || !focusing(a, abilityId)) continue;
    if ((t.document.disposition ?? 0) === (me.document.disposition ?? 0)) continue;
    const d = tokenDistance(t, me);
    if (d != null && d <= radiusOf(a)) out.push(a);
  }
  return out;
}

/** Tokens hostile to `actor` within `radius` ft of its token. */
export function hostileTokensNear(actor, radius) {
  const me = actorToken(actor);
  if (!me) return [];
  return (globalThis.canvas?.tokens?.placeables ?? []).filter((t) => t !== me && t.actor
    && (t.document.disposition ?? 0) !== (me.document.disposition ?? 0) && (t.document.disposition ?? 0) !== 0
    && (tokenDistance(t, me) ?? Infinity) <= radius);
}

/**
 * Blackcloud (v1.2 Trickster Tactic): "All enemies inside Clouded Foe get 1X Disadvantage to all Trait Checks for as
 * long as you maintain Focus on Blackcloud." The checker stands in a hostile Clouded Foe whose caster maintains it.
 * (`group` is kept for the callers; v1.2 drops v1.0's mental-only limit.)
 */
export function blackcloudDisadvantage(actor, group) {
  const owners = cloudContext(actorToken(actor)?.document).hostileFoe;
  return owners.some((o) => (o.system?.combatState?.focusRounds?.blackcloud ?? 0) > 0 && owns(o, 'blackcloud')) ? 1 : 0;
}

/**
 * Blade Aura's radius for its owner: 5ft, 10ft with Bladius, 15ft with Greatius Bladius (Bladedancer and
 * Fatebound versions share the rule under their own ids).
 */
export function bladeAuraRadius(a, fatebound) {
  const p = fatebound ? '' : 'bd_';
  return owns(a, `${p}greatius_bladius`) ? 15 : owns(a, `${p}bladius`) ? 10 : 5;
}

export { owns as ownsAbilityId };

/* -------------------------------------------- */
/*  Prestige auras (Witch, Magus)                */
/* -------------------------------------------- */

const tokensOnScene = () => (globalThis.canvas?.tokens?.placeables ?? []).filter((t) => t.actor);
const conscious = (a) => !a.statuses?.has('unconscious') && !a.statuses?.has('dead');
const maintaining = (a, id) => (a?.system?.combatState?.focusRounds?.[id] ?? 0) > 0 && owns(a, id);
/** A Witch's aura radius: 5X ft, X = half her Proficiency (rounded up). */
const witchRadius = (a) => 5 * Math.ceil((a.system?.proficiency ?? 0) / 2);

/**
 * Witch's Presence (Witch L7): "Choose one Weak Adversarial Condition … Your whole party (including you) is immune to
 * this condition whenever you are present for the combat and conscious." A conscious, same-side Witch on the scene who
 * picked this condition.
 */
export function witchPresenceImmune(actor, condition) {
  const me = actorToken(actor);
  const disp = me?.document?.disposition ?? 0;
  return tokensOnScene().some((t) => (t.document.disposition ?? 0) === disp && conscious(t.actor)
    && (t.actor.system?._picks?.().condition ?? []).some((p) => p.id === 'wt_witchs_presence' && p.value === condition));
}

/**
 * Tempered Aura (Witch, Promise of Justice): "In a 5Xft aura around you, all creatures are immune to Panic and Taunt."
 */
export function temperedAuraImmune(actor, condition) {
  if (!['panic', 'taunt'].includes(condition)) return false;
  const me = actorToken(actor);
  if (!me) return false;
  return tokensOnScene().some((t) => maintaining(t.actor, 'wt_tempered_aura') && (tokenDistance(t, me) ?? Infinity) <= witchRadius(t.actor));
}

/**
 * Aura of the Grotto (+1: allies' Trait Checks against adversarial conditions) and Aura of Bane (−1: enemies'), each a
 * 5Xft Witch aura held by Focus. Returns the net advantage for this checker.
 */
export function witchCheckAura(actor) {
  const me = actorToken(actor);
  if (!me) return 0;
  const disp = me.document.disposition ?? 0;
  let adv = 0;
  for (const t of tokensOnScene()) {
    const d = tokenDistance(t, me);
    if (d == null) continue;
    const same = (t.document.disposition ?? 0) === disp;
    if (same && maintaining(t.actor, 'wt_aura_of_the_grotto') && d <= witchRadius(t.actor)) adv = Math.max(adv, 1);
    if (!same && (t.document.disposition ?? 0) !== 0 && maintaining(t.actor, 'wt_aura_of_bane') && d <= witchRadius(t.actor)) adv = Math.min(adv, -1) || -1;
  }
  return adv;
}

/** The radius of a growing Magus aura (Hallow's Calm / Gale): 5ft, +5ft each turn it's renewed, max 5×Proficiency. */
export function hallowRadius(a, id) {
  const rounds = a?.system?.combatState?.focusRounds?.[id] ?? 0;
  return 5 * Math.max(1, Math.min(rounds, a?.system?.proficiency ?? 1));
}

/**
 * Hallow's Calm (−1) / Hallow's Gale (+1): "All creatures within this aura gain 1X Disadvantage (Advantage) to attacks
 * made within this radius." Net advantage for an attacker standing inside such auras.
 */
export function hallowsAttackAdvantage(actor) {
  const me = actorToken(actor);
  if (!me) return { adv: 0, label: '' };
  let adv = 0; const labels = [];
  for (const t of tokensOnScene()) {
    for (const [id, v, label] of [['mg_hallows_calm', -1, "Hallow's Calm"], ['mg_hallows_gale', 1, "Hallow's Gale"]]) {
      if (!maintaining(t.actor, id)) continue;
      const d = t === me ? 0 : tokenDistance(t, me);
      if (d != null && d <= hallowRadius(t.actor, id)) { adv += v; labels.push(label); }
    }
  }
  return { adv, label: labels.join(', ') };
}

/** Oracles starting their turn inside Hallow's Calm lose 1 Madness; inside Hallow's Gale they gain 1. */
export function hallowsMadnessDelta(actor) {
  const me = actorToken(actor);
  if (!me) return 0;
  let delta = 0;
  for (const t of tokensOnScene()) {
    for (const [id, v] of [['mg_hallows_calm', -1], ['mg_hallows_gale', 1]]) {
      if (!maintaining(t.actor, id)) continue;
      const d = t === me ? 0 : tokenDistance(t, me);
      if (d != null && d <= hallowRadius(t.actor, id)) delta += v;
    }
  }
  return delta;
}

/**
 * Trend to Arcana (Lore): which side of an active source this actor rolls on — `ally` (the source itself or a same-side
 * creature within 30ft), `enemy` (a hostile creature within 30ft), or ''.
 */
export function trendSide(actor) {
  const me = actorToken(actor);
  if (!me) return '';
  let side = '';
  for (const t of tokensOnScene()) {
    if ((t.actor?.system?.bonuses?.trendToArcana ?? 0) <= 0) continue;
    if (t.actor === actor) return 'ally';
    const d = tokenDistance(t, me);
    if (d == null || d > 30) continue;
    const same = (t.document.disposition ?? 0) === (me.document.disposition ?? 0);
    if (same) return 'ally';
    if ((me.document.disposition ?? 0) !== 0) side = 'enemy';
  }
  return side;
}

/**
 * Confusion (Magus): "For as long as you maintain Focus, no other creatures within 30ft of you can initiate a new Focus
 * action" (60ft with Distant Confusion). The Magi holding it within reach of this actor.
 */
export function confusionSources(actor) {
  const me = actorToken(actor);
  if (!me) return [];
  return tokensOnScene().filter((t) => t !== me && t.actor !== actor && maintaining(t.actor, 'mg_confusion'))
    .filter((t) => (tokenDistance(t, me) ?? Infinity) <= (owns(t.actor, 'mg_distant_confusion') ? 60 : 30))
    .map((t) => t.actor);
}
