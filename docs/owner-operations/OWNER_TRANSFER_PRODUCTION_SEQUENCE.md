# Owner transfer - executable production sequence (PR #317)

Nothing in this file has been run against production. Every step marked **[OWNER]** needs the owner; every step marked
**[WRITE]** changes production and needs the owner's written authorization **naming the exact commit SHA**. Everything else is
read-only. At every step: if the expected result is not what is written, **STOP** and report; do not improvise.

Tools live outside the repository in `C:\fastque-recovery\` (rotation, work). `<SHA>` is the authorized 40-character commit.

## Phase A - read-only preflight (any time; no authorization needed)

```
python -I C:/fastque-recovery/rotation/release_gate_owner_transfer.py --sha <SHA>
```

Expected: every line `PASS` and `RESULT: ALL REQUIRED GATES PASS`. It checks: PR head == SHA; every exact-head CI check green;
current master is contained in SHA; the only migration added versus master is `20261027140000_owner_transfer_password_gate`;
no package/lock change; both inventory self-tests pinned (production + release) pass 19/19; `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS` (on `mail.fastque.com`), https `WEB_BASE_URL`, `NODE_ENV=production` present (names/shapes only);
current backend and web deployments are SUCCESS (these ids are the rollback targets - copy them into the release note);
backend health ok. **STOP on any `STOP` line.**

Before the post-deploy check, regenerate the release inventory pinned to the release SHA: edit `release_sha` in
`p1_expected_schema.owner_transfer.json` to `<SHA>` and re-run `python -I C:/fastque-recovery/rotation/schema_guard_test.py C:/fastque-recovery/rotation/p1_expected_schema.owner_transfer.json` (expect 19/19).

### Why the guard self-test used to show 14/15
The old self-test built its chain database from the **working-tree** migration directory but compared it with the **production**
inventory (69 migrations at `be068d59`). On a feature branch with one extra migration the ledger (70 vs 69) correctly differed.
The test now pins its baseline to the inventory's own `release_sha` (read from git), first proves the inventory's ledger
equals that pinned set, builds the chain database from the pinned files, and then runs every original check unchanged (19/19
for the production inventory and for the owner-transfer inventory). It still FAILS, as it must, for an inventory whose ledger does not match its own SHA (the triple-PR inventory is
marked `UNPINNED` until a real commit combines #313, #315 and #317). No guard rule was relaxed; `schema_guard.py` itself is unchanged.

## Phase B - email delivery test (isolated; needs a designated test inbox and an owner-provided key)

Purpose: prove that a real message from `mail.fastque.com` arrives, that the link survives the provider and the mail client with
its `#t=` fragment intact, and that acceptance, single use, expiry, cancellation and resend behave. **Never use a real shop's
owner address.**

1. **[OWNER]** designate ONE test inbox you can open on this PC, and put a Resend API key for the verified domain on the clipboard
   when asked (the harness never prints it). Use the production key only if you accept it sending one message to that inbox.
2. Start the isolated stack exactly as in the browser certification (disposable DB `fastque_rc26_*`, backend :3300, web :3301,
   synthetic administrators, `seed_admin.js`). Create the transfer through the admin screen or `transfer_admin.py` to the **test
   inbox address** (not a shop owner). The development sender captures the real link in `backend.log`.
3. Dry run first (sends nothing):
   `set LINK_FILE=...\last-link.txt & set TEST_INBOX=<inbox> & set DRY_RUN=1 & node C:/fastque-recovery/work/email-test/send_real.js`
   Expected: `bodyHasLink:true`, `tokenInUrlOrHeaders:false`, `authHeaderPresent:true`, `dry run complete (nothing sent)`.
4. Real send (one message): add `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS="FastQue Test <noreply@mail.fastque.com>"` and
   `CONFIRM_REAL_SEND=YES-SEND-TO-THE-DESIGNATED-TEST-INBOX`, unset `DRY_RUN`. The harness refuses any sender not on
   `mail.fastque.com`, any link not of the form `/accept-owner-invitation#t=<64 hex>`, and any run without the confirmation.
5. Verify, in order (record yes/no for each): message arrived (inbox, not spam); sender and DKIM/SPF pass in the message
   headers; the link still ends with `#t=<64 hex>` after the mail client (no click-tracking rewrite, no fragment loss); opening
   it shows the shop preview; accepting works once; the same link refused afterwards; a second invitation made after
   expiring the first (isolated DB: set `invitationExpiresAt` to a UTC time in the past) kills the first link; cancel kills the
   link; the page URL shows no token after load.
6. **STOP / NO-GO** if any answer is "no". A fragment lost or rewritten by the provider is a release blocker (switch the link
   format before releasing). Drop the disposable database afterwards.

## Phase C - Android device test (needs the phone and a disposable-package test build)

Do not touch the Google Play app `com.dcw.fastque`. Test with a build whose applicationId is different (the earlier RT103
recipe used `com.dcw.fastque.<suffix>`), `EXPO_PUBLIC_API_BASE_URL=http://localhost:3300/api/v1` and
`EXPO_PUBLIC_WEB_ORIGIN=http://localhost:3301`, both reached over `adb reverse`.

**Reconnect the phone** (run on this PC; the phone must be unlocked):
```
adb kill-server
adb start-server
adb devices -l
```
Expected: a line `<serial>  device`. If `unauthorized`: unlock the phone and accept "Allow USB debugging". If nothing appears:
phone Settings -> Developer options -> USB debugging ON, USB mode "File transfer", try another cable/port, then
`adb kill-server && adb start-server`. Wireless (Android 11+): Developer options -> Wireless debugging -> "Pair device with
pairing code", then `adb pair <ip:port>` and `adb connect <ip:port>`. Then:
```
adb -s <serial> shell getprop ro.product.model
adb -s <serial> shell pm list packages | findstr fastque
adb -s <serial> reverse tcp:3300 tcp:3300
adb -s <serial> reverse tcp:3301 tcp:3301
```
The production package may be listed - leave it alone.

**Verify the test build before installing:** `python -I C:/fastque-recovery/work/android/verify_apk.py <apk>` must print the four
needles `present=True` (notice text, handoff label, `change-password-required`, `PASSWORD_CHANGE_REQUIRED`), `is the Google
Play production package: False` and `RESULT: OK to install`. (The JS bundle exported from PR head `939ac1f9` already contains all four strings; verified 27 Oct.) Install with
`adb -s <serial> install -r <apk>` - `-r` only replaces a package with the same id, which verify_apk guarantees is not production.

**Seed** a flagged owner in the isolated DB (`passwordChangeRequired=true`, `temporaryPasswordExpiresAt` in the future, a known
temporary password, SALON_OWNER on a test shop) and run:

| Step | Expected | Stop if |
|---|---|---|
| Sign in with the temporary password in the test app | owner shell starts, then the notice "Choose your own password first" appears | app shows a generic error instead |
| Tap "Open the FastQue website" | phone browser opens `.../change-password-required` | nothing opens, or a different page |
| Change the password in the browser | "Password changed"; all sessions revoked | change is refused |
| Return to the app | it falls back to the login screen on the next call (session revoked) or still shows the notice; "Sign out" returns to login | app crashes or shows owner data |
| Sign in with the new password | normal owner shell, only the owner's own shop | notice appears again |
| Kill and reopen the app while flagged (before changing) | session restores, first call returns 403, the notice appears again | app shows owner data |
| Open the phone browser to an invitation link | page loads, accepts once, link refused on reuse | token visible in the address bar after load |

Record evidence with `adb exec-out screencap -p > shot.png` per step. **Only a run that passes every row on a physical device
is physical certification.** Unit tests and an emulator are not.

## Phase D - production backup, restore and recovery branch ([OWNER] runs the backup; the rest is read-only/disposable)

1. **[OWNER]** on the owner's machine (clipboard flow, nothing printed):
   `python -I C:/fastque-recovery/rotation/p1_backup.py --label p1-owner45e --clipboard`
   Record label, timestamp, encrypted size, SHA-256, tables (expected **75**), ledger records (expected **72** = 69 finished + 3
   historical unfinished). **STOP** if the guard refuses (it names the exact difference), or the tables/ledger differ.
2. `python -I C:/fastque-recovery/rotation/neon_rotation.py verify --label p1-owner45e --stamp <stamp>` - expect four PASS lines
   and `VERIFY: PASS` (checksum, decryption + MDC, plaintext hash, 75/75 table-of-contents entries). **STOP** otherwise.
3. Disposable restore (name must start `fastque_rc26_`): `python -I C:/fastque-recovery/rotation/local_restore.py p1-owner45e <stamp> fastque_rc26_r5`
   then `python -I C:/fastque-recovery/work/check_restored.py fastque_rc26_r5` - expect 75 tables, inventory MATCH, 0 NOT VALID
   constraints, 0 invalid indexes, row counts equal to the backup. **STOP** otherwise.
4. Migration rehearsal on that restored copy: apply `apps/backend/prisma/migrations/20261027140000_owner_transfer_password_gate/migration.sql`
   (expect no error; 76 tables), then `docs/owner-operations/owner-transfer-rollback.sql` (expect back to 75 tables and the same schema
   fingerprint), then re-apply. **STOP** on any error. Drop `fastque_rc26_r5` afterwards.
5. Neon recovery branch (MCP `create_branch`): project `crimson-field-96192935`, parent `br-jolly-pond-azhohrz3`, name
   `recovery-pre-owner-transfer-<date>`, `no_compute: true`; then `get_branch` must show `current_state: ready`. Record id and
   parent LSN. **STOP** if not ready. (Creating the branch is a [WRITE] to Neon only, no production data changes.)
6. Confirm identity read-only: project `crimson-field-96192935`, branch `br-jolly-pond-azhohrz3`, database `fastque_final_20261023`, 75 tables.

## Phase E - production deploy ([WRITE]; only with written authorization naming `<SHA>`)

Re-run Phase A immediately before. Then, with the recorded rollback targets (current backend and web deployment ids):

1. Backend first (it runs the migration in its pre-deploy step):
   `railway api --var e=41bff3cc-5c98-4c6d-9aa6-33cc519badb1 --var s=7cd12053-1973-4622-9cdd-91656a9b5e92 --var c=<SHA> < deploy.gql`
   with `deploy.gql` = `mutation($e:String!,$s:String!,$c:String!){ serviceInstanceDeployV2(environmentId:$e,serviceId:$s,commitSha:$c) }`.
   Wait for `SUCCESS`; the log must show exactly **one** migration applied. **STOP** on FAILED, wedged build (cancel with
   `deploymentCancel` and retry the same pinned deploy once), or any other migration count.
2. Verify read-only: health ok; `POST /api/v1/auth/owner-invitations/inspect` with a random token returns **400**, not 404/5xx;
   `GET /api/v1/admin/salons/<any>/owner-transfers` without a token returns **401**; live table count is **76**, ledger 70+3; the
   post-deploy inventory (release inventory, pinned to `<SHA>`) reports MATCH; pre-existing tables have the same row counts as
   the backup. **STOP + rollback boundary R1** on any difference.
3. Web (same mutation with `s=23e368ec-d309-48fc-a697-b4968ed567cf`). Verify the live bundles contain the new pages and
   `GET https://<web host>/accept-owner-invitation` returns 200 with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
4. Only after 2 and 3 pass: fast-forward `master` to `<SHA>` (`git push origin <SHA>:refs/heads/master`).
5. Keep `WEB_BASE_URL` unchanged. After the invitation page is verified on `https://fastque.com`, switching it is a separate
   owner-approved change.

### Rollback boundaries
- **R0 - before step E1:** nothing changed. Stop freely.
- **R1 - after E1, before any transfer:** redeploy the recorded backend rollback target (old code ignores the new table/columns, so
  the schema can stay). If the schema itself must be removed: `owner-transfer-rollback.sql` inside a transaction, only with separate
  authorization; the Neon recovery branch and the encrypted backup are the fallback.
- **R2 - after a transfer was completed:** do **not** run the rollback SQL (it drops the transfer records). Reverse the ownership with a
  new verified transfer; the recovery branch is for disaster only.

## Phase F - each ownership transfer (separate authorization per shop)

Per `OWNER_TRANSFER_RUNBOOK.md`: confirm the legally authorized person and address; prepare; **independent** verification with identity
AND authority evidence (second administrator, or the audited break-glass with its 24-hour wait); send the invitation; the recipient
accepts; verify read-only afterwards (owner role count 1, `salonId` table counts unchanged, former account has no sessions, status
unchanged - Studio 25 stays SUSPENDED). **STOP** if the person or address is unconfirmed, evidence is missing, or anyone asks to
reset an existing credential or reopen Studio 25.
