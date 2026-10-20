# FastQue Owner Location Decision Read — API V1

`GET /api/v1/dashboard/salons/:salonId/location` requires an authenticated owner or
platform-admin session plus the existing server-side authorization for that exact salon. The
response continues to include the current coordinates, their verification state, and any pending
proposal. It now also returns:

```json
{
  "lastDecision": {
    "status": "APPROVED",
    "reviewNote": "Verified against the submitted address evidence.",
    "reviewedAt": "2026-10-20T10:15:00.000Z"
  }
}
```

`lastDecision` is either the latest salon-scoped `APPROVED` or `REJECTED` proposal by
`reviewedAt DESC, id DESC`, or `null` when no such decision exists. `SUPERSEDED` proposals are not
admin decisions and are excluded. Reviewer identity and internal audit metadata are never returned.
The read does not update public coordinates or change the existing approval workflow. A caller
without access to the salon receives the existing authorization denial; no cross-salon decision or
note is disclosed.

This is a backward-compatible additive response field. No schema or migration change is required.
