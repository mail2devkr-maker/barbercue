-- Additive native push registration and durable per-device delivery outbox.
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');
CREATE TYPE "PushProvider" AS ENUM ('EXPO');

CREATE TABLE "push_devices" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" "PushPlatform" NOT NULL,
  "provider" "PushProvider" NOT NULL DEFAULT 'EXPO',
  "pushToken" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notifications"
  ADD COLUMN "pushDeviceId" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerReceiptCheckedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryClaimedAt" TIMESTAMP(3),
  ADD COLUMN "nextDeliveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "push_devices_pushToken_key" ON "push_devices"("pushToken");
CREATE UNIQUE INDEX "push_devices_provider_installationId_key" ON "push_devices"("provider", "installationId");
CREATE INDEX "push_devices_userId_enabled_idx" ON "push_devices"("userId", "enabled");
CREATE INDEX "notifications_channel_status_nextDeliveryAttemptAt_idx" ON "notifications"("channel", "status", "nextDeliveryAttemptAt");
CREATE INDEX "notifications_providerMessageId_idx" ON "notifications"("providerMessageId");

ALTER TABLE "push_devices"
  ADD CONSTRAINT "push_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_pushDeviceId_fkey" FOREIGN KEY ("pushDeviceId") REFERENCES "push_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
