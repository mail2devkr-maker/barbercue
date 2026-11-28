# FastQue customer display-name and visit-claim policy (proposal)

Status: design only; no schema, migration, API, or data backfill is included in the current Owner Insights milestone.

## Existing data is not a canonical name

The current `User` model has no canonical customer display-name field. `guestName`, queue labels, booking contact names, and imported contact names describe a transaction or contact record; they are not proof that a visit belongs to an authenticated account. The customer directory must continue to return `displayName: null` / `NOT_ON_FILE` rather than selecting one of those values.

Verifying a phone number proves current control of that phone number, not a person's legal name or continuing ownership of a number. FastQue should not call a self-entered display name “verified identity” or imply KYC.

## Recommended account profile

If product accepts collecting a customer name, add an additive, one-to-one customer profile keyed by the authenticated `User.id`:

- `displayName`: optional, customer-entered text with bounded length and normalized display validation.
- `displayNameSource`: `CUSTOMER_ENTERED` in v1; never inferred from visits or contacts.
- `displayNameUpdatedAt`: audit-friendly timestamp.
- Optional visibility preference, defaulting to shop-transaction-only rather than public profile visibility.
- Keep phone/email verification facts separate from name provenance.

Only the authenticated account holder may create or edit this profile. A salon owner may view the name only for a customer already associated with that salon's booking/history and only if the customer visibility policy permits it. Admin access remains audited. There is no name search across salons, public discovery exposure, or owner-side overwrite.

## Historical guest visit claim

Do not auto-claim or merge guest records by matching a name or phone. If the product later supports claims, require both (a) a one-time, high-entropy claim reference issued with the visit/receipt and (b) a fresh OTP to the contact channel recorded for that visit. Rate-limit and expire the claim; consume it atomically; audit the account, visit, salon, and claim result without storing the OTP. A recycled phone alone cannot claim old visit history. Owner/admin manual linking must be a separate, audited, two-party review flow.

Claiming a visit changes only an explicit account-to-visit relationship; it must not rewrite booking/queue history, payment ownership, refund records, or salon identifiers. Existing online reviews continue to use their existing ownership binding. A claimed completed visit becomes review-eligible only if the review uniqueness and source constraints accept that exact visit.

## Authorization and migration requirements

- Customer profile endpoints use the authenticated customer identity; never accept `userId` from the request body.
- Salon history continues to scope every row and invoice/payment aggregate to the authorized salon.
- Do not expose a profile to another salon, a public search result, or a shop based only on a contact-number match.
- Migration is additive, nullable, indexed by the unique account relation, and has no historical-name backfill.
- Rollback is application rollback only; retain the additive table and any customer-entered data until a separately approved, data-preserving migration is planned.
- Audit profile edits and claims without copying sensitive profile values into generic logs.

## Acceptance decision

This is a proposed privacy-safe design, not a production-ready verified-name feature. Product/owner approval is required for whether salon owners can see the optional customer-entered display name and whether historical guest claims should be offered. Until then, `displayName: null` is the correct behavior and the customer CRM requirement remains partial.
