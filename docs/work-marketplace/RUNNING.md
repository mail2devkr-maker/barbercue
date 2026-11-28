# Running FastQue Work locally

Everything is off by default. Add to `apps/backend/.env`:

```
WORK_MARKETPLACE_ENABLED=true
WORK_PAYMENT_PROVIDER=sandbox            # refused automatically when NODE_ENV=production
WORK_SANDBOX_WEBHOOK_SECRET=<any 16+ character string>
# WORK_PLATFORM_FEE_BPS=1000             # optional, employer-side fee, default 10%
```

Then the usual flow:

```bash
npm ci
npm run build:shared
cd apps/backend && npx prisma migrate deploy   # adds the work_* tables only
npm run start:dev                               # backend :3000
npm run dev:web                                 # web :3001
```

Never run `prisma migrate reset` or `prisma migrate dev` against the shared developer database.

## Try the whole flow (sandbox)

1. Sign in on `/login` as account A → `/work/business` → create your business → **Submit for verification**.
2. Sign in as a platform admin → `/dashboard/admin/work` → **Verify** the business.
3. As A: **Post a job** (try the smart draft), review the preview and quote → **Publish** → **Fund (sandbox)** → **Complete sandbox payment**.
4. Sign in as account B → `/work` → open the job → create a worker profile → **Take this job**.
5. As A, open the job to see the six-digit **check-in code**. As B, open the assignment, check in with it, complete the checklist, upload a photo, **Submit**.
6. As A, open the assignment → **Approve**. As admin → Payouts → **Settle (sandbox)**.
7. Admin → Ledger shows the trial balance; Audit shows the full history.

## Tests

```bash
npm run test --workspace=@barbercue/shared -- --runTestsByPath src/__tests__/work-marketplace.test.ts

# e2e: needs a disposable PostgreSQL database named work_marketplace_ci
createdb work_marketplace_ci
cd apps/backend
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/work_marketplace_ci?schema=public
bash scripts/verify-migration-chain.sh
npx jest --config ./test/jest-e2e.json --runInBand test/work-marketplace.e2e-spec.ts
```

CI runs the same in `.github/workflows/work-marketplace-certification.yml`.

## Real money by manual bank transfer (NEFT)

`WORK_PAYMENT_PROVIDER=manual_bank` is the production payment method until an RBI-authorised
payment partner is integrated. No code moves money: people do, and the system records it.

Backend environment (all four bank values are required; otherwise funding fails closed):

```
WORK_PAYMENT_PROVIDER=manual_bank
WORK_MANUAL_BANK_ACCOUNT_NAME=<company account name, as registered with the bank>
WORK_MANUAL_BANK_ACCOUNT_NUMBER=<company current account number>
WORK_MANUAL_BANK_IFSC=<branch IFSC>
WORK_MANUAL_BANK_BANK_NAME=<bank name>
```

`TOTP_ENCRYPTION_KEY` (already set in production) also encrypts workers' bank account numbers.

Daily finance routine (Admin → FastQue Work):

1. **Bank transfers** tab: for each line, find the credit on the company statement with the same
   reference in the remarks and exactly the amount shown. **Confirm received** with its UTR. A
   different amount is refused: contact the business instead. **Not received** after a reasonable
   wait lets the business create a new payment order. A UTR can be recorded only once.
2. **Payouts** tab: **Prepare pending payouts** (those whose worker has saved bank details), then
   **Download NEFT file** and upload it to the bank's bulk-NEFT screen. The file contains account
   numbers: keep it private and delete it after the upload. Every download is audited.
3. After the bank processes the batch: **Mark paid** with each UTR, or **Mark failed** with the
   bank's reason, then **Retry** once the worker has corrected their details.

Every confirmation goes through the same exactly-once settlement path as a provider webhook, so the
ledger, the job opening and the audit trail (who, when, UTR) behave identically.
