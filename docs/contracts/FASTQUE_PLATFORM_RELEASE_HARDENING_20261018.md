# Platform integration release gates — 18 October 2026

## Source and scope

Base: frontend integration #255 at `4e1eb3c792da551536bff11cd7af630c902bbe22`, containing backend #254 at `3aebc183023b6ad756c0ca5744ef06d8e3025d53`.
Production/master observed: `92c288a6f4c1c5abc4b8b7db9364fac4e0a886bd`.
This follow-up changes backend capability reporting and certification infrastructure. It does not implement the unfinished roadmap or activate providers.

## Capabilities contract correction

`GET /api/v1/dashboard/salons/:salonId/capabilities` keeps the existing DTO and requires a STAFF session with salon-scoped owner authorization.

| Key | Status | Meaning |
| --- | --- | --- |
| revenueReport | ENABLED | Registered revenue reporting/CSV endpoints; actual collections remain distinct from estimated value. |
| inventory | ENABLED | Registered inventory APIs with transaction and salon authorization checks. |
| locationPin | ENABLED | Owner location proposals and separate admin review; proposing never changes the public location immediately. |
| contactImport | UNCONFIGURED / CONTACT_IMPORT_PREVIEW_ONLY | Validation preview exists; durable contact import/consent/invitation is incomplete. Preview may be presented explicitly as preview, not as a completed import. |
| aiDescription | UNCONFIGURED / SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED | The registered provider is deliberately unavailable. Environment variables alone cannot enable it. |
| demoData | SANDBOX when OWNER_DEMO_WORKSPACE_ENABLED is exactly `true`; otherwise DISABLED / FEATURE_DISABLED | Private synthetic workspace only; no live provider calls. |
| Other keys | UNCONFIGURED / FEATURE_NOT_IMPLEMENTED | No complete usable implementation in this candidate. |

The existing `updatedAt: null` means no persisted activation timestamp. These values advertise functionality only; they do not replace endpoint authorization or certify deployment.

## Read-only database evidence

Neon project `muddy-paper-72512632`, default/primary branch `br-bold-shadow-b3ksj1h6` (`main`), database `neondb`, PostgreSQL 18.
54 successful migration records, three historical rolled-back attempts, no unresolved attempt. All successful checksums match committed SQL after accounting for representation: 20 LF, 34 CRLF. No applied SQL was rewritten.

Pending migrations and canonical Git blob SHA-256:

| Migration | SHA-256 |
| --- | --- |
| 20261017010000_booking_attribution_campaigns | 72807e5165ffc88015a4af021e5d0dab5a29c07e27d9065e893930a6ab57075e |
| 20261017090000_salon_photo_activation_requirement | e5b0da0c4d71921c2fb26f3ddfdb59814c0411c048044ca1976572c217518759 |
| 20261017120000_salon_location_verification_proposals | 40e6e443eca2e1814edf96db491c937d902a6ba548c3d2eba8706b36e055ca5c |
| 20261017140000_inventory_core | 67c7f502353c232a0994bf4d23378402abdc321ef6a9a43b747f01f89f4657b1 |
| 20261017150000_owner_demo_workspaces | 711de3938f6c6c02b1d0cd5f1ccae329a7f0f16954261d7a9dfa4b7d6c4fe1c3 |

The five migrations are additive but still need lock-duration and data-preservation rehearsal for the actual release. Booking indexes and a foreign-key scan may block writes while their DDL transaction runs. They do not change automatic assignment preferences.

Recovery metadata: six-hour history retention is configured (`21600` seconds). The listed manual snapshot is `snap-autumn-rice-b348n707` from 12 October. Backup branches `br-cool-mountain-b36ihovj` and `br-super-surf-b3da2s28` retain 14 October points. These are not a fresh release recovery point. An earlier owner-reported successful restore remains historical evidence, not a restore drill for today's database.

The Neon connector is read-only: it cannot create a fresh branch/snapshot, restore, or supply branch passwords. A new isolated production-like rehearsal requires an authorized operator to create the branch and provide narrowly scoped access through a secure secret channel, or run the reviewed commands themselves. Never copy production data into public CI.

Railway OAuth reports `DATABASE_URL` and `DIRECT_DATABASE_URL` as set but redacts their values. Its inspected DNS stream returned no matching Neon records. Therefore the production runtime target, database name, and migration target are **not independently matched** to this project. Required evidence is a secure operator-side comparison of only hostname/endpoint ID, database and role for both URLs against Neon endpoint metadata; no passwords need to be shared.

## Certification added

The existing Owner Operations workflow now uses disposable PostgreSQL 18. It applies the full chain and seeds synthetic records before the five pending migrations, comparing every original public-table column before/after (migration bookkeeping excluded). The fixture includes an online booking, eleven standalone Live Queue visits (eight completed, three expired), an invoice, line and partial recorded payment.

After API/E2E checks, a custom-format dump restores into a second new disposable database. The drill compares all public table fingerprints and sequences, schema (including constraints, indexes and triggers), then tests restored financial UPDATE/DELETE and invoice-money rejection. Archives are not uploaded because authentication fixtures may include token hashes. This certifies synthetic PostgreSQL restore behavior only, never Neon PITR.

## Controlled release mechanism — not executed

Live Railway configuration has both backend and web on `master` with `checkSuites:false`. Backend pre-deploy runs Prisma deploy using `DIRECT_DATABASE_URL`. Web watches both `/apps/web/**` and `/packages/shared/**`. Merging #254/#255 as-is can start both deployments concurrently; green PR workflows do not enforce ordering.

The release is blocked until an authorized operator approves and performs this bounded rollout control:

1. Revalidate source/checks, freeze concurrent releases, and record both healthy deployment IDs and SHAs.
2. Verify the runtime and migration database targets, fresh recovery point, isolated restore and populated migration rehearsal. Record counts/hashes and expected pending migration names.
3. Create a temporary web-hold Git branch at the currently serving web commit. Change **only web's source branch** to that hold branch using Railway's reviewed configuration workflow. Read back live/staged state and confirm no web deployment is applying; a required rebuild must finish serving the same old commit. Do not change secrets or domains. This production configuration action requires release authorization.
4. Require that web is pinned to the hold branch and backend remains on master before any merge. If pinning cannot be verified, stop. No workflow in this PR attempts to bypass that requirement.
5. Merge only the fully certified release scope under repository review rules. Watch backend pre-deploy and startup. Verify exact SHA, expected applied migrations, health, authenticated access, bookings/queue/payment compatibility and error telemetry. Never retry a failed migration blindly.
6. Only after backend acceptance, point web back to master and verify the resulting web deployment SHA, then authenticated browser acceptance. This is the website release step. Avoid a duplicate manual deployment when Railway starts one automatically.
7. Confirm both services' intended source configuration and stable health. Record timestamps, deployment IDs and any observation limits.

Until the hold branch configuration is actually read back, this is a prepared procedure, not verified deployment ordering. No Railway settings were changed by this audit.

## Rollback

Record the prior healthy web/backend deployment IDs before release. Keep the hold branch available through acceptance. On a severe issue, halt web advancement first. Roll back application images only after testing the previous backend against the migrated schema and representative new records. The five additive migrations are retained; new data remains in place. Never drop inventory, campaign, proposal or demo tables to reverse an application release. A database restore is a separate incident decision requiring explicit authorization and verified recovery evidence. Do not force-reset master or disable financial triggers.

## Remaining gates

- Fresh production recovery point and verified isolated production-like restore.
- Independent Railway runtime/migration target match.
- Current combined CI including new synthetic recovery drill.
- Previous backend/new schema compatibility and Android 1.0.3 request-contract acceptance; device execution remains separate.
- Approved and verified web-hold rollout control.
- Authenticated production owner acceptance after any future approved release.
- Separate unfinished requirements (offers/deals, assistants, subscriptions, consultation and professional marketplace, full contacts, OTP/employee/email/history integrations) must not be described as complete based on this PR.

**Production decision: NO-GO until the mandatory gates above are evidenced.**
