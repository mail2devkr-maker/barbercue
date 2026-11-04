# FastQue Action Assistant: release runbook (issue #362, PR #363)

This follows the owner directive of 2026-11-04 ("prepare, certify, and safely deploy"). It lists every
gate, what evidence exists, and the exact owner approvals that are still needed. Nothing in this file
switches the Assistant on.

## 1. Release gate (feature flag): OFF by default, fails closed

The backend reads three environment variables at start-up (`apps/backend/src/assistant/assistant-rollout.ts`):

| Variable | Values | Default |
|---|---|---|
| `ASSISTANT_MODE` | `off` / `cohort` / `all` | **off**: any other value, a typo, or an empty value also means off |
| `ASSISTANT_COHORT_USER_IDS` | comma-separated user UUIDs (the allowlisted test cohort) | empty, which admits nobody |
| `ASSISTANT_WRITES` | `off` / `cohort` / `all` | **off** |

What happens:
- **Not enabled for the user:** every assistant route (`capabilities`, `turns`, `confirmations`, `transcriptions`) returns **404**.
- **The access route:** `GET /api/v1/assistant/access` always answers a signed-in user with `{enabled, writes}`. Without a session it returns 401.
- **The web drawer:** it renders **nothing** unless the access route says `enabled: true`. An error, a missing field or a non-boolean value also means hidden (`ActionAssistant.tsx`, with tests).
- **Writes switch separately:** a write preview returns UNAVAILABLE with no token. A confirmation made after writes were switched off is refused (`REFUSED_WRITES_OFF` audit), and nothing changes.
- **Writes never reach beyond the cohort:** with `MODE=cohort`, `WRITES=all` still lets only the cohort write.
- **Existing checks still apply:** role, shop and permission checks, confirmation sealing, replay and stale-state checks all run on top of the gate.
- **Evidence:**
  - unit: `assistant-rollout.spec.ts`
  - e2e: `test/assistant-rollout.e2e-spec.ts`, covering default 404s, a misspelt value staying off, cohort-only access, writes refused, and a preview refused after writes are switched off
  - web: `ActionAssistant.test.jsx`, which checks the drawer stays hidden in three cases

**A production deploy without any of these variables set therefore ships the code with the Assistant hidden from everyone.**

## 2. Source audit against production master `f4f15e98`

- **Migrations:** none. No `schema.prisma` change and no migration files.
- **Start-up behaviour:** no new start-up job, cron or queue worker. The interpreter is `rules` unless `ASSISTANT_INTERPRETER=local` and a private model URL are set. The transcriber is off unless `ASSISTANT_WHISPER_URL` is set. No paid AI or STT provider is called.
- **Files outside `assistant/`:**
  - backend: module wiring only (exports of existing services), in `admin`, `auth`, `dashboard-*`, `employee`, `owner-ops`, `reviews`, `salon-setup`, `salons`, plus `app.module`
  - web: drawer mounts, and `useAssistantRefresh` hooks on existing pages
  - the CI workflow
- **Unrelated changes:** none.
- **Where checks run:** every action is checked on the server per session, per shop and per role (`catalog.ts`, `checkAccess`). Writes are previewed, HMAC-sealed, single-use, expire after 120 s and are bound to the before-state. Every turn writes an `ASSISTANT_ACTION` audit row without the transcript.
- **Not done by design:** money, refunds, customer notifications, public shop activation, deletions, role changes, exports and bulk changes (see the coverage matrix, section 2).

## 3. Gates

| # | Gate | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Source readiness | Done for the scope above | 86 actions; unit, e2e (twice in one shared DB) and web tests; exact-head CI per batch (see PR #363 checkpoints) |
| 2 | Feature flag, fail closed, cohort, separate writes | Done | Section 1 |
| 3 | Staging certification | **BLOCKED (owner)** | Railway has `production` and `fastque-otp-test`. The second runs the phone-OTP pilot (#352/#355). Deploying the Assistant there would replace that candidate and its test state. No other free staging exists, and creating one adds a cloud resource. Done instead: local isolated certification on disposable PostgreSQL clones plus the local browser demo. **Owner decision:** allow a time-boxed deploy to `fastque-otp-test` (then restore the OTP candidate), or approve a new staging environment and its cost |
| 4 | Pre-production change gate | **BLOCKED (owner)** | Neon P1 has no fresh snapshot (latest manual 2026-10-26). An owner-controlled encrypted backup and an independent restore rehearsal are required (owner procedure; never in chat) |
| 5 | Controlled production deployment | **STOP: owner approval** | Production deploys on merge to `master`, so a deploy means a master merge. The directive says to stop at this exact gate |
| 6 | Read-only smoke after deploy | Pending gate 5 | Section 5 |
| 7 | Owner-only canary, then public | Pending; separate explicit approvals | Section 6 |

## 4. Production deployment plan (only after gates 3–5 are approved)

1. Confirm both Railway services are healthy on R6 (`c2a9d173` backend, `a3443694` web) and that nothing else is deploying.
2. Leave `ASSISTANT_MODE`, `ASSISTANT_WRITES`, `ASSISTANT_COHORT_USER_IDS`, `ASSISTANT_INTERPRETER` and `ASSISTANT_WHISPER_URL` **unset** in production.
3. The owner approves the exact PR #363 head SHA. The merge to `master` is done with the approved method: no unrelated draft PRs, no R7 (#357) or R8 (#358).
4. Watch both Railway deployments until they report SUCCESS. Check that the build log shows the approved SHA. `railway redeploy` can rebuild the wrong commit, so pin the commit when redeploying.
5. The pre-deploy migration step must report **no pending migrations**, because this PR adds none.

**Rollback:** revert the merge commit on `master`, which redeploys code equal to `f4f15e98`, or redeploy the previous successful Railway deployments. There is no schema change, so no database rollback is needed.

## 5. Read-only smoke checks after deploy

These do not modify real customers or shops:
- Backend health returns 200. Website home and login pages return 200.
- `GET /api/v1/assistant/access` without a session returns 401. With a test session, `enabled` and `writes` are both false.
- `POST /api/v1/assistant/turns` and `/confirmations` return **404** for a signed-in session.
- The owner dashboard, customer account pages and admin shell render **no** Assistant button.
- Existing APIs are unchanged: queue, bookings, services, staff, hours and dashboard reads.
- No new error spike in the Railway logs during the watch window.

## 6. Turning it on (separate explicit owner approvals, never unattended)

1. **Owner-only canary, reads:** `ASSISTANT_MODE=cohort`, `ASSISTANT_COHORT_USER_IDS=<owner's user id>`, `ASSISTANT_WRITES=off`. Then restart the backend.
2. **Owner-only canary, writes:** add `ASSISTANT_WRITES=cohort`. Each write is still previewed and confirmed on screen.
3. **Wider cohort or public** (`ASSISTANT_MODE=all`): only with the exact SHA, affected roles and shops, read/write scope, monitoring results and this rollback.

**Rollback of any enablement:** unset the variables, or set `ASSISTANT_MODE=off`, and restart. A preview made before the switch-off cannot be confirmed after it.

## 7. Still owner-only decisions (unchanged)

- Voice: Chrome Web Speech sends audio to Google; the in-app privacy notice and text input always remain.
- Local model hosting.
- Lead creation by voice (third-party phone consent).
- Review delete, sign-in email change, verify/suspend, role changes, exports, money.
- R7 and R8 stay separate and blocked on the fresh P1 backup.
