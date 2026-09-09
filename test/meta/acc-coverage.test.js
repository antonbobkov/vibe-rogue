// PLN-04 — ACC coverage.
//
// Parse every ACC-nnn ID from specs/32-acceptance-tests.md, collect every test title from test/**,
// and assert each ID is either named in a title or listed in test/meta/acc-allowlist.json.
// A stale allowlist entry (an ID that *is* covered) is also a failure. M00 creates the allowlist
// with every ID; each milestone removes the IDs it covers; M12 requires it empty.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = path.join(ROOT, 'specs', '32-acceptance-tests.md');
const TEST_DIR = path.join(ROOT, 'test');
const ALLOWLIST = path.join(ROOT, 'test', 'meta', 'acc-allowlist.json');

const ACC_ID = /\bACC-\d{2,3}\b/g;

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

function allTitles() {
  const out = [];
  for (const file of testFiles()) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(TITLE_CALL)) out.push(m[2]);
  }
  return out;
}

function sortIds(ids) {
  return [...ids].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
}

const specIds = sortIds(new Set(fs.readFileSync(SPEC, 'utf8').match(ACC_ID) ?? []));
const covered = new Set();
for (const title of allTitles()) for (const id of title.match(ACC_ID) ?? []) covered.add(id);
const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8'));

test('PLN-04: the acceptance spec still declares its ACC IDs @unit @m00', () => {
  assert.ok(specIds.length > 0, 'no ACC IDs parsed from specs/32-acceptance-tests.md');
  for (const id of ['ACC-01', 'ACC-70', 'ACC-133']) {
    assert.ok(specIds.includes(id), `${id} must be present in specs/32-acceptance-tests.md`);
  }
});

test('PLN-04: the allowlist is a sorted, deduplicated list of real ACC IDs @unit @m00', () => {
  assert.ok(Array.isArray(allowlist), 'acc-allowlist.json must be a JSON array');
  assert.deepEqual(allowlist, sortIds(new Set(allowlist)), 'acc-allowlist.json must be sorted and deduplicated');
  const unknown = allowlist.filter((id) => !specIds.includes(id));
  assert.deepEqual(unknown, [], `allowlist names IDs that are not in the spec: ${unknown.join(', ')}`);
});

test('PLN-04: every ACC ID is covered by a test title or allowlisted @unit @m00', () => {
  const allowed = new Set(allowlist);
  const missing = specIds.filter((id) => !covered.has(id) && !allowed.has(id));
  assert.deepEqual(missing, [], `ACC IDs neither tested nor allowlisted: ${missing.join(', ')}`);
});

test('PLN-04: the allowlist holds no stale entries @unit @m00', () => {
  const stale = allowlist.filter((id) => covered.has(id));
  assert.deepEqual(stale, [], `allowlisted ACC IDs that are already covered: ${stale.join(', ')}`);
});
