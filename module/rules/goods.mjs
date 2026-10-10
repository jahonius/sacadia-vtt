/**
 * Personal goods at the table (rulebook v1.2 printed pp.197–212): lighting a torch, candle or lantern lights the character's
 * tokens (and the rest that ends it burns it out); a Chickenglitter glow; using up a consumable; buying an item dropped on
 * the purse; one active rune at a time; and the Shop for Bargains tables' items. The pure parts are in helpers/goods.mjs.
 */
import { castLight, priceGc } from '../helpers/goods.mjs';
import { pay, formatCoins } from '../helpers/downtime.mjs';
import { findGear, gearId } from '../helpers/actor-utils.mjs';
import { deleteKey } from '../helpers/update-ops.mjs';
import { cardHead } from '../helpers/chat-cards.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';

const loc = (k) => game.i18n.localize(k);
const fmt = (k, d) => game.i18n.format(k, d);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const rate = () => Math.max(1, Number(game.settings.get('sacadia', 'silverPerGold')) || 100);

/** The goods data the build gave an item (`flags.sacadia.goods`), or null. */
export const goodsOf = (item) => item?.flags?.sacadia?.goods ?? null;
/** A light source (not a lantern's add-on). */
export const isLightSource = (item) => !!goodsOf(item)?.light && !goodsOf(item).light.addOn;
/** A lantern add-on (Black Lens, Diffuser, Hood): equipped means affixed. */
export const isLanternAddOn = (item) => !!goodsOf(item)?.light?.addOn;

/** Use up `n` of an item, deleting the last; `extra` goes with the update when some are left. */
async function expend(item, n = 1, extra = {}) {
  const q = (item.system.quantity ?? 1) - n;
  if (q > 0) await item.update({ 'system.quantity': q, ...extra });
  else await item.delete();
}

/** A small card from the character: "Ilsa lights a Torch." */
async function note(actor, html) {
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="sacadia chat-card note-card">${html}</div>` });
}

/* -------------------------------------------- */
/*  Light                                       */
/* -------------------------------------------- */

const FLAME = { color: '#ffb057', alpha: 0.4, animation: { type: 'torch', speed: 2, intensity: 2 } };
const GLOW = { color: '#f4e27a', alpha: 0.3, animation: { type: 'pulse', speed: 2, intensity: 2 } };

/**
 * Light or put out a light source (Illuminate/Extinguish, p.200). Lighting needs Flint and Tinder at hand (asked, not
 * enforced: another flame will do); a lantern burns a Lantern Oil; a lit torch deals Fire. Chickenglitter Dye is used up
 * and the character glows until a Nightly Rest. The tokens follow (the updateItem hook calls syncLight).
 * @returns {Promise<boolean>} whether anything changed
 */
export async function toggleLight(item) {
  const actor = item?.actor;
  const light = goodsOf(item)?.light;
  if (!actor || !light || light.addOn) return false;
  if (item.getFlag('sacadia', 'lit')) {
    await item.update({ 'flags.sacadia.lit': false, ...(light.litDamage ? { 'system.damageType': item.getFlag('sacadia', 'unlitDamage') || 'Bludgeon' } : {}) });
    return true;
  }
  if (light.glow) {
    await actor.setFlag('sacadia', 'glow', { bright: light.bright ?? 0, dim: light.dim ?? 0, from: item.name });
    await note(actor, fmt('SACADIA.Goods.Glows', { name: esc(actor.name), item: esc(item.name) }));
    await expend(item);
    await syncLight(actor);
    return true;
  }
  if (!findGear(actor, 'flint_and_tinder', { where: 'hand' })) {
    const ok = await sacDialog.confirm({ window: { title: loc('SACADIA.Goods.LightTitle') }, rejectClose: false,
      content: `<p>${fmt('SACADIA.Goods.NoFlint', { name: esc(item.name) })}</p>` });
    if (!ok) return false;
  }
  if (light.fuel) {
    const oil = actor.items.find((i) => i.type === 'gear' && gearId(i) === light.fuel && (i.system.quantity ?? 0) > 0);
    if (!oil) { ui.notifications.warn(fmt('SACADIA.Goods.NoFuel', { name: item.name })); return false; }
    await expend(oil);
  }
  await item.update({ 'flags.sacadia.lit': true,
    ...(light.litDamage ? { 'flags.sacadia.unlitDamage': item.system.damageType, 'system.damageType': light.litDamage } : {}) });
  return true;
}

/** The light the character casts now: their lit sources, the add-on affixed to a lantern, a glow, Shimmering Polish. */
export function actorLight(actor) {
  const gear = actor.items.filter((i) => i.type === 'gear');
  const addOn = gear.find((i) => isLanternAddOn(i) && i.system.equipped);
  const lit = gear.filter((i) => isLightSource(i) && i.getFlag('sacadia', 'lit'))
    .map((i) => ({ light: goodsOf(i).light, addOn: goodsOf(i).light.fuel ? goodsOf(addOn)?.light ?? null : null }));
  const polish = !!actor.system._rollOptions?.()['self:gear:shimmering-polish'];
  return castLight(lit, { glow: actor.getFlag('sacadia', 'glow') ?? null, polish });
}

/**
 * The update that gives a token (its source data, or a prototype token's) the light cast: its own light is kept in
 * `flags.sacadia.baseLight` while a source overrides it, and put back when nothing's lit. Null when it's already right.
 */
function lightUpdate(source, cast) {
  const base = source?.flags?.sacadia?.baseLight;
  const current = source?.light ?? {};
  if (!cast) return base ? { light: base, 'flags.sacadia.baseLight': deleteKey() } : null;
  const look = cast.glow ? GLOW : FLAME;
  if (base && current.bright === cast.bright && current.dim === cast.dim && (current.angle ?? 360) === cast.angle && current.color === look.color) return null;
  const own = foundry.utils.deepClone(base ?? current);
  const light = { ...own, bright: cast.bright, dim: cast.dim, angle: cast.angle, color: look.color, alpha: look.alpha,
    animation: { ...(own.animation ?? {}), ...look.animation } };
  return { light, ...(base ? {} : { 'flags.sacadia.baseLight': foundry.utils.deepClone(current) }) };
}

/**
 * Bring the character's tokens (on the viewed scene) and its prototype token in line with the light it casts.
 * @param {Actor} actor
 */
export async function syncLight(actor) {
  if (!actor?.isOwner) return;
  const cast = actorLight(actor);
  const tokens = actor.isToken ? [actor.token] : (actor.getActiveTokens?.(false, true) ?? []);
  for (const t of tokens) {
    const upd = t ? lightUpdate(t._source, cast) : null;
    if (upd) await t.update(upd);
  }
  if (!actor.isToken) {
    const upd = lightUpdate(actor._source.prototypeToken, cast);
    if (upd) await actor.update(Object.fromEntries(Object.entries(upd).map(([k, v]) => [`prototypeToken.${k}`, v])));
  }
}

/**
 * A rest puts the lights out (p.200): a candle or torch "burns out after one hour, or with a quick rest" (used up), a
 * lantern goes out (its oil spent), a burning smudge is used up; a Nightly (Fitful or Long) Rest ends a Chickenglitter glow.
 * @param {Actor} actor
 * @param {'short'|'fitful'|'long'} kind
 * @returns {Promise<string[]>} what went out, for the rest card
 */
export async function restLights(actor, kind) {
  const out = [];
  for (const item of actor.items.filter((i) => i.type === 'gear' && isLightSource(i) && i.getFlag('sacadia', 'lit'))) {
    const light = goodsOf(item).light;
    const unlit = { 'flags.sacadia.lit': false, ...(light.litDamage ? { 'system.damageType': item.getFlag('sacadia', 'unlitDamage') || 'Bludgeon' } : {}) };
    if (light.burnsOut) { out.push(fmt('SACADIA.Goods.BurntOut', { name: item.name })); await expend(item, 1, unlit); }
    else { out.push(item.name); await item.update(unlit); }
  }
  for (const smudge of actor.items.filter((i) => i.type === 'gear' && i.system.equipped && gearId(i).startsWith('smudge'))) {
    out.push(fmt('SACADIA.Goods.BurntOut', { name: smudge.name }));
    await expend(smudge, 1, { 'system.equipped': false });
  }
  if (kind !== 'short' && actor.getFlag('sacadia', 'glow')) {
    out.push(fmt('SACADIA.Goods.GlowFades', { name: actor.getFlag('sacadia', 'glow').from ?? '' }));
    await actor.unsetFlag('sacadia', 'glow');
  }
  if (out.length) await syncLight(actor);
  return out;
}

/* -------------------------------------------- */
/*  Using, buying                               */
/* -------------------------------------------- */

/** Use up one of a consumable (a Healing Date, Bandages, an oil, a day's Rations …), posting what it does. */
export async function useGoods(item) {
  const actor = item?.actor;
  if (!actor || !goodsOf(item)?.use) return false;
  const content = `<div class="sacadia chat-card item-card goods-card">`
    + cardHead({ img: item.img, title: fmt('SACADIA.Goods.Uses', { name: actor.name, item: item.name }) })
    + `<div class="card-desc">${item.system.description ?? ''}</div></div>`;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  await expend(item);
  return true;
}

/**
 * Buy an item (dropped on the purse): pay its price, or say it can't be afforded.
 * @returns {Promise<boolean>} whether it was paid for (the drop then adds it)
 */
export async function buyItem(actor, item) {
  const r = rate();
  const price = priceGc(item.system, r);
  if (!price) return true;
  const after = pay(actor.system.money ?? {}, price, r);
  if (!after) {
    ui.notifications.warn(fmt('SACADIA.Money.CantAfford', { name: item.name, price: formatCoins(price, r) }));
    return false;
  }
  await actor.update({ 'system.money': after });
  await note(actor, fmt('SACADIA.Money.Bought', { name: esc(actor.name), item: esc(item.name), price: formatCoins(price, r) }));
  return true;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * An item changed or went: keep the tokens' light in step with what's lit and affixed, and keep one rune active ("If you
 * activate one Rune equipped in RIS, any other Runes you have activated will automatically deactivate", p.209).
 */
export async function goodsItemChanged(item, changes, userId) {
  if (userId !== game.user.id || item.parent?.documentName !== 'Actor') return;
  const actor = item.parent;
  const g = goodsOf(item);
  if (!g) return;
  if (g.rune && changes?.system?.equipped === true) {
    const others = actor.items.filter((i) => i.id !== item.id && goodsOf(i)?.rune && i.system.equipped);
    if (others.length) await actor.updateEmbeddedDocuments('Item', others.map((i) => ({ _id: i.id, 'system.equipped': false })));
  }
  const lightChange = changes === null || foundry.utils.hasProperty(changes ?? {}, 'flags.sacadia.lit')
    || (isLanternAddOn(item) && foundry.utils.hasProperty(changes ?? {}, 'system.equipped'));
  if (g.light && lightChange) await syncLight(actor);
}

/* -------------------------------------------- */
/*  Shop for Bargains                           */
/* -------------------------------------------- */

let bargainPromise = null;

/**
 * The items on each Shop for Bargains table (p.266), across this system's compendiums (`flags.sacadia.bargain`):
 * table → [{uuid, name, value, coin}]. Built once a session.
 */
export function bargainTables() {
  bargainPromise ??= (async () => {
    const out = new Map();
    const packs = game.packs.filter((p) => p.metadata.packageType === 'system' && p.metadata.packageName === game.system.id && p.documentName === 'Item');
    for (const pack of packs) {
      const index = await pack.getIndex({ fields: ['flags.sacadia.bargain', 'system.value', 'system.coin'] });
      for (const e of index) {
        const t = e.flags?.sacadia?.bargain;
        if (!t) continue;
        if (!out.has(t)) out.set(t, []);
        out.get(t).push({ uuid: e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`, name: e.name, value: e.system?.value ?? 0, coin: e.system?.coin ?? 'gc' });
      }
    }
    return out;
  })();
  return bargainPromise;
}
