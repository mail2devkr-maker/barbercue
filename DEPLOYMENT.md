# BarberCue — Deployment Architecture

Status: **V1 decisions finalized.** Guiding principle for V1: cost-conscious and provider-agnostic — nothing below is designed around a specific cloud vendor's proprietary services, so moving host later is a redeploy, not a rewrite.

## Environments

Three: `development` (local), `staging`, `production`. Each has its own Postgres instance, its own payment-gateway credentials (test-mode keys in dev/staging, live keys only in production), its own OTP provider credentials, and its own JWT signing secret. Nothing is shared across environments — a staging DB leak can never touch production payment credentials because they're not the same secret store entry.

## Environment variables (representative, not exhaustive)

```
DATABASE_URL
JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
OTP_PROVIDER_API_KEY
GOOGLE_WEB_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID   # OAuth client IDs, not secrets — see apps/backend/.env.example
GEMINI_API_KEY                  # AI Style Advisor image generation; unset = feature disabled, not broken
PAYMENT_PROVIDER_KEY_ID / PAYMENT_PROVIDER_KEY_SECRET / PAYMENT_WEBHOOK_SECRET
OBJECT_STORAGE_BUCKET / OBJECT_STORAGE_KEY
NEXT_PUBLIC_API_BASE_URL        # apps/web → apps/backend
EXPO_PUBLIC_API_BASE_URL        # apps/mobile → apps/backend
REVALIDATE_SECRET               # backend → apps/web ISR revalidation webhook
```

Secrets never committed; `.env.example` files per app document required keys with placeholder values. Production secrets live in whichever host's built-in secret manager is chosen (Vercel env vars for `apps/web`; Railway/Render variables for `apps/backend`) — not AWS Secrets Manager, since that would reintroduce the AWS-specific dependency this deployment design deliberately avoids for V1.

## Hosting — cost-conscious, provider-agnostic V1 (confirmed direction)

| Component | V1 choice | Why it avoids lock-in |
|---|---|---|
| `apps/web` | Vercel (generous free/hobby tier at this scale) | Best-fit for Next.js ISR/image optimization, but the app itself is standard Next.js — portable to any Node host or another Vercel-like platform (Netlify, Cloudflare Pages) if cost or needs change |
| `apps/backend` | A low-cost managed-container host (Railway or Render — either's free/starter tier) | The backend is a plain Dockerized Node service with no provider-specific SDK calls; moving to AWS ECS, Fly.io, or a VPS later is a redeploy, not a rewrite — deliberately **not** designed around AWS-specific services (no Lambda, no proprietary queueing) for V1 |
| PostgreSQL | Neon (generous free tier, serverless Postgres) or the chosen backend host's bundled Postgres | Standard PostgreSQL only — no vendor-specific extensions used — so a `pg_dump`/`pg_restore` moves the database to any other Postgres host, including self-managed, with zero code change |
| `apps/mobile` | EAS Build/Submit | Already configured in this repo (`eas.json`, linked project) — unaffected by backend/web hosting choices |
| Object storage (salon photos) | **Launch driver:** a Railway persistent Volume mounted on the backend service, served back out through the backend's own static file middleware. **Later:** any S3-compatible API (Cloudflare R2 preferred for cost — no egress fees — but AWS S3 or Backblaze B2 work identically) | `ObjectStorageService` selects a `StorageDriver` at boot from whichever env vars are present (`LOCAL_STORAGE_*` for the volume, `OBJECT_STORAGE_*` for S3) — see `apps/backend/src/storage/`. The volume is the simpler launch choice (no account/bucket/credentials to provision) but ties photo storage to one backend instance; moving to R2 later is a config change, not a Photo-model or frontend change |

This table intentionally avoids naming one "final" vendor per row as a locked commitment — it names the cost-conscious V1 default per your instruction, on infrastructure standard enough (Docker, Postgres, S3 API) that switching later costs a config change, not an architecture change.

## CI/CD

GitHub Actions:
- On every PR: install, typecheck, lint, unit tests, build all three apps (catches cross-package breakage from `packages/shared` changes immediately).
- On merge to `main`: deploy `apps/backend` and `apps/web` to staging automatically; run integration tests against staging.
- Production deploy: manual promotion (a workflow_dispatch or a tag push), never automatic — this is a payments-handling system, a bad auto-deploy shouldn't be one click away from customers' money.
- Database migrations run as a required CI step before the backend deploy completes (Prisma Migrate), never applied by hand against production.

## Migrations

Prisma Migrate, one migration history, applied in order across environments. No destructive migration (dropping a column/table) ships in the same release as the code that stops using it — always a two-step deprecate-then-remove, since staging and production can briefly run different backend versions during a rolling deploy.

**Exact deploy-time commands** (run against the target environment's own `DATABASE_URL`, as a required step before starting the new backend version — never applied by hand against production per the CI/CD section above):

```
npx prisma migrate deploy   # applies any migration not yet recorded as applied on this database — never resets, never drops data
npx prisma generate         # regenerates the Prisma Client the backend process actually imports
```

`prisma migrate deploy` is non-interactive and additive-only by design: it applies pending migrations in filename order and never prompts for or performs a reset, unlike `prisma migrate dev` (a local-development-only command that can offer to reset on drift — never run this against a database with real data). A first-time deploy to a genuinely empty database replays the full migration history from scratch; every migration currently in `prisma/migrations/` has been verified (Phase 8A) to replay cleanly in that scenario.

**Current safety posture, explicit for anyone deploying this for the first time:**
- Gemini (`GEMINI_API_KEY` + `AI_IMAGE_PROVIDER=gemini`) stays disabled unless BOTH are set intentionally in that environment's own secrets — an unset or partially-set pair always falls back to the safe `UnconfiguredAiImageProvider`, never a crash, never a fake result.
- Real payment processing is not implemented in any environment yet (`PAYMENT_PROVIDER_KEY_ID`/`_SECRET` are placeholders only) — the Premium plans page honestly shows "online payment is coming soon" regardless of environment.
- `POST premium/dev/activate` (grants Premium to the calling user with no payment, for local testing) is hard-blocked whenever `NODE_ENV=production` — set that variable in every real deployment target, not just as a default assumption.

## Realtime & WebSocket infra

Socket.IO server runs inside `apps/backend` — no separate realtime service in V1. If horizontal scaling of the backend becomes necessary, Socket.IO's Redis adapter is the documented next step (rooms need to fan out across instances) — not needed until there's more than one backend instance running.

## Resolved (previously open)

- Hosting posture: cost-conscious, provider-agnostic, no AWS-first design — confirmed above.
- Specific vendor within each row (Railway vs. Render, R2 vs. S3) remains a low-stakes implementation-time pick, not an architectural fork — none of these choices touch application code differently.
