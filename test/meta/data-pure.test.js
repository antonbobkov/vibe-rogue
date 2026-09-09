// PLN-02 R3 — data is data.
//
// Modules under data/ export frozen plain objects and contain no logic: no `function`, no `=>`,
// no `class`. Comments and string bodies are ignored (D-002) so that an item description may
// contain any prose it likes.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'data');

const FORBIDDEN = [
  { label: 'function', re: /\bfunction\b/ },
  { label: '=>', re: /=>/ },
  { label: 'class', re: /\bclass\b/ },
];

function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('PLN-02 R3: modules under data/ contain no functions, arrows or classes @unit @m00', () => {
  const violations = [];
  for (const file of jsFiles(DATA)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, n) => {
      for (const { label, re } of FORBIDDEN) {
        if (re.test(line)) violations.push(`${rel}:${n + 1}: data modules may not contain '${label}'`);
      }
    });
  }
  assert.deepEqual(violations, [], `R3 violations:\n${violations.join('\n')}`);
});
