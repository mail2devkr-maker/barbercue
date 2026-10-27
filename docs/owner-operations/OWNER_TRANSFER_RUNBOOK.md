# Shop owner transfer - production checklist (issue #314)

Moves a shop from one owner account to a different, separately verified owner **without deleting or recreating the
shop**. Shop id, status, staff, services, photos, chairs, bookings, financial records and history stay exactly as they
are; only the owner link moves.

Targets (from issue #314, to be re-confirmed by the owner before execution):

| Shop | Public id | Status to preserve | New owner e-mail |
|---|---|---|---|
| Studio 25 Salons | BC-SHOP-000088 | SUSPENDED (stays suspended) | studio25salons@gmail.com |
| Glamourous looks studio | BC-SHOP-000076 | ACTIVE | glamorouslooksstudio@gmail.com |

> Never copy, paste, log or store the passwords that appear in the owner's screenshot. This workflow never uses them:
> the new owner chooses their own password on the acceptance page.

## How it works

1. **Prepare** (administrator A) - names the shop and the destination e-mail. Nothing changes.
2. **Verify** (administrator B, a different person) - records that identity AND authority over the shop were checked
   outside FastQue. The server requires BOTH an identity item (`GOVERNMENT_ID` or `IN_PERSON_VISIT`) AND an authority item
   (`BUSINESS_OR_SHOP_PROOF` or `CURRENT_OWNER_WRITTEN_CONSENT`). A callback to the shop's public phone number
   (`REGISTERED_PHONE_CALLBACK`) may be added but never counts toward either requirement. The database repeats this rule as
   a check constraint.
3. **Invite** - FastQue e-mails a single-use link to the destination address. The administrator never sees the token (only
   its SHA-256 is stored). **Nothing has moved yet.**
4. **Accept** (the recipient, on the web page that link opens) - proves control of the inbox. A new address chooses its
   own password (the address is then marked verified). An address that already has an active, verified FastQue account
   only confirms and keeps its password. **Only now** does ownership move.
5. Acceptance, in one transaction under a row lock: creates the account if needed; grants SALON_OWNER for this shop (the
   `(user, role, shop)` unique key forbids duplicates); moves `salons.ownerUserId`; removes the former account's roles for
   this shop only; moves a staff row the former owner held there; revokes **all** of the former account's sessions and
   unused recovery links; writes the audit trail. The shop's status is not touched.

### Independence and the exception procedure

* If another active platform administrator exists, the verifier must be a different administrator from the preparer.
* If none exists (break-glass): the verifier must supply a written justification (at least 50 characters), the transfer is
  marked break-glass in the audit trail, and the invitation cannot be sent until **24 hours** after verification.
* There is no other bypass.

### Expired invitation recovery (no second account, no second transfer)

An invitation lasts 72 hours. After it expires the administrator re-sends it on the same transfer with a written reason
that the recipient was re-confirmed. At most 3 invitations per transfer, at least 10 minutes apart; each new invitation
kills the previous link. Beyond that, cancel and verify again. If the e-mail transport fails or its outcome is uncertain
(a timeout may still have delivered the message), the link is **invalidated at once** and the attempt still counts; the
administrator sends a fresh one after the ten-minute spacing. At most one link is ever live, a cancelled transfer can never
be resurrected by a late failure, and two simultaneous invitations or acceptances produce exactly one winner.

### How the link is protected

The token travels in the URL **fragment** (`/accept-owner-invitation#t=...`), which browsers never send to a server, so it is
absent from access logs, proxies, analytics and Referer headers. The page reads it once and removes it from the address
bar and history; the API receives it only in a POST body (inspect and accept are POST). The invitation and password pages
are served with `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and `noindex`. Only the SHA-256 of the token is
stored, and it is never returned to or shown to an administrator.

### Reversal

Reassigning a shop back to a previous owner (or giving one owner a second shop) is the same flow with a destination
address that already has an **active, verified** account. An unverified or inactive account is refused. The old and the
new owner never hold the shop at the same time, and the former account loses it at the moment of acceptance.

## Mandatory password change (accounts an administrator flags)

Separately from the transfer, an account flagged `passwordChangeRequired` (temporary password, optional expiry) can do
nothing except `GET /auth/me`, `POST /auth/logout-all` and `POST /auth/password/change-required`; every other route
answers 403 `PASSWORD_CHANGE_REQUIRED` from the backend. The web redirects to `/change-password-required`, where the
person enters the temporary password and chooses their own; the change revokes all sessions. The Android app shows a notice with a
button that opens the website change-password page (a browser handoff; no password is handled in the app) and a sign-out
button. A native change screen is not built, and physical-device behaviour is not verified.

## What the tests prove (disposable PostgreSQL)

Admin-only access; one open transfer per shop; unverified/same-owner destinations refused; evidence rules (phone callback
alone, identity-only, authority-only all refused); independence; break-glass justification and cool-down; nothing moves
before acceptance; acceptance moves only the owner link (a generic count of every `salonId` table is identical before and
after); single-use, expiry, re-send limits and reasons, failed-send rollback, cancel kills the link; reversal without
duplicate roles or password change; the former account is denied the moved shop at once and keeps the other shop until it
is transferred; the new owner reaches only their own shop; audit rows contain no token or password; flagged-account gate.
Thirteen deliberate breakages of the code were run; twelve are caught (the thirteenth, the expiry check inside the row
lock, is redundant with the earlier expiry check and can only matter in a race).

## Release classification and gates

This change **adds a migration** (`20261027140000_owner_transfer_password_gate`: two columns on `users`, one table, two
enums). It is **not** a no-migration release.

1. Separate owner authorization to deploy this PR; exact-head CI green on the release commit.
2. Fresh encrypted P1 backup, checksum + decryption + table-of-contents check, disposable restore, new Neon recovery
   branch.
3. Schema inventory for the backup guard: `C:\fastque-recovery\rotation\p1_expected_schema.owner_transfer.json`
   (76 tables, 70 finished migrations). Use it only for a release containing this migration and not PR #313.
4. `docs/owner-operations/owner-transfer-rollback.sql` restores the previous schema exactly (rehearsed: schema
   fingerprint after rollback equals the master fingerprint, and re-applying restores the migrated fingerprint). It drops
   the transfer table, so use it only before any transfer must be kept; it does not undo an ownership change.
5. Pinned Railway deploy, backend first (it runs the migration), then web (the acceptance and password pages).
6. Production e-mail must be able to send: `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS` and `WEB_BASE_URL` (https). Until the
   provider is bound, the invite endpoint fails closed with 503 and nothing changes.

## Execution (platform administrators; do both shops in one window)

Between the two transfers the shared account still owns the other shop, and its sessions are revoked at the first
acceptance, so complete the second acceptance soon after the first.

```
POST /api/v1/admin/salons/{salonId}/owner-transfers            { "newEmail": "<address>" }
POST /api/v1/admin/owner-transfers/{id}/verify                 { "evidence": ["GOVERNMENT_ID","BUSINESS_OR_SHOP_PROOF"], "reference": "<who checked what, how>", "breakGlassJustification": "<only if no second admin>" }
POST /api/v1/admin/owner-transfers/{id}/invite                 { }                      (re-send after expiry: { "reference": "<reason>" })
POST /api/v1/admin/owner-transfers/{id}/cancel
GET  /api/v1/admin/salons/{salonId}/owner-transfers
```

The recipient opens the emailed link (`/accept-owner-invitation?token=...`), chooses a password, and signs in at the owner
login. The same actions are available in the **Platform Admin CRM -> Owner transfers** screen (`/dashboard/admin/owner-transfers`):
search a shop, see its current owner account, prepare (destination typed twice), record evidence, verify, send or re-send
the invitation, cancel, and read each transfer's status and audit history. The screen shows no token or password.

## Verification after each transfer (read-only)

* `salons.ownerUserId` equals the new user; exactly one SALON_OWNER `user_roles` row for the shop and none for the old user.
* Row counts of every table with a `salonId` for the shop equal the counts recorded before; shop status unchanged.
* The old account has zero unrevoked refresh tokens and is denied the shop (403).
* The new owner can sign in, reaches only their own shop, and the previous owner's other shop is unaffected.
* Audit log: PREPARED, VERIFIED, INVITED, COMPLETED (and REINVITED/CANCELLED if used), with no token or password.

## Rollback

* Before acceptance: `POST .../cancel` (nothing changed; the link dies).
* After acceptance: prepare and verify a new transfer back to the intended owner (reversal above). The pre-release
  backup and Neon recovery branch are the disaster fallback only.

## Remaining owner actions and known limits

* Confirm the legally authorized person and the e-mail address for each shop (issue #314 asks for this before any change).
* Supply an administrator who can verify (a second administrator is strongly recommended) and collect the evidence.
* Authorize the migration release; bind the e-mail provider if not already bound.
* No native Android change-password screen (browser handoff only). Physical Android and real e-mail delivery are not
  verified. See `OWNER_TRANSFER_RELEASE_CHECKLIST.md` for every release gate.
* Access tokens signed before a transfer can live up to 15 minutes, but owner routes check the database role on every
  request, so the former account is denied immediately.
