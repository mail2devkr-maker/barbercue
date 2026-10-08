/**
 * Android-only orientation policy for large screens (Play Console / Android 16 readiness).
 *
 * `expo.orientation: "portrait"` in app.json is shared by both platforms: on iOS it becomes
 * UISupportedInterfaceOrientations (kept exactly as-is), on Android it becomes
 * `android:screenOrientation="portrait"` on MainActivity. Play Console flags that manifest lock
 * for large screens, and Android 16 (API 36) ignores it there anyway.
 *
 * So on Android only, this plugin:
 *  1. removes `android:screenOrientation` from MainActivity in the generated manifest, and
 *  2. re-applies portrait at runtime only on compact displays (phones, folded foldables), while
 *     tablets, unfolded foldables and desktop windows (smallest side >= 600dp) rotate freely —
 *     the "restrict orientation on phones but not on large screens" pattern from the Android docs.
 *
 * Phones therefore keep the exact portrait UX they have today.
 */
const { withAndroidManifest, withMainActivity, AndroidConfig } = require('expo/config-plugins');

const SCREEN_ORIENTATION_ATTRIBUTE = 'android:screenOrientation';
const ON_CREATE_ANCHOR = 'super.onCreate(null)';
const BEGIN_MARKER = '// @generated begin fastque-large-screen-orientation';
const END_MARKER = '// @generated end fastque-large-screen-orientation';
const REQUIRED_IMPORTS = ['android.content.pm.ActivityInfo', 'android.content.res.Configuration', 'android.os.Build'];

const POLICY_MEMBERS = `
  ${BEGIN_MARKER}
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyFastQueOrientationPolicy()
  }

  /**
   * Phones keep FastQue's portrait-only UX; displays whose smallest side is at least 600dp
   * (tablets, unfolded foldables, desktop windows) may use any orientation. Re-evaluated on every
   * configuration change so folding/unfolding a foldable switches policy without a restart.
   */
  private fun applyFastQueOrientationPolicy() {
    val desired = if (isCompactDisplay()) {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    } else {
      ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    if (requestedOrientation != desired) {
      requestedOrientation = desired
    }
  }

  private fun isCompactDisplay(): Boolean {
    val smallestSideDp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // Display-sized bounds, so multi-window / split-screen does not count as a phone.
      val bounds = windowManager.maximumWindowMetrics.bounds
      minOf(bounds.width(), bounds.height()) / resources.displayMetrics.density
    } else {
      resources.configuration.smallestScreenWidthDp.toFloat()
    }
    return smallestSideDp < 600f
  }
  ${END_MARKER}
`;

function removeMainActivityOrientationLock(androidManifest) {
  const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  if (mainActivity.$) {
    delete mainActivity.$[SCREEN_ORIENTATION_ATTRIBUTE];
  }
  return androidManifest;
}

function addKotlinImports(contents) {
  const missing = REQUIRED_IMPORTS.filter((name) => !new RegExp(`^import ${name.replace(/\./g, '\\.')}$`, 'm').test(contents));
  if (missing.length === 0) return contents;
  const packageLine = /^package .+$/m.exec(contents);
  if (!packageLine) {
    throw new Error('withAndroidLargeScreenOrientation: MainActivity has no package declaration.');
  }
  const insertAt = packageLine.index + packageLine[0].length;
  const block = missing.map((name) => `import ${name}`).join('\n');
  return `${contents.slice(0, insertAt)}\n\n${block}${contents.slice(insertAt)}`;
}

function addOrientationPolicy(contents, language) {
  if (language !== 'kt') {
    throw new Error(`withAndroidLargeScreenOrientation: expected a Kotlin MainActivity, got "${language}".`);
  }
  if (contents.includes(BEGIN_MARKER)) return contents;

  const anchorIndex = contents.indexOf(ON_CREATE_ANCHOR);
  if (anchorIndex === -1) {
    // Fail the prebuild loudly rather than ship a build that silently lost the phone portrait lock.
    throw new Error(`withAndroidLargeScreenOrientation: could not find "${ON_CREATE_ANCHOR}" in MainActivity.`);
  }
  const anchorEnd = anchorIndex + ON_CREATE_ANCHOR.length;
  let next = `${contents.slice(0, anchorEnd)}\n    applyFastQueOrientationPolicy()${contents.slice(anchorEnd)}`;

  const classClose = next.lastIndexOf('}');
  if (classClose === -1) {
    throw new Error('withAndroidLargeScreenOrientation: could not find the end of the MainActivity class.');
  }
  next = `${next.slice(0, classClose)}${POLICY_MEMBERS}${next.slice(classClose)}`;
  return addKotlinImports(next);
}

const withAndroidLargeScreenOrientation = (config) => {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = removeMainActivityOrientationLock(mod.modResults);
    return mod;
  });
  config = withMainActivity(config, (mod) => {
    mod.modResults.contents = addOrientationPolicy(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
  return config;
};

module.exports = withAndroidLargeScreenOrientation;
module.exports.removeMainActivityOrientationLock = removeMainActivityOrientationLock;
module.exports.addOrientationPolicy = addOrientationPolicy;
module.exports.BEGIN_MARKER = BEGIN_MARKER;
