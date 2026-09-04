import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { color, font, fontSize } from '../lib/theme';
import { useLanguage } from '../lib/language-context';
import type { TabParamList } from './types';

/**
 * Rendered via a stack screen's `headerRight` — so `useNavigation()` here resolves to that
 * screen's own stack navigator, and `.getParent()` correctly reaches the enclosing bottom-tab
 * navigator regardless of which stack this button is used in (Search, Bookings, ...). Pops the
 * current stack back to its own root first so it isn't left mid-flow (a stale ConfirmBooking or
 * BookingDetail screen) the next time the user returns to this tab, then switches to HomeTab.
 */
export function HomeHeaderButton() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const { t } = useLanguage();

  function goHome() {
    navigation.popToTop();
    navigation.getParent<BottomTabNavigationProp<TabParamList>>()?.navigate('HomeTab', { screen: 'Home' });
  }

  return (
    <Pressable onPress={goHome} hitSlop={8} style={styles.button}>
      <Text style={styles.text}>{t.homeButtonLabel}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 4, paddingVertical: 4 },
  text: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent },
});
