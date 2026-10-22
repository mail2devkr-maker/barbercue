# HR register — what the web UI needs from the #283 backend (PROPOSED contract, 22 Oct 2026)

Web branch (Draft PR, base `master`): `claude/fastque-hr-register-283`. It does **not** consume any backend that exists today. Everything below is PROPOSED so you can adopt it, change it, or reject it. Until you publish the final DTOs the UI talks to a local synthetic test double only (no real backend, no PII). Nothing here changes who owns what: you own backend, Prisma, shared DTOs and the allocator; I own `apps/web`.

The exact TypeScript shapes are in `apps/web/lib/hr-register/types.ts` and the paths in `apps/web/lib/hr-register/api.ts` (one file, so adopting your published contract is a one-file swap).

### Endpoints the UI calls (all `admin/hr/...`, HR_ADMIN / CO_FOUNDER / PLATFORM_ADMIN only; every POST takes `Idempotency-Key`)
| Call | Purpose |
|---|---|
| `GET register?q&employeeCode&lifecycle&offerStatus&city&managerId&issuedFrom&issuedTo&cursor&limit` | bounded search, `{items, nextCursor, total}`; contacts **masked** |
| `POST identity/matches` `{fullName?, email?, phone?, employeeCode?}` | match candidates `{person, reasons[], strength}` + `blocksNewIdentity` + opaque `decisionToken` (POST so contacts never reach URLs/logs) |
| `POST offers` | `identity: {mode:"NEW", person, decisionToken, overrideReason?}` or `{mode:"EXISTING", personId, decisionToken}` + `terms`; returns `{person, offer, letter}`; allocates the permanent `FQ-FE-xxxxx` code on the first persisted offer, versions later offers (server decides FIRST / REOFFER / REHIRE) |
| `GET persons/:id` | summary + `offers[]`, `episodes[]`, `salaryHistory[]`, `managerHistory[]` |
| `GET persons/:id/audit?cursor` | append-only audit, newest first |
| `POST offers/:id/status` `{to: SENT\|ACCEPTED\|DECLINED\|EXPIRED, reason?}` | offer axis only; SENT = "HR recorded they emailed it" (no email is sent by us) |
| `POST offers/:id/joining` `{joinedOn, territory?, temporaryPassword}` | the ONLY step that may create/re-enable a login (first join: new User + EmployeeProfile with the pre-issued code via the same allocator; rehire: reactivate the SAME profile/user, new password, revoke old sessions) |
| `POST offers/:id/not-joined` `{decidedOn, reason}` · `POST episodes/:id/exit` `{exitedOn, reason}` | episode transitions (exit suspends access + revokes sessions) |
| `POST offers/:id/pdf-events` `{event: GENERATED\|REPRINTED, sha256, byteLength}` · `GET offers/:id/letter-data` | PDF history; the browser builds the PDF from the saved version, you store the fingerprint; letter-data returns the raw contacts needed for one reprint (audited) |
| `GET reconciliation?status` · `POST reconciliation/:id/link` `{personId}` · `/duplicate` `{duplicateOfItemId}` · `/create-identity` `{historyChecked:true}` | the 10 historical emails as an UNVERIFIED worklist; no ID is ever derived from names/emails |
| existing `GET admin/employees` | reporting-manager picker (already deployed, unchanged) |

Codes the UI maps to plain language (any others fall back to HTTP-status copy): `HR_MATCH_REVIEW_REQUIRED`, `HR_IDENTITY_CONFLICT`, `HR_OFFER_INVALID_TRANSITION`, `HR_OPEN_OFFER_EXISTS`, `HR_RESERVED_CODE`, `IDEMPOTENCY_KEY_REUSED`.

### Behaviours the UI assumes (please confirm or correct)
1. Offer lifecycle is two axes: offer `DRAFT|ISSUED|SENT|ACCEPTED|DECLINED|EXPIRED`, episode `PENDING_JOIN|NOT_JOINED|ACTIVE|EXITED`. A re-offer / rehire opens a NEW episode; older offers get `supersededByVersion`. A new offer is refused while the current episode still awaits an outcome (`HR_OPEN_OFFER_EXISTS`).
2. `blocksNewIdentity` is true for any STRONG match (exact code, or shared contact + name) or ≥2 matches; creating a NEW identity then needs `overrideReason` (≥5 chars, audited). A single name/contact match is never an automatic merge.
3. Lists never return raw email/phone (masked strings only). Raw contacts leave the server only in `offers` create result (for the letter just saved) and `letter-data`.
4. Historical imports: offers created from reconciliation carry `source: "HISTORICAL_IMPORT"`; the UI then hides reprint and terms (no PDF/terms stored). Normal offers are `source: "REGISTER"`.
5. All timestamps ISO-8601 UTC, calendar dates `YYYY-MM-DD`; the UI renders IST with an explicit "IST" label.
6. Standard ₹5,000 Expected Performance Incentive stays a constant in the PDF builder (unchanged design). Question: do you want it snapshotted per offer in `terms` (e.g. `expectedPerformanceIncentiveMonthlyInr: 5000`) for immutability?

### Questions
- **Contact changes on re-offer** (same name, changed mobile): the UI currently fixes identity + contacts when re-offering from the register. Do you want an audited contact-update endpoint, or keep contacts immutable per person?
- **Existing EmployeeProfiles** (FQ-FE-00101+, and reserved 1–100): should `GET register` list them as persons with `origin: "EXISTING_PROFILE"` so "existing employee → re-offer, code reused" works without a manual link step? The UI already handles that origin.
- **Employees page "Add employee"** still auto-allocates `FQ-FE-00101+`. After your allocator integration it must refuse to consume a code reserved by a pre-offer person; I only added a hint pointing HR to "Record joining" in the register.
- **ID card for rehires**: the card prints `EmployeeProfile.joinedAt` (original joining). Do you want the card to use the current episode start instead? Awaiting your DTO; I have not changed the card.

I will adapt the UI to whatever you publish and report source / CI / DB / RUNTIME separately on the PR. No email, no deploy, no production write has been done or is planned from my side.
