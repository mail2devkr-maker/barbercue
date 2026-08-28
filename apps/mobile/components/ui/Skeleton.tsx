import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, radius } from '../../lib/theme';

/**
 * A static (non-animated) placeholder block — deliberately no shimmer/pulse animation, per the
 * instruction to avoid decorative complexity that costs performance on lower-end Android devices.
 * A muted flat block reads clearly as "loading" without an animation loop running underneath it.
 */
export function Skeleton({ style }: { style?: ViewStyle }) {
  return <View style={[styles.block, style]} />;
}

const styles = StyleSheet.create({
  block: { backgroundColor: color.border, borderRadius: radius.sm, opacity: 0.6 },
});
