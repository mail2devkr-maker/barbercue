import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Language, QUEUE_ENTRIES_PATH, SPEECH_LOCALE, voiceAnnouncementsFor, type QueueEntryDetailDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../lib/realtime';
import { color, font, fontSize, radius, space } from '../lib/theme';

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
  const { user } = useAuth();
  const [turnAlert, setTurnAlert] = useState(false);

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
    // The backend only emits this on a genuine turn-approaching crossing or a large wait swing
    // (see queue.service.ts's recomputeEtas) — every receipt is real news, no client dedup needed.
    function onWaitAlert(payload: { salonId: string; queueEntryId: string }) {
      if (payload.salonId !== salonId || payload.queueEntryId !== entry.id) return;
      setTurnAlert(true);
      Vibration.vibrate([0, 200, 100, 200]);
      const announcements = voiceAnnouncementsFor(user?.preferredLanguage);
      Speech.speak(
        entry.turnApproaching ? announcements.turnApproaching() : announcements.waitTimeChanged(),
        { language: SPEECH_LOCALE[user?.preferredLanguage ?? Language.EN] },
      );
      refetch();
    }

    socket.on('queue.updated', onQueueUpdated);
    socket.on('queue.entry.called', onEntryCalled);
    socket.on('queue.entry.wait_alert', onWaitAlert);
    // Phase 15 (Low-Network / Resilience Mode): resync once a dropped connection is restored — a
    // missed queue.entry.called while offline should never leave a customer's screen stale.
    const unsubscribeReconnect = onReconnect(refetch);
    return () => {
      cancelled = true;
      socket.off('queue.updated', onQueueUpdated);
      socket.off('queue.entry.called', onEntryCalled);
      socket.off('queue.entry.wait_alert', onWaitAlert);
      unsubscribeReconnect();
    };
  }, [entry.salonId, entry.status, entry.id, entry.turnApproaching, onEntryChange, user?.preferredLanguage]);

  return (
    <View style={styles.card}>
      {turnAlert && (
        <Pressable style={styles.turnAlertBanner} onPress={() => setTurnAlert(false)}>
          <Text style={styles.turnAlertText}>
            {entry.turnApproaching ? 'Your turn is almost here! Tap to dismiss.' : "Your wait time changed. Tap to dismiss."}
          </Text>
        </Pressable>
      )}
      <View style={styles.headerRow}>
        <Text style={styles.token}>Token #{entry.tokenNumber}</Text>
        <Text style={[styles.status, entry.status === 'CALLED' && styles.statusCalled]}>{statusLabel(entry)}</Text>
      </View>
      {entry.status === 'WAITING' && entry.estimatedWaitRangeMinutes && (
        <Text style={styles.detail}>
          Estimated wait: {entry.estimatedWaitRangeMinutes.min}–{entry.estimatedWaitRangeMinutes.max} min
        </Text>
      )}
      {entry.status === 'WAITING' && entry.turnApproaching && (
        <Text style={styles.detail}>Please head over now — you&apos;re almost up.</Text>
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
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space[5],
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  token: { fontFamily: font.displaySemiBold, color: color.ink, fontSize: fontSize.xl },
  status: { fontFamily: font.bodySemiBold, color: color.muted, fontSize: fontSize.sm },
  statusCalled: { color: color.accent },
  detail: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  turnAlertBanner: {
    backgroundColor: color.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.3)',
    borderRadius: radius.sm,
    padding: space[3],
    marginBottom: space[3],
  },
  turnAlertText: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: '#2e7d32' },
});
