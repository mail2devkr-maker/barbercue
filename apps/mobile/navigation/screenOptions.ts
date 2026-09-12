// Shared native-stack header presets, reused across stacks so a screen registered in more than
// one navigator (StyleAdvisor lives under both Home and Account) looks identical either way.
import { fastQue } from '../lib/theme';

/** Premium theme — every screen in the app as of M2B. */
export const lightStackOptions = {
  headerStyle: { backgroundColor: fastQue.backgroundRaised },
  headerTintColor: fastQue.text,
  headerTitleStyle: { fontFamily: 'WorkSans_600SemiBold' as const },
  contentStyle: { backgroundColor: fastQue.background },
};

// No default `title` here — both call sites (AccountStack, HomeStack) always spread this and then
// immediately override title with the localized t.aiStyleAdvisor, so a hardcoded English default
// here would be dead code that never actually renders.
export const styleAdvisorHeaderOptions = {
  ...lightStackOptions,
};
