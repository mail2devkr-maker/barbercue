import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, LanguageSwitcher } from '../components/ui';
import type { AuthStackParamList } from '../navigation/AuthStack';

type Props = NativeStackScreenProps<AuthStackParamList, 'RoleSelect'>;

const OPTIONS: { role: 'CUSTOMER' | 'OWNER' | 'STAFF'; title: string; subtitle: string }[] = [
  { role: 'CUSTOMER', title: 'Customer', subtitle: 'Book a chair or join a live queue' },
  { role: 'OWNER', title: 'Shop Owner', subtitle: 'Run your salon, queue, and team' },
  { role: 'STAFF', title: 'Barber / Staff', subtitle: 'Work today’s queue and bookings' },
];

// First screen a signed-out visitor sees. Customer keeps the frozen native Google/OTP flow;
// Owner/Staff share one email+password screen (same backend endpoint, different copy) — see
// AuthStack.tsx for why there is no separate "owner auth" concept on the backend.
export default function RoleSelectScreen({ navigation }: Props) {
  const { t } = useLanguage();

  function choose(role: 'CUSTOMER' | 'OWNER' | 'STAFF') {
    if (role === 'CUSTOMER') {
      navigation.navigate('CustomerLogin');
    } else {
      navigation.navigate('OwnerStaffLogin', { role });
    }
  }

  return (
    <Screen contentStyle={styles.screenContent}>
      <View style={styles.languageRow}>
        <LanguageSwitcher />
      </View>
      <View style={styles.brandRow}>
        <View style={styles.badgeHalo}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>BC</Text>
          </View>
        </View>
        <Text style={styles.wordmark}>FastQue</Text>
      </View>

      {/* Issue 2 (mobile launch mission) — browse-first, auth-last: the prominent, primary action
          on first launch is finding a shop, not signing in. Google sign-in only appears later, at
          the actual booking/queue confirm step (see ConfirmBookingScreen/WalkInJoinScreen). */}
      <Pressable style={styles.browseCard} onPress={() => navigation.navigate('GuestBrowse')}>
        <Text style={styles.browseKicker}>{t.city} · {t.service}</Text>
        <Text style={styles.browseTitle}>Find a shop</Text>
        <Text style={styles.browseSubtitle}>{t.book} or {t.joinQueue.toLowerCase()} — no sign-in needed to look around.</Text>
      </Pressable>

      <SectionHeader eyebrow="Or continue as" title="Already know your account?" />

      <View style={styles.optionList}>
        {OPTIONS.map((option) => (
          <Pressable key={option.role} style={styles.optionCard} onPress={() => choose(option.role)}>
            <Text style={styles.optionTitle}>{option.title}</Text>
            <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5], justifyContent: 'center' },
  languageRow: { position: 'absolute', top: space[4], right: space[4] },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: space[6] },
  badgeHalo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(168, 121, 31, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space[3],
  },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: color.surface, fontFamily: font.bodyBold, fontSize: 13, letterSpacing: 0.5 },
  wordmark: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: color.ink, letterSpacing: -0.3 },

  optionList: { gap: space[3] },
  optionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
  },
  optionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  optionSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: space[1] },

  browseCard: {
    backgroundColor: color.ink,
    borderRadius: radius.lg,
    padding: space[5],
    marginBottom: space[6],
  },
  browseKicker: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.gold,
    marginBottom: space[1],
  },
  browseTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.surface },
  browseSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: 'rgba(255,255,255,0.72)', marginTop: space[1] },
});
