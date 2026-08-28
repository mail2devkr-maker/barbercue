// Shared native-stack header presets, reused across stacks so a screen registered in more than
// one navigator (StyleAdvisor lives under both Home and Account) looks identical either way.

/** Unchanged dark theme — for screens not yet redesigned this checkpoint. */
export const darkStackOptions = {
  headerStyle: { backgroundColor: '#1C1A17' },
  headerTintColor: '#EDE6DA' as const,
  contentStyle: { backgroundColor: '#1C1A17' },
};

export const styleAdvisorHeaderOptions = {
  title: 'AI Style Advisor',
  ...darkStackOptions,
};
