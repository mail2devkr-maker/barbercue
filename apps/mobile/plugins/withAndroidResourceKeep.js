/**
 * Play Console (16 Nov 2026) recommends Android resource shrinking. React Native and Expo load
 * bundled images, sounds and fonts by resource NAME at runtime (Resources.getIdentifier), which the
 * resource shrinker cannot see, so shrinking alone could silently drop an icon or a notification
 * sound. This writes res/raw/fastque_keep.xml keeping every drawable, mipmap, raw and font resource;
 * everything else (unused layouts, strings, colors, dimens from AndroidX / Material / libraries) is
 * still removed. Shrinking itself is enabled through expo-build-properties
 * `enableShrinkResourcesInReleaseBuilds`.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const KEEP_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@drawable/*,@mipmap/*,@raw/*,@font/*" />
`;

function writeKeepFile(projectRoot) {
  const dir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'raw');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'fastque_keep.xml');
  fs.writeFileSync(file, KEEP_XML);
  return file;
}

const withAndroidResourceKeep = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      writeKeepFile(mod.modRequest.projectRoot);
      return mod;
    },
  ]);

module.exports = withAndroidResourceKeep;
module.exports.KEEP_XML = KEEP_XML;
module.exports.writeKeepFile = writeKeepFile;
