# Railway security incident (21–22 Oct 2026) — credential inventory, anomaly review, rotation plan

Prepared 22 Oct 2026 from the repository and from **read-only** checks. Nothing was rotated, changed, redeployed or
written in production. No secret value appears here; variables are named only.

## 1. Official status used (status.railway.com, read 22 Oct 2026)

Incident "Railway Platform Outage" (QH8L8B3E), still *Major Outage*. As of its 04:52 UTC update: **Enterprise builds and
redeploys restored; Pro, Hobby, Free and Trial still paused**, enabled in stages. Services with pre-deploy commands were
reported stuck at "Running pre-deploy command" (04:39 UTC). Railway rotated all bucket credentials, invalidated OAuth
sessions (20:19 UTC) and **all Railway API tokens (04:17 UTC)**, and **strongly recommends revoking every environment
variable stored in Railway** (incl. API keys and private-registry credentials), reviewing logs, and redeploying buckets
and reconnecting GitHub afterwards. Some steps need a redeploy, i.e. builds. FastQue's workspace plan tier is not
verifiable from here (all API tokens are invalid): **owner to confirm the tier in the Railway dashboard.**

Consequence for FastQue: the backend `preDeploy` runs `prisma migrate deploy`. A pre-deploy hang, or any redeploy while
the old instance is still serving, is exactly what must not happen unattended. No release and no rotation that needs a
redeploy until Railway reports builds and pre-deploy commands healthy for the workspace.

## 2. Credential consumers (names only)

| Variable | Class | Consumed by | Effect of rotating | Method |
|---|---|---|---|---|
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | database credential (Neon role `neondb_owner`, pooled + direct) | Prisma at runtime; `preDeploy` migrations (direct) | backend cannot connect until Railway holds the new value | Neon password reset **or** second role + cut-over; update both vars; redeploy; verify; revoke old |
| `TOTP_ENCRYPTION_KEY` | data-encryption key | `CryptoService` (admin authenticator secrets) | admins locked out if rotated naively | **tooling built**: `ENCRYPTION_KEY_ROTATION.md` |
| `JWT_ACCESS_SECRET` | signing key | access tokens (15 min), signed pagination cursors (admin CRM, customer directory, inventory) | outstanding access tokens and cursors fail once; clients refresh (refresh tokens are opaque, DB-hashed, 30 days, unaffected) | change env, redeploy; users re-sign-in only if a client cannot refresh |
| `OTP_HASH_SECRET` | HMAC key | hashes OTP codes (version-tagged) | OTPs issued before the change cannot be verified (minutes-long validity) | change env, redeploy |
| `RESEND_API_KEY` | provider API key (email) | password-reset / invitation e-mail | e-mail stops until updated | create new key at the provider, update, redeploy, delete old; review provider send logs for 21–22 Oct |
| `GEMINI_API_KEY` | provider API key (AI) | style advisor image provider, catalog import | feature off | revoke at the provider; review usage; the AI description feature (#10) is deliberately unconfigured |
| `OTP_PROVIDER_API_KEY`, `OTP_PROVIDER_TEMPLATE_NAME` | SMS provider | phone OTP (#26, #30) | none if unset | verify **unset** in production (real SMS is not authorised) |
| `OBJECT_STORAGE_KEY/SECRET/BUCKET/ENDPOINT` | storage credential | S3-compatible driver (only if `STORAGE_DRIVER` selects it) | uploads fail until updated | launch driver is local disk on a Railway volume; if a Railway bucket is used, Railway already rotated it: redeploy and reconnect |
| `PAYMENT_PROVIDER_KEY_ID/SECRET`, `PAYMENT_WEBHOOK_SECRET` | payment provider | not active | none | verify **unset** |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | seed-only | `prisma/seed.ts` | none | verify **unset** in production, remove if present |
| `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` | public identifiers | sign-in verification, client config | not secrets | no rotation |
| `REVALIDATE_SECRET` | shared secret | only in `.env.example`; no code reads it | none | remove if set |
| Railway API tokens, Railway↔GitHub grant | platform credentials | owner tooling, auto-deploy | invalidated by Railway | create new tokens; re-authorise the GitHub integration; revoke stale OAuth grants |

GitHub repository (read-only check, names only): **no Actions secrets, no variables, no deploy keys, no webhooks, one
collaborator (the owner, admin).** The workflows use only synthetic per-run secrets generated inside the job.

## 3. Anomaly review (what could be checked, and what could not)

Checked read-only, **no sign of tampering found**:

* Neon Project #2 (`main`): the last 40 project operations (00:16–07:29 UTC, 22 Oct) are only automatic compute
  start/suspend cycles; no branch, role, credential or password operation; **no branch exists that is newer than the
  21 Oct recovery branch**. The sole role `neondb_owner` has `updated_at` = `created_at` (18 Sep): its password has
  **never been rotated**, so any copy in Railway's variable store is still valid. Sole project member: the owner (admin).
  (Operations before 00:16 UTC on 22 Oct were not enumerated; role and branch checks cover the tampering vectors.)
* Application data (production, counts only, no personal data read): no new administrator role grants since 8 Oct
  (3 co-founder, 1 platform admin, 1 viewer; 4 administrators with 2FA); one ADMIN session created in the incident
  window (21 Oct 21:59 UTC); 12 new users in the window (customer sign-ups, 8 customer sessions). **To confirm with the
  owner:** three `EMPLOYEE_CREATED` audit events at 21 Oct 18:13 UTC, 77 minutes *before* the platform incident began
  (19:30 UTC) — expected to be HR/admin provisioning; please confirm they were authorised.
* GitHub: no secrets, hooks or deploy keys exist to leak (see §2).

**Could not be checked from here, owner action:** Railway's own audit log and service logs (all API tokens are invalid
and the dashboard is the owner's); the Railway variable *names* actually set in production; provider consoles (Resend
usage/sends, Google AI Studio usage, any SMS/payment consoles) for 21 Oct 19:30 UTC onward; Neon console "Audit" /
"Monitoring" views for source IPs; whether the Neon pooled endpoint saw unfamiliar clients.

## 4. Recommended order (each step needs an owner GO and, where marked, working Railway builds)

1. Owner exports the **names** (not values) of every variable set on each Railway service and confirms the workspace
   tier; compare with §2 and report any variable not listed.
2. Fresh Neon recovery point (branch) immediately before any change.
3. Providers first, no redeploy needed to *prepare*: create replacement keys at Resend / Google AI Studio.
4. **[needs builds]** one coordinated backend redeploy carrying: new `JWT_ACCESS_SECRET`, `OTP_HASH_SECRET`,
   provider keys, and `TOTP_ENCRYPTION_KEY_SECONDARY=<new key>` (rotation step A). Revoke the old provider keys after
   verifying sends.
5. **[needs builds]** database credential: preferred zero-downtime path = create a second Neon role with the
   application's privileges, switch both URLs, redeploy, verify, then revoke `neondb_owner`'s old password. (A plain
   password reset is simpler but causes an outage until Railway holds the new value.)
6. **[needs builds]** `TOTP_ENCRYPTION_KEY` cut-over per `ENCRYPTION_KEY_ROTATION.md` (steps B–E).
7. Re-authorise Railway↔GitHub, create new Railway API tokens, revoke stale OAuth grants.
8. After each step: admin sign-in with authenticator, customer OTP/refresh, a read-only smoke of the owner dashboard.

Nothing in 4–7 may run while Railway reports builds or pre-deploy commands unavailable for the workspace.
