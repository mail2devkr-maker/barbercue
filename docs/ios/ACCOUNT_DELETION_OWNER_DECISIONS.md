# FastQue account-deletion processing — owner decisions required

**Status: PROPOSAL ONLY.** This is an engineering decision record for review by the product owner and qualified counsel. It is not legal advice, a published privacy notice, or authorization to process or erase production accounts. The Draft PR workflow currently records a non-customer deletion request and lets its authenticated requester withdraw/reopen it. It does not provide a reviewer queue or complete deletion.

## What this release actually does

- A signed-in non-customer, staff, owner, administrator, or mixed-role account can create one account-bound request. The subject is derived from the authenticated user, not a client-supplied identifier.
- The requester can read its status, withdraw a pending request, and submit it again. Each state change is audited. No target account or shop id is accepted for withdrawal.
- The customer-only direct-delete path remains unchanged.
- A non-customer request does **not** disable the account, revoke credentials/sessions, end employment, transfer or close a shop, delete identity or business records, revoke an Apple token, send a completion notice, or become `COMPLETED`.
- No reviewer API, processing SLA, legal retention schedule, or final completion job is implemented. Do not describe this intake as completed account deletion or App Store compliant deletion processing.

## Proposed end-to-end case lifecycle

The following lifecycle is a design proposal. Only `REQUESTED` and requester-controlled `CANCELLED`/reopen transitions exist in source today. Reviewer and completion states must not be added to production behavior until their authority, criteria, records and retention rules are approved.

1. **REQUESTED** — persist a self-bound request, timestamp, current role-resolution summary, policy version, and audit event; immediately show receipt. Do not delete or suspend access by default.
2. **IDENTITY_VERIFICATION_REQUIRED** — reviewer verifies control of the account using an approved, proportionate method; do not request passwords, OTPs, or Apple/Google tokens from a reviewer.
3. **ROLE_AND_CONTINUITY_REVIEW_REQUIRED** — resolve all current role, shop, employee, administrator, booking and financial responsibilities. The account remains active unless a separately approved, reversible access restriction is adopted.
4. **RETENTION_REVIEW_REQUIRED** — map each linked record class to the approved purpose/legal basis, minimum data, retention trigger and expiry. Apply legal hold only with documented authority.
5. **READY_FOR_PROCESSING** — all identity, continuity and retention decisions are recorded; a second approver is required for owner, administrator, and mixed-role cases under this proposal.
6. **PROCESSING** — use an idempotent job with a durable per-step ledger: revoke sessions and refresh credentials; revoke Apple authorization where applicable; remove provider/device tokens; delete or de-identify permitted personal records; preserve approved business/financial records; remove personal-only media and processor copies where supported; verify referential integrity and no orphaned shop.
7. **COMPLETED** — only after every required operation and postcondition is verified. Revoke remaining sessions, prevent relogin/relink, store only a minimized completion audit, and notify the user before erasing the last usable notification destination. A failed step must remain retryable and must never be labeled completed.
8. **REJECTED / ON_HOLD / CANCELLED** — record a coded reason and user-visible next step. Do not expose another person’s data. A requester can cancel only before processing begins; post-start cancellation requires a safe stop point.

## Proposed reviewer authority (owner approval required)

Least-privilege recommendation, not an existing authorization or implemented role:

- **Platform Admin (`PLATFORM_ADMIN`)**: primary case reviewer and processor, with a dedicated permission and auditable access. Current general admin access alone should not implicitly authorize deletion processing.
- **Co-Founder (`CO_FOUNDER`)**: second approver for shop-owner, platform-administrator, and mixed-role cases; never approve their own case.
- **HR Admin (`HR_ADMIN`)**: may provide an employment-resolution decision for staff records only; should not approve identity deletion or owner/admin account closure.
- **Shop owner**: may confirm whether a staff/shop relationship needs transfer or closure, but should receive only the minimum shop-scoped information; cannot approve their own request or delete the staff user’s global identity.
- **Support, Sales Admin, Platform Viewer, ordinary staff, and the requester**: no deletion approval or processing authority under this proposal.

The owner must select the authorized team, backup/absence coverage, separation-of-duties rule, evidence required, and whether two-person review is mandatory for each case class. Until approved, no reviewer endpoint is enabled.

## Record-disposition decision table

No retention period or legal basis is assumed. Counsel/product must decide the purpose, lawful basis, minimum fields, access scope, trigger, duration, deletion method, processor propagation, backup expiry, and exception/hold for each row.

| Record class | Candidate disposition to decide | Continuity / risk that must be resolved |
| --- | --- | --- |
| User profile, name, email, phone, verified identity and preferences | Erase or irreversibly de-identify personal fields when processing is authorized; retain only a minimal tombstone if justified | Preserve enough integrity to avoid relinking a deleted identity; decide canonical/duplicate identity handling |
| Password hashes, refresh/access sessions, reset tokens, OTP challenges, OAuth identity material, Apple authorization/refresh tokens | Revoke/delete at the defined processing point; never retain plaintext secrets or OTPs | Revoke all devices, block refresh/replay, and verify Apple revocation outcome before claiming completion |
| Customer favorites, search/location data, uploaded personal images, style-consultation media | Delete unless a specific approved reason requires a reduced record | Identify every object-storage key, derivative, cache, export and backup path |
| Bookings, check-ins, queue entries, service sessions, cancellations, no-shows and attendance | Candidate to preserve the minimum operational history for the shop/other participants, de-linking direct identity when approved | Do not break booking, queue, staff, invoice or audit foreign keys; determine whether future bookings must be cancelled/transferred first |
| Invoices, payment/refund events, append-only ledgers, tax and provider references, wallet/credit history | Do not rewrite or erase immutable financial events; decide which personal references can be minimized or de-identified and for how long | Counsel/accounting/provider requirements must define purpose and period; never infer that every field is legally required |
| Salon/shop, services, prices, hours, inventory, verified location, QR/payment settings, media and reviews | Preserve business-owned data while the shop operates; transfer an owner account to a verified successor or use an explicitly approved closure path | Never orphan or silently close a shop, erase another owner/staff/customer’s record, or remove public data without policy |
| Staff membership, employee profile/ID, offer letters, employment history, visit evidence and payroll references | Resolve active assignments and role access; retain only the minimum HR/operational history under an approved schedule | Do not recycle permanent Employee IDs; HR review is not permission to delete the global user account |
| Platform administration, access changes, security events, audit logs and fraud/abuse cases | Candidate to retain minimized, access-controlled evidence where justified | Set an approved retention schedule and restrict content; no password, OTP, token, unnecessary PII or raw request body in logs |
| Notification history, push-device tokens, communication preferences and contact-import consent/suppression | Remove device tokens/preferences and delete or minimize message history as approved | Preserve only a justified suppression/consent record; do not send a final message through a channel not authorized for that purpose |
| Support cases, disputes, legal holds and complaints | Hold only the specific records covered by a documented open case/legal basis; review periodically | Define who can place/release a hold and what is disclosed to the requester |
| Backups, exports, analytics aggregates and third-party processor copies | Define deletion/expiry propagation and restoration safeguards; avoid reintroducing erased identity on restore | State maximum residual period and perform restore-time deletion replay or equivalent control |

Business records are not automatically the account holder’s personal profile. A shop’s continuity should be handled by a verified transfer/closure decision; any retained personal reference still needs a documented purpose and minimization review.

## Role-specific completion gates

- **Customer-only:** preserve the currently verified direct-delete behavior until separately reviewed; test provider-token revocation and referential integrity. Do not broaden the customer path to mixed roles.
- **Staff / employee:** resolve each salon membership and assigned operational work; revoke access only at the approved point; preserve a separate employee/HR history only under the approved policy.
- **Shop owner:** require verified successor acceptance for every owned shop, or an owner-approved operational wind-down that accounts for bookings, staff, invoices, subscriptions, inventory, media and customer notices. No automatic deletion of the shop.
- **Administrator:** verify another authorized administrator can assume duties and recovery; avoid lockout of the platform’s only administrator; preserve minimized privileged-action evidence.
- **Mixed-role:** compute and resolve every role/tenant relationship independently. Customer deletion cannot remove staff, owner or administrator privileges without their own approved disposition.

## Proposed timeline for approval (not a commitment)

These are product targets only; counsel must validate against each jurisdiction and business record class before publication:

- Receipt confirmation: immediate in-app response.
- Initial human triage: within **3 business days**.
- Identity and continuity decision: within **10 business days** after the user supplies any required evidence; pause the target while waiting on the user or successor.
- Completion target: within **30 calendar days** after verification and all continuity/retention decisions; one documented extension of up to **30 additional days** with an in-app explanation and revised target.
- Credential/session and Apple-token revocation: at the approved processing point, preferably before final data disposition; completion must record provider outcome or a clearly defined, user-facing remediation.
- Backups: disclose the approved maximum residual period and explain restore-time suppression/deletion handling.

Do not display or promise these durations until approved and supported by staffing, automation, escalation and monitoring.

## Apple privacy-policy draft (do not publish yet)

Candidate text for review after production behavior and vendors are verified:

> **Sign in with Apple.** If you choose Apple sign-in, Apple provides an app-scoped account identifier and may provide an email address or private relay address. FastQue uses the sign-in response to authenticate and associate your account. We validate the identity response on our servers. [Confirm exact stored fields, whether email is retained, and production token-revocation behavior before publishing.]
>
> **Account deletion.** You can initiate an account-deletion request in the app. Customer-only accounts use the currently available deletion flow. For accounts linked to a shop, staff employment, or platform administration, submitting a request does not itself close a shop, revoke access, or delete business records. We will explain the review and continuity steps and the specific records, purposes and periods that apply before enabling a complete deletion workflow. [Replace with the approved, operational process, exceptions, processing target, and backup period before publication.]
>
> **Notifications and third parties.** FastQue registers a device push token with its API for notification delivery through Expo’s push service. [Verify the exact production payload fields, APNs configuration, current identity providers, hosting/storage processors, and whether any optional providers are enabled before listing processors or purposes.]

Do not update `https://fastque.com/privacy-policy` or App Store privacy answers with bracketed or unverified claims. Reconcile this draft to the exact production backend, SDK/native binary inventory, data-retention policy and vendor configuration first.

## Decisions requested before implementing reviewer/completion stages

1. Approve or replace the reviewer matrix and second-approver rule.
2. Have counsel/accounting approve record classes, legal purposes/bases, retention triggers and periods, legal-hold behavior, de-identification, and backup residual period. No duration is selected by this engineering proposal.
3. Decide whether account access stays active while a case is pending and which narrowly scoped temporary restrictions (if any) are allowed.
4. Approve the proposed target timeline or provide staffed alternatives; define user verification and successor-acceptance evidence.
5. Approve final notification channels/content and Apple-token-revocation failure handling.
6. Confirm the operational owner/team, escalation route, case staffing, and in-app review/completion surface before any status is called “in review” or “completed.”

## Engineering references

- [Apple App Review Guideline 5.1.1 — Account deletion](https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage)
- [Apple: Handling account deletions and revoking Sign in with Apple tokens](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
