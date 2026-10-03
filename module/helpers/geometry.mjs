/**
 * Pure positional geometry — no Foundry/canvas dependencies, so it's unit-testable. Operates on plain
 * `{x, y}` points (pixel or grid coordinates; only relative angles matter). The token-gathering and
 * grid-distance measurement live in the sheet; this module answers the geometric questions.
 */

/** Angle in degrees (−180..180) from `from` to `to`, screen coordinates (y grows downward — fine, we
 *  only ever compare relative angles / gaps, which are orientation-invariant). */
export function angleDeg(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/**
 * Largest angular gap (degrees) between a set of directions around a center, treating the circle as
 * cyclic. An empty set is one 360° gap. Used by {@link isSurrounded}: enemies all fit within some
 * half-plane iff their largest mutual gap is ≥ 180°.
 * @param {number[]} anglesDeg  Angles in degrees (any range; normalized internally).
 * @returns {number} the maximum gap in degrees (0..360).
 */
export function largestGapDegrees(anglesDeg) {
  if (!anglesDeg?.length) return 360;
  const a = anglesDeg.map((x) => ((x % 360) + 360) % 360).sort((p, q) => p - q);
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const next = i + 1 < a.length ? a[i + 1] : a[0] + 360; // wrap the last→first gap
    max = Math.max(max, next - a[i]);
  }
  return max;
}

/**
 * Whether a defender at `center` is **Surrounded** by the given threatening-enemy points (book p.256):
 * a defender is Surrounded when no 180° sightline (half-plane) through their center can contain all
 * threatening enemies. Enemies fit within a half-plane iff their largest angular gap is ≥ 180° — so
 * Surrounded ⟺ the largest gap is strictly < 180° (centers exactly on the sightline count as within,
 * hence a 180° gap is *not* Surrounded). Two or fewer enemies always leave a ≥ 180° gap.
 * @param {{x:number,y:number}} center
 * @param {{x:number,y:number}[]} points  Threatening enemies' centers (caller filters to reach/adjacency).
 * @returns {boolean}
 */
export function isSurrounded(center, points) {
  if (!points || points.length < 3) return false;
  return largestGapDegrees(points.map((p) => angleDeg(center, p))) < 180;
}
