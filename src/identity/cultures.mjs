/**
 * The rulebook's five starter cultures (v1.2 Chapter II, printed pp.24–78), built by src/build-packs.mjs into the Cultures
 * compendium (a `culture` item each, and its abilities, ancestries and inheritance) and the Cultures of the Ardus Yauga
 * journal (each culture's tapestry, ways and inheritance).
 *
 * Each culture is three files in src/identity/cultures/:
 * - `<key>.mjs` — the rules: `summary` (the culture item's description), `laws` ([name, text, optional?]), `subcultures`,
 *   `talents` (the cultural talent and anything else every member gains; with `options`, only the chosen one: `{key,
 *   label, grant}`), `language`, `ancestries` (an `ancestry` item each, with its `abilities` and the `lore` uses it unlocks;
 *   `grants` `[id, option]` pairs tie one to the Heritage choice), `groups` (the cultural abilities, by who may take them),
 *   and `inheritanceNotes` (rules for the Inheritance page, as Markdown).
 * - `<key>.md` — the narrative: the culture's own page (`# The Tianqi`), then `# Cultural Tapestry`.
 * - `<key>-inheritance.json` — its inherited businesses, crafts, rituals and ingredients (transcribed from the stat blocks):
 *   `{id, name, section, page, rarity, element, prerequisites, slots, attunement, uses, relic, special, description,
 *   effects: [{name, tags, text}], note?, abilities?}`.
 *
 * Abilities share the heritage abilities' shape (src/identity/heritages.mjs). Ids are prefixed with the culture's key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import myrgha from './cultures/myrgha.mjs';
import cunei from './cultures/cunei.mjs';
import olganyar from './cultures/olganyar.mjs';
import tianqi from './cultures/tianqi.mjs';
import kishai from './cultures/kishai.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cultures');

/** The cultures in the rulebook's order, each with its narrative Markdown and inheritance attached. */
export const CULTURES = [myrgha, cunei, olganyar, tianqi, kishai].map((c) => ({
  ...c,
  aliases: c.aliases ?? '',
  subcultures: c.subcultures ?? [],
  options: c.options ?? [],
  markdown: fs.readFileSync(path.join(DIR, `${c.key}.md`), 'utf8'),
  inheritance: JSON.parse(fs.readFileSync(path.join(DIR, `${c.key}-inheritance.json`), 'utf8')),
}));

/** The chapter's opening (printed pp.24–26), for the journal's first entry. */
export const CULTURES_INTRO = `At the core of every Sacadia game is a culture. A culture trending towards empire, or toward ruin. As players in Sacadia’s Art of War, you will take on the role of people within a set cultural framework, and either aid your culture towards glory or chaos.

## Your Culture

Many table groups will create their own culture through the Cultural Tapestry Rules of the Myths of Sacadia game. Sacadia’s Art of War, however, is focused on Micro Play - that is, it is a game about people who exist within a culture, rather than about the motion of those cultures across generations. If you have your own culture, you may disregard this section. This section provides Cultural Tapestry guidance for a number of cultures you can choose to play within Sacadia - “Starter Cultures” for your games.

## Do I Need a Culture?

Most Sacadia games are games about cultures and their clashes, as they grow and die. If you choose not to play with a defined Culture, you can still use the rules of Sacadia’s Art of War. You will ignore mentions of how cultures influence your playstyles, including the Cultural Tapestry, Binding Laws and Customs, Cultural Ancestries and Heritages, Cultural Talents, Cultural Abilities and Inheritance. You can also pick one of the Starter Cultures, and still pick up any of these elements, without having to create your own unique culture.

## Starter Cultures

The Starter Cultures have already gone through the Cultural Tapestry creation rules in Myths of Sacadia. They are ready to play and use as your own culture, if you would like. Each culture comes with:

1. **A Cultural Tapestry:** the narrative background of your culture, to help you frame your character.
2. **Binding Laws and Customs:** if you choose to play this Culture, the rules you must live by when you play, and the binding events you must follow in game.
3. **Cultural Ancestries and Heritages:** unique Ancestries and Heritages that you unlock by choosing to play this culture.
4. **Cultural Abilities:** each culture unlocks unique abilities for you to take, depending upon the professions you play. Not all cultures unlock unique abilities for all Professions.
5. **Cultural Talents:** each culture automatically gains one unique talent, or creates a unique talent that can be taken by members of that culture.
6. **Inheritance:** within each culture, items, abilities, rituals, and crafts are passed down. If you play one of these cultures, you can take one of the magic items that culture creates to pass down.

## Custom Cultures

You can create a custom culture following the rules of Myths of Sacadia. If you do, you will create all of the same elements captured in this section (or grow them naturally over time).`;
