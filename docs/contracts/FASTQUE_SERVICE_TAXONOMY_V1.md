# FastQue Service Category and Subcategory API v1

Status: backend implementation candidate; not production-deployed.

## Scope and compatibility

The existing service catalog already has a salon-scoped free-text `category`. This additive
extension adds an optional free-text `subcategory` to the same records. It does not introduce
global taxonomy IDs or rename/backfill category values, and does not change service price,
duration, booking snapshots, staff qualifications, or historical references. Existing clients may
ignore the additional response field; old rows and requests without it remain valid.

Category/subcategory values are owner-controlled display/filter labels, not access-control keys or
canonical classifications. `subcategory` is trimmed, limited to 60 characters, and may be cleared
with `null` on update. Empty/whitespace-only values are rejected.

## Endpoints

Existing authenticated routes remain the contract:

- `GET /api/v1/dashboard/salons/:salonId/services`
- `POST /api/v1/dashboard/salons/:salonId/services`
- `PATCH /api/v1/dashboard/salons/:salonId/services/:serviceId`
- Public salon profile `GET /api/v1/salons/:countryCode/:citySlug/:salonSlug`

The dashboard routes require the existing owner-or-authorized-platform-admin salon access check.
Updates scope the service by both `serviceId` and `salonId`. Public profile returns the field only
for already-published active services under an active salon, as it does for current service data.

## Request and response

Create accepts the existing fields plus:

```json
{
  "name": "Balayage",
  "price": 1200,
  "durationMinutes": 90,
  "category": "Hair",
  "subcategory": "Coloring"
}
```

Owner catalog and public profile service objects include `subcategory: string | null`. `null`
means no subcategory was recorded. A partial update may send `"subcategory": null` to clear it.
Reviewed CSV/XLSX catalog imports accept a `Subcategory`/`Sub-category` column; optional OCR output
may carry subcategory only when explicitly present in the source. No values are inferred.

## Migration

`20261019120000_service_subcategories` adds one nullable `TEXT` column with no default, rewrite,
index, or foreign key. It is metadata-only on PostgreSQL, although the `ALTER TABLE` still needs a
brief table lock. Apply through the normal migration gate after a disposable populated-database
rehearsal. The migration is additive and must not be rolled back by dropping the column after
application versions have begun writing it; application rollback is safe because older code
ignores unknown columns.

## Error and business behavior

The current service error contract is unchanged. Invalid field length or an empty supplied
subcategory is rejected by the shared request schema. Salon authorization and existing duplicate
service identity rules remain unchanged. No separate variant price or duration behavior is
introduced by this contract.
