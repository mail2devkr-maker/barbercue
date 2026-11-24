import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useContext } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { font, fontSize } from '../lib/theme';
import { useLanguage } from '../lib/language-context';
import { useThemedStyles, type ThemeTokens } from '../lib/theme-mode';

/**
 * Owner report (24 Nov): the sign-in pages had no visible way back, so someone who tapped "Owner"
 * by mistake instead of "Customer" was stuck. Goes to the previous screen, or to the role choice
 * when the page was opened directly. Android and iOS identical.
 */
export function AuthBackButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  // Context read (not useNavigation) so the screen still renders outside a navigator, e.g. in tests.
  const navigation = useContext(NavigationContext);
  const { language } = useLanguage();
  const label = language === 'HI' ? 'पीछे' : 'Back';
  if (!navigation) return null;
  return (
    <Pressable
      onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('RoleSelect'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, style]}
      testID="auth-back"
    >
      <Text style={styles.text}>{`‹ ${label}`}</Text>
    </Pressable>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  button: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 16, marginBottom: 4 },
  text: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.pink },
});
