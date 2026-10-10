# The Battlefield

The defenders are up against a demon much more powerful than they are. To even the odds, the wall gives them several environmental aids. The numbers match the map pins on {{scene:chunis-wall}}.

## The map: two levels

{{scene:chunis-wall}} uses Foundry's **Scene Levels**. The level list at the top left of the canvas switches between them:

- **Wall Top** (40ft up): the walkway, the ballista tower and the gatehouse. The defenders start here at elevation 40. The parapets stop movement but not sight, so anyone on the wall top sees the whole battlefield. Standing on the walkway or the tower gives a defender **Height**.
- **Ground**: everything else. The wall, the tower and the gatehouse are solid stone here, so nobody on the ground can see or walk through them. Tents block sight and movement; the fences and the palisade stakes block only movement.

Each level sees the other, so the GM's view looks the same on either. What changes is which walls apply and where new tokens go: **drag demons in while viewing the Ground level** (a dropped token lands on the level you're viewing).

**Night.** The fight happens at night (Darkness 0.9). Dim moonlight lets everyone see within line of sight. The Tianqi glyphs glow blue along the wall's north face, torches burn on the wall top, and lanterns hang in the camp. Mist lies over the Upper Heibrim north of the wall; the wall holds it back (a *Suppress Weather* Region over everything south of it). Wanabbul trails a haze of black smoke. The first time he steps forward out of the mist, everyone sees *"A shape looms out of the mist…"*. To brighten the scene, lower the Darkness slider in the scene's lighting settings or from the Lighting controls.

**Line of sight.** Token Vision is on: each player sees what their hero sees, and you see everything. From the wall top, the defenders see down over the wall they stand on and over the tents, though not something tucked right behind a tent. A hero who climbs down loses sight of everything north of the wall, and of the defenders still on top of it. To share the whole map instead, turn off *Token Vision* in the scene's settings.

**Getting down.**

- **The stairs** (east, beside the hay) connect the levels. Walk down them on the Wall Top, and at the foot Foundry asks whether to move down to the Ground. To go up, walk onto the foot of the stairs from the camp. They're a solid block on the Ground, so the foot is the only way on or off.
- **Jumping into the hay or onto the tents:** set the token's movement to **Jump** (token HUD) and move off the wall over the hay or the west tents. Foundry asks whether to drop to the Ground. The jumper lands Prone but unharmed; each pile or tent works once.
- Anyone else stepping off the wall falls 40ft. Move them to the Ground level yourself (token configuration, or drag with the Ground level viewed) and apply the fall.

**The front gate** is the locked door across the passage where the road meets the wall. When the Weaver's Daughter's Weaverspools get it open, right-click its door icon to unlock it, then click to open it.

**The breach.** When the demon tears through the wall, select its token and run the **Breach Chuni's Wall** macro (Macros directory, *The Breach* folder). It opens a hole in the wall as wide as the token: the wall's faces there come out on the Ground level, the gate goes with them if the hole crosses it, and on the Wall Top the walkway is fenced off at both edges of the hole. From then on no one can cross the wall top east to west. The macro can't be undone; re-importing the adventure restores the scene (and everything else in it).

**Crewing a siege engine.** The Wall Ballista, the Fixed Ballista and the Oil Barrels are actors every player owns. Select the engine's token (or open its sheet) and use its ability. The engine itself spends nothing: **the crew member pays** 1 AP and both arms per step, from their own sheet. Like any action, it costs 2 AP if those limbs are already exhausted. The engines' to-hit is their own (1D20+8), not the crew member's.

## 1 · Wall Ballista

The great ballista on the tower.

- **Aim** it: 1 AP. It must be re-aimed every time its target moves, or it automatically misses.
- **Fire** it: 1 AP. 150ft range, to-hit 1D20+8 against PD, 8D10 Piercing on a hit.
- **Reload** it: 1 AP.
- It can only be fired at targets north of the wall; it can't be aimed south of the front gate.
- If a demon deals damage to it, it breaks. It has 1 HP, so any damage applied to its token breaks it.
- It **begins the one-shot loaded**.

## 2 · Oil Barrels

Three tokens: two on the wall walkway and one by the picnic table. Pour a barrel down onto a creature below the wall, or onto the ground (**Pour Oil**). If an oil-soaked creature is then set alight with a torch, it immediately takes **6D10 Fire Damage**: target it and use the barrel's **Ignite**, which hits automatically. Three of the heroes carry three torches each.

Spilled oil that burns follows the rulebook's *Fire in Combat* rules (p.246) if you want the fire to spread.

## 3 · Hay and Tents

Characters can jump from the wall straight into the hay bales (east, beside the stairs) or onto the tents (west) without taking damage, though they land **Prone**. Each item can be used only once, then it's destroyed.

## 4 · Fixed Ballista

The wagon-mounted ballista south of the wall follows the same rules as the Wall Ballista, but:

- it can't be aimed: it only points at the pit trap;
- it can only be fired **once**;
- it deals **12D10 Piercing**, to-hit 1D20+8;
- it breaks if it takes damage from an enemy;
- it begins the one-shot loaded.

## 5 · Pit Trap

A demon that makes it this far falls into the pit on the road (the grate on the map), taking **3D10 damage**. It then makes **Finesse Checks against 5 levels of Pin** (if it can take Pin); Check DC 18 negates.

This one is automated. Two Regions over the grate spring it when a hostile token enters: one deals the 3D10, the other posts the Finesse Check card against the {{actor:pit_trap}}'s Check DC 18. Wanabbul is gigantic, so his checks against Pin get 3X advantage from his size. After the trap springs, open the two *Pit Trap* Regions and disable their behaviors so it doesn't fire again.

## 6 · Demonology

The moment Wanabbul enters the fight, the players learn three facts about him. They're on the **Demonology** handout ({{page:players/demonology}}):

- **PD:** Wanabbul has 19 PD, and 3 of it can be rended.
- **Bite:** he can bite creatures within 5ft, rolling 1D20+12 against their PD, for 2D10+5 damage.
- **Gigantic:** he can be climbed. Climbing him takes a Power Check at 1X disadvantage, following the climb rules.

Every hero has *Heibrim Lore* (Religion: Demon Lore 1). A player who wants more can roll it, and Manchuthara can use **Favored Enemy** (a Wiles Check against his Check DC) to learn his to-hit, his Trait Expertise, or one of his abilities. A player with the Tianqi *Demon Points* ability adds +1 damage against Wanabbul for each fact learned this way.
