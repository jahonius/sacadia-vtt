# Taking Your Turn

## Rolling initiative

Initiative is a Courage or Finesse Check, whichever is better (book p.233). Once the GM has set up a combat, press
**Initiative** at the top of your sheet. If your token isn't in the Combat Tracker yet, this adds it, then rolls. You
roll once per combat: pressing it again just tells you your number, and the GM rerolls from the Combat Tracker.

## Starting a turn

Turn tracking needs a combat in Foundry's Combat Tracker. When your turn begins, the system:

- refills your **AP** and clears your exhausted limbs;
- **refreshes your reaction** for the round;
- applies start-of-turn effects: Hemorrhage damage, the Insane table if you're Insane, auras you
  started inside, Battle Fatigue if you're Wounded;
- clears Boosts you armed but didn't use;
- ends your Focus abilities that you didn't maintain last turn.

When your turn ends, each of your adversarial conditions drops by one level, except Enduring ones.

## AP and limbs

Every action costs AP and exhausts one or more limbs (arm, legs, body, mind). If an action needs a limb
you've already exhausted, it costs **+1 AP**. The **Abilities** tab shows:

- your **AP** (the ↺ button resets your turn if you need to fix a mistake);
- which limbs are exhausted;
- the **actions you've taken this turn**, each with an **Undo** that refunds its AP and limb.

The **Basic Actions** buttons (Move, 5ft Adjust, Climb, Drop, Hurdle, Disengage, Switch Item, Steady, Hide,
Make Trait Check, and so on) spend AP and limbs for actions that aren't abilities.

## Using an ability

1. **Target** the creature or creatures first (T, or right-click → target).
2. Click the ability's **icon** on your sheet. (Clicking its **name** opens its description.)
3. Answer any prompts:
   - **Advantage:** pick Normal, Advantage, or Disadvantage, or enter a level. Conditions, effects,
     cover, Surrounded, and so on are added on top automatically.
   - **A choice** the ability needs, such as which defense to boost or which condition to remove.
   - **A variable cost**, such as how many pool points to spend.
4. The result posts to chat as a card showing every roll and every modifier that applied.

The sheet warns (and lets you continue) if you're short on AP, the ability is out of its usage limit,
its condition isn't met ("only while raging"), or the target is out of range or Hidden.

## Boosts

A Boost changes your *next* matching action. To use one:

1. Click the Boost's **icon** (it shows a bolt) to **arm** it. Armed Boosts are marked *Armed* and
   listed in the **Armed Boosts** tray; click one there to disarm it.
2. Use the action it applies to. The Boost's effect is included and it's used up.

Only **one Boost per action**, and **none on reactions** (book p.236). Exceptions: Boostbuster and
Close Quarter allow one on certain reactions, and Boosted Attack / Boost Stack allow two or three on a
divine-weapon attack. If more Boosts are armed than the action allows, you choose which to spend. A
Boost whose condition isn't met stays armed.

## Reactions

You have one reaction per round, shown as pips in the header. Some abilities give you more. When a
reaction becomes possible (an ally is hit, an enemy moves next to you, an attack is about to land on
you), the system whispers you a reminder or shows buttons on the GM's resolution card.
Reaction-tagged abilities spend your reaction when you use them.

## Focus

A **Focus** ability lasts as long as you **maintain** it, which means using its Focus action again on
each of your turns. If you don't, it ends at the start of your next turn, along with anything it
created (marks, grants on allies, zones). Going Insane ends all your Focus abilities at once.

## Lore abilities

Your **Lore points** (from level 4, more with Fate 3 and 6) refill on a Long Rest. Every character has
**Rousing Success**; at levels 4, 9, and 13 you add one more from the **Lore Abilities** compendium
(prerequisites such as an ancestry or profession are listed on each).

- A Lore ability marked **L** in the book costs only the Lore point: no AP, Boost, Reaction or Focus.
  Using one spends the point, and warns if you have none left.
- **Lore Boosts** (Blasting Strike, The Hunted, Divine Volley …) arm like any Boost but don't count
  against the one-Boost limit. Their point is spent when they're used.
- A few are actions or Focus too (Kickbuck, Shockflock, Summon Beasts) and cost AP as well.
- **Oozing Flow** shows up as a button on the GM's card when you're hit.
- **Webcraft** targets one enemy per Madness you spend, up to your Proficiency. Target the enemies; it spends one
  Madness each, and its 5M damage uses your Madness from before the spend.
- The book lets you decide when a Lore use triggers. Use it on the sheet at the moment you want, and
  ask the GM to apply anything the card can't (Still Up, for example, is used as you would drop below
  0 HP).

## Usage limits

"Once per turn", "once per quick rest", and "once per combat" are counted for you. Using an ability past
its limit asks for confirmation first. A limit "on a single target" (Beastly Presence) is counted per creature:
using it on someone new is fine.

Abilities that may target only so many creatures warn when more are targeted.

## Resting

Rests are in the header:

- **Short (Quick) Rest:** refills pools, clears most conditions, restores one point of Rend to your armor, and offers
  to spend Health Pools. Oracles with Slightly Cracked roll their saved d3s.
- **Long Rest:** full Health, refills Health Pools and Lore, clears all Rend and repairs broken armor.
