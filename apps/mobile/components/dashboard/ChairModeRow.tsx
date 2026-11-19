import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, fontSize, space } from '../../lib/theme';
import { useThemedStyles, type ThemeTokens } from '../../lib/theme-mode';

export type ChairOccupancy = 'FREE' | 'LOCAL' | 'ONLINE';

/**
 * One chair on a single line: name, state and an ONLINE / OFFLINE switch (owner request, 16 Nov).
 * ONLINE = open for online bookings and the live queue; OFFLINE = kept for walk-in (local) customers
 * only. It maps onto the existing FREE <-> LOCAL occupancy calls, so the backend is unchanged. A
 * chair busy with an online customer shows the token instead and has no switch.
 */
export function ChairModeRow({ label, occupancy, tokenNumber, busy, hi, onGoOffline, onGoOnline }: {
  label: string;
  occupancy: ChairOccupancy;
  tokenNumber?: number | null;
  busy: boolean;
  hi: boolean;
  onGoOffline: () => void;
  onGoOnline: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const state = occupancy === 'FREE' ? 'FREE' : occupancy === 'LOCAL' ? (hi ? 'सिर्फ़ लोकल' : 'LOCAL ONLY') : `Token #${tokenNumber ?? '?'}`;
  return (
    <View style={styles.line}>
      <Text style={styles.name} numberOfLines={1}>{label}</Text>
      <Text style={styles.state} numberOfLines={1}>{state}</Text>
      {occupancy === 'FREE' && (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: true, busy }} accessibilityLabel={`${label} online`} disabled={busy} onPress={onGoOffline} style={[styles.pill, styles.online, busy && styles.busy]}>
          <Text style={[styles.pillText, styles.onlineText]}>{busy ? '…' : 'ONLINE'}</Text>
        </Pressable>
      )}
      {occupancy === 'LOCAL' && (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: false, busy }} accessibilityLabel={`${label} offline`} disabled={busy} onPress={onGoOnline} style={[styles.pill, styles.offline, busy && styles.busy]}>
          <Text style={[styles.pillText, styles.offlineText]}>{busy ? '…' : 'OFFLINE'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = ({ color }: ThemeTokens) => StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border },
  name: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  state: { flex: 1, fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  pill: { minWidth: 84, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[3], borderWidth: 1 },
  online: { backgroundColor: '#e3f4ea', borderColor: '#2f9e5b' },
  offline: { backgroundColor: '#eceae6', borderColor: '#8a847b' },
  busy: { opacity: 0.5 },
  pillText: { fontFamily: font.bodyBold, fontSize: fontSize.xs, letterSpacing: 0.5 },
  onlineText: { color: '#1f7a45' },
  offlineText: { color: '#5d574f' },
});
