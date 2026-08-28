import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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

  if (!scroll) {
    return <View style={[styles.root, padding, contentStyle]}>{children}</View>;
  }

  return (
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
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  scrollContent: { flexGrow: 1, padding: space[5] },
});
