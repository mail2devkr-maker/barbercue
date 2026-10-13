import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { StaffWorkDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { liveQueuePaths } from '../../lib/live-queue-actions';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useLanguage } from '../../lib/language-context';
import { ownerOpsPaths, formatShopTime } from '../../lib/owner/ops';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * A barber's own day: the customer they are serving right now (with "Complete service"), the shop's
 * waiting list with the customers THEY can take, and their appointments. Everything is scoped by the
 * server to this barber's own records - the app only renders it.
 */
export function StaffMyDayCard({ salonId, onChanged }: { salonId: string; onChanged?: () => void }) {
  const { t } = useLanguage();
  const [work, setWork] = useState<StaffWorkDto | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await apiFetch<StaffWorkDto>(ownerOpsPaths.staffMeWork(salonId));
      if (id !== requestId.current) return;
      // A response older than what is already shown never replaces it.
      setWork((current) => (current && next.revision < current.revision ? current : next));
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      // A user with no barber record at this shop (e.g. an owner) simply has no "my day".
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) setWork(null);
      else setError(err instanceof ApiError ? err.message : 'Could not load your day.');
    }
  }, [salonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const onUpdate = (payload: { salonId?: string }) => {
      if (!payload?.salonId || payload.salonId === salonId) void load();
    };
    const events = ['queue.updated', 'queue.entry.called', 'queue.entry.reassigned', 'staff.status.changed'];
    events.forEach((name) => socket.on(name, onUpdate));
    const unsubscribe = onReconnect(() => void load());
    return () => {
      events.forEach((name) => socket.off(name, onUpdate));
      unsubscribe();
    };
  }, [salonId, load]);

  async function run(key: string, request: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await request();
      setNotice(done);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be completed. Please try again.');
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (work === undefined || work === null) {
    return error ? <InlineError message={error} /> : null;
  }

  const availabilityLabel: Record<string, string> = {
    AVAILABLE: t.availabilityAvailable,
    IN_SERVICE: t.availabilityWithCustomer,
    RESERVED: t.availabilityBookedSoon,
    OFF_DUTY: t.availabilityOffDuty,
  };
  const current = work.current;
  // A customer assigned to THIS barber whose service has not started: they start it themselves.
  const assigned = current ? null : (work.assigned ?? null);
  const eligible = work.waiting.filter((w) => w.eligible);

  function confirmComplete() {
    if (!current?.serviceSessionId) return;
    const sessionId = current.serviceSessionId;
    Alert.alert(t.confirmCompleteServiceTitle, `#${current.tokenNumber} (${current.customerLabel})`, [
      { text: t.keepEntryAction, style: 'cancel' },
      { text: t.completeServiceAction, style: 'destructive', onPress: () => void run('complete', () => apiFetch(liveQueuePaths.complete(sessionId), { method: 'POST' }), t.serviceCompletedNotice) },
    ]);
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t.myDayTitle}</Text>
      <Text style={styles.sub}>
        {t.myDaySummary
          .replace('{name}', work.displayName)
          .replace('{status}', work.assigned && !work.current ? t.statusAssigned : (availabilityLabel[work.availabilityState] ?? work.availabilityState))
          .replace('{count}', String(work.completedToday))}
      </Text>
      {error && <InlineError message={error} />}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {assigned && (
        <>
          <Text style={styles.heading}>{t.assignedToYouTitle}</Text>
          <View style={styles.block} testID="staff-assigned">
            <Text style={styles.strong}>{`#${assigned.tokenNumber} · ${assigned.customerLabel}`}</Text>
            <Text style={styles.sub}>{`${assigned.serviceName ?? 'Service'}${assigned.chairLabel ? ` · ${assigned.chairLabel}` : ''}`}</Text>
            <Text style={styles.badge}>{t.assignedNotStartedBadge}</Text>
            <Text style={styles.sub}>{t.serviceNotStartedHint}</Text>
            <Button
              title={t.startServiceAction}
              onPress={() =>
                void run(
                  'start',
                  () => apiFetch(liveQueuePaths.startService(assigned.queueEntryId), { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() } }),
                  t.serviceStartedNotice,
                )
              }
              loading={busy === 'start'}
              style={styles.button}
            />
          </View>
        </>
      )}

      <Text style={styles.heading}>{t.currentServiceHeading}</Text>
      {current ? (
        <View style={styles.block} testID="staff-current">
          <Text style={styles.strong}>{`#${current.tokenNumber} · ${current.customerLabel}`}</Text>
          <Text style={styles.sub}>{`${current.serviceName ?? 'Service'}${current.chairLabel ? ` · ${current.chairLabel}` : ''}${current.startedAt ? ` · started ${formatShopTime(current.startedAt, null)}` : ''}`}</Text>
          <Button title={t.completeServiceAction} onPress={confirmComplete} loading={busy === 'complete'} style={styles.button} />
        </View>
      ) : (
        <Text style={styles.sub}>{assigned ? t.serviceNotStartedHint : t.notServingNow}</Text>
      )}

      <Text style={styles.heading}>{t.waitingYouCanTakeHeading.replace('{count}', String(eligible.length))}</Text>
      {eligible.length === 0 ? (
        <Text style={styles.sub}>{t.nobodyEligibleForYou}</Text>
      ) : (
        eligible.map((w) => (
          <Text key={w.queueEntryId} style={styles.row}>{`#${w.tokenNumber} · ${w.customerLabel} · ${w.serviceName ?? 'Service'} · position ${w.position}`}</Text>
        ))
      )}
      {!current && !assigned && eligible.length > 0 && work.availabilityState === 'AVAILABLE' && (
        <Button
          title={t.takeNextCustomerAction}
          variant="outline"
          onPress={() => void run('take', () => apiFetch(ownerOpsPaths.queueTakeNext(salonId), { method: 'POST' }), t.nextCustomerAssignedNotice)}
          loading={busy === 'take'}
          style={styles.button}
        />
      )}

      <Text style={styles.heading}>{t.myAppointmentsHeading.replace('{count}', String(work.appointmentsToday.length))}</Text>
      {work.appointmentsToday.length === 0 ? (
        <Text style={styles.sub}>{t.noAppointmentsForMe}</Text>
      ) : (
        work.appointmentsToday.map((a) => (
          <Text key={a.bookingId} style={styles.row}>{`${formatShopTime(a.slotStart, null)} · ${a.customerLabel} · ${a.serviceNames.join(' + ')}${a.source === 'IN_SHOP' ? ' · In-shop' : ''}`}</Text>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink },
  heading: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: color.ink, marginTop: space[3], textTransform: 'uppercase', letterSpacing: 0.4 },
  sub: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted, marginTop: space[1] },
  strong: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  row: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink, marginTop: space[1] },
  block: { marginTop: space[1], padding: space[3], borderWidth: 1, borderColor: color.border, borderRadius: radius.sm },
  button: { marginTop: space[2] },
  badge: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: color.gold, marginTop: space[1] },
  notice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginTop: space[2] },
});
