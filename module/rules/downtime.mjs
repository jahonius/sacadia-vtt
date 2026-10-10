/**
 * A Long Rest (rulebook v1.2 printed pp.235, 263–266): a week or more of downtime, one Long Rest Action a week, and then a
 * Fitful Rest. The plan comes from the Long Rest window (apps/long-rest.mjs); `takeLongRest` resolves it in order, updates
 * the purse, Influence, Lore and items, and posts one card with every week and what the rest recovered.
 *
 * What's the GM's (a lead's findings, a harvested ingredient, a craft, a prayer's answer) is posted for them to narrate.
 */
import { oddJobPay, weekLimits, offeringAdvantage, offeringSucceeds, PRAYER_DC, BARGAIN_TYPES, bargainValue, businessEarns,
  receive, pay, formatCoins, LONG_REST_ACTIONS } from '../helpers/downtime.mjs';
import { fitfulRest } from './rest.mjs';
import { bargainTables } from './goods.mjs';
import { priceGc, bargainPrices } from '../helpers/goods.mjs';
import { findGear, gearId } from '../helpers/actor-utils.mjs';

const loc = (k) => game.i18n.localize(k);
const fmt = (k, d) => game.i18n.format(k, d);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

/** Silver coins to a gold (world setting). */
export const silverRate = () => Math.max(1, Number(game.settings.get('sacadia', 'silverPerGold')) || 100);

/** A d20 at a net advantage: `(1+|n|)d20kh1` / `kl1`. */
const d20 = (net) => (net === 0 ? '1d20' : `${1 + Math.abs(net)}d20${net > 0 ? 'kh1' : 'kl1'}`);
/** The kept d20 of a roll. */
const natural = (roll) => roll.dice[0]?.total ?? 0;

/** Abilities the character chose (not the basics, nor what a profession, Heritage, ancestry or culture grants). */
const bought = (actor) => actor.items.filter((i) => i.type === 'ability' && !i.flags?.sacadia?.basicGrant && !i.flags?.sacadia?.professionGrant
  && !i.flags?.sacadia?.identityGrant && !i.flags?.sacadia?.weaponAttack && !i.flags?.sacadia?.basic);

/**
 * What the window offers for a character: the Earn Money sources (an odd job and the businesses they own), their Religion
 * specializations, offerings, what Train can remove, and the Influence groups they know.
 * @param {Actor} actor
 */
export function downtimeOptions(actor) {
  const sys = actor.system;
  const prof = sys.proficiency ?? 0;
  const rate = silverRate();
  const suan = actor.items.find((i) => i.flags?.sacadia?.business?.oddJobs);
  const odd = oddJobPay(prof) * (suan?.flags.sacadia.business.oddJobs ?? 1);
  const earn = [{ value: 'odd', label: fmt('SACADIA.Downtime.OddJob', { pay: formatCoins(odd, rate), prof }), amount: odd }];
  for (const i of actor.items.filter((x) => x.flags?.sacadia?.business && !x.flags.sacadia.business.oddJobs)) {
    const amount = businessEarns(i.flags.sacadia.business, { proficiency: prof, rarity: i.flags.sacadia.inheritance?.rarity });
    earn.push({ value: i.id, label: amount == null ? i.name : `${i.name} (${formatCoins(amount, rate)})`, amount });
  }
  earn.push({ value: 'manual', label: loc('SACADIA.Downtime.OtherWork'), amount: null });
  const religion = (sys.specialties ?? []).map((s, idx) => ({ s, idx })).filter(({ s }) => s.talent === 'religion' && s.rank > 0)
    .map(({ s, idx }) => ({ value: String(idx), label: `${loc('SACADIA.Talent.Religion')}: ${s.name || '—'} [${s.rank}]` }));
  // Offerings first (the Holy Tools' Offering and token, or one the player made: "Offering (Incense)"), then anything else
  // they might give; each with its price, which counts toward the offering's Advantage.
  const isOffering = (i) => gearId(i).startsWith('offering');
  const offerings = actor.items.filter((i) => i.type === 'gear')
    .sort((a, b) => Number(isOffering(b)) - Number(isOffering(a)))
    .map((i) => ({ value: i.id, label: priceGc(i.system, rate) ? `${i.name} (${formatCoins(priceGc(i.system, rate), rate)})` : i.name }));
  const train = [
    ...bought(actor).map((i) => ({ value: `item:${i.id}`, label: `${i.name}${i.system.costs?.csp ? ` (${i.system.costs.csp} CSP)` : ''}` })),
    ...Object.entries(CONFIG.SACADIA.talents).filter(([k]) => sys.talents?.[k]?.proficient)
      .map(([k, t]) => ({ value: `talent:${k}`, label: fmt('SACADIA.Downtime.TrainTalent', { name: loc(t.label) }) })),
    ...(sys.specialties ?? []).map((s, idx) => ({ s, idx })).filter(({ s }) => s.rank > (s.source ? 1 : 0))
      .map(({ s, idx }) => ({ value: `specialty:${idx}`, label: fmt('SACADIA.Downtime.TrainSpecialty', { name: s.name || '—', rank: s.rank }) })),
  ];
  return { earn, religion, offerings, train, groups: (sys.influence ?? []).map((g) => g.group).filter(Boolean) };
}

/**
 * Take the Long Rest: resolve each week's action in order, then a Fitful Rest, on one card.
 * @param {Actor} actor
 * @param {{weeks: object[]}} plan  each week: {kind, earn, amount, group, offeringItem, gold, religion, question, text, train}
 * @returns {Promise<object>}  what changed: {money, influence, loreBonus}
 */
export async function takeLongRest(actor, plan) {
  const weeks = (plan.weeks ?? []).filter((w) => w?.kind);
  if (!weeks.length) return null;
  const sys = actor.system;
  const rate = silverRate();
  const prof = sys.proficiency ?? 0;
  const options = downtimeOptions(actor);
  const limits = weekLimits(weeks, { proficiency: prof });
  const rows = [];
  const rolls = [];
  const row = (n, kind, value) => rows.push(`<li><span class="rest-label">${fmt('SACADIA.Downtime.WeekN', { n })} · ${loc(LONG_REST_ACTIONS[kind]?.label ?? '')}</span>`
    + `<span class="rest-value">${value}</span></li>`);
  let purse = { gc: sys.money?.gc ?? 0, sc: sys.money?.sc ?? 0 };
  const startPurse = { ...purse };
  const influence = (sys.influence ?? []).map((g) => ({ group: g.group, value: g.value }));
  let loreBonus = 0;
  let answered = false;
  const spent = new Map(); // item id → quantity used
  const removals = [];
  const offeringWeeks = weeks.filter((w) => w.kind === 'offering').length;

  for (const [i, w] of weeks.entries()) {
    const n = i + 1;
    const lim = limits[i];
    if (!lim.counts) {
      const max = LONG_REST_ACTIONS[w.kind].max === 'proficiency' ? prof : LONG_REST_ACTIONS[w.kind].max;
      row(n, w.kind, `<em>${fmt('SACADIA.Downtime.OverLimit', { max })}</em>`);
      continue;
    }
    if (lim.reason === 'pooled') { row(n, w.kind, `<em>${loc('SACADIA.Downtime.Pooled')}</em>`); continue; }
    switch (w.kind) {
      case 'earn': {
        const source = options.earn.find((e) => e.value === (w.earn || 'odd')) ?? options.earn[0];
        const amount = source.amount ?? Math.max(0, Number(w.amount) || 0);
        purse = receive(purse, amount, rate);
        const item = actor.items.get(source.value);
        row(n, w.kind, `<b>+${formatCoins(amount, rate)}</b> ${esc(source.value === 'odd' ? loc('SACADIA.Downtime.FromOddJob') : source.value === 'manual' ? (w.text || '') : item?.name ?? '')}`
          + (item?.flags?.sacadia?.business?.note ? ` <small>${esc(item.flags.sacadia.business.note)}</small>` : ''));
        break;
      }
      case 'influence': {
        const group = String(w.group ?? '').trim() || loc('SACADIA.Downtime.AGroup');
        const held = influence.find((g) => g.group.toLowerCase() === group.toLowerCase());
        if (held) held.value += 1; else influence.push({ group, value: 1 });
        row(n, w.kind, fmt('SACADIA.Downtime.InfluenceGained', { group: esc(group), n: held?.value ?? 1 }));
        break;
      }
      case 'offering': {
        const rank = (sys.specialties ?? [])[Number(w.religion)]?.rank ?? 0;
        const gold = Math.max(0, Math.floor(Number(w.gold) || 0));
        const paid = gold ? pay(purse, gold, rate) : purse;
        if (paid) purse = paid;
        // The item given counts at its price (an Offering is 100gc: 1X Advantage), with the gold spent.
        const item = actor.items.get(w.offeringItem);
        if (item) spent.set(item.id, (spent.get(item.id) ?? 0) + 1);
        const offered = (paid ? gold : 0) + (item ? priceGc(item.system, rate) : 0);
        const adv = offeringAdvantage({ religionRank: w.religion !== '' && w.religion != null ? rank : 0, gold: offered, weeks: offeringWeeks });
        const roll = await new Roll(d20(adv)).evaluate();
        rolls.push(roll);
        // A Lore point, once a Long Rest (on top of the refill the Long Rest ends with).
        const won = offeringSucceeds(natural(roll), roll.total);
        if (won) loreBonus = 1;
        // "You must make at least a token offering (1gc)."
        row(n, w.kind, `${fmt('SACADIA.Downtime.OfferingRoll', { total: roll.total, adv })}`
          + `${offered ? ` · ${fmt('SACADIA.Downtime.Offered', { gold: formatCoins(offered, rate) })}` : ''}${gold && !paid ? ` · <em>${loc('SACADIA.Downtime.CantAfford')}</em>` : ''}`
          + `${item ? ` · ${esc(item.name)}` : ''}${offered < 1 ? ` · <em>${loc('SACADIA.Downtime.NoOffering')}</em>` : ''}`
          + ` · <b>${loc(won ? 'SACADIA.Downtime.OfferingWon' : 'SACADIA.Downtime.OfferingLost')}</b>`);
        break;
      }
      case 'pray': {
        if (answered) { row(n, w.kind, `<em>${loc('SACADIA.Downtime.AlreadyAnswered')}</em>`); break; }
        const proficient = !!sys.talents?.religion?.proficient;
        const rank = w.religion !== '' && w.religion != null ? ((sys.specialties ?? [])[Number(w.religion)]?.rank ?? 0) : 0;
        const roll = await new Roll(`${d20(rank + (proficient ? 0 : -1))} + @wiles${proficient ? ' + @proficiency' : ''}`, actor.getRollData()).evaluate();
        rolls.push(roll);
        answered = roll.total >= PRAYER_DC;
        const symbol = !!findGear(actor, 'holy_symbol', { prefix: true, where: 'hand' });
        row(n, w.kind, `${fmt('SACADIA.Downtime.PrayRoll', { total: roll.total, dc: PRAYER_DC })} · <b>${loc(answered ? 'SACADIA.Downtime.PrayAnswered' : 'SACADIA.Downtime.PrayUnanswered')}</b>`
          + `${w.text ? `<br/><small>“${esc(w.text)}”</small>` : ''}${symbol ? '' : ` <small>${loc('SACADIA.Downtime.NoHolySymbol')}</small>`}`);
        break;
      }
      case 'lead': row(n, w.kind, `${esc(w.text || loc('SACADIA.Downtime.ALead'))} <small>${loc('SACADIA.Downtime.ForTheGm')}</small>`); break;
      case 'harvest': row(n, w.kind, `${loc('SACADIA.Downtime.HarvestNote')}`); break;
      case 'craft': row(n, w.kind, `${esc(w.text || '')} <small>${loc('SACADIA.Downtime.CraftNote')}</small>`); break;
      case 'shop': {
        const out = await shopForBargains(actor, rolls);
        row(n, w.kind, out);
        break;
      }
      case 'train': {
        const out = trainOut(actor, w.train, removals);
        row(n, w.kind, out);
        break;
      }
      default: row(n, w.kind, esc(w.text || '—'));
    }
  }

  // Money and what it came to.
  if (purse.gc !== startPurse.gc || purse.sc !== startPurse.sc) {
    rows.push(`<li><span class="rest-label">${loc('SACADIA.Downtime.Purse')}</span><span class="rest-value">`
      + `${coins(startPurse)} → <b>${coins(purse)}</b></span></li>`);
  }
  const update = { 'system.money': purse, 'system.influence': influence };
  await actor.update(update);
  // Items used up (an offering), and what Train removed.
  const itemUpdates = [];
  const deletes = [];
  for (const [id, used] of spent) {
    const it = actor.items.get(id);
    if (!it) continue;
    const q = (it.system.quantity ?? 1) - used;
    if (q > 0) itemUpdates.push({ _id: id, 'system.quantity': q }); else deletes.push(id);
  }
  if (itemUpdates.length) await actor.updateEmbeddedDocuments('Item', itemUpdates);
  await applyRemovals(actor, removals, deletes);
  // It ends with a Fitful Rest, and Lore refilled to the Lore Limit (plus an Offering's point).
  await fitfulRest(actor, { long: { weeks: weeks.length, rows, rolls, loreBonus } });
  return { money: purse, influence, loreBonus };
}

/** "12gc 50sc". */
const coins = ({ gc = 0, sc = 0 }) => [`${gc}gc`, sc ? `${sc}sc` : ''].filter(Boolean).join(' ');

/**
 * Shop for Bargains (p.266): two rolls on the Bargain Type table (a Bargain Sale, then a Bargain Buy), and for each two
 * Economy: Bargaining Checks on the Bargain Value table (the deal, then how many items are on it).
 */
async function shopForBargains(actor, rolls) {
  const sys = actor.system;
  const proficient = !!sys.talents?.economy?.proficient;
  const rank = Math.max(0, ...(sys.specialties ?? []).filter((s) => s.talent === 'economy' && /bargain/i.test(s.name)).map((s) => s.rank ?? 0));
  const check = async () => {
    const r = await new Roll(`${d20(rank + (proficient ? 0 : -1))} + @finesse${proficient ? ' + @proficiency' : ''}`, actor.getRollData()).evaluate();
    rolls.push(r);
    return bargainValue(r.total, natural(r));
  };
  const tables = await bargainTables();
  const rate = silverRate();
  const parts = [];
  for (const kind of ['sale', 'buy']) {
    const t = await new Roll('1d20').evaluate();
    rolls.push(t);
    const type = BARGAIN_TYPES[t.total - 1];
    const deal = await check();
    const count = await check();
    // "Randomly roll to determine which specific items on each table are for sale": from the compendium's table, each
    // with its price and what the deal makes it.
    const list = type.table ? (tables.get(type.table) ?? []) : [];
    let pick;
    if (list.length) {
      const chosen = new Map();
      for (let k = 0; k < count.items; k++) {
        const r = await new Roll(`1d${list.length}`).evaluate();
        const e = list[r.total - 1];
        if (e) chosen.set(e.uuid, e);
      }
      pick = [...chosen.values()].map((e) => {
        const gc = priceGc(e, rate);
        const p = bargainPrices(gc, deal.deal);
        return `@UUID[${e.uuid}]{${e.name}} ${formatCoins(gc, rate)} → <b>${formatCoins(kind === 'sale' ? p.sale : p.buy, rate)}</b>`;
      }).join('; ');
    } else pick = type.die ? fmt('SACADIA.Downtime.ShopPick', { n: count.items, die: type.die }) : loc('SACADIA.Downtime.ShopMagic');
    parts.push(fmt(kind === 'sale' ? 'SACADIA.Downtime.ShopSale' : 'SACADIA.Downtime.ShopBuy', { type: type.name, deal: deal.deal, n: count.items, pick }));
  }
  return parts.join('<br/>');
}

/**
 * Train (p.266): mark one ability, talent or specialization rank to remove (its points come back to spend). An ability
 * another owned ability requires stays.
 * @returns {string} the card's line
 */
function trainOut(actor, target, removals) {
  const [kind, key] = String(target ?? '').split(':');
  if (kind === 'item') {
    const item = actor.items.get(key);
    if (!item) return `<em>${loc('SACADIA.Downtime.TrainNothing')}</em>`;
    const name = item.name.toLowerCase();
    const needs = actor.items.filter((i) => i.type === 'ability' && i.id !== item.id
      && String(i.system.meta?.prerequisite ?? '').toLowerCase().split(/\s*[,;·]\s*/).includes(name));
    if (needs.length) return `<em>${fmt('SACADIA.Downtime.TrainBlocked', { name: esc(item.name), list: needs.map((i) => esc(i.name)).join(', ') })}</em>`;
    removals.push({ kind, key });
    return fmt('SACADIA.Downtime.TrainRemoved', { name: esc(item.name), csp: item.system.costs?.csp ?? 0 });
  }
  if (kind === 'talent') {
    const label = loc(CONFIG.SACADIA.talents[key]?.label ?? key);
    if ((actor.system.specialties ?? []).some((s) => s.talent === key && s.rank > (s.source ? 1 : 0))) {
      return `<em>${fmt('SACADIA.Downtime.TrainTalentBlocked', { name: label })}</em>`;
    }
    removals.push({ kind, key });
    return fmt('SACADIA.Downtime.TrainTalentRemoved', { name: label });
  }
  if (kind === 'specialty') {
    const s = (actor.system.specialties ?? [])[Number(key)];
    if (!s) return `<em>${loc('SACADIA.Downtime.TrainNothing')}</em>`;
    removals.push({ kind, key });
    return fmt('SACADIA.Downtime.TrainSpecialtyRemoved', { name: esc(s.name || '—') });
  }
  return `<em>${loc('SACADIA.Downtime.TrainNothing')}</em>`;
}

/** Remove what Train marked (and the items used up). */
async function applyRemovals(actor, removals, deletes) {
  const ids = [...deletes, ...removals.filter((r) => r.kind === 'item').map((r) => r.key)].filter((id) => actor.items.has(id));
  if (ids.length) await actor.deleteEmbeddedDocuments('Item', [...new Set(ids)]);
  const upd = {};
  for (const r of removals.filter((x) => x.kind === 'talent')) upd[`system.talents.${r.key}.proficient`] = false;
  const rows = (actor.system.specialties ?? []).map((s) => ({ name: s.name, talent: s.talent, rank: s.rank, source: s.source ?? '' }));
  let changed = false;
  for (const r of removals.filter((x) => x.kind === 'specialty')) {
    const s = rows[Number(r.key)];
    if (s) { s.rank -= 1; changed = true; }
  }
  if (changed) upd['system.specialties'] = rows.filter((s) => s.rank > 0 || s.source);
  if (Object.keys(upd).length) await actor.update(upd);
}
