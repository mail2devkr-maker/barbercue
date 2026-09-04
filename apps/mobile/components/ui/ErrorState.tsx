import { StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, space } from '../../lib/theme';
import { useLanguage } from '../../lib/language-context';
import { Button } from './Button';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/** A retry-capable error surface — every screen that fetches on mount should offer this instead
 * of stranding the customer on plain red text with no way forward. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useLanguage();
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {onRetry && <Button title={t.tryAgain} onPress={onRetry} variant="outline" style={styles.action} />}
    </View>
  );
}

/** Inline variant — a soft tinted card for form-level errors, matching the login screen's
 * errorCard treatment. Does not include a retry action; the surrounding form's own submit does. */
export function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: space[6], paddingHorizontal: space[4] },
  message: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.muted, textAlign: 'center' },
  action: { marginTop: space[4], minWidth: 160 },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(176, 65, 62, 0.24)',
    backgroundColor: color.accentSoft,
    borderRadius: 8,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    marginBottom: space[4],
  },
  cardText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: '#8f302d', textAlign: 'center' },
});
