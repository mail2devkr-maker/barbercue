# Owner transfer release - backup, recovery and deployment checklist

For a release that contains migration `20261027140000_owner_transfer_password_gate` (PR #317). It is a **migration
release**, so every gate below is mandatory and none may be skipped. Nothing here has been run against production.

## 0. Preconditions (owner decisions)

- [ ] Owner authorizes this migration release in writing (separate from authorizing any ownership transfer).
- [ ] Decide whether PR #313 (change requests, also a migration) ships in the same release. If yes, use the integration
      rehearsal PR and the combined inventory; if no, use the single-feature inventory. Never mix them.
- [ ] Production e-mail is ready (section 3).
- [ ] The two destination e-mail addresses and the legally authorized people are confirmed (issue #314). No invitation is
      sent to a real shop until the administrator verification of section 8 is done.

## 1. Exact-head certification

- [ ] The release commit is the head of PR #317 (or the approved integration commit); `git rev-parse` equals the SHA written
      in the release note.
- [ ] GitHub Actions on that exact SHA: all checks green (Backend migrations/unit/e2e, Website, Android, Owner Ops,
      PostgreSQL 17 chains, consent ledger, key rotation, certify).
- [ ] Master has not moved since; if it has, merge it into the release branch and wait for CI again.
- [ ] Migration list diff versus master contains exactly the expected migration(s) and no package or other schema change.

## 2. Schema inventory (backup guard)

The guard refuses a backup whose tables or migration ledger differ from the inventory, so the inventory must describe the
database as it will be **before** the deploy (the backup is taken first) and as it will be **after** it (for the post-deploy
check). Files in `C:\fastque-recovery\rotation\`:

| Moment | Inventory |
|---|---|
| Backup taken BEFORE deploy | `p1_expected_schema.json` (75 tables, 69 finished migrations) - unchanged |
| Post-deploy verification, #317 only | `p1_expected_schema.owner_transfer.json` (76 tables, 70 migrations, md5 `0e869134...`) |
| Post-deploy verification, #317 + #313 | `p1_expected_schema.owner_transfer_and_change_requests.json` (77 tables, 71 migrations, md5 `e5bb9245...`) |
| Post-deploy verification, #317 + #313 + #315 (Codex, Apple sign-in) | `p1_expected_schema.owner_transfer_change_requests_apple.json` (78 tables, 72 migrations, md5 `b0ec3438...`) - rehearsal only |

Validated on 27 Oct 2026: the production inventory matches a master-equivalent chain (guard self-test 14/15; its one failure
is only that the self-test derives the ledger from the checked-out branch, which has the extra migration), and
`p1_expected_schema.owner_transfer.json` reports MATCH against a chain built with this branch's migration while the
production inventory correctly rejects that same migrated chain. Run `validate_new_inventory.py` after any migration change.

Regenerate with the script in `C:\fastque-recovery\work\make_inventory_ot.py` if the migration set changes.

## 3. E-mail readiness (read-only, no secret printed)

Checked on 27 Oct 2026 for the production backend service (names and shapes only): `RESEND_API_KEY` present (36 chars,
`re_` prefix), `EMAIL_FROM_ADDRESS` present (display-name form on `mail.fastque.com`), `WEB_BASE_URL` present and **https**
but pointing at the Railway-generated web domain (`barbercueweb-production.up.railway.app`), `NODE_ENV=production`.

- [x] Sending domain: the provider dashboard reports `mail.fastque.com` VERIFIED with sending enabled, and
      `EMAIL_FROM_ADDRESS` is on that domain. (`fastque.com` itself is PARTIALLY_FAILED at the provider; it is not used for
      sending.) This does not prove that the production API key is bound to that domain or that a message is delivered.
- [x] Web destination: `https://fastque.com` (Let's Encrypt, valid to 30 Nov 2026) and the Railway domain both serve the
      app and proxy `/api/v1` to the same backend (checked 27 Oct). Neither serves `/accept-owner-invitation` yet - it exists
      only after this release is deployed. Decision rule: keep the current working HTTPS `WEB_BASE_URL` for the deploy; after
      the deploy, if `https://fastque.com/accept-owner-invitation` loads and its inspect call works, switching `WEB_BASE_URL`
      to `https://fastque.com` is an owner-approved config change (it also changes password-reset links).
- [ ] A real delivery test was done in an **isolated or staging** environment with a mailbox the team controls. Never send
      a test invitation to a real shop or owner. (Not done yet: no staging provider key is available.)
- [ ] Until the provider works, `POST .../invite` answers 503 and nothing changes (fail-closed).

## 4. Fresh backup (owner runs on their machine)

```bash
python -I C:/fastque-recovery/rotation/p1_backup.py --label p1-owner45e --clipboard
```

- [ ] Owner pastes the source connection string when prompted (it is read from the clipboard, never printed).
- [ ] Record: label, timestamp, encrypted size, SHA-256, public tables (expected 75), ledger records (expected 72).
- [ ] `python -I C:/fastque-recovery/rotation/neon_rotation.py verify --label p1-owner45e --stamp <stamp>` -> checksum,
      decryption + MDC integrity, plaintext hash, 75/75 table-of-contents entries, all PASS.

## 5. Disposable restore

- [ ] `python -I C:/fastque-recovery/rotation/local_restore.py p1-owner45e <stamp> fastque_rc26_<name>`
- [ ] `python -I C:/fastque-recovery/work/check_restored.py fastque_rc26_<name>`: 75 tables, inventory MATCH, 0 NOT VALID
      constraints, 0 invalid indexes, row counts recorded.
- [ ] **Migration rehearsal on the restored copy**: apply `20261027140000_owner_transfer_password_gate/migration.sql`, confirm
      the fingerprint, then `docs/owner-operations/owner-transfer-rollback.sql`, confirm it equals the pre-migration
      fingerprint, then re-apply. (Rehearsed on a master-equivalent schema on 27 Oct; repeat on the real restore.)
- [ ] Drop the disposable database.

## 6. Neon recovery branch (authorized MCP/console action, read-write compute not required)

- [ ] Create a branch from the production branch (`br-jolly-pond-azhohrz3`, project `crimson-field-96192935`), name
      `recovery-pre-owner-transfer-<date>`, `no_compute: true`; confirm state `ready`; record id and parent LSN.
- [ ] Confirm production database identity: project `crimson-field-96192935`, database `fastque_final_20261023`, 75 tables.
- [ ] Never run destructive SQL against production; the migration runs only through the pinned backend deploy.

## 7. Deploy (separate authorization)

- [ ] Record rollback targets: current backend and web deployment ids and SHAs (`railway api` deployments query).
- [ ] Pinned deploy of the release SHA to the **backend first** (`serviceInstanceDeployV2` with `commitSha`); its pre-deploy
      step runs the migration. Check the log shows exactly the expected number of migrations applied.
- [ ] Backend health 200, unauthenticated calls to the new endpoints return 401/400 (never 5xx).
- [ ] Pinned deploy to the **web** service; scan the live bundles for the new pages
      (`/accept-owner-invitation`, `/change-password-required`, "Owner transfers").
- [ ] Verify the sensitive-page headers on the live site: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
      `X-Robots-Tag: noindex`.
- [ ] Fast-forward master to the released SHA only after the live checks.
- [ ] Post-deploy data check against the backup: every pre-existing table has the same row count (new table empty);
      post-deploy inventory (section 2) MATCHES.

## 8. Executing the two ownership transfers (separate authorization, after section 7)

Per `OWNER_TRANSFER_RUNBOOK.md`: prepare, **independent** verification with identity AND authority evidence, send the
invitation, the recipient accepts. Do both shops in one window. Studio 25 Salons stays SUSPENDED.

## 9. Abort and rollback

- Any failed gate: stop; production is untouched until section 7.
- After section 7 but before any transfer: `owner-transfer-rollback.sql` on production is possible only with a separate
  authorization and the recovery branch as the fallback.
- After a transfer: reverse it with a new verified transfer; the recovery branch is the disaster fallback only.

## 10. GO / NO-GO criteria

**GO only if every line is true on the exact release SHA:**

1. Owner has authorized this migration release in writing, naming the SHA (and the combination with #313/#315, if any).
2. Exact-head CI is green on that SHA; master has not moved (or CI was re-run after merging it).
3. Fresh `p1-owner45e` backup: checksum, decryption, 75/75 tables verified; disposable restore matches the inventory; the
   migration, rollback and re-apply rehearsal passed on the restored copy; the disposable copy was dropped.
4. A new Neon recovery branch is `ready` and the database identity is confirmed.
5. A real e-mail delivery test succeeded in an isolated/staging environment with a designated test inbox: link received,
   accepted once, second use refused, expired link refused, cancelled link refused, resend invalidates the previous link.
6. Rollback targets (backend and web deployment ids) are recorded.
7. For any ownership transfer: the legally authorized people and their e-mail addresses are confirmed by the owner, and
   a second administrator (or the documented break-glass) will verify identity and authority. Studio 25 stays SUSPENDED.

**NO-GO (stop, change nothing) if any of:** CI red or SHA differs from the authorized one; backup or restore verification
fails; the inventory does not MATCH; the recovery branch is not ready; the e-mail delivery test is missing or failed; the
migration log shows an unexpected number of migrations; any live check after the backend deploy fails; or someone asks to
reset an existing owner's or customer's credentials, activate Studio 25, or send a test invitation to a real shop.

## 11. Evidence already gathered (all in isolated environments; nothing in production)

- Browser (web): new-account and existing-account acceptance, reused/cancelled/superseded links refused, sign-in, shop
  isolation, old shared account locked out; **administrator screen driven with synthetic administrators and isolated test
  TOTP secrets**: prepare, refusal of self-verification (server message shown), phone-only evidence refused, independent
  verification, send, expiry shown, resend with a required reason, cancel, completed transfer, status and audit history, no
  token or password visible.
- E-mail: wire-level tests of the provider request (link only in the body, never in a URL or log); delivery itself is
  captured by the development sender in the isolated stack. **No real delivery test was run** (no designated test inbox).
- Android: unit tests for the notice, the handoff and the session gate. A physical device (serial RZCT8100F9Z) was visible
  to adb at the start of the session and then disconnected; **no device evidence was captured and no physical or emulator
  certification is claimed**.
- Cross-PR: #317 + #313 (PR #321, rehearsal) and #317 + #313 + #315 (local scratch merge, discarded): only textual conflicts
  (keep-both in `schema.prisma`/`app.module.ts`; #315's `schema.prisma` has whole-file line-ending churn that makes git see
  every line as changed - its three real changes were re-applied by hand in the scratch merge); all migrations apply
  (77 tables), no drift, 42 e2e + 227 auth unit tests pass.
