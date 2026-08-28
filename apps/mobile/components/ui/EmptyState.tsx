import { StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, space } from '../../lib/theme';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** A polished "nothing here yet" state — never a raw blank screen or a bare line of text. Used
 * for empty search results, no bookings, no active queue, etc. */
export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.badge} />
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && <Button title={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: space[7], paddingHorizontal: space[4] },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: color.gold,
    backgroundColor: color.goldSoft,
    marginBottom: space[4],
  },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, textAlign: 'center' },
  message: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: color.muted,
    textAlign: 'center',
    marginTop: space[2],
    maxWidth: 300,
  },
  action: { marginTop: space[5], minWidth: 180 },
});
