/**
 * Publish a release of the system on GitHub. Foundry installs and updates from two files on the release: the manifest
 * (system.json, whose `manifest` URL points at the latest release) and a zip of what Foundry needs (system.zip, which
 * `download` points at for this version).
 *
 *   npm run release -- --dry-run   # build and check dist/system.zip only
 *   npm run release                # also tag v<version> at HEAD and create the GitHub release (needs the gh CLI)
 *
 * Before releasing: bump `version` in system.json (and its `download` URL), rebuild (npm run build, npm run
 * build:packs), add a "## <version>" section to CHANGELOG.md (it becomes the release notes), then commit and push.
 *
 * Test exactly what ships by unpacking the zip and pointing the in-Foundry tests at it:
 *   QUENCH_SYSTEM=<unpacked folder> npm run test:quench
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: repo, encoding: 'utf8', ...opts }) ?? '').trim();
function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// What Foundry needs. Everything else (src/, tools/, test/, the unused boilerplate lib/) stays out.
const INCLUDE = ['system.json', 'LICENSE.txt', 'README.md', 'CHANGELOG.md', 'module', 'templates', 'css/sacadia-skin.css', 'lang',
  'packs', 'assets'];
// LevelDB's per-open lock and log files (the numbered *.log files are data and ship).
const EXCLUDE = ['packs/*/LOCK', 'packs/*/LOG', 'packs/*/LOG.old'];

/* ---- the manifest ---------------------------------------------------------------------------------------------- */

const system = JSON.parse(fs.readFileSync(path.join(repo, 'system.json'), 'utf8'));
const version = system.version;
const tag = `v${version}`;
const expected = {
  manifest: `${system.url}/releases/latest/download/system.json`,
  download: `${system.url}/releases/download/${tag}/system.zip`,
};
for (const [key, url] of Object.entries(expected)) {
  if (system[key] !== url) fail(`system.json "${key}" should be ${url} (is ${system[key]})`);
}
const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version}\n`));
if (!section) fail(`CHANGELOG.md has no "## ${version}" section`);
const notes = section.slice(version.length).trim();

if (!dryRun) {
  if (run('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes; commit them first');
  run('git', ['fetch', '--quiet', '--tags', 'origin']);
  if (!run('git', ['branch', '-r', '--contains', 'HEAD'])) fail('HEAD isn\'t pushed to origin yet');
  if (run('git', ['tag', '--list', tag])) fail(`tag ${tag} already exists; bump the version`);
}

/* ---- the zip --------------------------------------------------------------------------------------------------- */

const dist = path.join(repo, 'dist');
const zipPath = path.join(dist, 'system.zip');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
run('zip', ['-r', '-X', '-q', zipPath, ...INCLUDE, '-x', ...EXCLUDE]);
const files = new Set(run('unzip', ['-Z1', zipPath]).split('\n').filter((f) => !f.endsWith('/')));

// Every file the system loads must be in the zip: the manifest's own paths, relative imports between modules, and
// `systems/sacadia/…` paths in code, templates and compendium data (templates, icons, images).
const missing = new Set();
const need = (file, from) => { if (!files.has(file)) missing.add(`${file} (${from})`); };
for (const f of [...system.esmodules, ...system.styles, ...system.languages.map((l) => l.path)]) need(f, 'system.json');
for (const p of system.packs) if (![...files].some((f) => f.startsWith(`${p.path}/`))) missing.add(`${p.path}/ (system.json pack)`);
for (const f of files) {
  if (!/\.(mjs|js|hbs|html|css|json)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(repo, f), 'utf8');
  if (f.endsWith('.mjs')) {
    // `import … from './x'`, `export … from './x'`, `import './x'` and `import('./x')`.
    const imports = /(?:import|export)\s[^'";]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
    for (const m of text.matchAll(imports)) need(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] ?? m[2] ?? m[3])), f);
  }
  for (const m of text.matchAll(/systems\/sacadia\/([\w./-]+\.\w+)/g)) need(m[1], f);
}
for (const f of fs.readdirSync(path.join(repo, 'src/packs'), { recursive: true })) {
  if (!f.endsWith('.json')) continue;
  const text = fs.readFileSync(path.join(repo, 'src/packs', f), 'utf8');
  for (const m of text.matchAll(/systems\/sacadia\/([\w./-]+\.\w+)/g)) need(m[1], `src/packs/${f}`);
}
if (missing.size) fail(`the zip is missing files the system loads:\n  ${[...missing].slice(0, 20).join('\n  ')}`);
const size = (fs.statSync(zipPath).size / 1e6).toFixed(1);
console.log(`dist/system.zip: ${files.size} files, ${size} MB, every referenced file present`);

/* ---- the release ----------------------------------------------------------------------------------------------- */

if (dryRun) {
  console.log(`dry run: no tag or release made. ${tag} would be released with these notes:\n\n${notes}`);
  process.exit(0);
}
const head = run('git', ['rev-parse', 'HEAD']);
run('gh', ['release', 'create', tag, zipPath, path.join(repo, 'system.json'), '--target', head, '--title', tag, '--notes', notes],
  { stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`released ${tag}\n  manifest: ${expected.manifest}\n  download: ${expected.download}`);
