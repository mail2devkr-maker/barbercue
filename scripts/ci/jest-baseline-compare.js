#!/usr/bin/env node
/**
 * Compares a Jest `--json` report with a recorded BASELINE of failures that already exist on the base
 * branch, so a certification run can tell NEW failures (a regression introduced by the change under
 * test) from KNOWN ones (reproduced on the base commit and listed, with their cause, in the baseline
 * file). Nothing is skipped or loosened: a baseline test still runs, and it is reported on every run.
 *
 *   node scripts/ci/jest-baseline-compare.js <jest-report.json> <baseline.json|-> <label>
 *
 * Exit code 1 when any failing test (or any suite that failed to run) is not in the baseline.
 * Baseline entries that now PASS are reported so the baseline can be pruned.
 */
const fs = require('fs');
const path = require('path');

const [reportPath, baselinePath, label = 'jest'] = process.argv.slice(2);
if (!reportPath) {
  console.error('usage: jest-baseline-compare.js <jest-report.json> <baseline.json|-> <label>');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const baseline = baselinePath && baselinePath !== '-' && fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : { failures: [] };

const rel = (file) => path.relative(process.cwd(), file).split(path.sep).join('/');
const repoRel = (file) => {
  const normalized = file.split(path.sep).join('/');
  const marker = normalized.indexOf('/apps/');
  const marker2 = normalized.indexOf('/packages/');
  const idx = [marker, marker2].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return idx === undefined ? rel(file) : normalized.slice(idx + 1);
};
const key = (file, name) => `${file}::${name}`;
const known = new Map((baseline.failures ?? []).map((f) => [key(f.file, f.name ?? '*'), f]));
const knownSuite = (file) => known.has(key(file, '*'));

const failing = [];
const suiteErrors = [];
let total = 0;
let passed = 0;
for (const suite of report.testResults ?? []) {
  const file = repoRel(suite.name);
  const results = suite.assertionResults ?? [];
  if (suite.status === 'failed' && results.length === 0) suiteErrors.push({ file, message: (suite.message ?? '').split('\n').slice(0, 3).join(' ') });
  for (const t of results) {
    total += 1;
    if (t.status === 'passed') passed += 1;
    if (t.status === 'failed') failing.push({ file, name: t.fullName });
  }
}

const newFailures = failing.filter((f) => !known.has(key(f.file, f.name)) && !knownSuite(f.file));
const newSuiteErrors = suiteErrors.filter((s) => !knownSuite(s.file));
const knownFailures = failing.filter((f) => known.has(key(f.file, f.name)) || knownSuite(f.file));
const stillFailing = new Set(failing.map((f) => key(f.file, f.name)));
const nowPassing = (baseline.failures ?? []).filter((f) => f.name && f.name !== '*' && !stillFailing.has(key(f.file, f.name)));

console.log(`[${label}] ${passed} passed / ${total} tests; failing: ${failing.length} (known baseline ${knownFailures.length}, NEW ${newFailures.length}); suites that did not run: ${suiteErrors.length}`);
if (baseline.generatedFrom) console.log(`[${label}] baseline recorded on ${baseline.generatedFrom}`);
for (const f of knownFailures) console.log(`  known  ${f.file} :: ${f.name}`);
for (const f of nowPassing) console.log(`  now passing (prune from baseline)  ${f.file} :: ${f.name}`);
for (const f of newFailures) console.log(`  NEW    ${f.file} :: ${f.name}`);
for (const s of newSuiteErrors) console.log(`  NEW    suite failed to run: ${s.file} ${s.message}`);
process.exit(newFailures.length + newSuiteErrors.length > 0 ? 1 : 0);
