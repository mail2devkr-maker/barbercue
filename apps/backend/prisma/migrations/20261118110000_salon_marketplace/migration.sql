-- FastQue Marketplace: listings, orders (with line snapshots and status history), wishlist.
-- Purely additive. Stock stays on inventory_products; orders only reserve it and the sale leaves stock
-- through the existing inventory_movements ledger.

-- CreateEnum
CREATE TYPE "ShopListingStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShopFulfillment" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ShopPaymentMethod" AS ENUM ('PAY_AT_SALON', 'ONLINE');

-- CreateEnum
CREATE TYPE "ShopPaymentStatus" AS ENUM ('UNPAID', 'PAID_AT_SALON', 'PAID_ONLINE', 'REFUNDED');

-- CreateTable
CREATE TABLE "shop_listings" (
    "id" UUID NOT NULL,
    "salonId" TEXT NOT NULL,
    "inventoryProductId" TEXT NOT NULL,
    "globalProductId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "compareAtPrice" DECIMAL(12,2),
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxPerOrder" INTEGER NOT NULL DEFAULT 5,
    "status" "ShopListingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reviewNote" VARCHAR(300),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_orders" (
    "id" UUID NOT NULL,
    "orderNumber" VARCHAR(20) NOT NULL,
    "salonId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "contactName" VARCHAR(120) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "contactEmail" VARCHAR(254),
    "note" VARCHAR(300),
    "accessTokenHash" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PLACED',
    "fulfillment" "ShopFulfillment" NOT NULL DEFAULT 'PICKUP',
    "paymentMethod" "ShopPaymentMethod" NOT NULL DEFAULT 'PAY_AT_SALON',
    "paymentStatus" "ShopPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "acceptBy" TIMESTAMPTZ(6) NOT NULL,
    "placedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(6),
    "readyAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" VARCHAR(300),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "inventoryProductId" TEXT NOT NULL,
    "globalProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "compareAtPrice" DECIMAL(12,2),
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "productName" VARCHAR(160) NOT NULL,
    "brand" VARCHAR(120),
    "variant" VARCHAR(80),
    "barcode" VARCHAR(64),
    "stockMovementId" TEXT,

    CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "ShopOrderStatus",
    "toStatus" "ShopOrderStatus" NOT NULL,
    "actorUserId" TEXT,
    "actorKind" VARCHAR(12) NOT NULL,
    "note" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_wishlist_items" (
    "userId" TEXT NOT NULL,
    "globalProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_wishlist_items_pkey" PRIMARY KEY ("userId","globalProductId")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_listings_inventoryProductId_key" ON "shop_listings"("inventoryProductId");

-- CreateIndex
CREATE INDEX "shop_listings_globalProductId_status_idx" ON "shop_listings"("globalProductId", "status");

-- CreateIndex
CREATE INDEX "shop_listings_salonId_status_idx" ON "shop_listings"("salonId", "status");

-- CreateIndex
CREATE INDEX "shop_listings_status_updatedAt_idx" ON "shop_listings"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shop_orders_orderNumber_key" ON "shop_orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "shop_orders_idempotencyKey_key" ON "shop_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "shop_orders_salonId_status_placedAt_idx" ON "shop_orders"("salonId", "status", "placedAt");

-- CreateIndex
CREATE INDEX "shop_orders_customerUserId_placedAt_idx" ON "shop_orders"("customerUserId", "placedAt");

-- CreateIndex
CREATE INDEX "shop_orders_status_acceptBy_idx" ON "shop_orders"("status", "acceptBy");

-- CreateIndex
CREATE UNIQUE INDEX "shop_order_items_stockMovementId_key" ON "shop_order_items"("stockMovementId");

-- CreateIndex
CREATE INDEX "shop_order_items_orderId_idx" ON "shop_order_items"("orderId");

-- CreateIndex
CREATE INDEX "shop_order_items_inventoryProductId_idx" ON "shop_order_items"("inventoryProductId");

-- CreateIndex
CREATE INDEX "shop_order_items_globalProductId_idx" ON "shop_order_items"("globalProductId");

-- CreateIndex
CREATE INDEX "shop_order_events_orderId_createdAt_idx" ON "shop_order_events"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_inventoryProductId_fkey" FOREIGN KEY ("inventoryProductId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_globalProductId_fkey" FOREIGN KEY ("globalProductId") REFERENCES "global_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "shop_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_inventoryProductId_fkey" FOREIGN KEY ("inventoryProductId") REFERENCES "inventory_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_globalProductId_fkey" FOREIGN KEY ("globalProductId") REFERENCES "global_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_events" ADD CONSTRAINT "shop_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "shop_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_events" ADD CONSTRAINT "shop_order_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_wishlist_items" ADD CONSTRAINT "shop_wishlist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_wishlist_items" ADD CONSTRAINT "shop_wishlist_items_globalProductId_fkey" FOREIGN KEY ("globalProductId") REFERENCES "global_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money and quantity sanity, enforced by the database.
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_price_check" CHECK (
  "price" > 0 AND ("compareAtPrice" IS NULL OR "compareAtPrice" >= "price") AND "maxPerOrder" BETWEEN 1 AND 50
);
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_totals_check" CHECK (
  "subtotal" >= 0 AND "discountTotal" >= 0 AND "total" = "subtotal" - "discountTotal" AND "total" >= 0
);
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_quantity_check" CHECK (
  "quantity" > 0 AND "unitPrice" > 0 AND "lineTotal" = "unitPrice" * "quantity"
);
