/**
 * What the Prologue macro files in Augur: Nexus (macros/prologue.js, through Nexus's API): the area's two organizations,
 * the people in them (the demons as the reference characters, linked to their actors; the heroes as player characters),
 * and the quest. Text is Markdown, built to HTML (with {{actor:…}} links) into the world map's flags; the lore is the
 * rulebook's (v1.2 pp.26, 59–63) and the one-shot's.
 */

export const FACTIONS = [
  {
    key: 'tianqi', name: 'The Tianqi', color: '#9a1c14', img: 'icons/environment/settlement/watchtower-castle-night.webp',
    profile: { type: 'Divine monarchy', method: 'Blood glyphs and the wall', drive: 'Win the endless war against Ager',
      action: 'Man Chuni\'s Wall', theme: 'An empire at the end of ruin', focus: 'The Rootbinding' },
    md: `An empire at the end of ruin, the Tianqi stay alive through their union over a single purpose: to win an endless war
against Ager, the Cannibal King. They live in the Lower Heibrim, behind Chuni's Wall.

- **Low Ballom** is their capital. The Monarch of all Tianqi rules from the Glass Palace, which looks forever north beyond
  the wall, a reminder of the Monarch's sacred duty to kill Ager.
- **Kjerstwall**, at the wall's western end, is home to the Redwardens; Low Ballom to the Goldwardens.
- **The Cult of Glyphs** backs the Monarch, judges crimes, and writes the blood glyphs that ward the wall.
- **The firstborn** of every family is bound to the military. After hundreds of years on the wall, the Tianqi are tired of
  war, and soldiers are not treated well.
- **The Rootbinding:** every Tianqi must support the war against Ager above law, religion and family.

*Rulebook v1.2 pp.59–63.*`,
  },
  {
    key: 'ager', name: 'Ager\'s Demons', color: '#3d2a44', img: 'icons/creatures/unholy/demon-horned-winged-laughing.webp',
    profile: { type: 'Demon host', method: 'Hunger', drive: 'Destroy every Tianqi', action: 'Prowl the wall',
      theme: 'A curse', focus: 'The Tianqi' },
    md: `Beyond Chuni's Wall lies Qianpo, a blasted land ruled by Ager, the Cannibal King: a demon king who exists for the sole
purpose of destroying all Tianqi.

Two hundred years ago, the Tianqi besieged the city of Qianpo. Its people turned on one another and ate each other to
survive, and for that sin they were cursed as demons, with an unending hatred of the Tianqi. They poured across the
Heibrim until the Tianqi general Chunisaren of Kjerst raised the wall, it's said, by sacrificing the Tianqi city gods.

The demons of Qianpo (technically Folk Fae) prowl the north as beasts: immensely powerful, without morals, and fixated on
human flesh. Tianqi legend counts eleven Demon Generals; the Ascendant heroes Chunisaren and Babelia killed the first two.

*Rulebook v1.2 pp.26, 60, 62; The Breach.*`,
  },
];

/** People: their organization, the actor they're linked to (if any), and what they are. Ager and the Monarch lead. */
export const PEOPLE = [
  { key: 'monarch', faction: 'tianqi', leader: true, name: 'The Monarch of the Tianqi', img: 'icons/equipment/head/crown-gold-red.webp',
    role: 'Monarch', descriptor: 'Rules from the Glass Palace in Low Ballom',
    md: 'The divinely empowered monarch of all Tianqi rules from the Glass Palace in Low Ballom, which looks forever north beyond the wall, a reminder of the Monarch\'s sacred duty to kill Ager. The Cult of Glyphs backs the throne, and the ruling family struggles for power within it. *Rulebook v1.2 pp.60, 62.*' },
  { key: 'ager', faction: 'ager', leader: true, name: 'Ager, the Cannibal King', img: 'icons/creatures/unholy/demon-horned-black-yellow.webp',
    role: 'Demon king', descriptor: 'The demon king beyond the wall',
    md: 'Ager rules the blasted land of Qianpo, beyond Chuni\'s Wall, and exists to destroy every Tianqi. The Tianqi have fought him for hundreds of years.' },
  { key: 'wanabbul', faction: 'ager', actor: 'wanabbul', role: 'Demon', descriptor: 'A shadow as tall as the wall, trailing black smoke',
    md: '{{actor:wanabbul}}: the demon who comes for the gate in the introductory fight. How he fights is on the GM Guide\'s *Running the Encounter* page.' },
  { key: 'grubnut', faction: 'ager', actor: 'grubnut', role: 'Demon', descriptor: 'One of the one-shot\'s optional demons',
    md: '{{actor:grubnut}}: one of the full one-shot\'s demons (the GM Guide\'s *Optional Demons* page).' },
  { key: 'csenorras', faction: 'ager', actor: 'csenorras', role: 'Demon', descriptor: 'A demon that splits into swarms',
    md: '{{actor:csenorras}}: one of the full one-shot\'s demons, which splits into swarms (the GM Guide\'s *Optional Demons* page).' },
  { key: 'weaver', faction: 'ager', actor: 'weavers_daughter', role: 'Demon', descriptor: 'She spins Weaverspools',
    md: '{{actor:weavers_daughter}}: one of the full one-shot\'s demons, with her Weaverspools (the GM Guide\'s *Optional Demons* page).' },
  { key: 'honnasusara', faction: 'tianqi', actor: 'honnasusara', pc: true, role: 'Wall guard (Soldier)', descriptor: 'An honored soldier of the wall',
    md: '{{actor:honnasusara}}: an honored soldier who has manned Chuni\'s Wall since she was a youth. Mother of Manchuthara.' },
  { key: 'manchuthara', faction: 'tianqi', actor: 'manchuthara', pc: true, role: 'Wall guard (Sentinel)', descriptor: 'A crossbowman of the wall',
    md: '{{actor:manchuthara}}: an accomplished crossbowman and expert marksman of the wall. Daughter of Honnasusara.' },
  { key: 'selthimor', faction: 'tianqi', actor: 'selthimor', pc: true, role: 'Wall guard (Thug)', descriptor: 'Newest to the wall',
    md: '{{actor:selthimor}}: newer to the group, from Tian Chun, a religious capital of the Tianqi. He mans the great ballista.' },
  { key: 'chunrudar', faction: 'tianqi', actor: 'chunrudar', pc: true, role: 'Wall guard (Fatebound)', descriptor: 'Pact-bound to a demon of the mists',
    md: '{{actor:chunrudar}}: bound by a pact to a demon of the mists, whose power he wields as a misty sword.' },
];

/** The quest. Its objectives' intents are Nexus's (defend, eliminate, custom …). */
export const QUEST = {
  title: 'Man the Wall', image: 'cover.webp', status: 'ongoing', audience: 'all',
  md: `> Chuni's Wall is a pale and desolate place. Your station here is an isolated and cold one, as you watch northward into the Upper Heibrim. Demons prowl the lands north of here. It is a quiet and tense post. Until it isn't.

Tonight, one of Ager's demons comes for the gate.`,
  gmNotes: 'The fight is on the GM Guide\'s Running the Encounter page. Wanabbul is the introductory demon.',
  objectives: [
    { key: 'hold', text: 'Hold the gate', intent: 'defend',
      description: 'Keep the demon from breaching Chuni\'s Wall. The ballistas, the oil and the height are yours.' },
    { key: 'alarm', text: 'Raise the alarm', intent: 'custom', customIntent: 'Signal',
      description: 'Send smoke along the wall, fort to fort, so the next forts take up arms.' },
    { key: 'kill', text: 'Kill the demon', intent: 'eliminate',
      description: 'If it breaks through, kill it before it reaches the towns of the Lower Heibrim.' },
  ],
  reward: 'The Right to Victory: whoever deals the final blow claims the spoils, the honors and the accolades (Tianqi custom).',
  // Connections: [slot, objective key (or none), faction or person key].
  links: [['giver', '', 'tianqi'], ['opposition', 'hold', 'ager'], ['target', 'kill', 'wanabbul']],
};
