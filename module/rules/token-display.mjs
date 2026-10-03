/**
 * Condition levels and statuses on tokens: keeping status icons in step with condition levels, and drawing the level
 * numbers over them.
 */

// The leveled conditions live only in the actor's schema tracker (0–6), so nothing showed on the
// token. Project each active one (and non-none Cover) onto the token as a real status effect via the
// same `toggleStatusEffect` path the simple conditions use (guaranteed to render + appear in the HUD
// palette). The status carries NO `changes` — automation still runs off the schema tracker — it is
// pure visibility. The level rides in the effect name ("Hemorrhage 3"). One-way schema → icon, plus a
// backward reflect (reflectStatusToSchema) so a HUD toggle stays consistent. GM-side only.
export async function syncConditionEffects(actor) {
  if (!actor || game.users.activeGM !== game.user) return;
  const cap = CONFIG.SACADIA.conditionMax;

  // Purge leftover mirror effects from the earlier direct-AE implementation: they don't render in
  // v13 but still register their status, which fools the `has` check below into thinking the icon is
  // already present — so the renderable one never gets toggled on. Remove them so the sync recreates
  // a proper, renderable status via `toggleStatusEffect`.
  const stale = actor.effects.filter((e) => e.getFlag?.('sacadia', 'condMirror')).map((e) => e.id);
  if (stale.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stale);

  for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
    const v = Math.min(actor.system.conditions?.[key]?.value ?? 0, cap);
    const has = actor.statuses.has(key);
    if (v > 0 && !has) await actor.toggleStatusEffect(key, { active: true });
    else if (v <= 0 && has) await actor.toggleStatusEffect(key, { active: false });
    // Keep the level in the icon's name for at-a-glance / hover ("Hemorrhage 3").
    if (v > 0) {
      const eff = actor.effects.find((e) => e.statuses.has(key));
      const name = `${game.i18n.localize(cfg.label)} ${v}`;
      if (eff && eff.name !== name) await eff.update({ name });
    }
  }

  for (const key of Object.keys(CONFIG.SACADIA.coverStates)) {
    if (key === 'none') continue;
    const on = actor.system.cover === key;
    const has = actor.statuses.has(`cover-${key}`);
    if (on !== has) await actor.toggleStatusEffect(`cover-${key}`, { active: on });
  }
}

export async function reflectStatusToSchema(effect, created) {
  if (game.users.activeGM !== game.user) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  for (const id of effect.statuses ?? []) {
    if (id in CONFIG.SACADIA.conditions) {
      const cur = actor.system.conditions?.[id]?.value ?? 0;
      if (created && cur === 0) await actor.update({ [`system.conditions.${id}.value`]: 1 });
      else if (!created && cur > 0) await actor.update({ [`system.conditions.${id}.value`]: 0 });
    } else if (id.startsWith('cover-')) {
      const key = id.slice(6);
      if (created && actor.system.cover !== key) await actor.update({ 'system.cover': key });
      else if (!created && actor.system.cover === key) await actor.update({ 'system.cover': 'none' });
    }
  }
}

export function drawConditionLevels(token, force) {
  try {
    const effects = token?.effects;
    const actor = token?.actor;
    if (!effects || !actor) return;

    // Signature of what we'd draw, so ordinary refreshes (movement fires this every frame) skip the
    // rebuild when nothing changed.
    const levels = {};
    for (const key of Object.keys(CONFIG.SACADIA.conditions)) {
      const v = actor.system.conditions?.[key]?.value ?? 0;
      if (v > 0) levels[key] = v;
    }
    const sig = Object.entries(levels).map(([k, v]) => `${k}:${v}`).join(',');
    const hasBadges = effects.children.some((c) => c.sacadiaBadge);
    if (!force && sig === token._sacadiaBadgeSig && hasBadges) return;
    token._sacadiaBadgeSig = sig;

    for (const c of collectBadges(effects)) { c.parent?.removeChild(c); c.destroy?.({ children: true }); }
    if (!sig) return;

    // Match icon sprites to conditions by TEXTURE PATH (v13's `temporaryEffects` is empty for
    // statuses, so draw-order pairing doesn't work). Deep-search the effects container for icon
    // sprites and, for each, find an active condition whose img the sprite shows. Shared imgs
    // (e.g. two blood.svg conditions) are consumed in encounter order.
    const wantByImg = new Map(); // condition img → queue of levels to stamp
    for (const [key, cfg] of Object.entries(CONFIG.SACADIA.conditions)) {
      if (!levels[key]) continue;
      if (!wantByImg.has(cfg.img)) wantByImg.set(cfg.img, []);
      wantByImg.get(cfg.img).push(levels[key]);
    }
    const iconSprites = collectIconSprites(effects);

    // Bail if the icons aren't laid out yet — on the first draw they sit at (0,0) with width 0, so a
    // badge would flash at the token's top-left before core positions them. We drew no badges, so the
    // `hasBadges` gate lets the next refresh retry once they're settled — no flash, no stuck state.
    const tw = token.w || (canvas?.dimensions?.size ?? 100);
    if (!iconSprites.length || !iconSprites.every((s) => s.width > 1 && s.width <= tw)) return;

    // Use the namespaced class ONLY — touching the deprecated global `PreciseText` throws in v13
    // (its compatibility warning is error-mode), which would abort the draw.
    const TextCls = foundry.canvas?.containers?.PreciseText ?? PIXI.Text;
    for (const sprite of iconSprites) {
      const src = spriteSrc(sprite);
      let level;
      for (const [img, queue] of wantByImg) {
        if (queue.length && src.includes(img)) { level = queue.shift(); break; }
      }
      if (!level) continue;
      const w = sprite.width || 20, h = sprite.height || w;
      // The icon sprite is anchored at its center in v13, so its bottom-right corner in parent coords
      // is x + (1-anchorX)*w, y + (1-anchorY)*h. Compute from the actual anchor to be layout-agnostic.
      const ax = sprite.anchor?.x ?? 0, ay = sprite.anchor?.y ?? 0;
      const style = CONFIG.canvasTextStyle.clone();
      style.fontSize = 24;
      style.fill = '#ffffff';
      const badge = new TextCls(String(level), style);
      badge.sacadiaBadge = true;
      badge.anchor.set(1, 1);                              // pin the badge's own bottom-right...
      badge.x = sprite.x + (1 - ax) * w;                   // ...to the icon's bottom-right corner
      badge.y = sprite.y + (1 - ay) * h;
      badge.scale.set(Math.min(1, (h * 0.55) / badge.height));
      (sprite.parent ?? effects).addChild(badge);          // same coord space as the icon
    }
  } catch (err) {
    console.warn('Sacadia | condition level badge draw failed', err);
  }
}

/** A sprite's texture source path (best-effort across PIXI versions). */
export function spriteSrc(s) {
  const t = s?.texture;
  return t?.baseTexture?.resource?.src ?? t?.baseTexture?.resource?.url ?? t?.textureCacheIds?.[0] ?? '';
}

/** Deep-collect PIXI.Sprite descendants that look like a status icon (have a resolvable texture src). */
export function collectIconSprites(container, out = []) {
  for (const c of container?.children ?? []) {
    if (c.sacadiaBadge) continue;
    if (c instanceof PIXI.Sprite && spriteSrc(c)) out.push(c);
    if (c.children?.length) collectIconSprites(c, out);
  }
  return out;
}

/** Deep-collect our previously-drawn badges anywhere under a container. */
export function collectBadges(container, out = []) {
  for (const c of container?.children ?? []) {
    if (c.sacadiaBadge) out.push(c);
    else if (c.children?.length) collectBadges(c, out);
  }
  return out;
}
