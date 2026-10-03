/**
 * Generate ability icons with the Gemini image API, using assets/icons/icon_template.jpg as the frame
 * so every icon shares the ornate gold pixel-art border. Reads ability name + description from the
 * source packs (src/packs/abilities-<prof>/*.json) and writes assets/icons/abilities/<prof>/<id>_icon.png.
 *
 * COST SAFETY (the whole point): skips abilities that already have an icon, caps each run at --limit
 * images (default 5), refuses to start if the estimate exceeds --max-cost (default $2), and asks for a
 * typed "yes" first. Use --dry-run to preview the plan and estimated spend with zero API calls.
 *
 * Setup:  export GEMINI_API_KEY=...        (or GOOGLE_API_KEY)
 * Usage:  node src/generate-icons.mjs --profession=oracle --dry-run
 *         node src/generate-icons.mjs --profession=oracle --limit=10 --max-cost=1
 *         node src/generate-icons.mjs --only=black_rebuke,bloodlet --force --yes
 *
 * Flags:
 *   --profession=<key>   one pack (oracle, soldier, sentinel, …); omit to span all packs
 *   --only=<id,id,…>     only these catalogIds (implies you know what you want)
 *   --refs=<path,path>   finished example icons to steer the pixel scale/style (default: auto — a few
 *                        existing icons from the target profession's folder). Keeps new art matching.
 *   --ref-count=<N>      how many auto-picked references to send when --refs is absent (default 2, max 4)
 *   --limit=<N>          max images this run (default 5) — the primary throttle
 *   --max-cost=<$>       refuse to start if estimate exceeds this (default 2.00)
 *   --force              regenerate even if an icon already exists
 *   --dry-run            print the plan + estimate, make no API calls
 *   --yes                skip the confirmation prompt (for unattended runs)
 *   --delay=<ms>         pause between images (default 1500)
 *   --model=<name>       override the image model (default env or gemini-2.5-flash-image)
 *
 * The per-image price is an ESTIMATE (Gemini image output is billed per image). Override with
 * ICON_COST_PER_IMAGE if pricing differs; the real guardrails are --limit and --max-cost.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PACKS = path.join(ROOT, 'src', 'packs');
const OUT_BASE = path.join(ROOT, 'assets', 'icons', 'abilities');
const TEMPLATE = path.join(ROOT, 'assets', 'icons', 'icon_template.jpg');

const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const COST_PER_IMAGE = Number(process.env.ICON_COST_PER_IMAGE || 0.04);
const ICON_RE = (id) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_icon)?\\.(png|jpe?g)$`, 'i');

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
 * A one-line aesthetic blurb per profession, injected into the prompt so a class's icons share a look
 * (motifs, palette, mood) rather than reading as generic fantasy. Edit freely to taste. Keyed by the
 * pack-folder name (abilities-<key>).
 */
const PROFESSION_FANTASY = {
  oracle: 'The Oracle — a mad seer who channels prophecy through self-inflicted Madness: eldritch mysticism, incense smoke, ritual blood, and holy blessings warped by insanity.',
  soldier: 'The Soldier — a disciplined tank and battlefield leader: steel armor, shields, war banners, rallying horns, heroic martial order.',
  sentinel: 'The Sentinel — a wilderness hunter and marksman: bows, crossbows and slings, traps, and the patient ambush of favored prey in the wild.',
  bladedancer: 'The Bladedancer — an agile urban duelist: elegant footwork, finesse blades, poise, and the bustle of the market street.',
  thug: 'The Thug — a savage colosseum brawler: grappling, chains, muscle, greased fists, and the roar of the crowd.',
  fatebound: 'The Fatebound — a mystic bound to destiny: cool mist, still water, divine weapons, and the pull of fate and prophecy.',
  hulinari: 'The Hulinari Warrior — a primal beast-folk champion: animal ancestries, feral forms, tusks and fur, the thunder of a stampede.',
  general: 'A general martial combatant: grounded, practical weapons and battle-tested technique.',
  masteries: 'A pinnacle profession mastery: a capstone of the class fantasy, powerful and iconic.',
};

/** Strip HTML tags/entities to plain text for the prompt. */
function plain(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Build the image prompt. The first attached image is always the empty frame template; when `hasRefs`
 * is true, the images after it are finished example icons — so the prompt tells the model to copy their
 * pixel scale (the actual issue: it otherwise renders the center at a finer pixel grid than the frame).
 */
function buildPrompt(a, hasRefs) {
  const subject = plain(a.description).slice(0, 300);
  const fantasy = PROFESSION_FANTASY[a.profession];
  return [
    'The FIRST attached image is a template: an ornate golden pixel-art icon frame with an empty circular center.',
    hasRefs
      ? 'The REMAINING attached images are finished example icons in the exact target art style. Match them closely.'
      : '',
    `Create a fantasy RPG ability icon for "${a.name}" by illustrating its subject inside the circular center.`,
    fantasy ? `The ability belongs to this class — evoke its fantasy in the mood, motifs, and palette: ${fantasy}` : '',
    'Keep the golden circular frame and square border unchanged. Use the SAME chunky low-resolution pixel-art',
    'style, pixel size, and warm palette (golds, browns, olive) as the frame and examples — the pixels in your',
    'illustration must be the same size as in the examples, not finer or smoother. Centered, iconic, symbolic —',
    'no text, no letters, no words, no UI. Fill the inner circle with the illustration.',
    subject ? `Ability effect for inspiration: ${subject}` : '',
  ].filter(Boolean).join(' ');
}

/** Read an image file into a Gemini inline_data part (mime inferred from extension). */
function imagePart(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return { inline_data: { mime_type: mime, data: fs.readFileSync(filePath).toString('base64') } };
}

/** Collect {profession, catalogId, name, description, outDir, exists} for every source ability. */
function collectAbilities(args) {
  const packs = fs.readdirSync(SRC_PACKS).filter((d) => d.startsWith('abilities-'));
  const wantProf = args.profession || args.prof;
  const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;
  const out = [];
  for (const pack of packs) {
    const profession = pack.replace(/^abilities-/, '');
    if (wantProf && profession !== wantProf) continue;
    const dir = path.join(SRC_PACKS, pack);
    const outDir = path.join(OUT_BASE, profession);
    const existing = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const catalogId = doc.flags?.sacadia?.catalogId ?? path.basename(file, '.json');
      if (only && !only.has(catalogId)) continue;
      const exists = existing.some((f) => ICON_RE(catalogId).test(f));
      out.push({ profession, catalogId, name: doc.name, description: doc.system?.description, outDir, exists });
    }
  }
  return out;
}

/** One image via the Gemini REST API. Returns { data: Buffer, ext } or throws with the model's message. */
async function generateImage(prompt, templatePart, refParts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{
      role: 'user',
      // Order matters: text, then the empty frame template, then the finished example icons.
      parts: [{ text: prompt }, templatePart, ...refParts],
    }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!img) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
    throw new Error(`no image returned${text ? ` — model said: ${text}` : ''}`);
  }
  const inline = img.inlineData ?? img.inline_data;
  const ext = (inline.mimeType ?? inline.mime_type ?? 'image/png').includes('jpeg') ? 'jpg' : 'png';
  return { data: Buffer.from(inline.data, 'base64'), ext };
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
  const limit = Math.max(0, Number(args.limit ?? 5));
  const maxCost = Number(args['max-cost'] ?? 2.0);
  const delay = Number(args.delay ?? 1500);
  const refCount = Math.min(4, Math.max(0, Number(args['ref-count'] ?? 2)));
  const dryRun = !!args['dry-run'];

  const all = collectAbilities(args);
  const pending = all.filter((a) => args.force || !a.exists);
  const queue = pending.slice(0, limit);
  const skipped = all.length - pending.length;
  const est = queue.length * COST_PER_IMAGE;

  // Reference exemplars steer the pixel scale. Explicit --refs apply to every image; otherwise each
  // profession borrows a few of its own *pre-existing* icons (snapshotted now, before we write any new
  // ones, so a shaky fresh output never becomes a reference for the next ability).
  const explicitRefs = args.refs
    ? String(args.refs).split(',').map((p) => path.resolve(ROOT, p.trim())).filter((p) => {
        if (fs.existsSync(p)) return true; console.warn(`(reference not found, skipping: ${p})`); return false;
      })
    : null;
  const refsByProfession = {};
  for (const prof of new Set(queue.map((a) => a.profession))) {
    if (explicitRefs) { refsByProfession[prof] = explicitRefs; continue; }
    const dir = path.join(OUT_BASE, prof);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /_icon\.(png|jpe?g)$|\.(png|jpe?g)$/i.test(f)).sort()
      : [];
    refsByProfession[prof] = files.slice(0, refCount).map((f) => path.join(dir, f));
  }

  console.log(`\nAbilities matched: ${all.length}   already have an icon: ${skipped}   need one: ${pending.length}`);
  console.log(`This run (--limit=${limit}): ${queue.length} image(s)   estimated cost: ~$${est.toFixed(2)} (@ $${COST_PER_IMAGE}/img)`);
  if (pending.length > queue.length) console.log(`(${pending.length - queue.length} more would remain — raise --limit to do more.)`);
  if (!queue.length) { console.log('\nNothing to generate.'); return; }
  console.log('\nStyle references (sent with the template to match pixel scale):');
  for (const [prof, refs] of Object.entries(refsByProfession)) {
    console.log(`  ${prof.padEnd(12)} ${refs.length ? refs.map((r) => path.basename(r)).join(', ') : '(none — output may drift; pass --refs or seed a few icons first)'}`);
  }
  console.log('\nPlan:');
  for (const a of queue) console.log(`  ${a.profession.padEnd(12)} ${a.catalogId.padEnd(32)} ${a.name}`);

  if (dryRun) {
    const first = queue[0];
    console.log(`\nExample prompt (${first.catalogId}):\n  ${buildPrompt(first, (refsByProfession[first.profession] ?? []).length > 0)}`);
    console.log('\n--dry-run: no API calls made.');
    return;
  }
  if (est > maxCost) {
    console.error(`\nAbort: estimate $${est.toFixed(2)} exceeds --max-cost $${maxCost.toFixed(2)}. Lower --limit or raise --max-cost.`);
    process.exit(1);
  }
  if (!API_KEY) { console.error('\nMissing GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment.'); process.exit(1); }
  if (!args.yes && !(await confirm(`\nGenerate ${queue.length} icon(s) for ~$${est.toFixed(2)} with ${MODEL}? Type "yes": `))) {
    console.log('Cancelled.'); return;
  }

  const templatePart = imagePart(TEMPLATE);
  let spent = 0, ok = 0, fail = 0;
  for (const [i, a] of queue.entries()) {
    if (spent + COST_PER_IMAGE > maxCost) { console.log(`\nBudget cap $${maxCost.toFixed(2)} reached — stopping.`); break; }
    process.stdout.write(`[${i + 1}/${queue.length}] ${a.catalogId} … `);
    try {
      const refPaths = refsByProfession[a.profession] ?? [];
      const refParts = refPaths.map(imagePart);
      const { data, ext } = await generateImage(buildPrompt(a, refParts.length > 0), templatePart, refParts);
      fs.mkdirSync(a.outDir, { recursive: true });
      const dest = path.join(a.outDir, `${a.catalogId}_icon.${ext}`);
      fs.writeFileSync(dest, data);
      spent += COST_PER_IMAGE; ok += 1;
      console.log(`ok → ${path.relative(ROOT, dest)}  (spent ~$${spent.toFixed(2)})`);
    } catch (err) {
      fail += 1;
      console.log(`FAILED: ${err.message}`);
    }
    if (i < queue.length - 1) await new Promise((r) => setTimeout(r, delay));
  }
  console.log(`\nDone. ${ok} generated, ${fail} failed. Estimated spend this run: ~$${spent.toFixed(2)}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
