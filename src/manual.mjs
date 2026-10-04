/**
 * The in-system User Manual: `src/manual/NN-slug.md` → one JournalEntry ("Sacadia User Manual") with a text
 * page per file, built into the `user-manual` compendium by build-packs.mjs. Pages are stored as HTML (the
 * format Foundry renders without a client-side conversion step).
 *
 * The Markdown converter covers the subset the manual uses: `#`–`####` headings, paragraphs, `-` and `1.` lists
 * (one nested level, two-space indent), `|` tables, `>` quotes, `---` rules, and inline **bold**, *italic*, ![images](src),
 * `code` and [links](url). Kept deliberately small — no dependency.
 */
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting: code spans first (their contents stay literal), then links, bold, italic. */
export function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1"/>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** Convert one Markdown document to HTML. Returns { title, html } (title = the first `#` heading). */
export function markdownToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let title = '';
  let para = [];
  let list = null; // { tag, items: [{ text, sub: {tag, items} | null }] }
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const renderList = (l) => `<${l.tag}>${l.items.map((it) => `<li>${inline(it.text)}${it.sub ? renderList(it.sub) : ''}</li>`).join('')}</${l.tag}>`;
  const flushList = () => { if (list) out.push(renderList(list)); list = null; };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); if (list && !/^\s+\S/.test(lines[i + 1] ?? '') && !/^(\s*)([-*]|\d+\.)\s/.test(lines[i + 1] ?? '')) flushList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length === 1 && !title) { title = h[2].trim(); continue; }
      out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { flush(); out.push('<hr/>'); continue; }
    if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|\s*:?-{3,}/.test(r));
      const [head, ...rest] = body;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (line.startsWith('>')) { flush(); out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`); continue; }
    const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      const nested = li[1].length >= 2;
      if (!nested) {
        if (list && list.tag !== tag) flushList();
        list ??= { tag, items: [] };
        list.items.push({ text: li[3], sub: null });
      } else if (list?.items.length) {
        const parent = list.items.at(-1);
        parent.sub ??= { tag, items: [] };
        parent.sub.items.push({ text: li[3], sub: null });
      }
      continue;
    }
    // A continuation line of a list item (indented prose under a bullet).
    if (list && /^\s{2,}\S/.test(raw)) {
      const parent = list.items.at(-1);
      const target = parent.sub?.items.at(-1) ?? parent;
      target.text += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flush();
  return { title, html: out.join('\n') };
}

/**
 * Build the manual's JournalEntry + pages from a folder of Markdown files (sorted by name).
 * @param {string} dir
 * @param {(key:string)=>string} makeId  stable 16-char id from a key
 */
export function buildManual(dir, makeId) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const entryId = makeId('manual');
  const pages = files.map((f, i) => {
    const { title, html } = markdownToHtml(fs.readFileSync(path.join(dir, f), 'utf8'));
    const _id = makeId(`page:${f}`);
    return {
      _id, _key: `!journal.pages!${entryId}.${_id}`,
      name: title || f.replace(/^\d+-|\.md$/g, ''), type: 'text', sort: (i + 1) * 100000,
      title: { show: true, level: 1 },
      text: { format: 1, content: html },
      ownership: { default: -1 }, flags: {},
    };
  });
  const entry = {
    _id: entryId, _key: `!journal!${entryId}`, name: 'Sacadia User Manual',
    pages: pages.map((p) => p._id), ownership: { default: 2 }, sort: 0, flags: { sacadia: { manual: true } },
  };
  return { entry, pages };
}
