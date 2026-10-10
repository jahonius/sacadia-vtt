/**
 * The Travel Ledger: Sacadia's travel rules (helpers/travel.mjs) run by the GM a day at a time. Its journey lives on the
 * scene (`flags.sacadia.travel`): the route (an Indy Route route on the scene), the party's token, the method of travel,
 * the pace and the supply; then each day's road, weather, terrain and Check DC, and the log of days.
 *
 * Travelling a day works out the hexes and the supply eaten, moves the party that far along the route and posts the day to
 * chat. With Indy Route active, the day's leg is drawn as an animated route the party token rides, then kept on the map as
 * a tile (the live line is cleared, so nothing lingers on other scenes). Without it, the token just moves. The route is
 * read from the scene's flags, so a route drawn with Indy Route still works if the module is off.
 */
import { METHODS, ROADS, PACES, WEATHER, TERRAIN, DIFFICULTY, HEX_KM, dailyHexes, dailySupply, isLaden, pxPerHex, pathLength,
  subpath } from '../helpers/travel.mjs';
import { cardHead } from '../helpers/chat-cards.mjs';
import { sacDialog } from '../helpers/dialogs.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (k) => game.i18n.localize(k);
const fmt = (k, d) => game.i18n.format(k, d);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULTS = {
  routeId: '', tokenId: '', destination: '', method: 'foot', pace: 'normal', freshWater: false, food: 5, water: 5,
  today: { road: 'dirtRoad', weather: 0, terrain: 0, difficulty: 'easy', note: '' },
  travelled: 0, log: [],
};

/** A day's leg on the map: Indy Route's line, as on the rulebook's maps. */
const LEG_STYLE = {
  scaleWithMap: false, lineColor: '#9a1c14', lineAlpha: 0.9, lineWidth: 5, dashLength: 0, gapLength: 0,
  showLabel: true, labelColor: '#5c100b', labelFontFamily: 'Alegreya, serif', labelFontSize: 14, labelOffset: 12,
  labelFollowPath: false, labelShowArrow: false, labelPosition: 50, renderAboveTokens: true, showEndX: false,
  showDot: true, dotColor: '#f7f0e6', dotRadius: 6, dotTokenRotate: false, dotTokenScale: 1, dotTokenRotateOffset: 0,
  cinematicMovement: true, introMs: 1200, pauseMs: 600, cameraZoomFactor: 0.6, cameraSmooth: 0.12, tokenUpdateMs: 50,
  drawSpeed: 40, sampleStepPx: 2, smoothingMode: 'none', travelMode: 'none',
};

export class TravelLedger extends HandlebarsApplicationMixin(ApplicationV2) {
  /** One ledger window per scene. */
  static #open = new Map();

  /** Open the ledger for a scene (the viewed one by default). */
  static open(scene = canvas.scene) {
    if (!game.user.isGM) return ui.notifications.warn(loc('SACADIA.Travel.GMOnly'));
    if (!scene) return ui.notifications.warn(loc('SACADIA.Travel.NoScene'));
    const app = this.#open.get(scene.id) ?? new this({ scene });
    this.#open.set(scene.id, app);
    return app.render({ force: true });
  }

  constructor({ scene, ...options } = {}) {
    super({ id: `sacadia-travel-${scene.id}`, ...options });
    this.scene = scene;
  }

  static DEFAULT_OPTIONS = {
    classes: ['sacadia-dialog', 'sacadia-travel'],
    tag: 'form',
    window: { icon: 'fa-solid fa-route', resizable: true },
    position: { width: 600, height: 'auto' },
    form: { handler: TravelLedger.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      travelDay: TravelLedger.#onTravelDay,
      undoDay: TravelLedger.#onUndoDay,
      startOver: TravelLedger.#onStartOver,
    },
  };

  static PARTS = { ledger: { template: 'systems/sacadia/templates/apps/travel-ledger.hbs' } };

  get title() { return fmt('SACADIA.Travel.Title', { scene: this.scene.name }); }

  /** The journey, with defaults for what isn't set. */
  get state() {
    return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), this.scene.flags?.sacadia?.travel ?? {}, { inplace: false });
  }

  /** The scene's routes (Indy Route's, from its flags). */
  get routes() { return this.scene.flags?.['indy-route']?.routes ?? []; }

  get #indy() { return game.modules.get('indy-route')?.active ? game.modules.get('indy-route').api : null; }

  #route(st = this.state) { return this.routes.find((r) => r.id === st.routeId && r.points?.length >= 2) ?? null; }

  #busy = false;

  async _prepareContext() {
    const st = this.state;
    const opts = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, loc(typeof v === 'string' ? v : v.label)]));
    const signed = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Number(k) ? `${loc(v)} (${k.replace('-', '−')})` : loc(v)]));
    const route = this.#route(st);
    const perHex = pxPerHex(this.scene.grid);
    const totalHexes = route ? pathLength(route.points) / perHex : null;
    const doneHexes = st.log.reduce((t, d) => t + d.hexes, 0);
    const supply = Number(st.food) + Number(st.water);
    const today = { ...st.today, method: st.method, pace: st.pace, supply };
    const hexes = dailyHexes(today);
    const eats = dailySupply(st);
    const max = METHODS[st.method]?.maxSupply ?? 0;
    return {
      st, isGM: game.user.isGM, busy: this.#busy, indy: !!this.#indy,
      routes: Object.fromEntries(this.routes.map((r) => [r.id, r.name])),
      tokens: Object.fromEntries(this.scene.tokens.map((t) => [t.id, t.name])),
      methods: opts(METHODS), paces: opts(PACES), roads: opts(ROADS), weather: signed(WEATHER), terrain: signed(TERRAIN),
      difficulties: Object.fromEntries(Object.entries(DIFFICULTY).map(([k, dc]) => [k, `${loc(`SACADIA.Travel.Difficulty.${k}`)} (${dc})`])),
      supplyHint: fmt('SACADIA.Travel.SupplyHint', { method: loc(METHODS[st.method]?.label), max }),
      overSupply: supply > (METHODS[st.method]?.overladen ?? Infinity),
      laden: isLaden(st.method, supply),
      preview: {
        hexes, hexLabel: fmt(hexes === 1 ? 'SACADIA.Travel.Hex' : 'SACADIA.Travel.Hexes', { n: hexes }), km: hexes * HEX_KM, stuck: hexes === 0, food: eats.food, water: eats.water,
        sightlines: PACES[st.pace]?.sightlines ?? 3, dc: DIFFICULTY[st.today.difficulty],
      },
      progress: route ? {
        done: Math.round(Math.min(doneHexes, totalHexes)), total: Math.round(totalHexes),
        left: Math.max(0, Math.round(totalHexes - st.travelled / perHex)),
        pct: Math.min(100, Math.round((st.travelled / pathLength(route.points)) * 100)),
        arrived: st.travelled >= pathLength(route.points) - 0.5,
      } : null,
      day: st.log.length + 1,
      log: [...st.log].reverse().map((d) => ({ ...d, roadLabel: loc(ROADS[d.road]), paceLabel: loc(PACES[d.pace]?.label),
        slowed: [d.weather ? loc(WEATHER[d.weather]) : '', d.terrain ? loc(TERRAIN[d.terrain]) : ''].filter(Boolean).join(', ') })),
    };
  }

  /** Form changes save straight to the scene. */
  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const patch = {
      routeId: data.routeId ?? '', tokenId: data.tokenId ?? '', destination: data.destination ?? '', method: data.method, pace: data.pace,
      freshWater: !!data.freshWater, food: Math.max(0, Number(data.food) || 0), water: Math.max(0, Number(data.water) || 0),
      today: { road: data.today?.road, weather: Number(data.today?.weather) || 0, terrain: Number(data.today?.terrain) || 0,
        difficulty: data.today?.difficulty, note: data.today?.note ?? '' },
    };
    // A different route starts the journey over (the log stays, for the record, until Start Over).
    if (patch.routeId !== this.state.routeId) patch.travelled = 0;
    await this.scene.setFlag('sacadia', 'travel', patch);
    this.render();
  }

  /** Travel a day: the hexes, the supply, the map, and a chat card. */
  static async #onTravelDay() {
    if (this.#busy) return;
    this.#busy = true;
    this.render();
    try { await this.travelDay(); } finally { this.#busy = false; this.render(); }
  }

  /** Travel one day (also callable from code). Returns the day's log entry. */
  async travelDay() {
    const st = this.state;
    const scene = this.scene;
    const day = st.log.length + 1;
    const supply = Number(st.food) + Number(st.water);
    const hexes = dailyHexes({ ...st.today, method: st.method, pace: st.pace, supply });
    const ate = dailySupply(st);
    const route = this.#route(st);
    const token = scene.tokens.get(st.tokenId) ?? null;
    const total = route ? pathLength(route.points) : 0;
    const from = st.travelled;
    const to = route ? Math.min(total, from + hexes * pxPerHex(scene.grid)) : from;
    const entry = {
      day, method: st.method, road: st.today.road, pace: st.pace, weather: st.today.weather, terrain: st.today.terrain,
      difficulty: st.today.difficulty, note: st.today.note, hexes: route ? Math.round(((to - from) / pxPerHex(scene.grid)) * 10) / 10 : hexes,
      from, to, ate, food: Math.max(0, st.food - ate.food), water: Math.max(0, st.water - ate.water),
      short: { food: Math.max(0, ate.food - st.food), water: Math.max(0, ate.water - st.water) },
      tokenFrom: token ? { x: token.x, y: token.y } : null, tileId: null,
    };
    if (route && to > from) entry.tileId = await this.#moveAlong(subpath(route.points, from, to), day, token);
    await scene.setFlag('sacadia', 'travel', {
      travelled: to, food: entry.food, water: entry.water, log: [...st.log, entry], today: { note: '' },
    });
    await this.#postDay(entry, { route, total, token, destination: st.destination });
    return entry;
  }

  /**
   * Move the party along a leg. With Indy Route: draw it for everyone (the token rides it), keep it as a tile, then clear
   * the live line. Without: move the token to the leg's end. Returns the tile's id, if there is one.
   */
  async #moveAlong(leg, day, token) {
    const end = leg.at(-1);
    const indy = this.#indy;
    let tileId = null;
    if (indy) {
      const routeId = `sacadia-travel-${this.scene.id}-${day}-${foundry.utils.randomID(4)}`;
      const label = fmt('SACADIA.Travel.DayN', { n: day });
      indy.drawRoute({ points: leg, routeId, name: label, sceneId: this.scene.id, lingerMs: 8000, broadcast: true,
        settings: { ...LEG_STYLE, dotTokenUuid: token?.uuid ?? '' } });
      const seconds = (LEG_STYLE.introMs + LEG_STYLE.pauseMs) / 1000 + pathLength(leg) / LEG_STYLE.drawSpeed;
      const deadline = Date.now() + (seconds + 10) * 1000;
      await sleep(300);
      while (indy.isRouteActive(routeId) && Date.now() < deadline) await sleep(200);
      const tile = await indy.drawRouteToTile({ points: leg, labelText: label, showEndX: false,
        settings: { ...LEG_STYLE, showDot: false, cinematicMovement: false } }).catch(() => null);
      if (tile) {
        tileId = tile.id;
        await tile.update({ 'flags.sacadia.travelDay': day });
      }
      indy.clearRoute(routeId);
    }
    if (token) {
      // Indy Route moves the token while it rides; this sets where the day ends, either way.
      const w = token.width * this.scene.grid.size, h = token.height * this.scene.grid.size;
      await token.update({ x: Math.round(end.x - w / 2), y: Math.round(end.y - h / 2) }, { animate: !indy });
    }
    return tileId;
  }

  async #postDay(d, { route, total, token, destination }) {
    const where = destination || loc('SACADIA.Travel.TheDestination');
    const perHex = pxPerHex(this.scene.grid);
    const minus = (n) => String(n).replace('-', '−');
    // Label / value rows, as on the rest card.
    const rows = [];
    const row = (label, value) => rows.push(`<li><span class="rest-label">${loc(`SACADIA.Travel.Card.${label}`)}</span><span class="rest-value">${value}</span></li>`);
    row('CoveredLabel', d.hexes > 0
      ? fmt('SACADIA.Travel.Card.Covered', { hexes: fmt(d.hexes === 1 ? 'SACADIA.Travel.Hex' : 'SACADIA.Travel.Hexes', { n: d.hexes }),
        km: Math.round(d.hexes * HEX_KM), road: loc(ROADS[d.road]).toLowerCase() })
      : loc('SACADIA.Travel.Card.Stuck'));
    const slowed = [d.weather ? `${loc(WEATHER[d.weather])} (${minus(d.weather)})` : '', d.terrain ? `${loc(TERRAIN[d.terrain])} (${minus(d.terrain)})` : '']
      .filter(Boolean).join(', ');
    if (slowed) row('SlowedLabel', slowed);
    row('SupplyLabel', fmt('SACADIA.Travel.Card.Supply', { food: d.ate.food, water: d.ate.water, leftFood: d.food, leftWater: d.water })
      + (d.short.food || d.short.water ? ` <span class="warn">${fmt('SACADIA.Travel.Card.Short', { what: [
        d.short.food ? fmt('SACADIA.Travel.Card.ShortFood', { n: d.short.food }) : '',
        d.short.water ? fmt('SACADIA.Travel.Card.ShortWater', { n: d.short.water }) : ''].filter(Boolean).join(', ') })}</span>` : ''));
    if (route) {
      row('AheadLabel', d.to >= total - 0.5 ? `<b>${fmt('SACADIA.Travel.Card.Arrived', { where: esc(where) })}</b>`
        : fmt('SACADIA.Travel.Card.ToGo', { hexes: Math.round((total - d.to) / perHex), where: esc(where) }));
    }
    row('ChecksLabel', fmt('SACADIA.Travel.Card.Checks', { sightlines: PACES[d.pace]?.sightlines ?? 3, dc: DIFFICULTY[d.difficulty],
      difficulty: loc(`SACADIA.Travel.Difficulty.${d.difficulty}`).toLowerCase() }));
    if (d.note) row('NoteLabel', `<em>${esc(d.note)}</em>`);
    const content = '<div class="sacadia chat-card rest-card travel-card">'
      + cardHead({ icon: 'fa-solid fa-route', title: fmt('SACADIA.Travel.DayN', { n: d.day }),
        meta: [loc(METHODS[d.method]?.label), loc(PACES[d.pace]?.label)] })
      + `<ul class="rest-list">${rows.join('')}</ul></div>`;
    await ChatMessage.create({ speaker: token ? ChatMessage.getSpeaker({ token }) : { alias: loc('SACADIA.Travel.Ledger') }, content });
  }

  static async #onUndoDay() {
    if (this.#busy) return;
    await this.undoDay();
    this.render();
  }

  static async #onStartOver() {
    if (this.#busy) return;
    await this.startOver();
    this.render();
  }

  /** Undo the last day: its tile, the token's move, the supply it ate. */
  async undoDay() {
    const st = this.state;
    const d = st.log.at(-1);
    if (!d) return;
    if (d.tileId) await this.scene.tiles.get(d.tileId)?.delete();
    const token = this.scene.tokens.get(st.tokenId);
    if (token && d.tokenFrom) await token.update(d.tokenFrom, { animate: false });
    await this.scene.setFlag('sacadia', 'travel', { travelled: d.from, food: st.food + d.ate.food - d.short.food,
      water: st.water + d.ate.water - d.short.water, log: st.log.slice(0, -1) });
  }

  /** Start over: every day's tile goes, the token goes back to where the journey began, and the supply eaten comes back. */
  async startOver({ confirm = true } = {}) {
    const st = this.state;
    if (!st.log.length) return;
    if (confirm && !(await sacDialog.confirm({ window: { title: loc('SACADIA.Travel.StartOver') },
      content: `<p>${loc('SACADIA.Travel.StartOverConfirm')}</p>` }))) return;
    const tiles = st.log.map((d) => d.tileId).filter((id) => id && this.scene.tiles.has(id));
    if (tiles.length) await this.scene.deleteEmbeddedDocuments('Tile', tiles);
    const token = this.scene.tokens.get(st.tokenId);
    if (token && st.log[0].tokenFrom) await token.update(st.log[0].tokenFrom, { animate: false });
    const back = st.log.reduce((t, d) => ({ food: t.food + d.ate.food - d.short.food, water: t.water + d.ate.water - d.short.water }), { food: 0, water: 0 });
    await this.scene.setFlag('sacadia', 'travel', { travelled: 0, food: st.food + back.food, water: st.water + back.water, log: [] });
  }

  _onClose(options) {
    super._onClose(options);
    TravelLedger.#open.delete(this.scene.id);
  }
}
