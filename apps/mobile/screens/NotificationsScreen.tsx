import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NOTIFICATION_PATHS } from '@barbercue/shared';
import type { NotificationDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, EmptyState, Skeleton } from '../components/ui';

const TYPE_LABEL: Record<string, string> = {
  'booking.confirmed': 'Booking confirmed',
  'booking.cancelled': 'Booking cancelled',
  'booking.reminder': 'Upcoming appointment',
  'queue.turn_approaching': 'Your turn is approaching',
  'owner.booking.created': 'New booking',
  'owner.booking.cancelled': 'Booking cancelled',
  'owner.walk_in.joined': 'New walk-in',
  'staff.assigned': 'You were assigned a customer',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Notification Center (Phase 11/12) — the primary customer-facing notification surface on mobile.
 * Reuses the exact same backend contract as the web NotificationBell; deepLink is web-route-shaped
 * (e.g. "account/bookings") since no mobile route-mapping exists yet, so this screen shows the
 * notification content itself rather than attempting to navigate anywhere on tap.
 */
export default function NotificationsScreen() {
  const { t } = useLanguage();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((cursor: string | undefined, append: boolean) => {
    if (append) setLoadingMore(true);
    const params = cursor ? `?cursor=${cursor}` : '';
    return apiFetch<{ items: NotificationDto[]; nextCursor: string | null }>(
      `${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.mine}${params}`,
    )
      .then((result) => {
        setItems((prev) => (append ? [...(prev ?? []), ...result.items] : result.items));
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (!append) setItems([]);
      })
      .finally(() => {
        setLoadingMore(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(undefined, false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  function markRead(n: NotificationDto) {
    if (n.readAt) return;
    apiFetch(`${NOTIFICATION_PATHS.notifications}/${n.id}/${NOTIFICATION_PATHS.read}`, { method: 'POST' }).catch(() => {});
    setItems((prev) => (prev ?? []).map((it) => (it.id === n.id ? { ...it, readAt: new Date().toISOString() } : it)));
  }

  function markAllRead() {
    apiFetch(`${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.mine}/${NOTIFICATION_PATHS.readAll}`, { method: 'POST' })
      .then(() => setItems((prev) => (prev ?? []).map((it) => ({ ...it, readAt: it.readAt ?? new Date().toISOString() }))))
      .catch(() => {});
  }

  const hasUnread = (items ?? []).some((n) => !n.readAt);

  return (
    <Screen scroll={false}>
      <SectionHeader eyebrow="Account" title={t.notifications} />
      {hasUnread && (
        <Button title={t.markAllRead} variant="outline" onPress={markAllRead} style={styles.markAllButton} />
      )}

      {items === null ? (
        <>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(undefined, false);
              }}
              tintColor={color.accent}
              colors={[color.accent]}
            />
          }
        >
          {items.length === 0 ? (
            <EmptyState title={t.notifications} message={t.noNotifications} />
          ) : (
            items.map((n) => (
              <Pressable key={n.id} onPress={() => markRead(n)} style={[styles.row, !n.readAt && styles.rowUnread]}>
                <View style={styles.rowHead}>
                  {!n.readAt && <View style={styles.dot} />}
                  <Text style={[styles.title, !n.readAt && styles.titleUnread]}>
                    {TYPE_LABEL[n.type] ?? n.type}
                  </Text>
                </View>
                {typeof n.payload?.serviceName === 'string' && (
                  <Text style={styles.meta}>{n.payload.serviceName}</Text>
                )}
                <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
              </Pressable>
            ))
          )}
          {nextCursor && (
            <Button
              title={loadingMore ? 'Loading…' : 'Load more'}
              variant="outline"
              onPress={() => void load(nextCursor, true)}
              loading={loadingMore}
              style={styles.loadMoreButton}
            />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 70, borderRadius: radius.lg, marginBottom: space[3] },
  markAllButton: { marginBottom: space[3], alignSelf: 'flex-start' },
  row: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
    marginBottom: space[3],
  },
  rowUnread: { borderColor: color.accent },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: color.accent },
  title: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  titleUnread: { fontFamily: font.bodyBold },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  time: { fontFamily: font.bodyRegular, fontSize: 10, color: color.muted, marginTop: 4 },
  loadMoreButton: { marginTop: space[2], marginBottom: space[6] },
});
