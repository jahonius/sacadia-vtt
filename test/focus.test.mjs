import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFocus, focusTeardown } from "../module/helpers/focus.mjs";

test("focus: a Focus is live while its streak is positive", () => {
  assert.deepEqual([...liveFocus({ a: 2, b: 0, c: 1 })].sort(), ["a", "c"]);
  assert.equal(liveFocus(undefined).size, 0);
});

test("focus: ending a Focus removes its anchor, its mark and its target set — and nothing of a live one", () => {
  const out = focusTeardown({
    focusRounds: { bane: 2 },
    anchors: [{ id: "e1", ability: "bane" }, { id: "e2", ability: "shield_transference" }],
    markKeys: { bane: "baned", shield_transference: "shielded" },
    marks: { baned: ["t1"], shielded: ["t2"] },
    focusTargets: { bane: ["t1"], barbed_stare: ["t3"] },
  });
  assert.deepEqual(out.anchorIds, ["e2"]);
  assert.deepEqual(out.dropMarks, ["shielded"]);
  assert.deepEqual(out.dropTargets, ["barbed_stare"]);
});

test("focus: with every Focus dropped (going Insane), everything hanging off them goes", () => {
  const out = focusTeardown({ focusRounds: {}, anchors: [{ id: "e1", ability: "x" }], markKeys: { x: "m" }, marks: { m: [] }, focusTargets: {} });
  assert.deepEqual(out, { anchorIds: ["e1"], dropMarks: ["m"], dropTargets: [] });
});
