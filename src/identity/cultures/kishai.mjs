/** The Kishai (rulebook v1.2 printed pp.69–78). The shape is described in src/identity/cultures.mjs. */
const SONG = 'Song of the Solemn';
export default {
  key: 'kishai', name: 'Kishai', aliases: 'Kish', page: 69, img: 'icons/magic/nature/leaf-arrowheads-glow-green.webp',
  summary: 'The Kishai are grassland tribesmen, inhabiting semi-controllable, giant floating metallic shells that collect iron beneath them from the iron-rich, but tormented, grass font beneath them. Each of their few remaining skyships are held together through strange mysteries, and they worship the ships as Gods. The Kishai are a superstitious, tribal culture at the end of their lifespan.',
  laws: [
    ['Property', 'You cannot possess personal property, and must share all items with others, according to who can take best advantage of each item.'],
    ['Respect for Elderly', 'You must respect the authority and will of Kishai who are older than you at all times.'],
    ['Outsiders', 'You are forbidden from talking with outsiders to Kish, unless you are specifically designated by your tribe to speak with Outsiders. If an Outsider comes into Kish without the express permission of your tribal leader, you must kill them.'],
    ['Meat', 'You cannot eat meat except as a part of holy Kishai ceremonies.'],
    ['Illiterate', 'You cannot take the Literary Talent.'],
  ],
  talents: [
    { id: 'kishai_kish_customs', name: 'Kish Customs', tag: 'passive', page: 69, prerequisite: 'Kishai Cultural Heritage', img: 'icons/magic/nature/leaf-arrowheads-glow-green.webp',
      description: 'Add the following ability to the Survival Talent tree. You can purchase the below ability using Talent Points: Spinelord Resistance.' },
    // "All Kishai gain Song of the Solemn."
    { id: 'kishai_song_of_the_solemn', name: SONG, tag: 'focus', page: 73, prerequisite: 'Kishai Cultural Heritage', img: 'icons/magic/nature/instrument-recorder-leaves.webp',
      description: 'For as long as you maintain Focus on this, you cannot speak. All allied Kishai know exactly which square you are on the combat map for as long as you use this ability.' },
  ],
  language: { id: 'kishai_kish', name: 'Kish', page: 69, description: 'You speak the Kish language.' },
  ancestries: [
    { id: 'kishai_grassfolk', name: 'Grassfolk', heritage: 'fontborne', page: 73, img: 'icons/magic/nature/leaf-arrowheads-glow-green.webp',
      grants: [['kishai_grasswinds', 'light'], ['kishai_rooting', 'heavy']],
      description: 'A child of Kish, you are corrupted by your time spent within the Sea of Blades. You might be corrupted weakly (if Lightly Warped) or strongly (if Heavily Warped). Kish is an Air Element Font. You may be corrupted into a Grassfolk from a Human Ancestry by Grass Font corruption in Kish. If so, you will replace your Human Ancestry abilities with General Fontborne Ancestry abilities as well as those below. Take the ability that matches the strength of your Corruption (Strength of Warp).',
      abilities: [
        { id: 'kishai_grasswinds', name: 'Grasswinds', tag: 'boost', page: 73, prerequisite: 'Lightly Warped', img: 'icons/magic/air/air-wave-gust-blue.webp',
          description: 'As a Boost to a Move action once per turn, you may increase your Move Speed by 5ft for that Move action.' },
        { id: 'kishai_rooting', name: 'Rooting', tag: 'passive', page: 73, prerequisite: 'Heavily Warped', img: 'icons/magic/nature/barrier-shield-wood-vines.webp',
          description: 'When you are standing still, your feet root into the ground. You are resistant to any ability that would try to push you on the battlemap (e.g., Kick or Dragged).' },
      ] },
  ],
  groups: [
    { label: 'Survival Talent', note: 'Bought with Talent Points, through Kish Customs.', abilities: [
      { id: 'kishai_spinelord_resistance', name: 'Spinelord Resistance', tag: 'passive', page: 69, prerequisite: 'Kishai Cultural Heritage, Survival', img: 'icons/magic/nature/leaf-arrowheads-glow-green.webp',
        description: '<em>Talent Points: 1 to 3.</em> When you make Survival Checks to navigate Kish, Forage, survive unique Kish biomes, or when you roll against Font Corruption from the Grass Font, gain 1X advantage for each level of Spinelord Resistance you possess.' },
    ] },
    { label: 'Songs of the Solemn', note: 'All Kishai sing the Song of the Solemn, but each Kishai member may weave their own unique harmonics into this somber throatsong. These Boosts work for as long as you maintain Focus on Song of the Solemn.', abilities: [
      { id: 'kishai_song_of_the_grasshopper', name: 'Song of the Grasshopper', tag: 'passive', csp: 2, page: 73, prerequisite: `${SONG}, Bladedancer`, img: 'icons/creatures/invertebrates/beetle-stag-yellow-green.webp',
        description: 'For as long as you maintain Focus, you may hurdle a 5ft greater gap, or jump a 10ft greater horizontal distance.' },
      { id: 'kishai_song_of_the_skies', name: 'Song of the Skies', tag: 'passive', csp: 5, page: 73, prerequisite: `${SONG}, Fatebound, Targeted Foe`, img: 'icons/magic/air/air-burst-spiral-large-blue.webp',
        description: 'For as long as you maintain Focus on Song of the Solemn, increase your critical hit range by 1 against a Targeted Foe (i.e., if you would critical hit on a natural 20, you do on a 19 or 20).' },
      { id: 'kishai_song_of_sorrows', name: 'Song of Sorrows', tag: 'passive', csp: 2, page: 73, prerequisite: `${SONG}, Oracle`, img: 'icons/magic/nature/leaf-glow-teal.webp',
        description: 'For as long as you maintain Focus on Song of the Solemn, gain damage resistance 1 against damage you would deal to yourself.' },
      { id: 'kishai_song_of_the_breeze', name: 'Song of the Breeze', tag: 'passive', csp: 2, page: 73, prerequisite: `${SONG}, Sentinel`, img: 'icons/magic/air/air-wave-gust-smoke-yellow.webp',
        description: 'For as long as you maintain Focus on Song of the Solemn, your ranged weapon attacks ignore any disadvantage effects caused by wind conditions. Additionally, increase the range of all ranged weapons by 20ft.' },
      { id: 'kishai_song_of_triumph', name: 'Song of Triumph', tag: 'passive', csp: 4, page: 73, prerequisite: `${SONG}, Soldier`, img: 'icons/skills/social/intimidation-impressing.webp',
        description: 'For as long as you maintain Focus on Song of the Solemn, all enemies have 1X Disadvantage on Trait Checks to prevent Taunt where you are the source.' },
      { id: 'kishai_song_of_the_net', name: 'Song of the Net', tag: 'passive', csp: 3, page: 73, prerequisite: `${SONG}, Thug, Harm`, img: 'icons/skills/melee/unarmed-punch-fist.webp',
        description: 'For as long as you maintain Focus on Song of the Solemn, increase the damage of Harm by one dice type.' },
    ] },
  ],
  inheritanceNotes: `## Shared Property

Kishai do not possess personal property, but your village or Skyship will have access to a number of goods that are considered shared resources. These shared resources will always follow the same rules:

- **Need:** Anyone in the society who needs one of the shared crafts or items may claim it until the next long rest, after which time they must return it to the village.
- **Capability:** Villagers can only take an item if they have the capability to wield it safely (i.e., meet the Proficiency requirements).
- **Corruption:** If two villagers fight over an item, it is because the item is too tempting an influence, and must be destroyed by the village.

## Property Counts

The Kishai count of craft items is not based on the number of people in your party, but the size of your village:

- **Skyships:** 8 Craft Items.
- **Exile Village:** 3 Craft Items.

When you are starting a Kishai game, your whole group should work together to select what craft items you want to make available to your group.

## Personal Property and Inheritance

Kishai do not believe or allow for personal property, and so inheritance rules differ for the Kishai than for other cultures. Other cultures that do not believe in personal property will follow these rules as well.`,
};
