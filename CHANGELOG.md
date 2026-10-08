# Changelog

## 0.3.5

- **"Affecting you now" covers everything on you.** On the Conditions tab, each state on your token (Prone, Height …)
  is its own row saying what it does, and each buff another creature gave you has a row with who gave it and how it
  ends ("From Manchuthara · consumed on attack"). Buffs moved here from the Abilities tab's turn panel, and the tab's
  count includes them. Rows are tinted by kind: debuffs red, buffs green, and the rest parchment. That covers Height,
  whose advantage depends on where your target stands, and Madness.
- **"On your next attack."** The Abilities tab's Armed Boosts tray is renamed. It also shows buffs banked for your next
  attack, such as Critical Strike's advantage, with what each adds.
- **Marks are named by their ability** in the turn panel ("Targeted Foe → Goblin"), not by their internal key.
- **The roll prompt's modifiers read as a ledger:** the value at the left, its source right-aligned, a dotted leader
  between.
- **Fix:** a talent's specializations sit two to a row, so their names have room. They had been squeezed to about one
  character wide.

## 0.3.4

- **The roll prompt shows its modifiers.** Before you roll a Trait, talent or specialty check, or an attack, the prompt
  lists what's already on the roll, each with its source: "+2 · Courage", "+3 · Proficiency", "1× Disadv · Frenzy 1",
  a Trait-check bonus by the effect or ability that gives it, an Informative Scroll, a pending Fumble, Untrained, a
  specialty's rank. Its summary counts them ("Rolls 2d20, keeps the lowest, +5"). For an attack, what depends on the
  target (cover, height, marks) is still added when it rolls, as the prompt says. A check's chat card names the same
  sources.
- **Conditions tab.** The condition tracker moved off the Stats tab onto its own tab, after Abilities. It opens with
  what's affecting the creature now: each held condition with its level and what that level does (click the name to
  roll against it), and the states on its token (Prone, Steadied …). The tab's label counts them, so it shows from any
  tab.
- **Fix:** the section headings on the Stats and Character tabs went back to small capitals. 0.3.3 left them as large
  headlines.

## 0.3.3

- **Consistent Roll** (p.237). When you use an ability that makes an attack roll, the prompt offers extra AP for 1X
  advantage each, up to the AP you have left after its cost. The extra AP is paid with the action and logged with it,
  and the card's to-hit line names it ("2× Adv · Consistent Roll"). That makes the crossbow Sentinel's features work as
  written: Crossbow Mastery's "4 AP or more in a consistent attack", Boltshot's "at least 2 AP" and Bowling Bolt's "6×
  advantage". Before, the advantage prompt gave advantage without charging AP.
- **Abilities tab redesign.**
  - **The turn panel** reads like the header: AP and pools as big numbers (pools edit in place), and Cover without a
    box. The seven limbs are glyph tiles (hands, body, mind, focus, legs, reaction) that turn red when spent.
  - **Basic actions** are grouped into Move, Offense and Utility. Nearly all cost 1 AP, so only the Boosts are marked
    (5-Foot Adjust, Hurdle), and each one's tooltip gives its cost, the limbs it uses and the book's rule.
  - **Ability cards:** the kind of action is a word (Action, Reaction…), the one boxed chip is a cost you spend (1 Call,
    Lore, Madness), and the facts read plainly with small glyphs ("vs TD · 5 ft · Spear", the full defense in the
    tooltip). Passive abilities show the first two lines of what they do. Group headings count their abilities.
  - Foundry's plain white weapon and armor glyphs are tinted gold, on the Abilities and Inventory tabs.
- **Prompts.** Every prompt the system opens is in the sheet's look (umber, a display-face title, the button Enter
  presses in gold), sized to fit.
  - **Attack and check prompt:** a header with what you're rolling, an Advantage stepper ("Normal", "1× Advantage",
    "2× Disadvantage"), the Consistent Roll as AP bolts to click, and a live line of what will be rolled and its cost
    ("Rolls 3d20, keeps the highest · 2 AP"). One Roll button; Enter rolls and the arrow keys step the advantage.
  - The prompts' own styles (the resist form, the research list…) had never applied, since dialogs open outside the
    sheet; they do now.

## 0.3.2

- **A richer sheet header, the same height.** The nine equal tiles are now in tiers:
  - **Defenses:** the five are one framed plate, with larger numbers, since they're what attacks roll against.
  - **Prof, DC and Speed:** an open ledger, with no boxes and smaller numbers.
  - **Health:** the current value is the big number, with the maximum small beside it. Faint ticks on the bar mark
    half and a quarter, where it turns amber and red.
  - **AP, reactions and Lore** sit above the ledger in the same columns. AP pips are bolts (like the AP badge on ability
    icons), reactions are round pips, and Lore moved up from the tiles, since it's a resource you spend.
  - **Madness**, when it's in play, sits at the end of the Health line: a brain glyph and six pips.
  - The build line reads like a book's running head: "Soldier **5** ◆ Level **5** ◆ Medium", in the display face with
    the numbers in gold.
  - **Initiative** is the name row's one outlined button, and the rests are quiet links. The portrait has the icons'
    bronze edge and gold ring.

## 0.3.1

- **Fix:** in The Breach, the defenders on the wall top can now see past the wall to the ground below. Before, the
  wall they stood on hid everything below them, except from right above the gate. Foundry v14 checks a sightline
  between Scene Levels against each level's walls wherever the line passes through that level's heights, and the
  Ground level reached up to 40ft. It now ends at 5ft, so ground walls only count where a sightline from the wall top
  drops below head height. Re-import The Breach from its compendium to get the fix.
- **Docs:** The Breach's player handout points to the laws in the *Story* on the sheet's Character tab (it was the
  Biography tab before 0.3.0).

## 0.3.0

- **Character sheet redesign.**
  - **Header:** it now says who the sheet is for. The portrait fills the header's height, and under the name a single
    line sums up the build (professions, level, size, resistances). Health has a bar that turns amber at half and red at
    a quarter, beside the AP and reaction pips, and the defenses and derived numbers sit in one row of tiles.
  - **Character tab** (was Biography): a character's build lives here now, under **Build** (professions and their
    levels, level, size, Max HP adjustment, resistances), with **Identity** and **Background**.
  - **Look:** one small-caps label style, values in parchment, and gold kept for what matters. Fields have no boxes until
    you hover or type. The system ships the Alegreya typeface, so every player sees the same one.
  - **Abilities:** denser cards. The icon (the Use button) is larger and carries the AP cost; edit and delete show on
    hover.
  - **Inventory:** two-line rows, the name and then what it does. A hand or a box shows whether an item is readied or
    stored, with its slots, and the counters read Readied and Stored.
  - **Fixes:** the Effects tabs showed `EFFECT.TabDuration`; the inventory overflowed the window at its default width;
    talent specializations and the "Roll Save to Negate" row had lost their styling; the Trait roll tooltip read
    "Roll {label}". The narrative size field is now **Stature**, so it isn't confused with Size.
- **Chat cards.** Everything the system posts now matches the ability card.
  - **Checks:** Trait, talent and specialty checks show the Trait's icon, the advantage they rolled at, the dice, and a
    chip for each part of the total (Power +2 · Proficiency +3 · Fumbled −2).
  - **Saves and condition checks:** one row per die (the roll, what was added, the total), marked passed or failed, and
    the result as a banner. A save names the creature that imposed it.
  - **Initiative**, from the sheet or the Combat Tracker, is a check card. A hidden combatant's roll stays GM-only.
  - **Rests** list what they recovered (Health, HP pools spent, conditions cleared, Rend, pools, Lore, Slightly Cracked
    dice). Save prompts and notices are slim dark notes. An item rolled from a hotbar macro shows as a card, and the
    last plain rolls (critical and on-kill temp HP, Death Mastery, Mind Map, Moonstone Earrings, zone damage) are
    titled cards.
  - **GM-only whispers** sit on a darker panel, with the button the system chose in gold.
- **Trait icons:** Power, Finesse, Wiles, Courage and Fate have pixel-art icons in the ability icons' style. They're on
  the Stats tab, where clicking one rolls the check, and on check, save and initiative cards. The icon generator has a
  `traits` group (src/generate-icons.mjs).
- **User manual:** *Building a Character* follows the new layout.

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
