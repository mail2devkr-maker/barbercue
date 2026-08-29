import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, type ChairOptionDto, type DashboardQueueDto, type QueueEntryDetailDto, type StaffStatusDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Card, Button, EmptyState, Skeleton, InlineError } from '../ui';

function dashboardBase(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queue}`;
}

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Waiting',
  CALLED: 'Called',
  IN_SERVICE: 'In service',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CANCELLED: 'Cancelled',
};

function EntryRow({
  entry,
  chairs,
  activeStaff,
  onAction,
}: {
  entry: QueueEntryDetailDto;
  chairs: ChairOptionDto[];
  activeStaff: StaffStatusDto[];
  onAction: () => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [chairId, setChairId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<unknown>) {
    setSubmitting(label);
    setError(null);
    try {
      await action();
      setAssigning(false);
      onAction();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete that action.');
    } finally {
      setSubmitting(null);
    }
  }

  function call() {
    return run('call', () => apiFetch(`${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.call}`, { method: 'POST' }));
  }
  function noShow() {
    return run('no-show', () => apiFetch(`${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.noShow}`, { method: 'POST' }));
  }
  function cancel() {
    return run('cancel', () => apiFetch(`${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.cancel}`, { method: 'POST' }));
  }
  function confirmAssign() {
    if (!staffId || !chairId) return;
    return run('assign', () =>
      apiFetch(`${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.assign}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({ staffId, chairId, ...(entry.serviceId ? { serviceId: entry.serviceId } : {}) }),
      }),
    );
  }
  function complete() {
    if (!entry.activeServiceSessionId) return;
    return run('complete', () =>
      apiFetch(`${DASHBOARD_PATHS.serviceSessions}/${entry.activeServiceSessionId}/${DASHBOARD_PATHS.complete}`, { method: 'POST' }),
    );
  }

  return (
    <Card style={styles.entryCard}>
      <View style={styles.entryHeaderRow}>
        <Text style={styles.token}>#{entry.tokenNumber}</Text>
        <Text style={styles.statusBadge}>{STATUS_LABEL[entry.status] ?? entry.status}</Text>
      </View>
      {entry.serviceName && <Text style={styles.meta}>{entry.serviceName}</Text>}
      {entry.assignedStaffName && (
        <Text style={styles.meta}>
          {entry.assignedStaffName}
          {entry.assignedChairLabel ? ` — ${entry.assignedChairLabel}` : ''}
        </Text>
      )}
      {error && <InlineError message={error} />}

      {entry.status === 'WAITING' && (
        <View style={styles.actionRow}>
          <Button title="Call" onPress={() => void call()} loading={submitting === 'call'} style={styles.actionButton} />
          <Button title="Cancel" variant="outline" onPress={() => void cancel()} loading={submitting === 'cancel'} style={styles.actionButton} />
        </View>
      )}

      {entry.status === 'CALLED' && !assigning && (
        <View style={styles.actionRow}>
          <Button title="Assign" onPress={() => setAssigning(true)} style={styles.actionButton} />
          <Button title="No-show" variant="outline" onPress={() => void noShow()} loading={submitting === 'no-show'} style={styles.actionButton} />
        </View>
      )}

      {entry.status === 'CALLED' && assigning && (
        <View style={styles.assignPanel}>
          <Text style={styles.assignLabel}>Barber</Text>
          <View style={styles.chipRow}>
            {activeStaff.map((s) => (
              <Pressable key={s.id} style={[styles.chip, staffId === s.id && styles.chipActive]} onPress={() => setStaffId(s.id)}>
                <Text style={[styles.chipText, staffId === s.id && styles.chipTextActive]}>{s.displayName}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.assignLabel}>Chair</Text>
          <View style={styles.chipRow}>
            {chairs.map((c) => (
              <Pressable key={c.id} style={[styles.chip, chairId === c.id && styles.chipActive]} onPress={() => setChairId(c.id)}>
                <Text style={[styles.chipText, chairId === c.id && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Button
              title="Confirm assignment"
              onPress={() => void confirmAssign()}
              loading={submitting === 'assign'}
              disabled={!staffId || !chairId}
              style={styles.actionButton}
            />
            <Button title="Cancel" variant="outline" onPress={() => setAssigning(false)} style={styles.actionButton} />
          </View>
        </View>
      )}

      {entry.status === 'IN_SERVICE' && (
        <Button title="Complete" onPress={() => void complete()} loading={submitting === 'complete'} style={styles.fullButton} />
      )}
    </Card>
  );
}

/**
 * The live-queue list + operational actions (call/assign/no-show/complete), shared by Owner's
 * Queue tab and Staff's Today tab — the backend permits both roles identically
 * (@Roles(SALON_STAFF, SALON_OWNER) on DashboardQueueController), so there is no authorization
 * reason to give them different queue UIs. What differs between the two roles is which *other*
 * tabs exist around this one (Owner also gets Dashboard/Shop; Staff does not) — enforced by each
 * navigator's own tab set, not by anything in this component.
 */
export function LiveQueuePanel({ salonId }: { salonId: string }) {
  const [data, setData] = useState<DashboardQueueDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return apiFetch<DashboardQueueDto>(dashboardBase(salonId))
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load the queue.'))
      .finally(() => setLoading(false));
  }, [salonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onUpdate(payload: { salonId: string }) {
      if (payload.salonId === salonId) void load();
    }
    socket.on('queue.updated', onUpdate);
    socket.on('queue.entry.called', onUpdate);
    const unsubscribeReconnect = onReconnect(() => void load()); // Phase 15: resync after reconnect
    return () => {
      socket.off('queue.updated', onUpdate);
      socket.off('queue.entry.called', onUpdate);
      unsubscribeReconnect();
    };
  }, [salonId, load]);

  if (loading) {
    return (
      <>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </>
    );
  }
  if (error || !data) {
    return <InlineError message={error ?? 'Could not load the queue.'} />;
  }

  const activeStaff = data.staffRoster.filter((s) => s.status === 'ACTIVE');
  const activeEntries = data.entries.filter((e) => e.status !== 'COMPLETED' && e.status !== 'CANCELLED' && e.status !== 'NO_SHOW');

  if (activeEntries.length === 0) {
    return <EmptyState title="Queue is empty" message="Walk-ins and checked-in bookings will appear here in real time." />;
  }

  return (
    <>
      {activeEntries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} chairs={data.chairs} activeStaff={activeStaff} onAction={() => void load()} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
  entryCard: { marginBottom: space[3] },
  entryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  token: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  statusBadge: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 0.5, color: color.gold, textTransform: 'uppercase' },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: space[1] },
  actionRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  actionButton: { flex: 1 },
  fullButton: { marginTop: space[3] },
  assignPanel: { marginTop: space[3] },
  assignLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, marginBottom: space[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  chip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  chipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  chipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  chipTextActive: { color: color.accent },
});
