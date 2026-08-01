import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QUEUE_ENTRIES_PATH, type QueueEntryDetailDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { getRealtimeSocket, joinSalonRoom } from '../lib/realtime';

const ACTIVE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

function statusLabel(entry: QueueEntryDetailDto): string {
  if (entry.status === 'CALLED') return "You're being called — please head to the counter!";
  if (entry.status === 'IN_SERVICE') return 'In service';
  if (entry.status === 'WAITING' && entry.position) return `Position ${entry.position} in line`;
  return entry.status;
}

/**
 * Live queue-token status for the current customer — used after both a walk-in join and an
 * appointment check-in. Fully controlled by the parent (`entry` is the current source of truth);
 * subscribes to `salon:{salonId}` for `queue.updated`/`queue.entry.called` and re-fetches
 * `GET queue-entries/mine/active` on either, matching API.md's ids-only realtime payload
 * convention, handing the result back via `onEntryChange` instead of holding its own copy —
 * same design as apps/web's QueueStatusPanel.
 */
export function QueueStatusPanel({
  entry,
  onEntryChange,
}: {
  entry: QueueEntryDetailDto;
  onEntryChange: (entry: QueueEntryDetailDto | null) => void;
}) {
  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) return undefined;
    const salonId = entry.salonId;
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    let cancelled = false;
    function refetch() {
      apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
        .then((next) => {
          if (!cancelled) onEntryChange(next);
        })
        .catch(() => {
          /* transient — the next event will retry */
        });
    }
    function onQueueUpdated(payload: { salonId: string }) {
      if (payload.salonId === salonId) refetch();
    }
    function onEntryCalled(payload: { salonId: string; queueEntryId: string }) {
      if (payload.salonId === salonId) refetch();
    }

    socket.on('queue.updated', onQueueUpdated);
    socket.on('queue.entry.called', onEntryCalled);
    return () => {
      cancelled = true;
      socket.off('queue.updated', onQueueUpdated);
      socket.off('queue.entry.called', onEntryCalled);
    };
  }, [entry.salonId, entry.status, onEntryChange]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.token}>Token #{entry.tokenNumber}</Text>
        <Text style={[styles.status, entry.status === 'CALLED' && styles.statusCalled]}>{statusLabel(entry)}</Text>
      </View>
      {entry.status === 'WAITING' && entry.estimatedWaitMinutes !== null && (
        <Text style={styles.detail}>Estimated wait: ~{entry.estimatedWaitMinutes} min</Text>
      )}
      {entry.status === 'IN_SERVICE' && (
        <Text style={styles.detail}>
          {entry.assignedStaffName ? `With ${entry.assignedStaffName}` : 'In service'}
          {entry.assignedChairLabel ? ` — ${entry.assignedChairLabel}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#2A2723', borderRadius: 12, padding: 16, marginTop: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  token: { color: '#EDE6DA', fontSize: 20, fontWeight: '700' },
  status: { color: '#B8AFA0', fontWeight: '600' },
  statusCalled: { color: '#E24B4A' },
  detail: { color: '#B8AFA0', fontSize: 13, marginTop: 8 },
});
