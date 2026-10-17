# FastQue new-shop photo activation contract — v1

Status: implemented on backend branch `codex/fastque-platform-30-capabilities`; Draft PR pending exact-head CI. This addendum is specific to requirement #9 and does not claim production activation or remote image-content verification.

## Readiness endpoint

`GET /api/v1/dashboard/salons/{salonId}/photo-readiness`

Authentication is required. Route roles are `SALON_OWNER` and `PLATFORM_ADMIN`; the service rechecks owner membership or the global platform-admin role for the selected salon. Staff and customers are denied, and an owner cannot read another owner's checklist.

Response:

```json
{
  "required": 3,
  "current": 2,
  "ready": false,
  "grandfathered": false,
  "reasons": ["THREE_VALID_PHOTOS_REQUIRED"]
}
```

`current` counts distinct normalized origin/path values from stored photo URLs that pass the existing `salonPhotoUrlSchema` HTTPS/no-userinfo check. Search/query and fragment components are ignored for duplicate detection. The backend does not fetch third-party URLs, so this is syntactic URL readiness, not proof that a remote image is reachable or decodes as an image. Uploaded images continue to use the existing signature-checked upload path.

## Activation behavior

- A new `PENDING -> ACTIVE` transition by an owner or platform admin requires three distinct valid URLs, in addition to existing active-service/chair/staff readiness.
- Failure returns HTTP 409 `SHOP_PHOTOS_REQUIRED` and includes `required` and `current` (plus readiness metadata) in `error.details`. No status mutation occurs.
- Service/chair/staff readiness, photo count, and status update are checked in a PostgreSQL `SERIALIZABLE` transaction. A serialization race fails closed with HTTP 409 `SALON_ACTIVATION_REQUIREMENTS_CHANGED` so the owner can refresh the current checklist.
- A successful first activation stores `shopPhotoRequirementGrandfathered = true`.
- Existing ACTIVE or SUSPENDED shops with the new nullable marker still NULL are grandfathered. New registrations explicitly start FALSE, and a successful first activation stores TRUE. Pre-existing PENDING shops remain subject to first-activation readiness because they were not yet open. Existing SUSPENDED shops can reopen without a new-photo gate and become marked true; the migration does not backfill legacy rows.
- An active shop is not automatically suspended if photos are later removed; the requirement is an activation gate, not a recurring content policy.

## Database and rollback

Migration `20261017090000_salon_photo_activation_requirement` adds one nullable Boolean column with no default and no row backfill. NULL preserves a deterministic legacy marker and avoids rewriting existing salon rows. The prior backend ignores the additive column, so application rollback does not require destructive schema rollback. Keep the column and any TRUE values on application rollback; do not drop it or rewrite salon state.

## Idempotency, providers and audit

The endpoint is read-only. Activation uses the existing status route and its existing owner/admin lifecycle controls; no new provider call, external fetch, notification, or paid service is invoked. Existing admin lifecycle audit events are retained. Owner self-activation continues to use the existing status behavior. No synthetic photo records are created by the application.
