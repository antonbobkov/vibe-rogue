// ACC-133 — no placeholder markers survive in the documentation.
//
//   | ACC-133 | All docs | Search for placeholder markers (to-be-decided notes, question-mark
//   | runs) | None; every value in the specs is fixed (`OVR-07` rule 10). |
//
// OVR-07 rule 10 is the rule behind it: "No 'to be decided' markers of any kind remain in the
// final specs; every value is fixed. If a builder finds an undefined case, that is a spec bug to
// be fixed here, not a choice."
//
// Two spec lines *state* that rule and therefore have to name the markers it forbids — OVR-07
// rule 10 itself and ACC-133's own row. Both are exempt (D-108); a rule cannot forbid its own
// wording. Nothing else is exempt.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPECS = path.join(ROOT, 'specs');

/** ACC-133's "all docs": every Markdown file under `specs/`, plus the two at the repo root. */
const ROOT_DOCS = ['README.md', 'CHANGELOG.md'];

/**
 * The markers a to-be-decided note is written with, and the question-mark run ACC-133 names.
 * Case-insensitive; the word-shaped ones are matched on word boundaries so a name that merely
 * contains the letters (there is none today) could not trip the scan.
 */
const MARKERS = [
  { name: 'TBD', re: /\bTBD\b/i },
  { name: 'TBC', re: /\bTBC\b/i },
  { name: 'TODO', re: /\bTODO\b/i },
  { name: 'FIXME', re: /\bFIXME\b/i },
  { name: 'XXX', re: /\bXXX\b/i },
  { name: 'HACK', re: /\bHACK\b/i },
  { name: 'WIP', re: /\bWIP\b/i },
  { name: 'to be decided', re: /to[ -]be[ -]decided/i },
  { name: 'to be determined', re: /to[ -]be[ -]determined/i },
  { name: 'to be confirmed', re: /to[ -]be[ -]confirmed/i },
  { name: 'to be specified', re: /to[ -]be[ -]specified/i },
  { name: 'to be supplied', re: /to[ -]be[ -]supplied/i },
  { name: 'to be chosen', re: /to[ -]be[ -]chosen/i },
  { name: 'to be filled in', re: /to[ -]be[ -]filled/i },
  { name: 'decide later', re: /decide[ -]later/i },
  { name: 'question-mark run', re: /\?{2,}/ },
];

/** The two self-referential lines: OVR-07 rule 10, and ACC-133's row in the acceptance spec. */
function statesTheRuleItself(line) {
  return line.includes('ACC-133') || line.includes('**Placeholders.**');
}

/** Every documentation file ACC-133 covers, as repo-relative paths. */
function docFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(SPECS);
  for (const name of ROOT_DOCS) {
    const full = path.join(ROOT, name);
    if (fs.existsSync(full)) out.push(full);
  }
  return out.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
}

test('the specs carry no placeholder markers and no undecided values ACC-133 @m12', () => {
  const files = docFiles();
  assert.ok(files.length >= 20, `expected the spec set to be scanned; found ${files.length} files`);
  for (const expected of ['specs/00-overview.md', 'specs/32-acceptance-tests.md', 'specs/40-implementation-plan.md', 'README.md']) {
    assert.ok(files.includes(expected), `${expected} must be scanned`);
  }

  const hits = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (statesTheRuleItself(line)) return;
      for (const marker of MARKERS) {
        if (marker.re.test(line)) hits.push(`${rel}:${i + 1}: ${marker.name} — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(hits, [], `ACC-133: placeholder markers found:\n${hits.join('\n')}`);
});

test('the ACC-133 scanner would catch a placeholder if one appeared @unit @m12', () => {
  // The scan is only worth anything if it fires; assert each marker against a sample line, and
  // assert that the two exempt lines are the only reason the real scan comes back empty.
  const samples = [
    'the damage is TBD',
    'TODO: pick a number',
    'FIXME later',
    'XXX check this',
    'a HACK for now',
    'still WIP',
    'the value is to be decided',
    'the value is to-be-determined',
    'radius to be confirmed',
    'cost ??',
    'decide later',
  ];
  for (const line of samples) {
    assert.ok(MARKERS.some((m) => m.re.test(line)), `the scanner missed: ${line}`);
    assert.ok(!statesTheRuleItself(line), `the exemption must not swallow: ${line}`);
  }

  // A single question mark is prose, not a marker (`OVR-02`'s pillar 3 asks questions in prose).
  assert.ok(!MARKERS.some((m) => m.re.test('station first, or loot first?')), 'one question mark is prose');

  // The two lines that state the rule are exempt, and they really do contain a marker.
  const overview = fs.readFileSync(path.join(SPECS, '00-overview.md'), 'utf8').split(/\r?\n/);
  const ruleLine = overview.find((l) => l.includes('**Placeholders.**'));
  assert.ok(ruleLine, 'OVR-07 rule 10 must still be in specs/00-overview.md');
  assert.ok(MARKERS.some((m) => m.re.test(ruleLine)), 'OVR-07 rule 10 quotes the marker it forbids');
  assert.ok(statesTheRuleItself(ruleLine), 'OVR-07 rule 10 must be the exempt line');
});
