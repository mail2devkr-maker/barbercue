# FastQue Action Assistant: controlled release runbook (issue #362, source PR #363, post-R7 integration PR #366)

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

## 2. Source audit against deployed R7 master `94ef6c1c`

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
| 1 | Source readiness | Combined source and CI PASS | 86 actions on PR #363; R7 + Assistant integration merge `47b7a10802ab17f926f331c7a01b37049263a951` in Draft PR #366 passed all 14/14 exact-head checks. Re-run on the final documentation commit before release. |
| 2 | Feature flag, fail closed, cohort, separate writes | Done | Section 1 |
| 3 | Staging certification | **No isolated cloud staging; owner risk decision required** | Railway has `production` and `fastque-otp-test`; the OTP pilot must not be overwritten. Isolated local disposable-Postgres browser/e2e tests and PR #366 exact-head CI provide non-production evidence, not a dedicated deployed staging runtime. Require explicit risk acceptance before a flag-OFF production deployment without staging, or provision a separately authorized nonproduction environment. No paid resource is approved. |
| 4 | Pre-production change gate | **Previous backup verified; post-R7 checkpoint desirable** | Owner encrypted direct Neon P1 backup `p1-nitesh-r7` stamp `20261104T075102Z` was integrity-checked and restored twice to local copies; R7 migration/recovery rehearsal PASS. Backup predates live R7. Post-R7 production is 84 public tables / 75 completed migrations; take/verify a new post-R7 backup before the Assistant cutover where possible. Never expose its URI or keys. |
| 5 | Controlled production deployment | **NO DEPLOYMENT YET — exact-head review/approval** | Candidate is Draft PR #366 on live R7; use the current integration SHA after complete CI. Production merge and Railway web/backend deployment are authorized only if owner accepts the staging limitation and approves the precise final SHA. The Assistant must remain fully flag-OFF. |
| 6 | Read-only smoke after deploy | Pending gate 5 | Section 5 |
| 7 | Owner-only canary, then public | Pending; separate explicit approvals | Section 6 |

## 4. Production deployment plan (only after gates 3–5 are approved)

1. Confirm both Railway services are healthy on live R7 (`bd6d562f` backend, `1dff1b09` web, master `94ef6c1c`) and that nothing else is deploying.
2. Leave `ASSISTANT_MODE`, `ASSISTANT_WRITES`, `ASSISTANT_COHORT_USER_IDS`, `ASSISTANT_INTERPRETER` and `ASSISTANT_WHISPER_URL` **unset** in production.
3. The owner reviews and approves the exact post-R7 integrated Draft PR #366 head SHA, including the no-staging risk exception if applicable. Merge it to `master` via the approved method: no unrelated PRs and no R8 (#358). Original Assistant source PR #363 remains independent.
4. Watch both Railway deployments until they report SUCCESS. Check that the build log shows the approved SHA. `railway redeploy` can rebuild the wrong commit, so pin the commit when redeploying.
5. The pre-deploy migration step must report **no pending migrations**, because this PR adds none.

**Rollback:** revert the Assistant integration merge to code equivalent to **R7 master `94ef6c1c`**, or redeploy the previous successful **R7** Railway deployments: backend `bd6d562f-954b-4239-a487-49e4ccd8bcff` and web `1dff1b09-b8e2-49c6-8a41-ae220001cde0`. Do NOT roll back to R6 `f4f15e98` by default because R7 is already production. The Assistant changes add no schema migration, so no Assistant-specific database down migration should be needed. Restore only with a separate approved recovery procedure if data is damaged.

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
- R7 is deployed and independently verified (84 tables, 75 completed migrations). R8 remains Draft and independently release-gated.

## 8. Post-R7 P0 checkpoint

- **Current released baseline:** master `94ef6c1cfb26da9f1535d44a94284d67e3234548`, R7 Inventory, backend and web SUCCESS.
- **Integrated source:** R7 + Assistant merge commit `47b7a10802ab17f926f331c7a01b37049263a951` (parents `94ef6c1c` and original Assistant `49cf0c54`); Draft PR #366. This is NOT a production deployment. Revalidate exact CI on every later documentation/source commit.
- **Production variables:** inspect variable names before any merge; ensure `ASSISTANT_MODE`, `ASSISTANT_COHORT_USER_IDS`, `ASSISTANT_WRITES`, `ASSISTANT_INTERPRETER`, `ASSISTANT_WHISPER_URL` are absent or securely OFF; default off is not a substitute for monitoring authenticated API responses.
- **Independent risk gates:** no existing dedicated staging that can safely replace the OTP pilot; a post-R7 backup would narrow RPO. Obtain explicit owner acknowledgment of these two exceptions before merging the flag-OFF P0 candidate.
- **Owner-only canary and broad enablement:** not included in flag-OFF deployment approval; each requires separate authorization and real-user checks.
