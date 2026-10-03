/**
 * Shared lookups on actors, items and tokens: one definition each, in place of the inline copies the sheet and the
 * GM-side code used to carry. The item helpers work on documents or plain data (unit-tested); the token and dialog helpers
 * touch Foundry only when called.
 */

/** Is the actor maintaining this ability's Focus (a positive streak — helpers/focus.mjs)? */
export const maintainsFocus = (actor, id) => (actor?.system?.combatState?.focusRounds?.[id] ?? 0) > 0;

/**
 * Completionist (Bladedancer): Multiplicity has touched every enemy still in the fight — from an actor's modifier numbers
 * (`@combat.enemies`, `@combat.focusTargets.bd_multiplicity`).
 */
export function completionist(numbers) {
  const enemies = numbers?.['combat.enemies'] ?? 0;
  return enemies > 0 && (numbers?.['combat.focusTargets.bd_multiplicity'] ?? 0) >= enemies;
}

/** An item's catalog id (its compendium identity), or '' for a homebrew item. */
export const catalogIdOf = (item) => item?.flags?.sacadia?.catalogId ?? '';

/** Does the actor own this ability (by catalog id)? */
export function ownsAbility(actor, id) {
  return !!id && !!actor?.items?.some?.((i) => i.type === 'ability' && catalogIdOf(i) === id);
}

/** The actor's ability item with this catalog id, or null. */
export function abilityItem(actor, id) {
  return (id && actor?.items?.find?.((i) => i.type === 'ability' && catalogIdOf(i) === id)) || null;
}

/**
 * A gear item's identity: its catalog id, or — for a homebrew item — its name in the same form ("Rabbit's Paw" →
 * `rabbit_s_paw`). A renamed compendium item keeps working; a hand-made one still matches by name.
 */
export function gearId(item) {
  return catalogIdOf(item) || String(item?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** The roll-option slug for a gear item (`self:gear:<slug>`): its gear id with hyphens (`moonstone-earrings`). */
export const gearSlug = (item) => gearId(item).replace(/_/g, '-');

/**
 * The actor's first non-ability item with this gear id (or, with `prefix`, an id starting with it — Smudge comes in
 * kinds), passing `where`: 'any' (default), 'hand' (not in a Stored Item Slot) or 'equipped'.
 */
export function findGear(actor, id, { prefix = false, where = 'any' } = {}) {
  return actor?.items?.find?.((i) => {
    if (i.type === 'ability') return false;
    const g = gearId(i);
    if (prefix ? !g.startsWith(id) : g !== id) return false;
    if (where === 'hand') return i.system?.storage !== 'sis';
    if (where === 'equipped') return !!i.system?.equipped;
    return true;
  }) ?? null;
}

/** Armor materials (book p.190 armor types, plus the Dye sets and metal shields). */
export const ARMOR_MATERIALS = ['feather', 'cloth', 'dye', 'leather', 'fur', 'bronze', 'iron', 'gold', 'bone', 'ink', 'wood', 'metal'];

/** The material named in an armor or shield's name ("Basic Iron Set" → iron), or ''. Used by the build and as a fallback. */
export function inferMaterial(name) {
  const n = String(name ?? '').toLowerCase();
  return ARMOR_MATERIALS.find((m) => new RegExp(`\\b${m}\\b`).test(n)) ?? '';
}

/** A shield's size from its name: tower, buckler, or a plain shield. */
export function inferShieldSize(name) {
  return /tower/i.test(name ?? '') ? 'tower' : /buckler/i.test(name ?? '') ? 'buckler' : 'shield';
}

/** An armor piece's material: its `material` field, or (an item from before the field) read from its name. */
export const armorMaterial = (item) => item?.system?.material || inferMaterial(item?.name);

/** A shield's size: its `shieldSize` field, or read from its name. '' for armor that isn't a shield. */
export function shieldSize(item) {
  if (item?.system?.weaponType !== 'shield') return '';
  return item.system.shieldSize || inferShieldSize(item.name);
}

/**
 * Every actor in the world: the world's actors and each scene's unlinked token actors — not just the tokens on the scene
 * being viewed (a GM looking at another scene must not miss, or wrongly reap, what's on this one).
 */
export function everyActor() {
  const out = new Set(game.actors);
  for (const scene of game.scenes) for (const t of scene.tokens) if (!t.actorLink && t.actor) out.add(t.actor);
  return [...out];
}

/* -------------------------------------------- */
/*  Tokens                                      */
/* -------------------------------------------- */

/** The actor's first placed token (linked actors and token-actors). */
export function actorToken(actor) {
  return actor?.token?.object ?? actor?.getActiveTokens?.()?.[0] ?? null;
}

/** Centre-to-centre grid distance between two tokens, in scene units (ft), or null off-canvas. */
export function tokenDistance(a, b) {
  if (!a || !b || !globalThis.canvas?.grid) return null;
  const c = (t) => ({ x: t.document.x + (t.document.width * canvas.grid.size) / 2, y: t.document.y + (t.document.height * canvas.grid.size) / 2 });
  return canvas.grid.measurePath([c(a), c(b)])?.distance ?? null;
}

/** A token's disposition (a Token or a TokenDocument), 0 (neutral) when unknown. */
export const dispositionOf = (token) => token?.document?.disposition ?? token?.disposition ?? 0;

/** Are two tokens on the same (non-neutral) side? */
export function allied(a, b) {
  const da = dispositionOf(a);
  return da !== 0 && da === dispositionOf(b);
}

/**
 * Are two tokens on opposing sides? Hostility is a disposition different from the other's; a neutral token counts as
 * neither side's.
 */
export function opposed(a, b) {
  const da = dispositionOf(a);
  const db = dispositionOf(b);
  return da !== 0 && db !== 0 && da !== db;
}

/* -------------------------------------------- */
/*  Dialogs                                     */
/* -------------------------------------------- */

/** Whisper a note to the GM (an optional `flags.sacadia` request rides along — see resolveRequests in sacadia.mjs). */
export function gmNote(html, flags = null) {
  return ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id), content: `<div class="sacadia gm-note">${html}</div>`,
    ...(flags ? { flags: { sacadia: flags } } : {}) });
}

/**
 * The warn-but-allow confirmation used across the system: a titled dialog with one paragraph (HTML). Resolves true to go
 * ahead; false (or closed) to call it off.
 */
export function confirmWarn(title, html) {
  return foundry.applications.api.DialogV2.confirm({ window: { title }, content: `<p>${html}</p>`, rejectClose: false });
}
