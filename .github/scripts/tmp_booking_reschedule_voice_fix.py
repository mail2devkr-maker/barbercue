from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:80]!r}')
    p.write_text(text.replace(old, new, 1))


# Shared spoken copy + push copy for reschedules.
path = 'packages/shared/src/i18n/index.ts'
replace_once(path,
    "  /** Owner/staff: a booking on this salon was just cancelled. */\n  bookingCancelled(): string;\n",
    "  /** Owner/staff: a booking on this salon was moved to a new slot. */\n  bookingRescheduled(date: string | null, time: string | null): string;\n  /** Owner/staff: a booking on this salon was just cancelled. */\n  bookingCancelled(): string;\n")
replace_once(path,
    "  bookingCancelled: () => 'Booking cancelled.',\n",
    "  bookingRescheduled: (date, time) => {\n    const when = [date ? `to ${date}` : null, time ? `at ${time}` : null].filter(Boolean).join(' ');\n    return when ? `Booking rescheduled ${when}.` : 'Booking rescheduled.';\n  },\n  bookingCancelled: () => 'Booking cancelled.',\n")
replace_once(path,
    "  bookingCancelled: () => 'बुकिंग रद्द कर दी गई है।',\n",
    "  bookingRescheduled: (date, time) => {\n    const when = [date ? `${date} को` : null, time ? `${time} बजे` : null].filter(Boolean).join(' ');\n    return when ? `बुकिंग पुनर्निर्धारित की गई है। नया समय ${when}।` : 'बुकिंग पुनर्निर्धारित की गई है।';\n  },\n  bookingCancelled: () => 'बुकिंग रद्द कर दी गई है।',\n")
replace_once(path,
    "export interface PushCopy {\n  newBooking(serviceName: string | null): { title: string; body: string };\n  bookingCancelled(serviceName: string | null): { title: string; body: string };\n}\n",
    "export interface PushCopy {\n  newBooking(serviceName: string | null): { title: string; body: string };\n  bookingRescheduled(serviceName: string | null): { title: string; body: string };\n  bookingCancelled(serviceName: string | null): { title: string; body: string };\n}\n")
replace_once(path,
    "  bookingCancelled: (serviceName) => ({\n    title: 'Booking cancelled',\n    body: serviceName ? `${serviceName} booking was cancelled.` : 'A booking at your shop was cancelled.',\n  }),\n};\n",
    "  bookingRescheduled: (serviceName) => ({\n    title: 'Booking rescheduled',\n    body: serviceName ? `${serviceName} booking was rescheduled.` : 'A booking at your shop was rescheduled.',\n  }),\n  bookingCancelled: (serviceName) => ({\n    title: 'Booking cancelled',\n    body: serviceName ? `${serviceName} booking was cancelled.` : 'A booking at your shop was cancelled.',\n  }),\n};\n")
replace_once(path,
    "  bookingCancelled: (serviceName) => ({\n    title: 'बुकिंग रद्द हुई',\n    body: serviceName ? `${serviceName} बुकिंग रद्द कर दी गई।` : 'आपकी दुकान की एक बुकिंग रद्द कर दी गई।',\n  }),\n};\n",
    "  bookingRescheduled: (serviceName) => ({\n    title: 'बुकिंग पुनर्निर्धारित हुई',\n    body: serviceName ? `${serviceName} बुकिंग का समय बदल दिया गया।` : 'आपकी दुकान की एक बुकिंग का समय बदल दिया गया।',\n  }),\n  bookingCancelled: (serviceName) => ({\n    title: 'बुकिंग रद्द हुई',\n    body: serviceName ? `${serviceName} बुकिंग रद्द कर दी गई।` : 'आपकी दुकान की एक बुकिंग रद्द कर दी गई।',\n  }),\n};\n")

# Generic/mobile speech helper supports booking.rescheduled.
path = 'apps/mobile/lib/voice-announce.ts'
replace_once(path,
    "export function speakBooking(params: {\n  event: 'booking.cancelled';\n  bookingId: string;\n  language: Language;\n  onHindiVoiceMissing?: () => void;\n}): void;\n",
    "export function speakBooking(params: {\n  event: 'booking.rescheduled';\n  bookingId: string;\n  language: Language;\n  date: string | null;\n  time: string | null;\n  onHindiVoiceMissing?: () => void;\n}): void;\nexport function speakBooking(params: {\n  event: 'booking.cancelled';\n  bookingId: string;\n  language: Language;\n  onHindiVoiceMissing?: () => void;\n}): void;\n")
replace_once(path,
    "    | { event: 'booking.cancelled'; bookingId: string; language: Language; onHindiVoiceMissing?: () => void },\n",
    "    | { event: 'booking.rescheduled'; bookingId: string; language: Language; date: string | null; time: string | null; onHindiVoiceMissing?: () => void }\n    | { event: 'booking.cancelled'; bookingId: string; language: Language; onHindiVoiceMissing?: () => void },\n")
replace_once(path,
    "  const text =\n    event === 'booking.created'\n      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)\n      : t.bookingCancelled();\n",
    "  const text =\n    event === 'booking.created'\n      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)\n      : event === 'booking.rescheduled'\n        ? t.bookingRescheduled(params.date, params.time)\n        : t.bookingCancelled();\n")

# Android SDK-57 speech helper supports the same lifecycle event.
path = 'apps/mobile/lib/voice-announce.android.ts'
replace_once(path,
    "export function speakBooking(params: {\n  event: 'booking.cancelled';\n  bookingId: string;\n  language: Language;\n  onHindiVoiceMissing?: () => void;\n}): void;\n",
    "export function speakBooking(params: {\n  event: 'booking.rescheduled';\n  bookingId: string;\n  language: Language;\n  date: string | null;\n  time: string | null;\n  onHindiVoiceMissing?: () => void;\n}): void;\nexport function speakBooking(params: {\n  event: 'booking.cancelled';\n  bookingId: string;\n  language: Language;\n  onHindiVoiceMissing?: () => void;\n}): void;\n")
replace_once(path,
    "    | {\n        event: 'booking.cancelled';\n        bookingId: string;\n        language: Language;\n        onHindiVoiceMissing?: () => void;\n      },\n",
    "    | {\n        event: 'booking.rescheduled';\n        bookingId: string;\n        language: Language;\n        date: string | null;\n        time: string | null;\n        onHindiVoiceMissing?: () => void;\n      }\n    | {\n        event: 'booking.cancelled';\n        bookingId: string;\n        language: Language;\n        onHindiVoiceMissing?: () => void;\n      },\n")
replace_once(path,
    "  const text =\n    params.event === 'booking.created'\n      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)\n      : t.bookingCancelled();\n",
    "  const text =\n    params.event === 'booking.created'\n      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)\n      : params.event === 'booking.rescheduled'\n        ? t.bookingRescheduled(params.date, params.time)\n        : t.bookingCancelled();\n")

# Cross-channel dedupe: websocket is primary; foreground push is a delayed fallback.
Path('apps/mobile/lib/booking-voice-dedupe.ts').write_text("""export type BookingVoiceEvent = 'booking.created' | 'booking.rescheduled' | 'booking.cancelled';

const RECENT_EVENT_WINDOW_MS = 5 * 60_000;
const spokenEvents = new Map<string, number>();

function keyFor(event: BookingVoiceEvent, bookingId: string, fingerprint?: string | null): string {
  return `${event}:${bookingId}:${fingerprint ?? ''}`;
}

function prune(now: number): void {
  for (const [key, at] of spokenEvents) {
    if (now - at > RECENT_EVENT_WINDOW_MS) spokenEvents.delete(key);
  }
}

export function claimBookingVoiceEvent(
  event: BookingVoiceEvent,
  bookingId: string,
  fingerprint?: string | null,
  now = Date.now(),
): boolean {
  prune(now);
  const key = keyFor(event, bookingId, fingerprint);
  if (spokenEvents.has(key)) return false;
  spokenEvents.set(key, now);
  return true;
}

export function __resetBookingVoiceDedupeForTests(): void {
  spokenEvents.clear();
}
""")

# Owner Bookings screen: add reschedule listener; claim cross-channel events before speech.
path = 'apps/mobile/screens/owner/OwnerBookingsScreen.tsx'
replace_once(path,
    "import { speakBooking } from '../../lib/voice-announce';\n",
    "import { speakBooking } from '../../lib/voice-announce';\nimport { claimBookingVoiceEvent } from '../../lib/booking-voice-dedupe';\n")
replace_once(path,
    "          speakBooking({\n            event: 'booking.created',\n",
    "          if (!claimBookingVoiceEvent('booking.created', payload.bookingId)) return;\n          speakBooking({\n            event: 'booking.created',\n")
old_cancel = """      setCancelNotice(true);
      speakBooking({
        event: 'booking.cancelled',
        bookingId: payload.bookingId,
        language: preferredLanguageRef.current,
        onHindiVoiceMissing: () => setHindiVoiceWarning(true),
      });
    }

    socket.on('booking.created', onCreated);
    socket.on('booking.cancelled', onCancelled);
"""
new_cancel = """      setCancelNotice(true);
      if (claimBookingVoiceEvent('booking.cancelled', payload.bookingId)) {
        speakBooking({
          event: 'booking.cancelled',
          bookingId: payload.bookingId,
          language: preferredLanguageRef.current,
          onHindiVoiceMissing: () => setHindiVoiceWarning(true),
        });
      }
    }

    function onRescheduled(payload: { salonId: string; bookingId: string }) {
      if (payload.salonId !== selectedSalonId) return;
      void loadPage(filterRef.current, undefined, false);
      console.warn('[voice] booking.rescheduled received, fetching updated detail to announce', payload.bookingId);
      apiFetch<OwnerBookingDetailDto>(`${bookingsPath(selectedSalonId)}/${payload.bookingId}`)
        .then((detail) => {
          const timeZone = detail.salonTimezone ?? salonTimeZoneRef.current;
          const { date, time } = detail.slotStart && timeZone
            ? formatVoiceDateTime(detail.slotStart, timeZone)
            : { date: null, time: null };
          if (!claimBookingVoiceEvent('booking.rescheduled', payload.bookingId, detail.slotStart)) return;
          speakBooking({
            event: 'booking.rescheduled',
            bookingId: payload.bookingId,
            language: preferredLanguageRef.current,
            date,
            time,
            onHindiVoiceMissing: () => setHindiVoiceWarning(true),
          });
        })
        .catch((err: unknown) => {
          console.warn('[voice] could not fetch rescheduled booking detail for announcement', err);
          if (!claimBookingVoiceEvent('booking.rescheduled', payload.bookingId, 'detail-unavailable')) return;
          speakBooking({
            event: 'booking.rescheduled',
            bookingId: payload.bookingId,
            language: preferredLanguageRef.current,
            date: null,
            time: null,
            onHindiVoiceMissing: () => setHindiVoiceWarning(true),
          });
        });
    }

    socket.on('booking.created', onCreated);
    socket.on('booking.rescheduled', onRescheduled);
    socket.on('booking.cancelled', onCancelled);
"""
replace_once(path, old_cancel, new_cancel)
replace_once(path,
    "      socket.off('booking.created', onCreated);\n      socket.off('booking.cancelled', onCancelled);\n",
    "      socket.off('booking.created', onCreated);\n      socket.off('booking.rescheduled', onRescheduled);\n      socket.off('booking.cancelled', onCancelled);\n")

# Push payload parser accepts create/reschedule/cancel.
path = 'apps/mobile/lib/push-navigation.ts'
replace_once(path,
    "export interface OwnerBookingPushData {\n  type: 'booking.created';\n",
    "export interface OwnerBookingPushData {\n  type: 'booking.created' | 'booking.rescheduled' | 'booking.cancelled';\n")
replace_once(path,
    "  if (data.type !== 'booking.created') return null;\n",
    "  if (data.type !== 'booking.created' && data.type !== 'booking.rescheduled' && data.type !== 'booking.cancelled') return null;\n")
replace_once(path,
    "  return { type: 'booking.created', salonId: data.salonId, bookingId: data.bookingId };\n",
    "  return { type: data.type, salonId: data.salonId, bookingId: data.bookingId };\n")

# Foreground push fallback when websocket delivery is missed.
path = 'apps/mobile/components/PushNotificationCoordinator.tsx'
replace_once(path,
    "import { Role, type MeResponse } from '@barbercue/shared';\n",
    "import { DASHBOARD_PATHS, Role, formatVoiceDateTime, type Language, type MeResponse, type OwnerBookingDetailDto } from '@barbercue/shared';\n")
replace_once(path,
    "import { useAuth } from '../lib/auth-context';\n",
    "import { useAuth } from '../lib/auth-context';\nimport { apiFetch } from '../lib/api';\nimport { useLanguage } from '../lib/language-context';\nimport { speakBooking } from '../lib/voice-announce';\nimport { claimBookingVoiceEvent } from '../lib/booking-voice-dedupe';\n")
replace_once(path,
    "  parseOwnerBookingPushData,\n  requestOwnerBookingPushNavigation,\n} from '../lib/push-navigation';\n",
    "  parseOwnerBookingPushData,\n  requestOwnerBookingPushNavigation,\n  type OwnerBookingPushData,\n} from '../lib/push-navigation';\n")
replace_once(path,
    "function isOwner(user: MeResponse | null): user is MeResponse {\n  return Boolean(user?.roles.includes(Role.SALON_OWNER));\n}\n",
    "function isOwner(user: MeResponse | null): user is MeResponse {\n  return Boolean(user?.roles.includes(Role.SALON_OWNER));\n}\n\nfunction bookingDetailPath(salonId: string, bookingId: string): string {\n  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.bookings}/${bookingId}`;\n}\n")
replace_once(path,
    "  const { status, user } = useAuth();\n  const currentUserRef = useRef<MeResponse | null>(null);\n",
    "  const { status, user } = useAuth();\n  const { language } = useLanguage();\n  const currentUserRef = useRef<MeResponse | null>(null);\n  const languageRef = useRef<Language>(language);\n")
replace_once(path,
    "  useEffect(() => {\n    currentUserRef.current = status === 'authenticated' ? user : null;\n  }, [status, user]);\n",
    "  useEffect(() => {\n    currentUserRef.current = status === 'authenticated' ? user : null;\n  }, [status, user]);\n\n  useEffect(() => {\n    languageRef.current = language;\n  }, [language]);\n")
marker = """  function handleOwnerBookingResponse(response: Notifications.NotificationResponse, actor: MeResponse | null): boolean {
    if (!isOwner(actor)) return false;
    const payload = parseOwnerBookingPushData(response.notification.request.content.data);
    if (!payload) return false;
    requestOwnerBookingPushNavigation(payload);
    return true;
  }

"""
insert = marker + """  function scheduleForegroundVoiceFallback(payload: OwnerBookingPushData): void {
    setTimeout(() => {
      if (!isOwner(currentUserRef.current)) return;
      const activeLanguage = languageRef.current;
      if (payload.type === 'booking.cancelled') {
        if (!claimBookingVoiceEvent(payload.type, payload.bookingId)) return;
        speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage });
        return;
      }

      void apiFetch<OwnerBookingDetailDto>(bookingDetailPath(payload.salonId, payload.bookingId))
        .then((detail) => {
          const fingerprint = payload.type === 'booking.rescheduled' ? detail.slotStart : undefined;
          if (!claimBookingVoiceEvent(payload.type, payload.bookingId, fingerprint)) return;
          const timeZone = detail.salonTimezone;
          const { date, time } = detail.slotStart && timeZone
            ? formatVoiceDateTime(detail.slotStart, timeZone)
            : { date: null, time: null };
          if (payload.type === 'booking.created') {
            speakBooking({
              event: payload.type,
              bookingId: payload.bookingId,
              language: activeLanguage,
              serviceName: detail.serviceName ?? null,
              barberName: detail.assignedStaffName ?? detail.preferredStaffName ?? null,
              salonName: detail.salonName ?? null,
              date,
              time,
            });
          } else {
            speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage, date, time });
          }
        })
        .catch(() => {
          if (!claimBookingVoiceEvent(payload.type, payload.bookingId, 'detail-unavailable')) return;
          if (payload.type === 'booking.created') {
            speakBooking({
              event: payload.type,
              bookingId: payload.bookingId,
              language: activeLanguage,
              serviceName: null,
              barberName: null,
              salonName: null,
              date: null,
              time: null,
            });
          } else {
            speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage, date: null, time: null });
          }
        });
    }, 1200);
  }

"""
replace_once(path, marker, insert)
replace_once(path,
    "    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {\n",
    "    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {\n      const payload = parseOwnerBookingPushData(notification.request.content.data);\n      if (payload && isOwner(currentUserRef.current)) scheduleForegroundVoiceFallback(payload);\n    });\n\n    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {\n")
replace_once(path,
    "      responseSubscription.remove();\n      tokenSubscription.remove();\n",
    "      receivedSubscription.remove();\n      responseSubscription.remove();\n      tokenSubscription.remove();\n")

# Backend localized reschedule push; fire-and-forget.
path = 'apps/backend/src/push-notifications/push-dispatch.service.ts'
replace_once(path,
    "    kind: 'newBooking' | 'bookingCancelled',\n",
    "    kind: 'newBooking' | 'bookingRescheduled' | 'bookingCancelled',\n")

path = 'apps/backend/src/bookings/bookings.service.ts'
replace_once(path,
    "    this.realtime.emitBookingRescheduled(booking.salonId, bookingId);\n\n    return this.toDetailDto(updated);\n",
    "    this.realtime.emitBookingRescheduled(booking.salonId, bookingId);\n    void this.pushDispatch.dispatchLocalizedToUser(\n      booking.salon.ownerUserId,\n      'bookingRescheduled',\n      updated.service.name,\n      { type: 'booking.rescheduled', salonId: booking.salonId, bookingId },\n    );\n\n    return this.toDetailDto(updated);\n")

# Tests.
path = 'apps/mobile/lib/__tests__/voice-announce.android.test.ts'
replace_once(path,
    "  it('also uses bare hi with an underscore-form Hindi voice returned by an Android engine', async () => {\n",
    "  it('speaks a Hindi reschedule announcement with the new slot using the same Android Hindi voice path', async () => {\n    getVoicesMock.mockResolvedValue([\n      { identifier: 'hi-in-voice', name: 'Hindi India', language: 'hi-IN', quality: 'Default' },\n    ]);\n\n    speakBooking({ event: 'booking.rescheduled', bookingId: 'b-rescheduled', language: Language.HI, date: '10th September', time: '4 PM' });\n    await flush();\n\n    expect(speakMock).toHaveBeenCalledTimes(1);\n    expect(speakMock.mock.calls[0][0]).toContain('बुकिंग पुनर्निर्धारित की गई है');\n    expect(speakMock.mock.calls[0][0]).toContain('10th September');\n    expect(speakMock.mock.calls[0][0]).toContain('4 PM');\n    expect(speakMock.mock.calls[0][1]).toEqual(expect.objectContaining({ language: 'hi', voice: 'hi-in-voice' }));\n  });\n\n  it('also uses bare hi with an underscore-form Hindi voice returned by an Android engine', async () => {\n")

Path('apps/mobile/lib/__tests__/booking-voice-dedupe.test.ts').write_text("""import { __resetBookingVoiceDedupeForTests, claimBookingVoiceEvent } from '../booking-voice-dedupe';

describe('booking voice cross-channel dedupe', () => {
  beforeEach(__resetBookingVoiceDedupeForTests);

  it('collapses websocket/push duplicates for the same lifecycle event', () => {
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_100)).toBe(false);
  });

  it('does not suppress cancellation after a reschedule of the same booking', () => {
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-a', 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.cancelled', 'b1', undefined, 1_100)).toBe(true);
  });

  it('allows two distinct reschedules of the same booking when the new slot differs', () => {
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-a', 1_000)).toBe(true);
    expect(claimBookingVoiceEvent('booking.rescheduled', 'b1', 'slot-b', 1_100)).toBe(true);
  });
});
""")

Path('apps/mobile/lib/__tests__/push-navigation.test.ts').write_text("""import { parseOwnerBookingPushData } from '../push-navigation';

describe('owner booking push payload parsing', () => {
  it.each(['booking.created', 'booking.rescheduled', 'booking.cancelled'] as const)('accepts %s', (type) => {
    expect(parseOwnerBookingPushData({ type, salonId: 's1', bookingId: 'b1' })).toEqual({ type, salonId: 's1', bookingId: 'b1' });
  });

  it('rejects unrelated or malformed payloads', () => {
    expect(parseOwnerBookingPushData({ type: 'queue.updated', salonId: 's1', bookingId: 'b1' })).toBeNull();
    expect(parseOwnerBookingPushData({ type: 'booking.cancelled', salonId: '', bookingId: 'b1' })).toBeNull();
  });
});
""")

path = 'apps/backend/src/push-notifications/push-dispatch.service.spec.ts'
replace_once(path,
    "  it('localizes a cancellation push independently of a new-booking push', async () => {\n",
    "  it('localizes a reschedule push independently of create/cancel', async () => {\n    prisma.user.findUnique.mockResolvedValue({ preferredLanguage: Language.HI });\n    await service.dispatchLocalizedToUser('owner-1', 'bookingRescheduled', 'Haircut', { type: 'booking.rescheduled' });\n    const [[messages]] = expo.send.mock.calls;\n    expect(messages[0].title).not.toBe('Booking rescheduled');\n  });\n\n  it('localizes a cancellation push independently of a new-booking push', async () => {\n")

path = 'apps/backend/src/bookings/bookings.service.spec.ts'
replace_once(path,
    "      expect(realtime.emitBookingRescheduled).toHaveBeenCalledWith('s1', 'b1');\n",
    "      expect(realtime.emitBookingRescheduled).toHaveBeenCalledWith('s1', 'b1');\n      expect(pushDispatch.dispatchLocalizedToUser).toHaveBeenCalledWith(\n        'owner1',\n        'bookingRescheduled',\n        'Haircut',\n        { type: 'booking.rescheduled', salonId: 's1', bookingId: 'b1' },\n      );\n")
