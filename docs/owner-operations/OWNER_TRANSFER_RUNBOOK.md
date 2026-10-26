# Shop owner transfer - production checklist (issue #314)

Moves a shop from one owner account to a different, separately verified owner identity **without deleting or recreating
the shop**. Shop id, status, staff, services, photos, chairs and history stay exactly as they are; only the owner link
moves.

Targets (from issue #314, to be re-confirmed by the owner before execution):

| Shop | Public id | Status to preserve | New owner e-mail |
|---|---|---|---|
| Studio 25 Salons | BC-SHOP-000088 | SUSPENDED (stays suspended) | studio25salons@gmail.com |
| Glamourous looks studio | BC-SHOP-000076 | ACTIVE | glamorouslooksstudio@gmail.com |

> Never copy, paste, log or store the passwords that appear in the owner's screenshot. This workflow never uses them.

## What the code guarantees (tested on a disposable PostgreSQL)

* Only a PLATFORM_ADMIN session can prepare, verify, execute or cancel a transfer.
* One open transfer per shop (database-enforced). The new e-mail must not already have an account.
* `execute` is refused until the owner is **verified**. Verification is recorded outside FastQue and states the method
  (`OFFLINE_DOCUMENT` or `REGISTERED_PHONE_CALLBACK`) and a written reference. For a phone callback the last four digits
  of the number called must match the phone FastQue holds for the shop; a shop with no registered phone cannot use it.
* If another active platform administrator exists, the verifier must be a **different** administrator from the preparer.
* `execute` runs in one transaction under a row lock: creates the new account (`passwordChangeRequired`, temporary
  password valid 72 hours, e-mail **not** marked verified), grants SALON_OWNER for that shop only, moves
  `salons.ownerUserId`, removes the former account's roles for that shop, moves a staff row the former owner held there,
  revokes **all** of the former account's sessions and unused recovery links, and writes the audit trail.
* The temporary password is returned **once** in the `execute` response (`Cache-Control: no-store`), stored only as a
  bcrypt hash, and never written to logs or to the audit trail.
* The backend refuses every route for an account in the temporary state except `GET /auth/me`, `POST /auth/logout-all`
  and `POST /auth/password/change-required` (error `PASSWORD_CHANGE_REQUIRED`, HTTP 403). Changing the password clears
  the state, kills the temporary password and revokes every session.
* An expired temporary password cannot sign in (the administrator must issue a new transfer).
* Audit actions: `SALON_OWNER_TRANSFER_PREPARED`, `_VERIFIED`, `_COMPLETED`, `_CANCELLED`.

## Release classification

This change **adds a migration** (`20261027140000_owner_transfer_password_gate`: two columns on `users`, one table, two
enums). It is therefore **not** a no-migration release. Before it can run in production:

1. Owner authorization to deploy this PR (separate from the transfer itself).
2. Fresh encrypted P1 backup (`p1_backup.py --label <next> --clipboard`), checksum + decryption + 75->76 table check,
   disposable restore, new Neon recovery branch, and the schema inventory guard (`p1_expected_schema.json`) regenerated
   for the new table and migration.
3. Exact-head CI green; pinned Railway deploy backend first (it runs the migration), then web (no web change needed).
4. Live check: `/api/v1/health`, an unauthenticated call to `/auth/password/change-required` returns 401.

## Identity verification (owner actions, outside FastQue)

For **each** shop, before anything is executed:

1. Decide who is legally authorized to own the shop and who the new e-mail belongs to.
2. Verify that person by one of:
   * **Offline document**: an administrator checks photo ID against the registered owner's name in person or by video and
     records who checked, when and how in the reference field. No document number is recorded.
   * **Registered phone callback**: an administrator calls the phone number FastQue already holds for the shop (not a
     number supplied in the request), the person confirms the shop details and the new e-mail address, and the last four
     digits of the number called are entered.
3. A second administrator (if available) performs the `verify` step.

## Execution (platform administrator, per shop; do both shops in one window)

Between the two transfers the shared account still owns the other shop and its sessions were just revoked, so run the
second transfer straight after the first.

```
POST /api/v1/admin/salons/{salonId}/owner-transfers            { "newEmail": "<address>" }
POST /api/v1/admin/owner-transfers/{id}/verify                 { "method": "...", "reference": "...", "registeredPhoneLast4": "####" }
POST /api/v1/admin/owner-transfers/{id}/execute                -> response contains the temporary password ONCE
```

* Hand the temporary password to the verified person over a channel that is not e-mail to the shared inbox (in person or
  by the same verified phone call). Do not paste it into chat, issues or tickets. Do not take a screenshot of it.
* The person signs in at the normal owner login with the new e-mail and the temporary password, and must choose their own
  password immediately (`POST /auth/password/change-required`) within 72 hours, then signs in again.
* Studio 25 Salons stays **SUSPENDED**. Reopening is a separate authorization.

## Verification after each transfer (read-only)

* `salons.ownerUserId` equals the new user; exactly one `user_roles` row with SALON_OWNER for the shop; none for the old
  user.
* Staff, services, chairs and photo counts for the shop equal the counts recorded before; shop status unchanged.
* The old account has zero unrevoked refresh tokens; the old account is denied the shop (403) after the transfer.
* Audit log shows PREPARED, VERIFIED and COMPLETED for the transfer with no password material.
* The new owner can use the shop only after changing the temporary password; a call before that returns
  `PASSWORD_CHANGE_REQUIRED`.

## Rollback

* Before `execute`: `POST .../cancel` (nothing has changed).
* After `execute`: the transfer is an ordinary, audited ownership change. To reverse it, prepare and verify a new
  transfer to the intended owner. The full pre-release backup and Neon recovery branch are the disaster fallback only.

## Remaining owner actions and known limits

* Confirm the legally authorized owner and the two new e-mail addresses (issue #314 says to confirm before any change).
* Provide an administrator who can verify (a second administrator is strongly recommended).
* Google sign-in for a new owner who still has the temporary state: the gate applies to every session, so such an owner
  must first change the password with the temporary one. The gate fails closed.
* Access tokens signed before a transfer can live up to 15 minutes, but owner routes check the database role on every
  request, so the former account is denied immediately.
* The new e-mail is intentionally not marked verified; the owner can verify it later through the normal flow.
