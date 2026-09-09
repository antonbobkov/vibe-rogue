// PLN-02 R2 — the core is headless.
//
// Every module under src/ except render.js, main.js, screens/* and the storage adapter in save.js
// must not reference window, document, localStorage, requestAnimationFrame, performance, or any
// other DOM API. This test scans the source, ignoring comments and string bodies (see D-002), so
// that a description or a log template mentioning one of these words is not a violation.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

// Files exempt from R2 in full: the render layer, the boot module, and every screen.
const EXEMPT_FILES = new Set(['src/render.js', 'src/main.js']);
const EXEMPT_DIRS = ['src/screens/'];

// src/save.js is scanned, but its localStorage adapter is explicitly allowed by R2 / TEC-02.
const PARTIAL_EXEMPTIONS = new Map([['src/save.js', new Set(['localStorage'])]]);

const FORBIDDEN = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'navigator',
  'location',
  'alert',
  'fetch',
  'XMLHttpRequest',
  'Image',
  'Audio',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'getElementById',
  'querySelector',
  'querySelectorAll',
  'createElement',
  'addEventListener',
  'removeEventListener',
  'devicePixelRatio',
  'getContext',
  'innerWidth',
  'innerHeight',
];

/**
 * Remove comments and string bodies, keeping `${...}` interpolations (which are real code).
 * Deliberately simple: it is a lint helper, not a parser.
 */
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
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      out += ' ';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          let expr = '';
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            expr += src[i];
            i++;
          }
          out += ` ${expr} `;
          continue;
        }
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

function repoPath(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

test('PLN-02 R2: no module under src/ outside the render layer touches the DOM @unit @m00', () => {
  const violations = [];
  for (const file of jsFiles(SRC)) {
    const rel = repoPath(file);
    if (EXEMPT_FILES.has(rel)) continue;
    if (EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
    const allowed = PARTIAL_EXEMPTIONS.get(rel) ?? new Set();
    const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
    const lines = code.split('\n');
    for (const name of FORBIDDEN) {
      if (allowed.has(name)) continue;
      const re = new RegExp(`\\b${name}\\b`);
      lines.forEach((line, n) => {
        if (re.test(line)) violations.push(`${rel}:${n + 1}: forbidden identifier '${name}'`);
      });
    }
  }
  assert.deepEqual(violations, [], `R2 violations:\n${violations.join('\n')}`);
});

test('PLN-02 R2: the exemption list only names files the layout allows @unit @m00', () => {
  const allowedNames = [...EXEMPT_FILES, ...PARTIAL_EXEMPTIONS.keys()];
  assert.deepEqual(
    [...allowedNames].sort(),
    ['src/main.js', 'src/render.js', 'src/save.js'],
    'R2 names exactly render.js, main.js, screens/* and the storage adapter in save.js',
  );
  assert.deepEqual(EXEMPT_DIRS, ['src/screens/']);
  for (const rel of EXEMPT_FILES) {
    if (fs.existsSync(path.join(ROOT, rel))) continue;
    assert.ok(rel !== 'src/main.js', 'src/main.js must exist — index.html loads it');
  }
});
