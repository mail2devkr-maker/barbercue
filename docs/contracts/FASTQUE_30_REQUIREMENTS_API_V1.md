# FastQue 30-requirement API contract (v1)

Status: integration contract for Issue #221, based on the non-production PR #273 candidate (`ef146246c36bfc9474763c80bcde35a58e0009fc`) on 2026-10-21. That SHA is the exact integrated source baseline for routes marked implemented in the candidate; it is not a production-release SHA. This document is an API coordination contract, not evidence that every listed feature is implemented, enabled, or production-ready. The status column is authoritative for the candidate baseline; route proposals marked `PROPOSED` must not be called until their backend implementation has its own reviewed source SHA, exact-head CI, and the required capability is enabled.

## Common rules

- API prefix is `/api/v1`. Existing route names and DTOs remain backward-compatible; new fields are additive. Do not rename persisted enums or change legacy route response shapes to implement these contracts.
- Salon dashboard routes require an authenticated STAFF-audience session and server-side salon membership authorization. Owner-only operations require `SALON_OWNER` (or a specifically documented `PLATFORM_ADMIN` path). Never trust a client-supplied salon, customer, employee, price, payment, status, or role as authorization evidence.
- Public discovery routes return only public, active data. Customer records are scoped to the authenticated customer or salon; guest/contact-only visits are never identity-matched from a name or phone alone.
- Money is a JSON number in the salon currency, accompanied by `currency`. Actual collections/refunds are recorded ledger events; estimates are explicitly named and never added to collected totals.
- Instants are ISO-8601 UTC. Calendar filters are interpreted in the salon IANA timezone and responses identify that timezone. Lists are bounded, use stable sort plus a unique tie-breaker, and return `nextCursor` where pagination is supported.
- Errors use `{ "error": { "code": "STABLE_CODE", "message": "...", "details": {} } }`. Callers branch on `code`, not translated message text.
- If a response can contain demo data, each row includes `isDemo`; real totals and public discovery exclude demo workspaces. Demo mode never sends SMS/email/push, charges/refunds money, or invokes external providers.
- `GET /api/v1/dashboard/salons/:salonId/capabilities` is the UI source for feature state and returns `{ features: Record<CapabilityKey, { status, reasonCode, updatedAt }> }`. States are `ENABLED`, `SANDBOX`, `DISABLED`, or `UNCONFIGURED`; a visible page is not proof that a provider is configured. Provider-backed features fail closed. The capability is availability metadata, not authorization.
- Create/confirm operations with external retry risk accept an idempotency key. Financial writes remain server-authoritative and preserve append-only ledger triggers.

## Canonical feature contracts

| # | Requirement | Contract / route family | Candidate status |
|---:|---|---|---|
| 1 | Revenue reporting | `GET /dashboard/salons/:salonId/revenue/report` with required `from` and `to` (inclusive salon-local dates), `groupBy=day/week/month`, optional existing `source=APP/WEB/WALK_IN/IN_SHOP`. Response includes period, service, staff, and account-linked customer breakdowns and separates recorded collections/refunds from estimates. Guest identity is never inferred. | Implemented in candidate; production not verified. See `FASTQUE_REVENUE_REPORT_V1.md`. |
| 2 | Daily/weekly/monthly summaries | Same report route; `groupBy` selects period granularity, buckets are salon-local and weeks start Monday. The server converts inclusive local date boundaries safely. | Implemented in candidate; production not verified. |
| 3 | Booking attribution | Owner routes under `/dashboard/salons/:salonId/booking-attribution`; source is operational `BookingSource`, campaign attribution is separate verified evidence. Never infer social/referral attribution without evidence. | Implemented in candidate; production not verified. |
| 4 | Customer-wise revenue | Revenue report `byCustomer` breakdown includes only source-linked account customers; actual collection totals include only recorded finance events. `groupBy` is period granularity, not the dimension selector. | Implemented in candidate; production not verified. |
| 5 | Customer CRM | `GET /dashboard/salons/:salonId/customers/directory` supports bounded `q`, `segment=new/repeat/frequent`, `sort=lastVisit/totalSpent/visits`, `minVisits`, `limit<=50`, and signed `cursor`. The legacy offset-based `GET .../customers` is unchanged. `GET .../customers/:customerId/services` returns this salon's service history. `totalSpent` is net recorded collections; names are explicitly null until canonical identity exists; guest rows remain unlinked. | Implemented in candidate; trustworthy canonical names/guest identity remain partial. See `FASTQUE_CUSTOMER_CRM_DIRECTORY_V1.md` and `FASTQUE_CUSTOMER_CRM_HISTORY_V1.md`. |
| 6 | External reviews | `GET /dashboard/salons/:salonId/reviews?source&cursor&limit` lists FastQue reviews; `GET/PUT .../review-profiles` reads and updates verified HTTPS profile links; `PUT .../reviews/:reviewId/response` records the salon response. External ingestion is a separate provider integration and must not merge identities across sources. | Link-only implementation; external ingestion unconfigured. See `EXTERNAL_REVIEW_PROFILES_V1.md`. |
| 7 | Service category tree | `GET/POST /dashboard/salons/:salonId/service-categories`; salon-scoped category/subcategory IDs on additive service create/update DTOs. Legacy free-text categories and imported service history remain supported. | Implemented in candidate; production migration not verified. See `FASTQUE_SERVICE_TAXONOMY_V1.md`. |
| 8 | Inventory | Owner routes under `/dashboard/salons/:salonId/inventory` for categories, products, movements, purchases, adjustments, low stock, valuation and reports. Balance is derived from movements; updates are atomic and cross-salon IDs are rejected. | Implemented in candidate; production migration and stock reconciliation not verified. |
| 9 | Shop photo activation | `GET /dashboard/salons/:salonId/photo-readiness`; `PATCH .../status` remains the activation route and returns `409 SHOP_PHOTOS_REQUIRED` with `{ required, current }` for new shops below the minimum. Previously active legacy shops are grandfathered. | Implemented in candidate; production cohort behavior not verified. See `FASTQUE_PHOTO_ACTIVATION_V1.md`. |
| 10 | AI shop description | `POST /dashboard/salons/:salonId/description/suggestions` accepts `{ language, tone, ownerAttestedHighlights[] }`; the backend loads salon/catalog facts and returns an owner-reviewed draft only, never persisting it. The currently bound provider is intentionally unconfigured and fails closed. | Fail-closed adapter only; provider is unconfigured. |
| 11 | Offers | Owner routes under `/dashboard/salons/:salonId/offers` for draft, preview, publish/pause, stats and expiry. Server revalidates service scope, audience, dates, redemption caps and price at booking time. | Implemented in candidate; production commercial flow not verified. See `FASTQUE_OFFERS_PROMOTIONS_DAILY_DEALS_V1.md`. |
| 12 | Verified location and review | `GET/PATCH /dashboard/salons/:salonId/location` reads the current coordinates/proposal/last decision and submits validated `{ latitude, longitude, source: GPS/MAP_PIN/MANUAL }`. Platform admins review via `GET /api/v1/admin/location-verifications` and `POST .../:proposalId/decision` with `{ decision: APPROVED/REJECTED, note }`. Only approval changes verified/public coordinates; EXIF is not trusted as proof. | Implemented in candidate; production workflow not verified. See `FASTQUE_LOCATION_DECISION_READ_V1.md`. |
| 13 | Contact import and consent | `POST /dashboard/salons/:salonId/contacts/preview` validates and transiently previews bounded contacts with explicit consent evidence; it does not persist or invite. A durable import/invitation API remains `PROPOSED` until consent, retention, deletion, suppression, and communication policy are approved. | Preview-only; durable consent, retention/deletion, and invitation lifecycle are not implemented. |
| 14 | Canonical shop sharing | `GET /dashboard/salons/:salonId/share-links` returns canonical public URL and share-safe metadata; client may construct WhatsApp/QR presentation from that URL. No third-party share success is asserted. | Implemented in candidate; public runtime not verified. See `FASTQUE_SHARE_LINKS_V1.md`. |
| 15 | Owner/customer assistants | Owner: `POST /dashboard/salons/:salonId/assistant/query` returns deterministic, salon-scoped figures only. Customer assistant `POST /assistant/search` is `PROPOSED`; it must return only real listed services and availability, and booking remains through the existing booking API after explicit customer confirmation. | Owner deterministic query implemented; customer availability assistant is not implemented. No generative provider is enabled. See `FASTQUE_OWNER_ASSISTANT_QUERY_V1.md`. |
| 16 | Promotions | Same offer engine as #11. `POST .../offers/preview` returns a quote; publishing never writes payments. Booking creation revalidates eligibility/discount atomically and returns `OFFER_EXPIRED` or `OFFER_NOT_ELIGIBLE` where applicable. | Implemented in candidate; production financial behavior not verified. |
| 17 | CSV/Excel export | `GET /dashboard/salons/:salonId/revenue/report.csv` returns UTF-8 CSV with formula-injection protection. `GET .../revenue/report.excel.xml` returns Excel 2003 SpreadsheetML XML (`application/vnd.ms-excel`), not native XLSX, using the same filters/authorization and an `.xml` filename. | Backend CSV/XML routes implemented; dashboard download control/browser flow remains unintegrated. |
| 18 | Owner subscriptions | No route is implemented. Proposed owner-only `GET /dashboard/salons/:salonId/subscription`, `POST .../subscription/cancel`, and `POST .../subscription/resume`; sandbox ledger/webhook adapter is required before any lifecycle is enabled. A plan/pricing/billing policy must be approved first. | Not implemented. Do not charge or activate recurring billing. |
| 19 | Authorized social import | No route is implemented. A proposed `GET /dashboard/salons/:salonId/social-import/providers` may report `NOT_CONNECTED/CONNECTED/UNAVAILABLE` only after a provider adapter exists; imports require provider-authorized APIs and provenance. Scraping is prohibited. | Not implemented; provider access/scopes unavailable. |
| 20 | Consultation scheduling | No route is implemented. Proposed customer `POST /consultations`, owner/professional `GET /consultations`, `GET /consultations/:id`, and `POST .../confirm`, `/cancel`, `/start`, `/complete`; status machine is `REQUESTED/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED`. Chat/voice descriptors report provider state; calling and payment stay disabled unless separately configured. | Not implemented. Privacy, scheduling, and billing policy remain to be finalized. |
| 21 | Owner email | No owner-mailbox route is implemented in this candidate. Any future `GET /dashboard/salons/:salonId/owner-email` must distinguish verified login email, forwarding alias, and real hosted mailbox; it must not report `ACTIVE` unless a real mailbox exists. | Separate Draft #195 account mapping exists; mailbox/alias provisioning is not in this candidate. |
| 22 | Private demo workspace | `GET /dashboard/salons/:salonId/demo/status`, `POST .../demo/import` (UUID `Idempotency-Key` header), and `GET .../demo/workspaces/:workspaceId`; import is bounded, deterministic, atomic and idempotent; workspace rows remain outside operational tables. The `OWNER_DEMO_WORKSPACE_ENABLED` flag must be true. | Implemented in candidate; disabled unless the feature flag is explicitly enabled; deployment/runtime acceptance not verified. |
| 23 | Demo deletion | `POST .../demo/delete-preview` returns a short-lived confirmation; `DELETE /dashboard/salons/:salonId/demo` requires the workspace id, confirmation text, and token and removes only that private workspace. Repeated deletion is safe. | Implemented in candidate; production runtime/data-fingerprint acceptance not verified. |
| 24 | Daily Deals | Same published offer API and booking quote as #11/#16; public `GET /offers` and `GET /offers/:offerId` discovery returns only currently active eligible offers and server-computed final price. | Implemented in candidate; no real payment/provider interaction. |
| 25 | Independent professionals | No route is implemented. Proposed public `GET /professionals?city&specialty&q&cursor`, `GET /professionals/:id`, and `GET /professionals/:id/availability`. Only verified `ACTIVE` profiles and public fields are discoverable; profile status, ownership, and service prices must be server-controlled. | Not implemented; identity, verification and direct-booking model remain open. |
| 26 | Customer phone OTP | `POST /auth/otp/request`, `POST /auth/otp/verify`, plus authenticated `POST /auth/customer/phone/link/request|verify`; customer sessions use CUSTOMER audience. Resend supersedes earlier codes; verify is atomic, one-time, expiry-bound, replay-resistant and rate-limited. | Backend implemented in separate candidate ancestry; UI/provider delivery and production configuration are not certified. See `FASTQUE_PHONE_OTP_V1.md`. |
| 27 | Bulk chairs | `POST .../chairs/bulk-deactivate/preview` accepts `{ chairIds }`; `POST .../chairs/bulk-deactivate/apply` accepts previewed `{ chairId, expectedUpdatedAt }` versions. Active service, occupancy or protected future-booking conflicts are not deactivated. | Implemented in candidate; production operation not verified. |
| 28 | Employee field operations | `/employee/leads`, `/employee/visits`, and `/employee/follow-ups` routes require FIELD_EXECUTIVE identity and per-lead ownership on every read/write; visit evidence and review remain distinct from salon operational records. | Separate Draft #196; not integrated into this candidate. |
| 29 | Admin CRM analytics | `GET /admin/crm/analytics` and signed-cursor `/admin/crm/{leads,visits,follow-ups}/page` routes require platform-admin authorization and return PII-minimized results. Owner/client roles do not receive global lead data. | Implemented in candidate; frontend/admin runtime not verified. |
| 30 | Owner phone onboarding | `POST /auth/owner/otp/request|verify` only authenticates an existing eligible owner and yields a STAFF-audience session after server-side role plus canonical `Salon.ownerUserId` verification. `POST /auth/owner/phone/link/request|verify` links a number from an already-authenticated owner session. It does not create a new owner account; public shop phone never grants ownership. | Backend implemented in separate candidate ancestry; owner UI/provider delivery and production configuration are not certified. See `FASTQUE_PHONE_OTP_V1.md`. |

## Errors and capability behavior for unfinished modules

All errors use the common `{ error: { code, message, details } }` envelope. The code list is feature-specific; clients must consume the actual shared error constants rather than assume every code applies to every route. Verified examples include `ADMIN_CURSOR_INVALID` and `ADMIN_DATE_RANGE_TOO_LARGE` for admin CRM, `CURSOR_FILTER_MISMATCH` for inventory pagination, `OFFER_EXPIRED`, `OFFER_NOT_ELIGIBLE`, `OFFER_REDEMPTION_LIMIT`, and `OFFER_CHANGED_RETRY` for offers, `SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED` for the disabled description adapter, and `FEATURE_DISABLED` for a disabled demo workspace. Existing route-specific codes take precedence. A disabled/unconfigured feature fails closed and never simulates success.

Until implementation and tests exist, the `subscription`, `socialImport`, `consultations`, `professionals`, durable `contactImport`, and customer-assistant capability values must not advertise production readiness. Chat/voice, paid AI, SMS, email campaigns, social APIs, payment capture/refund, and recurring subscriptions remain disabled by default.

## Representative wire contracts and shared validation

The shared TypeScript DTOs and Zod input schemas in `packages/shared/src` are authoritative. Backend controllers validate requests with those shared schemas; frontend clients should import the exported types rather than recreate the shape. A new backend capability must add its request/response schema there and a negative authorization test before clients consume it.

Capabilities example (`GET /api/v1/dashboard/salons/:salonId/capabilities`):

```json
{
  "features": {
    "revenueReport": { "status": "ENABLED", "reasonCode": null, "updatedAt": null },
    "aiDescription": { "status": "UNCONFIGURED", "reasonCode": "SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED", "updatedAt": null },
    "demoData": { "status": "DISABLED", "reasonCode": "FEATURE_DISABLED", "updatedAt": null }
  }
}
```

The real response includes every exported `FastQueCapabilityKey`. `ENABLED` means the backend feature is available, not that the caller is authorized; each route still applies server-side role and salon ownership checks.

Customer directory example (`GET /api/v1/dashboard/salons/:salonId/customers/directory?limit=20&sort=lastVisit&segment=repeat&minVisits=2`):

```json
{
  "salonId": "<authorized-salon-id>",
  "currency": "INR",
  "items": [{
    "customerId": "<account-id>", "displayName": null, "displayNameSource": "NOT_ON_FILE",
    "totalVisitCount": 3, "repeatVisitCount": 2,
    "recordedCollections": 900, "recordedRefunds": 100, "totalSpent": 800,
    "lastVisitAt": "2026-10-20T10:30:00.000Z"
  }],
  "nextCursor": null
}
```

This excerpt is abbreviated; the DTO also returns documented visit/status counters and the contact fields permitted by the owner CRM DTO and salon authorization. Directory filters and cursor are validated by `ownerCustomerDirectoryQuerySchema`; cursor verification binds it to actor, salon, filter and sort. `totalSpent` is the backend-derived net recorded amount, never a service-price estimate.

Contact preview example (`POST /api/v1/dashboard/salons/:salonId/contacts/preview`):

```json
{
  "contacts": [{
    "phone": "+919876543210",
    "consent": { "granted": true, "source": "OWNER_ATTESTED", "capturedAt": "2026-10-20T10:30:00.000Z" }
  }]
}
```

The bounded request is defined by `salonContactImportPreviewSchema` (1–250 rows). Its response is explicitly `previewOnly: true`, `invitationEligibility: NOT_EVALUATED`, and `dispatchEnabled: false`; it does not persist the contacts or send communications. `OWNER_ATTESTED` records the submitting owner's attestation; it is not independent proof of consent and does not authorize messaging. The example phone is synthetic.

Demo workspace example: `GET .../demo/status` returns `{ "active": false, "workspaceId": null, "label": "DEMO DATA — Not real business records", "counts": null }`. `POST .../demo/import` requires an RFC 4122 UUID `Idempotency-Key` and returns the same `DemoWorkspaceStatusDto`. `POST .../demo/delete-preview` returns `{ confirmationToken, expiresAt }`; `DELETE .../demo` requires `{ workspaceId, confirmation: "DELETE DEMO DATA", confirmationToken }`. The `OWNER_DEMO_WORKSPACE_ENABLED=true` flag is required; otherwise routes fail closed. Demo payload and projected finance remain in a private demo workspace and never become live operational or payment rows.

Offer creation uses `createOfferSchema`; saved offer edits use `updateOfferSchema`; preview uses `offerPreviewSchema`. Inputs contain an offer kind/title, service IDs, discount type/value, audience, UTC validity interval, and redemption caps. Public listing uses `publicOfferQuerySchema`; `GET /api/v1/offers/:offerId` resolves a single currently publishable offer. The booking service independently revalidates eligibility and applies a discount in its transaction; a UI preview is not a reservation or payment.

Phone OTP schemas and complete response/error semantics are specified in `FASTQUE_PHONE_OTP_V1.md`. Customer and owner authentication have physically separate request/verify routes; owner phone linking requires an existing authenticated owner session. Do not upgrade a CUSTOMER audience from a client-supplied role or public shop phone.

## Source/test evidence per feature

The integrated source SHA for the candidate contract snapshot is `ef146246c36bfc9474763c80bcde35a58e0009fc` (PR #273); its exact-head run is [39546403071](https://github.com/mail2devkr-maker/barbercue/actions/runs/39546403071). Requirement-level origin and implementation/partial status are maintained in `FASTQUE_30_REQUIREMENTS_CURRENT_MATRIX.md`. A row marked `Implemented in candidate` means code is present in that exact candidate, not that it is independently released or production-certified. Features marked partial or not implemented have no completion SHA and must remain labeled accordingly. Any source change, including this contract-only patch, requires a new exact-head CI run before that new head is certified.

## Change discipline

This contract is additive. Before changing any published route or DTO, update the relevant feature contract and add authorization, negative, pagination/idempotency, and PostgreSQL tests. Frontend and mobile clients must not call `PROPOSED` routes until a backend PR publishes its exact implementation SHA and the capability state is enabled. No production database/API result is certified by this document.
