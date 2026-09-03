import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGE_LABELS, Language } from '@barbercue/shared';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize } from '../../lib/theme';

/**
 * Issue 9 (mobile launch mission) — directly visible, not buried in Account: rendered on the
 * pre-auth landing (RoleSelectScreen) and the customer Home header. Two languages today
 * (English/Hindi); a third Language enum value just adds another pill here automatically.
 */
export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Language">
      {Object.values(Language).map((lang) => (
        <Pressable
          key={lang}
          onPress={() => setLanguage(lang)}
          accessibilityRole="radio"
          accessibilityState={{ selected: language === lang }}
          style={[styles.pill, language === lang && styles.pillActive]}
        >
          <Text style={[styles.pillText, language === lang && styles.pillTextActive]}>{LANGUAGE_LABELS[lang]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  pill: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: color.border },
  pillActive: { backgroundColor: color.ink, borderColor: color.ink },
  pillText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  pillTextActive: { color: color.accentContrast },
});
