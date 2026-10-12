# FastQue disposable Android native QA probe

**This branch is NOT an RT103 mitigation certification and must NEVER be merged into the production mobile app.**

It starts from the separately tested backend-isolation guard in Draft PR #192, using the current master 1.0.6 source. It does **not** contain Codex's private/unpushed `d233b3...` / RT103 1.0.3 experimental patch. Consequently its results do not prove 1.0.3 animation or ReactHost stability.

## Isolation safeguards

- Android application ID: `com.dcw.fastque.qalocal`; will not overwrite the Play app `com.dcw.fastque`.
- `expo-updates` explicitly **disabled** in `app.config.js`; no EAS channel/group is used.
- Only executable when `FASTQUE_LOCAL_QA_NATIVE=true`, `EXPO_PUBLIC_FASTQUE_QA_ISOLATED=true`, and `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000/api/v1`.
- Only the emulator-to-host local API bridge is permitted; production Railway hosts are rejected by `lib/qa-backend-isolation.ts`.
- **The local API itself is NOT proven safe merely by using 10.0.2.2.** Verify its Postgres `DATABASE_URL` and `DIRECT_DATABASE_URL` target a disposable, empty test database. Do not run this app against a local API proxy to production.
- Production Firebase/Google sign-in config plugin removed from this separate QA config; native Google OAuth and FCM push **are not certified** by this candidate. Do not use real customers/accounts or send real notifications.

## Native build certification

The workflow `.github/workflows/isolated-android-native-apk.yml` attempts Expo Android native prebuild and local Gradle release APK assembly on a GitHub-hosted Ubuntu worker. If successful it stores a short-lived artifact for emulator smoke testing. No Expo EAS service, credentials, OTA channel or production backend is changed.

An APK build alone cannot verify cold-start reliability, Android freezes, ANRs, staff login, queue correctness or OTA compatibility. Android emulator/runtime and physical-device tests remain separate gates. **Never publish an OTA** from this branch or its artifacts.

## Historical blocker

The real RT103 QA worktree and mitigation are local to Codex's Windows machine and were not pushed. The real QA channel/runtime needs a compatible 1.0.3 binary built from that worktree, not an arbitrary 1.0.6 replacement. Before comparing baseline vs mitigation, bring the exact source and artifacts into a reviewable isolated GitHub branch and verify the non-production backend plus disposable database.
