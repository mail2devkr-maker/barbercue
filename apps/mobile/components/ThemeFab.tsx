import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Keyboard, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, fontSize, radius, space } from '../lib/theme';
import { clampFabOffset, parseFabOffset, type FabOffset } from '../lib/assistant-fab-position';
import { getItem, setItem } from '../lib/secure-storage';
import { useLanguage } from '../lib/language-context';
import { useThemeChoice, useThemedStyles, type ThemeChoice, type ThemeTokens } from '../lib/theme-mode';
import { useRealInsets } from './TopBrandBar';

const POSITION_KEY = 'theme_fab_offset_v1';
const SIZE = 46;

const OPTIONS: Array<{ id: ThemeChoice; en: string; hi: string }> = [
  { id: 'designed', en: 'As designed', hi: 'जैसा डिज़ाइन है' },
  { id: 'light', en: 'Light', hi: 'लाइट' },
  { id: 'dark', en: 'Dark', hi: 'डार्क' },
  { id: 'system', en: 'Same as phone', hi: 'फ़ोन जैसा' },
];

/**
 * Owner request: the theme switch was only a card deep in Account. This floating button (bottom-left,
 * mirroring the Assistant launcher on the right) opens the four theme choices, and can be dragged
 * anywhere like the Assistant button; the spot is remembered on this phone.
 */
export function ThemeFab({ tabBarHeight, includeBottomInset = false }: { tabBarHeight: number; includeBottomInset?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const real = useRealInsets();
  const { language } = useLanguage();
  const hi = language === 'HI';
  const { choice, setChoice } = useThemeChoice();
  const [open, setOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const saved = useRef<FabOffset>({ x: 0, y: 0 });
  const dragStart = useRef<FabOffset>({ x: 0, y: 0 });
  const bottomRef = useRef(0);
  const topRef = useRef(0);

  // Offsets are relative to the bottom-LEFT anchor; clampFabOffset works for a right anchor, so x is
  // mirrored in and out.
  const clamp = (o: FabOffset): FabOffset => {
    const { width, height } = Dimensions.get('window');
    const c = clampFabOffset({ x: -o.x, y: o.y }, { width, height, fabWidth: SIZE, fabHeight: SIZE, bottom: bottomRef.current, top: topRef.current });
    return { x: -c.x, y: c.y };
  };

  useEffect(() => {
    let active = true;
    void getItem(POSITION_KEY).then((raw) => {
      const parsed = parseFabOffset(raw);
      if (!active || !parsed) return;
      saved.current = parsed;
      offset.setValue(parsed);
    }).catch(() => undefined);
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { active = false; show.remove(); hide.remove(); };
  }, [offset]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onPanResponderGrant: () => { dragStart.current = { ...saved.current }; },
    onPanResponderMove: (_, g) => offset.setValue(clamp({ x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy })),
    onPanResponderRelease: (_, g) => {
      const next = clamp({ x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy });
      saved.current = next;
      offset.setValue(next);
      void setItem(POSITION_KEY, JSON.stringify(next)).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp reads refs only
  }), [offset]);

  if (keyboardOpen) return null;
  const bottom = tabBarHeight + (includeBottomInset ? 0 : insets.bottom) + 14;
  bottomRef.current = bottom;
  topRef.current = insets.top;

  return (
    <>
      <View pointerEvents="box-none" style={[styles.layer, { bottom }]}>
        <Animated.View {...pan.panHandlers} style={{ transform: offset.getTranslateTransform() }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hi ? 'थीम बदलें' : 'Change theme'}
            onPress={() => setOpen(true)}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            testID="theme-fab"
          >
            {/* Drawn with views, not a glyph: some Android fonts render ◐ as a missing-glyph box. */}
            <View style={styles.halfCircle} accessible={false}>
              <View style={styles.halfFill} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={hi ? 'बंद करें' : 'Close'}>
          <View style={[styles.sheet, { marginBottom: real.bottom + space[4] }]}>
            <Text style={styles.title}>{hi ? 'थीम' : 'Theme'}</Text>
            {OPTIONS.map((o) => {
              const selected = choice === o.id;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => { setChoice(o.id); setOpen(false); }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{hi ? o.hi : o.en}</Text>
                  {selected && <Text style={styles.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  layer: { position: 'absolute', left: 16 },
  button: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.borderStrong, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 9 },
  halfCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: fastQue.text, overflow: 'hidden', flexDirection: 'row' },
  halfFill: { width: 9, height: '100%', backgroundColor: fastQue.text },
  pressed: { opacity: 0.85 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', paddingHorizontal: space[4] },
  sheet: { backgroundColor: fastQue.backgroundRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: fastQue.border, padding: space[4] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text, marginBottom: space[3] },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border, marginBottom: space[2] },
  optionSelected: { borderColor: fastQue.gradientMid },
  optionText: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.text },
  optionTextSelected: { color: fastQue.gradientMid },
  check: { fontSize: fontSize.base, color: fastQue.gradientMid },
});
