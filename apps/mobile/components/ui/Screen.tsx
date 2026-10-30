import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../../lib/theme';

interface ScreenProps {
  children: ReactNode;
  /** Scrollable content (most screens) vs. a fixed layout (e.g. a screen that manages its own
   * ScrollView/FlatList, or a centered empty/loading state). Defaults to scrollable. */
  scroll?: boolean;
  /** Pull-to-refresh — only meaningful when scroll is true. */
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Array<'top' | 'bottom'>;
}

/**
 * Base screen wrapper: cream surface, safe-area padding, optional scroll + pull-to-refresh. Every
 * top-level tab/stack screen should use this instead of hand-rolling its own root View so safe
 * areas and background are never re-solved per screen.
 */
export function Screen({ children, scroll = true, refreshing, onRefresh, contentStyle, edges = ['top', 'bottom'] }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
  };

  const content = !scroll ? (
    <View style={[styles.root, padding, contentStyle]}>{children}</View>
  ) : (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scrollContent, padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );

  // Android-only JS fix for the installed Play runtime: keep the active scrollable screen inside
  // a keyboard-aware available-height container. Android's own soft-input resize handles the
  // actual keyboard inset; do not add padding/height here (which can double-shift on Android).
  // iOS remains unchanged for the independent release track.
  return Platform.OS === 'android' ? (
    <KeyboardAvoidingView style={styles.root}>{content}</KeyboardAvoidingView>
  ) : content;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  scrollContent: { flexGrow: 1, padding: space[5] },
});
