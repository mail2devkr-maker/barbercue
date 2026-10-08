# FastQue Super Admin Security & Audit Control Center

## Status
**Draft implementation: requires real checkout validation, review, staging smoke tests and migration review before release.** No production data mutation or deployment is authorized by this branch.

## Recovery workflow implemented in draft
- The legacy `DELETE /api/v1/admin/shops/:id` route is now PLATFORM_ADMIN-only.
- A CO_FOUNDER can submit a reasoned request to `POST /api/v1/admin/shops/:salonId/deletion-requests`. This never deletes a shop.
- A PLATFORM_ADMIN (Super Admin) can view a deletion-approval inbox (requester email, shop name/public ID, timestamp, reason), reject with a reason, or approve using a fresh 6-digit authenticator code.
- Approval is an atomic transaction: lock the pending request and shop, verify current PLATFORM_ADMIN authorization, reject self-approval, recheck operational and financial obligations, then quarantine the shop and write durable audit events.
- Approval starts a 30-day recovery window. The shop row and its bookings, queue/history, payments, refunds, ledger rows, relationships, public ID, QR tokens and assets are retained; the shop is suspended and removed from public discovery. New operational writes are rejected while quarantined.
- Restore is available to PLATFORM_ADMIN with fresh TOTP strictly before `restoreEligibleUntil`. At the exact deadline and afterward the restore endpoint rejects the attempt; expired Trash remains read-only. There is no automatic purge or permanent-delete path.
- Restore clears only the quarantine fields and preserves the shop and its related records. A formerly ACTIVE shop returns to ACTIVE only if it remains approved and passes the existing activation-readiness checks; otherwise it returns as PENDING. A previously suspended shop stays suspended.
- Existing open bookings, active queue/service work, unsettled payments/refunds, and outstanding customer/platform ledger obligations prevent quarantine. The database repeats the obligation check in a deferred constraint trigger to close races; the approval transaction forces that named constraint before returning so a database rejection cannot be presented as success.
- Unique partial database index forbids simultaneous duplicate pending requests.
- All hard deletes are blocked by a database trigger, including legacy/direct service paths.
- Audit history with actor email, action, affected entity, time, filtered pagination and allowlisted/redacted details, visible only to PLATFORM_ADMIN.
- Secondary HTTP request activity audit for ADMIN-audience sessions, plus successful/failed admin login events, without request bodies, cookies, tokens, TOTP, credentials, headers or query values.
- Dashboard shows pending request count; approval inbox lives at `/dashboard/admin/security`.
- Existing role grants and employee lifecycle/password-reset domain audit events remain untouched.

## Critical limitations / non-goals
1. The 30-day window is a recovery period, not a scheduled purge promise. Expired rows remain quarantined and read-only; permanent deletion is deliberately disabled pending a separately approved retention/purge policy.
2. While quarantined, database guards reject mutations to operational and financial rows with `SHOP_QUARANTINED`. The current backend has no payment/refund settlement module. Any future settlement/refund/reconciliation integration must surface that rejection and must be designed to preserve provider events and retry/reconciliation evidence; do not treat the shop as safely quarantinable if a financial obligation is still open.
3. Only **already logged domain actions** have before/after business data. The generic request log records method, route, status, duration and actor, never input payloads. Auth-guard denials occurring before the interceptor and co-founder activities in non-ADMIN session audiences are not fully covered.
4. Super Admin sees pending requests **inside the portal** (counter/inbox). There is no new email/push delivery; outage escalation and notifications require separate design.
5. Audit trail currently uses existing `audit_logs` and is not cryptographically append-only or externally archived. Application/customer privacy workflows still modify certain historical audit records.
6. Production account provisioning was performed separately; no user-role, password or TOTP fields may be modified during this feature rollout.

## Pre-merge certification (mandatory)
Run against the exact target `master` and new Prisma Client:
- `npm ci --include=dev --workspaces --include-workspace-root`
- `npx prisma generate` and `npx prisma validate` using a nonproduction dummy `DATABASE_URL`
- focused admin, activity-interceptor, payment-obligation and recovery-boundary tests; all backend and shared tests; backend/web typecheck, lint & build; `git diff --check`
- on a disposable PostgreSQL database, apply both `20261008160000_add_shop_deletion_approvals` and `20261008180000_recoverable_shop_deletion`, record and compare Prisma migration checksums, inspect enabled triggers/constraints, and exercise quarantine/restore on fixtures. NEVER use production for a smoke test.
- collision tests: duplicate submissions, simultaneous approval/denial, reused TOTP, stale request, suspended/revoked accounts, non-global roles, requestor self-approval, shop now active/staffed, concurrent booking insert, one shop zero real activity, deleted shop foreign-key restrictions.
- manual authenticated role matrix: CO_FOUNDER sees Request approval; direct DELETE returns 403; PLATFORM_ADMIN inbox lists, approves/rejects and sees audit; HR_ADMIN/SALES_ADMIN/VIEWER/STAFF cannot request/approve. Existing HR/sales/admin features must regress cleanly.
- verify network/API responses expose no audit secrets and cannot page outside a PLATFORM_ADMIN session.
- UI check on mobile/tablet/desktop: input masking, accessibility, errors, pagination, loading, role-specific navigation.
- review authentication resilience and audit write behavior under DB outages; quantify audit retention/volume.

## Staging and rollback safety
1. Before any release, verify a recent provider backup and point-in-time recovery (PITR) coverage for the target database, retention horizon, and restore procedure. Perform a restore drill into a separate disposable database and verify row counts/relationships before relying on it. Do not run a PITR restore against the live database as a test.
2. Apply the additive migration to staging first, verify its recorded checksum, constraints, and enabled triggers, then verify health and safe read-only routes.
3. Run authenticated staging end-to-end tests only with disposable admin/test accounts and disposable shops. Do not use production shops or accounts; do not perform permanent deletion.
4. The migration adds nullable columns, indexes, a check constraint, and triggers; it does not delete existing rows. Treat schema rollback as **forward-only** after application writes use quarantine fields: rolling back app code alone is not a database rollback, and dropping columns/triggers can destroy recovery state or remove safety guards. Prefer a reviewed forward fix. If an emergency rollback is required, preserve the database and quarantine state, restore compatible app code, and use the verified backup/PITR procedure only on owner authorization.
5. During quarantine, the DB rejects writes to related operational/financial rows. Resolve open obligations before approval; future payment/refund integrations must explicitly handle this result and preserve retry/reconciliation evidence.

## Future high-end CRM milestones
- Event-sourced append-only immutable audit stream, offsite retention and GDPR/PII policy.
- Approval matrix for sensitive employee/role/security changes (two-person rule, SLA, escalations).
- Domain diff logging for CRM leads/visits/follow-ups and employee data with redacted before/after fields.
- Real-time in-app/email approval notifications, escalation and alerts.
- Secure dashboards with filters/export, tamper alerts, separation of duties, least privilege and periodic access reviews.
- Backups/PITR verification and audited restore drills.

**Do not describe this draft as production-ready until certification evidence exists.**
