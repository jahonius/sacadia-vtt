/** The Tianqi (rulebook v1.2 printed pp.59–68). The shape is described in src/identity/cultures.mjs. */
export default {
  key: 'tianqi', name: 'Tianqi', page: 59, img: 'icons/sundries/scrolls/scroll-bound-sealed-black-red.webp',
  summary: 'An empire at the end of ruin, the Tianqi stay alive through their union over a singular purpose - to win an endless war against a cannibalistic demon king. The Tianqi lands border Chuni’s Wall of Regret - and beyond it lies an apocalyptic wasteland ruled over by a demon king Ager, who exists for the sole purpose of destroying all Tianqi. The Tianqi are a cultic, apocalyptic demon-hunting culture at the end of their era.',
  laws: [
    ['The Rootbinding', 'You must support the war effort against Ager, and wherever possible, take action to help defeat the demons of Qianpo. Doing so should take precedence over law, religion, family, or any other value you possess.'],
    ['Ascendancy', 'Unless you are of Noble blood, you must follow the orders of those who have the blood of Ascendant heroes, unless doing so goes against the Rootbinding.'],
    ['The Dead', 'When someone dies, you must immediately burn the body and bury their ashes, unless doing so goes against the Rootbinding.'],
    ['Right to Victory', 'The individual who deals the final blow to an enemy claims all spoils from that enemy, including honors, accolades, and punishment.'],
    ['Touching Gold', 'Unless you are of Noble Blood, you cannot willingly touch or carry gold.'],
  ],
  talents: [
    { id: 'tianqi_heibrim_lore', name: 'Heibrim Lore', tag: 'passive', page: 59, prerequisite: 'Tianqi Cultural Heritage', img: 'icons/sundries/scrolls/scroll-symbol-eye-brown.webp',
      grantsSpecialty: { talent: 'religion', name: 'Demon Lore' },
      description: 'You gain 1 level of Talent Specialization in Religion: Demon Lore. This level does not require the Religion General Talent to use, and it stacks with any other levels you would take by leveling into Religion: Demon Lore. Your demon lore also works for all Qianpo demons, even though they are not demons.' },
  ],
  language: { id: 'tianqi_old_bushiu', name: 'Old Bushiu', page: 59,
    description: 'You speak the Old Bushiu language. You can mutually understand Bushiu, and those who speak Bushiu can understand you.' },
  ancestries: [
    { id: 'tianqi_withered', name: 'Withered', heritage: 'human', page: 63, lifespan: 'Typically 90–110 years', img: 'icons/magic/unholy/hand-fire-skeleton-pink.webp',
      lore: ['lore_cursed_contract'],
      description: 'The result of partaking in too much blood magic, the Withered are not naturally born, but made. Tianqi Redwardens become Withered naturally through their cursed magicks. When you become Withered, replace your Human Ancestral abilities with this.',
      abilities: [
        { id: 'tianqi_blood_arts', name: 'Blood Arts', tag: 'passive', page: 63, prerequisite: 'Withered Human Ancestry', img: 'icons/magic/unholy/hand-claw-fire-blue.webp',
          description: 'When you are dying, ignore the effects of Enduring Fatigue you take from the Dying Condition until that Fatigue knocks you unconscious.' },
      ] },
  ],
  groups: [
    { label: 'All Tianqi', note: 'All Tianqi can take the following abilities.', abilities: [
      { id: 'tianqi_dying_strength', name: 'Dying Strength', tag: 'passive', csp: 2, page: 63, prerequisite: 'Tianqi Cultural Heritage', img: 'icons/skills/wounds/blood-spurt-spray-red.webp',
        // "When you are Dying" — below 0 HP is Wounded in v1.2 (p.230).
        modifiers: [{ label: 'Dying Strength', target: 'damage', mode: 'step', scope: 'all', value: '1', predicate: [{ atom: 'self:wounded' }] }],
        description: 'When you are Dying, increase your damage dice of all weapons you use by one dice type. Additionally, if you take the Help action while Dying, give your ally 2X Advantage instead of 1X advantage.' },
      { id: 'tianqi_ambushed_resiliency', name: 'Ambushed Resiliency', tag: 'passive', csp: 2, page: 63, prerequisite: 'Tianqi Cultural Heritage', img: 'icons/magic/defensive/shield-barrier-deflect-teal.webp',
        // Ambushed: Surprised, which lasts the first round.
        modifiers: [{ label: 'Ambushed Resiliency', target: 'defense.dr', value: '2*@proficiency', predicate: [{ atom: 'self:surprised' }] }],
        description: 'When you are Ambushed, gain damage resistance equal to 2X Proficiency in the first round of combat. <em>(While you’re Surprised.)</em>' },
      { id: 'tianqi_demon_points', name: 'Demon Points', tag: 'passive', csp: 4, page: 63, prerequisite: 'Tianqi Cultural Heritage', img: 'icons/magic/perception/eye-ringed-glow-angry-red.webp',
        description: 'For each fact you learn about an enemy at the start of combat due to Knowledge Talents, increase damage you deal to that enemy through any attack you make by 1.' },
      { id: 'tianqi_anemic_tolerance', name: 'Anemic Tolerance', tag: 'passive', csp: 2, page: 63, prerequisite: 'Tianqi Cultural Heritage', img: 'icons/skills/wounds/blood-drip-droplet-red.webp',
        description: 'Reduce the damage dice of Hemorrhage given to you by one dice type.' },
    ] },
    { label: 'Glyphwardens', note: 'A class of Oracles unique to the Heibrim, Glyphwardens fight by leveraging the unique properties of Glyphs. If you are a Tianqi Oracle, you may take the following abilities.', abilities: [
      { id: 'tianqi_whitewardens_blessing', name: 'Whitewarden’s Blessing', tag: 'reaction', csp: 4, page: 63, prerequisite: 'Tianqi Oracle', img: 'icons/magic/holy/prayer-hands-glowing-yellow-white.webp',
        madness: { insaneOnly: false, prereq: 5, gain: '', spend: 'N' },
        description: '&lt;P:M5, M-N&gt;. As a reaction to an ally making an attack within 30ft of you, reduce your Madness by N, and give them N Advantage on that attack. You must select to use this Reaction before they roll their attack. Charging weapons do not increase in damage from this ability.' },
      { id: 'tianqi_redwardens_bite', name: 'Redwarden’s Bite', tag: 'action', csp: 4, page: 63, prerequisite: 'Tianqi Oracle', img: 'icons/magic/unholy/hand-claw-fire-green.webp',
        madness: { insaneOnly: false, prereq: null, gain: '1d3-1', spend: '' },
        description: '&lt;M+1D3-1&gt;. Choose one enemy within 5ft of you. Attempt to give them X levels of Hemorrhage, where X is half your Proficiency, rounded up. Fate Checks negate. When you do this, gain 1D4 temporary HP for every level of Hemorrhage they take.' },
      { id: 'tianqi_blood_gibbering', name: 'Blood Gibbering', tag: 'passive', csp: 5, page: 63, prerequisite: 'Tianqi Oracle', img: 'icons/magic/unholy/orb-glowing-purple.webp',
        description: 'For each Red Glyph you have equipped in a RIS, increase the damage dice of Gibbering by one dice type.' },
    ] },
  ],
  /** On the culture's Inheritance journal page, before the list. */
  inheritanceNotes: `## Glyph Corruption

When you use Red Glyphs, the use of the blood of others in these relic crafts has a slowly corrupting effect on your soul. Every time you take one Level of Glyph Corruption, you randomly gain one of the following effects.

| Roll | Corruption |
| --- | --- |
| 1 | Your ears become long and pointed |
| 2 | Your teeth become sharp and long |
| 3 | Your irises become blood red slits |
| 4 | Your skin becomes pale and cold |
| 5 | Your fingernails become long claws |
| 6 | All of your hair falls out |

## Glyph Limits

There are limits to your corruption. These are the effects of augmenting your Glyph Corruption too much.

| Glyph Corruption | Stacking Effect |
| --- | --- |
| 2 | You begin to crave blood. Drink human blood 1x per long rest. For each long rest you do not drink a cup of human blood, gain 1 level of Irrecoverable Fatigue. If you have 0AP because of this Fatigue, you die. |
| 3 | You lose your tolerance of the light. Treat any sunlight as Bright Light (gain 1X Disadvantage to all attacks). Ignore the effects of night. |
| 4 | You become a demon, losing your humanity. Treat all allies as enemies. Replace your character token with an Unshackled Tianqi Priest Monster token. |`,
};
