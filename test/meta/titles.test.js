// PLN-02 R5 — tests name their spec.
//
// Every test title contains the ACC ID(s) it verifies, or `@unit` for module-level tests, and
// exactly one milestone tag @m00..@m13.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DIR = path.join(ROOT, 'test');

const MILESTONE_TAG = /@m\d+/g;
const VALID_TAG = /^@m(0[0-9]|1[0-3])$/;
const NAMES_A_SPEC = /\bACC-\d{2,3}\b|@unit\b/;

/** Remove comments but keep string bodies intact (titles live in strings). */
function stripComments(src) {
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
      out += c;
      i++;
      while (i < n) {
        out += src[i];
        if (src[i] === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const TITLE_CALL = /(?<![\w$.])(?:test|it)(?:\.(?:skip|only|todo))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Every test title declared in `file`, in source order. */
function titlesIn(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const m of src.matchAll(TITLE_CALL)) out.push(m[2]);
  return out;
}

/** Every `*.test.js` / `*.spec.js` file under test/, recursively, in a stable order. */
function testFiles(dir = TEST_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.isFile() && /\.(test|spec)\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

function collect() {
  const rows = [];
  for (const file of testFiles()) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const title of titlesIn(file)) rows.push({ rel, title });
  }
  return rows;
}

test('PLN-02 R5: every test title carries exactly one milestone tag @unit @m00', () => {
  const problems = [];
  for (const { rel, title } of collect()) {
    const tags = title.match(MILESTONE_TAG) ?? [];
    if (tags.length !== 1) {
      problems.push(`${rel}: "${title}" has ${tags.length} milestone tags (expected exactly 1)`);
      continue;
    }
    if (!VALID_TAG.test(tags[0])) problems.push(`${rel}: "${title}" has an out-of-range milestone tag ${tags[0]}`);
  }
  assert.deepEqual(problems, [], `R5 violations:\n${problems.join('\n')}`);
});

test('PLN-02 R5: every test title names an ACC ID or is marked @unit @m00', () => {
  const problems = [];
  for (const { rel, title } of collect()) {
    if (!NAMES_A_SPEC.test(title)) problems.push(`${rel}: "${title}" names neither an ACC ID nor @unit`);
  }
  assert.deepEqual(problems, [], `R5 violations:\n${problems.join('\n')}`);
});

test('PLN-02 R5: the title scanner actually finds titles @unit @m00', () => {
  const rows = collect();
  assert.ok(rows.length >= 5, `expected the repo to declare tests; found ${rows.length}`);
  const files = new Set(rows.map((r) => r.rel));
  assert.ok(files.has('test/meta/titles.test.js'), 'the scanner must see this file');
  assert.ok([...files].some((f) => f.startsWith('test/e2e/')), 'the scanner must see the e2e specs');
});
