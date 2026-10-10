# Prologue: The Road to the Wall

![The Ardus Yauga]({{asset}}ardus-yauga-thumb.webp)

An optional five-minute opening before the fight. It takes the table from the wide world down to the wall: the map of the Ardus Yauga, the road north to Chuni's Wall, and then the battle map. It shows off two modules if you have them:

- **Indy Route** draws travel routes across a map, Indiana Jones–style, for everyone at once.
- **Augur: Nexus** links maps into a world you click through: a site on one map opens another.

Without them, the prologue is still a map to talk over: open {{scene:ardus-yauga}}, then {{scene:chunis-wall}}.

## Running it

1. Run the **Prologue: The Road to the Wall** macro (the adventure's Macros folder; drag it to your hotbar). It shows {{scene:ardus-yauga}} to everyone. The first time, it also does two things:
   - With Augur: Nexus, it makes Chuni's Wall a site on the map. Nexus files the Chuni's Wall scene in a folder under the map. If you have no Nexus scene yet, the map becomes it: the top of the Nexus browser's tree.
   - With Indy Route, it offers to add Sacadia's travel speeds to Indy Route's travel modes.
2. Read the opening below while **The Road to the Wall** plays. With Indy Route, the camera finds Tianois, and Selthimor rides the road north past Valli Falls and Low Ballom to the wall's eastern fort.
3. Click the **Chuni's Wall** site on the map: Nexus steps everyone down into the battle map. Without Nexus, activate {{scene:chunis-wall}}.
4. Carry on with **Setting up** on the {{page:gm/overview}} page.

> The Ardus Yauga, three hundred and forty years after the Fontspill. In the east lie the Tianqi lands: hard country, held by a people who are tired, and who know they are on the side of good.
>
> Not long ago, a new guard took the north road from Tianois, past Valli Falls and the town of Low Ballom, to his post on Chuni's Wall. Beyond the wall lies Qianpo, the city the gods cursed two hundred years ago, and its demons.
>
> Tonight, one of them comes for the gate.

**When the alarm goes up.** The one-shot's defenders try to raise the alarm along the wall. When they do, cut to the map: open Indy Route's **Route Manager** (in the Drawing tools) and **Play** **Smoke Along the Wall**. It's a dashed line of smoke signals running from fort to fort, west towards Kjerst. Then step back into the fight: Nexus's **Back** tool (Augur Tools, the ∞ in the scene controls) returns to the map, and the site returns to the fight.

## What the modules can do

**Indy Route** (the Drawing tools: **Route Manager**, **Clear Routes**):

- **Draw a new route:** click points on the map, then press Enter. Style its line, label, dot and camera, then **Play** it for everyone or **Preview** it for yourself.
- **Travel time:** hover a route in the Route Manager. Its tooltip gives the length and, with a travel mode set in its **Style**, the days it takes. The macro's Sacadia travel modes use the rulebook's hexes a day (p.286) and a 4 km hex.
- **Riders:** a route can carry an actor's image (as the road carries Selthimor) or move a real token along it, fog of war and all.
- **Keep it:** a route can be baked into the map as a tile (**Persist to Tile**), or exported and imported between scenes.

**Augur: Nexus** (the **Nexus** tab in the sidebar, and **Augur Tools** in the scene controls):

- **The world browser:** the Nexus sidebar tab shows the maps as a tree, here the Ardus Yauga with Chuni's Wall under it. Players can browse what you share.
- **Sites:** with the **Nexus Placer**, click the map to add a site. Link an existing scene, start an empty one, or make one from an image. Try Qianpo, Kjerst or Low Ballom.
- **Dossiers:** a site, settlement, NPC or faction has a dossier, and the Nexus tracks how they connect (opinions, trade, quests).
- **Back:** from a site, the Back tool climbs to the map above it.
- **Deleting:** Nexus treats a map and its sites as a branch. Delete The Ardus Yauga while Nexus is active and Nexus offers to delete Chuni's Wall with it. It lists what it would delete first, so you can cancel.

## The map

The map is the rulebook's *Civilizations of the Ardus Yauga* (v1.2 p.25). The rulebook gives it no scale. This scene assumes about 1 km for each pixel of the rulebook's copy. At that scale Chuni's Wall is about 100 km long, and the road from Tianois to the wall about 140 km, or 35 travel hexes: nine days on foot by dirt road, or six by mount. To change the scale, change the grid distance in the scene's settings.
