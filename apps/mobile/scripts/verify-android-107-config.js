#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getConfig } = require('@expo/config');

const root = path.resolve(__dirname, '..');
const app = getConfig(root, { skipSDKVersionRequirement: true }).exp;
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const failures = [];

if (app.version !== '1.0.7') failures.push(`expo.version is ${app.version}; expected 1.0.7.`);
if (app.android?.package !== 'com.dcw.fastque') failures.push('Android package must remain com.dcw.fastque.');
if (app.android?.versionCode !== 17) failures.push('The local EAS remote-version seed must be the last verified Play versionCode 17.');
if (app.android?.version !== undefined) failures.push('Android versionName must use the Android release value from expo.version.');
if (app.ios?.version !== '1.0.6') failures.push(`iOS version override is ${app.ios?.version}; expected the existing 1.0.6 release version.`);
if (app.ios?.bundleIdentifier !== 'com.dcw.fastque') failures.push('iOS bundle identifier must remain com.dcw.fastque.');
if (app.android?.runtimeVersion?.policy !== 'appVersion') failures.push('Android OTA runtime must follow Android versionName 1.0.7.');
if (app.ios?.runtimeVersion?.policy !== 'appVersion') failures.push('iOS OTA runtime must follow the pinned iOS version 1.0.6.');
if (app.extra?.eas?.projectId !== '01998c87-126d-40e8-aac3-205891b74b08') failures.push('Expo project ID does not match FastQue.');
if (eas.cli?.appVersionSource !== 'remote') failures.push('EAS must retain remote version-code management.');

const profile = eas.build?.['android-internal-1-0-7'];
if (!profile) failures.push('Missing android-internal-1-0-7 build profile.');
else {
  if (profile.extends !== 'production') failures.push('Android internal profile must inherit production signing/environment settings.');
  if (profile.distribution !== 'store') failures.push('Google Play internal testing requires a store-distribution build.');
  if (profile.environment !== 'production') failures.push('Android internal profile must use the production EAS environment.');
  if (profile.channel !== 'preview') failures.push('Internal testing must use the preview update channel, isolated from production OTA.');
  if (profile.autoIncrement !== true) failures.push('Remote Android version code auto-increment must be enabled.');
  if (profile.android?.buildType !== 'app-bundle') failures.push('Play release artifact must be an Android App Bundle.');
  if (profile.env?.EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED !== 'false') failures.push('Production credits feature flag must remain disabled in this candidate.');
}

const submit = eas.submit?.['android-internal-1-0-7']?.android;
if (!submit) failures.push('Missing an Android internal testing submission profile.');
else {
  if (submit.track !== 'internal') failures.push('The Android submission track must be internal.');
  if (submit.releaseStatus !== 'draft') failures.push('Play submission must remain a draft pending owner release action.');
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log('PASS: FastQue Android 1.0.7 source and EAS release configuration.');
console.log(`  package: ${app.android.package}`);
console.log(`  Android version/runtime: ${app.version} / 1.0.7`);
console.log(`  iOS version/runtime: ${app.ios.version} / 1.0.6`);
console.log('  versionCode: local seed 17; remote EAS auto-increment (exact next value still requires EAS connectivity).');
console.log('  artifact: signed store AAB profile; preview update channel; Play internal track draft; no build started.');
