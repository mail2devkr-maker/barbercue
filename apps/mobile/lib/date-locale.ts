import { DATE_LOCALE, Language } from '@barbercue/shared';

/** The locale tag to pass as the first argument to toLocaleDateString/toLocaleTimeString/
 * toLocaleString wherever FastQue-generated weekday/month/date text must follow the selected UI
 * language rather than the device's own locale. See DATE_LOCALE's doc comment in
 * packages/shared/src/i18n/index.ts for why `undefined` was wrong here. */
export function dateLocaleFor(language: Language): string {
  return DATE_LOCALE[language] ?? DATE_LOCALE[Language.EN];
}
