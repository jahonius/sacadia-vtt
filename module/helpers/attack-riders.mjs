/**
 * Passives that reshape *other* attacks at roll time — pure data over the attack's roll options, so each
 * is unit-tested. `#useAbility` applies them after the target/positional context is known.
 *
 *  - TREAT_AS: "treat the target as <condition>" for this attack (its gated modifiers then fire, and a
 *    Surprised target means a hit is a critical hit — book p.258).
 *  - ATTACK_RIDERS: an extra on-hit inflict the passive adds to qualifying attacks.
 */

export const TREAT_AS = [
  // Excuse Me: "…make a melee attack against them. Treat them as Surprised for this attack."
  { id: 'excuse_me', condition: 'surprised', when: (o) => !!o['self:attack:ability:excuse_me'] },
  // Spearpoint: "When you use Ticket to Enter on an enemy entering your range while wielding a spear, treat
  // them as Surprised."
  { id: 'spearpoint', condition: 'surprised',
    when: (o) => o['self:attack:ability:basic_ticket_to_enter'] && o['self:attack:weapon:spear'] },
  // Full Monty: "If you are Surrounded and have enemies on at least 3 sides, treat enemies as Surprised for
  // your first attack each turn." (≥3 adjacent enemies stands in for "3 sides".)
  { id: 'full_monty', condition: 'surprised',
    when: (o, n) => o['self:surrounded'] && (n.adjacentEnemies ?? 0) >= 3 && (o['self:combat:attacks-this-turn'] ?? 0) === 0 },
  // What's That: ending Hide Behind Hide by attacking a Surrounded creature → treat it as Surprised.
  { id: 'whats_that', condition: 'surprised',
    when: (o) => (o['self:combat:focus-rounds:hide_behind_hide'] ?? 0) >= 1 && o['target:surrounded'] },
];

export const ATTACK_RIDERS = [
  // Bowling Bolt: "at least 6× advantage in a consistent crossbow attack and you hit → knocked Prone."
  { id: 'bowling_bolt', inflict: { condition: 'prone', amount: '1' },
    when: (o) => o['self:attack:weapon:crossbow'] && (o['self:attack:advantage-stacks'] ?? 0) >= 6 && o['self:attack:ap:2plus'] },
];

/** The TREAT_AS conditions and ATTACK_RIDERS inflicts that apply for these options (pure). */
export function attackRiders(owned, options, numbers = {}) {
  return {
    treatAs: TREAT_AS.filter((r) => owned.has(r.id) && r.when(options, numbers)),
    inflicts: ATTACK_RIDERS.filter((r) => owned.has(r.id) && r.when(options, numbers)),
  };
}
