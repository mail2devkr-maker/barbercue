# Native Android arrival alert (mandatory arrival prompt)

Status: implemented on branch `codex/native-arrival-fullscreen`; **physical-device verification pending** (see the matrix at the end). Requires a **new native build (Android 1.0.5)** - it cannot be delivered over the air.

## What it is

At T-5 minutes before an appointment the backend asks "Has the customer arrived?". That decision is mandatory shop operations, so it must reach the people who can answer it whether FastQue is open, backgrounded, killed, or the phone is locked. What Android shows:

| Phone state | What Android shows |
|---|---|
| App open | The existing React Native full-screen prompt (unchanged). |
| Locked / screen off | `FastQueArrivalAlertActivity` launched by the notification's full-screen intent, over the lock screen, display turned on. |
| Unlocked and another app is in active use (app in background or killed) | The platform-required **persistent, expanded heads-up** notification (sound + vibration, big-text style, ongoing, **Arrived / Not arrived / Remind me in 2 minutes** visible). Android does not launch a full-screen activity while the phone is in active use, and FastQue deliberately does not work around that (no `SYSTEM_ALERT_WINDOW` / draw-over-other-apps). |
| Full-screen access not granted (Android 14+) | Same heads-up notification (graceful fallback). |
| Notifications disabled at OS level | Nothing can be shown; Settings shows a readiness warning; opening FastQue reconciles with the backend and shows the prompt. |

Whatever the path, the owner's decision always happens in the existing React Native prompt, with its two-step confirmation and idempotent backend calls. The native screen never creates a financial or no-show state.

## Who receives it (recipient rule)

- The **salon owner**, plus the **staff member assigned to that booking** when that staff member is ACTIVE and has a registered push device. Never a broadcast to every staff member of the salon.
- "Assigned to that booking" is `Booking.preferredStaffId` (the customer's chosen barber) - the only per-booking staff link that exists before check-in. An "Any staff" booking alerts the owner only. If the owner is also the assigned staff member they are alerted once.
- A recipient with no registered device simply receives nothing (`PushDispatchService` no-ops); the other recipient is unaffected.
- The read that backs the prompt (`GET dashboard/salons/:salonId/arrival-alerts`) is scoped the same way: the owner (and a delegated platform admin) see every eligible booking; a staff member sees only bookings assigned to them. Staff phones mount the same React Native prompt (`StaffNavigator`, navigating to Today after Arrived / No Show).
- The Notification Center entry stays owner-only.

### Simultaneous responses

Both recipients can answer at the same moment (or race the customer's own check-in). The booking can only transition once:
- **Arrived** creates the `QueueEntry`; `QueueEntry.bookingId` is unique, so a second Arrived is rejected `ALREADY_CHECKED_IN` (409).
- **No Show** is a claim (`updateMany ... status CONFIRMED, no queue entry`); a second No Show is rejected `NO_SHOW_NOT_ELIGIBLE` (409) and never double-charges.
- **Arrived vs No Show**: both transactions first take a per-booking Postgres advisory lock (`lockBookingResolution`) and re-check committed state under it, so a booking can never end up both checked in and marked no-show. Idempotency-Key replays of the same request are still handled by the existing `@Idempotent()` interceptor.

## Mandatory vs preference

- **Mandatory arrival prompt** - the `booking.arrival_check` push and realtime nudge are always dispatched to the recipients above (owner + assigned staff). `ARRIVAL_ALERTS` on `PUSH` is a *required* preference (`isNotificationPreferenceRequired`): it resolves ON whatever is stored (a legacy OFF row is ignored) and `PUT /notifications/preferences` refuses to turn it off (`NOTIFICATION_PREFERENCE_REQUIRED`).
- **Arrival notification preference** - `ARRIVAL_ALERTS` on `IN_APP` stays a normal toggle and only controls the supplemental Notification Center entry.
- Settings copy (EN/HI): "Arrival confirmation screens are required for shop operations and always appear when FastQue needs an arrival decision. Notification settings control additional alerts, not the required arrival screen."

## Pieces

- `apps/mobile/modules/fastque-arrival-alert` - local Expo module (autolinked, no third-party dependency):
  - `FastQueArrivalMessagingService` extends expo-notifications' `ExpoFirebaseMessagingService` at manifest priority 100 (Expo's is -1). FCM delivers each message to exactly one service; anything that is not `booking.arrival_check`, and every push while the app is in front, is passed straight to Expo unchanged.
  - `ArrivalAlertNotifier` - HIGH-importance channel `fastque-arrival-check`, `setFullScreenIntent(..., true)` when allowed, category REMINDER (deliberately not ALARM, so Do Not Disturb keeps working), Arrived / Not arrived / Remind actions.
  - `FastQueArrivalAlertActivity` - `setShowWhenLocked` + `setTurnScreenOn`, programmatic UI (time, service, three buttons). Arrived / Not arrived request keyguard dismissal, then deep-link into FastQue.
  - `ArrivalAlertStore` - SharedPreferences episode store: one alert per booking per episode across process death; 12 h TTL.
  - `FastQueArrivalSnoozeReceiver` - "Remind me in 2 minutes" via `AlarmManager.setAndAllowWhileIdle` (no exact-alarm permission); re-alerts once.
  - Manifest: `USE_FULL_SCREEN_INTENT`, `POST_NOTIFICATIONS`, `VIBRATE`.
- `app.json`: `scheme: "fastque"`, version `1.0.5` (runtime policy `appVersion`, so runtime 1.0.3/1.0.4 OTAs never target the new binary). `versionCode` is managed by EAS (`appVersionSource: remote`, `autoIncrement`).
- JS: `lib/arrival-alert-native.ts` (safe no-op on iOS/older binaries via `requireOptionalNativeModule`), `parseArrivalCheckUrl` + deep-link handling in `PushNotificationCoordinator`, resume reconciliation / native-state sync / snooze hand-off in `OwnerArrivalPromptCoordinator`, readiness card in Settings -> Notifications.
- Push payload (`push-dispatch.service.ts`): `type, salonId, bookingId, slotStart, serviceName, lang` only - no customer name, phone or e-mail.

## Reliability rules

- One episode per booking: backend `arrivalAlertSentAt` claim; native store claim; RN `alerted` set. A re-delivered push, socket event or 30 s refresh never re-launches the screen or re-sounds.
- Re-arm only on "Remind me in 2 minutes" (one re-alert when the snooze fires) or a genuinely new eligible episode.
- Backend stays the source of truth: on every resume/start the app re-queries eligibility and reconciles native state (`reconcile(salonId, eligibleIds)` drops alerts/snoozes that are no longer eligible). A missed push is recovered by opening FastQue.

## Google Play policy implications (review before releasing)

- **FastQue must never present itself as an alarm or calling app** - not in Play Console, the store listing, the notification category (REMINDER, never ALARM/CALL), or any user-facing copy. It is a shop-operations app with one time-critical confirmation.
- `USE_FULL_SCREEN_INTENT` is auto-granted on Android 14+ only to apps whose core functionality is calling or alarms. **FastQue is not such an app**, so it is a non-core use that needs a truthful Play Console declaration (App content -> "Full-screen intent"): use case "time-critical operational confirmation (has the customer arrived?) for shop owners and assigned staff". Users grant the special access manually (Settings -> Apps -> FastQue -> Allow full-screen notifications); FastQue prompts for it (Settings -> Notifications readiness card, `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`) and degrades to a heads-up notification when it is not granted.
- Keep the use limited to the arrival decision. Do not reuse the full-screen path for marketing or ordinary notifications.
- Not requested on purpose: `SYSTEM_ALERT_WINDOW` (would allow an activity over an unlocked phone but is heavily scrutinised), `SCHEDULE_EXACT_ALARM`, DND bypass.

## Known limits (be honest with owners/QA)

1. Unlocked phone in active use: Android shows a heads-up, not a full-screen takeover.
2. Snooze uses an inexact alarm - Doze can delay the re-alert by several minutes.
3. Native content comes from the push: if the booking is resolved on another device the phone may still alert once until FastQue opens and reconciles.
4. Some OEMs treat "swipe away from recents" as a force-stop, which blocks FCM until the app is opened again.
5. Staff are alerted only through `Booking.preferredStaffId`; a booking that has no preferred staff alerts the owner only.
6. Snoozes are lost on reboot (no boot receiver); opening FastQue re-alerts from backend truth.

## Physical verification matrix (mandatory before release)

1. Unlocked + foreground -> RN full-screen prompt, one sound.
2. Unlocked + background -> heads-up with actions.
3. Force-closed / process killed -> heads-up / full-screen.
4. Locked, screen off -> full-screen over lock screen, display turns on.
5. Android 14+ with full-screen access granted -> as 4.
6. Android 14+ access denied -> heads-up fallback + readiness card.
7. Notification permission denied -> readiness warning.
8. Snooze -> exactly one re-alert about 2 minutes later.
9. Duplicate push / realtime / refresh -> no duplicate launch.
10. Arrived -> existing confirmation + idempotent backend transition.
11. Not arrived before grace -> snooze, no charge.
12. Not arrived after grace -> existing explicit No Show confirmation.

## Physical-test build (temporary EAS profile)

`apps/mobile/eas.json` -> `build.physical-test` (production profile untouched): `environment: production` (same EAS environment variables as production), `distribution: internal`, Android `buildType: apk`, `EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED=false`, `autoIncrement: true` (a fresh versionCode so it installs over an earlier build), and its own update channel `physical-test` so production OTAs can never reach a certification APK. Signed with the project's EAS Android credentials, not Play App Signing: an existing Play-installed FastQue must be uninstalled before this APK can be installed. Remove the profile once certification is complete.
