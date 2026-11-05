CREATE TYPE "AccountDeletionRequestStatus" AS ENUM ('REQUESTED');

CREATE TABLE "account_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_deletion_requests_userId_key"
    ON "account_deletion_requests"("userId");

CREATE INDEX "account_deletion_requests_status_createdAt_idx"
    ON "account_deletion_requests"("status", "createdAt");

ALTER TABLE "account_deletion_requests"
    ADD CONSTRAINT "account_deletion_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
