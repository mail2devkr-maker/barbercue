# BarberCue mobile push P0

BarberCue uses `expo-notifications` on native devices and the Expo Push Service on the backend.
Expo delivers Android notifications through FCM v1. The existing `Notification` table remains the
single event/delivery architecture: every business event creates its normal `IN_APP` row and one
durable `PUSH` outbox row per enabled installation.

## Runtime configuration

Backend:

- `PUSH_PROVIDER=expo` explicitly enables PUSH and exposes it as available in communication
  preferences.
- `EXPO_ACCESS_TOKEN` is optional unless Expo enhanced push security is enabled.

Expo/EAS:

- The existing EAS project ID is read from `apps/mobile/app.json`.
- Android requires an FCM v1 service-account key configured in the Expo/EAS project credentials.
  Credentials are not committed and this branch does not create or upload them.
- A development/production native build is required; Android remote push is not supported in Expo
  Go.

## Reserved-staff reconciliation hook

This baseline intentionally treats `Booking.preferredStaffId` as a preference, not an assignment.
After Claude's authoritative reserved/assigned-staff booking field lands, its committed booking
event should call the existing `NotificationsService.notify` once for that staff user's `userId`:

- create: `staff.booking.created`
- reschedule: `staff.booking.rescheduled`
- cancel: `staff.booking.cancelled`

Use the same payload keys already consumed by `buildPushContent`: `bookingId`, `salonId`,
`salonName`, `serviceName`, `slotStart`, `salonTimezone`, and `durationMinutes`. “Any available
professional” must not emit a staff booking event. No new booking relationship or push-specific
business event system is needed.

## Delivery behavior

- Operational notifications use Android channel `barbercue-operations` at HIGH importance with
  the default sound and vibration; no full-screen intent or alarm permission is used.
- Expo ticket errors and receipts are persisted. `DeviceNotRegistered` disables only that device.
- Temporary transport/rate failures retain the device and retry with bounded backoff.
- Provider delivery occurs after the originating business transaction and cannot roll back a
  successful booking or queue operation.
- Foreground owner/staff voice announcements are device-local, opt-in, and never speak customer
  contact details. Background/killed behavior is native sound/vibration/heads-up only.
