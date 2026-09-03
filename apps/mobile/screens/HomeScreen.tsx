import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BOOKING_PATHS,
  QUEUE_ENTRIES_PATH,
  formatMoney,
  type BookingDetailDto,
  type PaginatedResult,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useUnreadNotificationCount } from '../lib/notifications';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Card, Button, Skeleton, NotificationBell } from '../components/ui';
import type { HomeStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  BottomTabScreenProps<TabParamList>
>;

const ACTIVE_QUEUE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HomeScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeQueueEntry, setActiveQueueEntry] = useState<QueueEntryDetailDto | null>(null);
  const [upcomingBooking, setUpcomingBooking] = useState<BookingDetailDto | null>(null);
  const unreadCount = useUnreadNotificationCount();

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [queueEntry, bookingsPage] = await Promise.all([
        apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`).catch(() => null),
        apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}`).catch(
          () => null,
        ),
      ]);
      setActiveQueueEntry(queueEntry && ACTIVE_QUEUE_STATUSES.has(queueEntry.status) ? queueEntry : null);
      const now = Date.now();
      const nextUpcoming =
        bookingsPage?.items.find((b) => b.status === 'CONFIRMED' && new Date(b.slotStart).getTime() > now) ?? null;
      setUpcomingBooking(nextUpcoming);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch every time Home regains focus (e.g. returning from booking/queue flows), not just on
  // first mount — the whole point of these cards is that they reflect current state.
  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  function goFindSalon() {
    navigation.navigate('SearchTab', { screen: 'SalonSearch' });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void load(true)}>
      <View style={styles.headerRow}>
        <SectionHeader eyebrow="BarberCue" title="Welcome back" subtitle="Book ahead, or join a live queue near you." />
        <NotificationBell
          unreadCount={unreadCount}
          onPress={() => navigation.navigate('AccountTab', { screen: 'Notifications' })}
        />
      </View>

      <Pressable style={styles.searchEntry} onPress={goFindSalon}>
        <Text style={styles.searchEntryText}>Search shops or services…</Text>
      </Pressable>

      {loading ? (
        <View style={styles.loadingStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : (
        <>
          {activeQueueEntry && (
            <Card style={styles.statusCard}>
              <Text style={styles.statusEyebrow}>Live queue</Text>
              <Text style={styles.statusTitle}>Token #{activeQueueEntry.tokenNumber}</Text>
              <Text style={styles.statusMeta}>
                {activeQueueEntry.status === 'CALLED'
                  ? "You're being called — please head to the counter!"
                  : activeQueueEntry.status === 'IN_SERVICE'
                    ? 'In service'
                    : activeQueueEntry.position
                      ? `Position ${activeQueueEntry.position} in line`
                      : activeQueueEntry.status}
              </Text>
              <Button title="View queue status" variant="secondary" onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome' })} style={styles.cardAction} />
            </Card>
          )}

          {upcomingBooking && (
            <Card style={styles.statusCard}>
              <Text style={styles.statusEyebrow}>Upcoming booking</Text>
              <Text style={styles.statusTitle}>{upcomingBooking.serviceName}</Text>
              <Text style={styles.statusMeta}>
                {upcomingBooking.salonName} · {formatSlot(upcomingBooking.slotStart)}
              </Text>
              <Text style={styles.statusMeta}>{formatMoney(upcomingBooking.servicePrice, upcomingBooking.currency)}</Text>
              <Button
                title="View booking"
                variant="secondary"
                onPress={() =>
                  navigation.navigate('BookingsTab', { screen: 'BookingDetail', params: { bookingId: upcomingBooking.id } })
                }
                style={styles.cardAction}
              />
            </Card>
          )}
        </>
      )}

      <View style={styles.choiceRow}>
        <Pressable style={styles.choiceCard} onPress={goFindSalon}>
          <Text style={styles.choiceKicker}>Book ahead</Text>
          <Text style={styles.choiceTitle}>Reserve a chair</Text>
          <Text style={styles.choiceMeta}>Service → barber → time</Text>
        </Pressable>
        <Pressable style={[styles.choiceCard, styles.choiceCardAccent]} onPress={goFindSalon}>
          <Text style={[styles.choiceKicker, styles.choiceKickerAccent]}>Join live</Text>
          <Text style={styles.choiceTitle}>Skip the wait</Text>
          <Text style={styles.choiceMeta}>Find a shop, join the queue</Text>
        </Pressable>
      </View>

      <View style={styles.shortcutRow}>
        <Pressable style={styles.shortcut} onPress={() => navigation.navigate('BookingsTab', { screen: 'MyBookings' })}>
          <Text style={styles.shortcutText}>My bookings</Text>
        </Pressable>
        <Pressable style={styles.shortcut} onPress={() => navigation.navigate('StyleAdvisor')}>
          <Text style={styles.shortcutText}>AI Style Advisor</Text>
        </Pressable>
        <Pressable style={styles.shortcut} onPress={() => navigation.navigate('AccountTab', { screen: 'Account' })}>
          <Text style={styles.shortcutText}>Account &amp; Premium</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[2] },
  searchEntry: {
    minHeight: 50,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    marginBottom: space[5],
  },
  searchEntryText: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: color.muted },

  loadingStack: { gap: space[3], marginBottom: space[5] },
  skeletonCard: { height: 96, borderRadius: radius.lg },

  statusCard: { marginBottom: space[4] },
  statusEyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.gold,
    marginBottom: space[1],
  },
  statusTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  statusMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: space[1] },
  cardAction: { marginTop: space[3], alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space[4] },

  choiceRow: { flexDirection: 'row', gap: space[3], marginBottom: space[5] },
  choiceCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
  },
  choiceCardAccent: { backgroundColor: color.accentSoft, borderColor: 'rgba(176, 65, 62, 0.24)' },
  choiceKicker: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.muted,
    marginBottom: space[2],
  },
  choiceKickerAccent: { color: color.accent },
  choiceTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[1] },
  choiceMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },

  shortcutRow: { gap: space[2] },
  shortcut: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
  },
  shortcutText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
