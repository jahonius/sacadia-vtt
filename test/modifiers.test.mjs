import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveModifierValue, evaluatePredicate, modifierIsRollTime } from "../module/helpers/derivation.mjs";
import { MODIFIER_OVERRIDES, ACTIVITY_OVERRIDES, INFLICT_OVERRIDES, BOOST_OVERRIDES, MARK_OVERRIDES, TEMPHP_OVERRIDES, REACTION_GRANT_OVERRIDES, NEXT_ATTACK_OVERRIDES, ONUSE_OVERRIDES, KILLTRIGGER_OVERRIDES, MULTIATTACK_OVERRIDES, SELFSCALING_OVERRIDES, GRANT_OVERRIDES, CHOICEREDIRECT_OVERRIDES, PICK_OVERRIDES, PICK2_OVERRIDES, CHOICE_OVERRIDES, AID_RESIST_OVERRIDES } from "../src/modifiers.mjs";
import { boostApplies } from "../module/helpers/boosts.mjs";
import { loadCatalog } from "../src/build-adventures.mjs";

// Guard the authored Sentinel bow-ramp modifiers (combat-counter cluster): the formulas resolve as
// intended, and the predicates gate on the bow being the bound weapon (+ a new target where relevant).
const numbers = { wiles: 5, proficiency: 4, "combat.missedAttacks": 3, "combat.newTargets": 2 };
const one = (id) => MODIFIER_OVERRIDES[id][0];

test("Aim Calibration: ½Wiles per missed bow attack, on to-hit", () => {
  const m = one("aim_calibration");
  assert.equal(m.target, "toHit");
  assert.equal(resolveModifierValue(m.value, numbers), 9); // ceil(5/2)=3 × 3 missed
  const atoms = m.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:attack:weapon:bow": true }));
  assert.ok(!evaluatePredicate(atoms, { "self:attack:weapon:crossbow": true })); // bow only
});

test("Hawkeye: ½Prof per new-target hit, on to-hit, gated on a new target", () => {
  const m = one("hawkeye");
  assert.equal(m.target, "toHit");
  assert.equal(resolveModifierValue(m.value, numbers), 4); // ceil(4/2)=2 × 2 new
  const atoms = m.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:attack:weapon:bow": true, "target:new": true }));
  assert.ok(!evaluatePredicate(atoms, { "self:attack:weapon:bow": true })); // not a new target → no
});

test("Bowman: Prof per new-target hit, on damage, gated on a new target", () => {
  const m = one("bowman");
  assert.equal(m.target, "damage");
  assert.equal(resolveModifierValue(m.value, numbers), 8); // 4 × 2 new
  const atoms = m.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:attack:weapon:bow": true, "target:new": true }));
});

test("bow ramps contribute nothing before any missed/new-target state accrues", () => {
  const fresh = { wiles: 5, proficiency: 4, "combat.missedAttacks": 0, "combat.newTargets": 0 };
  assert.equal(resolveModifierValue(one("aim_calibration").value, fresh), 0);
  assert.equal(resolveModifierValue(one("hawkeye").value, fresh), 0);
  assert.equal(resolveModifierValue(one("bowman").value, fresh), 0);
});

test("Bigger Stones: each copy is a die-step on attacks with its own picked ranged weapon", () => {
  assert.deepEqual(PICK_OVERRIDES.bigger_stones, { kind: "weaponType", options: ["bow", "crossbow", "sling"] });
  const [mod, ...rest] = MODIFIER_OVERRIDES.bigger_stones;
  assert.equal(rest.length, 0);
  assert.equal(mod.target, "damage");
  assert.equal(mod.mode, "step");
  assert.equal(resolveModifierValue(mod.value, {}), 1);
  assert.deepEqual(mod.predicate.map((p) => p.atom), ["self:attack:picked:bigger_stones"]);
});

test("Favored Enemy, I Favor All Enemies and Favored Mastery each pick a favored creature type", () => {
  for (const id of ["favored_enemy", "i_favor_all_enemies", "legendary_favored"]) assert.equal(PICK_OVERRIDES[id].kind, "favored", id);
});

test("Favored Mastery: half Wiles to hit and damage against the one favored type its second pick names", () => {
  assert.equal(PICK2_OVERRIDES.legendary_favored.kind, "ownFavored");
  for (const m of MODIFIER_OVERRIDES.legendary_favored) {
    const atoms = m.predicate.map((p) => p.atom);
    assert.ok(evaluatePredicate(atoms, { "target:favored": true, "target:pick2:legendary_favored": true }), m.target);
    assert.ok(!evaluatePredicate(atoms, { "target:favored": true }), `${m.target}: not against another favored type`);
    assert.equal(resolveModifierValue(m.value, { wiles: 5 }), 2);
  }
});

test("Fated Strike: its pick is the divine weapon, and +Fate applies to attacks with it only", () => {
  assert.equal(PICK_OVERRIDES.fated_strike.kind, "divineWeapon");
  const [m] = MODIFIER_OVERRIDES.fated_strike;
  assert.ok(evaluatePredicate(m.predicate.map((p) => p.atom), { "self:attack:divine": true }));
  assert.ok(!evaluatePredicate(m.predicate.map((p) => p.atom), { "self:attack:weapon:sword": true }));
});

test("Named Weapons: each names its weapon on the ability (The Vengeance as its second pick)", () => {
  for (const id of ["bd_sharp_weapon", "bd_exploding_weapon", "bd_jagged_blade", "bd_tricky_boy", "bd_weapon_tail"]) assert.equal(PICK_OVERRIDES[id].kind, "namedWeapon", id);
  assert.equal(PICK_OVERRIDES.bd_the_vengeance.kind, "creature");
  assert.equal(PICK2_OVERRIDES.bd_the_vengeance.kind, "namedWeapon");
});

test("Sling Mastery: +1 Check DC when you give its chosen condition, by save or by Trait Checks", () => {
  assert.equal(PICK_OVERRIDES.mastery_sling.kind, "condition");
  assert.ok(!PICK_OVERRIDES.mastery_sling.options.includes("madness"));
  const dc = MODIFIER_OVERRIDES.mastery_sling.filter((m) => m.target === "saveDc" || m.target === "checkDcVs");
  assert.deepEqual(dc.map((m) => m.predicate[0].atom).sort(), ["inflict:picked:mastery_sling", "vs:saving:picked:mastery_sling"]);
  for (const m of dc) assert.ok(modifierIsRollTime(m));
});

test("pick overrides: every ability with a pick (or a second one) is built with it, whichever pack it's in", () => {
  const catalog = loadCatalog();
  for (const [field, table] of [["pick", PICK_OVERRIDES], ["pick2", PICK2_OVERRIDES]]) {
    for (const [id, p] of Object.entries(table)) assert.equal(catalog.get(id)?.doc.system[field]?.kind, p.kind, `${id} ${field}`);
  }
});

test("pick overrides: every pick label is in the language file", () => {
  const en = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const at = (key) => key.split(".").reduce((o, k) => o?.[k], en);
  for (const table of [PICK_OVERRIDES, PICK2_OVERRIDES]) {
    for (const [id, p] of Object.entries(table)) if (p.label) assert.equal(typeof at(p.label), "string", `${id}: ${p.label}`);
  }
});

test("Favored Style: the Fontmade element is a pick shown only to a Sentinel who favors Fontmade", () => {
  assert.deepEqual(PICK_OVERRIDES.favored_style, { kind: "element", label: "SACADIA.Pick.Label.Fontmade", requires: ["self:favored:fontmade"] });
});

test("Destrap: ranged attack vs PD, no damage, inflicts Rend ½Prof", () => {
  const a = ACTIVITY_OVERRIDES.destrap[0];
  assert.equal(a.type, "attack");
  assert.equal(a.attack.defense, "pd");   // needed for hit resolution (prose named no defense)
  assert.equal(a.noDamage, true);          // rend instead of damage
  assert.deepEqual(a.damage, []);
  assert.equal(resolveModifierValue(a.inflict[0].amount, { proficiency: 5 }), 3); // ceil(5/2)
  assert.equal(a.inflict[0].condition, "rended");
});

test("Reflex Test: authored Finesse save → Slowed ½Prof (no attack roll)", () => {
  const a = ACTIVITY_OVERRIDES.reflex_test[0];
  assert.equal(a.type, "save");
  assert.equal(a.save.trait, "finesse");
  assert.equal(a.inflict[0].condition, "slowed");
  assert.equal(resolveModifierValue(a.inflict[0].amount, { proficiency: 4 }), 2); // ceil(4/2)
});

test("Expert Marksman negates the Half-cover penalty but not Full", () => {
  const atoms = MODIFIER_OVERRIDES.expert_marksman[0].predicate.map((p) => p.atom);
  // Half cover (rank 1): target:cover:half true, full false → +1 advantage applies (cancels −1).
  assert.ok(evaluatePredicate(atoms, { "target:cover:half": true }));
  // Full cover (rank 2): both flags true → the `!target:cover:full` clause blocks it.
  assert.ok(!evaluatePredicate(atoms, { "target:cover:half": true, "target:cover:full": true }));
  // No cover → no bonus.
  assert.ok(!evaluatePredicate(atoms, {}));
});

test("Curving Shots reduces the Full-cover penalty (fires only vs full cover)", () => {
  const atoms = MODIFIER_OVERRIDES.curving_shots[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "target:cover:half": true, "target:cover:full": true }));
  assert.ok(!evaluatePredicate(atoms, { "target:cover:half": true })); // half only → doesn't apply
});

/* ---- Thug: Wrestle Pin scaling (the `@target.pinned` value-ref + `target:condition:pinned` gate) ---- */
const thugN = { proficiency: 6, finesse: 5, "target.pinned": 3 };

test("Pankration adds the target's Pin to melee + Harm damage; Champion doubles it", () => {
  const pk = MODIFIER_OVERRIDES.thug_pankration;
  assert.deepEqual(pk.map((m) => m.scope).sort(), ["melee", "thug_harm"]);
  assert.equal(resolveModifierValue(pk[0].value, thugN), 3); // = target Pin
  // Base Pankration drops out once you own Pankration's Champion (supersede pair).
  const atoms = pk[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "target:condition:pinned": 3 }));
  assert.ok(!evaluatePredicate(atoms, { "target:condition:pinned": 3, "self:ability:thug_pankrations_champion": true }));
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.thug_pankrations_champion[0].value, thugN), 6); // 2× Pin
});

test("Kneejerk fires only at exactly one Pin; Suplex needs Pin + Prone", () => {
  const kj = MODIFIER_OVERRIDES.thug_kneejerk[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(kj, { "target:condition:pinned": 1 }));
  assert.ok(!evaluatePredicate(kj, { "target:condition:pinned": 2 }));
  const sx = MODIFIER_OVERRIDES.thug_suplex[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(sx, { "target:condition:pinned": 2, "target:condition:prone": true }));
  assert.ok(!evaluatePredicate(sx, { "target:condition:pinned": 2 })); // not prone → no
});

test("Harm scales its die count off the target's Pin; Render rends per Pin (no damage)", () => {
  const harm = ACTIVITY_OVERRIDES.thug_harm[0];
  assert.equal(harm.type, "save");
  assert.equal(harm.save.trait, "finesse");
  assert.equal(harm.damage[0].denomination, 10);
  assert.equal(resolveModifierValue(harm.damage[0].count, thugN), 3); // (Pin)d10
  assert.equal(resolveModifierValue(harm.damage[0].count, { "target.pinned": 0 }), 0); // no Pin → inert
  const render = ACTIVITY_OVERRIDES.thug_render[0];
  assert.equal(render.type, "attack");
  assert.equal(render.noDamage, true);
  assert.equal(render.inflict[0].condition, "rended");
  assert.equal(resolveModifierValue(render.inflict[0].amount, thugN), 3);
});

test("Natural Wrestler gives Pin ½Prof; the trick save-inflicts apply simple conditions", () => {
  assert.equal(INFLICT_OVERRIDES.thug_natural_wrestler[0].condition, "pinned");
  assert.equal(resolveModifierValue(INFLICT_OVERRIDES.thug_natural_wrestler[0].amount, thugN), 3); // ceil(6/2)
  assert.equal(INFLICT_OVERRIDES.thug_feint[0].condition, "surprised");
  assert.equal(INFLICT_OVERRIDES.thug_bully[0].condition, "prone");
  assert.equal(INFLICT_OVERRIDES.thug_blinding_strike[0].condition, "blinded");
  assert.deepEqual(INFLICT_OVERRIDES.thug_forceful_pinnings.map((i) => i.condition).sort(), ["dragged", "prone"]);
});

test("Rage die-steps gate on the Raging state; Gutwrenching Twist supersedes Strike", () => {
  for (const id of ["thug_focused_rage", "thug_freaking_strong", "thug_raging_harm"]) {
    const atoms = MODIFIER_OVERRIDES[id][0].predicate.map((p) => p.atom);
    assert.ok(evaluatePredicate(atoms, { "self:raging": true }), `${id} fires while raging`);
    assert.ok(!evaluatePredicate(atoms, {}), `${id} inert while calm`);
  }
  // Strong Fists steps only the bound unarmed weapon.
  const sf = MODIFIER_OVERRIDES.thug_strong_fists[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(sf, { "self:attack:weapon:unarmed": true }));
  assert.ok(!evaluatePredicate(sf, { "self:attack:weapon:sword": true }));
  // Gutwrenching Strike (½Fin) drops out once Twist (full Fin) is owned.
  const gs = MODIFIER_OVERRIDES.thug_gutwrenching_strike[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(gs, {}));
  assert.ok(!evaluatePredicate(gs, { "self:ability:thug_gutwrenching_twist": true }));
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.thug_gutwrenching_twist[0].value, thugN), 5); // full Finesse
});

/* ---- General (cross-class) passives + the Divine Strike boost ---- */
test("General passives: Graceful Saving (+Fate trait), Check Please (+1 DC), Healthy Vim (+2/level)", () => {
  const N = { fate: 4, level: 7 };
  assert.equal(MODIFIER_OVERRIDES.graceful_saving[0].target, "trait");
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.graceful_saving[0].value, N), 4);
  assert.equal(MODIFIER_OVERRIDES.check_please[0].target, "checkDc");
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.check_please[0].value, N), 1);
  assert.equal(MODIFIER_OVERRIDES.healthy_vim[0].target, "health.max");
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.healthy_vim[0].value, N), 14);
});

test("Reaction economy: Rapid Reaction raises the max (passive), Reactionary grants one (on use)", () => {
  // Rapid Reaction is a passive +1 to the `reactions` sink → base-actor derives reaction.max = 1 + this.
  const rr = MODIFIER_OVERRIDES.rapid_reaction[0];
  assert.equal(rr.target, "reactions");
  assert.equal(rr.predicate.length, 0); // always on
  assert.equal(resolveModifierValue(rr.value, {}), 1);
  // Derivation mirror: max = 1 (baseline) + folded reactions.
  assert.equal(Math.max(0, 1 + 1), 2);
  // Reactionary banks a one-off extra reaction for the round (grantsReaction, applied in #useAbility).
  assert.equal(REACTION_GRANT_OVERRIDES.reactionary, 1);
});

test("Positional: Surrounded by Me scales damage per adjacent enemy; Flanking Forces gates on target Surrounded", () => {
  const N = { proficiency: 4, adjacentEnemies: 3 };
  const sbm = BOOST_OVERRIDES.bd_surrounded_by_me.effects[0];
  assert.equal(sbm.target, "damage");
  assert.equal(resolveModifierValue(sbm.value, N), 6); // ceil(4/2) * 3 adjacent enemies
  assert.equal(resolveModifierValue(sbm.value, { proficiency: 4, adjacentEnemies: 0 }), 0); // nobody adjacent
  const ff = BOOST_OVERRIDES.thug_flanking_forces.effects[0];
  assert.equal(ff.target, "advantage.toHit");
  assert.deepEqual(ff.predicate.map((p) => p.atom), ["target:surrounded"]);
  assert.ok(evaluatePredicate(["target:surrounded"], { "target:surrounded": true }));
  assert.ok(!evaluatePredicate(["target:surrounded"], {}));
});

test("Positional: Propped Up steps melee dice per adjacent ally, gated on maintaining Protectorate", () => {
  const pu = MODIFIER_OVERRIDES.propped_up[0];
  assert.equal(pu.scope, "melee");
  assert.equal(pu.mode, "step");
  assert.equal(resolveModifierValue(pu.value, { adjacentAllies: 2 }), 2);
  assert.deepEqual(pu.predicate.map((p) => p.atom), ["self:used:protectorate"]);
  // Its @adjacent value must route it to the roll-time fold (not prep-folded, where the count is unknown).
  assert.ok(modifierIsRollTime(pu));
});

test("Astonishing Shout: temp HP per adjacent ally and next-attack damage per adjacent enemy, each ½Prof-capped", () => {
  const th = TEMPHP_OVERRIDES.astonishing_shout;
  assert.equal(th.target, "self");
  // ½Prof(=2) temp per ally, capped at ½Prof allies: 3 allies → min(3,2)=2 → 2×2 = 4.
  assert.equal(resolveModifierValue(th.formula, { proficiency: 4, adjacentAllies: 3 }), 4);
  assert.equal(resolveModifierValue(th.formula, { proficiency: 4, adjacentAllies: 1 }), 2); // 1 ally → 2
  assert.equal(resolveModifierValue(th.formula, { proficiency: 4, adjacentAllies: 0 }), 0); // none → 0
  const pb = NEXT_ATTACK_OVERRIDES.astonishing_shout;
  assert.equal(pb.on, "use");
  // Same shape on the enemy side, banked as next-attack damage: 5 enemies → min(5,2)=2 → 2×2 = 4.
  assert.equal(resolveModifierValue(pb.damage, { proficiency: 4, adjacentEnemies: 5 }), 4);
  assert.equal(resolveModifierValue(pb.damage, { proficiency: 4, adjacentEnemies: 0 }), 0);
  // No roll of its own — the mis-detected damage activity is cleared.
  assert.deepEqual(ACTIVITY_OVERRIDES.astonishing_shout, []);
});

test("On-use inflicts: Predator and Prey mirrors ½Prof Sting to attacker + self; That Sluggish Feeling slows", () => {
  const pp = ONUSE_OVERRIDES.predator_and_prey;
  assert.equal(pp.self[0].condition, "sting");
  assert.equal(pp.target[0].condition, "sting");
  assert.equal(resolveModifierValue(pp.self[0].amount, { proficiency: 5 }), 3);   // ceil(5/2)
  assert.equal(resolveModifierValue(pp.target[0].amount, { proficiency: 5 }), 3); // same to the attacker
  const ts = ONUSE_OVERRIDES.that_sluggish_feeling;
  assert.equal(ts.target[0].condition, "slowed");
  assert.equal(resolveModifierValue(ts.target[0].amount, {}), 1);
});

test("Named/Divine weapon: Sharp Weapon + Extra Sharp stack on named; Humongous/Ridiculous need heavy divine; Slamstrike needs bludgeon+Prone", () => {
  const named = { "self:attack:named-by:bd_sharp_weapon": true }; // v1.2: the weapon named "Sharp Weapon"
  for (const id of ["bd_sharp_weapon", "bd_extra_sharp"]) {
    const m = MODIFIER_OVERRIDES[id][0];
    assert.equal(m.mode, "step");
    assert.equal(resolveModifierValue(m.value, {}), 1);
    assert.ok(modifierIsRollTime(m)); // self:attack:* → roll-time
    assert.ok(evaluatePredicate(m.predicate.map((p) => p.atom), named));
  }
  // Heavy divine buffs require both the divine designation and a two-handed weapon.
  const hum = MODIFIER_OVERRIDES.humongous[0].predicate.map((p) => p.atom);
  assert.deepEqual(hum, ["self:attack:divine", "self:attack:hands:2"]);
  assert.ok(evaluatePredicate(hum, { "self:attack:divine": true, "self:attack:hands:2": true }));
  assert.ok(!evaluatePredicate(hum, { "self:attack:divine": true, "self:attack:hands:1": true })); // 1H → no
  // Slamstrike: divine + bludgeon family + a Prone target.
  const slam = MODIFIER_OVERRIDES.slamstrike[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(slam, { "self:attack:divine": true, "self:attack:weapon:bludgeon": true, "target:condition:prone": true }));
  assert.ok(!evaluatePredicate(slam, { "self:attack:divine": true, "self:attack:weapon:bludgeon": true })); // standing → no
});

test("Kill triggers: Killing Frenzy banks next-target Surprised; Indomitable Beast picks temp-HP tier by level", () => {
  assert.equal(KILLTRIGGER_OVERRIDES.thug_killing_frenzy.condition, "surprised");
  const tiers = KILLTRIGGER_OVERRIDES.indomitable_beast.tempHp;
  // Mirror fireKillTriggers' selection: highest minLevel ≤ actor level.
  const pick = (level) => tiers.filter((t) => level >= t.minLevel).sort((a, b) => b.minLevel - a.minLevel)[0].formula;
  assert.equal(pick(1), "1d10");
  assert.equal(pick(4), "1d10");
  assert.equal(pick(5), "2d6");
  assert.equal(pick(10), "2d6");
  assert.equal(pick(11), "2d8");
  assert.equal(pick(20), "2d8");
});

test("Forced-movement family: the save + condition are automated (displacement stays DM-adjudicated)", () => {
  // Sweep's Power-save Prone was missed by the detector — now authored as an inflict on its save activity.
  assert.equal(INFLICT_OVERRIDES.sweep[0].condition, "prone");
  // Domino Effect's Finesse-save → Prone on the second creature: a full save activity (prose read as passive).
  const de = ACTIVITY_OVERRIDES.bd_domino_effect[0];
  assert.equal(de.type, "save");
  assert.equal(de.save.trait, "finesse");
  assert.equal(de.inflict[0].condition, "prone");
});

test("Throw/Kick: Plural Throw is 2 (→3 Triple) with level-scaling die; Spear Throw +2 dice; Ribcrack Finesse d6", () => {
  const pt = MULTIATTACK_OVERRIDES.bd_plural_throw;
  assert.equal(pt.count, 2);
  assert.equal(pt.upgrade.ability, "bd_triple_throw");
  assert.equal(pt.upgrade.count, 3);
  // Plural Throw's die grows 1d6 → 1d8@5 → 1d10@11 (ladder d8=3, d10=4).
  assert.deepEqual(SELFSCALING_OVERRIDES.bd_plural_throw, [{ level: 5, ladderIndex: 3 }, { level: 11, ladderIndex: 4 }]);
  // Spear Throw: +2 damage die-steps on its own thrown attack.
  const st = MODIFIER_OVERRIDES.spear_throw[0];
  assert.equal(st.mode, "step");
  assert.equal(st.scope, "spear_throw");
  assert.equal(resolveModifierValue(st.value, {}), 2);
  // Ribcrack: a Kick boost — Finesse d6 damage riding Kick's failed check, no activity of its own.
  assert.deepEqual(ACTIVITY_OVERRIDES.ribcrack, []);
  assert.equal(BOOST_OVERRIDES.ribcrack.appliesTo.ability, "basic_kick");
  assert.equal(BOOST_OVERRIDES.ribcrack.special.saveDamage[0].formula, "(@finesse)d6");
});

test("Kick/Harm/Pin boosts: tiers, targets, and specials", () => {
  const hb = BOOST_OVERRIDES.thug_horn_butting.special.saveDamage;
  const tierAt = (lvl) => hb.filter((t) => lvl >= t.level).at(-1).formula;
  assert.equal(tierAt(4), "1d10 + @power");
  assert.equal(tierAt(5), "2d6 + @power");
  assert.equal(tierAt(12), "2d8 + @power");
  assert.deepEqual(BOOST_OVERRIDES.tripping_kick.inflict, [{ condition: "prone", amount: "1" }]);
  assert.deepEqual(BOOST_OVERRIDES.thug_tangled_harm.special.targetDelta, { pinned: -1 });
  assert.equal(BOOST_OVERRIDES.thug_stored_momentum.appliesTo.ability, "thug_harm");
  assert.deepEqual(BOOST_OVERRIDES.thug_biting_pankration.special.requires, ["target:hits>=4"]);
  // Boosted Fury trades X to-hit for 2X damage.
  const bf = BOOST_OVERRIDES.boosted_fury.effects;
  assert.equal(resolveModifierValue(bf[0].value, { spent: 3 }), -3);
  assert.equal(resolveModifierValue(bf[1].value, { spent: 3 }), 6);
  // Long Arc: one extra target, two with Solar Arc.
  assert.equal(resolveModifierValue(BOOST_OVERRIDES.long_arc.special.extraAttacks, {}), 1);
  assert.equal(resolveModifierValue(BOOST_OVERRIDES.long_arc.special.extraAttacks, { "owns.solar_arc": 1 }), 2);
  assert.equal(resolveModifierValue(BOOST_OVERRIDES.freefire.special.extraAttacks, { spent: 5 }), 2);
  // Whisperglide caps at Proficiency.
  assert.equal(resolveModifierValue(BOOST_OVERRIDES.bd_whisperglide.effects[0].value, { "combat.basic.fiveFootAdjust": 5, proficiency: 3 }), 3);
  // Bloodied Cruelty is a boost now, not an always-on modifier.
  assert.equal(MODIFIER_OVERRIDES.bloodied_cruelty, undefined);
});

test("Multi-attack: Wild Strike is 2 split attacks, upgraded to 3 by Third Arm; Dagger Threat is 2 vs one target", () => {
  const ws = MULTIATTACK_OVERRIDES.wild_strike;
  assert.equal(ws.count, 2);
  assert.equal(ws.targeting, "split");
  // Mirror #useAbility's count resolution: base, bumped when the upgrade ability is owned.
  const effCount = (ma, owned) => (ma.upgrade?.ability && ma.upgrade.count > ma.count && owned.includes(ma.upgrade.ability)) ? ma.upgrade.count : ma.count;
  assert.equal(effCount(ws, []), 2);
  assert.equal(effCount(ws, ["third_arm"]), 3);
  // Each profession variant references its own Third Arm.
  assert.equal(MULTIATTACK_OVERRIDES.bd_wild_strike.upgrade.ability, "bd_third_arm");
  const dt = MULTIATTACK_OVERRIDES.dagger_threat;
  assert.equal(dt.count, 2);
  assert.equal(dt.targeting, "same");
  // Dagger Threat's attack activity is authored (the parser built none).
  assert.equal(ACTIVITY_OVERRIDES.dagger_threat[0].type, "attack");
  // Forbidden Web: Forbidden Knowledge rolls against each targeted enemy, gated on owning Forbidden Web.
  const fk = MULTIATTACK_OVERRIDES.forbidden_knowledge;
  assert.equal(fk.targeting, "each");
  assert.equal(fk.requiresAbility, "forbidden_web");
  // Mirror the sheet's dynamic-count logic for 'each': N targets → N attacks, but only when the enabler is owned.
  const eachCount = (ma, nTargets, owned) => (ma.targeting === "each" && (!ma.requiresAbility || owned.includes(ma.requiresAbility)) && nTargets > 1) ? nTargets : 1;
  assert.equal(eachCount(fk, 3, ["forbidden_web"]), 3);
  assert.equal(eachCount(fk, 3, []), 1); // no Forbidden Web → single target
  assert.equal(eachCount(fk, 1, ["forbidden_web"]), 1); // one target → one attack
});

test("modifierIsRollTime: target/self:attack/self:surrounded atoms and @adjacent values are roll-time", () => {
  assert.ok(modifierIsRollTime({ predicate: [{ atom: "target:adjacent" }], value: "1" }));
  assert.ok(modifierIsRollTime({ predicate: [{ atom: "self:attack:weapon:sword" }], value: "1" }));
  assert.ok(modifierIsRollTime({ predicate: [{ atom: "self:surrounded" }], value: "1" }));
  assert.ok(modifierIsRollTime({ predicate: [], value: "@adjacentEnemies" }));
  // A plain self-state passive stays prep-folded.
  assert.ok(!modifierIsRollTime({ predicate: [{ atom: "self:used:x" }], value: "@power" }));
  assert.ok(!modifierIsRollTime({ predicate: [], value: "2" }));
});

test("Carmine Approach grants advantage only under (at least) Half cover", () => {
  const m = MODIFIER_OVERRIDES.carmine_approach[0];
  assert.equal(m.target, "advantage.toHit");
  const atoms = m.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:cover:half": true }));
  assert.ok(evaluatePredicate(atoms, { "self:cover:half": true, "self:cover:full": true })); // Full ⇒ Half
  assert.ok(!evaluatePredicate(atoms, {}));
});

test("Divine Strike boost adds Fate to any attack's to-hit", () => {
  const b = BOOST_OVERRIDES.divine_strike;
  assert.equal(b.effects[0].target, "toHit");
  assert.equal(resolveModifierValue(b.effects[0].value, { fate: 5 }), 5);
  // Matches any attack (no category), not a pure save.
  assert.ok(boostApplies(b.appliesTo, { catalogId: "x", attackCategories: new Set(["melee"]), hasSave: false }));
  assert.ok(boostApplies(b.appliesTo, { catalogId: "y", attackCategories: new Set(["ranged"]), hasSave: false }));
  assert.ok(!boostApplies(b.appliesTo, { catalogId: "z", attackCategories: new Set(), hasSave: true }));
});

/* ---- Level-5 weapon masteries (bound-weapon-family +1/+1 or die-step) ---- */
test("Weapon masteries buff only the bound weapon family", () => {
  const bow = MODIFIER_OVERRIDES.mastery_bow[0];
  assert.equal(bow.target, "damage"); assert.equal(bow.mode, "step");
  assert.ok(evaluatePredicate(bow.predicate.map((p) => p.atom), { "self:attack:weapon:bow": true }));
  assert.ok(!evaluatePredicate(bow.predicate.map((p) => p.atom), { "self:attack:weapon:crossbow": true }));
  // Spear/Sword: paired +1 to-hit and +1 damage, gated on their family.
  for (const [id, wt] of [["mastery_spear", "spear"], ["mastery_sword", "sword"], ["mastery_tooth_and_claw", "unarmed"]]) {
    const mods = MODIFIER_OVERRIDES[id];
    assert.deepEqual(mods.map((m) => m.target).sort(), ["damage", "toHit"]);
    for (const m of mods) assert.ok(evaluatePredicate(m.predicate.map((p) => p.atom), { [`self:attack:weapon:${wt}`]: true }));
  }
  // Fist/Sling: single +1 to-hit on their family.
  assert.equal(MODIFIER_OVERRIDES.mastery_fist[0].target, "toHit");
  assert.equal(MODIFIER_OVERRIDES.mastery_sling[0].target, "toHit");
  // Feather and Hide (v1.2): +1 HP per level.
  assert.equal(MODIFIER_OVERRIDES.mastery_feather_and_hide[0].target, "health.max");
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.mastery_feather_and_hide[0].value, { level: 9 }), 9);
});

/* ---- Fatebound: Targeted Foe mark-buff + supersede, focus/divine self-buffs, Fumble inflicts ---- */
test("Targeted Foe adds ½Fate to-hit+damage vs the marked target; Tighten Focus supersedes to full", () => {
  const N = { fate: 5 };
  const tf = MODIFIER_OVERRIDES.targeted_foe;
  assert.deepEqual(tf.map((m) => m.target).sort(), ["damage", "toHit"]);
  assert.equal(resolveModifierValue(tf[0].value, N), 3); // ceil(5/2)
  const atoms = tf[0].predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:used:targeted_foe": true, "target:mark:targeted-foe": true }));
  assert.ok(!evaluatePredicate(atoms, { "self:used:targeted_foe": true, "target:mark:targeted-foe": true, "self:ability:tighten_focus": true }));
  // Not maintained / wrong target → inert.
  assert.ok(!evaluatePredicate(atoms, { "target:mark:targeted-foe": true }));
  assert.ok(!evaluatePredicate(atoms, { "self:used:targeted_foe": true }));
  // Tighten Focus: full Fate, same gate.
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.tighten_focus[0].value, N), 5);
  assert.equal(MARK_OVERRIDES.targeted_foe.key, "targeted-foe");
});

test("Fatebound self-buffs and the Hot Iron Glory boost", () => {
  const N = { fate: 5, proficiency: 6 };
  // Hide of Beasts: maintained-Focus DR ½Prof.
  const hb = MODIFIER_OVERRIDES.hide_of_beasts[0];
  assert.equal(hb.target, "defense.dr");
  assert.equal(resolveModifierValue(hb.value, N), 3);
  assert.ok(evaluatePredicate(hb.predicate.map((p) => p.atom), { "self:used:hide_of_beasts": true }));
  // Fated Strike: +Fate to melee damage (divine-weapon approximation).
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.fated_strike[0].value, N), 5);
  // Hot Iron: a Prof-d6 dice bump on any melee attack.
  const hi = BOOST_OVERRIDES.hot_iron;
  assert.equal(hi.effects[0].target, "damageDice");
  assert.equal(hi.effects[0].value, "(@proficiency)d6");
  assert.ok(boostApplies(hi.appliesTo, { catalogId: "x", attackCategories: new Set(["melee"]), hasSave: false }));
  assert.ok(!boostApplies(hi.appliesTo, { catalogId: "y", attackCategories: new Set(["ranged"]), hasSave: false }));
});

test("Fatebound Fumble/simple save-inflicts", () => {
  assert.equal(INFLICT_OVERRIDES.lucky_break[0].condition, "fumbled");
  assert.equal(INFLICT_OVERRIDES.lucky_break[0].amount, "1d6");
  assert.equal(INFLICT_OVERRIDES.fumbling_wander[0].amount, "1d8");
  assert.equal(INFLICT_OVERRIDES.flourishing_touch[0].condition, "surprised");
  assert.equal(INFLICT_OVERRIDES.blinding_divinity[0].condition, "blinded");
});

/* ---- Hulinari: form-attack damage (ACTIVITY_OVERRIDES), save-inflicts, self-buffs ---- */
test("Hulinari form attacks resolve base damage vs the right defense", () => {
  const bite = ACTIVITY_OVERRIDES.bite[0];
  assert.equal(bite.type, "attack");
  assert.equal(bite.attack.defense, "pd");
  assert.deepEqual({ c: bite.damage[0].count, d: bite.damage[0].denomination, t: bite.damage[0].trait }, { c: "1", d: 10, t: "power" });
  assert.equal(ACTIVITY_OVERRIDES.headbutt[0].attack.defense, "pd");
  assert.equal(ACTIVITY_OVERRIDES.headbutt[0].damage[0].trait, "finesse");
});

test("Hulinari save-inflicts + self-buffs", () => {
  const N = { proficiency: 6, courage: 5 };
  assert.equal(INFLICT_OVERRIDES.body_slam[0].condition, "prone");
  assert.equal(INFLICT_OVERRIDES.meatclub[0].condition, "prone");
  assert.equal(INFLICT_OVERRIDES.deafening_caw[0].amount, "1d4");
  assert.equal(resolveModifierValue(INFLICT_OVERRIDES.mighty_roar[0].amount, N), 3); // Fatigue ½Prof
  // Brute Adrenaline: maintained-Focus DR ½Courage.
  const ba = MODIFIER_OVERRIDES.brute_adrenaline[0];
  assert.equal(ba.target, "defense.dr");
  assert.equal(resolveModifierValue(ba.value, N), 3);
  assert.ok(evaluatePredicate(ba.predicate.map((p) => p.atom), { "self:used:brute_adrenaline": true }));
  // Necrotic Bite: a Prof/2-d6 dice bonus scoped to Bite.
  assert.equal(MODIFIER_OVERRIDES.necrotic_bite[0].target, "damageDice");
  assert.equal(MODIFIER_OVERRIDES.necrotic_bite[0].scope, "bite");
});

/* ---- Crit-range wideners (Phase 1): the `critThreshold` sink lowers the natural-d20 crit floor ---- */
test("Criticality / Divine Criticality lower the crit floor; both → 18 (Criticality superseded)", () => {
  const crit = MODIFIER_OVERRIDES.criticality[0];
  const div = MODIFIER_OVERRIDES.divine_criticality[0];
  assert.equal(crit.target, "critThreshold");
  assert.equal(div.target, "critThreshold");
  // Faithful fold: a modifier contributes only when its ability is OWNED (its item is on the actor)
  // and its predicate passes — the same rule _prepareModifiers uses. Floor = clamp(20 + Σ, ≥2).
  const floor = (owned) => {
    const opts = Object.fromEntries(owned.map((id) => [`self:ability:${id}`, true]));
    let b = 0;
    if (owned.includes("criticality") && evaluatePredicate(crit.predicate.map((p) => p.atom), opts)) b += resolveModifierValue(crit.value, {});
    if (owned.includes("divine_criticality") && evaluatePredicate(div.predicate.map((p) => p.atom), opts)) b += resolveModifierValue(div.value, {});
    return Math.max(2, 20 + b);
  };
  assert.equal(floor([]), 20);
  assert.equal(floor(["criticality"]), 19);
  assert.equal(floor(["divine_criticality"]), 18);
  assert.equal(floor(["criticality", "divine_criticality"]), 18); // Criticality's !divine gate suppresses its −1
});

/* ---- Temp-HP grants (book p.223): activation-time self/ally grant, non-stacking ---- */
test("Temp-HP grant overrides resolve their die count/target", () => {
  const coh = TEMPHP_OVERRIDES.call_of_healing;
  assert.equal(coh.target, "both");
  const m = /^\((.+)\)d(\d+)$/.exec(coh.formula);
  assert.equal(resolveModifierValue(m[1], { proficiency: 6 }), 3); // ceil(6/2)
  assert.equal(m[2], "4"); // XD4
  const cah = TEMPHP_OVERRIDES.come_and_heal;
  assert.equal(cah.target, "allies");
  assert.deepEqual(cah.scaleLevels, [5, 11]); // 1D4 → 1D6@5 → 1D8@11
});

/* ---- Frontier close-out: attack-inflict save-to-negate, self grant, triggered-resource ---- */
test("Slinger: ranged noDamage attack inflicting Fatigue (½ Prof) the target negates with a Finesse save", () => {
  const [a] = ACTIVITY_OVERRIDES.slinger;
  assert.equal(a.type, "attack");
  assert.equal(a.attack.category, "ranged");
  assert.equal(a.noDamage, true); // inflict instead of damage
  const inf = a.inflict[0];
  assert.equal(inf.condition, "fatigue");
  assert.equal(resolveModifierValue(inf.amount, { proficiency: 5 }), 3); // ceil(5/2)
  assert.equal(inf.saveNegate, "finesse"); // "Finesse Check negates" → save-to-negate on hit
});

test("Partial Drivel: a self focus grant of DR = Madness spent (variable @spent)", () => {
  const g = GRANT_OVERRIDES.partial_drivel;
  assert.equal(g.scope, "self"); // buffs the caster, no external target
  assert.equal(g.duration.type, "focus");
  assert.equal(g.spend.resource, "madness");
  assert.equal(resolveModifierValue(g.spend.max, { madness: 4 }), 4); // capped at current Madness
  const c = g.changes[0];
  assert.equal(c.key, "system.bonuses.defense.dr");
  assert.equal(resolveModifierValue(c.value, { spent: 3 }), 3); // DR = amount spent
});

/* ---- combat-context: the Boltshot family (crossbow advantage → per-stack damage, flat→D4→D6) ---- */
// Simulate the roll-time fold: for a given owned-ability set + roll options, return the Boltshot
// modifiers that fire (predicate passes) with their resolved value/form. `@advantageStacks` = net advantage.
function boltshotFires(owned, opts, nums) {
  const options = { ...opts, ...Object.fromEntries(owned.map((id) => [`self:ability:${id}`, true])) };
  return MODIFIER_OVERRIDES.boltshot
    .filter((m) => evaluatePredicate(m.predicate.map((p) => p.atom), options))
    .map((m) => {
      if (m.target === "damageDice") {
        const [, expr, faces] = /^\((.+)\)d(\d+)$/.exec(m.value);
        return { form: `d${faces}`, count: resolveModifierValue(expr, nums), label: m.label };
      }
      return { form: "flat", value: resolveModifierValue(m.value, nums), label: m.label };
    });
}

const boltGate = { "self:attack:weapon:crossbow": true, "self:attack:has-advantage": true, "self:attack:ap:2plus": true };
const boltNums = { proficiency: 6, advantageStacks: 2 }; // X=ceil(6/2)=3 or 6; 2 advantage stacks

test("Boltshot: exactly one form fires per ownership; ½Prof→Prof, flat→D4→D6", () => {
  // Boltshot alone → flat ½Prof × stacks = 3 × 2 = 6.
  let f = boltshotFires(["boltshot"], boltGate, boltNums);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0], { form: "flat", value: 6, label: "Boltshot" });
  // + Boltshot Pro → X = full Prof: 6 × 2 = 12, still flat.
  f = boltshotFires(["boltshot", "boltshot_pro"], boltGate, boltNums);
  assert.deepEqual(f, [{ form: "flat", value: 12, label: "Boltshot" }]);
  // + Pullback → (X·stacks)D4: count 6, faces d4.
  f = boltshotFires(["boltshot", "pullback"], boltGate, boltNums);
  assert.deepEqual(f, [{ form: "d4", count: 6, label: "Pullback" }]);
  // + Pro + Pullback → (Prof·stacks)D4: count 12.
  f = boltshotFires(["boltshot", "boltshot_pro", "pullback"], boltGate, boltNums);
  assert.deepEqual(f, [{ form: "d4", count: 12, label: "Pullback" }]);
  // + Greatpull → D6 (supersedes Pullback's d4); count 6.
  f = boltshotFires(["boltshot", "pullback", "greatpull"], boltGate, boltNums);
  assert.deepEqual(f, [{ form: "d6", count: 6, label: "Greatpull" }]);
});

test("Boltshot needs crossbow + advantage + ≥2 AP; inert otherwise, and scales to 0 with no advantage", () => {
  assert.equal(boltshotFires(["boltshot"], {}, boltNums).length, 0); // no gate atoms
  assert.equal(boltshotFires(["boltshot"], { "self:attack:weapon:bow": true, "self:attack:has-advantage": true, "self:attack:ap:2plus": true }, boltNums).length, 0); // bow, not crossbow
  assert.equal(boltshotFires(["boltshot"], { ...boltGate, "self:attack:ap:2plus": false }, boltNums).length, 0); // 1-AP attack (option unset)
  // Predicate passes with a set has-advantage flag, but 0 stacks → 0 damage (the option is only set when stacks>0 in-game).
  const f = boltshotFires(["boltshot"], boltGate, { proficiency: 6, advantageStacks: 0 });
  assert.deepEqual(f, [{ form: "flat", value: 0, label: "Boltshot" }]);
});

test("Loose Morals grants 1× advantage only on a frenzied crossbow attack", () => {
  const m = MODIFIER_OVERRIDES.loose_morals[0];
  assert.equal(m.target, "advantage.toHit");
  const atoms = m.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:condition:frenzy": 2, "self:attack:weapon:crossbow": true }));
  assert.ok(!evaluatePredicate(atoms, { "self:attack:weapon:crossbow": true })); // not frenzied
  assert.ok(!evaluatePredicate(atoms, { "self:condition:frenzy": 2, "self:attack:weapon:bow": true })); // not crossbow
});

/* ---- grant-choice-redirect: Shared Blessing redirects Iron Wall's per-use choice buff to an ally ---- */
test("Shared Blessing: fills the <choice> key template and snapshots ½Madness at cast", () => {
  const cr = CHOICEREDIRECT_OVERRIDES.blessing_of_the_iron_wall;
  assert.equal(cr.requiresAbility, "shared_blessing"); // only redirects when the passive is owned
  // The per-use PD/MD/TD pick fills the change key.
  assert.equal(cr.key.replace("<choice>", "md"), "system.bonuses.defense.md");
  assert.equal(cr.key.replace("<choice>", "pd"), "system.bonuses.defense.pd");
  // Magnitude = ½Madness (rounded up), resolved against the caster's numbers at cast time.
  assert.equal(resolveModifierValue(cr.value, { madness: 5 }), 3); // ceil(5/2)
});

/* ---- resist-advantage: conditional advantage on the Make-Trait-Check to shed a condition ---- */
// #onResistCondition builds `self:resisting:<cond>` + `self:resisting:physical|mental` (+ self-state) and
// folds matching `resistAdvantage` modifiers. Mirror that predicate check here.
function resistFires(id, resistOpts) {
  return (MODIFIER_OVERRIDES[id] ?? [])
    .filter((m) => m.target === "resistAdvantage" && evaluatePredicate(m.predicate.map((p) => p.atom), resistOpts))
    .reduce((n, m) => n + resolveModifierValue(m.value, {}), 0);
}
test("resist-advantage fires only on the matching condition/group (+ state)", () => {
  // Enduring Animal: only when resisting Fatigue.
  assert.equal(resistFires("enduring_animal", { "self:resisting:fatigue": true }), 1);
  assert.equal(resistFires("enduring_animal", { "self:resisting:panic": true }), 0);
  // Defensive Mastery: only vs Panic.
  assert.equal(resistFires("mastery_defensive", { "self:checking:panic": true }), 1);
  assert.equal(resistFires("mastery_defensive", { "self:checking:physical": true }), 0);
  // Rage in Pain: raging AND a physical condition (both required) — on any check against it.
  assert.equal(resistFires("thug_rage_in_pain", { "self:raging": true, "self:checking:physical": true }), 1);
  assert.equal(resistFires("thug_rage_in_pain", { "self:checking:physical": true }), 0); // not raging
  assert.equal(resistFires("thug_rage_in_pain", { "self:raging": true, "self:checking:mental": true }), 0); // mental, not physical
});

/* ---- inflict-amount-upgrade: predicated inflict entries (supersede pairs/chains) ---- */
// #rollInflict skips entries whose predicate fails, so exactly one amount applies per ownership state.
function inflictFor(id, owned) {
  const opts = Object.fromEntries(owned.map((a) => [`self:ability:${a}`, true]));
  const hits = INFLICT_OVERRIDES[id].filter((e) =>
    evaluatePredicate((e.predicate ?? []).map((p) => p.atom), opts));
  return hits;
}
test("Taunting Call: ½Prof Taunt, raised to full Prof by Extra Taunt (exactly one entry fires)", () => {
  let h = inflictFor("taunting_call", []);
  assert.equal(h.length, 1);
  assert.equal(resolveModifierValue(h[0].amount, { proficiency: 6 }), 3); // ceil(6/2)
  h = inflictFor("taunting_call", ["extra_taunt"]);
  assert.equal(h.length, 1);
  assert.equal(resolveModifierValue(h[0].amount, { proficiency: 6 }), 6); // full Prof
});
test("Bleedstep: 1 Hemorrhage → ½Prof with Bleeding Dance", () => {
  assert.equal(inflictFor("bd_bleedstep", [])[0].amount, "1");
  assert.equal(resolveModifierValue(inflictFor("bd_bleedstep", ["bd_bleeding_dance"])[0].amount, { proficiency: 5 }), 3);
});
test("Lucky Break Fumble die steps 1D6→1D8→1D10 across Divine Fates + God-Given Luck (one entry each combo)", () => {
  assert.equal(inflictFor("lucky_break", []).length, 1);
  assert.equal(inflictFor("lucky_break", [])[0].amount, "1d6");
  assert.equal(inflictFor("lucky_break", ["divine_fates"])[0].amount, "1d8");
  assert.equal(inflictFor("lucky_break", ["god_given_luck"])[0].amount, "1d8");
  const both = inflictFor("lucky_break", ["divine_fates", "god_given_luck"]);
  assert.equal(both.length, 1);
  assert.equal(both[0].amount, "1d10");
});

/* ---- Taunt cluster: Big Target (+1) stacks with Extra Taunt on Taunting Call; Surprise Disruption ---- */
test("Taunting Call Taunt matrix: Extra Taunt × Big Target selects exactly one amount", () => {
  const pick = (owned) => {
    const opts = Object.fromEntries(owned.map((a) => [`self:ability:${a}`, true]));
    const h = INFLICT_OVERRIDES.taunting_call.filter((e) => evaluatePredicate(e.predicate.map((p) => p.atom), opts));
    assert.equal(h.length, 1);
    return resolveModifierValue(h[0].amount, { proficiency: 6 });
  };
  assert.equal(pick([]), 3);                              // ceil(6/2)
  assert.equal(pick(["big_target"]), 4);                 // +1
  assert.equal(pick(["extra_taunt"]), 6);                // full Prof
  assert.equal(pick(["extra_taunt", "big_target"]), 7);  // full Prof +1
});
test("Surprise Disruption: Disruption's save inflicts Surprised only when owned", () => {
  const e = INFLICT_OVERRIDES.bd_disruption[0];
  assert.equal(e.condition, "surprised");
  const atoms = e.predicate.map((p) => p.atom);
  assert.ok(evaluatePredicate(atoms, { "self:ability:bd_surprise_disruption": true }));
  assert.ok(!evaluatePredicate(atoms, {})); // not owned → base Disruption inflicts nothing (loses Focus is narrative)
});

/* ---- Hulinari Swarm, v1.2 ---- */
test("Swarm v1.2: clouds are tile zones sized by Proficiency + Grey Cloud + Stormcloud; layers ride Focus", () => {
  const foe = ZONE_OVERRIDES.clouded_foe;
  assert.equal(foe.shape, "tiles");
  assert.equal(foe.cloud, "foe");
  assert.ok(foe.carry);
  assert.equal(resolveModifierValue(foe.size, { proficiency: 3 }), 3);
  assert.equal(resolveModifierValue(foe.size, { proficiency: 3, "owns.grey_cloud": 1, "owns.stormcloud": 1 }), 6);
  assert.deepEqual(foe.effect.layers.map((l) => l.whileFocus), ["sharp_cloud", "dark_cloud", "dark_cloud"]);
  assert.equal(ZONE_OVERRIDES.clouded_ally.cloud, "ally");
  // Focused Bite: +1 Birdbite die per Focus actively maintained.
  assert.equal(resolveModifierValue(MODIFIER_OVERRIDES.focused_bite[0].value, { "combat.focusMaintained": 3 }), 3);
  assert.equal(MODIFIER_OVERRIDES.focused_bite[0].scope, "birdbite");
  // Birdbite attacks each enemy; Razorbite collapses it to one attack with Proficiency extra die types.
  assert.equal(MULTIATTACK_OVERRIDES.birdbite.targeting, "each");
  assert.ok(BOOST_OVERRIDES.razorbite.special.singleAttack);
  assert.equal(BOOST_OVERRIDES.cloudsurge.appliesTo.ability, "clouded_foe|clouded_ally");
  // Deafening Caw scales 1D4 → 1D6 @5 → 1D8 @11.
  const caw = INFLICT_OVERRIDES.deafening_caw;
  const at = (lvl) => caw.find((e) => evaluatePredicate(e.predicate.map((p) => p.atom), { "self:level": lvl })).amount;
  assert.deepEqual([at(1), at(5), at(11)], ["1d4", "1d6", "1d8"]);
  // The v1.0 Hovering Foe subtree is gone.
  for (const id of ["pick_harder", "clawing_talons", "sharpbeak"]) assert.equal(ACTIVITY_OVERRIDES[id], undefined, id);
  assert.equal(MODIFIER_OVERRIDES.focused_claw, undefined);
});

/* ---- Permanent picks ---- */
test("pick overrides: every picked ability has a kind, and weapon-type pick modifiers gate on their own picked atom", () => {
  for (const [id, p] of Object.entries(PICK_OVERRIDES)) assert.ok(["weaponType", "condition", "pool", "limb", "creature", "defense", "element", "favored", "ownFavored", "divineWeapon", "namedWeapon"].includes(p.kind), id);
  for (const [id, p] of Object.entries(PICK2_OVERRIDES)) assert.ok(PICK_OVERRIDES[id] && ["ownFavored", "namedWeapon"].includes(p.kind), id);
  for (const id of ["swordwork", "bd_harmful_hand", "sharp_weaponry", "big_guns_expert", "bigger_stones"]) {
    const atoms = MODIFIER_OVERRIDES[id][0].predicate.map((q) => q.atom);
    assert.ok(atoms.includes(`self:attack:picked:${id}`), id);
    assert.equal(MODIFIER_OVERRIDES[id][0].mode, "step");
  }
  // Devastating Hand rides Harmful Hand's pick; Big Guns also needs a two-handed grip.
  assert.ok(MODIFIER_OVERRIDES.bd_devastating_hand[0].predicate.some((q) => q.atom === "self:attack:picked:bd_harmful_hand"));
  assert.ok(MODIFIER_OVERRIDES.big_guns_expert[0].predicate.some((q) => q.atom === "self:attack:hands:2"));
  assert.ok(!PICK_OVERRIDES.swordwork.options.includes("spear") && !PICK_OVERRIDES.swordwork.options.includes("shield"));
  assert.deepEqual(CHOICE_OVERRIDES.ironhide.options.map((o) => o.value), ["nausea", "frenzy", "taunt", "panic"]);
});

/* ---- Reactions: per-use choices steer grants and on-use effects ---- */
test("choice-gated grants: Mindmeld hinders or aids; Carrying the Team doubles with Steed and Rider", () => {
  const live = (g, opts) => g.changes.filter((c) => evaluatePredicate((c.predicate ?? []).map((p) => p.atom), opts));
  assert.deepEqual(live(GRANT_OVERRIDES.mindmeld, { "self:choice:mindmeld:hinder": true }).map((c) => [c.key, c.value]), [["system.advantage.toHit", "-1"]]);
  assert.deepEqual(live(GRANT_OVERRIDES.mindmeld, { "self:choice:mindmeld:aid": true }).map((c) => [c.key, c.value]), [["system.advantage.trait", "1"]]);
  const boost = { "self:choice:carrying_the_team:boost": true };
  assert.deepEqual(live(GRANT_OVERRIDES.carrying_the_team, boost).map((c) => c.value), ["1"]);
  assert.deepEqual(live(GRANT_OVERRIDES.carrying_the_team, { ...boost, "self:ability:steed_and_rider": true }).map((c) => c.value), ["2"]);
  assert.deepEqual(live(GRANT_OVERRIDES.carrying_the_team, { "self:choice:carrying_the_team:shield": true }).map((c) => c.key), ["system.bonuses.incomingAdvantage"]);
  assert.equal(GRANT_OVERRIDES.carrying_the_team.duration.on, "roll|attacked");
});

test("on-use: Standards Elite removes the chosen condition; Call to Overcome touches every adversarial condition", () => {
  assert.deepEqual(ONUSE_OVERRIDES.standards_elite.target, [{ condition: "@choice", amount: "-1" }]);
  assert.deepEqual(CHOICE_OVERRIDES.standards_elite.options.map((o) => o.value), ["panic", "fatigue"]);
  assert.deepEqual(ONUSE_OVERRIDES.call_to_overcome.target, [{ condition: "*adversarial", amount: "-1" }]);
  assert.equal(ONUSE_OVERRIDES.bloodsapper.exhaust, "@choice");
  assert.deepEqual(ONUSE_OVERRIDES.cornered_animal.holdDecay, ["@choice"]);
  assert.equal(ONUSE_OVERRIDES.protective_instinct.cover, "half");
});

test("aid-resist: Call of Respite aids ½Prof allies (auto with Final Calm, advantage with Relaxed Call)", () => {
  const cr = AID_RESIST_OVERRIDES.call_of_respite;
  assert.equal(resolveModifierValue(cr.maxTargets, { proficiency: 5 }), 3);
  assert.equal(cr.autoWith, "final_calm");
  assert.equal(cr.advantageWith, "relaxed_call");
  assert.ok(AID_RESIST_OVERRIDES.vision_of_moss.autoIfSteadied && AID_RESIST_OVERRIDES.vision_of_moss.mentalOnly);
  assert.equal(AID_RESIST_OVERRIDES.blessing_of_the_burning_incense.levels, "@spent");
});

import { boostLimit } from "../module/helpers/boosts.mjs";
test("boost limit: one per action, none on reactions (p.236) except Boostbuster/Close Quarter; 2–3 on a divine weapon", () => {
  const act = (o) => ({ tag: "action", opportunity: false, divine: false, steadied: false, catalogId: "x", ...o });
  assert.equal(boostLimit(act({}), new Set()), 1);
  assert.equal(boostLimit(act({ tag: "reaction" }), new Set()), 0);
  assert.equal(boostLimit(act({ tag: "reaction", opportunity: true }), new Set(["boostbuster"])), 1);
  assert.equal(boostLimit(act({ tag: "reaction", catalogId: "close_quarter", steadied: true }), new Set()), 1);
  assert.equal(boostLimit(act({ divine: true }), new Set(["boosted_attack"])), 2);
  assert.equal(boostLimit(act({ divine: true }), new Set(["boosted_attack", "boost_stack"])), 3);
  assert.equal(boostLimit(act({ divine: false }), new Set(["boost_stack"])), 1);
});

test("named weapons: The Vengeance keys off its creature pick; Jagged Blade's extra Hemorrhage is once per rest on the wielded name", () => {
  assert.equal(PICK_OVERRIDES.bd_the_vengeance.kind, "creature");
  const v = MODIFIER_OVERRIDES.bd_the_vengeance;
  const on = (opts) => v.filter((m) => evaluatePredicate(m.predicate.map((p) => p.atom), opts)).map((m) => `${m.target}:${m.value}`);
  const named = { "self:attack:named-by:bd_the_vengeance": true };
  assert.deepEqual(on(named), ["damage:-1"]);
  assert.deepEqual(on({ ...named, "target:pick:bd_the_vengeance": true }), ["damage:1", "advantage.toHit:1"]);
  assert.deepEqual(on({}), []);
  const jb = INFLICT_OVERRIDES.bd_artery_strike[1];
  assert.equal(jb.restFlag, "jaggedBlade");
  assert.equal(jb.predicate[0].atom, "self:wielding:named:bd_jagged_blade");
});

import { ZONE_OVERRIDES } from "../src/modifiers.mjs";

test("zones: every zone has a shape, a size formula and an effect; Madness zones resize", () => {
  for (const [id, z] of Object.entries(ZONE_OVERRIDES)) {
    assert.ok(["circle", "square", "tiles"].includes(z.shape), id);
    assert.ok(typeof z.size === "string" && z.size.length, id);
    assert.ok(z.effect && typeof z.effect === "object", id);
  }
  assert.equal(resolveModifierValue(ZONE_OVERRIDES.stygian_abyss.size, { madness: 4 }), 20);
  assert.ok(ZONE_OVERRIDES.stygian_abyss.radiusPerMadness);
  assert.equal(resolveModifierValue(ZONE_OVERRIDES.suppressing_fire.size, { proficiency: 3 }), 10);
  assert.equal(ZONE_OVERRIDES.suppressing_fire.effect.attackDisadvantage, true);
});
