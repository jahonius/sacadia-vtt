/**
 * Opening the in-system User Manual (the `user-manual` compendium, built from src/manual/*.md). Reachable from
 * Game Settings (a menu button) and from the book icon in every actor sheet's header.
 */

/** Open the Sacadia User Manual journal (optionally at a page, by name). */
export async function openManual(pageName = '') {
  const pack = game.packs.get('sacadia.user-manual');
  if (!pack) return ui.notifications.warn(game.i18n.localize('SACADIA.Manual.Missing'));
  const index = await pack.getIndex();
  const hit = index.find((e) => e.name === 'Sacadia User Manual') ?? index.contents?.[0] ?? [...index][0];
  const entry = hit ? await pack.getDocument(hit._id) : null;
  if (!entry) return ui.notifications.warn(game.i18n.localize('SACADIA.Manual.Missing'));
  const page = pageName ? entry.pages.find((p) => p.name === pageName) : null;
  return entry.sheet.render(true, page ? { pageId: page.id } : {});
}

/**
 * The Game Settings menu entry. Settings menus instantiate and render an application; this one opens the
 * manual instead of drawing a window of its own.
 */
export class ManualLauncher extends foundry.applications.api.ApplicationV2 {
  async render() {
    await openManual();
    return this;
  }
}
