# Tales of Sacadia for Foundry VTT

A Foundry Virtual Tabletop system for **Sacadia's Art of War** (rulebook v1.2, with the Prestige Professions
addendum). It includes:

- Character and NPC sheets.
- Compendiums with every profession, Lore and prestige ability, plus weapons, armor, shields, adornments and trinkets.
- Combat automation: attacks, Trait Checks, conditions, Focus, zones and turn upkeep.

Sacadia's Art of War is by Connor Brashar. The rules are at
[talesofsacadia.com](https://www.talesofsacadia.com/tales-of-sacadia).

## Installing

Requires Foundry VTT v14.

In Foundry's setup screen, go to **Game Systems → Install System** and paste this manifest URL:

```
https://github.com/jahonius/sacadia-vtt/releases/latest/download/system.json
```

Foundry checks the same URL for updates.

## Playing

- Start with the **Sacadia User Manual** compendium. It explains the sheets, what the system automates and what it
  leaves to the GM.
- Keep a GM connected during play. Attacks, saves and conditions are resolved on the GM's client.

## Development

```bash
npm install
npm run build          # compile src/scss into css/sacadia-skin.css
npm run build:packs    # rebuild the compendiums from src/ (close Foundry first)
npm run icons -- --dry-run   # plan ability icons (Gemini; see src/generate-icons.mjs)
npm test               # unit tests
npm run test:quench    # in-Foundry tests, run headless (see tools/quench/run.mjs)
npm run release        # publish a GitHub release (see tools/release.mjs)
```

## Licensing

The code is under the MIT licence in `LICENSE.txt`. The compendium content, meaning the game's rules text, belongs to
its author, Connor Brashar, and isn't covered by that licence.

The ability icons were made for this project. `assets/anvil-impact.png` is by Lorc, from game-icons.net, under
CC BY 3.0.
