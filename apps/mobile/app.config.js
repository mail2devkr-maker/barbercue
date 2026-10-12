/*
 * Deliberately QA-ONLY Expo config on the isolated GitHub branch.
 *
 * Never cherry-pick this file into the production mobile app.
 * Produces a differently identified offline native APK to avoid changing
 * the installed Play package or receiving ANY of the existing EAS OTA groups.
 *
 * On this branch, *all* native config commands must explicitly opt into QA;
 * without the required variables they fail before native build.
 */
const { expo: base } = require('./app.json');

if (
  process.env.FASTQUE_LOCAL_QA_NATIVE !== 'true' ||
  process.env.EXPO_PUBLIC_FASTQUE_QA_ISOLATED !== 'true' ||
  process.env.EXPO_PUBLIC_API_BASE_URL !== 'http://10.0.2.2:3000/api/v1'
) {
  throw new Error(
    'QA-only native branch: set FASTQUE_LOCAL_QA_NATIVE=true, ' +
    'EXPO_PUBLIC_FASTQUE_QA_ISOLATED=true and ' +
    'EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000/api/v1. ' +
    'No production or remotely hosted backend may be used.'
  );
}

module.exports = {
  expo: {
    ...base,
    name: 'FastQue QA Isolated',
    slug: 'fastque-qa-isolated',
    android: {
      ...base.android,
      package: 'com.dcw.fastque.qalocal',
      googleServicesFile: undefined,
    },
    ios: {
      ...base.ios,
      bundleIdentifier: 'com.dcw.fastque.qalocal',
    },
    updates: {
      ...base.updates,
      enabled: false,
      url: undefined,
    },
    extra: {
      ...base.extra,
      qaOnly: true,
    },
  },
};
