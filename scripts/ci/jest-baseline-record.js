#!/usr/bin/env node
/**
 * Records the failing tests of a Jest `--json` report as a BASELINE file for jest-baseline-compare.js.
 *
 *   node scripts/ci/jest-baseline-record.js <jest-report.json> <out.json> "<commit the report was produced on>"
 *
 * Run it ONLY on the pristine base commit in a clean `npm ci` checkout (the owner-operations baselines
 * were produced on master f2f2b2c6). A failure is recorded together with the first line of its message
 * so the baseline says WHY it fails; nothing here edits, skips or hides a test.
 */
const fs = require('fs');
const path = require('path');

const [reportPath, outPath, generatedFrom = 'unknown'] = process.argv.slice(2);
if (!reportPath || !outPath) {
  console.error('usage: jest-baseline-record.js <jest-report.json> <out.json> "<commit>"');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const repoRel = (file) => {
  const normalized = file.split(path.sep).join('/');
  const match = normalized.match(/\/((?:apps|packages)\/.*)$/);
  return match ? match[1] : normalized;
};
const firstLine = (text) =>
  String(text ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('at ')) ?? '';

const failures = [];
const suiteErrors = [];
for (const suite of report.testResults ?? []) {
  const file = repoRel(suite.name);
  if (suite.status === 'failed' && (suite.assertionResults ?? []).length === 0) {
    suiteErrors.push({ file, name: '*', reason: firstLine(suite.message).slice(0, 200) });
  }
  for (const t of suite.assertionResults ?? []) {
    if (t.status === 'failed') failures.push({ file, name: t.fullName, reason: firstLine((t.failureMessages ?? [])[0]).slice(0, 200) });
  }
}
const out = {
  generatedFrom,
  totals: { passed: report.numPassedTests, failed: report.numFailedTests, suites: report.numTotalTestSuites, failedSuites: report.numFailedTestSuites },
  failures: [...suiteErrors, ...failures],
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`${path.basename(outPath)}: ${out.totals.passed} passed, ${out.totals.failed} failed in ${out.totals.failedSuites} suite(s); ${out.failures.length} entr${out.failures.length === 1 ? 'y' : 'ies'} recorded`);
