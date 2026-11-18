import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Keyboard, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSISTANT_PATHS, type AssistantAccessDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { navigationRef } from '../../navigation/navigation-ref';
import { fastQue, font } from '../../lib/theme';
import { GradientView } from '../ui/GradientView';
import { clampFabOffset, parseFabOffset, type FabOffset } from '../../lib/assistant-fab-position';
import { getItem, setItem } from '../../lib/secure-storage';
import { useThemedStyles, useThemeTokens, type ThemeTokens } from '../../lib/theme-mode';

const POSITION_KEY = 'assistant_fab_offset_v1';
const FAB_WIDTH = 132;
const FAB_HEIGHT = 48;

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
  const { fastQue } = useThemeTokens();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>(undefined);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // Owner request (16 Nov): the launcher can be dragged anywhere so it never covers content, and it
  // remembers where it was left. The offset is relative to the default bottom-right anchor.
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const saved = useRef<FabOffset>({ x: 0, y: 0 });
  const dragStart = useRef<FabOffset>({ x: 0, y: 0 });
  const bottomRef = useRef(0);
  const topInsetRef = useRef(0);

  useEffect(() => {
    let active = true;
    void getItem(POSITION_KEY).then((raw) => {
      const parsed = parseFabOffset(raw);
      if (!active || !parsed) return;
      saved.current = parsed;
      offset.setValue(parsed);
    }).catch(() => { /* keep the default spot */ });
    return () => { active = false; };
  }, [offset]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // A real drag only starts after a few px of movement, so a plain tap still opens the assistant.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { dragStart.current = { ...saved.current }; },
    onPanResponderMove: (_, g) => {
      const { width, height } = Dimensions.get('window');
      const next = clampFabOffset({ x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy }, { width, height, fabWidth: FAB_WIDTH, fabHeight: FAB_HEIGHT, bottom: bottomRef.current, top: topInsetRef.current });
      offset.setValue(next);
    },
    onPanResponderRelease: (_, g) => {
      const { width, height } = Dimensions.get('window');
      const next = clampFabOffset({ x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy }, { width, height, fabWidth: FAB_WIDTH, fabHeight: FAB_HEIGHT, bottom: bottomRef.current, top: topInsetRef.current });
      saved.current = next;
      offset.setValue(next);
      void setItem(POSITION_KEY, JSON.stringify(next)).catch(() => { /* position is a convenience only */ });
    },
  }), [offset]);

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
  bottomRef.current = bottom;
  topInsetRef.current = insets.top;
  return (
    <View pointerEvents="box-none" style={[styles.layer, { bottom }]}>
      <Animated.View {...pan.panHandlers} style={{ transform: offset.getTranslateTransform() }}>
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
      </Animated.View>
    </View>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  layer: { position: 'absolute', right: 16 },
  hit: { borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, height: 48, borderRadius: 28 },
  icon: { color: fastQue.text, fontSize: 16 },
  label: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: 14 },
  pressed: { opacity: 0.85 },
});
