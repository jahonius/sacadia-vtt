// Prologue: The Road to the Wall — run as the GM to open The Breach on the world map (the GM guide's Prologue page).
// It shows The Ardus Yauga to everyone. With Augur: Nexus, it makes Chuni's Wall a site on the map (once): click the
// site to step into the battle map. With Indy Route, it plays The Road to the Wall for everyone, and the first time it
// offers to add Sacadia's travel speeds to Indy Route's travel modes. Without the modules, the map is there to talk over.
if (!game.user.isGM) return ui.notifications.warn('Only the GM can run the prologue.');
const world = game.scenes.find((s) => s.getFlag('sacadia', 'prologue'));
const wall = game.scenes.find((s) => s.getFlag('sacadia', 'breach'));
if (!world) return ui.notifications.warn('Import The Breach first: its world map, The Ardus Yauga, is missing.');
const cfg = world.getFlag('sacadia', 'prologue');
const nexusOn = !!game.modules.get('augur-nexus')?.active;
const indy = game.modules.get('indy-route')?.active ? game.modules.get('indy-route').api : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Augur: Nexus: Chuni's Wall as a site on the world map that opens the battle map. Made once, through Nexus's API. The
// map is the world's Nexus scene (the root of the Nexus browser's tree) unless the world already has one.
if (nexusOn && wall) {
  if (!game.scenes.some((s) => s.getFlag('augur-nexus', 'nexusRoot'))) await world.setFlag('augur-nexus', 'nexusRoot', true);
  const sites = Object.values(world.getFlag('augur-nexus', 'sites')?.records ?? {});
  if (!sites.some((s) => s.linkedSceneId === wall.id)) {
    const nexus = await import(foundry.utils.getRoute('modules/augur-nexus/scripts/api/index.js'));
    await nexus.createLinkedSceneSite(world, wall, {
      siteName: cfg.site.name, x: cfg.site.x, y: cfg.site.y, iconSize: cfg.site.iconSize, showLabel: false, // the map names the wall
      siteGenre: 'fantasy', siteGenreLabel: 'Fantasy', siteSceneType: 'existing', siteSceneTypeLabel: 'Existing Scene',
      siteTheme: 'castle', siteThemeLabel: 'Castle', siteIconRole: 'landmark', siteIconRoleLabel: 'Landmark',
      iconId: 'citadel', iconSrc: 'modules/augur-nexus/assets/site_icons/fantasy/citadel.png',
      mapColorId: 'red', mapColorLabel: 'Red', siteColor: '#f3e7c9',
    });
  }
}

// Indy Route: Sacadia's travel speeds for the road's tooltip, the first time (yours are kept).
if (indy && !cfg.travelAsked) {
  const modes = game.settings.get('indy-route', 'travelModes') ?? [];
  if (!modes.some((m) => m.id?.startsWith('sacadia-'))) {
    const add = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Sacadia Travel Speeds' },
      content: '<p>Add Sacadia\'s land travel speeds to Indy Route\'s travel modes? That\'s on foot, light mount, wagon, heavy cart and '
        + 'mount relay, each off roads, on dirt roads and on stone roads (rulebook p.286). The Route Manager\'s tooltip for the road '
        + 'then says how many days it takes.</p><p>Your current travel modes are kept.</p>',
    });
    if (add) await game.settings.set('indy-route', 'travelModes', [...modes, ...cfg.travelModes]);
  }
  await world.setFlag('sacadia', 'prologue.travelAsked', true);
}

// The map, for everyone; then the road, once this client has drawn it (the players' canvases draw alongside).
await world.activate();
for (let i = 0; i < 150 && !(canvas.ready && canvas.scene?.id === world.id); i++) await sleep(100);
if (indy) {
  await sleep(1500);
  indy.playRoute(cfg.road);
} else ui.notifications.info('Indy Route isn\'t active: tell the table about the road from Tianois to the wall (the Prologue page).');
if (!nexusOn) ui.notifications.info('Augur: Nexus isn\'t active: open Chuni\'s Wall from the Scenes tab when you\'re ready.');
