/**
 * Build The Breach's images (assets/adventures/the-breach/): the portraits, tokens and cover from the art in the
 * one-shot PDF, and the battle map from the author's original.
 *
 * The PDF isn't in the repo. Extract its images first (PyMuPDF: `doc.extract_image(xref)`) and name them as SOURCES
 * below expects. Then run:
 *   node tools/breach-assets.mjs <folder with the extracted PDF images> <the original map image>
 *
 * The original map is 20 × 48 squares (1706 × 4096 px, 85.3 px a square). It is resampled to exactly 100 px a square
 * (2000 × 4800) so the scene's grid size is a whole number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'adventures', 'the-breach');

// Extracted file → output name, and for tokens the square crop [left, top, size] on the source (pixels).
const SOURCES = {
  cover: { file: 'img_48.jpeg' },
  wanabbul: { file: 'img_112.jpeg', token: [96, 0, 290] },
  grubnut: { file: 'img_371.jpeg', token: [120, 10, 260] },
  csenorras: { file: 'img_397.jpeg', token: [60, 0, 320] },
  'weavers-daughter': { file: 'img_423.jpeg', token: [195, 30, 270] },
  weaverspool: { file: 'img_423.jpeg', token: [10, 60, 230], portrait: false },
  chunrudar: { file: 'img_209.jpeg', token: [90, 70, 300] },
  honnasusara: { file: 'img_239.jpeg', token: [100, 60, 290] },
  manchuthara: { file: 'img_265.jpeg', token: [130, 80, 320] },
  selthimor: { file: 'img_291.jpeg', token: [90, 40, 300] },
};

const MAP_SQUARES = { cols: 20, rows: 48 };
const SQUARE = 100;

async function buildMap(src) {
  const W = MAP_SQUARES.cols * SQUARE, H = MAP_SQUARES.rows * SQUARE;
  const map = await sharp(src).resize(W, H, { kernel: 'lanczos3', fit: 'fill' }).toBuffer();
  await sharp(map).webp({ quality: 82 }).toFile(path.join(OUT, 'map.webp'));
  // The scene thumbnail: the wall and the ballista tower.
  await sharp(map).extract({ left: 0, top: 4 * SQUARE, width: W, height: 16 * SQUARE }).resize(400, 320).webp({ quality: 70 })
    .toFile(path.join(OUT, 'map-thumb.webp'));
}

/** A round token: the square crop, a soft inner shadow and a colored rim (blue heroes, red demons). */
async function buildToken(src, [left, top, size], name, rim) {
  const S = 400;
  const face = await sharp(src).extract({ left, top, width: size, height: size }).resize(S, S, { kernel: 'lanczos3' }).toBuffer();
  const mask = Buffer.from(`<svg width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 10}" fill="#fff"/></svg>`);
  const ring = Buffer.from(`<svg width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 10}" fill="none" stroke="${rim}" stroke-width="14"/>`
    + `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 3}" fill="none" stroke="#1b1b1b" stroke-width="5"/></svg>`);
  const round = await sharp(face).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  await sharp({ create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: round }, { input: ring }]).webp({ quality: 85 }).toFile(path.join(OUT, 'tokens', `${name}.webp`));
}

async function main() {
  const [dir, mapFile] = process.argv.slice(2);
  if (!dir || !mapFile) throw new Error('usage: node tools/breach-assets.mjs <folder with the extracted PDF images> <the original map>');
  fs.mkdirSync(path.join(OUT, 'tokens'), { recursive: true });
  const DEMONS = new Set(['wanabbul', 'grubnut', 'csenorras', 'weavers-daughter', 'weaverspool']);
  for (const [name, s] of Object.entries(SOURCES)) {
    const src = path.join(dir, s.file);
    if (s.portrait !== false) await sharp(src).webp({ quality: 85 }).toFile(path.join(OUT, `${name}.webp`));
    if (s.token) await buildToken(src, s.token, name, DEMONS.has(name) ? '#8c1d18' : '#2f4f8f');
  }
  await buildMap(mapFile);
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
