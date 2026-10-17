# FastQue 30-Requirement Backend API Contract (v1 proposal)

**Status:** Contract-first proposal for review. This document is the API source of truth for coordinated backend/shared and frontend/mobile implementation after review. It does not itself certify or activate product behavior.

**Repository:** `mail2devkr-maker/barbercue`
**Contract base:** `master` at `92c288a6f4c1c5abc4b8b7db9364fac4e0a886bd` (verified from GitHub on 2026-10-17).
**Backend owner:** Codex — `apps/backend/**`, `apps/backend/prisma/**`, `packages/shared/**`, workflows and API contracts.
**Client owner:** Claude — `apps/web/**`, `apps/mobile/**`.
**Production:** No production database, provider, secret, Railway, deployment, or live-record changes are authorized by this contract.

## Contract rules

### Transport, authorization, and compatibility

- API root is `/api/v1`; JSON errors retain the existing `{ "error": { "code", "message", "details?" } }` envelope. Existing route names and response shapes remain backward-compatible. New behavior is additive or versioned; do not repurpose an existing field with a different meaning.
- Authenticated calls use the existing bearer access-token/session model. Web refresh remains the existing HttpOnly-cookie flow. Clients never choose their own user ID, salon membership, role, financial authority, verified identity, or provider outcome.
- Salon routes resolve a current salon-scoped `UserRole`/canonical owner authorization on the server for every request. A role in a stale JWT alone is insufficient. Staff-only actions also verify live staff membership, active status, and qualifications as applicable. Cross-customer, cross-salon, cross-employee, and cross-demo-workspace access is denied before sensitive reads.
- Public endpoints return public data only. Admin operations require the existing platform-admin audience/guard. Finance-sensitive operations require the specific server-side permission defined by the feature and audited actor attribution.
- State-changing business operations use the existing `Idempotency-Key` convention where replay could create duplicate bookings, payments, invitations, imports, stock movements, consultations, or provider work. The server binds an idempotency key to caller, route, and normalized request hash. Reuse with a different request returns `IDEMPOTENCY_KEY_REUSED`; an in-flight duplicate returns/replays the original outcome and does not repeat side effects.
- Unbounded lists use stable cursor pagination: `limit` is bounded (default 25, maximum 100), `cursor` is opaque and tied to the filter/order tuple, and ordering always has a unique ID tiebreaker. A changed filter cannot reuse a cursor (`CURSOR_FILTER_MISMATCH`).
- Timestamps are RFC 3339 UTC instants. Date-only report filters use `YYYY-MM-DD` in the salon's configured IANA timezone; `from` and `to` are inclusive local calendar days, implemented as `[startOf(from), startOf(dayAfter(to)))` UTC instants. Responses include the resolved timezone. Missing/invalid timezone fails validation rather than silently using the server timezone.
- Money crosses JSON as decimal strings plus ISO currency, never binary floating point. Aggregates distinguish estimates, invoice amounts, captured/recorded collections, refunds, and net collections. Zero activity is represented as zero, not omitted or null.
- Inputs are validated server-side with shared Zod schemas where appropriate; database relationships and uniqueness constraints remain the final concurrency authority. Validation does not replace ownership checks or database constraints.
- Mutations create immutable audit events in the same transaction as the state change. Audit entries include actor, action, entity, timestamp, request/idempotency correlation, and minimal before/after identifiers. They must not contain OTPs, raw tokens, API keys, full provider payloads, or unnecessary personal data.

### Error code baseline

Keep existing codes where already defined. New stable codes include: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `IDEMPOTENCY_KEY_REUSED` (409), `RATE_LIMITED` (429), `FEATURE_DISABLED` (404 or 409 according to established route policy), `PROVIDER_NOT_CONFIGURED` (503), `PROVIDER_TIMEOUT` (504), `PROVIDER_REJECTED` (502), and `INTERNAL_ERROR` (500). Responses do not disclose whether a private user, phone, invitation, or provider credential exists.

### Feature switches and external providers

- New unfinished capabilities are disabled by default per deployment and may additionally be gated per salon/owner. A disabled feature returns a stable feature-unavailable error and performs no provider I/O.
- Provider adapters expose typed outcomes (`accepted`, `confirmed`, `rejected`, `unknown`) and timeouts. Only provider-confirmed results are described as delivered, paid, refunded, imported, or published. Ambiguous timeouts are not automatically retried unless the provider supports a stable idempotency key.
- No secrets are returned by capability/readiness endpoints. Missing or partial production configuration fails closed. Mock/sandbox adapters are allowed only in isolated test environments; production never silently falls back to a mock or console success.
- Live SMS, email campaign, AI, social-network, calling, subscription billing, payment, refund, mailbox provisioning, or other chargeable work remains disabled until its provider contract, spend limits, credentials, compliance approvals, and owner activation are independently reviewed.

## Shared contract DTOs

These are API-level shapes; their Zod schemas and TypeScript exports are introduced in the corresponding feature PRs, not by silently changing current clients in this documentation PR.

```ts
type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

type Money = { amount: string; currency: string };

type DateRangeFilter = {
  from: string;          // YYYY-MM-DD, salon-local inclusive day
  to: string;            // YYYY-MM-DD, salon-local inclusive day
  timezone?: string;     // if absent, use verified salon timezone
  source?: BookingSourceFilter;
};

type BookingSourceFilter =
  | 'FASTQUE_WEB' | 'FASTQUE_APP' | 'WALK_IN' | 'IN_SHOP'
  | 'FACEBOOK' | 'INSTAGRAM' | 'CHATGPT' | 'OTHER' | 'UNKNOWN';

type AuditStamp = {
  id: string;
  actorUserId: string | null;
  action: string;
  createdAt: string;
};
```

Example financial aggregate:

```json
{
  "salonId": "uuid",
  "currency": "INR",
  "timezone": "Asia/Kolkata",
  "range": { "from": "2026-10-01", "to": "2026-10-31" },
  "totals": {
    "completedVisits": 0,
    "estimatedServiceValue": "0.00",
    "invoiced": "0.00",
    "recordedCollections": "0.00",
    "discounts": "0.00",
    "refunds": "0.00",
    "netRecordedCollections": "0.00"
  },
  "buckets": [],
  "asOf": "2026-10-17T00:00:00.000Z"
}
```

## Endpoint contracts by requirement

`Existing` means present on the verified contract-base source; `Extend` means preserve the existing endpoint and add compatible filters/fields; `Proposed` means new backend work. The named endpoints are canonical candidates and must be reconciled with existing route constants before implementation; clients must not invent alternate paths.

| ID | Requirement | Contract endpoints / behavior | Authorization and data rules | Status on base SHA |
|---|---|---|---|---|
| 1 | Revenue overview and custom period | `GET /dashboard/salons/:salonId/revenue/report?from&to&groupBy&source`. Returns salon-local periods, completed-service estimates, invoice and discount values, recorded collections, refunds, and net recorded collections separately. See Draft PR #226 and `docs/contracts/FASTQUE_REVENUE_REPORT_V1.md` for the implemented response semantics. | Owner/authorized staff with finance-read scope; salon-local date window. | Partial existing overview/revenue routes; this aggregate contract is not complete. |
| 2 | Daily, weekly, monthly aggregation | Same report endpoint with `groupBy=day\|week\|month`; week starts Monday in salon-local calendar. Empty periods return zero buckets. The implementation returns `periods` with the requested aggregation. | Same scope; bucket boundaries convert to UTC only after local calendar calculation. | Partial existing analytics; exact accounting aggregation needs implementation/certification. |
| 3 | Booking acquisition attribution | Existing booking create input remains compatible. `GET /dashboard/salons/:salonId/booking-attribution` filters by source/campaign. Only server-known surface or verified signed referral evidence sets a non-UNKNOWN source. | Owner/authorized analyst; do not infer social/chat sources from referrer text, user claims, or unsupported heuristics. Historical rows are not backfilled without evidence. | `BookingSource` exists; evidence capture/filtering is incomplete. |
| 4 | Financial breakdown and safe export | `GET .../revenue/report` returns `byService`, `byStaff`, and privacy-minimized `byCustomer` breakdowns under the same validated date/group/source filter; `GET .../revenue/report.csv` uses that same query contract. No XLSX endpoint is claimed. | Finance-read scope; customer grouping is PII-minimized; CSV formula-leading `= + - @ tab CR` cells are escaped, UTF-8 output, bounded range/row count. | Existing dashboard analytics/invoices; unified export and reconciled financial definitions incomplete. |
| 5 | Customer CRM and visit history | Extend `GET /dashboard/salons/:salonId/customers` with search/status/cursor; `GET .../customers/:customerId/history`. | Owner/staff permitted by live salon scope; guests remain unmerged unless verified identity link exists; expose only salon-relevant history. | Customer list/detail exist; visit/revenue summary completeness needs verification. |
| 6 | External reviews | Proposed provider-neutral `GET/POST /dashboard/salons/:salonId/external-reviews/sync` and `GET .../external-reviews`; sync is disabled until provider approval. | Salon owner/admin; retain source, external review ID, verification evidence, and sync timestamp; never fabricate reviews or response status. | No verified external-review connector on base. |
| 7 | Service catalog, variants, qualifications | Extend salon-scoped service CRUD/import APIs; add `variants[]` and staff qualification reads/writes only where schema supports it. | Owner/service-manager; catalog import remains compatible; historical booking price/service snapshots are immutable. | Core service/catalog/staff qualification APIs exist; variants scope not complete. |
| 8 | Inventory | Proposed `/dashboard/salons/:salonId/inventory/{products,categories,stock-movements,reports}`; purchase, consumption and adjustment use typed movement DTOs. | Owner/inventory role; atomic transaction and row/advisory lock; reject negative stock unless a separately approved policy exists; every movement audited. | No database-backed inventory domain identified on base. |
| 9 | Activation photo requirements | `GET /api/v1/dashboard/salons/:salonId/photo-readiness`; existing `PATCH /api/v1/dashboard/salons/:salonId/status` controls activation. | Salon owner or PLATFORM_ADMIN; only first `PENDING -> ACTIVE` requires 3 distinct normalized HTTPS/no-userinfo photo URLs; returns `409 SHOP_PHOTOS_REQUIRED` with `required`, `current`, `ready`, `grandfathered`, and `reasons[]`. Legacy ACTIVE/SUSPENDED rows with NULL marker are grandfathered; legacy PENDING rows are not; new registration writes FALSE. Uploaded JPEG/PNG/WebP is decoded/re-encoded with metadata stripped; third-party linked URLs are not fetched or sanitized, and EXIF is never used as location proof. | Implemented in open Draft PR #237 at exact head `55c95d85461cf7808bcf2496755c8b26a2de34e5`; exact-head disposable PostgreSQL migration/authenticated E2E workflow passed (run 39028165535). No production migration/deployment has occurred. |
| 10 | AI shop-description adapter | Proposed `POST /dashboard/salons/:salonId/description/suggestions`; response is a non-persisted draft until owner confirms via ordinary profile update. | Owner only; feature and provider disabled by default; manual edit always available; strict input/output limits and provider spend caps; no generated claim is auto-published. | AI image/style adapter exists but not description generation. |
| 11 | Offers authoring | Proposed owner-scoped `GET/POST/PATCH /dashboard/salons/:salonId/offers`; immutable revisions after publication. | Owner; validate schedule, use limits, scope and eligibility server-side; no automatic payment mutation. | Promo credit foundation exists; a general offer domain is incomplete. |
| 12 | Verified shop coordinates | `GET/PATCH /dashboard/salons/:salonId/location`; `GET /admin/location-verifications?cursor&limit`; `POST /admin/location-verifications/:proposalId/decision`. Owner submissions create a private proposal; the published `Salon.lat/lng` changes only after a different global PLATFORM_ADMIN approves. Decision requires a 3–500 character audit note. | Current salon owner submits GPS/MAP_PIN/MANUAL source (source is not proof); only an active global PLATFORM_ADMIN reviews; submitter cannot self-review; stable cursor queue; proposals retain approval/rejection/supersede history while the salon exists. No EXIF, geocoding provider or external location proof is trusted. | Implemented candidate in open Draft PR #241 at `83d168c96ada3e6478b9af451ecc7dbd1d8b4cce`; local shared 434/434, admin authorization 6/6, schema/typecheck/build pass. Focused disposable PostgreSQL 17.11 migration + authenticated E2E CI is queued; no production migration/deployment. |
| 13 | Contact import and invitation eligibility | Proposed `POST /dashboard/salons/:salonId/contacts/preview` and `POST .../contacts/invitations`; preview never stores/sends. | Owner; consent/provenance required, minimize and encrypt contact data, dedupe within tenant, suppress opted-out/unverified contacts. Real sends remain disabled pending approval. | No safe contact-list import pipeline identified. |
| 14 | Public links and sharing | Existing public salon URL/profile remains canonical; proposed `GET /salons/:salonId/share-links` returns stable public URLs and safe share metadata. | Publicly shareable fields only; no private IDs, tracking secrets, customer data or account tokens in URL. | Public salon/profile routes exist; share DTO not formalized. |
| 15 | Owner data and customer booking assistants | Proposed `POST /assistant/owner/query` and `POST /assistant/customer/booking-intents`; assistants return suggestions/intents, not direct mutations. | Owner query uses only authorized tenant data; customer intents require explicit confirmation and then invoke normal booking validation; provider disabled by default; redact PII and enforce per-user caps. | No general assistant endpoints; existing style advisor is separate. |
| 16 | Promotions/campaigns | Proposed `GET/POST/PATCH /dashboard/salons/:salonId/campaigns`; campaign eligibility references versioned offers and deterministic rules. | Owner; campaign publication is a separately gated state transition; no provider send occurs as a side effect of creating/editing a campaign. | Related promo-credit primitives exist, not a campaign product. |
| 17 | Financial truth, refunds and reconciliations | Include refunds, partial payments, cancellation/no-show ledger obligations, discounts and true recorded payment records in requirements #1/#2/#4 reports; add `GET .../reports/reconciliation` only after accounting definitions are approved. | Finance-read; existing append-only financial ledger remains authoritative; never infer a payment from a completed service, invoice, QR display or provider intent. | Draft PR #226 (`cfb4052521b91806c3db5767f40872e5edb72b7d`) reports only the append-only shop-recorded invoice payment/refund ledger, separates estimated and invoiced value, and retains ledger events for void invoices. External provider settlement reconciliation remains unimplemented and requires a verified provider-to-invoice link. |
| 18 | Salon subscription lifecycle | Proposed `GET /dashboard/salons/:salonId/subscription`, `GET /subscription/plans`, and provider-neutral checkout/webhook contracts. Status changes only after verified provider/webhook event with replay protection. | Owner view; billing mutations require owner and provider verification; sandbox/mock only until approval; plans/entitlements never silently restrict existing shops. | B2B subscription fields/plans are mostly inert; live recurring billing is not implemented/certified. |
| 19 | Authorized social-photo import | Proposed `POST /dashboard/salons/:salonId/photo-imports` creates a provider import job, then `GET .../photo-imports/:id`; publish still uses photo approval flow. | Owner; supported OAuth/API connectors only; no credential scraping; disabled without platform approval; imported media retains provenance and rights metadata. | Photo storage exists; social connectors absent. |
| 20 | Consultation bookings and sessions | Proposed `GET/POST /consultations`, `POST /consultations/:id/{confirm,cancel}`, and session access records; optional payment hooks remain normal payment intents. | Customer/owner scoped to participants; explicit consent for call/chat data; no recording by default; access expires; no real call/payment without provider approval. | No consultation domain found on base. |
| 21 | Owner email and mailbox provisioning | Reuse, do not duplicate, the verified email-mapping/invitation capability from Draft PR #195 only after review/integration. Any mailbox endpoint must distinguish alias/forwarding from hosted mailbox and remain a disabled provider adapter. | Super Admin plus verified account ownership; explicit audited transfer; no automatic paid mailbox creation. | Reusable work exists in open Draft PR #195, not on base. |
| 22 | Demo workspace import/status | `GET /dashboard/salons/:salonId/demo/status`; `POST /dashboard/salons/:salonId/demo/import` with `Idempotency-Key`; returns workspace ID, bounded record counts, and unmistakable synthetic label. | Owner only; private, separate demo workspace linked to owner/shop, at most one active import; no real-table operational mixing, public visibility or live providers. | Issue #219 approved; only a localhost CLI seeder exists; no owner API. |
| 23 | Reversible demo deletion | `DELETE /dashboard/salons/:salonId/demo` with explicit confirmation token/body; deletes only the server-owned demo workspace by immutable workspace identity. | Owner rechecked transactionally; bounded atomic cleanup, repeat-safe; refuses if foreign/real references exist; never disables append-only financial guards. Demo financial projections stay separate from real invoice/payment ledgers. | Issue #219 approved; no owner API; financial safe-delete design is a prerequisite. |
| 24 | Deal discovery and redemption eligibility | Proposed public `GET /deals?salonId&date` and authenticated `POST /deals/:id/eligibility`; actual redemption is attached to normal booking/payment transaction and returns a validated discount snapshot. | Public discovery only for published offers; eligibility is rechecked server-side at commit; one-use limits are atomic; no client-trusted price reduction. | Promo credit primitives exist; deal discovery/redemption incomplete. |
| 25 | Independent professional profiles and booking | Proposed public `GET /professionals`, `GET /professionals/:publicId`, `GET .../availability`; `POST /professional-bookings`. | Professional controls own profile; public responses are reviewed fields only; booking checks availability and does not assume salon authorization; no release without full tenant and payment boundary tests. | Salon staff/professional verification exists; independent marketplace model not identified. |
| 26 | Customer phone OTP | Preserve existing `POST /auth/otp/request` and `/auth/otp/verify`. Six-digit OTP is purpose-bound, short-lived, atomically consumed once, replay-safe, bounded attempts and throttled; response always creates CUSTOMER audience only. | Current OTP implementation and app contracts remain canonical; new SMS ceilings/timeouts are in Draft PR #214 and are not duplicated here. | Customer OTP exists on base; production delivery is not certified. |
| 27 | Bulk chair operations | Proposed `POST /dashboard/salons/:salonId/chairs/bulk-deactivate/preview` and `/apply` with expected-version and explicit IDs. | Owner/admin; preview reports active service/booking/occupancy conflicts; apply rechecks atomically and returns per-chair `deactivated\|conflict\|not_found`; never deletes referenced history. | Single-chair create/update/deactivate exists; bulk API absent. |
| 28 | Employee-authorized field operations | Extend existing `/employee/leads`, `/employee/visits`, `/employee/follow-ups` with owned-lead-only photos/chair/visit evidence/status and review workflow endpoints as gaps are confirmed. | FIELD_EXECUTIVE sees only assigned leads; managers/admin use existing CRM roles; evidence writes are audited and immutable where legally relevant. | Employee CRM/voice visit log implementations exist on open Draft PR #196; verify integration state before extending. |
| 29 | Platform employee/lead analytics | Extend existing `GET /admin/crm/overview`, `/leads`, `/visits`, `/follow-ups` with filtered cursor pages and employee performance aggregates. | PLATFORM_ADMIN only; aggregate by employee/territory, minimize contact PII, audit exports. | Admin CRM and analytics exist; identified as likely partial, requiring coverage review. |
| 30 | Shop-owner phone login/linking | Preserve customer OTP and use the separate owner-authentication contract in Draft PR #214; owner audience is issued only after verified phone identity AND live owner-role plus canonical `Salon.ownerUserId` authorization. Authenticated account linking requires purpose-bound OTP and session rotation/revocation. | No public salon contact-number matching, account auto-merge or CUSTOMER-to-OWNER audience escalation. | No owner-phone implementation on current base; Draft PR #214 contains the candidate implementation and provider limits. |
## Example request/response contracts

### Revenue report

```http
GET /api/v1/dashboard/salons/{salonId}/reports/revenue?from=2026-10-01&to=2026-10-07&bucket=day&source=FASTQUE_WEB
Authorization: Bearer <access-token>
```

Each service/staff/customer row contains `completedVisits`, `estimatedServiceValue`, `discounts`, `invoiced`, `recordedCollections`, `refunds`, and `netRecordedCollections` as `Money`; it does not equate service completion or invoice issuance with money collection. The same report filter schema is used by CSV export.

### Booking acquisition attribution

The existing persisted `Booking.source` enum remains APP, WEB, WALK_IN, and IN_SHOP for backward compatibility. The reporting projection maps those values to FASTQUE_APP, FASTQUE_WEB, WALK_IN, and IN_SHOP respectively. External channels are never accepted as a client-selected source.

Owners or platform admins manage salon-scoped campaigns:
- `POST /dashboard/salons/:salonId/booking-attribution/campaigns` creates a campaign for FACEBOOK, INSTAGRAM, CHATGPT, or OTHER with a bounded display label and optional active window. The server generates a high-entropy opaque token; only a SHA-256 token hash is stored. The clear token is returned only in the creation response so the authorized owner can add it to a campaign URL.
- `GET /dashboard/salons/:salonId/booking-attribution/campaigns` lists safe campaign metadata and aggregate usage without tokens or customer PII.
- `POST /dashboard/salons/:salonId/booking-attribution/campaigns/:campaignId/revoke` revokes a token without deleting attribution history.
- Existing `POST /bookings` accepts an optional opaque `attributionToken`. The backend matches its hash to an active campaign for the same salon at booking creation and records the campaign relation. Invalid, expired, revoked, or wrong-salon tokens are ignored for attribution; they do not block a valid booking or change its operational source.
- Owner booking history gains an optional validated `source` filter and the shared revenue report uses the same source vocabulary. Revenue source filtering applies to booking, queue-linked invoice, and payment/refund rows through the exact source-linked record; it does not duplicate estimates or collections.
- `GET /dashboard/salons/:salonId/booking-attribution?from&to&source` returns salon-local booking counts by projected source and campaign with no customer-identifying fields.

Campaign assignment is evidence of a campaign-link click, not proof that a customer came from the social platform itself. It must be described as campaign attribution, not verified platform identity. Direct APP/WEB values preserve the existing source capture behavior; the backend does not infer an external source from referrer text, campaign label, user-agent, or client-supplied source. Historical source columns are not rewritten. Legacy rows with no campaign use only the source already stored on the booking; unsupported values map to UNKNOWN. Item-level lists are bounded; aggregate output is bounded by salon/date filters.

### Demo status/import

```json
// GET .../demo/status
{ "active": false, "workspaceId": null, "label": "DEMO DATA — Not real business records" }

// POST .../demo/import, Idempotency-Key: UUID
{ "active": true, "workspaceId": "opaque-id", "label": "DEMO DATA — Not real business records",
  "counts": { "customers": 0, "staff": 0, "services": 0, "visits": 0, "bookings": 0 } }
```

The exact synthetic counts are returned by a deterministic preview/configured fixture and bounded by server policy; they are not accepted from the caller. No actual invoice-payment ledger rows, external notifications, payment/refund requests, or public booking records are generated.

### Bulk chair preview/apply

```http
POST /api/v1/dashboard/salons/{salonId}/chairs/bulk-deactivate/preview
{ "chairIds": ["uuid"] }

POST /api/v1/dashboard/salons/{salonId}/chairs/bulk-deactivate/apply
{ "items": [{ "chairId": "uuid", "expectedUpdatedAt": "2026-10-17T09:30:00.000Z" }] }
```

Preview returns per-chair `READY`, `CONFLICT`, or `NOT_FOUND`, an exact `expectedUpdatedAt` version for found chairs, and conflict reasons. Apply requires the caller to send the version for each selected chair; a stateful preview token is unnecessary because the server re-authorizes and rechecks every condition. Apply serializes with queue assignment/manual occupancy on the same per-chair PostgreSQL advisory lock, takes row locks in stable ID order, rechecks active service sessions, active manual occupancies, legacy unstarted queue assignments and the row version, then changes eligible rows to `INACTIVE` and writes per-chair audit records in one atomic transaction. PostgreSQL default READ COMMITTED is intentional: after waiting for the advisory/row locks, the apply statements see the preceding commit and return a conflict instead of raising a stale-snapshot serialization error. Occupied/conflicting chairs remain unchanged; any database error rolls back the whole batch, and serialization aborts never return false success. No chair is permanently deleted. Client-side confirmation is a UX requirement, not an authorization boundary.

## Pagination and filtering semantics

- Report queries reject `from > to`, dates outside the supported retention window, unknown sources, invalid IANA timezones, and unbounded exports. Any owner-selected export limit is explicit and audited.
- Customer/history, inventory, offers, review, consultation, employee CRM, and audit lists use `CursorPage<T>`. The cursor is signed/opaque and encodes a deterministic `(createdAt,id)` or feature-specific stable tuple.
- Demo data is never included in production reports, real customer history, public discovery, exports, global admin live totals, reminder sweeps, or provider sends. Demo APIs always operate on a distinct workspace identifier.

## Audit, idempotency, and isolation invariants

1. Every read is scoped to an authorized tenant before returning data; every write rechecks authorization inside or immediately adjacent to the transaction that commits it.
2. Unique indexes and foreign keys protect ownership, one-active-demo-per-salon, one invitation/refund/redemption per supported idempotency tuple, and inventory invariants under concurrency.
3. Financial source records remain immutable/append-only as currently protected. Demo financial examples use a separate simulation projection and cannot hit invoice payment triggers.
4. Provider adapters receive only the minimum payload needed. Logs record a correlation ID, provider class, duration, and outcome category—not credentials, OTPs, phone numbers, message bodies, full prompts, personal contact lists, or provider payloads.
5. Retries after unknown provider outcome are blocked or use provider-supported idempotency. The API does not claim delivery/settlement on acceptance alone.
6. Account linking requires proof of control of the destination identity and preserves existing authentication identities; matching by phone/name/public contact alone is never ownership proof.

## Implementation and certification sequencing

1. **Contract review (this PR):** resolve endpoint naming and field semantics with Claude against current UI work. No schema or runtime behavior changes.
2. **Security foundation:** audit auth/RBAC, existing customer/employee/owner models, provider interfaces, idempotency, audit and feature flags. Integrate pending PR #214/#195 only through separate reviewed integration work; do not duplicate or alter their branches.
3. **Revenue/reporting + attribution:** confirm financial source-of-truth definitions, add filters/aggregation/export and source evidence; test against disposable PostgreSQL including refund/partial-payment/no-show/cancellation cases.
4. **Customer, services and chairs:** extend existing APIs; preserve booking/catalog compatibility and add tenant/concurrency regression tests.
5. **Inventory, consultations, professional marketplace and campaign domains:** additive migrations only; integration tests on disposable PostgreSQL; provider calls disabled.
6. **Private demo workspace:** design isolated workspace and demo-only finance projection before schema changes. Prove full import-delete-reimport, concurrency, real-record fingerprint preservation, and zero external calls on disposable PostgreSQL.
7. **Employee CRM and integrations:** extend the existing permission model, not a new auth system. Mock provider adapters; external live gates remain disabled pending owner approval.
8. **Certification:** Prisma validate/generate, full migration-chain disposable PostgreSQL E2E, authorization/concurrency/negative tests, shared/backend tests, typecheck/lint/build and exact-head GitHub CI. Production migration/deploy/runtime and physical-device certification remain separate gates.

## Current-master inventory and exclusions

- Verified current master: `92c288a6f4c1c5abc4b8b7db9364fac4e0a886bd`; GitHub commit status contexts for backend, web and mobile are green. This is source/CI evidence, not hosted application certification for proposed features.
- Current master already contains customer OTP, salons/bookings/queue/payments/invoices, owner analytics/operations, services/staff/chairs, employee CRM, photo uploads, verification, reviews, admin CRM, and a disabled-by-default style-advisor provider abstraction. New work must extend these sources rather than create parallel systems.
- Draft PR #214 (`codex/issue-211-phone-otp`, current PR head `a64f6d8082b26d4b504a746d8ea5f2196d10cddb`) contains owner phone OTP, secure account linking and global/per-country SMS attempt ceilings/timeout tests. It remains unmerged; use it as a reviewed dependency and do not recreate its OTP design here.
- Draft PR #195 (`dd564a9cd6124fa0ea24ee5df2d9535f07669fb2`) contains audited owner email mapping/invitations; it remains unmerged and is not a hosted mailbox provisioning system.
- Draft PR #187 (unified visit history), #196 (employee voice visits), and #206 (Android 1.0.7) remain separate work. This contract branch does not edit their code or change their state.
- Issue #219's local demo seeder is not the requested owner-facing demo feature. Any owner-facing demo implementation must use a private workspace and isolated simulated finance; do not seed the live salon's real operational records.

## Review-candidate implementation status

The following implementation is certified only on an open Draft PR and is not yet part of master or a production runtime. The broader API contract remains a proposal for the unfinished requirements.

| Requirement | Candidate SHA | Evidence / remaining scope |
|---|---|---|
| 1 | `cfb4052521b91806c3db5767f40872e5edb72b7d` (Draft PR #226) | Salon-scoped revenue report, local date filters and estimates/invoice/cash separation; client integration and hosted runtime remain unverified. |
| 2 | `cfb4052521b91806c3db5767f40872e5edb72b7d` (Draft PR #226) | Day/week/month report buckets; no production runtime claim. |
| 4 | `cfb4052521b91806c3db5767f40872e5edb72b7d` (Draft PR #226) | Service/staff/customer breakdowns and formula-safe CSV; XLSX is not implemented. |
| 17 | `cfb4052521b91806c3db5767f40872e5edb72b7d` (Draft PR #226, partial) | Shop-recorded invoice ledger and refund presentation covered; provider settlement reconciliation, unmatched external records and a finance-approved accounting close remain open. |
| 3 | `codex/fastque-platform-30-booking-attribution-revenue` (isolated branch based on Draft PR #226) | Opaque salon campaign tokens for FACEBOOK/INSTAGRAM/CHATGPT/OTHER; additive attribution relation; server-derived source filters in owner booking history and the same revenue report. Existing booking source enum remains unchanged. Exact-head certification pending. |
| 27 | `204fcd18637ad7aac346f11916d53c2402c56c00` (Draft PR #229) | Salon-scoped bulk chair deactivation preview/apply; PostgreSQL HTTP E2E exposed advisory-lock `void` deserialization and stale Serializable snapshots after lock waits. Corrected using `$executeRaw` and default READ COMMITTED with advisory + row locks; exact-head CI PASS on 2026-10-17: [Owner Operations Certification](https://github.com/mail2devkr-maker/barbercue/actions/runs/39014980223) and [Service Catalog Import Certification](https://github.com/mail2devkr-maker/barbercue/actions/runs/39014980207). No chair is permanently deleted. |
| 9 | `4625c5e2c19f44724f296f24b638500aca31d296` (Draft PR #237) | Additive nullable grandfather marker, first-activation 3-photo gate, owner/admin readiness DTO, server-side upload re-encoding/metadata stripping, and authenticated disposable-Postgres E2E. Focused local tests/typechecks passed; exact-head CI remains pending. Remote linked-photo reachability/content and malware scanning are not verified. |
| 3, 5–16, 18–26, 28–30 | Pending | No completion is claimed by the current candidates; dependencies and external activation gates remain as described above. |

This contract and PR #226 authorize isolated development and disposable certification only. Production data, migration, secrets, provider delivery/spend, Railway changes, deployments, mobile OTA, and physical-device certification remain outside scope.
