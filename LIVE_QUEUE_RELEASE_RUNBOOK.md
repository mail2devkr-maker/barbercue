# Unified Live Queue history: release and recovery gates

This is a **plan, not authorization** to migrate or deploy. PR #187 must remain Draft until the owner approves a controlled release. No production records should be rewritten to manufacture Bookings: standalone Live Queue visits remain in `queue_entries`.

## Compatibility finding

The pre-feature backend's `DashboardReviewsService.toOwnerDto` dereferences `review.booking.customer` unconditionally. A valid new Live Queue review has `bookingId = NULL`; that old backend cannot safely serve owner reviews after the first such write. The migration is additive for existing booking reviews, but it is **not** a promise that every old application binary can read future review data. Never roll back to a pre-queue-review backend once queue reviews exist. Do not remove queue reviews or invent Bookings as a workaround.

The disposable PostgreSQL certification runs guarded HTTP reads/writes after creating a nullable-booking queue review, including owner review listing and response, customer edit, public rating aggregation, and the original booking history. This proves the PR backend's compatible read path; it does not prove a production redeployment or certify a pre-feature binary.

## Pre-release gates

1. Independently verify the Railway backend's **runtime** `DATABASE_URL` and `DIRECT_DATABASE_URL` target against the owner-designated Neon project `muddy-paper-72512632`, production `main` branch, and `neondb` database. Compare non-secret endpoint identity in approved provider interfaces; do not paste URLs, credentials, or customer records into CI or issues. Migration and runtime targets must match. OAuth variable-name visibility alone is insufficient.
2. Verify a current, restorable production backup, retention, and PITR window in the actual database provider. Perform an owner-approved restore to an isolated secure target and validate schema plus representative counts before calling recovery tested. A successful disposable-CI database drill is not a production-provider restore drill.
3. Confirm the exact committed migration checksum against the release artifact, inspect its nullable FK, uniqueness, XOR check, review trigger, and history indexes, and rehearse the migration against a fresh PostgreSQL 17 database. Establish a maintenance window and DB monitoring for migration locks and errors.
4. In read-only production diagnostics, confirm the intended Handsome Center salon has 11 standalone queue entries for 11 October 2026 IST (8 `COMPLETED`, 3 `EXPIRED`, all `bookingId IS NULL`) and record counts only. Do not change those rows or claim that synthetic CI fixtures are production proof.
5. Verify the revised web/mobile **All visit history** sections request the backend's globally ordered `source=all` cursor and render Online Booking and Live Queue records together. The separate Online Booking management/actions list is intentionally retained for existing appointment controls; do not mistake that operational list for a second history API or count its cards as duplicate source records.

## Controlled rollout after explicit approval

1. Pin reviewed source SHAs; prevent accidental master-triggered auto-deploy while the release is coordinated. Capture current backend/web deployments and a tested compatible backend artifact.
2. Verify the backup/PITR gates above. Apply the reviewed additive migration with the verified direct migration connection. Confirm checksum, constraint/trigger status, indexes, and no failed Prisma migration record. Abort before application rollout on any discrepancy.
3. Deploy the queue-review-aware backend; verify health, authenticated owner-review listing, both visit-history endpoints, and legacy online-booking/review paths. Do **not** enable a customer-facing queue-review UI while any active backend replica remains pre-feature. Drain old replicas first.
4. Deploy the reviewed website. Publish Android code only through its separate authorized release process. Older clients remain booking-only and must continue to work.
5. Read-only verify the Handsome Center counts and owner Bookings UI; use only a consenting synthetic/approved account to exercise new review writes. Monitor owner-review 5xx, history-read errors, migrations, and review conflicts. Do not use real customer data for test mutations.

## Failure handling

- **Before any queue-review row exists:** application rollback to the previous backend may be considered only after confirming zero `reviews.bookingId IS NULL` rows, normal legacy review reads, and the exact schema compatibility of the rollback artifact. Keep the additive migration/data; do not run a destructive reverse migration.
- **After the first queue-review row:** pre-feature backend rollback is prohibited. Roll **forward** to the pinned queue-review-aware backend artifact (or an independently tested compatible hotfix). Keep the additive schema and all source records. Verify owner review listing, response, public rating, and legacy booking review afterward. If no compatible artifact is healthy, contain the incident by disabling customer-facing review submission at the edge/UI under an approved operational change; do not drop/rewrite reviews or disable database guards.
- If the database migration or provider fails, stop writes through the affected rollout path, diagnose from backups and migration logs, and require explicit owner approval before any restore. A production restore or PITR operation is never an automatic rollback step.

## Evidence boundaries

The GitHub Actions PostgreSQL fixture is synthetic and disposable. It can certify schema behavior and authenticated guarded HTTP application behavior, not Railway runtime DB identity, Neon backup/PITR retention, a provider restore, OTA uptake, or the actual production Handsome Center records.
