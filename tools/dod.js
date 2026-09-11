// Definition-of-Done runner (PLN-04).
//
//   node tools/dod.js NN      run the DoD for milestone NN (00..13):
//                               1. node --test over unit + integration tests, filtered to the
//                                  milestone tags @m00..@mNN
//                               2. node --test over the meta tests (unfiltered — the repo rules
//                                  always apply in full)
//                               3. playwright test --grep matching @m00 and, for NN >= 10,
//                                  @m10..@mNN
//                             The process exit code is the DoD.
//
//   node tools/dod.js --node  run every node test file (unit + integration + meta) unfiltered.
//                             This is what `npm test` uses; it avoids shell globbing and the
//                             `node --test <dir>` rule that would sweep in test/e2e and
//                             test/fixtures.
//
// No dependencies. Works on Node >= 20 and on Windows and POSIX paths.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');
const META_DIR = path.join(TEST_DIR, 'meta');
const E2E_DIR = path.join(TEST_DIR, 'e2e');
const MAX_MILESTONE = 13;

/** Every `*.test.js` file under `dir`, recursively, in a stable order. */
function findTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTestFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function relative(files) {
  return files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
}

/** `@m(00|01|...|NN)` — a regex source, safe to pass as a single argv entry. */
function tagPattern(tags) {
  return `@m(${tags.join('|')})`;
}

function milestoneTags(upTo) {
  const tags = [];
  for (let i = 0; i <= upTo; i++) tags.push(String(i).padStart(2, '0'));
  return tags;
}

function run(label, command, args) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    console.error(`${label}: failed to start — ${result.error.message}`);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

/** The Playwright CLI, run through this same node binary so no shell quoting is involved. */
function playwrightCli() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    path.join(ROOT, 'node_modules', 'playwright', 'cli.js'),
    path.join(ROOT, 'node_modules', 'playwright-core', 'cli.js'),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function runNodeTests(label, files, namePattern) {
  if (files.length === 0) {
    console.log(`\n=== ${label} ===\n(no test files yet — skipped)`);
    return 0;
  }
  const args = ['--test'];
  if (namePattern) args.push(`--test-name-pattern=${namePattern}`);
  args.push(...relative(files));
  return run(label, process.execPath, args);
}

function runPlaywright(label, grep) {
  const cli = playwrightCli();
  if (!cli) {
    console.error(`${label}: @playwright/test is not installed — run \`npm install\`.`);
    return 1;
  }
  if (!fs.existsSync(E2E_DIR) || findE2eSpecs().length === 0) {
    console.log(`\n=== ${label} ===\n(no e2e specs yet — skipped)`);
    return 0;
  }
  const args = [cli, 'test'];
  if (grep) args.push('--grep', grep);
  return run(label, process.execPath, args);
}

function findE2eSpecs() {
  if (!fs.existsSync(E2E_DIR)) return [];
  return fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.js'));
}

function main(argv) {
  const args = argv.filter((a) => a !== '--');

  if (args.includes('--node')) {
    return runNodeTests('node --test (all milestones)', findTestFiles(TEST_DIR), null);
  }

  const raw = args.find((a) => /^\d{1,2}$/.test(a));
  if (raw === undefined) {
    console.error('usage: node tools/dod.js <NN>   (NN = 00..13)   |   node tools/dod.js --node');
    return 2;
  }
  const milestone = Number(raw);
  if (!Number.isInteger(milestone) || milestone < 0 || milestone > MAX_MILESTONE) {
    console.error(`dod: milestone must be between 00 and ${String(MAX_MILESTONE).padStart(2, '0')}`);
    return 2;
  }
  const nn = String(milestone).padStart(2, '0');
  console.log(`Definition of Done — milestone M${nn}`);

  const metaFiles = findTestFiles(META_DIR);
  const metaSet = new Set(metaFiles);
  const gameplayFiles = findTestFiles(TEST_DIR).filter((f) => !metaSet.has(f));

  const nodePattern = tagPattern(milestoneTags(milestone));
  const browserTags = milestone >= 10 ? ['00', ...milestoneTags(milestone).slice(10)] : ['00'];
  const browserPattern = tagPattern(browserTags);

  let status = runNodeTests(`unit + integration (${nodePattern})`, gameplayFiles, nodePattern);
  if (status !== 0) return status;

  status = runNodeTests('meta (repo rules, unfiltered)', metaFiles, null);
  if (status !== 0) return status;

  status = runPlaywright(`e2e (${browserPattern})`, browserPattern);
  if (status !== 0) return status;

  console.log(`\nM${nn} DoD: PASS`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
