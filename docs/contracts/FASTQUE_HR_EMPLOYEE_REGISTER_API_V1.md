# FastQue HR Employee Register API v1

Status: proposed backend contract for Issue #283. The migration and endpoints are additive. Production rollout and enabling the feature require separate release approval.

## Authorization and rollout

All routes are under `/api/v1/admin/employee-register` and require an authenticated `ADMIN` audience session with one of `PLATFORM_ADMIN`, `CO_FOUNDER`, or `HR_ADMIN`. Salon/customer/field-executive sessions are not accepted. The server rejects every route with `503 HR_EMPLOYEE_REGISTRY_DISABLED` unless the server-side environment variable `HR_EMPLOYEE_REGISTRY_ENABLED=true`; the default is disabled. No browser or mobile client may set this flag.

Mutations require a caller-generated `idempotencyKey` (8–128 characters). The same actor/key and same canonical request returns the original resource; reusing a key with a different operation, entity, or payload returns `409 IDEMPOTENCY_KEY_REUSED`. Identity and employee-code allocation are transactionally serialized and backed by PostgreSQL unique constraints and triggers.

## Identity and code policy

`POST /people/matches` accepts candidate name, email, phone, or employee code in a POST body and returns potential employee matches with masked contacts, match reasons, `blocksNewIdentity`, `requiresReview`, and `requiresLegacyProfileReconciliation`. Contact values must never be sent in URL query strings; `GET /people/search` is for name/code only. Exact employee-code, exact employee-register contact, or account-linked employee identity matches block a new identity unless HR explicitly records `DISTINCT_PERSON` and references the exact complete set of reviewed employee identity IDs. A same-name match also requires that explicit audited review. The create transaction re-reads all matches under its registry lock so a match added after preflight cannot be omitted from the decision. A verified contact on a customer-only account is not exposed as an employee match and is never used to attach that account; a verified contact on a legacy employee profile without a permanent identity link sets `requiresLegacyProfileReconciliation` and blocks creation until HR reconciles that legacy record. `POST /people` creates a candidate identity with encrypted contacts and no employee code, user, employee profile, or login, and requires the match-review decision plus internal evidence reference/reason. Contacts are matched through keyed blind indexes; returned contacts are masked.

`POST /people/:id/verify-identity` records an HR attestation with method, reason, and an internal evidence reference. Evidence references are not URLs. Verification is an auditable human decision; the endpoint does not call an identity provider. A new offer version is refused until the prior offer was declined, expired, or marked not joined; after a joined employee exits, re-offer is permitted only when the employment episode has an audited exit.

Employee codes `FQ-FE-00001` through `FQ-FE-00100` remain reserved for the existing TOTP-gated exceptional workflow. Standard allocation starts at `FQ-FE-00101`. A non-cycling PostgreSQL sequence and database guards prevent recycling, reassignment, or profile/identity code collisions. The first official `POST /offers/:offerId/issue` allocates the standard code. Creating a draft does not allocate it. Verified historical offer reconciliation also allocates a code because it records documentary evidence of an already-issued offer. A candidate that declines, expires, or does not join retains the code permanently.

Employee login/profile creation happens only through `POST /people/:id/join`, after the person is verified, employment history is resolved, and the latest offer has an evidenced `ACCEPTED` status. An existing canonical employee profile/account is reused on rehire; existing passwords are never reset by linking. A verified email/phone collision with a customer or other account is not proof of account ownership: join returns `409 EMPLOYEE_ACCOUNT_OWNERSHIP_VERIFICATION_REQUIRED` and does not attach the account or grant `FIELD_EXECUTIVE`. This v1 contract intentionally fails closed; a candidate-authenticated account-link flow must be separately designed and certified before that account can be linked. Legacy employee profiles without a canonical identity link return `EMPLOYEE_LEGACY_PROFILE_RECONCILIATION_REQUIRED`; contact equality is not used to reconcile them. Exit suspends the employee account and revokes refresh tokens. Direct `POST /admin/employees` creation now returns `409 EMPLOYEE_HR_REGISTRY_REQUIRED`; reactivation through the legacy update endpoint is rejected and must use the audited join flow.

## Routes

| Method and route                        | Purpose                                                                                         | Key validation / result                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /people/search?q=&limit=`          | Search name or employee code; reject email/phone query strings                                  | `limit` 1–50; contacts returned masked; stable employee-code/name/ID order                                                                                                                              |
| `POST /people/matches`                  | PII-safe preflight against name, employee code, employee-linked account, or normalized contacts | `{ fullName?, email?, phone?, employeeCode?, limit? }`; returns `{ matches: [{ person, reasons, strength }], blocksNewIdentity, requiresReview, requiresLegacyProfileReconciliation }`                  |
| `POST /people`                          | Register a candidate after an audited match decision                                            | `{ idempotencyKey, fullName, email?, phone?, matchReview: { decision, reviewedPersonIds, evidenceReference, reason } }`; no ID/login                                                                    |
| `GET /people/:id`                       | Read the HR timeline                                                                            | Offers, employment episodes, append-only events; HR-only                                                                                                                                                |
| `POST /people/:id/verify-identity`      | Record verified human identity check                                                            | `{ idempotencyKey, verificationMethod, evidenceReference, reason }`                                                                                                                                     |
| `POST /people/:id/history-review`       | Resolve legacy employment-history status                                                        | `{ idempotencyKey, status, evidenceReference, reason }`                                                                                                                                                 |
| `POST /people/:id/offers`               | Save an immutable offer draft version                                                           | `{ idempotencyKey, candidateName?, position, reportingManager?, proposedJoiningAt?, compensation }`; compensation encrypted                                                                             |
| `POST /people/:id/offers/historical`    | Reconcile a documented historical offer                                                         | Draft/unknown/joined offer states are rejected; requires source reference and offer date; does not create a login                                                                                       |
| `POST /offers/:offerId/issue`           | Officially issue an offer record and allocate/reuse employee ID                                 | `{ idempotencyKey }`; no email is sent                                                                                                                                                                  |
| `POST /offers/:offerId/status`          | Record evidence-backed offer state                                                              | Allowed terminal/progress transitions only; `JOINED` is reserved for join action                                                                                                                        |
| `POST /offers/:offerId/document-status` | Record local generation or evidenced email delivery                                             | `EMAILED` requires internal evidence reference; no email is sent                                                                                                                                        |
| `POST /people/:id/join`                 | Record actual joining, provision/reuse login and episode                                        | `{ idempotencyKey, password?, confirmPassword?, territory?, startedAt? }`; password required only for a newly created account; rehire reuses the account/profile and revokes any stale refresh sessions |
| `POST /people/:id/exit`                 | Record employment exit, suspend access, revoke refresh tokens                                   | `{ idempotencyKey, occurredAt?, reason }`                                                                                                                                                               |
| `POST /people/:id/employment-history`   | Reconcile migration-backfilled legacy employment                                                | `{ idempotencyKey, status: ACTIVE\|EXITED, startedAt, endedAt?, reason, evidenceReference }`; never auto-reactivates a suspended account                                                                |

Offer `compensation` requires an explicitly supplied `baseAmount`, `currency: "INR"`, and `frequency: "MONTHLY" | "YEARLY" | "HOURLY"`. Optional incentive remains `null` when unknown; no amount is invented. Offer versions and employment episodes are immutable. Corrections create a new offer version or a new HR event; no record is deleted or rewritten.

## Representative responses

Candidate creation returns the authorized HR timeline shape; before official offer issue, `person.employeeCode` is `null`, `offers` is empty, and `person.linkedEmployeeProfile` is `false`:

```json
{
  "person": {
    "id": "<identity-id>",
    "employeeCode": null,
    "fullName": "<HR-entered name>",
    "verificationStatus": "NEEDS_REVIEW",
    "historyStatus": "COMPLETE",
    "linkedEmployeeProfile": false,
    "employmentStatus": null,
    "contacts": [{ "kind": "PHONE", "maskedValue": "98******10" }],
    "createdAt": "<ISO-8601>"
  },
  "offers": [],
  "employmentEpisodes": [],
  "events": [{ "eventType": "EMPLOYEE_IDENTITY_CREATED" }]
}
```

Issuing an offer returns its immutable version, employee code, current status, and compensation terms to the authorized HR audience. No account is created until the join action.

## Errors

Expected codes include `HR_EMPLOYEE_REGISTRY_DISABLED` (503), `EMPLOYEE_IDENTITY_NOT_FOUND` / `EMPLOYEE_OFFER_NOT_FOUND` (404), `EMPLOYEE_IDENTITY_MATCH_REQUIRES_REVIEW`, `EMPLOYEE_LEGACY_PROFILE_RECONCILIATION_REQUIRED`, `EMPLOYEE_IDENTITY_REVIEW_REQUIRED`, `EMPLOYEE_OFFER_NOT_DRAFT`, `EMPLOYEE_OFFER_STATUS_TRANSITION_INVALID`, `EMPLOYEE_ACCEPTED_OFFER_REQUIRED`, `EMPLOYEE_ALREADY_ACTIVE`, `EMPLOYEE_ACCOUNT_MATCH_AMBIGUOUS`, `EMPLOYEE_ACCOUNT_ALREADY_LINKED`, `EMPLOYEE_ACCOUNT_OWNERSHIP_VERIFICATION_REQUIRED`, `EMPLOYEE_INITIAL_PASSWORD_REQUIRED`, `EMPLOYEE_REJOIN_ACTION_REQUIRED`, and `IDEMPOTENCY_KEY_REUSED` (409 unless noted above).

## Data handling and audit

Raw email/phone and compensation details are AES-GCM encrypted before persistence. Exact-match indexes are keyed HMACs; raw contact values are not placed in logs or event metadata. The encryption key is derived from the existing `TOTP_ENCRYPTION_KEY` using a separate KDF salt. If that key is absent or invalid, encrypted HR operations fail closed. Evidence references must be internal identifiers, not URLs. Reasons are encrypted. Immutable `EmployeeHrEvent` rows record actor, entity, state, timestamp, idempotency fingerprint, and non-PII metadata. The migration backfills one identity per existing profile/code without name/contact matching, keeps existing IDs, and marks legacy history `NEEDS_REVIEW` for explicit HR reconciliation.

## Compatibility and operations

The existing employee list/read/update/password-reset endpoints remain. The legacy create and reactivation paths are intentionally blocked to preserve the first-offer ID boundary; the employee-management UI must use this register contract. The feature is off by default until the `HR_EMPLOYEE_REGISTRY_ENABLED` flag is enabled in a separately approved release. The migration is additive and has not been run against production. Rollback is application-disable/revert only; after any HR records are created, do not drop the additive schema or sequence. Forward-fix the application and preserve the audit trail.
