/**
 * Sacadia's travel rules (rulebook v1.2 pp.284–298), as pure functions the Travel Ledger (apps/travel-ledger.mjs) runs a
 * day at a time. Foundry-free, so they're unit-tested.
 *
 * A day: the method of travel and the road give the base hexes (p.287); the pace adds or takes one (p.286); weather and
 * terrain slow it (p.292: −1 storms and rain, fog, hills, forests; −2 snow or heavy rainfall, jungle, mountain passes; −3
 * blizzards, swamps). At 0 or less the party is stuck in its hex (p.295). A laden wagon or heavy cart moves at half speed,
 * rounded up (p.297). A hex is about 4 km (p.294).
 */

export const HEX_KM = 4;
const MI_PER_KM = 0.621371;

/** Base land travel, hexes a day by road (p.287), and supply (p.288): what it carries, its overladen limit, and what its
 *  mounts eat a day (a set of mounts, 1 food and 1 water). Mount relays aren't in the supply table: they carry a mount's
 *  load, and eat as one set. */
export const METHODS = {
  foot: { hexes: { offRoad: 3, dirtRoad: 4, stoneRoad: 5 }, maxSupply: 5, overladen: 6, mounts: 0, label: 'SACADIA.Travel.Method.Foot' },
  lightMount: { hexes: { offRoad: 5, dirtRoad: 6, stoneRoad: 7 }, maxSupply: 10, overladen: 12, mounts: 1, label: 'SACADIA.Travel.Method.LightMount' },
  wagon: { hexes: { offRoad: 3, dirtRoad: 4, stoneRoad: 5 }, maxSupply: 40, overladen: 48, mounts: 1, cart: true, label: 'SACADIA.Travel.Method.Wagon' },
  heavyCart: { hexes: { offRoad: 1, dirtRoad: 2, stoneRoad: 3 }, maxSupply: 160, overladen: 200, mounts: 1, cart: true, label: 'SACADIA.Travel.Method.HeavyCart' },
  mountRelay: { hexes: { offRoad: 8, dirtRoad: 10, stoneRoad: 12 }, maxSupply: 10, overladen: 12, mounts: 1, label: 'SACADIA.Travel.Method.MountRelay' },
};
export const ROADS = { offRoad: 'SACADIA.Travel.Road.OffRoad', dirtRoad: 'SACADIA.Travel.Road.DirtRoad', stoneRoad: 'SACADIA.Travel.Road.StoneRoad' };

/** Pace (p.286): pushing it is a hex faster and costs a supply more; slow is a hex slower and sees a hex further (p.295). */
export const PACES = {
  slow: { hexes: -1, supply: 0, sightlines: 4, label: 'SACADIA.Travel.Pace.Slow' },
  normal: { hexes: 0, supply: 0, sightlines: 3, label: 'SACADIA.Travel.Pace.Normal' },
  fast: { hexes: 1, supply: 1, sightlines: 2, label: 'SACADIA.Travel.Pace.Fast' },
};

/** What slows a day (p.292), weather and terrain each. */
export const WEATHER = { 0: 'SACADIA.Travel.Weather.Clear', '-1': 'SACADIA.Travel.Weather.Rain', '-2': 'SACADIA.Travel.Weather.Snow', '-3': 'SACADIA.Travel.Weather.Blizzard' };
export const TERRAIN = { 0: 'SACADIA.Travel.Terrain.Open', '-1': 'SACADIA.Travel.Terrain.Hills', '-2': 'SACADIA.Travel.Terrain.Jungle', '-3': 'SACADIA.Travel.Terrain.Swamp' };

/** The day's Check DC for travel roles (p.293). */
export const DIFFICULTY = { simple: 12, easy: 16, medium: 20, hard: 24, extreme: 28 };

/** Is the party's cart or wagon laden: carrying more supply than it holds (p.297)? */
export function isLaden(method, supply) {
  const m = METHODS[method];
  return !!m?.cart && supply > m.maxSupply;
}

/**
 * The hexes a day's travel covers.
 * @param {{method: string, road: string, pace?: string, weather?: number, terrain?: number, supply?: number}} day
 * @returns {number} 0 when the party is stuck
 */
export function dailyHexes({ method, road, pace = 'normal', weather = 0, terrain = 0, supply = 0 }) {
  const m = METHODS[method];
  if (!m) return 0;
  let hexes = (m.hexes[road] ?? m.hexes.offRoad) + (PACES[pace]?.hexes ?? 0);
  if (isLaden(method, supply)) hexes = Math.ceil(hexes / 2);
  return Math.max(0, hexes + Number(weather || 0) + Number(terrain || 0));
}

/**
 * What a day eats (p.288): the party 1 food and 1 water, each set of mounts as much again, one more of each when pushing
 * it, and no water along fresh water.
 * @returns {{food: number, water: number}}
 */
export function dailySupply({ method, pace = 'normal', freshWater = false }) {
  const each = 1 + (METHODS[method]?.mounts ?? 0) + (PACES[pace]?.supply ?? 0);
  return { food: each, water: freshWater ? 0 : each };
}

/**
 * Canvas pixels in one hex, from the scene's grid: a scene measured in miles or km converts; any other unit counts one
 * grid space as one hex.
 */
export function pxPerHex({ size, distance, units }) {
  const u = String(units ?? '').toLowerCase();
  if (/^(mi|mile|miles)$/.test(u)) return (HEX_KM * MI_PER_KM / distance) * size;
  if (/^(km|kilometers?|kilometres?)$/.test(u)) return (HEX_KM / distance) * size;
  return size;
}

/** A polyline's total length. */
export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/** The point `at` along a polyline. */
export function pointAt(points, at) {
  let left = Math.max(0, at);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) {
      const t = len ? left / len : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return { ...points[points.length - 1] };
}

/** The stretch of a polyline between two distances along it: its two ends and the corners between. */
export function subpath(points, from, to) {
  const out = [pointAt(points, from)];
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    at += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (at > from && at < to) out.push({ ...points[i] });
  }
  out.push(pointAt(points, to));
  return out;
}
