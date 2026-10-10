/**
 * The Heritages and their global Ancestries (rulebook v1.2 Chapter III, printed pp.80–92), built into the Heritages &
 * Ancestries compendium by src/build-packs.mjs. Each culture's own ancestries are in src/identity/cultures/.
 *
 * - `HERITAGE_ABILITIES`: every character of the Heritage has these (rules/identity.mjs grants them); one with a
 *   `choice` only when that's the Heritage choice taken (CONFIG.SACADIA.heritageInfo: Natural Charisma, Strength of Warp).
 * - `ANCESTRIES`: an `ancestry` item each, granting its abilities (`grants`: ability ids, or `[id, option]` where the
 *   option is the Heritage choice the grant goes with — a Fontborne ancestry's Lightly / Heavily Warped ability).
 * - `ANCESTRY_ABILITIES`: the abilities those grant.
 *
 * An ability's mechanics ride its entry: `modifiers` (the unified conditional modifiers), `pick` (a choice made when you
 * take it), and flags (`grantsSpecialty`: a specialized talent rank; `expertise`: a Check Expertise; `resistance`: a
 * standing damage resistance). The text is the rulebook's; the rest is descriptive (the player applies it).
 */

const ICON = {
  human: 'icons/environment/people/commoner.webp',
  curiot: 'icons/creatures/mammals/humanoid-wolf-dog-blue.webp',
  daemonai: 'icons/magic/unholy/hand-marked-pink.webp',
  fixerfolk: 'icons/creatures/magical/fae-fairy-winged-glowing-green.webp',
  fontborne: 'icons/magic/earth/orb-stone-smoke-teal.webp',
  hulinari: 'icons/creatures/mammals/deer-antlers-glowing-blue.webp',
};

/** Ability ids are prefixed `her_` (they share the catalog-id space with every other compendium). */
export const HERITAGE_ABILITIES = [
  { id: 'her_industrial', heritage: 'human', name: 'Industrial', tag: 'passive', page: 81, img: 'icons/tools/smithing/anvil.webp',
    description: 'You are extremely industrious, and are adept at using the tools you need. Choose one weapon, tool, or armor in which you do not already have Training, and gain Training in the use of that item.' },
  { id: 'her_friend_of_nature', heritage: 'curiot', name: 'Friend of Nature', tag: 'passive', page: 83, img: 'icons/creatures/mammals/deer-antlers-green.webp',
    description: 'When you choose to play a Curiot, choose an animal species that you embody. Whenever you encounter this species of animal, you may speak to them in their native language and they will always treat you as friendly.' },
  { id: 'her_natural_charisma', heritage: 'daemonai', name: 'Natural Charisma', tag: 'passive', page: 85, img: 'icons/skills/social/intimidation-impressing.webp',
    description: 'You have a natural and easy charisma that comes through whether you intend it to or not. Gain one of the following abilities (choose one now): Intuit or Speak. <em>(Choose it under Heritage on the Character tab.)</em>' },
  { id: 'her_intuit', heritage: 'daemonai', choice: 'intuit', name: 'Intuit', tag: 'boost', page: 85, img: 'icons/magic/perception/eye-slit-orange.webp',
    description: 'You may roll 1D6 and add it to any roll you make to understand someone’s intent, or to intuit their feelings.' },
  { id: 'her_speak', heritage: 'daemonai', choice: 'speak', name: 'Speak', tag: 'boost', page: 85, img: 'icons/skills/social/diplomacy-peace-alliance.webp',
    description: 'You may roll 1D6 and add it to any roll you make to speak dramatically, either to intimidate or to charm.' },
  { id: 'her_fae_attunement', heritage: 'fixerfolk', name: 'Fae Attunement', tag: 'passive', page: 87, img: 'icons/magic/nature/leaf-glow-triple-teal.webp',
    description: 'You have a natural intuition of Fae and Fae magic. When you encounter Fae magic, you can recognize the feeling of it. You also have a more natural attunement to the earth, and can use this to recognize natural magic.' },
  { id: 'her_strength_of_warp', heritage: 'fontborne', name: 'Strength of Warp', tag: 'passive', page: 89, img: 'icons/magic/earth/orb-stone-smoke-teal.webp',
    description: 'Work with your GM to understand nearby Fonts to choose from and their elemental affinity. Then choose one when you choose to play a Fontborne: Lightly Warped or Heavily Warped. <em>(Choose it under Heritage on the Character tab.)</em>' },
  { id: 'her_lightly_warped', heritage: 'fontborne', choice: 'light', name: 'Lightly Warped', tag: 'passive', page: 89, img: 'icons/magic/earth/orb-ringed-lava-black-orange.webp',
    description: 'You have a small touch of a nearby Font. Denote a hint of its presence in your appearance (e.g., unnatural eyes or hair). Then, take one Human Ancestry or Heritage ability.' },
  { id: 'her_heavily_warped', heritage: 'fontborne', choice: 'heavy', name: 'Heavily Warped', tag: 'passive', page: 89, img: 'icons/magic/earth/lava-stone-fire-eye.webp',
    description: 'You have a heavy touch of a nearby Font. Dramatically alter your appearance to match the Font (e.g., your skin cracks with sand). Also, you naturally warp the characteristics of materials with the same type of natural affinity as you. If you craft with a craft ingredient of an elemental type aligned with your Font, increase the rarity by one type and double the probability of it having a strange property.' },
  { id: 'her_extreme_sensing', heritage: 'hulinari', name: 'Extreme Sensing', tag: 'passive', page: 91, img: 'icons/magic/perception/eye-ringed-green.webp',
    grantsSpecialty: { talent: 'perception', name: '' },
    description: 'Gain one free Perception Talent Specialization now. You do not need to take general Perception prerequisites to take this talent, though you may not further level into this talent without taking the general Perception talent you specialize into. <em>(It’s added to your specialized talents; name it there.)</em>' },
  { id: 'her_change_form', heritage: 'hulinari', name: 'Change Form', tag: 'action', page: 91, img: 'icons/creatures/mammals/wolf-howl-moon-forest-blue.webp',
    description: 'You may change between human and beast form with a single action. That action exhausts all limbs. When you are in animal form, retain the benefits of all worn armor that does not use a limb component to wield to your mental and physical defense. You may not use any item or somatic ability, and beginning at level 1 you cannot speak at all when in animal form. Beginning at level 5, you can say a single human word per round of combat in animal form. Beginning at level 11, you can say up to five words per round. <em>(Toggle Beast Form on your token.)</em>' },
].map((a) => ({ ...a, img: a.img ?? ICON[a.heritage] }));

/** The abilities the global ancestries grant (ids `anc_`). */
export const ANCESTRY_ABILITIES = [
  { id: 'anc_artisanal_crafting', name: 'Artisanal Crafting', tag: 'boost', page: 82, prerequisite: 'Craftsman Human Ancestry', img: 'icons/skills/trades/construction-carpentry-hammer.webp',
    description: 'Whenever you are crafting, you may roll 1D6 and add it to any single crafting roll you make. You may only do this once per craft, but you may choose to roll this after you have made your craft roll. This 1D6 changes to 1D8 at level 5, and to 1D10 at level 11.' },
  { id: 'anc_strong_constitution', name: 'Strong Constitution', tag: 'passive', page: 82, prerequisite: 'Resilient Human Ancestry', img: 'icons/magic/control/buff-strength-muscle-damage-red.webp',
    modifiers: [{ label: 'Strong Constitution', target: 'health.max', value: '@level', predicate: [] }],
    description: 'Gain an additional 1 HP per level, beginning at level 1.' },
  { id: 'anc_extra_talents', name: 'Extra Talents', tag: 'passive', page: 82, prerequisite: 'Talented Human Ancestry', img: 'icons/skills/trades/academics-book-study-purple.webp',
    description: 'When you choose to play this Heritage, gain one extra Talent Point to spend as you wish.' },
  { id: 'anc_brutish_constitution', name: 'Brutish Constitution', tag: 'passive', page: 84, prerequisite: 'Brute Curiot Ancestry', img: 'icons/creatures/mammals/ox-buffalo-horned-green.webp',
    modifiers: [{ label: 'Brutish Constitution', target: 'health.max', value: '6', predicate: [] }],
    description: 'You are particularly large and imposing. Increase your starting Level 1 HP by an additional 6.' },
  { id: 'anc_glide', name: 'Glide', tag: 'boost', page: 84, prerequisite: 'Flying Curiot Ancestry', img: 'icons/magic/control/buff-flight-wings-blue.webp',
    description: 'As a Boost to a Move action, you may glide up to your move speed. Ignore any difficult terrain or impassable areas (such as gaps). You may not vertically ascend with Glide. You still provoke attacks of opportunity.' },
  { id: 'anc_tight_squeeze', name: 'Tight Squeeze', tag: 'boost', page: 84, prerequisite: 'Stealthy Curiot Ancestry', img: 'icons/creatures/mammals/rodent-rat-green.webp',
    description: 'Once during a move action as a boost, you move through a space occupied by a creature (or a gap between two creatures on a diagonal) as though it is difficult terrain. If another effect already gives you the ability to move through these spaces as difficult terrain, you may move through them freely.' },
  { id: 'anc_changing_physicality', name: 'Changing Physicality', tag: 'passive', page: 86, prerequisite: 'Courter Daemonai Ancestry', img: 'icons/magic/perception/mask-stone-eyes-orange.webp',
    description: 'Every long rest, change one aspect of your appearance permanently. You may select any part of your appearance, including gender. Once you soulbond, fix your appearance (do not even age) until you die.' },
  { id: 'anc_shadowstep', name: 'Shadowstep', tag: 'boost', page: 86, prerequisite: 'Shadesman Daemonai Ancestry', img: 'icons/magic/perception/silhouette-stealth-shadow.webp',
    description: 'As a Boost to a move action, you may step from one shadow to another up to 30ft away. Treat this step as 5ft of Movement. Shadowstep does provoke an attack of opportunity, but only from the stepping origin point as you leave.' },
  { id: 'anc_elemental_resistance', name: 'Elemental Resistance', tag: 'passive', page: 88, prerequisite: 'Sylnfolk Fixerfolk Ancestry', img: 'icons/magic/nature/leaf-glow-maple-teal.webp',
    pick: { kind: 'element', label: 'SACADIA.Origin.YourElement' }, resistance: { pick: true, value: '@proficiency' },
    description: 'You have Damage Resistance equal to your Proficiency to damage of your elemental type. Out of combat, you are peculiarly resistant to effects of your aligned type. <em>(Choose your element on this card.)</em>' },
  { id: 'anc_tempered_calm', name: 'Tempered Calm', tag: 'passive', page: 88, prerequisite: 'Patlar Fixerfolk Ancestry', img: 'icons/magic/control/buff-strength-muscle-damage.webp',
    description: 'Whenever you roll Power Checks against levels of a mental condition, you may add your Power Score to one die rolled.' },
  { id: 'anc_radiation_sickness', name: 'Radiation Sickness', tag: 'focus', page: 90, prerequisite: 'Lightly Warped', img: 'icons/magic/unholy/orb-smoking-green.webp',
    description: 'For as long as you maintain Focus, you radiate a Dim green glow up to 5Xft (where X is half your proficiency, rounded up). The first time a creature enters this range in a combat, they roll Fate Checks against X Nausea, where X is half your Proficiency (rounded up). You can use this once per Nightly Rest.' },
  { id: 'anc_corrosive_glow', name: 'Corrosive Glow', tag: 'action', page: 90, prerequisite: 'Heavily Warped', img: 'icons/magic/unholy/beam-impact-green.webp',
    description: 'Once per long rest, you can blast a radiation of corrosion outwards from you. All creatures within 5Xft (where X is half your Proficiency, rounded up) make Fate Checks against X levels of Corrosion (where X is half your Proficiency, rounded up).' },
  // Hulinari forms (book p.92): the form's two abilities, and Swarm's Fly.
  { id: 'anc_graceful_animal', name: 'Graceful Animal', tag: 'passive', page: 92, prerequisite: 'Pack Form', img: 'icons/creatures/mammals/deer-movement-leap-green.webp',
    expertise: 'finesse', description: 'You have Check Expertise in Finesse.' },
  { id: 'anc_with_all_haste', name: 'With All Haste', tag: 'passive', page: 92, prerequisite: 'Pack Form', img: 'icons/skills/movement/figure-running-gray.webp',
    // "May use Finesse": the difference when it's the better Trait.
    modifiers: [
      { label: 'With All Haste', target: 'toHit', value: 'max(0, @finesse - @power)', predicate: [{ atom: 'attack:melee' }, { atom: 'self:form:pack' }] },
      { label: 'With All Haste', target: 'damage', value: 'max(0, @finesse - @power)', predicate: [{ atom: 'attack:melee' }, { atom: 'self:form:pack' }] },
    ],
    description: 'You may use Finesse for melee attack to-hit and damage when in Pack Form. <em>(Applied when your Finesse is the higher.)</em>' },
  { id: 'anc_beastly_fortitude', name: 'Beastly Fortitude', tag: 'passive', page: 92, prerequisite: 'Brute Form', img: 'icons/creatures/mammals/bull-horns-eyes-glowin-orange.webp',
    expertise: 'power', description: 'You have Check Expertise in Power.' },
  { id: 'anc_with_force', name: 'With Force', tag: 'passive', page: 92, prerequisite: 'Brute Form', img: 'icons/creatures/mammals/ox-bull-horned-glowing-orange.webp',
    modifiers: [{ label: 'With Force', target: 'damage', mode: 'step', scope: 'melee', value: '1', predicate: [{ atom: 'self:attack:weapon:unarmed' }, { atom: 'self:form:brute' }] }],
    description: 'Gain proficiency in Heavy Physical Armor. Your unarmed attacks do 1D10 base damage instead of 1D8.' },
  { id: 'anc_smart_flock', name: 'Smart Flock', tag: 'passive', page: 92, prerequisite: 'Swarm Form', img: 'icons/creatures/birds/corvid-watchful-glowing-green.webp',
    expertise: 'wiles', description: 'You have Check Expertise in Wiles.' },
  { id: 'anc_with_cunning', name: 'With Cunning', tag: 'passive', page: 92, prerequisite: 'Swarm Form', img: 'icons/creatures/birds/corvid-call-sound-glowing.webp',
    modifiers: [
      { label: 'With Cunning', target: 'toHit', value: 'max(0, @wiles - @power)', predicate: [{ atom: 'attack:melee' }, { atom: 'attack:physical' }, { atom: 'self:form:swarm' }] },
      { label: 'With Cunning', target: 'damage', value: 'max(0, @wiles - @power)', predicate: [{ atom: 'attack:melee' }, { atom: 'attack:physical' }, { atom: 'self:form:swarm' }] },
    ],
    description: 'You may use Wiles for physical attack to-hit and damage when in Swarm Form, rather than Power. When in animal form, gain the Fly action. <em>(Applied when your Wiles is the higher.)</em>' },
  { id: 'anc_fly', name: 'Fly', tag: 'action', page: 92, prerequisite: 'Swarm Form', img: 'icons/creatures/birds/birds-flock-fly-yellow.webp',
    description: 'A player with the ability to fly can fly up to their move speed. This action can be split by another action, which can be put in the middle of movement. The fly action can be used in lieu of a move action by a Hulinari character in Swarm Form. <em>(Your Fly speed shows in the header while you’re in Swarm Form.)</em>' },
];

/**
 * The global ancestries (ids `anc_`). `description` is the book's portrait of them; `size` / `lifespan` when the book
 * gives them (else the Heritage's); `hulinariForm` sets a Hulinari Warrior's form.
 */
export const ANCESTRIES = [
  { id: 'anc_craftsman', name: 'Craftsman', heritage: 'human', page: 82, img: 'icons/skills/trades/construction-carpentry-hammer-gray.webp', grants: ['anc_artisanal_crafting'],
    description: 'You are a natural craftsman, and have a knack for making things. Perhaps you’ve trained your whole life, or maybe you’re just a natural. Either way, you are an exceptional crafter.' },
  { id: 'anc_resilient', name: 'Resilient', heritage: 'human', page: 82, img: 'icons/magic/defensive/armor-stone-skin.webp', grants: ['anc_strong_constitution'],
    description: 'You, like many humans, are naturally resilient. When others get knocked down and stay down, you get back up. Your resilience has made you strong, and will keep you out of trouble (or in it).' },
  { id: 'anc_talented', name: 'Talented', heritage: 'human', page: 82, img: 'icons/skills/trades/academics-study-reading-book.webp', grants: ['anc_extra_talents'],
    description: 'You have always been able to do many things - even things others thought impossible. Perhaps it is your quick wit, or your yearning for knowledge. Whatever the case, you are jamming a long lifetime of experience into your brief span on this earth.' },
  { id: 'anc_brute_curiot', name: 'Brute Curiot', heritage: 'curiot', page: 84, size: 'Medium (6–7.5 feet)', lifespan: 'Typically 45–65 years', img: 'icons/creatures/mammals/ox-buffalo-horned-green.webp',
    grants: ['anc_brutish_constitution'],
    description: 'Brute Curiots are large, imposing, and powerful. They may represent bears, boars, elephants, rhinos, etc.' },
  { id: 'anc_flying_curiot', name: 'Flying Curiot', heritage: 'curiot', page: 84, size: 'Medium (4–6 feet)', lifespan: 'Typically 40–60 years', img: 'icons/creatures/mammals/bat-movement-flying-blue-purple.webp',
    grants: ['anc_glide'],
    description: 'Flying Curiots are descended from flighted Hulinari, such as mosquitos, birds, or bats.' },
  { id: 'anc_stealthy_curiot', name: 'Stealthy Curiot', heritage: 'curiot', page: 84, size: 'Medium (3.5–5 feet)', lifespan: 'Typically 35–55 years', img: 'icons/creatures/mammals/rodent-rat-green.webp',
    grants: ['anc_tight_squeeze'],
    description: 'Stealthy Curiots are small, quiet, and unimposing. They can represent rodents, small frogs, or other tiny creatures.' },
  { id: 'anc_courter', name: 'Courter', heritage: 'daemonai', page: 86, size: 'Medium (5–6 feet)', lifespan: 'Immortal until bonded, then the lifespan of their partner', img: 'icons/magic/perception/mask-stone-eyes-orange.webp',
    grants: ['anc_changing_physicality'],
    description: 'Courters are the descendants of Tallemar - demonic shapeshifters who stole first the hearts, then the souls of their victims. Courters are often considered divinely persuasive, and they have a unique curse - they are immortal until they fall in love, at which time they soulbond to their partner, living until their partner dies.' },
  { id: 'anc_shadesman', name: 'Shadesman', heritage: 'daemonai', page: 86, size: 'Medium (6–7 feet)', lifespan: '60–80 years', img: 'icons/magic/perception/shadow-stealth-eyes-purple.webp',
    grants: ['anc_shadowstep'],
    description: 'Shadesmen are the descendants of Shades - powerful shadow demons that once stalked the dark shadows of the world, hunting victims from their own shadows. Shadesmen are at home in the dark, and have the appearance of a dark, shadowy figure, obscured physically in black smoke or shadow.' },
  { id: 'anc_sylnfolk', name: 'Sylnfolk', heritage: 'fixerfolk', page: 88, size: 'Medium (4–5 feet)', img: 'icons/magic/nature/leaf-flower-wreath-glow-green-blue.webp',
    grants: ['anc_elemental_resistance'],
    description: 'Sylnfolk are born of the union between an ephemeral, fleeting spirit of nature and a human.</p><p><strong>Sylnfolk Heritage:</strong> When you create your character, define the origins of your Sylnid Heritage. It should be a celebration of natural phenomena (e.g., the sea breeze, the first flower of spring). Choose an associated Element (Fire, Water, Earth, Air, Rot, Salt) and biome (e.g., Grasslands, the Sea, Deserts), then take Elemental Resistance.' },
  { id: 'anc_patlar', name: 'Patlar', heritage: 'fixerfolk', page: 88, size: 'Medium (6–7 feet)', img: 'icons/magic/unholy/hand-claw-glow-orange.webp',
    grants: ['anc_tempered_calm'],
    description: 'The cursed servants of the war goddess Palta, the Patlar appear as normal humans in youth, but whenever the blood of another person is spilled on them, it permanently stains their skin and hair blood red where it sets. As they grow, Patlar become larger and stronger than normal humans. If untempered, they develop a bloodlust for war.' },
  { id: 'anc_fiestal', name: 'Fiestal', heritage: 'fontborne', page: 90, img: 'icons/magic/unholy/orb-smoking-green.webp',
    grants: [['anc_radiation_sickness', 'light'], ['anc_corrosive_glow', 'heavy']],
    description: 'Born of the heart of the dead Roving Titan Sydyk, which is itself a solid font of Uranium, Fiestal are born strong when born of miners, who dive beneath the Bay of Sydyk to mine their God’s heart. Lightly Corrupted Fiestal are born in the nearby great city of Sydykos, of the Elosine. Sydyk is a Fire Element Font. Take the ability that matches the strength of your Corruption (Strength of Warp).' },
  { id: 'anc_pack_form', name: 'Pack Form', heritage: 'hulinari', page: 92, hulinariForm: 'pack', img: 'icons/creatures/mammals/spirit-deer-herd-blue.webp',
    grants: ['anc_graceful_animal', 'anc_with_all_haste'],
    description: 'A social creature, pack animals focus on group dynamics and control in a fight, using herd tactics to drive the course of combat. Your chosen Pack Form should be a medium-sized pack animal that lives in herds such as a zebra, saiga antelope, llama, wolves, or wild boar.</p><p><em>Hulinari are both an Ancestry and a Profession: if you choose to play one, you must take the other. Every Hulinari Ancestry is a unique animal; choose your species. This also sets your Hulinari Warrior form.</em>' },
  { id: 'anc_brute_form', name: 'Brute Form', heritage: 'hulinari', page: 92, hulinariForm: 'brute', img: 'icons/creatures/mammals/beast-horned-scaled-glowing-orange.webp',
    grants: ['anc_beastly_fortitude', 'anc_with_force'],
    description: 'A powerful and singularly willed creature, brutes are enormous in both size and power. Your chosen Brute Form should be a powerful solitary land beast no more than eight feet in length, such as a short-faced bear, a smilodon, a dire boar, a giant sloth, or a tiger.</p><p><em>Hulinari are both an Ancestry and a Profession: if you choose to play one, you must take the other. Every Hulinari Ancestry is a unique animal; choose your species. This also sets your Hulinari Warrior form.</em>' },
  { id: 'anc_swarm_form', name: 'Swarm Form', heritage: 'hulinari', page: 92, hulinariForm: 'swarm', img: 'icons/creatures/birds/corvid-flying-wings-purple.webp',
    grants: ['anc_smart_flock', 'anc_with_cunning', 'anc_fly'],
    description: 'An intelligent and wily creature, swarming birds fly about the battlefield causing chaos, controlling the course of events, and manipulating enemies. Your chosen Swarm Form should be a flocking, flying animal that can coalesce in large clouds, such as cicadas, bees, crows, owls, or vampire bats.</p><p><em>Hulinari are both an Ancestry and a Profession: if you choose to play one, you must take the other. Every Hulinari Ancestry is a unique animal; choose your species. This also sets your Hulinari Warrior form.</em>' },
];

/**
 * Each Heritage's description for its compendium folder and the Character tab: the book's opening, and how to make a new
 * Ancestry of it (Myths of Sacadia's cultures make more).
 */
export const HERITAGE_TEXT = {
  human: 'The most common Heritage on Sacadia, humans are industrious, lawful folk. Capable of great feats of violence and love, they have constructed the world we know today. All humans get Industrial, and one ability for their Ancestry.',
  curiot: 'The descendants of the Hulinari, a wild protectorate Fae Heritage that embodies the very soul of an entire species of animal. All Curiot Ancestries are local: each descends from a single Hulinari.',
  daemonai: 'Humanoids descended from Demons. Almost all Daemonai are highly charismatic. The most common are Courters, highly charismatic shapeshifters.',
  fixerfolk: 'Fae spirits who look mostly human, descended from Nature Spirits (Sylnfolk) or Folk Spirits (local to a culture).',
  fontborne: 'Those descended from the warping of Fonts, Fontborne have a connection to the warped arcane corruption of Fonts. All Fontborne ancestries are local to a Font.',
  hulinari: 'A guardian spirit of animals, able to shapeshift between an animalistic human and a magical beast. Hulinari are both an Ancestry and a Profession, and can only be played in early games of empire.',
};
