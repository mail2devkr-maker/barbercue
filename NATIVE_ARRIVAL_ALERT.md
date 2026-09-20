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
  - `FastQueArrivalMessagingService` extends expo-notifications' `ExpoFirebaseMessagingService` at manifest priority 100 (Expo's is -1). FCM delivers each message to exactly one service; anything that is not `booking.arrival_check` is passed straight to Expo unchanged. An arrival push while the app is in front is swallowed (the React Native prompt is already driven by the realtime event / backend refresh and makes the one sound).
  - `ArrivalAlertNotifier` - HIGH-importance channel `fastque-arrival-alert` (deliberately **no channel sound**; 1.0.5's `fastque-arrival-check` is deleted on start), `setFullScreenIntent(..., true)` when allowed, category REMINDER (deliberately not ALARM, so Do Not Disturb keeps working), Arrived / Not arrived / Remind actions.
  - `ArrivalAlertVoice` - the one audible part of a native alert: the spoken announcement (see below), or the default notification tone if speech is impossible.
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

## Physical-test build (temporary EAS profile) and certification backend

The `physical-test` build MUST NOT talk to the production backend: it runs unmerged mobile + backend code, and the arrival flow creates queue entries and no-show charges. So it is paired with a **temporary certification backend** built from this branch and a **disposable, non-production database**.

- `apps/mobile/eas.json` -> `build.physical-test` (production and preview profiles untouched): `environment: production` (same EAS variables), `EXPO_PUBLIC_API_BASE_URL` overridden to the certification backend's `/api/v1` (eas-cli merges `{ ...EAS environment, ...profile env }`, so the profile value wins - eas-cli prints a warning naming the overridden key), `distribution: internal`, Android `buildType: apk`, `EXPO_PUBLIC_FASTQUE_CREDITS_ENABLED=false`, `autoIncrement: true`, and its own update channel `physical-test` so production OTAs can never reach a certification APK. Because the variable is set, the release fallback in `lib/api.ts` (`PRODUCTION_API_BASE_URL`) is never used.
- Signed with the project's EAS Android credentials, not Play App Signing, and it shares the `com.dcw.fastque` id: a Play-installed FastQue must be uninstalled first (its sign-in is lost on that phone). Remove the profile once certification is complete.
- **Certification backend:** a separate Railway project (`fastque-cert-temp`, service `cert-backend`), deployed from an export of this branch. It has its own JWT / TOTP secrets and NO storage, e-mail, SMS, AI or object-storage credentials; nothing is copied from production except the two public Google OAuth client IDs. It never reads the production database.
- **Certification database:** an empty, disposable Postgres (staging Neon project - never a branch of production, which would copy real customers). Bring-up on a fresh database: `prisma migrate deploy` (it stops at `20260830215000_ensure_primary_platform_admin`), `seed-certification.ts bootstrap-admin`, `prisma migrate resolve --rolled-back 20260830215000_ensure_primary_platform_admin`, `prisma migrate deploy` again, then `seed-certification.ts seed`.
- **Seed:** `apps/backend/prisma/seed-certification.ts` refuses to run unless `CERT_SEED_CONFIRM=fastque-cert-temp` AND the database holds nothing but certification rows (no other salon, no phone/real-email user) - see `certification-seed-guard.ts`. It creates one test salon (3-minute arrival grace, flat INR 50 no-show charge), an owner, an assigned staff member, an unassigned staff member, and - on demand - `appointment --in <minutes> [--staff assigned|other|any] [--multi]` test appointments for fresh fictional customers. Logins are generated and written to a local file outside the repository; they are never printed or committed.
- Tear down after certification: delete the Railway project and the Neon project.

## The arrival push MUST be data-only (root cause of the 1.0.5 lock-screen regression)

An Expo push that carries a `title`/`body` becomes an FCM *notification message*. While the app is backgrounded, locked or killed, Android's FCM SDK displays such a message itself (notification tag `FCM-Notification:...`, on the channel named in the payload, **no full-screen intent**) and never calls the app's messaging service - so the native full-screen alert never ran and the screen stayed off. Proven with adb / logcat / `dumpsys notification` on an Android 13 emulator against the certification backend:

| Push shape | What happened on a locked, screen-off emulator |
|---|---|
| title + body + channelId + sound (1.0.5 backend) | System-displayed `FCM-Notification` on `booking-updates`; screen stayed asleep; `FastQueArrivalMessagingService` never ran; channel `fastque-arrival-check` was never created. |
| data-only + priority high (fixed backend) | Service ran; `fastque-arrival-check` posted with a full-screen intent (`sysui_fullscreen_notification`); exactly one `notification_alert` (buzz + beep); `FastQueArrivalAlertActivity` resumed over the keyguard; the screen woke. |

`PushDispatchService` therefore sends the arrival check with no title/body/sound/channel/category, `priority: high`, `ttl: 600`; the phone builds the localized notification from `data` (ids + `lang`). Do not add a title/body back to it. Also verified on the emulator: "Remind me in 2 minutes" re-alerts exactly once (inexact alarm, ~1.5 min late while asleep); "Arrived" asks the system for unlock, then hands off to the React Native prompt.

Emulator results are diagnosis only. **Still physical-device-specific:** the phone's own state for the `fastque-arrival-check` channel (OEM/user sound + importance defaults - the Settings readiness card now reports "arrival alert sound is turned off" and opens that channel's settings), Android 14+ full-screen special access, OEM battery/background restrictions, DND / ringer, and the lock-screen visibility the phone applies.

## Spoken announcement (Regression 3) - what 1.0.3 announced, and how 1.0.5 keeps it

Verified from code (`git show 69f3cb0`, the 1.0.3-era `PushNotificationCoordinator`) rather than assumed:

- **Mobile 1.0.3 spoke owner booking events only** - new booking (service, barber, salon, date/time), reschedule, cancellation - through `speakBooking()` (+ `booking-voice-dedupe`) when the push is received by the running app. That path is unchanged in 1.0.5 and is pinned by `PushNotificationCoordinator.voice.test.tsx`.
- **The mobile app never spoke the arrival check** (`arrivalCheck` appears nowhere in `apps/mobile` history). The arrival sentence - "Appointment reminder. Has the 6:30 PM <service> customer arrived? Please confirm arrived or not arrived." - lives in the shared `VoiceAnnouncements` and was spoken only by the **web** dashboard overlay (`ArrivalAlertOverlay`). A local speech-recognition pass over the supplied recording (`WhatsApp Ptt 2026-09-20 at 18.32.45.ogg`, 7 s) heard: "...6:30 PM classic ... customer ... please confirm [arrived] or not arrived" - i.e. that sentence, so the recording is the arrival announcement as the web overlay speaks it. (Low recognizer confidence; treat as corroboration, not proof.)
- The 1.0.5 arrival branch did bypass `speakBooking()` - it only opened the prompt and played a tone. It now speaks.

Design: **exactly one audible episode per arrival event - the spoken sentence, or the tone only if speech is impossible.**
- App in front (React Native): `alertArrivalOnce` (the once-per-episode arbiter) calls `canSpeak()` then `speakBooking({ event: 'booking.arrival_check', ... })` - the same Android/Hindi voice pipeline as new-booking. Speech replaces the tone; if there is no TTS engine (or Hindi with no Hindi voice) it plays the tone instead.
- App away / locked / killed (native): the arrival notification lives on a channel with no sound; `ArrivalAlertVoice` speaks the same EN/HI sentence with Android `TextToSpeech` (USAGE_NOTIFICATION, so volume / silent / Do Not Disturb apply), or plays the default notification tone if speech fails. If the owner or the phone turned the arrival channel below HIGH importance nothing is played.
- Duplicates: the backend `arrivalAlertSentAt` claim, the native store claim, the React Native `alerted` set (push + realtime + reconcile + refresh), and a foreground arrival push being swallowed natively mean one alert episode speaks once; a snooze re-arm is one new episode.
