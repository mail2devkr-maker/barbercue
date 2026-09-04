import { Language, uiStringsFor, type UiStrings } from '@barbercue/shared';

// A synchronous, non-React mirror of LanguageProvider's `language` state (lib/language-context.tsx),
// for the handful of call sites — like lib/api.ts's network-offline path — that run outside any
// component and cannot call useLanguage(). LanguageProvider updates this mirror in the same
// synchronous statement it updates its own state in, so the two can never diverge; this is not a
// second independent source of truth, just a plain-module-scope readable view of the one in React.
let currentLanguage: Language = Language.EN;

export function setCurrentLanguage(language: Language): void {
  currentLanguage = language;
}

export function getCurrentUiStrings(): UiStrings {
  return uiStringsFor(currentLanguage);
}
