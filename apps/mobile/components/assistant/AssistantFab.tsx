import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSISTANT_PATHS, type AssistantAccessDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { navigationRef } from '../../navigation/navigation-ref';
import { fastQue, font } from '../../lib/theme';
import { GradientView } from '../ui/GradientView';

/** Routes where a floating launcher would cover the assistant itself or a full-screen task. */
const HIDDEN_ON = new Set(['Assistant']);
const TAB_BAR_HEIGHT = 60;

/**
 * Website parity for the always-visible FastQue Assistant launcher (web OwnerShell / customer account
 * layout): a floating button above the tab bar on every main screen, instead of only a card deep in
 * Account. Fail closed exactly like AssistantEntry — it renders only after the authenticated
 * `assistant/access` call says the assistant is enabled for this user.
 */
export function AssistantFab({ onOpen, tabBarHeight = TAB_BAR_HEIGHT, includeBottomInset = false }: {
  onOpen: () => void;
  tabBarHeight?: number;
  /** The customer tab bar already adds the bottom inset to its own height; the owner/staff bars do not. */
  includeBottomInset?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch<AssistantAccessDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.access}`)
      .then((access) => { if (active) setEnabled(access?.enabled === true); })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const read = () => { try { setRouteName(navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined); } catch { /* not ready */ } };
    read();
    const unsubscribe = navigationRef.addListener('state', read);
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { unsubscribe(); show.remove(); hide.remove(); };
  }, []);

  if (!enabled || keyboardOpen || (routeName && HIDDEN_ON.has(routeName))) return null;

  const bottom = tabBarHeight + (includeBottomInset ? 0 : insets.bottom) + 14;
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open FastQue Assistant"
        onPress={onOpen}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
        testID="assistant-fab"
      >
        <GradientView colors={[fastQue.gradientStart, fastQue.gradientMid, fastQue.gradientEnd]} stops={[0, 0.55, 1]} style={styles.button}>
          <Text style={styles.icon}>✦</Text>
          <Text style={styles.label}>Assistant</Text>
        </GradientView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', right: 16 },
  hit: { borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 48, borderRadius: 28 },
  icon: { color: fastQue.text, fontSize: 16 },
  label: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: 14 },
  pressed: { opacity: 0.85 },
});
