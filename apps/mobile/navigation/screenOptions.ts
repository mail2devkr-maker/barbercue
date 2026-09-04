// Shared native-stack header presets, reused across stacks so a screen registered in more than
// one navigator (StyleAdvisor lives under both Home and Account) looks identical either way.
import { color } from '../lib/theme';

/** Premium theme — every screen in the app as of M2B. */
export const lightStackOptions = {
  headerStyle: { backgroundColor: color.surface },
  headerTintColor: color.ink,
  headerTitleStyle: { fontFamily: 'WorkSans_600SemiBold' as const },
  contentStyle: { backgroundColor: color.surface },
};

// No default `title` here — both call sites (AccountStack, HomeStack) always spread this and then
// immediately override title with the localized t.aiStyleAdvisor, so a hardcoded English default
// here would be dead code that never actually renders.
export const styleAdvisorHeaderOptions = {
  ...lightStackOptions,
};
