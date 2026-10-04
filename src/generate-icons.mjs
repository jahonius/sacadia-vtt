/**
 * Generate ability icons with the Gemini image API. Covers the ability packs (abilities-*), the profession features and
 * the basic actions, reading each item's name and description from src/packs/<pack>/*.json.
 *
 * The model draws only a frameless, action-focused illustration; the gold frame from src/icon_template.jpg is laid over
 * it on export (src/icon-frame.mjs), so every frame is identical and the art snaps to the frame's pixel grid. The
 * illustration is kept as the full-size original, art/icons/<group>/<id>_art.png (local only, gitignored; back it up),
 * and the framed 256 px WebP goes to assets/icons/abilities/<group>/, which the system uses (locations in
 * src/icons.mjs). Run `npm run build:packs` afterwards so the compendium items point at their icons. HINTS below says
 * what to draw for abilities whose text alone misleads the model.
 *
 * COST SAFETY: skips items that already have an icon, caps each run at --limit images (default 5), refuses to start if
 * the estimate exceeds --max-cost (default $2), stops when the running estimate reaches it, and asks for a typed "yes".
 * Use --dry-run to preview the plan and the estimated spend with no API calls.
 *
 * Setup: the API key comes from GEMINI_API_KEY (or GOOGLE_API_KEY), else the file ~/.config/sacadia/gemini-api-key.
 * Usage:  node src/generate-icons.mjs --group=magus --dry-run
 *         node src/generate-icons.mjs --group=magus --limit=10 --max-cost=1
 *         node src/generate-icons.mjs --only=black_rebuke,bloodlet --force --yes
 *         node src/generate-icons.mjs --export          # rebuild the framed 256 px WebPs from the originals (no API calls)
 *
 * Flags:
 *   --group=<name>       one icon group (oracle, soldier, magus, lore, profession-features, basic-actions, …); omit for
 *                        all. (--profession is an alias.)
 *   --only=<id,id,…>     only these catalog ids
 *   --skip=<id,id,…>     leave these catalog ids alone (with --force: keep icons you've approved)
 *   --refs=<path,path>   icons whose art sets the pixel style (default: STYLE_REFS below, the same for every group, so a
 *                        class's existing icons don't keep repeating their subject); framed icons are cropped to their art
 *   --limit=<N>          max images this run (default 5): the primary throttle
 *   --max-cost=<$>       refuse to start above this estimate, and stop once the running estimate reaches it (default 2)
 *   --force              regenerate even if an icon exists; the replaced original is kept in art/icons/.replaced/
 *                        (with --export: re-export every WebP)
 *   --dry-run            print the plan and the estimate; no API calls
 *   --yes                skip the confirmation prompt (unattended runs)
 *   --delay=<ms>         pause between images (default 1500)
 *   --model=<name>       the image model (default GEMINI_IMAGE_MODEL or gemini-2.5-flash-image)
 *
 * The per-image price is an ESTIMATE (ICON_COST_PER_IMAGE, default $0.04); the real guardrails are --limit and
 * --max-cost.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import sharp from 'sharp';
import { ROOT, ORIGINALS_DIR, SHIPPED_DIR, ICON_SIZE, WEBP_QUALITY, hasIcons, iconGroup, iconPattern, shippedName } from './icons.mjs';
import { framedIcon, innerArt, regridded } from './icon-frame.mjs';

const SRC_PACKS = path.join(ROOT, 'src', 'packs');
const KEY_FILE = path.join(os.homedir(), '.config', 'sacadia', 'gemini-api-key');
const COST_PER_IMAGE = Number(process.env.ICON_COST_PER_IMAGE || 0.04);
/**
 * Art sent with every request to set the pixel-art technique (the prompt says to take nothing else from it): the art
 * from inside two early Oracle icons, Mad Smear and A Boiled Leech, kept in src/icon-style/ (bold single subjects, no
 * weapons or figures to copy).
 */
const STYLE_REFS = ['src/icon-style/mad_smear_art.png', 'src/icon-style/a_boiled_leech_art.png'];

function apiKey() {
  const env = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (env) return env.trim();
  return fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, 'utf8').trim() : '';
}

/** Parse `--k=v` / `--flag` argv into an object. */
function parseArgs(argv) {
  const a = {};
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (m) a[m[1]] = m[2] ?? true;
  }
  return a;
}

/**
 * The world every icon belongs to. Sacadia is Bronze Age (the rulebook: "bronze age farmlands", "the smelting of bronze
 * and more recently iron weapons"); left to itself the model draws medieval knights and castles.
 */
const SETTING = [
  'Sacadia is a Bronze Age fantasy world (bronze, and only recently iron).',
  'Arms and armor are bronze, hide, leather, fur, bone, feathers, quilted linen and dyed cloth: bronze scales or plates over',
  'cloth, round hide, wicker or wooden shields, open or crested bronze helmets; spears, curved bronze blades, axes, clubs,',
  'slings and composite bows. Its peoples come from many ancient cultures, beast-folk among them.',
  'Nothing medieval: no full plate armor, knights, chainmail, great helms, castles, gothic stonework or heraldry.',
].join(' ');

/**
 * A class's mood and accent colors. Only mood and color: anything concrete here (a place, a crowd, a signature prop)
 * ends up painted into every icon of the class, like the Bladedancer's market street and the Sentinel's bow did.
 */
const FANTASY = {
  oracle: 'eerie and unsettling, prophecy and madness; accents of sickly green, violet and blood red.',
  soldier: 'steadfast and disciplined; accents of bronze, deep red and royal blue.',
  sentinel: "patient and precise, a hunter's focus; accents of forest green, amber and sky blue.",
  bladedancer: 'quick, graceful and showy; accents of teal, crimson and flashing silver.',
  thug: 'brutal and heavy; accents of rust, sweaty gold and bruised purple.',
  fatebound: 'serene and fated; accents of pale blue, silver and white light.',
  hulinari: 'wild and primal, beast-folk; accents of earth brown, moss green and amber.',
  magus: 'scholarly and arcane; accents of ink black, parchment and glowing gold.',
  witch: 'earthy and uncanny; accents of herb green, smoke grey and candle orange.',
  general: 'grounded and practical, battle-tested.',
  masteries: 'climactic and powerful, a pinnacle of skill; radiant accents.',
  lore: 'ancestral and legendary, an old tale come alive.',
  'basic-actions': 'plain, clear and readable at a glance.',
};
/** Magus tomes and Witch schools (an item's meta.subpath): what their spells look like. */
const SCHOOLS = {
  'Blood Tome': 'Blood Tome magic: blood and necromancy, hemorrhage, vampiric siphoning, life drained and passed on, bone, rot and crimson sigils.',
  'Contract Tome': 'Contract Tome magic: lawful pacts and binding contracts, wax seals, golden scroll rods, missives, luck and order, warding shields.',
  'Elder Tome': 'Elder Tome magic: ancient beast-lore and mind magic, runic scars, hexes, barbed curses and glares, madness, tarnished bronze.',
  'Calming Hands': 'Calming Hands: divine touches that heal and harm, flame and frost, toxins turned to tonics, gifts that bloom.',
  Promise: 'Promises: binding oaths and vows of vengeance, justice and nonviolence, hallowed touches, atonement.',
  Wellspring: 'Wellspring: the living wild turned weapon, razor leaves, pine needles, lodestone shards, grasses, flowers and roots.',
  Balancer: 'Balancer: luck and balance, three-, four- and seven-leaf charms, molds and mushrooms, healing hands, give and take.',
  Conditionmaker: 'Conditionmaker: hexing touches that inflict ailments, bleeding, clumsiness, sickness, corrosive burns, cicadas, delirium, fool\'s gold.',
};
/**
 * What to draw, for abilities whose text alone leads the model astray (a symbol instead of the action, the bow instead of
 * the arrow). Add to it freely, then regenerate with --only=<id> --force.
 */
const HINTS = {
  basic_block: 'a raised round shield catching a sword blow, sparks flying off its rim',
  covering_fire: 'a hail of arrows streaking low over a crouching ally, driving back the enemies beyond',
  curving_shots: 'a single arrow curving sharply around the corner of a stone wall',
  predator_and_prey: 'two scorpions striking each other with their stingers at the same instant',
  mg_clotsnipe: 'a lance of dark, clotted blood shooting in a straight line and piercing through a row of shadowy figures',
};
const PROFESSION_LABELS = { bladedancer: 'Bladedancer', fatebound: 'Fatebound', hulinari: 'Hulinari Warrior', oracle: 'Oracle',
  sentinel: 'Sentinel', soldier: 'Soldier', thug: 'Thug', magus: 'Magus', witch: 'Witch' };

/** The class look for an item: its group's, or for a profession feature its profession's, or for Lore its section's. */
function fantasyFor(group, doc) {
  if (group === 'profession-features') return FANTASY[(doc.system?.meta?.profession ?? '').replace(/_warrior$/, '')] ?? FANTASY.general;
  if (group === 'lore') {
    const section = doc.system?.meta?.subpath ?? '';
    const prof = Object.keys(PROFESSION_LABELS).find((k) => section.startsWith(PROFESSION_LABELS[k].split(' ')[0]));
    return prof ? `${FANTASY.lore} ${FANTASY[prof]}` : FANTASY.lore;
  }
  const school = SCHOOLS[doc.system?.meta?.subpath ?? ''];
  return school ? `${FANTASY[group]} ${school}` : (FANTASY[group] ?? FANTASY.general);
}

/** Strip HTML tags/entities to plain text for the prompt. */
function plain(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** An ability's text for the prompt, without the dice talk that makes the model draw dice ("1D6", "dice type", "roll"). */
function forPrompt(html) {
  return plain(html)
    .replace(/\b(\d+|[XYM])?\s*D\d+(\s*[+-]\s*\w+)?/gi, '')
    .replace(/\b(by )?(one |two |\d+ )?(additional )?dice types?\b/gi, 'power')
    .replace(/\b(dice|die)\b/gi, '')
    .replace(/\broll(s|ed|ing)?\b/gi, 'make')
    .replace(/\s+([,.;)])/g, '$1').replace(/\s+/g, ' ').trim();
}

/** The image prompt. When `hasRefs`, the attached images show the target pixel-art technique (nothing else to copy). */
function buildPrompt(a, hasRefs) {
  const text = forPrompt(a.description).slice(0, 400);
  return [
    'Draw a square fantasy RPG ability icon illustration in chunky, low-resolution pixel art: the whole square is only about',
    '80 art pixels wide, each art pixel a solid square block, with no detail finer than one block. Draw NO frame, NO border and NO',
    'circle: a frame is added afterwards and the picture is cropped to a circle, so keep the subject centered and entirely',
    'inside the middle 75% of the square.',
    hasRefs ? 'The attached images show the target pixel-art technique. Copy ONLY that technique (chunky pixels, shading, dark outlines), never their colors, subjects or composition.' : '',
    `The ability is "${a.name}".`,
    'Show it as a clear, dynamic ACTION at the moment it happens, through the key thing that acts: a blade, a fist, a foot, a',
    'projectile, a shield, a spell or a creature, drawn large and close up so it fills most of the picture. One bold,',
    'unmistakable subject with a strong silhouette and high contrast, readable at 32×32 pixels. Show at most one figure, and',
    'only when the whole body is the point; never a crowd, and never the stock image of a warrior posing with a weapon. Draw',
    'real things, never symbols, diagrams or geometric shapes standing in for them.',
    'For shooting abilities, show the projectile (the arrow, bolt or stone) in flight or striking, not the bow or sling,',
    'unless the ability is about the weapon itself.',
    'Background: a plain color, a soft glow, smoke or a simple abstract swirl. NO scenery: no buildings, streets, markets,',
    'walls, crowds, landscapes or skies.',
    `Setting, for what things look like: ${SETTING}`,
    a.hint ? `Draw this: ${a.hint}.` : '',
    a.fantasy ? `Mood and accent colors only (not the subject): ${a.fantasy}` : '',
    'Use whatever colors suit this ability, vivid and saturated where it fits; avoid a uniform brown or sepia wash.',
    'Never draw dice, cards, game pieces, numbers, text, letters, runes that read as writing, or UI.',
    text ? `What the ability does: ${text}` : '',
  ].filter(Boolean).join(' ');
}

/** A PNG buffer as a Gemini inline_data part. */
const pngPart = (buffer) => ({ inline_data: { mime_type: 'image/png', data: buffer.toString('base64') } });
const isArt = (file) => /_art\.(png|jpe?g)$/i.test(file);

const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

/** {group, catalogId, name, description, fantasy, exists} for every item in the icon packs. */
function collectItems(args) {
  const wantGroup = args.group || args.profession || args.prof;
  const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;
  const skip = new Set(args.skip ? String(args.skip).split(',').map((s) => s.trim()) : []);
  const out = [];
  for (const pack of fs.readdirSync(SRC_PACKS).filter(hasIcons).sort()) {
    const group = iconGroup(pack);
    if (wantGroup && group !== wantGroup) continue;
    const originals = listDir(path.join(ORIGINALS_DIR, group));
    const shipped = listDir(path.join(SHIPPED_DIR, group));
    for (const file of fs.readdirSync(path.join(SRC_PACKS, pack)).filter((f) => f.endsWith('.json')).sort()) {
      const doc = JSON.parse(fs.readFileSync(path.join(SRC_PACKS, pack, file), 'utf8'));
      const catalogId = doc.flags?.sacadia?.catalogId ?? path.basename(file, '.json');
      if ((only && !only.has(catalogId)) || skip.has(catalogId)) continue;
      const exists = [...originals, ...shipped].some((f) => iconPattern(catalogId).test(f));
      out.push({ group, catalogId, name: doc.name, description: doc.system?.description, fantasy: fantasyFor(group, doc),
        hint: HINTS[catalogId] ?? '', exists });
    }
  }
  return out;
}

/**
 * Write the 256 px WebP the system uses, from an original: a frameless illustration gets the frame, an older framed one
 * is put on the frame's pixel grid (both in src/icon-frame.mjs). Pixel art stays crisp only with nearest-neighbour
 * shrinking, and with smartSubsample (WebP otherwise smears colored edges).
 */
async function exportIcon(group, id, originalPath) {
  const dir = path.join(SHIPPED_DIR, group);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, shippedName(id));
  const full = isArt(originalPath) ? await framedIcon(originalPath) : await regridded(originalPath);
  await sharp(full).resize(ICON_SIZE, ICON_SIZE, { kernel: 'nearest' }).webp({ quality: WEBP_QUALITY, smartSubsample: true }).toFile(dest);
  return dest;
}

/** `--export`: (re)write the shipped WebP for every original that lacks one (all of them with --force). */
async function exportAll(args) {
  let done = 0;
  for (const group of listDir(ORIGINALS_DIR).filter((g) => !g.startsWith('.')).sort()) {
    if (args.group && group !== args.group) continue;
    // One original per id; a frameless illustration wins over an older framed one.
    const byId = new Map();
    for (const file of listDir(path.join(ORIGINALS_DIR, group)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort()) {
      const id = file.replace(/(_icon|_art)?\.(png|jpe?g)$/i, '');
      if (!byId.has(id) || isArt(file)) byId.set(id, file);
    }
    for (const [id, file] of byId) {
      if (!args.force && fs.existsSync(path.join(SHIPPED_DIR, group, shippedName(id)))) continue;
      await exportIcon(group, id, path.join(ORIGINALS_DIR, group, file));
      done += 1;
    }
  }
  console.log(`Exported ${done} icon(s) at ${ICON_SIZE} px to ${path.relative(ROOT, SHIPPED_DIR)}/. Run npm run build:packs next.`);
}

/** The style references sent with every request: --refs, else STYLE_REFS. */
function styleReferences(args) {
  const list = args.refs ? String(args.refs).split(',').map((p) => path.resolve(ROOT, p.trim()))
    : STYLE_REFS.map((r) => path.join(ROOT, r));
  return list.filter((p) => {
    if (fs.existsSync(p)) return true;
    console.warn(`(reference not found, skipping: ${path.relative(ROOT, p)})`);
    return false;
  });
}

/** One image via the Gemini REST API, retrying rate limits and server errors. Returns { data: Buffer, ext }. */
async function generateImage(model, key, prompt, refParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }, ...refParts] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const waits = [10000, 30000, 60000];
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
    } catch (err) {
      if (attempt < waits.length) { await new Promise((r) => setTimeout(r, waits[attempt])); continue; }
      throw err;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < waits.length) {
      await new Promise((r) => setTimeout(r, waits[attempt]));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!img) {
      // Now and then the model answers in words only ("Sure, here's the icon:"): ask again.
      if (attempt < waits.length) continue;
      const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
      throw new Error(`no image returned${text ? ` — model said: ${text}` : ''}`);
    }
    const inline = img.inlineData ?? img.inline_data;
    const ext = (inline.mimeType ?? inline.mime_type ?? 'image/png').includes('jpeg') ? 'jpg' : 'png';
    return { data: Buffer.from(inline.data, 'base64'), ext };
  }
}

/** Typed-yes confirmation. Resolves true only on exactly "yes". */
function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(ans.trim().toLowerCase() === 'yes');
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.export) return exportAll(args);
  const limit = Math.max(0, Number(args.limit ?? 5));
  const maxCost = Number(args['max-cost'] ?? 2.0);
  const delay = Number(args.delay ?? 1500);
  const model = args.model || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

  const all = collectItems(args);
  const pending = all.filter((a) => args.force || !a.exists);
  const queue = pending.slice(0, limit);
  const est = queue.length * COST_PER_IMAGE;
  const refs = styleReferences(args);

  console.log(`\nItems matched: ${all.length}   already have an icon: ${all.length - pending.length}   need one: ${pending.length}`);
  console.log(`This run (--limit=${limit}): ${queue.length} image(s)   estimated cost: ~$${est.toFixed(2)} (@ $${COST_PER_IMAGE}/img)`);
  if (pending.length > queue.length) console.log(`(${pending.length - queue.length} more would remain — raise --limit to do more.)`);
  if (!queue.length) { console.log('\nNothing to generate.'); return; }
  console.log(`\nStyle references (pixel style only): ${refs.length ? refs.map((r) => path.relative(ROOT, r)).join(', ') : '(none; output may drift, pass --refs)'}`);
  console.log('\nPlan:');
  for (const a of queue) console.log(`  ${a.group.padEnd(20)} ${a.catalogId.padEnd(34)} ${a.name}`);

  if (args['dry-run']) {
    const first = queue[0];
    console.log(`\nExample prompt (${first.catalogId}):\n  ${buildPrompt(first, refs.length > 0)}`);
    console.log('\n--dry-run: no API calls made.');
    return;
  }
  if (est > maxCost) {
    console.error(`\nAbort: estimate $${est.toFixed(2)} exceeds --max-cost $${maxCost.toFixed(2)}. Lower --limit or raise --max-cost.`);
    process.exit(1);
  }
  const key = apiKey();
  if (!key) { console.error(`\nNo API key: set GEMINI_API_KEY, or put the key in ${KEY_FILE}.`); process.exit(1); }
  if (!args.yes && !(await confirm(`\nGenerate ${queue.length} icon(s) for ~$${est.toFixed(2)} with ${model}? Type "yes": `))) {
    console.log('Cancelled.');
    return;
  }

  // The references' art only: a framed icon is cropped to the square inside its frame.
  const refParts = await Promise.all(refs.map(async (r) => pngPart(isArt(r) ? await sharp(r).png().toBuffer() : await innerArt(r))));
  let spent = 0;
  let ok = 0;
  let fail = 0;
  for (const [i, a] of queue.entries()) {
    if (spent + COST_PER_IMAGE > maxCost) { console.log(`\nBudget cap $${maxCost.toFixed(2)} reached — stopping.`); break; }
    process.stdout.write(`[${i + 1}/${queue.length}] ${a.group}/${a.catalogId} … `);
    try {
      const { data, ext } = await generateImage(model, key, buildPrompt(a, refParts.length > 0), refParts);
      spent += COST_PER_IMAGE;
      const dir = path.join(ORIGINALS_DIR, a.group);
      fs.mkdirSync(dir, { recursive: true });
      // --force: keep the original being replaced (and drop it from the folder, so a different extension can't linger).
      for (const old of listDir(dir).filter((f) => iconPattern(a.catalogId).test(f))) {
        const keep = path.join(ORIGINALS_DIR, '.replaced', a.group);
        fs.mkdirSync(keep, { recursive: true });
        fs.renameSync(path.join(dir, old), path.join(keep, old.replace(/(\.\w+)$/, `.${Date.now()}$1`)));
      }
      const original = path.join(dir, `${a.catalogId}_art.${ext}`);
      fs.writeFileSync(original, data);
      const shipped = await exportIcon(a.group, a.catalogId, original);
      ok += 1;
      console.log(`ok → ${path.relative(ROOT, shipped)}  (spent ~$${spent.toFixed(2)})`);
    } catch (err) {
      fail += 1;
      console.log(`FAILED: ${err.message}`);
    }
    if (i < queue.length - 1) await new Promise((r) => setTimeout(r, delay));
  }
  console.log(`\nDone. ${ok} generated, ${fail} failed. Estimated spend this run: ~$${spent.toFixed(2)}. Run npm run build:packs next.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
