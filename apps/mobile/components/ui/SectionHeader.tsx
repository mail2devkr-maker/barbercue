import { StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, space } from '../../lib/theme';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

/** Gold eyebrow (decorative only) + Fraunces title + muted Work Sans subtitle — the recurring
 * copy hierarchy from the login screen, reused for every section/screen header. */
export function SectionHeader({ eyebrow, title, subtitle }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: space[4] },
  eyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.gold,
    marginBottom: space[1],
  },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: color.ink },
  subtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20, color: color.muted, marginTop: space[1] },
});
