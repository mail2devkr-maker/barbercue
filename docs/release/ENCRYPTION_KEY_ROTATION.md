# TOTP_ENCRYPTION_KEY rotation — procedure, tooling and evidence

Status: **tooling built and tested on disposable data; NOT run against any real database.** Rotating the live key needs
an explicit, separately approved operational procedure (owner GO naming the target, the time and the backup).

## What the key protects

`TOTP_ENCRYPTION_KEY` seals values with AES-256-GCM (`CryptoService`, format `iv.ciphertext.tag`, key = scrypt of the
secret). In the 26-requirement release candidate it protects exactly one column: `users.totpSecret`
(administrator authenticator secrets). The list of protected columns lives in
`apps/backend/src/ops/key-rotation/targets.ts` — **any new feature that seals data with this key must register its
columns there**, otherwise a rotation silently orphans them.

The HR permanent-ID register (PR #288, a separate release) additionally derives its contact encryption and its keyed
blind indexes from this key. Its columns are *not* covered by the candidate's target list. Before HR is ever deployed
the HR branch must ship its own rotation target (re-seal the contact ciphertexts, recompute the blind indexes) and a
test like `key-rotation.e2e-spec.ts` against its tables. Until then: **do not rotate this key after HR is live, and do
not deploy HR on top of a key you intend to rotate** (rotating first, while the register is empty, is the safe order).

## Why a naive rotation locks administrators out

Changing the env var without re-encrypting makes every authenticator secret unreadable (`TOTP_SETUP_REQUIRED` /
forced re-enrolment). Re-encrypting without changing the env var does the same. And because a rollout is not
instantaneous, there is always a moment when some instances hold the old key and the rows hold the new one.

## The mechanism

* **`TOTP_ENCRYPTION_KEY_SECONDARY`** (optional, decrypt-only). `CryptoService` always writes with
  `TOTP_ENCRYPTION_KEY`, reads with it first and falls back to the secondary key. A value neither key opens fails
  exactly as before. Setting it equal to the primary is ignored.
* **`apps/backend/scripts/key-rotation/rotate-encryption-key.ts`** (`plan` | `apply` | `verify`).
  * keys only from `OLD_TOTP_ENCRYPTION_KEY` / `NEW_TOTP_ENCRYPTION_KEY` (never arguments, never printed);
  * `plan` and `verify` are read-only; `apply` is one transaction over every target with the rows locked
    `FOR UPDATE`;
  * a value that neither key opens aborts the run before any write (exit 3, ids only);
  * every re-sealed value is re-opened with the new key and compared with the original plaintext before commit, and
    the whole table is re-read inside the transaction;
  * already-rotated values are left byte-identical, so a run can be repeated or resumed;
  * `apply` needs `--backup-verified` and `--confirm-host=<database host>`, and a non-loopback host additionally needs
    `ROTATION_ALLOW_REMOTE=yes`;
  * output is counts and row ids only: no keys, plaintext, ciphertext or connection strings.

## Cut-over order (zero-lockout)

Preconditions: a fresh, restorable database recovery point taken just before step B; the candidate that contains this
mechanism is already deployed everywhere (step 0); a new 64-hex-character key generated and held only by the owner.

| Step | Action | Administrators' access |
|---|---|---|
| 0 | Deploy the release that contains `TOTP_ENCRYPTION_KEY_SECONDARY` support. Env unchanged. | unchanged |
| A | Set `TOTP_ENCRYPTION_KEY_SECONDARY=<NEW>` (primary stays `<OLD>`), redeploy **every** backend instance. | unchanged: nothing reads NEW yet |
| B | `plan`, then `apply` (old=OLD, new=NEW). | unchanged: OLD-primary instances read NEW rows through the secondary |
| C | Set `TOTP_ENCRYPTION_KEY=<NEW>` and `TOTP_ENCRYPTION_KEY_SECONDARY=<OLD>`, redeploy. | unchanged |
| D | `apply` again (changes only rows written under OLD during the window, usually 0), then `plan`: `pending 0`. | unchanged |
| E | Remove `TOTP_ENCRYPTION_KEY_SECONDARY`, redeploy, run `verify` with the NEW key only. Destroy the old key. | unchanged |

Rollback at any point before E: run `apply` with the keys swapped (old=NEW, new=OLD) and restore the env; the
authenticator secrets are identical, only the seal changes. A restored database backup is the last resort.

## Evidence (disposable PostgreSQL 18, synthetic administrators, real Nest application)

* `src/ops/key-rotation/rotate.spec.ts` (unit): CryptoService ⇄ tool byte-compatibility in both directions;
  secondary-key fallback, retirement and tamper/foreign-key rejection; plan is read-only; apply preserves plaintext,
  leaves rotated/empty values byte-identical, is idempotent and resumable; unreadable values abort with no write; a
  concurrent change rolls everything back; identical keys, missing required table and unsafe identifiers refused.
* `test/key-rotation.e2e-spec.ts` (9 tests, run twice): a real application is booted under each configuration of the
  table above and the TOTP-gated reserved-employee-ID operation (which decrypts the caller's secret) succeeds in every
  step; an OLD-only stale instance is refused cleanly after re-encryption (`TOTP_SETUP_REQUIRED`, nothing written);
  the swapped-key rollback restores access with the same authenticator secrets.
* CLI run on a throw-away database: `plan` → guards (exit 2 without `--backup-verified` / wrong host) → `apply`
  (3 changed) → repeat (0 changed) → `verify` with the new key alone → refusal with a planted unreadable value (exit 3,
  nothing written) → output scanned: no key, URL or password appears.

## Not covered / open

* Production: nothing has been run, and Railway builds/redeploys were not available to the FastQue workspace at the
  last check, so steps A, C and E cannot be executed yet.
* `OTP_HASH_SECRET`, `JWT_ACCESS_SECRET` etc. are separate secrets with their own (simpler) impact — see
  `RAILWAY_INCIDENT_CREDENTIAL_INVENTORY.md`.
