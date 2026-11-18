// Shared native-stack header presets, reused across stacks so a screen registered in more than
// one navigator (StyleAdvisor lives under both Home and Account) looks identical either way.
import { useMemo } from 'react';
import { fastQue as designedDark } from '../lib/theme';
import { useThemeTokens, type DarkTokens } from '../lib/theme-mode';

function stackOptionsFor(fastQue: DarkTokens) {
  return {
    headerStyle: { backgroundColor: fastQue.backgroundRaised },
    headerTintColor: fastQue.text,
    headerTitleStyle: { fontFamily: 'WorkSans_600SemiBold' as const },
    contentStyle: { backgroundColor: fastQue.background },
  };
}

/** Premium theme as designed (dark). Inside navigators prefer useStackOptions() so headers follow the theme. */
export const lightStackOptions = stackOptionsFor(designedDark);

// No default `title` here — both call sites (AccountStack, HomeStack) always spread this and then
// immediately override title with the localized t.aiStyleAdvisor, so a hardcoded English default
// here would be dead code that never actually renders.
export const styleAdvisorHeaderOptions = {
  ...lightStackOptions,
};

/** Header/background options for the theme in force (Light / Dark / As designed). */
export function useStackOptions() {
  const { fastQue } = useThemeTokens();
  return useMemo(() => stackOptionsFor(fastQue), [fastQue]);
}
