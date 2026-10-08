/* eslint-disable @typescript-eslint/no-require-imports */
// The mobile tsconfig has no Node typings (and none are worth a new dependency for one test), so the
// Node built-ins are required untyped and Buffer is declared locally.
declare const Buffer: any;
type Buf = any;
const fs = require('fs');
const os = require('os');
const path = require('path');

const guard = require('../../scripts/verify-android-release');

const PKG = 'com.dcw.fastque';

// ---- tiny protobuf encoder for aapt2's XmlNode (enough to build a realistic AAB manifest) ----

function varint(value: number): Buf {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}
const lenField = (field: number, payload: Buf) => Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload]);
const strField = (field: number, text: string) => lenField(field, Buffer.from(text, 'utf8'));

function attribute(name: string, value: string): Buf {
  return strField(2, name).length ? Buffer.concat([strField(2, name), strField(3, value)]) : Buffer.alloc(0);
}

function element(name: string, attrs: Record<string, string>, children: Buf[] = []): Buf {
  const parts: Buf[] = [strField(3, name)];
  for (const [key, value] of Object.entries(attrs)) parts.push(lenField(4, attribute(key, value)));
  for (const child of children) parts.push(lenField(5, child));
  return lenField(1, Buffer.concat(parts)); // XmlNode { element = 1 }
}

function buildManifest(opts: { applicationName?: string; screenOrientation?: string; debuggable?: boolean; versionCode?: string; pkg?: string }): Buf {
  const activityAttrs: Record<string, string> = { name: 'com.dcw.fastque.MainActivity', exported: 'true' };
  if (opts.screenOrientation) activityAttrs.screenOrientation = opts.screenOrientation;
  const applicationAttrs: Record<string, string> = {};
  if (opts.applicationName !== undefined) applicationAttrs.name = opts.applicationName;
  if (opts.debuggable) applicationAttrs.debuggable = 'true';
  return element('manifest', { package: opts.pkg ?? PKG, versionCode: opts.versionCode ?? '25' }, [
    element('application', applicationAttrs, [element('activity', activityAttrs)]),
  ]);
}

// ---- minimal stored (uncompressed) zip so the AAB path is exercised for real ----

function storedZip(entries: Record<string, Buf>): Buf {
  const locals: Buf[] = [];
  const centrals: Buf[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function writeAab(manifest: Buf): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fq-aab-')), 'app.aab');
  fs.writeFileSync(file, storedZip({ 'BundleConfig.pb': Buffer.from([0]), 'base/manifest/AndroidManifest.xml': manifest }));
  return file;
}

describe('Android release guard: MainApplication registration', () => {
  it('passes a manifest that registers MainApplication, is not debuggable and has no fixed orientation', () => {
    const root = guard.readXmlNode(buildManifest({ applicationName: 'com.dcw.fastque.MainApplication' }));
    const result = guard.verifyManifest(root, { minVersionCode: 18 });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.facts).toMatchObject({ package: PKG, application: 'com.dcw.fastque.MainApplication', versionCode: 25, activityCount: 1 });
  });

  it('accepts the relative form .MainApplication that Gradle merged manifests use', () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${PKG}" android:versionCode="1">
      <application android:name=".MainApplication" android:label="FastQue">
        <activity android:name=".MainActivity" android:exported="true"/>
      </application></manifest>`;
    expect(guard.verifyManifest(guard.readTextManifest(xml)).ok).toBe(true);
  });

  it('FAILS when <application> has no android:name (plain android.app.Application: the 1.0.3 crash class)', () => {
    const result = guard.verifyManifest(guard.readXmlNode(buildManifest({})));
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/plain android\.app\.Application cannot be cast to ReactApplication/);
  });

  it('FAILS when <application> points at another class', () => {
    const result = guard.verifyManifest(guard.readXmlNode(buildManifest({ applicationName: 'android.app.Application' })));
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/expected com\.dcw\.fastque\.MainApplication/);
  });

  it('FAILS on a fixed screenOrientation, a debuggable build, a wrong package, or a too-low versionCode', () => {
    const base = { applicationName: 'com.dcw.fastque.MainApplication' };
    expect(guard.verifyManifest(guard.readXmlNode(buildManifest({ ...base, screenOrientation: 'portrait' }))).ok).toBe(false);
    expect(guard.verifyManifest(guard.readXmlNode(buildManifest({ ...base, debuggable: true }))).ok).toBe(false);
    expect(guard.verifyManifest(guard.readXmlNode(buildManifest({ ...base, pkg: 'com.example.other' }))).ok).toBe(false);
    expect(guard.verifyManifest(guard.readXmlNode(buildManifest({ ...base, versionCode: '17' })), { minVersionCode: 18 }).ok).toBe(false);
  });

  it('reads the real base/manifest entry out of an AAB-shaped zip', () => {
    const good = guard.loadManifestFromAab(writeAab(buildManifest({ applicationName: 'com.dcw.fastque.MainApplication' })));
    expect(guard.verifyManifest(good).ok).toBe(true);
    const bad = guard.loadManifestFromAab(writeAab(buildManifest({})));
    expect(guard.verifyManifest(bad).ok).toBe(false);
  });

  it('rejects a file that is not a zip instead of passing silently', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fq-aab-')), 'broken.aab');
    fs.writeFileSync(file, Buffer.from('not a zip at all, definitely'));
    expect(() => guard.loadManifestFromAab(file)).toThrow(/Not a zip/);
  });
});
