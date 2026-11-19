import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, space } from '../../lib/theme';
import { useThemedStyles, type ThemeTokens } from '../../lib/theme-mode';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, style]}>{children}</View>;
}

const makeStyles = ({ color, surface }: ThemeTokens) =>
  StyleSheet.create({
    card: {
      backgroundColor: surface.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.border,
      padding: space[5],
      shadowColor: color.ink,
      shadowOpacity: 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
  });
