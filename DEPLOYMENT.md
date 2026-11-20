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
GEMINI_API_KEY                  # Gemini provider (style advisor, and menu/catalog/sales-coach when they select gemini); unset = disabled, not broken
LOCAL_VISION_URL / LOCAL_VISION_MODEL   # self-hosted vision model on the private network (see "Self-hosted AI")
LOCAL_WHISPER_URL               # self-hosted whisper.cpp for the local sales coach
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

### Mobile app identifier — `com.dcw.fastque`

`apps/mobile/app.json` declares `com.dcw.fastque` for both `android.package` and
`ios.bundleIdentifier`, renamed from the original `com.dcw.barbercue` so the shipped identifier
matches the FastQue brand. This was done before the first Play Console submission on purpose: an
Android `applicationId` is immutable once published, so this was the last free moment to change it.
No iOS build had ever run either, so that identifier moved at zero cost.

Google-side configuration is in place, all inside the **existing** `barbercue` Firebase project
(project number `871155185690`) so the FCM credential and the web OAuth client carry over
untouched:

- Firebase **Android app** `com.dcw.fastque` ("FastQue Android") is registered, and
  `apps/mobile/google-services.json` is the genuine file downloaded from it. That file now carries
  **both** packages — the old app is deliberately still registered so the currently-installed
  build keeps working until the renamed build is verified on a device.
- The app's signing SHA-1 `04:AC:C1:4A:78:60:3C:10:98:4F:82:1E:4B:8A:C8:39:FA:12:AA:DD` is
  registered on that Firebase app, and a matching Google **Android OAuth client** ("FastQue
  Android") exists for `com.dcw.fastque` + that SHA-1.
- The **web** OAuth client is unchanged, and no backend change was needed: the app passes the web
  client ID as `serverClientId` and the backend accepts it as the token audience, neither of which
  the package rename touches. (Note that the pre-existing `com.dcw.barbercue` app has no SHA-1
  registered in Firebase at all and Google Sign-In still works, which confirms this flow does not
  depend on the package/SHA-1 binding — the Android OAuth client is registered for correctness and
  future-proofing, not because auth requires it.)

**Remaining step before any Android build — assign the existing keystore.** EAS keys Android
credentials by application identifier, so `com.dcw.fastque` starts as an empty credentials slot and
a build would otherwise generate a *fresh* keystore, changing the SHA-1 above and invalidating the
OAuth client. Run `eas credentials -p android` (interactive only — the CLI has no non-interactive
path for this), select the `com.dcw.fastque` application id, and assign the same keystore already
used by `com.dcw.barbercue` rather than letting EAS generate one. Verify afterwards that a built
APK still reports the SHA-1 above.

Do not delete the old Firebase Android app or the old OAuth client until the renamed build is
verified on a device.

Note for testers: the renamed app installs **alongside** the old one rather than upgrading it. The
previous `com.dcw.barbercue` install must be removed manually, and because `expo-secure-store` data
is scoped per package, the first launch of the renamed app starts signed out and registers a new
push token.

## Self-hosted AI (alternative to Google Gemini)

Three production features can read images or recordings with AI: onboarding menu-photo reading, the owner's PDF/photo catalog import, and the CRM sales coach. Each one picks its provider explicitly. Gemini is still an option and is unchanged. The self-hosted option runs **on FastQue's own Railway project, on the private network**. The backend refuses any model URL that is not loopback, RFC1918, `*.local` or `*.railway.internal`, so it cannot be aimed at a paid cloud API or at a tunnel to someone's PC.

| Feature | Switch | Provider variable | Self-hosted needs |
|---|---|---|---|
| Onboarding menu photo | `ONBOARDING_MENU_EXTRACTION_ENABLED=true` | `ONBOARDING_MENU_EXTRACTION_PROVIDER` = `gemini` (default) \| `local` \| `none` | `LOCAL_VISION_URL` |
| Owner catalog import (PDF/photo) | none; available once a provider is configured | `CATALOG_IMPORT_OCR_PROVIDER` = `gemini` (default) \| `local` \| `none` | `LOCAL_VISION_URL`. **Photos only.** PDFs get a 415 telling the owner to use on-device extraction |
| CRM sales coach (audio) | `SALES_COACH_ENABLED=true` | `SALES_COACH_PROVIDER` = `none` (default) \| `gemini` \| `local` | `LOCAL_WHISPER_URL` (speech-to-text) **and** `LOCAL_VISION_URL` (analysis of the transcript) |

Defaults keep today's behaviour: with no new variable set, menu reading and catalog import still use Gemini when `GEMINI_API_KEY` is present. A provider that is selected but not fully configured fails closed with the existing "not configured" / 503 responses. Nothing ever falls back silently from `local` to Gemini or the other way round.

**Why PDFs are not supported on the local provider.** Vision models take images, not PDFs. Server-side rasterising would need a PDF renderer such as pdf.js with a native canvas, or poppler/mupdf binaries in the backend image. That means parsing untrusted owner-uploaded PDFs inside the API process, and every extra page multiplies a CPU-only model's run time. The dashboard already has free on-device OCR for PDFs (`apps/web/lib/catalog-local-ocr`), so the server does not need to rasterise. When the local provider is active, the dashboard says PDFs need on-device extraction or one photo per page, and its consent text names "FastQue's self-hosted AI model" rather than Google Gemini.

### Running Ollama + a vision model as a Railway internal service

1. In the same Railway project and environment as the backend, add a service from the Docker image `ollama/ollama` (pin a specific version tag, not `latest`). **Do not generate a public domain** for it. It is reached only over private networking.
2. Attach a **Volume** mounted at `/root/.ollama`, so models survive redeploys (a 7B vision model is about 6 GB on disk).
3. Service variables:
   - `OLLAMA_HOST=[::]:11434` binds dual-stack. Railway private networking can be IPv6-only, and Ollama's default `127.0.0.1` is unreachable from other services.
   - `OLLAMA_CONTEXT_LENGTH=8192`. Images plus a long JSON menu do not fit the small default context.
   - `OLLAMA_KEEP_ALIVE=24h` avoids reloading the model on every request (a cold load takes tens of seconds).
   - `OLLAMA_NUM_PARALLEL=1` keeps one request at a time on CPU, so RAM stays predictable.
4. Pull the model once, from the service's shell (Railway → service → "Shell") or a one-off command:
   `ollama pull qwen2.5vl:7b` (or `qwen2.5vl:3b` / `gemma3:4b`, see below).
5. On the **backend** service, set for example:
   ```
   LOCAL_VISION_URL=http://ollama.railway.internal:11434     # use the Ollama service's own private hostname
   LOCAL_VISION_MODEL=qwen2.5vl:7b
   LOCAL_VISION_TIMEOUT_MS=300000
   ONBOARDING_MENU_EXTRACTION_PROVIDER=local                 # plus ONBOARDING_MENU_EXTRACTION_ENABLED=true
   CATALOG_IMPORT_OCR_PROVIDER=local
   ```
6. For the sales coach, also run whisper.cpp's `server` as a second internal service (built with ffmpeg, started with `--convert` so browser webm/ogg/mp4 recordings are accepted, a multilingual model such as `ggml-small.bin` for Hindi/Hinglish, listening on `0.0.0.0`/`::`, port 8080). Then set `LOCAL_WHISPER_URL=http://whisper.railway.internal:8080`, `SALES_COACH_PROVIDER=local` and `SALES_COACH_ENABLED=true`. The Action Assistant's `ASSISTANT_WHISPER_URL` is used as a fallback when `LOCAL_WHISPER_URL` is unset, so one whisper service can serve both.

### Honest cost and latency notes (CPU-only)

These are planning estimates, not measurements on FastQue's Railway plan. **Measure one real menu photo and one real recording before switching production**, and then set `LOCAL_VISION_TIMEOUT_MS` / `LOCAL_WHISPER_TIMEOUT_MS` from that measurement.

| Model (Ollama tag) | Disk | RAM while loaded | Quality for printed menus | Rough CPU-only time per menu photo (8 vCPU) |
|---|---|---|---|---|
| `qwen2.5vl:7b` (default) | ~6 GB | ~8–10 GB | best of these at small print, prices, Hindi text | minutes, not seconds (≈2–6 min for a dense menu) |
| `qwen2.5vl:3b` | ~3 GB | ~5–6 GB | noticeably weaker on small print | ≈1–3 min |
| `gemma3:4b` | ~3.3 GB | ~5–6 GB | fine for clear menus, weaker on dense tables | ≈1–3 min |

- Most of the time is spent generating output, not encoding the image: a 60-row menu is around 2–4k JSON tokens, and a CPU produces only a handful of tokens per second. The backend downsizes every image to at most 2048 px JPEG before sending it, which bounds the image-encoding cost.
- RAM is billed while the model is loaded. With `OLLAMA_KEEP_ALIVE=24h` that is all day, so a 7B model is roughly an always-on ~10 GB service. A shorter keep-alive saves RAM but adds a cold load to the first request after idling.
- One request at a time: concurrent uploads queue behind each other. Catalog import is a synchronous request, so the owner waits for it. Onboarding menu reading also waits. The sales coach runs in the background.
- whisper.cpp `small` on CPU transcribes very roughly at real time to 3× real time on a few vCPUs (a 20-minute meeting can take 10–20 min), using under 1 GB of RAM. `LOCAL_WHISPER_TIMEOUT_MS` defaults to 10 min (max 30).
- A GPU host would cut these times by an order of magnitude. Any such host must still be on the private network (no public endpoint).
- Accuracy: small local models misread prices more often than Gemini. Every path already requires human review before anything is saved: onboarding rows need employee confirmation and catalog rows need owner review. Keep that review.

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

`prisma migrate deploy` is non-interactive and additive-only by design: it applies pending migrations in filename order and never prompts for or performs a reset, unlike `prisma migrate dev` (a local-development-only command that can offer to reset on drift — never run this against a database with real data). A first-time deploy to a genuinely empty database replays the full migration history from scratch; every migration currently in `prisma/migrations/` has been verified (Phase 8A) to replay cleanly in that scenario **with one documented exception**: `20260830215000_ensure_primary_platform_admin` intentionally `RAISE EXCEPTION`s if no user row exists with the primary admin's email — it is a narrow, idempotent *"ensure this real account stays PLATFORM_ADMIN"* guard, not a bootstrap, and by design never fabricates that identity. Production has carried that account since before this migration was introduced, so `migrate deploy` runs it there with no manual step. Only a database that never had that account (a fresh/disposable one, e.g. for local certification or CI) needs a resolution step before continuing — see the migration's own file comment, and use `prisma migrate resolve --rolled-back <name>` (not `--applied`: the guard's `DO $$...$$` block fully rolls back on the exception, leaving no partial state to mark as skipped) so the migration still runs for real once the database's own conditions allow it, rather than being permanently treated as already applied.

**Current safety posture, explicit for anyone deploying this for the first time:**
- Gemini (`GEMINI_API_KEY` + `AI_IMAGE_PROVIDER=gemini`) stays disabled unless BOTH are set intentionally in that environment's own secrets — an unset or partially-set pair always falls back to the safe `UnconfiguredAiImageProvider`, never a crash, never a fake result.
- Real payment processing is not implemented in any environment yet (`PAYMENT_PROVIDER_KEY_ID`/`_SECRET` are placeholders only) — the Premium plans page honestly shows "online payment is coming soon" regardless of environment.
- `POST premium/dev/activate` (grants Premium to the calling user with no payment, for local testing) is hard-blocked whenever `NODE_ENV=production` — set that variable in every real deployment target, not just as a default assumption.

## Realtime & WebSocket infra

Socket.IO server runs inside `apps/backend` — no separate realtime service in V1. If horizontal scaling of the backend becomes necessary, Socket.IO's Redis adapter is the documented next step (rooms need to fan out across instances) — not needed until there's more than one backend instance running.

## Resolved (previously open)

- Hosting posture: cost-conscious, provider-agnostic, no AWS-first design — confirmed above.
- Specific vendor within each row (Railway vs. Render, R2 vs. S3) remains a low-stakes implementation-time pick, not an architectural fork — none of these choices touch application code differently.
