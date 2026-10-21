# FastQue maintenance mode v1

This backend-only, opt-in safeguard is disabled unless `FASTQUE_MAINTENANCE_MODE=true` is present when the backend process starts. It does not enable itself on a schedule. `FASTQUE_MAINTENANCE_MESSAGE` is optional plain text (maximum 500 characters); the backend returns a generic scheduled-maintenance notice when the flag is enabled without a custom message.

`GET /api/v1/maintenance/status` is public, returns `{ "enabled": boolean, "message": string | null }`, and sends `Cache-Control: no-store`. It contains no shop, customer, booking, or database details.

When enabled, the global HTTP guard rejects every method other than `GET`, `HEAD`, and `OPTIONS` with HTTP 503 and error code `MAINTENANCE_MODE`. A Prisma middleware independently rejects model writes and all raw SQL operations (raw SQL can hide a data-changing CTE). Deadline-driven booking, queue, reminder, and notification sweeps are not registered; the queue auto-assignment trigger is inert. Graceful backend shutdown waits for already-running deadline jobs to finish.

The flag is captured at process startup. Changing it requires a controlled backend deployment/restart on **every** replica; this PR does not provide a live toggle endpoint. Do not treat one replica's status response as proof that all old instances have drained. Before a database cutover, verify every backend replica runs the maintenance-enabled revision and confirm active requests, separate workers, cron services, retry queues, and other database clients are drained. The source production database remains authoritative until a separate, explicit cutover approval.

The Prisma application middleware does **not** guard the Railway pre-deploy Prisma CLI process, migrations run by other services, direct SQL clients, or writes outside this backend. Before a deployment during the freeze, independently verify the pre-deploy command's exact database target and that it has no pending migration; do not point it at an unverified target. This feature has no schema or data migration and is not production-activated by its PR.

Suggested operational sequence (not an authorization to execute it):

1. Announce the approved maintenance window and verify the notice is live.
2. Confirm current source and target identities, fresh recovery point, restore rehearsal, compatible schema, and a hashed integrity baseline.
3. Deploy the already-reviewed backend revision with maintenance enabled while it still targets the source DB; verify all replicas, public status, 503 behavior, and that writers/workers have drained.
4. Keep the maintenance flag enabled during final synchronization and consistency checks. Ensure exactly one database remains authoritative; do not allow old clients or retries to write to either target.
5. Obtain the separate final owner GO, update both Railway runtime and direct migration connection targets using the reviewed procedure, and verify the backend uses only the target. The target must preserve the source schema; candidate feature migrations are out of scope.
6. Verify API health, authentication, read paths, booking/queue/payment invariants, and legacy Android behavior before disabling the flag with a controlled deployment.
7. Preserve the source project intact for rollback. After writes resume on the target, an application rollback alone is not a database rollback; any return to the source requires a forward synchronization and a new explicit cutover plan.

Production use remains NO-GO until the target project is independently verified, both Railway database targets are confirmed without exposing values, a fresh recoverable source copy and isolated restore are proven, all writers are inventoried/drained, and the owner gives final cutover approval.
