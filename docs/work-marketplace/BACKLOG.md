# FastQue Work — progress, backlog, risks and launch checklist

## Implemented in this PR

| Area | What works | Tested by |
|---|---|---|
| Business sign-up + KYC | Create org (GSTIN/phone validated), submit, admin mark-under-review / verify / reject (reason) / suspend | e2e |
| Worker onboarding | Profile with 8 worker types, 18+ check, skills, languages, optional college, masked UPI ID; level 1 from verified phone; admin level 2; suspend/reinstate with reason | e2e, shared unit |
| Job posting | Guided form fields from the spec (pay type, guaranteed pay, bonus text, schedule, deadline, eligibility, checklist, completion criteria, cancellation compensation, review window), 20 seeded categories, preview + quote, version-pinned publish | e2e, shared unit |
| Smart draft | Rules-based parser of a natural-language request; reports missing fields, never invents | shared unit, e2e |
| Validation + screening | Verified org, future start, deadline, anti-scam rules → moderation queue | shared unit, e2e |
| Funding | Sandbox order, signed webhook, amount check, replay-safe, job opens only after funding | e2e |
| Discovery | Public search (city, category, min pay, remote, instant), job detail with employer trust signals and funding status; per-viewer explainable eligibility | e2e |
| Hiring | Instant accept (atomic capacity), apply → offer → accept/decline, withdraw | e2e (instant), service code (apply) |
| Execution | Check-in by on-site code, GPS (single reading, consent) or employer confirmation; checklist (confirm / text / photo); private evidence; duplicate flags; submit | e2e |
| Review | Approve full pay, rework (max 2), auto-approval after the review window | e2e |
| Cancellations | Worker withdraw (late flag), employer cancel with disclosed compensation, job cancel, no-show report + 72 h dispute window | e2e (employer after arrival) |
| Disputes | Either side opens; admin awards 0..agreed with a reason | e2e |
| Ledger + payouts | Double-entry, DB-enforced balance and immutability; payouts, failure, retry, release on close | e2e |
| Reporting | Worker earnings + reliability, employer financial report, admin overview + trial balance + audit trail | e2e |
| UI | Marketplace, job detail, worker area and assignment execution, business area, admin control centre | web typecheck |

## Not built yet (explicit backlog)

**Integrations (blocked on business/credential decisions)**
- Real RBI-authorised payment partner adapter (collections + UPI/bank payouts + refunds). Needs:
  provider choice, nodal/escrow-compliant fund flow reviewed by counsel, API keys, raw-body
  webhook verification for that provider, settlement of `PLATFORM_FEE_REVENUE`.
- Refund of released employer funds back through the provider (today: ledger release only).
- Automated KYC (GSTIN verification, authorised-representative check) and consent-based worker
  identity verification through an approved provider. No Aadhaar data is collected.
- SMS / email / WhatsApp notifications (in-app notifications only today).
- Private object storage with signed URLs for evidence (today: private, in Postgres, 3 MB cap).
- Malware scanning and image re-encoding (EXIF/GPS stripping) of evidence.

**Product**
- Organization member management (invite managers/billing users); branches/locations.
- Direct invitations, AI-recommended shortlists, bulk campaigns, team leads, CSV import,
  recurring work, replacement workers, multi-location campaign dashboards.
- Mode B UI polish (applicant comparison); employer "rehire this worker".
- College and campus portal, referrals and growth system, skill passport, training modules.
- Worker safety centre (unsafe location, harassment, trusted contact) beyond disputes.
- Insurance/benefits integrations — must not be advertised before a provider exists.
- Regional languages beyond the existing English/Hindi notification labels.
- Granular platform roles (KYC reviewer, finance, fraud analyst, support, city manager) — today
  writes are PLATFORM_ADMIN only.

**AI layer (Phase 5)** — every agent in the spec. Design rule kept: AI never makes an irreversible
financial decision and is never on the acceptance or payment path.

## Risks

- **Legal/compliance (launch-blocking):** worker classification, Code on Social Security
  (platform/gig worker provisions), DPDP Act consent and retention, GST on platform fees, TDS on
  payouts, payment-aggregator rules. Policies are configurable, not hard-coded conclusions.
- **Money:** amounts are `INTEGER` paise; limits (≤ 200 positions, ≤ ₹50,000 per worker) keep a
  job's total inside range. Moving to `BIGINT` is needed before raising them.
- **Evidence in Postgres** grows the database; move to private object storage before scale.
- **Neon compute:** the deadline sweep uses the existing deadline scheduler (no polling), but
  heavy marketplace traffic will still keep compute awake.

## Launch checklist

- [ ] Real payment partner adapter + its own webhook contract tests; sandbox impossible in prod (already enforced)
- [ ] Counsel review of fund flow, worker terms, privacy notice, cancellation/dispute policy
- [ ] KYC provider or documented manual KYC SOP with evidence retention rules
- [ ] Private evidence storage, retention periods and deletion workflow
- [ ] Load test of the accept endpoint (hot jobs) and the deadline sweep
- [ ] Security review / pen test of `work/*` routes, webhook endpoint and uploads
- [ ] Accessibility pass on the new pages (keyboard, screen reader, contrast)
- [ ] Monitoring: alert on unbalanced trial balance, failed payouts, overdue disputes
- [ ] Backup/restore drill including the append-only tables
- [ ] Set `WORK_MARKETPLACE_ENABLED=true` only after the above
