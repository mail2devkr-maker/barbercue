import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOnlineStatus } from '../lib/network-status';
import { color, font, fontSize, space } from '../lib/theme';

/**
 * Phase 15 (Low-Network / Resilience Mode). Mounted once, app-wide, in App.tsx above every
 * navigator — same "reconnecting automatically, no manual retry button" reasoning as
 * apps/web/components/layout/OfflineBanner.tsx: the realtime socket already reconnects itself and
 * resyncs via onReconnect() (see lib/realtime.ts), and apiFetch already reports a clear
 * NETWORK_OFFLINE message on individual failed requests in the meantime.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2] }]}>
      <Text style={styles.text}>You&apos;re offline — showing the last data we had.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: color.warn,
    paddingBottom: space[2],
    paddingHorizontal: space[4],
    alignItems: 'center',
  },
  text: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: '#ffffff', textAlign: 'center' },
});
