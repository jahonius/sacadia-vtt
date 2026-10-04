/**
 * Ability icons: which compendiums have them and where they live. Shared by the pack build (src/build-packs.mjs, which
 * points each item's img at its icon) and the generator (src/generate-icons.mjs).
 *
 * Every icon exists twice:
 * - the original, full size (1024 px), kept on this machine only (art/ is gitignored and never shipped, so back it up
 *   yourself): the generator's frameless illustration, art/icons/<group>/<id>_art.png (framed on export, see
 *   src/icon-frame.mjs), or for the first icons, made with the frame drawn in, art/icons/<group>/<id>_icon.png|jpg.
 * - the icon the system uses, 256 px WebP: assets/icons/abilities/<group>/<id>_icon.webp.
 * <group> is the pack name without "abilities-": oracle, magus, lore, …, profession-features, basic-actions. The five
 * Traits (shown on check and save cards) are the one group that isn't a compendium: <group> traits, shipped to
 * assets/icons/traits/<trait>_icon.webp.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGINALS_DIR = path.join(ROOT, 'art', 'icons');
export const SHIPPED_DIR = path.join(ROOT, 'assets', 'icons', 'abilities');
/** Where a group's shipped icons live: the ability groups under SHIPPED_DIR, the Traits (not items) in assets/icons/traits. */
export const shippedDir = (group) => (group === 'traits' ? path.join(ROOT, 'assets', 'icons', 'traits') : path.join(SHIPPED_DIR, group));
/** The empty frame every icon is drawn into (a generation input; not shipped). */
export const TEMPLATE = path.join(ROOT, 'src', 'icon_template.jpg');
export const ICON_SIZE = 256;
export const WEBP_QUALITY = 90;

/** Compendiums whose items get icons. */
export const hasIcons = (pack) => pack.startsWith('abilities-') || pack === 'profession-features' || pack === 'basic-actions';
/** The icon folder for a compendium. */
export const iconGroup = (pack) => pack.replace(/^abilities-/, '');
/** A file name that is this item's icon or original, in any format (`<id>.png`, `<id>_icon.webp`, `<id>_art.png`, …). */
export const iconPattern = (id) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_icon|_art)?\\.(webp|png|jpe?g)$`, 'i');
export const shippedName = (id) => `${id}_icon.webp`;
/** The path Foundry loads a shipped icon from. */
export const systemPath = (group, file) => `systems/sacadia/assets/icons/abilities/${group}/${file}`;
