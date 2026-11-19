import { Pressable, StyleSheet, Text, View } from 'react-native';
import { font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { useLanguage } from '../lib/language-context';
import { useThemeChoice, useThemedStyles, type ThemeChoice, type ThemeTokens } from '../lib/theme-mode';
import { Card } from './ui';

const OPTIONS: Array<{ id: ThemeChoice; en: string; hi: string; hintEn: string; hiHint: string }> = [
  { id: 'designed', en: 'As designed', hi: 'जैसा डिज़ाइन है', hintEn: 'FastQue colours', hiHint: 'FastQue के रंग' },
  { id: 'light', en: 'Light', hi: 'लाइट', hintEn: 'Bright background', hiHint: 'हल्का बैकग्राउंड' },
  { id: 'dark', en: 'Dark', hi: 'डार्क', hintEn: 'Dark background', hiHint: 'गहरा बैकग्राउंड' },
  { id: 'system', en: 'Same as phone', hi: 'फ़ोन जैसा', hintEn: "Follows the phone's setting", hiHint: 'फ़ोन की सेटिंग से' },
];

/** Owner request: switch the app between Light and Dark (saved on this phone). Android and iOS identical. */
export function AppearanceCard() {
  const { language } = useLanguage();
  const hi = language === 'HI';
  const { choice, setChoice } = useThemeChoice();
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{hi ? 'दिखावट (थीम)' : 'Appearance'}</Text>
      <View style={styles.options} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => {
          const selected = choice === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setChoice(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={hi ? option.hi : option.en}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{hi ? option.hi : option.en}</Text>
              <Text style={styles.hint}>{hi ? option.hiHint : option.hintEn}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const makeStyles = ({ color }: ThemeTokens) =>
  StyleSheet.create({
    card: { marginBottom: space[4] },
    title: { fontFamily: font.bodyBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink, marginBottom: space[3] },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
    option: {
      flexBasis: '47%',
      flexGrow: 1,
      paddingVertical: space[3],
      paddingHorizontal: space[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border,
    },
    optionSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
    optionText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
    optionTextSelected: { color: color.accent },
    hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: 2 },
  });
