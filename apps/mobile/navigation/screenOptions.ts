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

export const styleAdvisorHeaderOptions = {
  title: 'AI Style Advisor',
  ...lightStackOptions,
};
