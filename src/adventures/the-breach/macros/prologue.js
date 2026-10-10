// Prologue: The Ardus Yauga — run as the GM to open The Breach on the world map (the GM guide's Prologue page). It
// shows The Ardus Yauga to everyone. With Augur: Nexus, it files the area there, once, through Nexus's API:
//   - the map as the world's Nexus scene (asking first if the world has another one);
//   - Chuni's Wall as a site on it that opens the battle map;
//   - the Tianqi and Ager's Demons as organizations, their people (the demons and the heroes, linked to their actors),
//     and the quest Man the Wall.
// Running it again only fills in what's missing. The journey itself is the Travel Ledger's (the other macro).
if (!game.user.isGM) return ui.notifications.warn('Only the GM can run the prologue.');
const world = game.scenes.find((s) => s.flags?.sacadia?.prologue);
const wall = game.scenes.find((s) => s.flags?.sacadia?.breach);
if (!world) return ui.notifications.warn('Import The Breach first: its world map, The Ardus Yauga, is missing.');
const cfg = world.flags.sacadia.prologue;
const NEXUS = 'augur-nexus';

if (game.modules.get(NEXUS)?.active) {
  const nexus = await import(foundry.utils.getRoute(`modules/${NEXUS}/scripts/api/index.js`));
  const quests = await import(foundry.utils.getRoute(`modules/${NEXUS}/scripts/api/quests.js`));

  // The Nexus scene (the top of the Nexus browser's tree): there's one per world.
  const root = game.scenes.find((s) => s.getFlag(NEXUS, 'nexusRoot'));
  if (root?.id !== world.id) {
    const swap = !root || await foundry.applications.api.DialogV2.confirm({
      window: { title: 'The Nexus Scene' },
      content: `<p>Make <strong>${world.name}</strong> this world's Nexus scene, the top of the Nexus browser's tree? It's `
        + `<strong>${foundry.utils.escapeHTML(root.name)}</strong> now, which stays as it is otherwise.</p>`,
    });
    if (swap) {
      for (const s of game.scenes.filter((x) => x.getFlag(NEXUS, 'nexusRoot') && x.id !== world.id)) await s.setFlag(NEXUS, 'nexusRoot', false);
      await world.setFlag(NEXUS, 'nexusRoot', true);
    }
  }

  // Chuni's Wall: a site on the map that opens the battle map.
  if (wall && !Object.values(world.getFlag(NEXUS, 'sites')?.records ?? {}).some((s) => s.linkedSceneId === wall.id)) {
    await nexus.createLinkedSceneSite(world, wall, {
      siteName: cfg.site.name, x: cfg.site.x, y: cfg.site.y, iconSize: cfg.site.iconSize, showLabel: false, // the map names the wall
      siteGenre: 'fantasy', siteGenreLabel: 'Fantasy', siteSceneType: 'existing', siteSceneTypeLabel: 'Existing Scene',
      siteTheme: 'castle', siteThemeLabel: 'Castle', siteIconRole: 'landmark', siteIconRoleLabel: 'Landmark',
      iconId: 'citadel', iconSrc: 'modules/augur-nexus/assets/site_icons/fantasy/citadel.png',
      mapColorId: 'red', mapColorLabel: 'Red', siteColor: '#f3e7c9',
    });
  }

  // What's been filed, by key: kept on the map, so a second run only adds what's missing (or was deleted).
  const ids = foundry.utils.deepClone(cfg.nexusIds ?? { factions: {}, people: {}, quest: '' });
  const entry = (entity) => game.journal.find((j) => j.flags?.[NEXUS]?.campaignEntity?.id === entity?.id);
  const writePage = async (entity, html) => {
    const page = entry(entity)?.pages.find((p) => p.type === 'text');
    if (page) await page.update({ 'text.content': html });
  };

  for (const f of cfg.nexus.factions) {
    if (ids.factions[f.key] && nexus.getFaction(ids.factions[f.key])) continue;
    const made = await nexus.createFaction({ display: { name: f.name, imageSrc: f.img, color: f.color }, profile: f.profile, tags: ['The Breach'] });
    ids.factions[f.key] = made.id;
    await writePage(made, f.html);
  }
  for (const p of cfg.nexus.people) {
    let person = ids.people[p.key] ? nexus.getNpc(ids.people[p.key]) : null;
    if (!person) {
      person = await nexus.createNpc({
        display: { name: p.name, imageSrc: p.img, tokenImageSrc: p.img }, identity: { personKind: p.pc ? 'player-character' : 'npc' },
        role: { roleLabel: p.role }, flavor: { descriptor: p.descriptor }, tags: ['The Breach'],
        // Linked to its actor; the actor's art is left alone.
        projections: { actorUuid: p.actorUuid, syncActorPortrait: false, syncActorToken: false },
      });
      ids.people[p.key] = person.id;
      await writePage(person, p.html);
      const faction = nexus.getFaction(ids.factions[p.faction]);
      const [ft, pt] = [nexus.getFactionConnectionTarget(faction), nexus.getNpcConnectionTarget(person)];
      if (ft && pt) await (p.leader ? nexus.setFactionLeader(ft, pt) : nexus.setFactionMember(ft, pt));
    }
  }

  if (!ids.quest || !(await quests.getQuest(ids.quest).catch(() => null))) {
    const q = cfg.nexus.quest;
    const quest = await quests.createQuest({
      title: q.title, image: q.image, journalHtml: q.html, gmNotes: q.gmNotes, status: q.status, audience: q.audience,
      objectives: q.objectives.map(({ key, ...o }) => o), rewardNotes: q.reward ? [{ text: q.reward }] : [],
    });
    ids.quest = quest.id;
    // Who gave it, who opposes it, whom to kill: Nexus connections on its objectives.
    let current = quest;
    const goal = (key) => current.objectives[q.objectives.findIndex((o) => o.key === key)]?.id ?? '';
    for (const [slot, goalKey, target] of q.links) {
      const entity = nexus.getFaction(ids.factions[target]) ?? nexus.getNpc(ids.people[target]);
      const uuid = entry(entity)?.uuid;
      if (!uuid) continue;
      await quests.connectQuestEntity(current.id, current.revision, { targetUuid: uuid, slot, goalId: goalKey ? goal(goalKey) : '' });
      current = await quests.getQuest(current.id);
    }
  }
  await world.setFlag('sacadia', 'prologue.nexusIds', ids);
}

// The map, for everyone.
await world.activate();
if (!game.modules.get(NEXUS)?.active) ui.notifications.info('Augur: Nexus isn\'t active: open Chuni\'s Wall from the Scenes tab when you\'re ready.');
ui.notifications.info('Take the road with the Travel Ledger macro, a day at a time.');
