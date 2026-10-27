import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import * as Speech from 'expo-speech';
import { Language, QUEUE_ENTRIES_PATH, SPEECH_LOCALE, voiceAnnouncementsFor, type QueueEntryDetailDto, type UiStrings } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../lib/realtime';
import { fastQue, font, fontSize, premiumShadow, radius, space } from '../lib/theme';

const ACTIVE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

function statusLabel(t: UiStrings, entry: QueueEntryDetailDto): string {
  if (entry.status === 'CALLED') return t.calledMessage;
  if (entry.status === 'IN_SERVICE') return t.inService;
  if (entry.status === 'WAITING' && entry.position) return `${t.positionPrefix}${entry.position}${t.positionSuffix}`;
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
  guestAccessToken,
}: {
  entry: QueueEntryDetailDto;
  onEntryChange: (entry: QueueEntryDetailDto | null) => void;
  guestAccessToken?: string | null;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [turnAlert, setTurnAlert] = useState(false);
  const [shopPhone, setShopPhone] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const guestHeaders = guestAccessToken ? { 'X-Queue-Guest-Token': guestAccessToken } : undefined;
  const guestMode = Boolean(guestAccessToken);
  const statusPath = guestMode
    ? `${QUEUE_ENTRIES_PATH}/${entry.id}/guest-status`
    : `${QUEUE_ENTRIES_PATH}/mine/active`;
  const arrivalOpen = Boolean(
    entry.arrivalPromptSentAt && !entry.arrivedAt &&
    entry.customerArrivalResponse == null && entry.status === 'WAITING'
  );
  async function replyArrival(arrived: boolean) {
    if (responding) return;
    setResponding(true); setArrivalError(null);
    try {
      const next = await apiFetch<QueueEntryDetailDto>(
        `${QUEUE_ENTRIES_PATH}/${entry.id}/${guestMode ? 'guest-arrival-response' : 'arrival-response'}`,
        { method: 'POST', headers: guestHeaders, body: JSON.stringify({ arrived }) },
      );
      onEntryChange(next);
    } catch (err) {
      setArrivalError(err instanceof ApiError ? err.message : 'Could not send your arrival response.');
    } finally {
      setResponding(false);
    }
  }
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canCancel = entry.bookingId === null && (entry.status === 'WAITING' || entry.status === 'CALLED');

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) {
      setShopPhone(null);
      return;
    }
    let cancelled = false;
    apiFetch<{ shopPhone: string | null }>(
      `${QUEUE_ENTRIES_PATH}/${entry.id}/${guestMode ? 'guest-shop-contact' : 'shop-contact'}`,
      { headers: guestHeaders },
    )
      .then((result) => { if (!cancelled) setShopPhone(result.shopPhone); })
      .catch(() => { if (!cancelled) setShopPhone(null); });
    return () => { cancelled = true; };
  }, [entry.id, entry.status, guestAccessToken]);

  async function cancelQueue(): Promise<void> {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiFetch(`${QUEUE_ENTRIES_PATH}/${entry.id}/${guestMode ? 'guest-cancel' : 'cancel'}`, {
        method: 'POST', headers: guestHeaders,
      });
      onEntryChange(null);
    } catch (error) {
      setCancelError(error instanceof ApiError ? error.message : t.couldNotCancelLiveQueue);
      // Shop action may have started the service concurrently: refresh instead of hiding it.
      void apiFetch<QueueEntryDetailDto | null>(statusPath, { headers: guestHeaders })
        .then(onEntryChange)
        .catch(() => undefined);
    } finally {
      setCancelling(false);
    }
  }

  function confirmCancel(): void {
    if (!canCancel || cancelling) return;
    Alert.alert(
      t.cancelLiveQueueConfirmTitle,
      t.cancelLiveQueueConfirmMessage,
      [
        { text: t.keepMyPlaceAction, style: 'cancel' },
        { text: t.confirmCancelLiveQueueAction, style: 'destructive', onPress: () => void cancelQueue() },
      ],
    );
  }

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(entry.status)) return undefined;
    const salonId = entry.salonId;
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);

    let cancelled = false;
    function refetch() {
      apiFetch<QueueEntryDetailDto | null>(statusPath, { headers: guestHeaders })
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
    const guestPoll = guestAccessToken ? setInterval(refetch, 15_000) : null;
    return () => {
      cancelled = true;
      socket.off('queue.updated', onQueueUpdated);
      socket.off('queue.entry.called', onEntryCalled);
      socket.off('queue.entry.wait_alert', onWaitAlert);
      unsubscribeReconnect();
      if (guestPoll) clearInterval(guestPoll);
    };
  }, [entry.salonId, entry.status, entry.id, entry.turnApproaching, onEntryChange, user?.preferredLanguage, guestAccessToken]);

  return (
    <View style={styles.card}>
      <Modal visible={arrivalOpen} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.92)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 26, width: '100%' }}>
            <Text style={{ fontSize: 23, fontWeight: 'bold', color: '#111' }}>Have you arrived at the shop?</Text>
            <Text style={{ marginTop: 12, marginBottom: 18, color: '#222' }}>Your estimated service time is around 10 minutes away.</Text>
            <Pressable accessibilityRole="button" disabled={responding}
              onPress={() => void replyArrival(true)} style={styles.cancelQueueButton}>
              <Text style={styles.cancelQueueText}>Yes, I am here</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={responding}
              onPress={() => void replyArrival(false)} style={styles.cancelQueueButton}>
              <Text style={styles.cancelQueueText}>Not yet</Text>
            </Pressable>
            {arrivalError && <Text accessibilityRole="alert" style={styles.cancelError}>{arrivalError}</Text>}
          </View>
        </View>
      </Modal>
      {turnAlert && (
        <Pressable style={styles.turnAlertBanner} onPress={() => setTurnAlert(false)}>
          <Text style={styles.turnAlertText}>
            {entry.turnApproaching ? t.turnAlmostHereToast : t.waitChangedToast}
          </Text>
        </Pressable>
      )}
      <View style={styles.headerRow}>
        <Text style={styles.token}>{t.tokenNumberLabel}{entry.tokenNumber}</Text>
        <Text style={[styles.status, entry.status === 'CALLED' && styles.statusCalled]}>{statusLabel(t, entry)}</Text>
      </View>
      {entry.status === 'WAITING' && entry.estimatedWaitRangeMinutes && (
        <Text style={styles.detail}>
          {t.estimatedWaitLabel}{entry.estimatedWaitRangeMinutes.min}–{entry.estimatedWaitRangeMinutes.max} {t.minutesAbbrev}
        </Text>
      )}
      {entry.status === 'WAITING' && entry.turnApproaching && (
        <Text style={styles.detail}>{t.headOverNowMessage}</Text>
      )}
      {entry.status === 'IN_SERVICE' && (
        <Text style={styles.detail}>
          {entry.assignedStaffName ? `${t.withBarberPrefix}${entry.assignedStaffName}` : t.inService}
          {entry.assignedChairLabel ? ` — ${entry.assignedChairLabel}` : ''}
        </Text>
      )}
      {shopPhone && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Call shop about your Live Queue"
          onPress={() => void Linking.openURL(`tel:${shopPhone}`).catch(() =>
            Alert.alert('Unable to place call', 'Use your phone dialer to contact the shop.'),
          )}
          style={styles.cancelQueueButton}
        >
          <Text style={styles.cancelQueueText}>Call shop: {shopPhone}</Text>
        </Pressable>
      )}
      {canCancel && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.cancelLiveQueueA11yLabel}
          disabled={cancelling}
          onPress={confirmCancel}
          style={[styles.cancelQueueButton, cancelling && styles.cancelDisabled]}
        >
          <Text style={styles.cancelQueueText}>{cancelling ? t.cancellingLiveQueueLabel : t.cancelLiveQueueAction}</Text>
        </Pressable>
      )}
      {cancelError && <Text accessibilityRole="alert" style={styles.cancelError}>{cancelError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: fastQue.cardStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: fastQue.borderStrong,
    padding: space[5],
    ...premiumShadow,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  token: { fontFamily: font.displaySemiBold, color: fastQue.text, fontSize: fontSize.xl },
  status: { fontFamily: font.bodySemiBold, color: fastQue.textSecondary, fontSize: fontSize.sm },
  statusCalled: { color: fastQue.pink },
  detail: { fontFamily: font.bodyRegular, color: fastQue.textSecondary, fontSize: fontSize.xs, marginTop: space[2] },
  turnAlertBanner: {
    backgroundColor: 'rgba(114,213,154,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(46, 125, 50, 0.3)',
    borderRadius: radius.sm,
    padding: space[3],
    marginBottom: space[3],
  },
  turnAlertText: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: fastQue.success },
  cancelQueueButton: {
    borderWidth: 1,
    borderColor: fastQue.pink,
    borderRadius: radius.sm,
    minHeight: 44,
    padding: space[3],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[4],
  },
  cancelQueueText: {
    color: fastQue.pink,
    fontFamily: font.bodyBold,
    fontSize: fontSize.sm,
  },
  cancelDisabled: { opacity: 0.5 },
  cancelError: { color: fastQue.pink, fontFamily: font.bodyMedium, fontSize: fontSize.xs, marginTop: space[2] },
});
