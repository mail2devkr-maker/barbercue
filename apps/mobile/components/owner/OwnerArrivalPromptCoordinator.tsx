import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DASHBOARD_PATHS,
  Language,
  type ArrivalAlertDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { newIdempotencyKey } from '../../lib/idempotency';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import {
  subscribeToOwnerArrivalPrompt,
  type OwnerArrivalPromptInitialAction,
  type OwnerArrivalPromptRequest,
} from '../../lib/arrival-prompt';
import { navigationRef } from '../../navigation/navigation-ref';
import { Button } from '../ui';
import { color, font, fontSize, radius, space } from '../../lib/theme';

const SAFETY_REFRESH_MS = 30_000;
const SNOOZE_MS = 2 * 60_000;

type ConfirmStep = null | 'arrived' | 'not-arrived-early' | 'not-arrived-late';

function alertsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.arrivalAlerts}`;
}
function arrivePath(bookingId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.bookings}/${bookingId}/${DASHBOARD_PATHS.arrive}`;
}
function noShowPath(bookingId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.bookings}/${bookingId}/${DASHBOARD_PATHS.noShow}`;
}

function formatTime(iso: string, language: Language): string {
  return new Date(iso).toLocaleTimeString(language === Language.HI ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function copyFor(language: Language) {
  if (language === Language.HI) {
    return {
      eyebrow: 'अपॉइंटमेंट आगमन जांच',
      title: 'क्या ग्राहक आ गया है?',
      arrived: 'आ गए',
      notArrived: 'अभी नहीं आए',
      snooze: '2 मिनट बाद याद दिलाएं',
      confirmArrivalTitle: 'ग्राहक के आने की पुष्टि करें?',
      confirmArrivalBody: 'इससे ग्राहक चेक-इन होकर लाइव कतार में WAITING स्थिति में जुड़ जाएगा।',
      confirmArrival: 'हाँ, आ गए',
      back: 'वापस',
      notHereTitle: 'ग्राहक अभी नहीं आया?',
      notHereBody: 'बुकिंग सक्रिय रहेगी। FastQue 2 मिनट बाद फिर याद दिलाएगा। कोई नो-शो शुल्क नहीं लगेगा।',
      confirmNotHere: 'पुष्टि करें — अभी नहीं आए',
      noShowTitle: 'ग्राहक को No Show चिह्नित करें?',
      noShowBody: 'यह अंतिम बुकिंग स्थिति है और दुकान की नीति के अनुसार शुल्क बन सकता है।',
      confirmNoShow: 'No Show की पुष्टि करें',
      cancel: 'रद्द करें',
      chargePrefix: 'संभावित नो-शो शुल्क:',
      noCharge: 'इस समय कोई नो-शो शुल्क नहीं है।',
      error: 'कार्रवाई पूरी नहीं हो सकी। कृपया फिर कोशिश करें।',
    };
  }
  return {
    eyebrow: 'Appointment arrival check',
    title: 'Has the customer arrived?',
    arrived: 'Arrived',
    notArrived: 'Not arrived',
    snooze: 'Remind me in 2 minutes',
    confirmArrivalTitle: 'Confirm customer arrival?',
    confirmArrivalBody: 'This will check the customer in and add the appointment to the live queue as WAITING.',
    confirmArrival: 'Confirm Arrived',
    back: 'Go back',
    notHereTitle: 'Customer not here yet?',
    notHereBody: 'The booking stays active. FastQue will remind you again in 2 minutes. No no-show charge is created.',
    confirmNotHere: 'Confirm Not Arrived Yet',
    noShowTitle: 'Mark customer as No Show?',
    noShowBody: 'This is a final booking status and may create a charge according to this shop\'s policy.',
    confirmNoShow: 'Confirm No Show',
    cancel: 'Cancel',
    chargePrefix: 'Possible no-show charge:',
    noCharge: 'There is no no-show charge at this time.',
    error: 'Could not complete that action. Please try again.',
  };
}

/**
 * Native owner-side counterpart of the web ArrivalAlertOverlay.
 *
 * - Reconstructs eligibility from backend truth, so a missed push/realtime event is recoverable.
 * - A foreground T-5 event opens this full-screen prompt immediately.
 * - OS push taps / Arrived / Not arrived notification actions replay into this component.
 * - Arrived and No Show remain two-step actions; notification buttons never mutate business state.
 */
export function OwnerArrivalPromptCoordinator() {
  const { language } = useLanguage();
  const { selectedSalonId, workplaces, selectSalon } = useSalon();
  const [active, setActive] = useState<ArrivalAlertDto | null>(null);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snoozedUntilRef = useRef<Map<string, number>>(new Map());
  const snoozeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const copy = copyFor(language);

  const chooseAlert = useCallback((
    alerts: ArrivalAlertDto[],
    preferredBookingId?: string,
    initialAction?: OwnerArrivalPromptInitialAction,
  ) => {
    const now = Date.now();
    const eligible = alerts.filter((item) => (snoozedUntilRef.current.get(item.bookingId) ?? 0) <= now);
    const next =
      (preferredBookingId ? eligible.find((item) => item.bookingId === preferredBookingId) : undefined) ??
      eligible[0] ??
      null;
    setActive(next);
    setError(null);
    if (!next) {
      setConfirmStep(null);
      return;
    }
    if (initialAction === 'arrived') setConfirmStep('arrived');
    else if (initialAction === 'not-arrived') {
      setConfirmStep(next.graceExpired ? 'not-arrived-late' : 'not-arrived-early');
    } else setConfirmStep(null);
  }, []);

  const refreshSalon = useCallback(
    (salonId: string, request?: OwnerArrivalPromptRequest) =>
      apiFetch<ArrivalAlertDto[]>(alertsPath(salonId))
        .then((alerts) => {
          chooseAlert(alerts, request?.bookingId, request?.initialAction ?? null);
          return true;
        })
        .catch(() => false),
    [chooseAlert],
  );

  useEffect(() => {
    const unsubscribe = subscribeToOwnerArrivalPrompt((request) => {
      if (workplaces.length === 0) return false;
      if (!workplaces.some((workplace) => workplace.id === request.salonId)) return true;
      selectSalon(request.salonId);
      void refreshSalon(request.salonId, request);
      return true;
    });
    return unsubscribe;
  }, [workplaces, selectSalon, refreshSalon]);

  useEffect(() => {
    if (!selectedSalonId) return undefined;

    void refreshSalon(selectedSalonId);
    const socket = getRealtimeSocket();
    joinSalonRoom(selectedSalonId);
    const onSalonEvent = (payload: { salonId: string }) => {
      if (payload.salonId === selectedSalonId) void refreshSalon(selectedSalonId);
    };
    socket.on('booking.arrival_alert', onSalonEvent);
    socket.on('queue.updated', onSalonEvent);
    socket.on('booking.no_show', onSalonEvent);
    socket.on('booking.cancelled', onSalonEvent);
    socket.on('booking.corrected', onSalonEvent);
    const unsubscribeReconnect = onReconnect(() => void refreshSalon(selectedSalonId));
    const safety = setInterval(() => void refreshSalon(selectedSalonId), SAFETY_REFRESH_MS);

    return () => {
      socket.off('booking.arrival_alert', onSalonEvent);
      socket.off('queue.updated', onSalonEvent);
      socket.off('booking.no_show', onSalonEvent);
      socket.off('booking.cancelled', onSalonEvent);
      socket.off('booking.corrected', onSalonEvent);
      unsubscribeReconnect();
      clearInterval(safety);
    };
  }, [selectedSalonId, refreshSalon]);

  useEffect(
    () => () => {
      snoozeTimersRef.current.forEach((timer) => clearTimeout(timer));
      snoozeTimersRef.current.clear();
    },
    [],
  );

  function snoozeCurrent(): void {
    if (!active) return;
    const { bookingId, salonId } = active;
    const until = Date.now() + SNOOZE_MS;
    snoozedUntilRef.current.set(bookingId, until);
    const existing = snoozeTimersRef.current.get(bookingId);
    if (existing) clearTimeout(existing);
    snoozeTimersRef.current.set(
      bookingId,
      setTimeout(() => {
        snoozedUntilRef.current.delete(bookingId);
        snoozeTimersRef.current.delete(bookingId);
        void refreshSalon(salonId);
      }, SNOOZE_MS),
    );
    setActive(null);
    setConfirmStep(null);
    setError(null);
  }

  async function confirmArrived(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(arrivePath(active.bookingId), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      const salonId = active.salonId;
      setActive(null);
      setConfirmStep(null);
      if (navigationRef.isReady()) navigationRef.navigate('OwnerQueueTab');
      void refreshSalon(salonId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.error);
    } finally {
      setBusy(false);
    }
  }

  async function confirmNoShow(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(noShowPath(active.bookingId), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      const salonId = active.salonId;
      setActive(null);
      setConfirmStep(null);
      if (navigationRef.isReady()) navigationRef.navigate('OwnerBookingsTab');
      void refreshSalon(salonId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : copy.error);
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  const time = formatTime(active.slotStart, language);
  const currency = active.currency === 'INR' ? '₹' : active.currency ?? '';
  const charge =
    active.noShowChargePreview !== null && active.noShowChargePreview > 0
      ? `${currency}${active.noShowChargePreview}`
      : null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={snoozeCurrent}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {confirmStep === null && (
            <>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.time}>{time}</Text>
              <Text style={styles.service}>{active.serviceName}</Text>
              <Text style={styles.question}>{copy.title}</Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Button title={copy.arrived} onPress={() => setConfirmStep('arrived')} disabled={busy} />
                <Button
                  title={copy.notArrived}
                  variant="outline"
                  onPress={() => setConfirmStep(active.graceExpired ? 'not-arrived-late' : 'not-arrived-early')}
                  disabled={busy}
                />
              </View>
              <Button title={copy.snooze} variant="outline" onPress={snoozeCurrent} disabled={busy} />
            </>
          )}

          {confirmStep === 'arrived' && (
            <>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.confirmTitle}>{copy.confirmArrivalTitle}</Text>
              <Text style={styles.body}>{copy.confirmArrivalBody}</Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Button title={copy.confirmArrival} onPress={() => void confirmArrived()} loading={busy} />
                <Button title={copy.back} variant="outline" onPress={() => setConfirmStep(null)} disabled={busy} />
              </View>
            </>
          )}

          {confirmStep === 'not-arrived-early' && (
            <>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.confirmTitle}>{copy.notHereTitle}</Text>
              <Text style={styles.body}>{copy.notHereBody}</Text>
              <View style={styles.actions}>
                <Button title={copy.confirmNotHere} onPress={snoozeCurrent} />
                <Button title={copy.back} variant="outline" onPress={() => setConfirmStep(null)} />
              </View>
            </>
          )}

          {confirmStep === 'not-arrived-late' && (
            <>
              <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
              <Text style={styles.confirmTitle}>{copy.noShowTitle}</Text>
              <Text style={styles.body}>{copy.noShowBody}</Text>
              <Text style={styles.charge}>{charge ? `${copy.chargePrefix} ${charge}` : copy.noCharge}</Text>
              {error && <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Button title={copy.confirmNoShow} onPress={() => void confirmNoShow()} loading={busy} />
                <Button title={copy.cancel} variant="outline" onPress={() => setConfirmStep(null)} disabled={busy} />
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: color.surface },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space[5],
    paddingVertical: space[6],
    gap: space[3],
    backgroundColor: color.surface,
  },
  eyebrow: {
    fontFamily: font.bodyBold,
    fontSize: fontSize.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: color.accent,
  },
  time: { fontFamily: font.displaySemiBold, fontSize: 42, color: color.ink },
  service: { fontFamily: font.bodySemiBold, fontSize: fontSize.lg, color: color.muted },
  question: { fontFamily: font.displaySemiBold, fontSize: 30, color: color.ink, marginVertical: space[3] },
  confirmTitle: { fontFamily: font.displaySemiBold, fontSize: 30, color: color.ink },
  body: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: color.muted, lineHeight: 24 },
  charge: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.base,
    color: color.ink,
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: color.accentSoft,
  },
  actions: { gap: space[3], marginTop: space[3] },
  error: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: '#b42318' },
});
