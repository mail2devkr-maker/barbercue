/* eslint-disable @typescript-eslint/no-require-imports */
const plugin = require('../../plugins/withAndroidLargeScreenOrientation');
const appJson = require('../../app.json');
const mobileRoot = require('node:path').resolve(__dirname, '../..');
const resolvedExpoConfig = require('@expo/config').getConfig(mobileRoot, { skipSDKVersionRequirement: true }).exp;
const { resolveRuntimeVersionAsync } = require('expo-updates/utils/build/resolveRuntimeVersionAsync');

function effectiveAppVersion(platform: 'ios' | 'android'): string {
  return resolvedExpoConfig[platform]?.version ?? resolvedExpoConfig.version;
}

function effectiveRuntimeVersion(platform: 'ios' | 'android'): string {
  const runtime = resolvedExpoConfig[platform]?.runtimeVersion ?? resolvedExpoConfig.runtimeVersion;
  if (typeof runtime === 'string') return runtime;
  if (runtime?.policy === 'appVersion') return effectiveAppVersion(platform);
  throw new Error(`Unexpected ${platform} runtimeVersion configuration`);
}

const TEMPLATE_MAIN_ACTIVITY = `package com.dcw.fastque

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"
}
`;

function manifestWith(activities: Array<Record<string, string>>) {
  return {
    manifest: {
      application: [{ $: { 'android:name': '.MainApplication' }, activity: activities.map(($) => ({ $ })) }],
    },
  };
}

describe('Android large-screen orientation plugin', () => {
  it('removes the portrait lock from MainActivity only', () => {
    const manifest = manifestWith([
      { 'android:name': '.MainActivity', 'android:screenOrientation': 'portrait', 'android:exported': 'true' },
      { 'android:name': '.SomeOtherActivity', 'android:screenOrientation': 'landscape' },
    ]);

    const result = plugin.removeMainActivityOrientationLock(manifest);
    const [main, other] = result.manifest.application[0].activity;

    expect(main.$['android:screenOrientation']).toBeUndefined();
    expect(main.$['android:exported']).toBe('true');
    expect(other.$['android:screenOrientation']).toBe('landscape');
  });

  it('re-applies portrait at runtime for compact displays and re-evaluates on configuration changes', () => {
    const out = plugin.addOrientationPolicy(TEMPLATE_MAIN_ACTIVITY, 'kt');

    expect(out).toContain('super.onCreate(null)\n    applyFastQueOrientationPolicy()');
    expect(out).toContain('override fun onConfigurationChanged(newConfig: Configuration)');
    expect(out).toContain('ActivityInfo.SCREEN_ORIENTATION_PORTRAIT');
    expect(out).toContain('ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED');
    expect(out).toContain('smallestSideDp < 600f');
    expect(out).toMatch(/^import android\.content\.pm\.ActivityInfo$/m);
    expect(out).toMatch(/^import android\.content\.res\.Configuration$/m);
    expect(out.match(/^import android\.os\.Build$/gm)).toHaveLength(1);
    // Policy members land inside the class body, before its closing brace.
    expect(out.trimEnd().endsWith('// @generated end fastque-large-screen-orientation\n}')).toBe(true);
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = plugin.addOrientationPolicy(TEMPLATE_MAIN_ACTIVITY, 'kt');
    expect(plugin.addOrientationPolicy(once, 'kt')).toBe(once);
  });

  it('fails the prebuild instead of silently dropping the phone portrait lock', () => {
    expect(() => plugin.addOrientationPolicy(TEMPLATE_MAIN_ACTIVITY.replace('super.onCreate(null)', 'super.onCreate(savedInstanceState)'), 'kt')).toThrow(
      /could not find "super.onCreate\(null\)"/,
    );
    expect(() => plugin.addOrientationPolicy('public class MainActivity {}', 'java')).toThrow(/expected a Kotlin MainActivity/);
  });
});

describe('app.json Android release configuration', () => {
  const plugins: unknown[] = appJson.expo.plugins;

  it('keeps the shared portrait orientation so iOS stays portrait-only', () => {
    expect(appJson.expo.orientation).toBe('portrait');
  });

  it('registers the Android large-screen orientation plugin', () => {
    expect(plugins).toContain('./plugins/withAndroidLargeScreenOrientation');
  });

  const buildProperties = plugins.find((p) => Array.isArray(p) && p[0] === 'expo-build-properties') as
    | [string, { android?: { enableMinifyInReleaseBuilds?: boolean; extraProguardRules?: string } }]
    | undefined;

  it('enables R8 minification for Android release builds', () => {
    expect(buildProperties?.[1].android?.enableMinifyInReleaseBuilds).toBe(true);
  });

  it('enables R8 optimization together with the SDK 57 Record keep rules', () => {
    expect(plugins).toContain('./plugins/withAndroidR8Optimization');
    const rules = buildProperties?.[1].android?.extraProguardRules ?? '';
    expect(rules).toMatch(/^-keep interface expo\.modules\.kotlin\.records\.Record$/m);
    expect(rules).toMatch(/^-keep,allowshrinking,allowobfuscation class expo\.modules\.kotlin\.records\.\*\* \{ \*; \}$/m);
  });

  it('resolves Android 1.0.7 without changing the existing iOS 1.0.6 store version', () => {
    expect(effectiveAppVersion('android')).toBe('1.0.7');
    expect(effectiveAppVersion('ios')).toBe('1.0.6');
    expect(resolvedExpoConfig.android?.package).toBe('com.dcw.fastque');
    expect(resolvedExpoConfig.ios?.bundleIdentifier).toBe('com.dcw.fastque');
  });

  it('keeps OTA runtime versions aligned to each platform app version', () => {
    expect(effectiveRuntimeVersion('android')).toBe('1.0.7');
    expect(effectiveRuntimeVersion('ios')).toBe('1.0.6');
  });

  it('matches the Expo Updates resolver for each platform runtime', async () => {
    const options = { workflowOverride: 'managed' as const };
    const fingerprintOptions = { silent: true };
    const [android, ios] = await Promise.all([
      resolveRuntimeVersionAsync(mobileRoot, 'android', fingerprintOptions, options),
      resolveRuntimeVersionAsync(mobileRoot, 'ios', fingerprintOptions, options),
    ]);

    expect(android.runtimeVersion).toBe('1.0.7');
    expect(ios.runtimeVersion).toBe('1.0.6');
  });
});

describe('Android R8 optimization plugin', () => {
  const optimization = require('../../plugins/withAndroidR8Optimization');
  const TEMPLATE_RELEASE_BLOCK = `        release {
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }`;

  it('switches release builds to the optimizing default ProGuard file', () => {
    const out = optimization.useOptimizingProguardFile(TEMPLATE_RELEASE_BLOCK);
    expect(out).toContain('getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"');
    expect(out).not.toContain('"proguard-android.txt"');
    expect(optimization.useOptimizingProguardFile(out)).toBe(out);
  });

  it('fails the prebuild if the template no longer has the expected line', () => {
    expect(() => optimization.useOptimizingProguardFile('proguardFiles "proguard-rules.pro"')).toThrow(/could not find/);
  });
});

