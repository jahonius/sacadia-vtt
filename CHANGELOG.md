# Changelog

## 0.2.2

- **Initiative button:** character and NPC sheets have an **Initiative** button in the header. It rolls a Courage or
  Finesse Check, whichever is better (p.233), and adds the creature's token to the combat first if it isn't in it yet.
  With no combat running, a GM's button starts one on the viewed scene, and a player is told there's no combat. A
  creature that has already rolled keeps its number; the GM rerolls from the Combat Tracker. The manual's *Taking
  Your Turn* and GM pages explain it.
- **The Breach fixes.** Re-import The Breach from its compendium to get them. Importing again overwrites your imported
  copy.
  - **Stairs:** they work in both directions. The level change now happens at the foot of the stairs, so a hero walking
    down lands on the ground there instead of inside the wall. The stairs are railed on the Wall Top and solid on the
    Ground.
  - **Gate:** the wall top over the front gate no longer glows blue. The glyphs' light can't reach into the gate
    passage under the walkway anymore.
  - **"A shape looms out of the mist…"** now shows the first time the demon walks out of the fog. A bug in Foundry
    14.364's Display Scrolling Text "once" option stopped it, so a Toggle Behavior switches the text off instead.
  - **Initiative:** the GM pages explain how to roll initiative instead of using the preset turn order: Reset
    Initiative (the ⋮ menu at the top of the Combat Tracker), then Roll All, or each player's Initiative button.

## 0.2.1

- **Ability icons:** every ability, profession feature and basic action in the compendiums has its own icon (978 in
  all), in one pixel-art style with an identical gold frame, set in Sacadia's Bronze Age. They're 256 px WebP, so the
  whole set is about 28 MB. Items characters already own get their new icon through the compendium refresh the system
  offers after an update. `npm run icons`
  generates icons (src/generate-icons.mjs; needs a Gemini API key).
- **Adventure: The Breach.** Connor Brashar's level-5 one-shot on Chuni's Wall, converted to v1.2, in a new
  **Adventures** compendium (import it from the compendium). It includes:
  - the battle map as a two-level scene built on Foundry v14's Scene Levels: the Ground and the Wall Top, 40ft up. It has
    walls and line of sight (the wall blocks the view from the ground, while the wall top sees everything), stairs and
    jump-down spots that move tokens between the levels, a locked front gate, tokens and map pins;
  - a night setting: blue Tianqi glyph lights along the wall, torches and lanterns, fog over the Upper Heibrim that the
    wall holds back, a smoky haze around Wanabbul, and scrolling text when he looms out of the mist or the pit gives way;
  - the fight staged in the Combat Tracker in the one-shot's turn order;
  - a **Breach Chuni's Wall** macro that opens a hole as wide as the demon and cuts the wall top in two;
  - four pregenerated Tianqi wall guards built as rules-legal level-5 characters;
  - Wanabbul the Vast and three optional demons (with Csenorras's split swarms and the Weaverspools);
  - player-owned ballistas and oil barrels to crew;
  - a pit trap that springs on its own, and a wall walkway that gives defenders Height;
  - a GM guide (with conversion notes), player handouts, and the Tianqi cultural abilities and inheritance.
- **NPC Move Speed:** NPCs have a Speed field, and Paste Stat Block reads `Speed` / `Move`.
- **Tests:** `QUENCH_SCREENSHOTS=<dir>` lets the in-Foundry tests save screenshots.
- **Fixes:**
  - The second pick of Bigger Stones now counts toward Combat Skill Points spent.
  - Heavy weapons carry the `heavy` trait, so Heavy Weapons Mastery applies to them.

## 0.2.0

The first full release, for Foundry VTT v14.

- **Rules:** Sacadia's Art of War v1.2, with the Prestige Professions addendum (Magus and Witch) and the Lore
  abilities.
- **Rulings:** the designer's rulings of 2026-10-03 are built in:
  - Rend never reduces DR, can rend shields, and can't rend a creature wearing no armor.
  - Conditions you give yourself stack onto the levels you already have.
  - Surrounded Brute ignores Surrounded, and Tripped Up is a Finesse Check.
  - Coordinated Flock doubles your Clouded Foe cloud, and Greater Glaring grows faster while you stay still.
- **Combat automation:** attacks, Trait Checks, conditions, Focus, zones, Swarm clouds and turn upkeep. The GM's
  client applies them.
- **Compendium refresh:** owned items update from the compendiums when the system updates.
- **Tests:** unit tests, plus in-Foundry tests that use every ability and render every sheet.
