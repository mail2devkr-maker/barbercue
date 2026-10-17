# Owner Demo Workspace API v1 (requirements #22 and #23)

This is an owner-only private synthetic workspace. No synthetic rows are inserted into `salons`,
`users`, `salon_staff`, `chairs`, `services`, `bookings`, `queue_entries`, `invoices`,
`invoice_payments`, `customer_ledger_entries`, review, notification, or provider tables. The
workspace is absent from public discovery and all existing operational/reporting queries.

## Capability gate

`GET /api/v1/dashboard/salons/{salonId}/capabilities` returns the shared feature map expected by
the owner dashboard. It verifies the caller's current salon-scoped `SALON_OWNER` membership, not
just a role claim in a bearer token. Unknown/unimplemented features return `UNCONFIGURED` and are
not represented as available. Demo routes are unavailable unless
`OWNER_DEMO_WORKSPACE_ENABLED=true`; the variable defaults to disabled. When explicitly enabled,
`demoData` reports `SANDBOX`, because all figures are synthetic projections. No provider or paid
service is used.

## Routes

Every route requires the existing authenticated STAFF-audience session with current
`SALON_OWNER` membership for the exact `salonId`. Customer, staff-only, cross-salon, and stale-role
requests are denied. The owner membership and salon row are locked/rechecked in the database
transaction for workspace reads and mutations.

| Method   | Path                                                               | Behavior                                                                                                                                       |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/dashboard/salons/{salonId}/demo/status`                   | Return active state, exact workspace ID, synthetic label, and bounded counts.                                                                  |
| `POST`   | `/api/v1/dashboard/salons/{salonId}/demo/import`                   | Requires a UUID `Idempotency-Key`; creates one bounded payload atomically or safely returns the existing active workspace summary.             |
| `POST`   | `/api/v1/dashboard/salons/{salonId}/demo/delete-preview`           | Return a five-minute HMAC-signed confirmation token bound to actor, salon and current workspace. No state changes.                             |
| `DELETE` | `/api/v1/dashboard/salons/{salonId}/demo`                          | Requires exact workspace ID, exact typed confirmation phrase, and the unexpired preview token. Deletes only that private payload.              |
| `GET`    | `/api/v1/dashboard/salons/{salonId}/demo/workspaces/{workspaceId}` | Read the synthetic payload only when the caller owns the exact salon and the workspace belongs to it. Intended for a future demo-view surface. |

Delete request:

```json
{
  "workspaceId": "<the active workspace UUID>",
  "confirmation": "DELETE DEMO DATA",
  "confirmationToken": "<the short-lived signed preview token>"
}
```

The shared Zod schema rejects missing, extra, malformed, stale, expired, or cross-actor properties.
The signing key is domain-separated from the existing access-token secret; the secret and token
are never returned by the capabilities API or written to logs. A replay after deletion is a safe
no-op, and a token for a former workspace cannot delete a newly imported workspace.

## Response contract

Status and import responses use the frontend DTO shape:

```json
{
  "active": true,
  "workspaceId": "<uuid>",
  "label": "DEMO DATA — Not real business records",
  "counts": {
    "customers": 12,
    "staff": 4,
    "chairs": 4,
    "services": 8,
    "visits": 36,
    "bookings": 15,
    "invoices": 9,
    "reviews": 5
  }
}
```

When empty, `active` is `false`, `workspaceId` and `counts` are `null`. The workspace read DTO
returns `workspaceId`, `salonId`, the same label, and the bounded dataset. Generated amounts are
integer currency minor units, explicitly simulated projections—not recorded revenue or payments.
No payment rows, settlements, refunds or ledger entries are generated. Sample contacts use
`.invalid` emails and no phone numbers. Booking examples do not link to sample Live Queue visits.

The payload is bounded to 256 KiB and contains 36 visits, 15 bookings, 12 synthetic customers,
4 staff/chairs, 8 services, sample invoice states and review cards, and daily/weekly/monthly
projection series. Every synthetic ID is namespaced under a generated workspace ID.

## Storage, idempotency and audit

`owner_demo_workspaces` has one unique row per real salon and only stores the isolated JSONB
read-model payload. A row lock on the real salon serializes creation/deletion; role membership is
rechecked and held through the operation. Import and its immutable audit record are one transaction.
The import request key is stored only as SHA-256 with a normalized request hash; replay returns the
same active workspace, key reuse for a different request conflicts, and replay after the workspace
was deleted cannot recreate it. A new key permits an intentional re-import.

The audit table contains actor/shop/workspace IDs, event type, counts and import idempotency hashes
only. It has PostgreSQL UPDATE/DELETE/TRUNCATE guards and no parent foreign keys, so deleting the
payload or later deleting the shop/account does not mutate historical audit events. DELETE never
selects by shop/customer name, dates, user-supplied IDs other than the server-issued workspace ID,
or a shared operational relationship.

## Errors and activation

- `401`: absent or invalid session.
- `403 SALON_ACCESS_DENIED`: caller lacks current owner membership for this exact salon.
- `404 FEATURE_UNAVAILABLE`: the deployment flag is disabled; or `DEMO_WORKSPACE_NOT_FOUND` for a
  workspace no longer owned by this salon.
- `400`: malformed idempotency key or confirmation body/token.
- `409 IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_RESULT_EXPIRED`, or `DEMO_WORKSPACE_CHANGED`: caller
  must issue a new key or review current workspace state.
- `503 DEMO_DELETE_CONFIRMATION_UNAVAILABLE`: existing signing configuration is unavailable;
  deletion fails closed.

The current owner-web PR #234 implements the capability-gated import/status/delete controls and
confirmation UX but explicitly does not yet render the full payload in dashboard views. The
backend read route is ready for that separate UI integration. No production flag change, migration,
provider action, or seed operation is authorized by this document.
