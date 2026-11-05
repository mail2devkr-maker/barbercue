import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ASSISTANT_PATHS, type AssistantAccessDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { fastQue, font, fontSize, space } from '../../lib/theme';

/** Fail closed: entry is rendered only after the authenticated API says the rollout is enabled. */
export function AssistantEntry({ onPress }: { onPress: () => void }) {
  const [enabled, setEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setEnabled(false);
      void apiFetch<AssistantAccessDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.access}`)
        .then((access) => {
          if (active) setEnabled(access.enabled === true);
        })
        .catch(() => {
          if (active) setEnabled(false);
        });
      return () => { active = false; };
    }, []),
  );

  if (!enabled) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open FastQue Assistant"
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <Text style={styles.title}>FastQue Assistant</Text>
      <Text style={styles.subtitle}>Ask a question or open a supported screen.</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  entry: { minHeight: 64, justifyContent: 'center', paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: 16, borderWidth: 1, borderColor: fastQue.borderStrong, backgroundColor: fastQue.cardStrong },
  pressed: { opacity: 0.8 },
  title: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.base },
  subtitle: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[1] },
});
