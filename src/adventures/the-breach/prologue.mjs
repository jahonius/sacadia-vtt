/**
 * The prologue's world map: the rulebook's "Civilizations of the Ardus Yauga" (v1.2 PDF p.26, resampled ×2 by
 * tools/ardus-yauga-asset.mjs). Its scale, the places on it, the routes on it (Indy Route's, in the scene's flags), where
 * the party starts, the Travel Ledger's journey, and the Augur: Nexus site that opens the battle map. Coordinates are
 * pixels on the 2160 × 1754 map (the scene has no padding, so they're canvas coordinates too).
 *
 * Scale: the rulebook map has none. It's taken as 1 km per pixel of the rulebook's 1080-pixel map, so 2 px per km here.
 * Chuni's Wall then runs about 100 km from Kjerstwall to Low Ballom (the rulebook: "several days' journey"), and the road
 * from Tianqis to the wall is about 140 km (35 travel hexes of 4 km, rulebook v1.2 p.294). Change PX_PER_KM to rescale.
 */

export const WORLD = { file: 'ardus-yauga.webp', thumb: 'ardus-yauga-thumb.webp', width: 2160, height: 1754 };

export const PX_PER_KM = 2;
const MI_PER_KM = 0.621371;
/** The scene is gridless, but measurement still uses the grid: 100 px is 50 km, in miles (Indy Route's unit). */
export const GRID = { size: 100, miles: Math.round((100 / PX_PER_KM) * MI_PER_KM * 100) / 100 };

/** Where Augur: Nexus puts the Chuni's Wall site: the wall's eastern fort, above Low Ballom, where the road meets it. */
export const WALL_FORT = [1622, 362];

/**
 * The road to the wall, as the party plans it: the dotted road north from Tianqis, the Tianqi port, past Valli Falls to
 * Low Ballom and the wall's eastern fort. The Travel Ledger moves the party along it a day at a time.
 */
export const ROAD = [[1770, 618], [1749, 588], [1735, 560], [1727, 532], [1714, 503], [1697, 478], [1671, 458], [1652, 432], [1638, 400], [1624, 370]];

/** The alarm: smoke rising from fort to fort along the wall, from the eastern fort west to the towers above Kjerstwall. */
export const SMOKE = [[1622, 366], [1590, 371], [1556, 368], [1522, 360], [1494, 350], [1470, 340]];

/**
 * The Travel Ledger's journey, ready to go (apps/travel-ledger.mjs): on foot along the road from Tianqis, with what a
 * traveller on foot can carry (5 supply). The road passes Valli Falls and Low Ballom, where the party can buy more.
 */
export const JOURNEY = {
  destination: 'Chuni\'s Wall', method: 'foot', pace: 'normal', freshWater: false, food: 3, water: 2,
  today: { road: 'dirtRoad', weather: 0, terrain: 0, difficulty: 'simple', note: '' },
};

/**
 * Indy Route styles, set outright (not scaled to the view) so every table sees the same lines. The camera's zoom is
 * (2 × the screen's size ÷ the route's length) × cameraZoomFactor: these keep it under about 2×, as far as this map's
 * resolution goes. Played lines fade after lingerMs: Indy Route draws over the canvas, not the scene, so a line left up
 * would stay on screen over the next scene.
 */
const LINE = {
  scaleWithMap: false, scaleMultiplier: 1, lineAlpha: 0.9, dashLength: 0, gapLength: 0,
  labelFontFamily: 'Alegreya, serif', labelFollowPath: true, labelPosition: 50,
  renderAboveTokens: true, routeSound: '', travelFareTier: 'standard', sampleStepPx: 3,
  introMs: 2000, pauseMs: 1200, cameraSmooth: 0.12, tokenUpdateMs: 25,
  smoothingMode: 'catmull', catmullSamplesPerSegment: 16, catmullAlpha: 0.5, travelMode: 'none',
};
/** The planned road: a faint dashed line (each day the ledger draws over it in red). */
export const ROAD_STYLE = {
  ...LINE, lineColor: '#9a1c14', lineAlpha: 0.55, lineWidth: 3, dashLength: 6, gapLength: 6, showLabel: true, labelColor: '#5c100b',
  labelFontSize: 14, labelOffset: 14, labelShowArrow: true, cinematicMovement: true, cameraZoomFactor: 0.15, showEndX: true,
  showDot: false, dotColor: '#f7f0e6', dotRadius: 6, dotTokenUuid: '', dotTokenRotate: false, dotTokenScale: 1, dotTokenRotateOffset: 0,
  drawSpeed: 80, lingerMs: 8000,
};
export const SMOKE_STYLE = {
  ...LINE, lineColor: '#3b3b3b', lineAlpha: 0.75, lineWidth: 5, dashLength: 10, gapLength: 8, showLabel: true, labelColor: '#262626',
  labelFontSize: 14, labelShowArrow: false, labelOffset: -14, cinematicMovement: true, cameraZoomFactor: 0.09, showEndX: false,
  showDot: false, dotColor: '#d9d9d9', dotRadius: 6, dotTokenUuid: '', dotTokenRotate: false, dotTokenScale: 1, dotTokenRotateOffset: 0,
  drawSpeed: 30, lingerMs: 12000,
};
