/**
 * Personal goods (rulebook v1.2 printed pp.197–212), the pure parts: an item's price in gold, the storage bags and
 * baggage give, the light a lit source casts, jewelry's condition checks, and the defense changes an active rune makes.
 * The goods' own data rides in `flags.sacadia.goods` (src/build-goods.mjs); rules/goods.mjs works them on the sheet.
 */

/** An item's retail price in gold, whatever coin it's marked in (a Candle is 1sc). */
export function priceGc(system, rate = 100) {
  const value = Math.max(0, Number(system?.value) || 0);
  return system?.coin === 'sc' ? value / rate : value;
}

/**
 * The slots a character's goods add: SIS from bags and containers (pp.201–202), only the largest of each kind counting
 * ("You may only benefit from one Backpack at a time"; one Chest, Ornate Box or Craft Pouch …), and RIS from readied baggage
 * and pockets while they're readied.
 * @param {{system: object, flags?: object}[]} items  the character's gear and armor
 * @returns {{sis: number, ris: number}}
 */
export function goodsCapacity(items) {
  const best = new Map();
  let sis = 0;
  let ris = 0;
  for (const i of items) {
    const give = i.system?.providesSis ?? 0;
    const group = i.flags?.sacadia?.goods?.storageGroup;
    if (group) best.set(group, Math.max(best.get(group) ?? 0, give));
    else sis += give;
    if (i.system?.storage !== 'sis') ris += i.system?.providesRis ?? 0;
  }
  for (const v of best.values()) sis += v;
  return { sis, ris };
}

/** Round a light radius down to the 5ft grid (the Black Lens: "half as far (round down)"). */
const down5 = (ft) => Math.max(0, Math.floor(ft / 5) * 5);

/**
 * The light a character casts from what's lit (pp.200, 195): the brightest lit source, as its lantern add-on changes it,
 * plus Shimmering Polish's 5ft/5ft while a source is held; a Chickenglitter glow counts on its own.
 * @param {{light: object, addOn?: object}[]} lit  each lit source and the add-on affixed to it (a lantern's)
 * @param {{glow?: {bright: number, dim: number}, polish?: boolean}} [extra]
 * @returns {{bright: number, dim: number, angle: number, glow: boolean}|null}  null when nothing's lit
 */
export function castLight(lit, { glow = null, polish = false } = {}) {
  const options = [];
  for (const { light, addOn } of lit) {
    let bright = light.bright ?? 0;
    let dim = light.dim ?? 0;
    let angle = 360;
    if (addOn && light.fuel) {
      if (addOn.scale) { bright = down5(bright * addOn.scale); dim = down5(dim * addOn.scale); }
      else { bright = addOn.bright ?? bright; dim = addOn.dim ?? dim; angle = addOn.angle ?? angle; }
    }
    if (polish) { bright += 5; dim += 5; }
    options.push({ bright, dim: Math.max(dim, bright), angle, glow: false });
  }
  if (glow) options.push({ bright: glow.bright ?? 0, dim: Math.max(glow.dim ?? 0, glow.bright ?? 0), angle: 360, glow: true });
  if (!options.length) return null;
  return options.sort((a, b) => (b.dim - a.dim) || (b.bright - a.bright))[0];
}

/**
 * Jewelry (p.208), worn in a RIS: "1X Advantage against taking the X condition when it is first given to you, as well as
 * on all uses of the Make Trait Check action against" it, as the condition-check fold reads modifiers
 * (helpers/check-pool.mjs foldCheckModifiers).
 * @param {{name: string, type: string, system: object, flags?: object}[]} items
 */
export function jewelryCheckItems(items) {
  return items.filter((i) => i.type === 'gear' && i.flags?.sacadia?.goods?.jewelry && i.system?.storage !== 'sis' && !i.flags?.sacadia?.broken)
    .map((i) => ({ name: i.name, modifiers: [{ label: i.name, target: 'resistAdvantage', mode: 'add', value: '1',
      predicate: [{ atom: `self:checking:${i.flags.sacadia.goods.jewelry}` }] }] }));
}

/** A rune's choices as a list (stored as an array, or an index-keyed object from a form). */
const picks = (v) => (Array.isArray(v) ? v : Object.keys(v ?? {}).sort((a, b) => Number(a) - Number(b)).map((k) => v[k])).filter(Boolean);

/**
 * The defense changes an active rune makes (p.209): its fixed ones, and the choices made when it was bought
 * (`flags.sacadia.runeChoice`: {minus, plus}). Only valid picks count; a "must differ" side counts each defense once.
 * @param {{fixed?: object, minus?: object, plus?: object}} rune
 * @param {{minus?: string[], plus?: string[]}} choice
 * @returns {{ad: number, pd: number, td: number, md: number, dr: number}}
 */
export function runeDeltas(rune, choice = {}) {
  const out = { ad: 0, pd: 0, td: 0, md: 0, dr: 0 };
  for (const [k, v] of Object.entries(rune?.fixed ?? {})) out[k] += v;
  for (const [side, sign] of [['minus', -1], ['plus', 1]]) {
    const spec = rune?.[side];
    if (!spec) continue;
    let chosen = picks(choice?.[side]).filter((k) => spec.from.includes(k)).slice(0, spec.n);
    if (spec.distinct) chosen = [...new Set(chosen)];
    for (const k of chosen) out[k] += sign * spec.by;
  }
  return out;
}

/** Has every choice the rune asks for been made? */
export function runeChosen(rune, choice = {}) {
  return ['minus', 'plus'].every((side) => !rune?.[side] || picks(choice?.[side]).filter((k) => rune[side].from.includes(k)).length >= rune[side].n);
}

/** "AD −2 · PD +3": a rune's changes, zeros left out. */
export function runeSummary(deltas) {
  return ['ad', 'pd', 'td', 'md', 'dr'].filter((k) => deltas[k]).map((k) => `${k.toUpperCase()} ${deltas[k] > 0 ? '+' : '−'}${Math.abs(deltas[k])}`).join(' · ');
}

/**
 * What a bargain makes an item cost (p.266): a Bargain Sale takes the deal off the price; a Bargain Buy is a merchant paying
 * the deal over their usual half price.
 * @param {number} gc  the item's price in gold
 * @param {number} deal  the percentage
 */
export function bargainPrices(gc, deal) {
  return { sale: gc * (1 - deal / 100), buy: (gc / 2) * (1 + deal / 100) };
}
