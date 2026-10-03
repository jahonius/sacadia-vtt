/**
 * Run the system's Quench batches (module/tests/quench.mjs) headless, against a throwaway Foundry world — your own
 * worlds and data folder are never touched.
 *
 *   cd tools/quench && npm install && npx playwright install chromium   # once
 *   npm test                         # every "sacadia.*" batch
 *   npm test -- sacadia.canvas       # one batch (several: sacadia.combat,sacadia.flows)
 *   npm test -- sacadia.sweep.abilities Witch   # the ability sweep, limited to names or packs matching "Witch"
 *
 * It builds a throwaway Foundry data folder (~/.cache/sacadia-quench, outside the repo — Foundry serves a system's
 * files, and this folder holds a copy of your licence): the licence, this repo linked in as the system, the Quench
 * module, and a test world. Then it starts a Foundry server on its own port, opens the world as the Gamemaster in
 * headless Chromium, runs the batches, prints the results and stops the server. Exit code 1 when a test fails.
 *
 * Settings (environment variables):
 *   FOUNDRY_APP   the Foundry installation (the folder with main.mjs); default ~/.foundryvtt
 *   FOUNDRY_DATA  a Foundry data folder to copy the licence from; default: the first of ~/projects/foundrydata,
 *                 ~/FoundryVTT-Data, ~/.local/share/FoundryVTT that has Config/license.json
 *   QUENCH_DATA   the throwaway data folder; default ~/.cache/sacadia-quench
 *   QUENCH_PORT   the server port; default 30123
 *   QUENCH_SYSTEM the system folder to test; default this repo (point it at an unpacked release zip to test what ships)
 *
 * Close any Foundry server that has this system's world loaded first: the compendium files can only be open once.
 */
/* global quench */ // (inside page.evaluate: the browser's globals)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const home = os.homedir();
// Outside the repo on purpose: Foundry serves every file in a system's folder, and this one holds a licence copy.
const dataDir = process.env.QUENCH_DATA ?? path.join(home, '.cache', 'sacadia-quench');
const port = Number(process.env.QUENCH_PORT ?? 30123);
const QUENCH_ZIP = 'https://github.com/Ethaks/FVTT-Quench/releases/download/v0.10.0/module.zip';
const pattern = process.argv[2] ?? 'sacadia.**';
const sweepFilter = process.argv[3] ?? '';

function fail(message) {
  console.error(`quench runner: ${message}`);
  process.exit(2);
}

/* ---- the throwaway data folder ---------------------------------------------------------------------------------- */

const app = process.env.FOUNDRY_APP ?? path.join(home, '.foundryvtt');
if (!fs.existsSync(path.join(app, 'main.mjs'))) fail(`no Foundry installation at ${app} (set FOUNDRY_APP)`);
const licenceFrom = [process.env.FOUNDRY_DATA, path.join(home, 'projects/foundrydata'), path.join(home, 'FoundryVTT-Data'),
  path.join(home, '.local/share/FoundryVTT')].filter(Boolean).map((d) => path.join(d, 'Config/license.json')).find((f) => fs.existsSync(f));
if (!licenceFrom) fail('no Foundry licence found (set FOUNDRY_DATA to a data folder with Config/license.json)');

for (const d of ['Config', 'Data/systems', 'Data/modules', 'Data/worlds/sacadia-quench']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
fs.copyFileSync(licenceFrom, path.join(dataDir, 'Config/license.json'));
// Every option Foundry reads (a missing network key breaks its invitation links, and with them the world's load).
fs.writeFileSync(path.join(dataDir, 'Config/options.json'), JSON.stringify({ dataPath: dataDir, compressStatic: true, fullscreen: false,
  hostname: null, language: 'en.core', localHostname: null, port, proxyPort: null, proxySSL: false, routePrefix: null,
  updateChannel: 'stable', upnp: false, awsConfig: null, compressSocket: true, cssTheme: 'dark', tempDir: null, deleteNEDB: false,
  hotReload: false, passwordSalt: null, unixSocket: null, sslCert: null, sslKey: null, world: null, serviceConfig: null }, null, 2));
const systemDir = path.resolve(process.env.QUENCH_SYSTEM ?? repo);
const systemLink = path.join(dataDir, 'Data/systems/sacadia');
// Relink when the system under test changed (a symlink only: never remove a real folder).
const linked = fs.lstatSync(systemLink, { throwIfNoEntry: false });
if (linked?.isSymbolicLink() && fs.readlinkSync(systemLink) !== systemDir) fs.unlinkSync(systemLink);
if (!fs.lstatSync(systemLink, { throwIfNoEntry: false })) fs.symlinkSync(systemDir, systemLink, 'dir');
if (fs.realpathSync(systemLink) !== fs.realpathSync(systemDir)) fail(`${systemLink} isn't a link to ${systemDir}; remove it`);
const system = JSON.parse(fs.readFileSync(path.join(systemDir, 'system.json'), 'utf8'));
const worldJson = path.join(dataDir, 'Data/worlds/sacadia-quench/world.json');
if (!fs.existsSync(worldJson)) {
  fs.writeFileSync(worldJson, JSON.stringify({ id: 'sacadia-quench', title: 'Sacadia Quench Tests', system: 'sacadia',
    description: 'Throwaway world for the headless Quench runner.', coreVersion: system.compatibility?.verified ?? '14',
    compatibility: { minimum: system.compatibility?.minimum ?? '14', verified: system.compatibility?.verified ?? '14' }, version: '1.0.0' }, null, 2));
}
const quenchDir = path.join(dataDir, 'Data/modules/quench');
if (!fs.existsSync(path.join(quenchDir, 'module.json'))) {
  console.log('Downloading Quench…');
  const zip = Buffer.from(await (await fetch(QUENCH_ZIP)).arrayBuffer());
  const { default: zlib } = await import('node:zlib');
  fs.mkdirSync(quenchDir, { recursive: true });
  // A minimal zip reader (stored or deflated entries), so the runner needs nothing beyond Playwright.
  const off = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(off + 10);
  let p = zip.readUInt32LE(off + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen).replace(/^dist\//, '');
    p += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) continue;
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataStart, dataStart + size);
    const out = path.join(quenchDir, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, method === 8 ? zlib.inflateRawSync(raw) : raw);
  }
}

/* ---- the server --------------------------------------------------------------------------------------------------- */

const server = spawn(process.execPath, ['main.mjs', `--dataPath=${dataDir}`, `--port=${port}`, '--world=sacadia-quench', '--noupnp', '--noupdate'],
  { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
const started = new Promise((resolve, reject) => {
  const onData = (d) => {
    serverLog += d;
    if (/Server started and listening/.test(serverLog)) resolve();
    if (/Error|EADDRINUSE|lock/i.test(String(d)) && !/started/.test(serverLog)) reject(new Error(String(d)));
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
  server.on('exit', (code) => reject(new Error(`Foundry exited (${code})\n${serverLog.slice(-2000)}`)));
});
const stopServer = () => { if (server.exitCode === null) server.kill('SIGTERM'); };
process.on('exit', stopServer);
process.on('SIGINT', () => { stopServer(); process.exit(130); });

let exitCode = 0;
try {
  await Promise.race([started, new Promise((_, rej) => setTimeout(() => rej(new Error('Foundry did not start in 90s')), 90000))]);
  // Foundry works out its invitation links just after it starts listening; a client that joins before then gets a world
  // that fails to load. Give it a moment.
  await new Promise((r) => setTimeout(r, 8000));
  exitCode = await runBatches();
} catch (err) {
  console.error(err.message ?? err);
  exitCode = 2;
} finally {
  stopServer();
}
process.exit(exitCode);

/* ---- the browser -------------------------------------------------------------------------------------------------- */

async function openGame(chromium) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
  page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
  await page.goto(`http://localhost:${port}/join`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('select[name="userid"]', { timeout: 60000 });
  const gm = await page.$$eval('select[name="userid"] option', (os2) => os2.find((o) => /gamemaster/i.test(o.textContent))?.value ?? os2.find((o) => o.value)?.value);
  await page.selectOption('select[name="userid"]', gm);
  await Promise.all([page.waitForURL(/\/game/, { timeout: 60000 }), page.click('button[name="join"]')]);
  try {
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 }).catch(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' }); // one more try, should the first load have come too early
      await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 90000 });
    });
  } catch (err) {
    console.error('The world never finished loading. Browser errors:', errors.slice(0, 10).join('\n') || '(none)');
    console.error('Server log (tail):', serverLog.slice(-1500));
    throw err;
  }
  // Headless, the notifications area isn't drawn and Foundry's queue throws on every notification; draw it.
  await page.evaluate(async () => { if (!ui.notifications?.element) await ui.notifications?.render?.({ force: true }); });
  return { browser, page, errors };
}

async function runBatches() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { fail('Playwright is missing: run `npm install && npx playwright install chromium` in tools/quench'); }
  let { browser, page, errors } = await openGame(chromium);
  if (!(await page.evaluate(() => game.modules.get('quench')?.active))) {
    // First run: enable Quench in the test world, then log in again.
    await page.evaluate(async () => game.settings.set('core', 'moduleConfiguration', { ...game.settings.get('core', 'moduleConfiguration'), quench: true }));
    await browser.close();
    ({ browser, page, errors } = await openGame(chromium));
  }
  await page.waitForFunction(() => !!window.quench, null, { timeout: 60000 });
  // Quench's reporter writes into its results window, so it has to be open.
  await page.evaluate(async () => { await quench.app.render({ force: true }); });
  await page.waitForFunction(() => !!quench.app.element, null, { timeout: 30000 });
  await page.exposeFunction('__quenchProgress', (line) => console.log(line));
  await page.evaluate((f) => { window.sacadiaSweepFilter = f; }, sweepFilter);
  const json = await page.evaluate((pat) => new Promise(async (resolve) => {
    Hooks.once('quenchReports', ({ json: j }) => resolve(j));
    const runner = await quench.runBatches(pat.split(','));
    runner.on('pass', (t) => window.__quenchProgress(`  ✔ ${t.fullTitle().replace(/^\S+_root /, '')} (${t.duration} ms)`));
    runner.on('fail', (t, err) => window.__quenchProgress(`  ✘ ${t.fullTitle().replace(/^\S+_root /, '')}\n      ${err?.message}`));
  }), pattern);
  const stats = JSON.parse(json).stats ?? {};
  console.log(`\nQuench: ${stats.passes ?? 0} passed, ${stats.failures ?? 0} failed, ${stats.pending ?? 0} pending (${stats.duration ?? '?'} ms)`);
  // Errors from the system's own code (Foundry's headless notification glitch and the tests' deliberate failures aside).
  const ours = errors.filter((e) => /systems\/sacadia|^404/.test(e) && !/timed out waiting|is not iterable/.test(e));
  if (ours.length) { console.log('\nErrors from the system:'); for (const e of ours.slice(0, 20)) console.log(`  ${e.slice(0, 500)}`); }
  await browser.close();
  return (stats.failures ?? 0) > 0 || !stats.tests ? 1 : 0;
}
