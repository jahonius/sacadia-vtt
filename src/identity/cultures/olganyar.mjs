/** The Olganyar (rulebook v1.2 printed pp.49–58). The shape is described in src/identity/cultures.mjs. */
export default {
  key: 'olganyar', name: 'Olganyar', aliases: 'Olgani', page: 49, img: 'icons/environment/settlement/watchtower-cliff.webp',
  summary: 'A bitter rival of the Myrgha, the Olganyar are a close confederation of guild cities on the northern coast of the Ardus Yauga sea. Pirates by nature, the Olganyar are at once conniving and crafty. Their government rules through a group of Guilds, and the civilization inhabits the ruins of an ancient, long-dead civilization. The Olganyar are a Guild-based naval culture at the beginning of their rise to empire.',
  laws: [
    ['Digging', 'You cannot, for any reason, dig.'],
    ['The Dead', 'When an Olganyar dies, they must be cremated within 24 hours, and interred overlooking a saltwater body of water within 3 days.'],
    ['Exchanges', 'You are forbidden for partaking in any exchange, deal, or sale within the limits of any Olganyar City. It is considered bad luck to do so in the city of any other culture as well (though not forbidden).'],
    ['Vengeance', 'You are forbidden for acting out of vengeance, unless that vengeance is directed at Myrgha.'],
    ['Myrgha', 'You must hate the Myrgha. You are not required to hate or dislike the Cunei Myrgha.'],
  ],
  talents: [
    { id: 'olganyar_naval_from_birth', name: 'Naval from Birth', tag: 'passive', page: 49, prerequisite: 'Olganyar Cultural Heritage', img: 'icons/skills/trades/profession-sailing-ship.webp',
      grantsSpecialty: { talent: 'survival', name: 'Swimmer' },
      description: 'Gain 1 level in Survival: Swimmer, even if you do not have Survival. Additionally, you can navigate without wind better than most. Increase the speed of any boat you travel with by 1 tile if you travel against the wind.' },
  ],
  language: { id: 'olganyar_bushiu', name: 'Bushiu', page: 49, description: 'You speak the Bushiu language.' },
  ancestries: [
    { id: 'olganyar_toadclan', name: 'Toadclan', heritage: 'curiot', page: 53, size: 'Medium (3.5–5 feet)', lifespan: 'Typically 30–50 years',
      img: 'icons/creatures/amphibians/bullfrog-glowing-green.webp', lore: ['lore_toxic_touch'],
      description: 'Toadclan are small, squat Curiot folk, who typically resemble humanoid toads or frogs. They are frequent fermenters and cheesemongers, and are known for their sense of taste.',
      abilities: [
        { id: 'olganyar_toxic_skin', name: 'Toxic Skin', tag: 'focus', page: 53, prerequisite: 'Toadclan Curiot Ancestry', img: 'icons/creatures/amphibians/treefrog-leaf-green.webp',
          description: 'As a Focus action when you have levels of Wrestle Pin, you coat your skin in a toxic venom. For as long as the target continues to give you Wrestle Pin, they take 1 additional level of Enduring Hemorrhage at the start of each Pin (levels given this way stack). The Hemorrhage given this way stops being enduring when you lose all levels of Pin.' },
      ] },
    { id: 'olganyar_auanari', name: 'Auanari', heritage: 'fixerfolk', page: 53, size: 'Medium (4–5 feet)',
      img: 'icons/magic/water/orb-water-transparent.webp', lore: ['lore_foment'],
      description: 'Mercurial Fixerfolk who are dropped on the door of the Spire Gates, Auanari are said to be left by ephemeral ghosts that haunt the Spire, the ruins of an ancient city. Or, they could be the children of the Mercurial - diseased citizens of the Spire Gates who have been exposed to too much mercury. This would explain their eyes, which have the appearance of liquid mercury, and the fact that a few Auanari have been born with shimmering metal horns, or patches of skin colored like liquid mercury.',
      abilities: [
        { id: 'olganyar_emotive_touch', name: 'Emotive Touch', tag: 'action', page: 53, prerequisite: 'Auanari Fixerfolk Ancestry', img: 'icons/magic/unholy/hand-light-pink.webp',
          description: 'When you have levels of Taunt or Panic, you can touch an enemy and force them to roll against X levels of the same condition, where X is the same number of levels as you have (you are the target of this effect).' },
      ] },
    { id: 'olganyar_sapline', name: 'Sapline', heritage: 'fontborne', page: 53, img: 'icons/commodities/gems/gem-amber-insect-orange.webp',
      grants: [['lore_saptouched', 'light'], ['lore_oozing_flow', 'heavy']],
      description: 'The Sapline are birthed from the Amber Font, which fell into a small piece of sap in a tree. The warped realm around it crystalized into amber, its rivers flowing of golden sap. Sapline drip with this ooze. Lightly Corrupted Sapline have golden eyes or sticky skin. Heavily Corrupted Sapline have hair that constantly drips, or see-through skin. The Amber Font is an Earth Element Font. The Amber Fontborne are cursed, and can only be played when accompanied with one half of the Inherited Item Coin of a Mother’s Blessing. Take the ability that matches the strength of your Corruption (Strength of Warp): Saptouched or Oozing Flow.' },
  ],
  groups: [],
};
