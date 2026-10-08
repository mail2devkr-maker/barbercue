#!/usr/bin/env node
/**
 * Release-artifact guard for the FastQue Android build.
 *
 * Play reported a production startup crash on 1.0.3 (versionCode 17):
 *   MainActivity.onCreate -> ClassCastException:
 *   android.app.Application cannot be cast to com.facebook.react.ReactApplication
 * That means a plain android.app.Application ran instead of FastQue's MainApplication.
 * A build that does not register MainApplication in the merged release manifest can never
 * start, so this script fails the release when the artifact does not:
 *   - register <application android:name> as the expected MainApplication class,
 *   - keep the expected package,
 *   - stay non-debuggable and not testOnly,
 *   - leave every activity free of a fixed android:screenOrientation (large-screen readiness),
 *   - (optional) carry a versionCode above the one currently in production.
 *
 * Usage (no dependencies; Node 18+):
 *   node scripts/verify-android-release.js --aab path/to/app.aab [--min-version-code 18]
 *   node scripts/verify-android-release.js --manifest path/to/merged/AndroidManifest.xml
 *   node scripts/verify-android-release.js --apk-manifest-xml path/to/AndroidManifest.xml
 *
 * An AAB is checked by decoding base/manifest/AndroidManifest.xml (aapt2 protobuf XML), which is
 * the manifest Google Play actually installs from. This is a necessary check, not a proof that
 * the startup crash cannot happen: the 1.0.3 build that crashed once in the field already
 * passed it. Cold-launch testing on a physical device remains required.
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

const EXPECTED_PACKAGE = 'com.dcw.fastque';
const EXPECTED_APPLICATION = `${EXPECTED_PACKAGE}.MainApplication`;

// ---------- minimal zip reader (central directory + raw inflate) ----------

function readZipEntry(buffer, wantedName) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip/AAB: end-of-central-directory record not found.');
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);
    if (name === wantedName) {
      const localNameLen = buffer.readUInt16LE(localOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${method} for ${name}.`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry not found in archive: ${wantedName}`);
}

// ---------- minimal protobuf reader for aapt2's XmlNode ----------

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = buf[pos];
    pos += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, pos];
    shift += 7;
  }
}

function readFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wire === 1) {
      value = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wire === 5) {
      value = buf.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}.`);
    }
    out.push([field, value]);
  }
  return out;
}

function readCompiledItem(buf) {
  const item = {};
  for (const [field, value] of readFields(buf)) {
    if (field === 2) {
      const inner = readFields(value);
      item.str = inner.length ? inner[0][1].toString('utf8') : '';
    } else if (field === 3) {
      item.str = value.toString('utf8');
    } else if (field === 7) {
      for (const [primField, primValue] of readFields(value)) {
        if (primField === 8) item.bool = primValue !== 0;
        else if (primField === 6 || primField === 7) item.int = primValue;
      }
    }
  }
  return item;
}

function readXmlNode(buf) {
  const node = { name: undefined, attrs: {}, children: [] };
  for (const [field, value] of readFields(buf)) {
    if (field !== 1) continue; // field 1 = element
    for (const [elementField, elementValue] of readFields(value)) {
      if (elementField === 3) {
        node.name = elementValue.toString('utf8');
      } else if (elementField === 4) {
        let attrName;
        let raw;
        let item;
        for (const [attrField, attrValue] of readFields(elementValue)) {
          if (attrField === 2) attrName = attrValue.toString('utf8');
          else if (attrField === 3) raw = attrValue.toString('utf8');
          else if (attrField === 6) item = readCompiledItem(attrValue);
        }
        let resolved = raw;
        if ((resolved === undefined || resolved === '') && item) {
          resolved = item.str !== undefined ? item.str : item.bool !== undefined ? item.bool : item.int;
        }
        node.attrs[attrName] = resolved;
      } else if (elementField === 5) {
        node.children.push(readXmlNode(elementValue));
      }
    }
  }
  return node;
}

// ---------- plain-text manifest reader (Gradle merged manifests) ----------

function readTextManifest(xml) {
  const root = { name: 'manifest', attrs: {}, children: [] };
  const pkg = /<manifest\b[^>]*\bpackage="([^"]*)"/.exec(xml);
  if (pkg) root.attrs.package = pkg[1];
  const versionCode = /<manifest\b[^>]*android:versionCode="([^"]*)"/.exec(xml);
  if (versionCode) root.attrs.versionCode = versionCode[1];
  const applicationMatch = /<application\b([^>]*)>/s.exec(xml);
  const application = { name: 'application', attrs: {}, children: [] };
  if (applicationMatch) {
    for (const m of applicationMatch[1].matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) application.attrs[m[1]] = m[2];
  }
  root.children.push(application);
  for (const m of xml.matchAll(/<activity\b([^>]*)>/gs)) {
    const activity = { name: 'activity', attrs: {}, children: [] };
    for (const a of m[1].matchAll(/android:([A-Za-z]+)="([^"]*)"/g)) activity.attrs[a[1]] = a[2];
    application.children.push(activity);
  }
  return root;
}

// ---------- the checks ----------

function resolveClassName(name, pkg) {
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (name.startsWith('.')) return `${pkg}${name}`;
  if (!name.includes('.')) return `${pkg}.${name}`;
  return name;
}

function verifyManifest(root, options = {}) {
  const expectedPackage = options.expectedPackage || EXPECTED_PACKAGE;
  const expectedApplication = options.expectedApplication || EXPECTED_APPLICATION;
  const failures = [];
  const facts = {};

  const pkg = root.attrs.package;
  facts.package = pkg;
  if (pkg !== expectedPackage) failures.push(`package is "${pkg}", expected "${expectedPackage}".`);

  const application = root.children.find((child) => child.name === 'application');
  if (!application) {
    failures.push('manifest has no <application> element.');
    return { ok: false, failures, facts };
  }

  const applicationClass = resolveClassName(application.attrs.name, pkg || expectedPackage);
  facts.application = applicationClass || '(unset: plain android.app.Application)';
  if (applicationClass !== expectedApplication) {
    failures.push(
      `<application android:name> resolves to ${facts.application}, expected ${expectedApplication}. ` +
        'A plain android.app.Application cannot be cast to ReactApplication and crashes MainActivity.onCreate.',
    );
  }

  const isTrue = (value) => value === true || value === 'true';
  if (isTrue(application.attrs.debuggable)) failures.push('release manifest is android:debuggable="true".');
  if (isTrue(application.attrs.testOnly)) failures.push('release manifest is android:testOnly="true".');

  const activities = application.children.filter((child) => child.name === 'activity');
  facts.activityCount = activities.length;
  const mainActivity = activities.find((activity) => resolveClassName(activity.attrs.name, pkg || expectedPackage) === `${pkg || expectedPackage}.MainActivity`);
  if (!mainActivity) failures.push(`MainActivity (${pkg || expectedPackage}.MainActivity) is not declared.`);
  for (const activity of activities) {
    if (activity.attrs.screenOrientation !== undefined) {
      failures.push(`activity ${activity.attrs.name} declares a fixed android:screenOrientation (${activity.attrs.screenOrientation}).`);
    }
  }

  if (options.minVersionCode !== undefined) {
    const versionCode = Number(root.attrs.versionCode);
    facts.versionCode = versionCode;
    if (!Number.isFinite(versionCode) || versionCode < options.minVersionCode) {
      failures.push(`versionCode ${root.attrs.versionCode} is below the required minimum ${options.minVersionCode}.`);
    }
  } else {
    facts.versionCode = root.attrs.versionCode === undefined ? undefined : Number(root.attrs.versionCode);
  }

  return { ok: failures.length === 0, failures, facts };
}

function loadManifestFromAab(path) {
  const entry = readZipEntry(fs.readFileSync(path), 'base/manifest/AndroidManifest.xml');
  return readXmlNode(entry);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag.startsWith('--')) {
      args[flag.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
    }
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  let root;
  let source;
  if (args.aab) {
    source = args.aab;
    root = loadManifestFromAab(args.aab);
  } else if (args.manifest) {
    source = args.manifest;
    root = readTextManifest(fs.readFileSync(args.manifest, 'utf8'));
  } else {
    console.error('Usage: verify-android-release.js (--aab <file> | --manifest <AndroidManifest.xml>) [--min-version-code N]');
    return 2;
  }
  const result = verifyManifest(root, {
    minVersionCode: args['min-version-code'] === undefined ? undefined : Number(args['min-version-code']),
  });
  console.log(`Android release check: ${source}`);
  console.log(`  package:     ${result.facts.package}`);
  console.log(`  application: ${result.facts.application}`);
  console.log(`  versionCode: ${result.facts.versionCode === undefined ? '(not in this manifest)' : result.facts.versionCode}`);
  console.log(`  activities:  ${result.facts.activityCount}`);
  if (result.ok) {
    console.log('PASS: merged release manifest registers the expected MainApplication.');
    return 0;
  }
  for (const failure of result.failures) console.error(`FAIL: ${failure}`);
  return 1;
}

module.exports = { readZipEntry, readXmlNode, readTextManifest, verifyManifest, loadManifestFromAab, EXPECTED_APPLICATION, EXPECTED_PACKAGE };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
