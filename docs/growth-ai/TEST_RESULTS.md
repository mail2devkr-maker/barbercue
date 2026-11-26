# Growth AI — test results (2026-11-26)

Baseline: upstream `master` `76613f8e`, same worktree, before any Growth AI change. After: branch `feature/growth-ai-acquisition`.
Windows 11, Node via the repo's npm workspaces, PostgreSQL 18 in Docker (`fastque-db`), disposable databases only.

| Check | Baseline | After | Difference |
| --- | --- | --- | --- |
| `packages/shared` jest | 42 suites, 732 passed | 43 suites, 745 passed | +13 new Growth AI tests |
| `apps/backend` jest (unit) | 154 suites, 2,307 passed | 155 suites, 2,318 passed | +11 new Growth AI tests |
| `apps/backend` `tsc --noEmit` | clean | clean | — |
| `apps/web` jest | 151 passed, **1 failed** (5 tests) | 152 passed, **1 failed** (5 tests) | +4 new tests; the same pre-existing failure |
| `apps/web` `tsc --noEmit` | clean | clean | — |
| Growth AI e2e (`test/growth-ai.e2e-spec.ts`, real AppModule, `growth_ci`) | n/a | 13 passed | new |
| Migration chain (`scripts/verify-migration-chain.sh`) on empty `growth_ci` and `growth_qa` | — | exit 0; no `growth_*` drift | — |
| ESLint, Growth AI source (backend `src/growth` non-spec files, web Growth files) | — | clean | — |

Pre-existing, not caused by this branch:
- `apps/web/components/bookings/__tests__/ArrivalAlertOverlay.test.jsx` fails 5 tests at baseline and after (`speechSynthesis.getVoices` not stubbed).
- ESLint reports "was not found by the project service" for every backend `*.spec.ts`, `test/*.e2e-spec.ts` and `prisma/seed-*.ts`
  (they are outside `tsconfig.json`); the new spec, e2e and seed files get the same message.
- `verify-migration-chain.sh` prints the known master-wide schema diff (index/default drift in other modules); none involves Growth AI tables.

Not run: the other backend e2e suites (each needs its own named disposable database); mobile tests (no mobile change).

## Browser walk-through (section 26 demonstration)

Local backend with `GROWTH_AI_*` flags on and `GROWTH_AI_KEYWORD_PROVIDER=mock`, web with `NEXT_PUBLIC_GROWTH_AI_ENABLED=true`,
database `growth_qa` seeded by `prisma/seed-growth-demo.ts` (20 "FastQue Demo" salons in Greater Noida, 1,345 demo bookings).

1. Keyword research, Greater Noida, Haircut, ₹500/day → opportunity report; every demand and bid figure carries "MOCK — not real
   data"; 20 matching salons (FastQue data). `screenshots/01-opportunity-report-mock.jpg`
2. Marketing Manager drafted a 14-day proposal from 5 HIGH keywords, template ad text, sent for review. Preview: ₹7,000 total,
   ₹0 spent, clicks/day 13–30 (MOCK), average service value ₹257.83 (FastQue data, 1,182 services), break-even and expected
   bookings Unavailable. `screenshots/02-proposal-approval-preview.jpg`
3. Admin (a different person) approved with the MOCK acknowledgement and a note; measurement shows campaign vs. previous
   window from completed bookings; platform-attributed and cost per booking Unavailable. `screenshots/03-approved-measurement.jpg`,
   `screenshots/04-approval-history.jpg`
4. Dashboard: 18 sections, unavailable ones say why. `screenshots/05-dashboard-unavailable.jpg`

Fixed during the walk-through: duplicate "Unavailable" label, budget wrongly labelled as an assumption, text overflow in the
preview and dashboard cards, negative rupee formatting (now "−₹1,100").
