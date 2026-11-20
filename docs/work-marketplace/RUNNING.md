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
