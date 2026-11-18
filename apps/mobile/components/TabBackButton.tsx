import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { font, fontSize, fastQue } from '../lib/theme';
import { useLanguage } from '../lib/language-context';
import { useThemedStyles, type ThemeTokens } from '../lib/theme-mode';

type Nav = NavigationProp<ParamListBase>;

/** The nearest bottom-tab navigator above this screen, if any. */
function tabNavigatorOf(navigation: Nav): Nav | null {
  let current: Nav | undefined = navigation;
  while (current) {
    if (current.getState()?.type === 'tab') return current;
    current = current.getParent();
  }
  return null;
}

/**
 * Owner report (18 Nov): "there is no back button in the app". Tab screens (Search, Bookings, Queue,
 * Shop, Account...) had no way back except the phone's own back gesture. This "‹ Back" returns to
 * the previous screen (tab history), and when the app was opened straight on this tab it goes to
 * the first tab (the Dashboard). Android and iOS identical.
 */
export function TabBackButton({ style, compact = false }: { style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const { language } = useLanguage();
  const label = language === 'HI' ? 'पीछे' : 'Back';

  function goBack() {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const tabs = tabNavigatorOf(navigation);
    const first = tabs?.getState()?.routeNames[0];
    if (tabs && first) tabs.navigate(first);
  }

  return (
    <Pressable
      onPress={goBack}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[compact ? styles.compact : styles.button, style]}
    >
      <Text style={styles.text}>{`‹ ${label}`}</Text>
    </Pressable>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  button: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingRight: 12, marginBottom: 4 },
  compact: { paddingHorizontal: 4, paddingVertical: 4 },
  text: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.pink },
});
