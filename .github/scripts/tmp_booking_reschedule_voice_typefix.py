from pathlib import Path

path = Path('apps/mobile/components/PushNotificationCoordinator.tsx')
text = path.read_text()
old1 = "speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage, date, time });"
new1 = "speakBooking({ event: 'booking.rescheduled', bookingId: payload.bookingId, language: activeLanguage, date, time });"
old2 = "speakBooking({ event: payload.type, bookingId: payload.bookingId, language: activeLanguage, date: null, time: null });"
new2 = "speakBooking({ event: 'booking.rescheduled', bookingId: payload.bookingId, language: activeLanguage, date: null, time: null });"
if text.count(old1) != 1:
    raise SystemExit(f'expected one typed reschedule fallback, found {text.count(old1)}')
if text.count(old2) != 1:
    raise SystemExit(f'expected one typed reschedule error fallback, found {text.count(old2)}')
path.write_text(text.replace(old1, new1, 1).replace(old2, new2, 1))
