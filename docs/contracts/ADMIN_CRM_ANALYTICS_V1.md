# FastQue Platform CRM Analytics API v1

This contract adds read-only platform field-sales analytics on top of the existing employee CRM.
It does not change the employee-facing CRM routes or their existing role matrix.

## Authorization and data handling

- All endpoints require an authenticated `ADMIN` session with the stored `PLATFORM_ADMIN` role.
- No salon-owner, employee, or customer session can read these platform-wide records.
- Analytics responses contain internal employee ID/code and territory only; they omit employee names,
  account emails, phone numbers, lead contact details, addresses, and notes.
- Lead/visit/follow-up pages reuse the existing CRM DTOs, including their contact fields, and therefore
  are restricted to `PLATFORM_ADMIN` only.
- Responses are `Cache-Control: private, no-store`.
- No writes, exports, SMS, email, payment, or external-provider calls are part of this API.

## Date and pagination semantics

- Date filters are ISO-8601 UTC instants with a mandatory exclusive `to` boundary when used in the
  analytics endpoint. All intervals are `[from, to)`.
- Analytics requires `from` and `to`, with `from < to` and a maximum span of 366 days.
- Page `from` and `to` filters are optional and use the same exclusive-upper-bound semantics; if both
  are supplied, the span is limited to 366 days.
- Page `limit` defaults to 50 and must be between 1 and 100.
- Page responses are `{ items, nextCursor, limit }`. Ordering is stable and keyset-based:
  leads by immutable `createdAt DESC, id DESC`; visits by `visitedAt DESC, id DESC`; follow-ups by
  `dueAt ASC, id ASC`.
- Cursors are opaque HMAC-signed tokens bound to the endpoint, authenticated actor, and normalized
  filters. A changed filter, actor, endpoint, invalid signature, or malformed cursor returns
  `ADMIN_CURSOR_INVALID`. If the server signing secret is unavailable, a page requiring a cursor
  returns `ADMIN_CURSOR_UNAVAILABLE` rather than an unsigned cursor.

## `GET /api/v1/admin/crm/analytics`

Required query: `from`, `to`; optional `employeeId` narrows all counts and groups to that employee.

Example:

```http
GET /api/v1/admin/crm/analytics?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-20T00%3A00%3A00.000Z
```

Response:

```json
{
  "from": "2026-10-01T00:00:00.000Z",
  "to": "2026-10-20T00:00:00.000Z",
  "generatedAt": "2026-10-19T12:00:00.000Z",
  "totals": {
    "leadsCreated": 12,
    "onboardedFromPeriodLeads": 4,
    "leadsOnboardedInPeriod": 3,
    "visits": 28,
    "followUpsCompleted": 17,
    "openFollowUpsOverdueInPeriod": 2
  },
  "employees": [
    {
      "employeeId": "b2b5df36-f837-4d9e-9866-cddbf064626e",
      "employeeCode": "FQ-FE-00101",
      "territory": "Patna",
      "status": "ACTIVE",
      "leadsCreated": 3,
      "onboardedFromPeriodLeads": 1,
      "leadsOnboardedInPeriod": 1,
      "visits": 7,
      "followUpsCompleted": 4,
      "openFollowUpsOverdueInPeriod": 0,
      "conversionPercent": 33.3
    }
  ],
  "territories": []
}
```

Metric definitions:

- `leadsCreated`: leads whose `createdAt` falls in the requested interval.
- `onboardedFromPeriodLeads`: leads created in the interval whose current status is `ONBOARDED`.
  `conversionPercent` is this count divided by `leadsCreated`; it is a current-state cohort measure,
  not a point-in-time historical conversion rate.
- `leadsOnboardedInPeriod`: currently onboarded leads whose `onboardedAt` falls in the interval.
- `visits`: CRM visits whose `visitedAt` falls in the interval.
- `followUpsCompleted`: completed follow-ups whose `completedAt` falls in the interval.
- `openFollowUpsOverdueInPeriod`: follow-ups currently `OPEN` whose `dueAt` falls in the interval
  and is earlier than `generatedAt`.
- Territory aggregates sum the same metrics and expose the employee count; an absent territory is
  returned as `null`.

All aggregates are queried in one repeatable-read database transaction. No contact-level CRM fields
are loaded into the analytics response.

## Cursor-paged CRM detail routes

These additions do not alter the existing array routes (`/admin/crm/leads`, `/visits`,
`/follow-ups`) or their existing access rules and response shape. They provide a platform-admin-only
way to page beyond the existing 500-row cap.

### `GET /api/v1/admin/crm/leads/page`

Filters: `employeeId` (UUID), `status`, `source`, `q`, `from`, `to`, `limit`, `cursor`.
`from`/`to` filter `createdAt`; `q` searches shop name, city, and locality.

### `GET /api/v1/admin/crm/visits/page`

Filters: `employeeId` (UUID), `outcome`, `q`, `from`, `to`, `limit`, `cursor`.
`from`/`to` filter `visitedAt`; `q` searches visit or linked-lead shop name.

### `GET /api/v1/admin/crm/follow-ups/page`

Filters: `employeeId` (UUID), `status`, `channel`, `q`, `from`, `to`, `limit`, `cursor`.
`from`/`to` filter `dueAt`; `q` searches linked-lead shop name.

Example page response:

```json
{
  "items": [],
  "nextCursor": null,
  "limit": 50
}
```

## Stable errors

- `VALIDATION_ERROR` (400): malformed, invalid, reversed, or overly broad page filters.
- `ADMIN_DATE_RANGE_TOO_LARGE` (400): analytics date span exceeds 366 days.
- `ADMIN_CURSOR_INVALID` (400): cursor is malformed, tampered, actor-bound, or filter-bound mismatch.
- `ADMIN_CURSOR_UNAVAILABLE` (503): cursor signing cannot be safely performed because the server
  signing secret is missing or too short.
- Authentication and authorization failures retain the existing `401` / `403` API error contract.

## Database and compatibility

- This change has no Prisma model or migration change.
- Existing indexes on `(employeeProfileId, createdAt/status)`, `(employeeProfileId, visitedAt)`, and
  `(employeeProfileId, status, dueAt)` support the primary filters; no unmeasured index is added.
- Existing CRM array routes remain unchanged for existing admin clients.
- No Android API shape changes are made.
