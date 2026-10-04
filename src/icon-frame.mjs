/**
 * The icon frame, applied after generation: the model draws only a frameless illustration, and every icon gets the
 * exact same gold frame from src/icon_template.jpg. Used by src/generate-icons.mjs.
 *
 * The template's interior (the disc inside its dark outline) is found by flood-filling from the center through every
 * pixel lighter than the outline, so the cut follows the drawn, stair-stepped edge exactly. The frame layer is the
 * template with that interior made transparent, and an illustration is laid under it.
 *
 * The model draws at whatever pixel size it likes (from about 3 to 18 px at 1024), so every illustration is forced onto
 * the frame's own grid (FRAME_PIXELS art pixels across): each grid cell takes the color that covers most of it, after
 * the image is reduced to a palette, and the cells are scaled back up with nearest-neighbour. Picking a real color per
 * cell keeps edges hard; averaging, or any smoothing resize, blends neighbouring colors and blurs the art.
 */
import sharp from 'sharp';
import { TEMPLATE } from './icons.mjs';

/** Art pixels across the template: its outline steps in multiples of about 10.2 px at 1024 (measured). */
export const FRAME_PIXELS = 100;
/** Colors an illustration is reduced to before it's put on the grid (pixel-art icons use a few dozen). */
const PALETTE_COLORS = 48;
/** Luminance below which a template pixel is part of the frame's dark inner outline. */
const OUTLINE_LUMINANCE = 62;

let cached = null;

/** The frame layer (RGBA PNG, interior transparent), the template size and the interior's bounding box. */
export async function frame() {
  if (cached) return cached;
  const { data, info } = await sharp(TEMPLATE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const lum = (i) => 0.3 * data[i * 3] + 0.59 * data[i * 3 + 1] + 0.11 * data[i * 3 + 2];
  const inside = new Uint8Array(W * H);
  const stack = [Math.floor(H / 2) * W + Math.floor(W / 2)];
  while (stack.length) {
    const i = stack.pop();
    if (inside[i] || lum(i) < OUTLINE_LUMINANCE) continue;
    inside[i] = 1;
    const x = i % W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (i >= W) stack.push(i - W);
    if (i < W * (H - 1)) stack.push(i + W);
  }
  let left = W; let top = H; let right = 0; let bottom = 0; let area = 0;
  for (let i = 0; i < W * H; i++) {
    if (!inside[i]) continue;
    const x = i % W; const y = Math.floor(i / W);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); area += 1;
  }
  // A fill that ran out of the outline (or never started) would cover most of the template, or almost none of it.
  if (area < 0.2 * W * H || area > 0.7 * W * H) throw new Error(`icon frame: the template's interior fill covers ${area} px; check OUTLINE_LUMINANCE`);
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
    rgba[i * 4 + 3] = inside[i] ? 0 : 255;
  }
  const layer = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  cached = { layer, width: W, height: H, box: { left, top, width: right - left + 1, height: bottom - top + 1 } };
  return cached;
}

/**
 * An image forced onto a cols×rows grid (PNG buffer of that size): reduced to a palette with no dithering, then each
 * cell takes its most common color.
 */
export async function pixelate(input, cols, rows) {
  const reduced = await sharp(input).png({ palette: true, colors: PALETTE_COLORS, dither: 0 }).toBuffer();
  const { data, info } = await sharp(reduced).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(cols * rows * 3);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * info.height) / rows); const y1 = Math.floor(((cy + 1) * info.height) / rows);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * info.width) / cols); const x1 = Math.floor(((cx + 1) * info.width) / cols);
      const counts = new Map();
      let best = 0; let color = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * 3;
          const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          if (n > best) { best = n; color = key; }
        }
      }
      const o = (cy * cols + cx) * 3;
      out[o] = color >> 16; out[o + 1] = (color >> 8) & 255; out[o + 2] = color & 255;
    }
  }
  return sharp(out, { raw: { width: cols, height: rows, channels: 3 } }).png().toBuffer();
}

/**
 * A finished, framed icon (PNG buffer at the template's size) from a frameless illustration: cropped to the interior's
 * shape, forced onto the frame's pixel grid, and laid under the frame.
 */
export async function framedIcon(illustration) {
  const { layer, width, height, box } = await frame();
  const cols = Math.round((box.width * FRAME_PIXELS) / width);
  const rows = Math.round((box.height * FRAME_PIXELS) / height);
  const shaped = await sharp(illustration).resize(width, Math.round((width * box.height) / box.width), { fit: 'cover', kernel: 'nearest' }).toBuffer();
  const art = await sharp(await pixelate(shaped, cols, rows)).resize(box.width, box.height, { kernel: 'nearest' }).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#000' } })
    .composite([{ input: art, left: box.left, top: box.top }, { input: layer, left: 0, top: 0 }])
    .png().toBuffer();
}

/** An older icon with its frame drawn in, forced as a whole onto the frame's pixel grid (PNG at the template's size). */
export async function regridded(framedFile) {
  const { width, height } = await frame();
  const grid = await pixelate(await sharp(framedFile).resize(width, height, { kernel: 'nearest' }).toBuffer(), FRAME_PIXELS, FRAME_PIXELS);
  return sharp(grid).resize(width, height, { kernel: 'nearest' }).png().toBuffer();
}

/** The art inside a framed icon: the square inscribed in the interior (a style reference with no frame in it). */
export async function innerArt(framedFile) {
  const { box } = await frame();
  const side = Math.floor(Math.min(box.width, box.height) / Math.SQRT2);
  const left = box.left + Math.floor((box.width - side) / 2);
  const top = box.top + Math.floor((box.height - side) / 2);
  return sharp(framedFile).resize(1024, 1024, { fit: 'fill' }).extract({ left, top, width: side, height: side }).png().toBuffer();
}
