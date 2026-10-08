/**
 * Turns on R8 *optimization* for Android release builds (minification itself is enabled through
 * expo-build-properties' `enableMinifyInReleaseBuilds`).
 *
 * The SDK 57 prebuild template wires release builds to `proguard-android.txt`, which carries
 * `-dontoptimize`, so R8 only shrinks and obfuscates. Play Console's DEX code optimization vital
 * requires optimization, obfuscation AND shrinking to each reach 25% for apps with more than 10 MB
 * of DEX, so optimization has to be on too. This backports the exact template change Expo shipped
 * for SDK 58 (expo/expo#46852): `proguard-android.txt` -> `proguard-android-optimize.txt`.
 *
 * Remove this plugin after upgrading to Expo SDK 58+, whose template already uses the optimizing
 * file. The matching keep rules live in app.json (expo-build-properties `extraProguardRules`).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const NON_OPTIMIZING = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZING = 'getDefaultProguardFile("proguard-android-optimize.txt")';

function useOptimizingProguardFile(contents) {
  if (contents.includes(OPTIMIZING)) return contents;
  if (!contents.includes(NON_OPTIMIZING)) {
    // Fail the prebuild rather than ship a release that silently lost R8 optimization.
    throw new Error(`withAndroidR8Optimization: could not find ${NON_OPTIMIZING} in android/app/build.gradle.`);
  }
  return contents.replace(NON_OPTIMIZING, OPTIMIZING);
}

const withAndroidR8Optimization = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error(`withAndroidR8Optimization: expected a Groovy app build.gradle, got "${mod.modResults.language}".`);
    }
    mod.modResults.contents = useOptimizingProguardFile(mod.modResults.contents);
    return mod;
  });

module.exports = withAndroidR8Optimization;
module.exports.useOptimizingProguardFile = useOptimizingProguardFile;
