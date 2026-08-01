# BarberCue — Deployment Architecture

Status: **V1 decisions finalized.** Guiding principle for V1: cost-conscious and provider-agnostic — nothing below is designed around a specific cloud vendor's proprietary services, so moving host later is a redeploy, not a rewrite.

## Environments

Three: `development` (local), `staging`, `production`. Each has its own Postgres instance, its own payment-gateway credentials (test-mode keys in dev/staging, live keys only in production), its own OTP provider credentials, and its own JWT signing secret. Nothing is shared across environments — a staging DB leak can never touch production payment credentials because they're not the same secret store entry.

## Environment variables (representative, not exhaustive)

```
DATABASE_URL
JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
OTP_PROVIDER_API_KEY
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
| Object storage (salon photos) | S3-**compatible** API (Cloudflare R2 preferred for V1 cost — no egress fees — but AWS S3 or Backblaze B2 work identically against the same interface) | Code targets the S3 API surface, not an AWS SDK-specific feature, so the storage vendor is a config value, not an integration |

This table intentionally avoids naming one "final" vendor per row as a locked commitment — it names the cost-conscious V1 default per your instruction, on infrastructure standard enough (Docker, Postgres, S3 API) that switching later costs a config change, not an architecture change.

## CI/CD

GitHub Actions:
- On every PR: install, typecheck, lint, unit tests, build all three apps (catches cross-package breakage from `packages/shared` changes immediately).
- On merge to `main`: deploy `apps/backend` and `apps/web` to staging automatically; run integration tests against staging.
- Production deploy: manual promotion (a workflow_dispatch or a tag push), never automatic — this is a payments-handling system, a bad auto-deploy shouldn't be one click away from customers' money.
- Database migrations run as a required CI step before the backend deploy completes (Prisma Migrate), never applied by hand against production.

## Migrations

Prisma Migrate, one migration history, applied in order across environments. No destructive migration (dropping a column/table) ships in the same release as the code that stops using it — always a two-step deprecate-then-remove, since staging and production can briefly run different backend versions during a rolling deploy.

## Realtime & WebSocket infra

Socket.IO server runs inside `apps/backend` — no separate realtime service in V1. If horizontal scaling of the backend becomes necessary, Socket.IO's Redis adapter is the documented next step (rooms need to fan out across instances) — not needed until there's more than one backend instance running.

## Resolved (previously open)

- Hosting posture: cost-conscious, provider-agnostic, no AWS-first design — confirmed above.
- Specific vendor within each row (Railway vs. Render, R2 vs. S3) remains a low-stakes implementation-time pick, not an architectural fork — none of these choices touch application code differently.
