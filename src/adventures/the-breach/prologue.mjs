/**
 * The prologue's world map: the rulebook's "Civilizations of the Ardus Yauga" (v1.2 PDF p.26, resampled ×2 by
 * tools/ardus-yauga-asset.mjs). Its scale, the places on it, the two routes Indy Route plays on it, the Augur: Nexus site
 * that opens the battle map, and Sacadia's land travel speeds for Indy Route's travel-time tooltips. Coordinates are
 * pixels on the 2160 × 1754 map (the scene has no padding, so they're canvas coordinates too).
 *
 * Scale: the rulebook map has none. It's taken as 1 km per pixel of the rulebook's 1080-pixel map, so 2 px per km here.
 * Chuni's Wall then runs about 100 km between the Lake of Western Lights and the Lake of the Jiangshi, and the road from
 * Tianois to the wall is about 140 km (35 travel hexes of 4 km, rulebook v1.2 p.294). Change PX_PER_KM to rescale.
 */

export const WORLD = { file: 'ardus-yauga.webp', thumb: 'ardus-yauga-thumb.webp', width: 2160, height: 1754 };

export const PX_PER_KM = 2;
const MI_PER_KM = 0.621371;
/** The scene is gridless, but measurement still uses the grid: 100 px is 50 km. Indy Route reads distances as miles. */
export const GRID = { size: 100, miles: Math.round((100 / PX_PER_KM) * MI_PER_KM * 100) / 100 };

/** Where Augur: Nexus puts the Chuni's Wall site: the wall's eastern fort, above Low Ballom, where the road meets it. */
export const WALL_FORT = [1622, 362];

/**
 * The road to the wall: the dotted road north from Tianois, past Valli Falls, to Low Ballom and the wall's eastern fort.
 * The newest wall guard (Selthimor) rides it to his post.
 */
export const ROAD = [[1770, 618], [1749, 588], [1735, 560], [1727, 532], [1714, 503], [1697, 478], [1671, 458], [1652, 432], [1638, 400], [1624, 370]];

/** The alarm: smoke rising from fort to fort along the wall, from the eastern fort west to the towers above Kjerst. */
export const SMOKE = [[1622, 366], [1590, 371], [1556, 368], [1522, 360], [1494, 350], [1470, 340]];

/**
 * Sacadia's base land travel speeds (rulebook v1.2 p.287: hexes a day, off roads / dirt roads / stone roads), as Indy
 * Route travel modes. A hex is about 4 km. The rulebook gives no hours on the road a day; 8 are assumed for part days.
 */
const SPEEDS = [
  ['foot', 'On foot', [3, 4, 5]],
  ['light-mount', 'Light mount', [5, 6, 7]],
  ['wagon', 'Wagon', [3, 4, 5]],
  ['heavy-cart', 'Heavy cart', [1, 2, 3]],
  ['mount-relay', 'Mount relay', [8, 10, 12]],
];
const ROADS = [['off-road', 'off roads'], ['dirt-road', 'dirt road'], ['stone-road', 'stone road']];
export const TRAVEL_MODES = SPEEDS.flatMap(([key, label, hexes]) => ROADS.map(([road, roadLabel], i) => {
  const perDayMiles = Math.round(hexes[i] * 4 * MI_PER_KM * 100) / 100;
  return { id: `sacadia-${key}-${road}`, label: `${label}, ${roadLabel} (Sacadia: ${hexes[i]} hexes/day)`, speedMph: Math.round((perDayMiles / 8) * 100) / 100, perDayMiles };
}));

/**
 * Indy Route styles, set outright (not scaled to the view) so every table sees the same lines. The camera's zoom is
 * (2 × the screen's size ÷ the route's length) × cameraZoomFactor: these keep it under about 2×, as far as this map's
 * resolution goes.
 */
const LINE = {
  scaleWithMap: false, scaleMultiplier: 1, lineAlpha: 0.9, dashLength: 0, gapLength: 0,
  labelFontFamily: 'Alegreya, serif', labelFollowPath: true, labelPosition: 50,
  renderAboveTokens: true, routeSound: '', travelFareTier: 'standard', lingerMs: -1, sampleStepPx: 3,
  introMs: 2000, pauseMs: 1200, cameraSmooth: 0.12, tokenUpdateMs: 25,
  smoothingMode: 'catmull', catmullSamplesPerSegment: 16, catmullAlpha: 0.5,
};
export const ROAD_STYLE = {
  ...LINE, lineColor: '#9a1c14', lineWidth: 6, showLabel: true, labelColor: '#5c100b', labelFontSize: 16, labelOffset: 16,
  labelShowArrow: true, cinematicMovement: true, cameraZoomFactor: 0.15, showEndX: true, showDot: true, dotColor: '#f7f0e6', dotRadius: 9, dotTokenRotate: false, dotTokenScale: 1.6,
  dotTokenRotateOffset: 0, drawSpeed: 40, travelMode: 'sacadia-foot-dirt-road',
};
export const SMOKE_STYLE = {
  ...LINE, lineColor: '#3b3b3b', lineAlpha: 0.75, lineWidth: 5, dashLength: 10, gapLength: 8, showLabel: true, labelColor: '#262626',
  labelFontSize: 14, labelShowArrow: false, labelOffset: -14, cinematicMovement: true, cameraZoomFactor: 0.09, showEndX: false, showDot: false, dotColor: '#d9d9d9',
  dotRadius: 6, dotTokenUuid: '', dotTokenRotate: false, dotTokenScale: 1, dotTokenRotateOffset: 0, drawSpeed: 30, travelMode: 'none',
};
