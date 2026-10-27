#!/usr/bin/env node
/**
 * Read-only FastQue Play-1.0.3-versus-EAS-OTA native-surface review.
 *
 * Requires a local checkout containing the two pinned commits.
 * npm/Expo credentials and EAS publishing are NOT required.
 *
 * node apps/mobile/scripts/audit-play-103-ota.js [play-binary-commit] [ota-commit]
 *
 * Exit codes: 0 = source-level no native delta (still requires QA);
 *             2 = native/config delta, DO NOT widen OTA without physical QA;
 *             1 = audit itself failed.
 */
'use strict';
const { execFileSync } = require('node:child_process');

const PLAY_COMMIT = 'ad1e8bf93c74be4d15cceee3ddf10628337f0fcb';
const OTA_COMMIT = '2e1e7ebe825ff0c55805215d34890f0dc7eca427';
const root = 'apps/mobile/';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function sourceJson(ref, path) {
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) throw new Error('Invalid commit SHA: ' + ref);
  return JSON.parse(git(['show', ref + ':' + path]));
}
function asPlugins(expo) {
  return (expo.plugins || []).map((item) =>
    typeof item === 'string' ? { name: item, options: {} } :
      { name: item[0], options: item[1] || {} });
}
function changedDependencies(oldDeps, newDeps) {
  const a = oldDeps || {};
  const b = newDeps || {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .filter((name) => a[name] !== b[name])
    .map((name) => ({
      name, before: a[name] || null, after: b[name] || null,
      category: name === 'qrcode' && !a[name] ? 'LIKELY_JS_ONLY_REVIEW' :
        name === 'expo-build-properties' && !a[name] ? 'BUILD_TIME_NATIVE_CONFIG' :
          'POTENTIAL_NATIVE_MODULE_REVIEW',
    }));
}

function audit(playRef = PLAY_COMMIT, otaRef = OTA_COMMIT) {
  const playConfig = sourceJson(playRef, root + 'app.json').expo;
  const otaConfig = sourceJson(otaRef, root + 'app.json').expo;
  const playPkg = sourceJson(playRef, root + 'package.json');
  const otaPkg = sourceJson(otaRef, root + 'package.json');
  const deps = changedDependencies(playPkg.dependencies, otaPkg.dependencies);
  const before = asPlugins(playConfig);
  const after = asPlugins(otaConfig);
  const changedPlugins = after.filter((item) => {
    const prior = before.find((p) => p.name === item.name);
    return !prior || JSON.stringify(prior.options) !== JSON.stringify(item.options);
  });
  const removedPlugins = before.filter((item) => !after.some((p) => p.name === item.name));
  const nativeKeys = ['version', 'runtimeVersion', 'updates', 'android', 'ios', 'extra', 'owner'];
  const changedNativeConfigKeys = nativeKeys.filter((key) =>
    JSON.stringify(playConfig[key]) !== JSON.stringify(otaConfig[key]));
  const nativeFiles = git(['diff', '--name-only', playRef, otaRef, '--',
    root + 'android', root + 'ios', root + 'plugins'])
    .split('\n').filter(Boolean);
  const reviewRequired = Boolean(
    deps.length || changedPlugins.length || removedPlugins.length ||
    changedNativeConfigKeys.length || nativeFiles.length
  );
  return {
    playRef, otaRef,
    knownPlay: { version: '1.0.3', versionCode: 17, fingerprint: '04596cd' },
    knownOta: { runtime: '1.0.3', fingerprint: '4c94e5b', rolloutObserved: '10%' },
    sameRuntime: playConfig.version === otaConfig.version &&
      JSON.stringify(playConfig.runtimeVersion) === JSON.stringify(otaConfig.runtimeVersion),
    sameUpdatesUrl: playConfig.updates?.url === otaConfig.updates?.url,
    dependenciesChanged: deps,
    changedPlugins, removedPlugins, changedNativeConfigKeys, nativeFiles,
    outcome: reviewRequired ?
      'NATIVE_COMPATIBILITY_UNPROVEN__DO_NOT_EXPAND' :
      'SOURCE_NATIVE_SURFACE_UNCHANGED__PHYSICAL_QA_STILL_REQUIRED',
    limitation: 'This is a source-level audit only. Native fingerprints differ. ' +
      'It cannot prove the OTA works on Google-Play-signed 1.0.3. ' +
      'Expo 10% rollout cannot guarantee delivery to one chosen device.',
  };
}
if (require.main === module) {
  try {
    const result = audit(process.argv[2] || PLAY_COMMIT, process.argv[3] || OTA_COMMIT);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.sameRuntime || !result.sameUpdatesUrl ||
        result.outcome.startsWith('NATIVE_COMPATIBILITY_UNPROVEN')) process.exitCode = 2;
  } catch (err) {
    console.error('OTA source audit failed:', err.message);
    process.exitCode = 1;
  }
}
module.exports = { audit, changedDependencies, asPlugins };
