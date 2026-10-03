/**
 * Pure Boost logic (see docs/conditional-modifiers.md — "boosts"), factored out of the actor sheet so
 * it can be unit-tested without a live Foundry. The sheet's `#matchArmedBoosts` / `#foldBoostEffects`
 * are thin wrappers that gather `this`-state and delegate here.
 */
import { evaluatePredicate, resolveModifierValue, predicateAtoms } from "./derivation.mjs";

/**
 * Describe the action an ability represents, for boost matching: its attack categories, whether it has
 * a save, and its catalogId.
 * @param {object} actionItem  an ability Item (or item-like `{ system, flags }`)
 * @returns {{ attackCategories: Set<string>, hasSave: boolean, catalogId: string }}
 */
export function actionDescriptor(actionItem) {
  const activities = actionItem?.system?.activities ?? [];
  return {
    attackCategories: new Set(activities.filter((a) => a.type === "attack").map((a) => a.attack?.category).filter(Boolean)),
    hasSave: activities.some((a) => a.type === "save"),
    catalogId: actionItem?.flags?.sacadia?.catalogId ?? "",
    // The signature pool this action spends from (Blood for Bane rides "an action that would use a Spell Slot").
    pool: actionItem?.system?.costs?.pool?.key ?? "",
  };
}

/**
 * True if a boost's `appliesTo` matches an action descriptor. A boost matches by target-ability
 * catalogId (`kind: 'ability'`), any attack of an optional category (`kind: 'attack'`), or any save
 * (`kind: 'save'`). A boost never matches the action it's attached to (can't boost itself).
 * @param {object} appliesTo  the boost's `system.boost.appliesTo`
 * @param {ReturnType<typeof actionDescriptor>} desc
 * @returns {boolean}
 */
export function boostApplies(appliesTo, desc) {
  const at = appliesTo;
  if (!at?.kind) return false;
  // One ability, or several separated by '|' (a boost that rides either of two abilities).
  if (at.kind === "ability") return !!at.ability && !!desc.catalogId && at.ability.split("|").includes(desc.catalogId);
  if (at.kind === "pool") return !!desc.pool && (!at.pool || at.pool === desc.pool);
  if (at.kind === "attack") return desc.attackCategories.size > 0 && (!at.category || desc.attackCategories.has(at.category));
  if (at.kind === "save") return desc.hasSave;
  // "As a Boost to any action" (Glory of Storms, the Madness Boosts).
  if (at.kind === "any") return true;
  return false;
}

/**
 * Filter a list of candidate boost Items down to those that are armed *and* match the given action.
 * @param {object} actionItem  the ability being activated
 * @param {Iterable<object>} candidates  ability Items to consider (typically all of the actor's)
 * @param {Iterable<string>} armedIds  armed boost catalogIds
 * @returns {object[]} the matching, armed boost Items
 */
export function matchArmedBoosts(actionItem, candidates, armedIds) {
  const armed = new Set(armedIds ?? []);
  if (!armed.size) return [];
  const desc = actionDescriptor(actionItem);
  const out = [];
  for (const b of candidates ?? []) {
    if (b?.type !== "ability") continue;
    const cid = b.flags?.sacadia?.catalogId;
    const at = b.system?.boost?.appliesTo;
    if (!at?.kind || !armed.has(cid) || cid === desc.catalogId) continue;
    if (boostApplies(at, desc)) out.push(b);
  }
  return out;
}

/**
 * Accumulate a boost's effects (modifier-shaped) into a single activity's roll contribution — the same
 * sinks the roll-time modifier fold fills (flat to-hit/damage, die-steps, gated advantage, dice). Scope
 * honors global buckets (all/category); a mismatched category scope is skipped, as is any effect whose
 * predicate fails against `options`.
 * @param {Array} effects  the boost's `system.boost.effects`
 * @param {Record<string, number>} numbers  the actor's `_modifierNumbers()` map
 * @param {string} category  this activity's category ('melee'|'ranged'|'magic'|'')
 * @param {Record<string, unknown>} options  roll options for predicate evaluation
 * @param {string} [defaultLabel]  label when an effect has none
 * @returns {{toHit:number, damage:number, dieStep:number, advToHit:number, dice:Array, notes:Array}}
 */
export function foldBoostEffects(effects, numbers, category, options, defaultLabel = "Boost") {
  const out = { toHit: 0, damage: 0, dieStep: 0, advToHit: 0, saveAdv: 0, saveDc: 0, dice: [], notes: [] };
  const GLOBAL = ["all", "melee", "ranged", "magic"];
  for (const eff of effects ?? []) {
    const scope = eff.scope || "all";
    if (GLOBAL.includes(scope) && scope !== "all" && scope !== category) continue;
    const atoms = predicateAtoms(eff.predicate);
    if (!evaluatePredicate(atoms, options ?? {})) continue;
    const label = eff.label || defaultLabel;
    if (eff.target === "damageDice") {
      out.dice.push({ label, formula: eff.value });
      out.notes.push({ label, mode: "dice", value: eff.value, target: "damageDice" });
      continue;
    }
    const v = resolveModifierValue(eff.value, numbers);
    if (!v) continue;
    if (eff.target === "toHit") out.toHit += v;
    else if (eff.target === "damage") { if (eff.mode === "step") out.dieStep += v; else out.damage += v; }
    else if (eff.target === "dieStep") out.dieStep += v;
    else if (eff.target === "advantage.toHit") out.advToHit += v;
    // Boosts that debuff the save the boosted action forces (Enormity, Hoofslam) or raise its DC
    // (Conditioned Strike, Mad Spector).
    else if (eff.target === "saveAdvantage") out.saveAdv += v;
    else if (eff.target === "saveDc") out.saveDc += v;
    else continue;
    out.notes.push({ label, mode: eff.mode, value: v, target: eff.target });
  }
  return out;
}


/**
 * How many Boosts this action may take (book p.236: "You may only add one Boost to each action … Boosts
 * cannot be used on Reactions"). Exceptions: Boostbuster allows one on an opportunity attack, and Close
 * Quarter while Steadied allows boosts on its attack; Boosted Attack / Boost Stack allow two / three
 * unique Boosts on an attack with your divine weapon.
 * @param {{tag:string, opportunity:boolean, divine:boolean, steadied:boolean, catalogId:string}} action
 * @param {Set<string>} owned  the actor's ability catalogIds
 */
export function boostLimit(action, owned) {
  if (action.tag === "reaction") {
    if (action.opportunity && owned.has("boostbuster")) return 1;
    if (action.catalogId === "close_quarter" && action.steadied) return 1;
    return 0;
  }
  if (action.divine) {
    if (owned.has("boost_stack")) return 3;
    if (owned.has("boosted_attack")) return 2;
  }
  return 1;
}
