# Running the Encounter

## Starting positions and turn order

The heroes start at assigned positions on the map, set by their role. The scene places them there already. You can ignore the assignments, but they streamline the start and make sure everyone has something to do. The default turn order goes from #1 (first) to #4 (last):

1. **{{actor:selthimor}}, Thug** — a melee combatant who helps Chunrudar man the ballista in the opening rounds. He runs faster than Chunrudar, so he starts on the north side of the ballista.
2. **{{actor:chunrudar}}, Fatebound** — a melee combatant working the ballista with Selthimor. He's wise to stay back from the edge of the wall, where the demon can reach him.
3. **{{actor:honnasusara}}, Soldier** — melee plus supporting calls to her allies. She can open by pouring oil, then move east to support Manchuthara or north to support Selthimor and Chunrudar. Either way, she should end up closer to her allies after the barrel.
4. **{{actor:manchuthara}}, Sentinel** — the party's ranged combatant. She can stand at the east end of the wall and fire her crossbow every round, even after the wall is breached.

The Combat Tracker already holds this order: the four heroes at initiative 4, 3, 2 and 1, and Wanabbul at 0. The one-shot doesn't place Wanabbul in the order; putting him after the heroes gives them a full round of siege before he moves.

**Rolling initiative instead.** Foundry only offers an initiative roll to a combatant that has no initiative yet, so with this order in place there's nothing to roll. To roll, open the **⋮** menu at the top of the Combat Tracker, choose **Reset Initiative**, then press **Roll All** (or let each player press **Initiative** on their sheet). Each combatant rolls a Courage or Finesse Check, whichever is better (v1.2 p.233). To reroll one combatant, right-click it and choose **Re-roll Initiative**.

**Height.** Everyone on the wall walkway or the ballista tower is inside the scene's **Wall Top** Region, which gives friendly tokens the Height status. Height grants 1X advantage on attacks, and with 4+ AP it triggers Manchuthara's Crossbow Mastery. The heroes start with it; it comes and goes as tokens step on and off the wall.

## Wanabbul the Vast

![Wanabbul the Vast]({{asset}}wanabbul.webp)

{{actor:wanabbul}} is a gigantic, demonic figure who looms to the height of the wall's top: a shadowy shape trailing whisps of black smoke. Lit by a flash of fire, he looks almost hollow.

**Behavior.**

- Wanabbul moves forward 20ft every round, through any obstacle. He also has 3 AP.
- When he reaches the wall, he destroys it in a single turn, then attempts to **Grab** one nearby character if he can.
- When he's reduced to half health, on his next turn he sprouts more arms and uses **Draining Aura**.
- *Optional speed-up:* below half health, let him move 25ft or 30ft. The fight ends faster and gets slightly easier.

**Death.** A humanoid skeleton, the last remnant of his once-human form, falls to the ground while the rest of him dissipates into mist.

### Act one: the Siege

Wanabbul starts at the top of the map, about 50ft north of the wall: two or three rounds of approach. Meanwhile:

- Read the **Demonology** handout to the players the moment Wanabbul enters the fight.
- The **Wall Ballista** begins loaded. Aim, fire, reload: each step costs the crew member 1 AP and both arms. Everything about the siege engines is on {{page:gm/battlefield}}.
- **Oil** poured on Wanabbul and lit with a torch deals 6D10 Fire.
- Manchuthara shoots every round. Honnasusara's *Standard Bearer* (a Boost to her first action of the combat) can Taunt him.

### Act two: the Breach

Wanabbul tears through the wall in a single turn, leaving a wide hole that stops anyone crossing east or west along the wall top. Select his token and run the **Breach Chuni's Wall** macro to open the hole on the map. Point this out to your players as soon as it happens:

- Two characters on the western wall can jump down onto the tents below without taking damage (they land Prone). A third would be stuck on the wall, or would have to jump onto Wanabbul.
- The hay bales on the east side work the same way. Each tent and hay pile breaks after one use.
- Characters can **climb Wanabbul**: he is gigantic and counts as a slow-moving creature (Power Check at 1X disadvantage, following the climb rules). Movement on him is difficult terrain.
- Once he's through, his path south runs past the **Fixed Ballista** and into the **Pit Trap** on the road.

**Grabbed!** A character in Wanabbul's hand who loses all their Pin can cling to him (DC 15 Finesse Check) or drop to the ground (6D6 damage). His **Drop** Boost lets him let go of them as part of another action; they can react with the same DC 15 Finesse Check to cling on.

*Fall damage.* The one-shot's 6D6 for a fall from Wanabbul's grip is gentler than the rulebook's general rule (v1.2 p.245: a 40ft fall is 16D6 for a Medium creature). It's deliberate, so keep it. Full falls from the wall top use the book rule unless the faller lands in hay or a tent.

## Pacing notes

- Spread Wanabbul's attacks around. Bite plus Punch against a single character can take down Chunrudar or Selthimor in two rounds.
- The heroes deal roughly 80–100 damage a round once everyone is in reach. With the ballistas and oil, Wanabbul's 600 HP usually lasts six to eight rounds.
- Healing is scarce. Honnasusara's *Call of Healing* and the heroes' Healing Dates (each removes one Battle Fatigue) are what they have. A character below 0 HP is **Wounded** and gains Battle Fatigue each turn. They die at negative half their maximum HP. (These v1.2 rules replace the one-shot's dying counters.)
