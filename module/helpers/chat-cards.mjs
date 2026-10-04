/**
 * Chat cards besides the ability card: a check from the sheet (or a rolled effect), the head and dice rows of a
 * check-pool card (saves and condition checks), and an item. Every card the system posts — notes too
 * (`sacadia chat-card note-card`) — shares the ability card's dark panel, so it reads as part of the sheet rather than as
 * Foundry's plain roll.
 */

const CHECK_TEMPLATE = 'systems/sacadia/templates/chat/check-card.hbs';
const ITEM_TEMPLATE = 'systems/sacadia/templates/chat/ability-card.hbs';
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

/** The glyph for a Trait (CONFIG.SACADIA.statIcons), or a fallback. */
export function traitIcon(stat, fallback = 'fa-solid fa-dice-d20') {
  return CONFIG.SACADIA.statIcons?.[stat] ?? fallback;
}

/** A card's emblem for a check made with a Trait: its art (`{ img }`), or a glyph (`{ icon }`) when it has none. */
export function traitEmblem(stat, fallback = 'fa-solid fa-dice-d20') {
  const img = CONFIG.SACADIA.statArt?.[stat];
  return img ? { img } : { icon: traitIcon(stat, fallback) };
}

/** "1× Advantage" / "2× Disadvantage" for a net advantage level, or '' at 0. */
export function advantageText(net) {
  if (!net) return '';
  return game.i18n.format(net > 0 ? 'SACADIA.Check.AdvN' : 'SACADIA.Check.DisN', { n: Math.abs(net) });
}

/** A signed number for display: "+2", "−1" (a real minus), "+0". */
export function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

/**
 * A card's head: its art (`img`) or a glyph emblem (`icon`), the title, and a meta line (a tag, then plain facts).
 * Strings are escaped; `title` may carry trusted HTML when `titleHtml` is set.
 */
export function cardHead({ icon, img, title, tag = '', meta = [], titleHtml = false }) {
  const facts = meta.filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
  const emblem = img ? `<img class="card-art" src="${esc(img)}" alt=""/>` : `<span class="card-emblem"><i class="${icon}"></i></span>`;
  return `<header class="card-header">${emblem}`
    + `<div class="card-title"><h3>${titleHtml ? title : esc(title)}</h3>`
    + `${tag || facts ? `<div class="card-meta">${tag ? `<span class="tag">${esc(tag)}</span>` : ''}${facts}</div>` : ''}</div></header>`;
}

/**
 * Post a roll as a titled card: the dice in Foundry's wells (expandable, as on the ability card), then labeled chips
 * for the parts of the total. `parts`: [{ label, value?, warn? }]. Honors the chat's visibility mode; a blind roll
 * shows only "rolled privately" to the roller, as Foundry's own roll would.
 */
export async function postRollCard({ actor, roll, icon, img, title, tag = '', meta = [], parts = [], flags }) {
  if (!roll._evaluated) await roll.evaluate();
  const content = await foundry.applications.handlebars.renderTemplate(CHECK_TEMPLATE, {
    icon, img, title, tag, meta: meta.filter(Boolean), parts, rollHtml: await roll.render(),
  });
  return ChatMessage.create(ChatMessage.applyMode({
    speaker: ChatMessage.getSpeaker({ actor }), content, rolls: [roll], sound: CONFIG.sounds.dice, ...(flags ? { flags } : {}),
  }));
}

/**
 * An item shown in chat (a gear or armor macro): the ability card's head and description, with its kind as the tag.
 */
export async function itemCardHtml(item) {
  const sys = item.system ?? {};
  const tagLabel = game.i18n.localize(CONFIG.SACADIA.weaponTypes?.[sys.weaponType] ?? `TYPES.Item.${item.type}`);
  return foundry.applications.handlebars.renderTemplate(ITEM_TEMPLATE, {
    item, tagLabel, activities: [], limbs: [],
    description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? '', { relativeTo: item }),
  });
}

/**
 * The dice rows of a check pool (saves and condition checks): the auto-failures first, then each die as its natural
 * roll, what was added, and the total, marked passed or failed once a DC is known (else left for the GM), and struck
 * through when dropped (advantage keeps the best).
 */
export function poolRows(entries, { autoFail = 0 } = {}) {
  const loc = (k) => game.i18n.localize(k);
  const rows = [];
  for (let i = 0; i < autoFail; i++) {
    rows.push(`<li class="rc-die fail auto"><span class="rc-d20">–</span><span class="rc-total">${loc('SACADIA.Resist.Auto')}</span><b class="rc-mark">✗</b></li>`);
  }
  for (const e of entries) {
    const state = e.dropped ? 'dropped' : (e.pass === true ? 'pass' : (e.pass === false ? 'fail' : 'pending'));
    const mark = e.dropped ? `<small class="rc-mark">${loc('SACADIA.Resist.Dropped')}</small>`
      : (e.pass === true ? '<b class="rc-mark">✓</b>' : (e.pass === false ? '<b class="rc-mark">✗</b>' : ''));
    rows.push(`<li class="rc-die ${state}"><span class="rc-d20">${e.raw}</span><span class="rc-plus">${signed(e.total - e.raw)}</span>`
      + `<span class="rc-total">${e.total}</span>${mark}</li>`);
  }
  return `<ul class="rc-dice">${rows.join('')}</ul>`;
}

/**
 * Foundry's initiative message (`flags.core.initiativeRoll`), drawn as a check card: the Trait it used (the better of
 * Courage and Finesse, book p.233), any advantage (Woad Facepaint), the dice, and the parts of the total. Only the drawn
 * HTML changes; the message stays as Foundry made it (its flags, roll, speaker, and GM-only routing for a hidden
 * combatant), whether it came from the sheet's button or the Combat Tracker. A viewer who can't see its content (a hidden
 * combatant's roll) keeps Foundry's "rolled privately".
 * @param {ChatMessage} message
 * @param {HTMLElement} html  the rendered message (renderChatMessageHTML)
 */
export function styleInitiativeMessage(message, html) {
  if (!message.flags?.core?.initiativeRoll || !message.isContentVisible || !message.rolls?.length) return;
  const content = html.querySelector('.message-content');
  if (!content || content.querySelector('.check-card')) return;
  const loc = (k) => game.i18n.localize(k);
  const roll = message.rolls[0];
  const die = roll.dice[0];
  const rd = message.speakerActor?.getRollData?.() ?? {};
  const courage = Number(rd.courage) || 0;
  const finesse = Number(rd.finesse) || 0;
  const trait = finesse > courage ? 'finesse' : 'courage';
  const prof = Number(rd.proficiency) || 0;
  // The parts as the actor stands now, shown only while they still add up to this roll.
  const parts = die && roll.total - die.total === Math.max(courage, finesse) + prof
    ? [{ label: loc(CONFIG.SACADIA.stats[trait]), value: signed(Math.max(courage, finesse)) },
      ...(prof ? [{ label: loc('SACADIA.Progression.Proficiency'), value: signed(prof) }] : [])]
    : [];
  const kept = die?.modifiers?.find((m) => /^k[hl]/.test(m)) ?? '';
  const net = die && die.number > 1 && kept ? (kept.startsWith('kh') ? 1 : -1) * (die.number - 1) : 0;
  const card = document.createElement('div');
  card.className = 'sacadia chat-card check-card initiative-card';
  card.innerHTML = cardHead({ ...traitEmblem(trait), title: loc('SACADIA.Initiative.Roll'), tag: loc('SACADIA.Check.Trait'),
    meta: [loc(CONFIG.SACADIA.stats[trait]), advantageText(net)] })
    + '<div class="card-roll"></div>'
    + (parts.length ? `<div class="card-parts">${parts.map((p) => `<span class="part">${esc(p.label)} <b>${p.value}</b></span>`).join('')}</div>` : '');
  card.querySelector('.card-roll').append(...content.childNodes);
  content.append(card);
  html.querySelector('.message-header .flavor-text')?.remove(); // "… rolls for Initiative!" — the card says it
}
