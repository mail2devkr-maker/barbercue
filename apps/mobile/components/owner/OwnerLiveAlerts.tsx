import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DASHBOARD_PATHS, Language, formatVoiceDateTime, type OwnerBookingDetailDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { claimBookingVoiceEvent } from '../../lib/booking-voice-dedupe';
import { useLanguage } from '../../lib/language-context';
import { getRealtimeSocket, joinSalonRoom } from '../../lib/realtime';
import { useSalon } from '../../lib/salon-context';
import { speakBooking } from '../../lib/voice-announce';
import { navigationRef } from '../../navigation/navigation-ref';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';

/** Realtime payload for a new Live Queue join (backend `queue.entry.joined`). Ids + token only. */
export interface QueueJoinedPayload {
  salonId: string;
  queueEntryId: string;
  tokenNumber?: number | null;
  serviceName?: string | null;
}

type Banner = { kind: 'booking' | 'queue'; text: string; key: string };

const BANNER_MS = 7000;

function currentRouteName(): string | undefined {
  try {
    return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Owner-reported (13 Nov): booking and Live Queue join alerts only fired while the owner was on
 * the Bookings or Live Queue screen. This is mounted once for the whole owner app, so a new
 * booking or a new customer joining the queue is announced (voice + an in-app banner) on EVERY
 * owner screen. Each event is claimed through the shared dedupe, so the Bookings screen, the
 * foreground push fallback and this component never speak the same event twice. When the app is
 * in the background or closed, the OS push sent by the backend carries the alert instead.
 */
export function OwnerLiveAlerts() {
  const { selectedSalonId } = useSalon();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const languageRef = useRef<Language>(language);
  languageRef.current = language;
  const [banner, setBanner] = useState<Banner | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (next: Banner) => {
    setBanner(next);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBanner(null), BANNER_MS);
  };

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  useEffect(() => {
    if (!selectedSalonId) return undefined;
    const salonId = selectedSalonId;
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const hindi = () => languageRef.current === Language.HI;

    function onBookingCreated(payload: { salonId?: string; bookingId?: string }) {
      if (payload?.salonId !== salonId || !payload.bookingId) return;
      const bookingId = payload.bookingId;
      const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/${bookingId}`;
      apiFetch<OwnerBookingDetailDto>(path)
        .then((detail) => {
          // The Bookings screen shows its own toast; elsewhere this banner is the visible alert.
          if (currentRouteName() !== 'OwnerBookingsTab') {
            const what = detail.serviceName ? ` · ${detail.serviceName}` : '';
            show({ kind: 'booking', key: `b:${bookingId}`, text: hindi() ? `नई बुकिंग आई${what}` : `New booking${what}` });
          }
          if (!claimBookingVoiceEvent('booking.created', bookingId)) return;
          const { date, time } = detail.slotStart && detail.salonTimezone
            ? formatVoiceDateTime(detail.slotStart, detail.salonTimezone)
            : { date: null, time: null };
          speakBooking({
            event: 'booking.created',
            bookingId,
            language: languageRef.current,
            serviceName: detail.serviceName ?? null,
            barberName: detail.assignedStaffName ?? detail.preferredStaffName ?? null,
            salonName: detail.salonName ?? null,
            date,
            time,
          });
        })
        .catch(() => {
          if (currentRouteName() !== 'OwnerBookingsTab') {
            show({ kind: 'booking', key: `b:${bookingId}`, text: hindi() ? 'नई बुकिंग आई' : 'New booking' });
          }
        });
    }

    function onQueueJoined(payload: QueueJoinedPayload) {
      if (payload?.salonId !== salonId || !payload.queueEntryId) return;
      const token = typeof payload.tokenNumber === 'number' ? payload.tokenNumber : null;
      const service = payload.serviceName ?? null;
      const tokenText = token !== null ? ` #${token}` : '';
      const serviceText = service ? ` · ${service}` : '';
      show({
        kind: 'queue',
        key: `q:${payload.queueEntryId}`,
        text: hindi() ? `Live Queue में नया ग्राहक${tokenText}${serviceText}` : `New customer in Live Queue${tokenText}${serviceText}`,
      });
      if (token === null || !claimBookingVoiceEvent('queue.joined', payload.queueEntryId)) return;
      speakBooking({ event: 'queue.joined', bookingId: payload.queueEntryId, language: languageRef.current, tokenNumber: token, serviceName: service });
    }

    socket.on('booking.created', onBookingCreated);
    socket.on('queue.entry.joined', onQueueJoined);
    return () => {
      socket.off('booking.created', onBookingCreated);
      socket.off('queue.entry.joined', onQueueJoined);
    };
  }, [selectedSalonId]);

  if (!banner) return null;
  const open = () => {
    setBanner(null);
    if (!navigationRef.isReady()) return;
    if (banner.kind === 'queue') navigationRef.navigate('OwnerQueueTab' as never);
    else navigationRef.navigate('OwnerBookingsTab' as never);
  };
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + space[2] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={banner.text}
        onPress={open}
        style={styles.banner}
        testID="owner-live-alert"
      >
        <Text style={styles.icon}>{banner.kind === 'queue' ? '👥' : '📅'}</Text>
        <Text style={styles.text} numberOfLines={2}>{banner.text}</Text>
        <Text style={styles.open}>{languageRef.current === Language.HI ? 'देखें' : 'Open'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: space[3], right: space[3], zIndex: 50, elevation: 50 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    backgroundColor: fastQue.glassStrong,
    borderWidth: 1,
    borderColor: fastQue.pink,
  },
  icon: { fontSize: fontSize.lg },
  text: { flex: 1, color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  open: { color: fastQue.pink, fontFamily: font.bodyBold, fontSize: fontSize.sm },
});
