# Test results and regression comparison

Windows 11, Node 24, PostgreSQL 18 in Docker, disposable local databases. Baseline = `8965d964`, before any change,
in the same environment. "After" = this branch.

| Suite | Baseline pass / fail / skip | After | Newly failing |
| --- | --- | --- | --- |
| Shared unit | 698 / 0 / 0 | 706 / 0 / 0 | 0 |
| Web unit | 1527 / 5 / 0 | 1527 / 5 / 0 | 0 |
| Backend unit | 2286 / 1 / 0 | 2286 / 1 / 0 | 0 |
| All backend e2e | 401 / 25 / 16 | 418 / 25 / 16 | 0 |

Typecheck (backend, web), eslint on new and changed files, web production build with the admin flag off and on: pass.
Migration chain: 89 applied, 66 historical table fingerprints unchanged, no drift; only `CREATE` statements on existing schema.

## Failing before this work (not fixed here)

- Web: 5 in `ArrivalAlertOverlay.test.jsx` (`speechSynthesis.getVoices` missing in the test browser).
- Backend unit: 1 QR photo decode in `salon-upi.service.spec.ts`; which image fails varies, and it passes alone.
- E2E: 25 in `owner-ops`, `queue`, `booking`, `inventory`, `salon-setup-activation`, `rbac`,
  `customer-assistant-search`, `discovery` (outdated call signatures, missing fixtures and environment settings).
  Because these fail on master too, queue and booking are covered here by the unchanged unit suites and the other e2e.

## Notes on reruns

- A first backend unit run failed 8 extra tests because it inherited a too-short `JWT_ACCESS_SECRET` from the e2e shell.
  With the baseline's environment all pass.
- One `assistant-rollout` e2e returned 401 once in a full run; it passed alone twice and in a second full run.

## Commerce e2e (17)

Flag behaviour; seller and role isolation; test-data and cost hiding; PIN serviceability; guest COD order, FEFO, snapshots,
private link, cancel; 6 concurrent buyers of the last unit; 4 concurrent retries; price change, limits, COD cap; expired stock;
state machine, single dispatch, failed delivery, return to origin; COD ledger and second-person sign-off; returns, refund,
replacement; coupons and below-cost guard; purchase orders, transfer, ledger = balance; mixed FastQue + two salons with
compensation and race; reports and cost protection; data quality; address privacy.

## Browser check (guest and admin, desktop; 375 px for customer pages)

Storefront, offer comparison with total to door, three-seller bag, unsupported PIN blocked, mixed guest checkout, tracking,
admin dispatch to Delivered, stock 20 to 19, cash still "not collected", all 16 admin tabs.

Not done: load or performance measurement, security scan beyond the tests above, screen-reader testing, Android/iOS app screens.
