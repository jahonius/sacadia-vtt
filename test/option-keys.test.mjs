import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BOOST_SPECIAL_KEYS, SAVE_EXT_KEYS } from "../module/helpers/option-keys.mjs";

const root = new URL("..", import.meta.url).pathname;
const packs = fs.readdirSync(path.join(root, "src/packs")).flatMap((d) => fs.readdirSync(path.join(root, "src/packs", d))
  .filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(root, "src/packs", d, f), "utf8"))));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name))
  : e.name.endsWith(".mjs") && e.name !== "option-keys.mjs" ? [fs.readFileSync(path.join(dir, e.name), "utf8")] : []));
const code = walk(path.join(root, "module")).join("\n");

function usedKeys() {
  const special = new Set();
  const ext = new Set();
  const visit = (o) => {
    if (Array.isArray(o)) return o.forEach(visit);
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if ((k === "ext" || k === "saveExt") && v && typeof v === "object") for (const kk of Object.keys(v)) ext.add(kk);
      visit(v);
    }
  };
  for (const item of packs) {
    for (const k of Object.keys(item.system?.boost?.special ?? {})) special.add(k);
    visit(item.system);
  }
  return { special, ext };
}

test("option keys: every boost.special / save.ext key the packs use is registered (a typo or an unlisted key fails)", () => {
  const { special, ext } = usedKeys();
  for (const k of special) assert.ok(k in BOOST_SPECIAL_KEYS, `boost.special.${k} isn't in BOOST_SPECIAL_KEYS`);
  for (const k of ext) assert.ok(k in SAVE_EXT_KEYS, `save.ext.${k} isn't in SAVE_EXT_KEYS`);
});

test("option keys: every registered key is read by the runtime (no dead options)", () => {
  for (const k of [...Object.keys(BOOST_SPECIAL_KEYS), ...Object.keys(SAVE_EXT_KEYS)]) {
    assert.ok(new RegExp(`\\.${k}\\b|\\['${k}'\\]`).test(code), `${k} is never read`);
  }
});
