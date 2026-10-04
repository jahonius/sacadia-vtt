// Breach Chuni's Wall — run as the GM with the demon's token selected, once it reaches the wall.
// The demon smashes a hole as wide as its token. On the Ground level the wall's faces there come out (and the hole's
// sides are walled, so the rest of the wall stays solid). On the Wall Top level the hole is fenced off: nobody can cross
// the walkway east–west past it. It can't be undone; re-importing the adventure restores the scene.
const scene = canvas.scene;
const cfg = scene?.getFlag('sacadia', 'breach');
if (!game.user.isGM) return ui.notifications.warn('Only the GM can breach the wall.');
if (!cfg) return ui.notifications.warn("This scene has no breachable wall (open Chuni's Wall).");
const tok = canvas.tokens.controlled[0]?.document;
if (!tok) return ui.notifications.warn("Select the demon's token first.");

const size = scene.grid.size;
const { sceneRect } = scene.dimensions;
const x0 = Math.max(sceneRect.left, Math.round(tok.x / size) * size);
const x1 = Math.min(sceneRect.right, x0 + Math.round(tok.width) * size);
// The wall's breachable pieces inside the hole: its faces, and anything crossing it (the gate is smashed too).
const inHole = (w) => {
  const [ax, ay, bx, by] = w.c;
  if (!w.flags?.sacadia?.breach || !w.levels.has(cfg.ground)) return false;
  if (Math.min(ay, by) < cfg.north || Math.max(ay, by) > cfg.south) return false;
  return ax === bx ? (ax >= x0 && ax <= x1) : (Math.max(ax, bx) > x0 && Math.min(ax, bx) < x1);
};
const remove = scene.walls.filter(inHole).map((w) => w.id);
if (!remove.length) return ui.notifications.warn("The selected token isn't over the wall.");

const wall = (c, level, kind) => ({ c, levels: [level], ...cfg.kinds[kind], flags: { sacadia: { breach: true } } });
const add = [];
if (x0 > sceneRect.left) add.push(wall([x0, cfg.north, x0, cfg.south], cfg.ground, 'stone'));
if (x1 < sceneRect.right) add.push(wall([x1, cfg.north, x1, cfg.south], cfg.ground, 'stone'));
add.push(wall([x0, cfg.topNorth, x0, cfg.topSouth], cfg.top, 'low'), wall([x1, cfg.topNorth, x1, cfg.topSouth], cfg.top, 'low'));

await scene.deleteEmbeddedDocuments('Wall', remove);
await scene.createEmbeddedDocuments('Wall', add);
await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ token: tok }),
  content: `<p><strong>${tok.name}</strong> smashes through Chuni's Wall! The wall top is cut in two — no one can cross it east to west.</p>`,
});
