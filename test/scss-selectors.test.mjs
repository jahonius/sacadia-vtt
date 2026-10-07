/**
 * A selector list must not be interrupted by a comment: a line ending in "," followed by a comment line is almost always
 * a rule pasted into the middle of a list, which makes the list's earlier selectors part of that rule (`.sheet-header,` +
 * a commented badge rule made the sheet header the badge). Other splits look like valid two-selector rules to a line
 * scan; the in-Foundry sheet test checks the outcome (the header's height, the headings' style).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scss');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.scss') ? [path.join(dir, e.name)] : []));

test('no SCSS selector list has a comment in the middle of it', () => {
  const problems = [];
  for (const file of files(root)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // A selector line ending a list item (not a property value continued over lines: those hold ":" or "(").
      if (!/,\s*$/.test(line) || /[:(]/.test(line.replace(/:(hover|focus|focus-visible|first-child|last-child|not|has|first-of-type|is|where|before|after)\b/g, '')) || line.trim().startsWith('//')) return;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if ((lines[j] ?? '').trim().startsWith('//')) problems.push(`${path.relative(root, file)}:${i + 1}: "${line.trim()}" is followed by a comment`);
    });
  }
  assert.deepEqual(problems, []);
});
