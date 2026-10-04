/**
 * Chuni's Wall as a two-level scene (Foundry v14 Scene Levels), traced from the author's map at 100 px a square.
 *
 * - **Ground** (0–40ft): the wall, the ballista tower and the gatehouse are solid stone. Walls trace their outer faces and
 *   block sight and movement, so a creature on the ground can't see or walk through the wall. The front gate is a
 *   locked door. Tents block sight and movement; fences and the palisade stakes block movement only.
 * - **Wall Top** (40ft and up): the walkway, the tower top and the gatehouse are the floor. Their parapets block
 *   movement but not sight, so the defenders see everything below. The parapet has gaps over the hay and the tents
 *   (to jump down) and at the stairs.
 *
 * Coordinates are map pixels. Each run of points is a polyline of wall segments. The wall's faces are split at every
 * 100 px grid line, so the Breach macro can remove exactly the squares the demon smashes through.
 */

// The wall body's outer faces on the ground, and the walkway's inner edges on top.
export const WALL = { north: 1585, south: 1915, topNorth: 1625, topSouth: 1870, gate: [925, 1425] };

const SENSE = { none: 0, normal: 20 };
/** Restrictions by kind: stone and tents block everything, parapets/fences/stakes only movement. */
export const KINDS = {
  stone: { light: SENSE.normal, sight: SENSE.normal, sound: SENSE.normal, move: SENSE.normal },
  tent: { light: SENSE.normal, sight: SENSE.normal, sound: SENSE.none, move: SENSE.normal },
  low: { light: SENSE.none, sight: SENSE.none, sound: SENSE.none, move: SENSE.normal },
};

/** Split the horizontal run x0→x1 at y into segments that break at every grid line. */
function face(x0, x1, y) {
  const xs = [x0];
  for (let x = Math.floor(x0 / 100) * 100 + 100; x < x1; x += 100) xs.push(x);
  xs.push(x1);
  return xs.slice(1).map((x, i) => [[xs[i], y], [x, y]]);
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

/** Ground-level walls: `{ kind, points, door?, breach? }`; `breach` marks the wall body's faces. */
export const GROUND_WALLS = [
  // North face, west of the tower corridor; the corridor and tower; the face east to the gate passage.
  ...face(0, 200, WALL.north).map((points) => ({ kind: 'stone', points, breach: true })),
  { kind: 'stone', points: [[200, WALL.north], [200, 1105], [115, 1105], [115, 570], [670, 570], [670, 1105], [585, 1105], [585, WALL.north]] },
  ...face(585, WALL.gate[0], WALL.north).map((points) => ({ kind: 'stone', points, breach: true })),
  // The gate passage through the wall, closed by the locked front gate.
  { kind: 'stone', points: [[WALL.gate[0], WALL.north], [WALL.gate[0], WALL.south]], breach: true },
  { kind: 'stone', points: [[WALL.gate[1], WALL.north], [WALL.gate[1], WALL.south]], breach: true },
  { kind: 'stone', points: [[WALL.gate[0], 1750], [WALL.gate[1], 1750]], door: true, breach: true },
  // North face east of the gate, and the gatehouse.
  ...face(WALL.gate[1], 1825, WALL.north).map((points) => ({ kind: 'stone', points, breach: true })),
  { kind: 'stone', points: [[1825, WALL.north], [1825, 1430], [2000, 1430]] },
  // South face (the stairs climb against it east of x 1590), and the gatehouse.
  ...face(0, WALL.gate[0], WALL.south).map((points) => ({ kind: 'stone', points, breach: true })),
  ...face(WALL.gate[1], 1830, WALL.south).map((points) => ({ kind: 'stone', points, breach: true })),
  { kind: 'stone', points: [[1830, WALL.south], [1830, 2060], [2000, 2060]] },
  // Tents.
  { kind: 'tent', points: rect(70, 1980, 290, 2290) },
  { kind: 'tent', points: rect(425, 1980, 640, 2290) },
  { kind: 'tent', points: rect(55, 2520, 285, 2850) },
  { kind: 'tent', points: rect(415, 2520, 640, 2850) },
  { kind: 'tent', points: rect(1440, 3000, 1665, 3260) },
  // Fences around the camp (the road runs between them) and the palisade stakes north of the wall.
  { kind: 'low', points: [[0, 2940], [330, 2950], [575, 3320], [1010, 3330]] },
  { kind: 'low', points: [[1960, 2050], [1960, 2900], [1780, 3300], [1320, 3300]] },
  { kind: 'low', points: [[670, 625], [940, 625]] },
  { kind: 'low', points: [[1350, 620], [1630, 625], [1760, 655], [1880, 695], [2000, 735]] },
];

/** Wall-top parapets (movement only), with gaps over the tents (x 0–660), the hay (1400–1590) and the stairs. */
export const TOP_WALLS = [
  { kind: 'low', points: [[0, WALL.topNorth], [245, WALL.topNorth], [245, 1080], [175, 1080], [175, 625], [605, 625], [605, 1080], [535, 1080],
    [535, WALL.topNorth], [1840, WALL.topNorth], [1840, 1500], [2000, 1500]] },
  { kind: 'low', points: [[660, WALL.topSouth], [1400, WALL.topSouth]] },
  { kind: 'low', points: [[1830, WALL.topSouth], [1830, 2040], [2000, 2040]] },
];

/** Change Level regions (map px rectangles): the stairs for any movement, the hay and tents for jumping down. */
export const LEVEL_CHANGES = [
  { key: 'stairs', name: 'Stairs', rect: [1590, 1870, 1830, 2510], actions: [] },
  { key: 'jump-tents', name: 'Jump onto the Tents', rect: [0, WALL.south, 660, 2300], actions: ['jump'] },
  { key: 'jump-hay', name: 'Jump into the Hay', rect: [1400, WALL.south, 1590, 2540], actions: ['jump'] },
];

/**
 * Night on the wall: the Tianqi glyphs that ward the wall glow blue along its north face (rulebook v1.2 p.59: "The wall
 * thrums with blue sigils of light"), torches burn on the wall top (v1.2 torch: 10ft bright, 20ft dim), and lanterns
 * hang in the camp. Map pixels; `top` lights belong to the Wall Top level, the rest to every level.
 */
export const LIGHTS = [
  // Glyphs on the north face of the wall and the tower.
  ...[80, 760, 1000, 1350, 1650].map((x) => ({ kind: 'glyph', at: [x, WALL.north - 25] })),
  { kind: 'glyph', at: [390, 545] },
  { kind: 'glyph', at: [1950, 1405] },
  // Torches on the wall top: the tower corners, the walkway by the oil barrels, the stair head and the gatehouse.
  { kind: 'torch', at: [200, 650], top: true },
  { kind: 'torch', at: [580, 650], top: true },
  { kind: 'torch', at: [420, 1700], top: true },
  { kind: 'torch', at: [1200, 1700], top: true },
  { kind: 'torch', at: [1560, 1820], top: true },
  { kind: 'torch', at: [1930, 1560], top: true },
  // Lanterns in the camp: between the tents, at the long table, at the white tent.
  { kind: 'lantern', at: [360, 2410] },
  { kind: 'lantern', at: [860, 3100] },
  { kind: 'lantern', at: [1550, 2960] },
];

export const LIGHT_KINDS = {
  glyph: { color: '#4fb0ff', bright: 5, dim: 30, alpha: 0.6, luminosity: 0.45, attenuation: 0.6, animation: { type: 'pulse', speed: 2, intensity: 3 } },
  torch: { color: '#ff9b4a', bright: 10, dim: 20, alpha: 0.5, luminosity: 0.5, attenuation: 0.5, animation: { type: 'torch', speed: 5, intensity: 5 } },
  lantern: { color: '#ffc46b', bright: 10, dim: 20, alpha: 0.5, luminosity: 0.55, attenuation: 0.6, animation: { type: 'flame', speed: 3, intensity: 3 } },
};

/** Where the fog lifts: everything south of the wall's north face (the wall holds the mist of the Upper Heibrim back). */
export const CLEAR_OF_FOG = [0, WALL.north, 2000, 4800];
/** The fog line north of the wall where Wanabbul first looms into view (rows 5–6). */
export const FOG_LINE = [0, 500, 2000, 700];
