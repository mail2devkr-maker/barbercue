# FastQue contact consent ledger — API contract v1 (requirement 13)

Status: **implemented, disabled by default, never sends anything.** Source of truth for types:
`packages/shared/src/contact-ledger.ts`. Evidence: `apps/backend/test/contact-ledger.e2e-spec.ts` (16 tests on
PostgreSQL, run three times locally and twice in CI).

## What it is — and is not

The existing `POST dashboard/salons/:salonId/contacts/preview` (PR #245) validates a pasted list and stores nothing. This
ledger adds the durable part that its comments say is missing before any invitation could ever be considered:

* **consent evidence** per shop (who attested, when the contact agreed, how, under which policy text, until when);
* a **platform-wide suppression list** (do-not-contact) that overrides every shop;
* **withdrawal** and **erasure** rules;
* a **retention** period with an explicit purge.

It is **not** an importer of names or contact details and **not** a sender. No SMS, WhatsApp, e-mail or invitation is
produced by any route here. Every response carries `dispatchEnabled: false` and
`dispatchBlockedReason: "PROVIDER_AND_APPROVAL_GATES_REQUIRED"`. Owner attestation is *evidence, not proof* and never
authorises a send.

## Off by default (fail closed)

All routes return `503 CONTACT_LEDGER_NOT_CONFIGURED` unless **both** `CONTACT_LEDGER_ENABLED=true` **and**
`CONTACT_LEDGER_HASH_KEY` (at least 32 characters) are set. One without the other stays closed. Capability
`contactImport` reads `UNCONFIGURED / CONTACT_IMPORT_PREVIEW_ONLY` when closed and `SANDBOX / CONSENT_LEDGER_NO_DISPATCH`
when open — never `ENABLED`, because nothing can be delivered.

## Data protection design

* **No phone number is stored or returned.** Records are matched by `HMAC-SHA256(E.164 number, CONTACT_LEDGER_HASH_KEY)`
  (lower-case hex). A database dump alone cannot be searched for a number. The key is a secret like any other, is never
  logged, and **must stay stable**: rotating it orphans every record and, more importantly, the do-not-contact list.
  (Re-hashing is impossible by design — the numbers are not kept.) Treat a leak of the key as a leak of a guessable
  index over a small number space and replace the whole ledger deliberately, not by rotation.
* Audit rows carry counts and record ids only — never a number, hash or name.
* Database CHECK constraints: lowercase 64-hex hash, status ∈ {ACTIVE, WITHDRAWN} consistent with `withdrawnAt`, expiry
  after capture, suppression reason ∈ {OPT_OUT, ERASURE_REQUEST, ADMIN}. They survive a dump/restore unchanged.

## Routes (owner = `SALON_OWNER` of that shop; ADMIN session for the admin route)

| Route | Purpose | Notes |
|---|---|---|
| `POST …/contacts/consents` | record the consent the owner states, per line | ≤ 250 lines; same line shape as `preview`; idempotent; 20 requests/min/route |
| `GET …/contacts/consents/summary` | `active`, `withdrawn`, `expired`, `expiringWithin30Days` | counts only |
| `POST …/contacts/consents/withdraw` | the contact asked to stop | `suppressEverywhere` adds them to the platform list; works for a number this shop never recorded |
| `POST …/contacts/consents/erase` | delete this shop's record of the number | keeps only the do-not-contact hash by default; `keepSuppression:false` forgets entirely |
| `POST admin/contact-ledger/purge-expired` | `PLATFORM_ADMIN`: delete records past retention | explicit; **no scheduler exists** |

Per-line outcomes: `RECORDED`, `ALREADY_RECORDED`, `SUPPRESSED`, `WITHDRAWN_BY_CONTACT`, `INVALID_PHONE`,
`CONSENT_REQUIRED`, `CONSENT_EVIDENCE_INCOMPLETE`, `CONSENT_TIMESTAMP_INVALID`, `DUPLICATE_IN_BATCH` (validation matches
the preview line for line, proven by a parity test).

## Rules

1. Consent is **per shop and purpose**; shop B's record never implies shop A's, and A's withdrawal does not touch B's.
2. A number on the **platform suppression list** can never be recorded by any shop, whatever the owner attests.
3. After a **withdrawal** the same shop can record the number again only with a consent **captured after** the withdrawal.
4. Recording the same contact again returns `ALREADY_RECORDED` and does **not** overwrite the original evidence;
   parallel identical requests leave exactly one row.
5. **Erasure** deletes this shop's row; other shops' rows are not this shop's to erase. The suppression hash survives
   (it is the minimum needed to honour the opt-out) unless the caller asks to forget it.
6. **Retention**: `expiresAt = recordedAt + CONTACT_CONSENT_RETENTION_DAYS` (default **365**, clamped to 30–1095). An
   expired record is never usable, is counted as `expired`, can be renewed by a fresh attestation, and is deleted only by
   the explicit purge.

## Owner decisions still required (nothing below is invented here)

* The **approved retention period** and wording (`policyVersion` is `…provisional…` until then) — current default is a
  placeholder.
* Whether an opt-out should always be platform-wide, who may lift a suppression and how the data subject proves identity.
* The **invitation policy** and channel (SMS/WhatsApp/e-mail), template/consent text, India DLT registration for SMS,
  quiet hours and frequency caps — none of which exist, so there is deliberately no dispatch code.
* Whether an automated retention purge is wanted (today it is manual).

## Operations

Set both variables only after the owner approves the retention policy. Enabling the ledger changes no existing behaviour;
disabling it again leaves the data in place and the routes closed.
