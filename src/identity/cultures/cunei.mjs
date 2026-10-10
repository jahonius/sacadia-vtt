/** The Cunei Myrgha (rulebook v1.2 printed pp.37–48). The shape is described in src/identity/cultures.mjs. */
export default {
  key: 'cunei', name: 'Cunei Myrgha', aliases: 'Cunei', page: 37, img: 'icons/skills/trades/construction-mason-stonecutter-sculpture.webp',
  summary: 'A once-colony of the Myrgha, the Cuneises have achieved independence through a series of rebellions, and today exist with the fractured but fading resemblance of the Myrgha. This proud, fierce people is known for artisanship, mining, and agriculture, still serving as the Myrgha breadbasket. The Black and White Cuneises are culturally similar, but still fractured as two separate and distinct cultures, so the Cunei Myrgha have two subcultures: the Black Cuneis (the Agricultural Core of the Cuneises) and the White Cuneis (the Mining and Marblework Core of the Cuneises). The Cunei Myrgha are an Industrial, Legalistic colony at the beginning of their rise to empire.',
  subcultures: ['White Cunei', 'Black Cunei'],
  laws: [
    ['Simple Artisanship', 'You must value a well-made and simple craft as a thing of beauty. You disdain poor craftsmanship and overly complex crafts.'],
    ['Legalist Pride', 'You must value Cunei Legalism, using the letter of the law and not the spirit of the law in your interpretation of law.'],
    ['A Prejudiced Color Scheme', 'You must wear the shade of your home Cuneis (black or white) and never an article of clothing or item from the other - not even if painted over.'],
    ['Cunei Prejudice', 'You have an innate disdain for members of the other Cuneis, and may struggle to clamp this down, even if you wish to.', true],
    ['Myrgha Prejudice', 'You have an innate suspicion and mistrust of the Myrgha, and see them as the root of problems in your culture.', true],
  ],
  // "All Cunei Myrgha start off with one of the following Cultural Talents."
  options: [
    { key: 'intrigue', label: 'Cunei Intrigue', grant: 'cunei_cunei_intrigue' },
    { key: 'farmer', label: 'Farmer’s Eye (Black Cunei)', grant: 'cunei_farmers_eye' },
    { key: 'marble', label: 'Artisanal Marblework (White Cunei)', grant: 'cunei_artisanal_marblework' },
  ],
  talents: [
    { id: 'cunei_cunei_intrigue', name: 'Cunei Intrigue', tag: 'passive', page: 37, prerequisite: 'Cunei Cultural Heritage', img: 'icons/sundries/documents/document-sealed-signatures-red.webp',
      description: 'Add the following ability to the Literary Talent tree. You can purchase the below ability using Talent Points: Codebreaker.' },
    { id: 'cunei_farmers_eye', name: 'Farmer’s Eye', tag: 'passive', page: 37, prerequisite: 'Black Cunei Subculture', img: 'icons/skills/trades/farming-wheat-circle-yellow.webp',
      talentBonus: { wilderness: 2 },
      description: 'Add +2 to all Wilderness Checks you make. Additionally, you can always identify foodcrops at a glance.' },
    { id: 'cunei_artisanal_marblework', name: 'Artisanal Marblework', tag: 'passive', page: 37, prerequisite: 'White Cunei Subculture', img: 'icons/skills/trades/construction-mason-stonecutter-sculpture.webp',
      grantsSpecialty: { talent: 'construction', name: 'Stonework' },
      description: 'You have an innate sense for marble and how to use it. Gain 1 level in Construction: Stonework, even if you do not have Construction. Additionally, if you create a craft using only Marble, increase the resultant rarity by one type.' },
  ],
  language: { id: 'cunei_bushiu', name: 'Bushiu', page: 37, prerequisite: 'Cunei Myrgha Cultural Heritage', description: 'You speak the Bushiu language.' },
  ancestries: [
    { id: 'cunei_marblekin', name: 'Marblekin', heritage: 'fixerfolk', page: 43, size: 'Medium (6.5–8 feet)', lifespan: 'Typically 65–85 years',
      img: 'icons/magic/defensive/armor-stone-skin.webp', lore: ['lore_marble_swim'],
      description: 'Marblekin have skin and eyes of pure marble, and are typically powerful and large.',
      abilities: [
        { id: 'cunei_stoneskin', name: 'Stoneskin', tag: 'passive', page: 43, prerequisite: 'Marblekin Fixerfolk Ancestry', img: 'icons/magic/defensive/armor-stone-skin.webp',
          resistance: { types: ['slashing', 'piercing'], value: 'ceil(@proficiency/2)' },
          description: 'Your skin is tough to pierce. Gain Damage Resistance equal to half your Proficiency (rounded up) to slashing or piercing weapons.' },
      ] },
  ],
  groups: [
    { label: 'Literary Talent', note: 'Bought with Talent Points, through Cunei Intrigue.', abilities: [
      { id: 'cunei_codebreaker', name: 'Codebreaker', tag: 'passive', page: 37, prerequisite: 'Cunei Cultural Heritage, Literary: Translate[3]', img: 'icons/sundries/documents/document-symbol-eye.webp',
        description: '<em>Talent Points: 1.</em> You can decipher a text without a codex. Doing so requires that you expend a Long Rest action deciphering the text.' },
    ] },
    { label: 'All Cunei', note: 'All Cunei can take the following abilities provided they meet the prerequisites.', abilities: [
      { id: 'cunei_perfect_polishing', name: 'Perfect Polishing', tag: 'passive', csp: 3, page: 43, prerequisite: 'Cunei Cultural Heritage, Soldier', img: 'icons/weapons/swords/sword-guard-steel-green.webp',
        pick: { kind: 'weaponType', label: '' },
        modifiers: [
          { label: 'Perfect Polishing', target: 'toHit', value: '1', predicate: [{ atom: 'self:attack:picked:cunei_perfect_polishing' }] },
          { label: 'Perfect Polishing', target: 'damage', value: '1', predicate: [{ atom: 'self:attack:picked:cunei_perfect_polishing' }] },
        ],
        description: 'Choose one iron weapon you use. You gain +1 To-Hit and damage with that weapon. <em>(Choose its type on this card.)</em>' },
      { id: 'cunei_on_the_fly_restoration', name: 'On-the-Fly Restoration', tag: 'action', csp: 3, page: 43, prerequisite: 'Cunei Cultural Heritage', img: 'icons/tools/smithing/hammer-sledge-steel-grey.webp',
        onUse: { self: [{ condition: 'rended', amount: '-1' }], target: [] },
        description: 'Remove one level of Rend you possess. You may use this only once per turn.' },
      { id: 'cunei_meditative_will', name: 'Meditative Will', tag: 'passive', csp: 4, page: 43, prerequisite: 'Cunei Cultural Heritage', img: 'icons/magic/perception/third-eye-blue-red.webp',
        description: 'You are immune to Frenzy.' },
    ] },
    { label: 'Black Cunei', note: 'Members of the Black Cunei subculture can take the following abilities.', abilities: [
      { id: 'cunei_water_running_over_stone', name: 'Water Running over Stone', tag: 'passive', csp: 4, page: 43, prerequisite: 'Black Cunei Subculture, Sentinel', img: 'icons/magic/water/bubbles-air-water-blue.webp',
        description: 'Choose one square within 15ft of you. You may move there without provoking an attack of Opportunity. You may only use this ability if you are Surrounded.' },
      { id: 'cunei_the_root_of_a_mighty_maple', name: 'The Root of a Mighty Maple', tag: 'passive', csp: 3, page: 43, prerequisite: 'Black Cunei Subculture, Soldier, Propped Up', img: 'icons/magic/nature/leaf-glow-maple-orange.webp',
        description: 'Increase damage you deal with melee attacks by one dice type per ally you have within 5ft of you when maintaining Focus on Protectorate, rather than only behind you.' },
    ] },
    { label: 'White Cunei', note: 'Members of the White Cunei subculture can take the following abilities.', abilities: [
      { id: 'cunei_a_spinning_maple_seed', name: 'A Spinning Maple Seed', tag: 'passive', csp: 3, page: 43, prerequisite: 'White Cunei Subculture, Sentinel', img: 'icons/magic/nature/leaf-glow-maple-teal.webp',
        description: 'When you are within 5ft of an allied Soldier, increase your bow’s to-hit and damage by 1.' },
      { id: 'cunei_a_pebble_that_splashes', name: 'A Pebble That Splashes', tag: 'reaction', csp: 4, page: 43, prerequisite: 'White Cunei Subculture, Soldier', img: 'icons/magic/water/orb-water-bubbles-blue.webp',
        description: 'As a Reaction to an ally moving to within 5ft of you when you are steadied, move up to half your Move Speed (rounded up) to where they moved from.' },
    ] },
  ],
};
