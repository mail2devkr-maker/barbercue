# FastQue Salon-Scoped Service Taxonomy API v1

Status: backend candidate; production deployment is not authorized by this contract.
Requirement: Issue #221, requirement #7.

## Compatibility and ownership

Each salon owns its own category tree. IDs are stable database IDs scoped by `salonId`; they are
not global taxonomic classifications. Existing `Service.category` and `Service.subcategory` text
remain the compatibility values. Existing rows are backfilled to IDs only when they have
non-empty labels; the migration does not rewrite text or alter booking, queue, invoice, review,
or other historical records. Services without a category remain valid with nullable IDs.

Old clients may continue sending free-text labels. New clients may use IDs. The server accepts IDs
only when they belong to the requested salon and when any accompanying text agrees with the
canonical node. A subcategory must belong to the selected category. Cross-salon or inconsistent
IDs return `400 SERVICE_TAXONOMY_INVALID`. Standard salon authorization still applies before reads
or writes; a customer or unrelated owner cannot read another salon's taxonomy.

## Manage the canonical tree

`GET /api/v1/dashboard/salons/:salonId/service-categories`

Requires the existing owner or authorized platform-admin salon access check. The response is
deterministically ordered by display name then ID:

```json
[
  {
    "id": "<salon-category-id>",
    "name": "Hair",
    "subcategories": [
      { "id": "<salon-subcategory-id>", "name": "Cut" }
    ]
  }
]
```

Tree reads are salon-scoped and include unused nodes so the owner can build a catalog before
assigning services. Nodes are managed through the following owner-authorized routes; every write
is transactionally audited with actor and salon IDs:

- `POST /api/v1/dashboard/salons/:salonId/service-categories` `{ "name": "Hair" }` creates or
  returns the existing normalized category (case/outer-space insensitive), preserving its ID.
- `PATCH /api/v1/dashboard/salons/:salonId/service-categories/:categoryId` renames a category
  without changing its ID. It updates legacy text on currently linked services in the same
  transaction; booking/service history snapshots are never rewritten.
- `DELETE /api/v1/dashboard/salons/:salonId/service-categories/:categoryId` deletes only an empty
  category. It returns `409 SERVICE_TAXONOMY_IN_USE` when child categories or services remain.
- `POST /api/v1/dashboard/salons/:salonId/service-categories/:categoryId/subcategories`
  `{ "name": "Cut" }` creates or returns a normalized child within that salon/category.
- `PATCH /api/v1/dashboard/salons/:salonId/service-categories/:categoryId/subcategories/:subcategoryId`
  renames a child without changing its ID and updates the linked services' compatibility text;
  snapshots remain unchanged.
- `DELETE /api/v1/dashboard/salons/:salonId/service-categories/:categoryId/subcategories/:subcategoryId`
  deletes only an unreferenced child; linked services return `409 SERVICE_TAXONOMY_IN_USE`.

Category and child IDs cannot be used across salons or across category parents. Database composite
foreign keys enforce the same boundary even if application validation regresses. New nodes are
also created transactionally when a service is created, updated, or imported with a reviewed
free-text label. Duplicate normalized labels within the same parent converge through unique
constraints/upsert; labels in different salons remain independent.

## Service contracts

Existing routes remain:

- `GET /api/v1/dashboard/salons/:salonId/services`
- `POST /api/v1/dashboard/salons/:salonId/services`
- `PATCH /api/v1/dashboard/salons/:salonId/services/:serviceId`
- Public salon profile: `GET /api/v1/salons/:countryCode/:citySlug/:salonSlug`

Create/update accept the legacy `category` and `subcategory` fields and optional stable IDs:

```json
{
  "name": "Balayage",
  "price": 1200,
  "durationMinutes": 90,
  "categoryId": "<salon-category-id>",
  "subcategoryId": "<salon-subcategory-id>"
}
```

Supplying IDs does not require duplicating their labels in the request. If a label is supplied with
an ID it must match that node after trimming and case-folding. `subcategoryId` requires a category
ID on create; on update it must resolve under the resulting category. Moving a service to a new
category without an explicit compatible subcategory clears the previous child link and text rather
than silently reassigning it. Setting an ID to `null` unlinks it while preserving explicitly
provided legacy text. Setting the corresponding text to `null` clears both text and ID.

Owner service DTOs and public active-service DTOs include nullable `categoryId` and `subcategoryId`
in addition to the existing category labels. Existing response fields and price semantics do not
change. Public profiles expose these IDs only for the same active/published services they already
return.

Reviewed CSV/XLSX catalog import remains transactional and unchanged for existing clients. Labels
accepted in a reviewed row create/reuse canonical salon-scoped nodes and persist both IDs and the
original reviewed text. OCR/AI does not infer labels that were absent from the source.

## Database migration and rollback

`20261019130000_service_category_tree` adds the category and subcategory tables, nullable service
references, salon/parent-scoped uniqueness, indexes and composite foreign keys. Its data backfill
uses trimmed, case-insensitive labels to converge equivalent spellings, while retaining each
service's original text exactly. No booking/history records are copied or rewritten. `RESTRICT`
foreign keys prevent deleting taxonomy nodes still referenced by historical or active services.

The migration is additive. Application rollback is safe because prior backend versions ignore the
new tables and columns. Do not reverse the migration by dropping schema or rewriting service labels
after an application version has written taxonomy IDs. Validate on a fresh and populated disposable
PostgreSQL database before any production migration; no production migration is authorized here.

## Stable errors

- `SERVICE_TAXONOMY_INVALID` — ID is absent, belongs to another salon/parent, or conflicts with
  accompanying label text.
- `SERVICE_TAXONOMY_NOT_FOUND` — category or subcategory is not in the requested salon/tree.
- `SERVICE_TAXONOMY_IN_USE` — delete was refused because services or children still reference the
  node; response details identify observed linked service/child counts when available.
- `SERVICE_TAXONOMY_NAME_CONFLICT` — a concurrent rename collided with another normalized name.
- Existing `SALON_ACCESS_DENIED` and service validation errors retain their existing behavior.
