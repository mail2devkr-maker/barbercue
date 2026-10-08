# FastQue Super Admin Security & Audit Control Center

## Status
**Draft implementation: requires real checkout validation, review, staging smoke tests and migration review before release.** No production data mutation or deployment is authorized by this branch.

## Requirements implemented in draft
- The legacy `DELETE /api/v1/admin/shops/:id` route is now PLATFORM_ADMIN-only.
- A CO_FOUNDER can submit a reasoned request to `POST /api/v1/admin/shops/:salonId/deletion-requests`. This never deletes a shop.
- A SUPER ADMIN can view a deletion-approval inbox (requester email, shop name/public ID, timestamp, reason), reject with a reason, or approve using a fresh 6-digit authenticator code.
- Approval is an atomic transaction: lock pending request, verify current PLATFORM_ADMIN authorization, reject self-approval, recheck shop real-activity constraints under a shop-row lock, hard-delete only if the shop remains safe, mark request approved and write durable audit events.
- Unique partial database index forbids simultaneous duplicate pending requests.
- All direct service deletion operations recheck activity counts under a DB row lock, preserving existing safeguards.
- Audit history with actor email, action, affected entity, time, filtered pagination and allowlisted/redacted details, visible only to PLATFORM_ADMIN.
- Secondary HTTP request activity audit for ADMIN-audience sessions, plus successful/failed admin login events, without request bodies, cookies, tokens, TOTP, credentials, headers or query values.
- Dashboard shows pending request count; approval inbox lives at `/dashboard/admin/security`.
- Existing role grants and employee lifecycle/password-reset domain audit events remain untouched.

## Critical limitations / non-goals
1. Approved empty shops are still **hard deleted**. There is **no one-click Restore** and no guarantee of backup recovery. A future separately reviewed soft-delete/restore architecture is required before promising recovery.
2. A **direct PLATFORM_ADMIN delete** remains possible on an otherwise empty shop; only CO_FOUNDER requests must receive approval. Consider requiring fresh TOTP on direct Super Admin deletions in a later security change.
3. Only **already logged domain actions** have before/after business data. The new generic request log records method, route, status, duration and actor, never input payloads. Auth-guard denials occurring before the interceptor and co-founder activities in non-ADMIN session audiences are not fully covered.
4. Super Admin sees pending requests **inside the portal** (counter/inbox). There is no new email/push delivery; outage escalation and notifications require separate design.
5. Audit trail currently uses existing `audit_logs` and is not cryptographically append-only or externally archived. Application/customer privacy workflows still modify certain historical audit records.
6. Production account provisioning was performed separately; no user-role, password or TOTP fields may be modified during this feature rollout.

## Pre-merge certification (mandatory)
Run against the exact target `master` and new Prisma Client:
- `npm ci --include=dev --workspaces --include-workspace-root`
- `npx prisma generate` and `npx prisma validate` using a nonproduction dummy `DATABASE_URL`
- focused admin & activity interceptor tests; all backend and shared tests; backend/web typecheck, lint & build; `git diff --check`
- disposable PostgreSQL migration apply and rollback/recovery rehearsal on fixtures, NEVER production for a smoke test.
- collision tests: duplicate submissions, simultaneous approval/denial, reused TOTP, stale request, suspended/revoked accounts, non-global roles, requestor self-approval, shop now active/staffed, concurrent booking insert, one shop zero real activity, deleted shop foreign-key restrictions.
- manual authenticated role matrix: CO_FOUNDER sees Request approval; direct DELETE returns 403; PLATFORM_ADMIN inbox lists, approves/rejects and sees audit; HR_ADMIN/SALES_ADMIN/VIEWER/STAFF cannot request/approve. Existing HR/sales/admin features must regress cleanly.
- verify network/API responses expose no audit secrets and cannot page outside a PLATFORM_ADMIN session.
- UI check on mobile/tablet/desktop: input masking, accessibility, errors, pagination, loading, role-specific navigation.
- review authentication resilience and audit write behavior under DB outages; quantify audit retention/volume.

## Staging rollout
1. Merge only after security review; migration deploys **before** app code while service is temporarily paused/rollout controlled.
2. Verify migration applied, all services healthy, and safe read-only URLs.
3. Run disposable test shop approval e2e (no real/customer shops), leave account/grants unchanged.
4. Confirm production requests and audit actor attribution; have rollback strategy for app code and forward-only DB migration.

## Future high-end CRM milestones
- Soft delete + 30-day restore via tombstone and quarantine, FK-safe recovery + integration tests.
- Event-sourced append-only immutable audit stream, offsite retention and GDPR/PII policy.
- Approval matrix for sensitive employee/role/security changes (two-person rule, SLA, escalations).
- Domain diff logging for CRM leads/visits/follow-ups and employee data with redacted before/after fields.
- Real-time in-app/email approval notifications, escalation and alerts.
- Secure dashboards with filters/export, tamper alerts, separation of duties, least privilege and periodic access reviews.
- Backups/PITR verification and audited restore drills.

**Do not describe this draft as production-ready until certification evidence exists.**
