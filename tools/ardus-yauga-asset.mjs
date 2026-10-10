/**
 * Build The Breach's world map (assets/adventures/the-breach/ardus-yauga.webp) for its prologue scene: the rulebook's
 * "Civilizations of the Ardus Yauga" map (v1.2, PDF page 26).
 *
 * The rulebook isn't in the repo. Extract the map first (pypdf with Pillow: `PdfReader(pdf).pages[25].images`, the
 * 1080 × 877 one), then run:
 *   node tools/ardus-yauga-asset.mjs <the extracted map image>
 *
 * It's resampled to twice its size (2160 × 1754), so the scene's travel lines and the camera's zoom stay smooth.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'adventures', 'the-breach');
export const SIZE = { width: 2160, height: 1754 };

async function main() {
  const [src] = process.argv.slice(2);
  if (!src) throw new Error('usage: node tools/ardus-yauga-asset.mjs <the map image extracted from the rulebook>');
  const map = await sharp(src).resize(SIZE.width, SIZE.height, { kernel: 'lanczos3', fit: 'fill' }).toBuffer();
  await sharp(map).webp({ quality: 85 }).toFile(path.join(OUT, 'ardus-yauga.webp'));
  // The scene thumbnail: the Tianqi lands and the wall.
  await sharp(map).extract({ left: 1040, top: 120, width: 1120, height: 600 }).resize(400, 214).webp({ quality: 70 })
    .toFile(path.join(OUT, 'ardus-yauga-thumb.webp'));
  console.log(`ardus-yauga.webp (${SIZE.width} × ${SIZE.height}) and its thumbnail`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
