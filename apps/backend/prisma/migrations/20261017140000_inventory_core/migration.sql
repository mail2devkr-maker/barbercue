CREATE TYPE "InventoryUnit" AS ENUM (
  'EACH', 'GRAM', 'KILOGRAM', 'MILLILITER', 'LITER', 'PACK', 'BOX', 'OTHER'
);

CREATE TYPE "InventoryMovementKind" AS ENUM (
  'OPENING', 'PURCHASE', 'CONSUMPTION', 'ADJUSTMENT'
);

CREATE TABLE "inventory_categories" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalizedName" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_categories_id_salonId_key" UNIQUE ("id", "salonId"),
  CONSTRAINT "inventory_categories_salonId_normalizedName_key" UNIQUE ("salonId", "normalizedName"),
  CONSTRAINT "inventory_categories_salonId_fkey" FOREIGN KEY ("salonId")
    REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_suppliers" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "normalizedName" VARCHAR(120) NOT NULL,
  "contactName" VARCHAR(120),
  "phone" VARCHAR(40),
  "email" VARCHAR(254),
  "notes" VARCHAR(500),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_suppliers_id_salonId_key" UNIQUE ("id", "salonId"),
  CONSTRAINT "inventory_suppliers_salonId_normalizedName_key" UNIQUE ("salonId", "normalizedName"),
  CONSTRAINT "inventory_suppliers_salonId_fkey" FOREIGN KEY ("salonId")
    REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_products" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "categoryId" TEXT,
  "supplierId" TEXT,
  "name" VARCHAR(120) NOT NULL,
  "normalizedName" VARCHAR(120) NOT NULL,
  "sku" VARCHAR(80),
  "unit" "InventoryUnit" NOT NULL,
  "stockOnHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "averageUnitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reorderThreshold" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_products_id_salonId_key" UNIQUE ("id", "salonId"),
  CONSTRAINT "inventory_products_salonId_sku_key" UNIQUE ("salonId", "sku"),
  CONSTRAINT "inventory_products_stock_nonnegative_check" CHECK ("stockOnHand" >= 0),
  CONSTRAINT "inventory_products_cost_nonnegative_check" CHECK ("averageUnitCost" >= 0),
  CONSTRAINT "inventory_products_threshold_nonnegative_check" CHECK ("reorderThreshold" >= 0),
  CONSTRAINT "inventory_products_salonId_fkey" FOREIGN KEY ("salonId")
    REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_products_categoryId_salonId_fkey" FOREIGN KEY ("categoryId", "salonId")
    REFERENCES "inventory_categories"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_products_supplierId_salonId_fkey" FOREIGN KEY ("supplierId", "salonId")
    REFERENCES "inventory_suppliers"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "kind" "InventoryMovementKind" NOT NULL,
  "quantityDelta" DECIMAL(12,3) NOT NULL,
  "unitCost" DECIMAL(12,2),
  "stockAfter" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "averageUnitCostAfter" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reason" VARCHAR(300),
  "reference" VARCHAR(120),
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_salonId_idempotencyKey_key" UNIQUE ("salonId", "idempotencyKey"),
  CONSTRAINT "inventory_movements_quantity_nonzero_check" CHECK ("quantityDelta" <> 0),
  CONSTRAINT "inventory_movements_values_nonnegative_check" CHECK (
    "stockAfter" >= 0 AND "averageUnitCostAfter" >= 0 AND ("unitCost" IS NULL OR "unitCost" >= 0)
  ),
  CONSTRAINT "inventory_movements_request_hash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "inventory_movements_kind_shape_check" CHECK (
    ("kind" IN ('OPENING', 'PURCHASE') AND "quantityDelta" > 0 AND "unitCost" IS NOT NULL
      AND ("kind" = 'PURCHASE' OR "supplierId" IS NULL))
    OR ("kind" = 'CONSUMPTION' AND "quantityDelta" < 0 AND "unitCost" IS NULL AND "supplierId" IS NULL)
    OR ("kind" = 'ADJUSTMENT' AND "unitCost" IS NULL AND "supplierId" IS NULL
      AND length(btrim(COALESCE("reason", ''))) > 0)
  ),
  CONSTRAINT "inventory_movements_salonId_fkey" FOREIGN KEY ("salonId")
    REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_productId_salonId_fkey" FOREIGN KEY ("productId", "salonId")
    REFERENCES "inventory_products"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_supplierId_salonId_fkey" FOREIGN KEY ("supplierId", "salonId")
    REFERENCES "inventory_suppliers"("id", "salonId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_actorUserId_fkey" FOREIGN KEY ("actorUserId")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "inventory_products_salonId_isActive_normalizedName_idx"
  ON "inventory_products"("salonId", "isActive", "normalizedName");
CREATE INDEX "inventory_products_salonId_categoryId_idx"
  ON "inventory_products"("salonId", "categoryId");
CREATE INDEX "inventory_products_salonId_stockOnHand_idx"
  ON "inventory_products"("salonId", "stockOnHand");
CREATE INDEX "inventory_movements_salonId_recordedAt_id_idx"
  ON "inventory_movements"("salonId", "recordedAt", "id");
CREATE INDEX "inventory_movements_productId_recordedAt_id_idx"
  ON "inventory_movements"("productId", "recordedAt", "id");
CREATE INDEX "inventory_movements_salonId_kind_recordedAt_idx"
  ON "inventory_movements"("salonId", "kind", "recordedAt");

CREATE FUNCTION "fastque_inventory_stock_write_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."stockOnHand" IS DISTINCT FROM OLD."stockOnHand"
      OR NEW."averageUnitCost" IS DISTINCT FROM OLD."averageUnitCost")
     AND current_setting('fastque.inventory_movement_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'inventory stock and valuation may only change through an inventory movement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_products_stock_write_guard"
  BEFORE UPDATE OF "stockOnHand", "averageUnitCost" ON "inventory_products"
  FOR EACH ROW EXECUTE FUNCTION "fastque_inventory_stock_write_guard"();

CREATE FUNCTION "fastque_inventory_stock_insert_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."stockOnHand" <> 0 OR NEW."averageUnitCost" <> 0 THEN
    RAISE EXCEPTION 'inventory products must start with zero stock and valuation; record opening stock as a movement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_products_stock_insert_guard"
  BEFORE INSERT ON "inventory_products"
  FOR EACH ROW EXECUTE FUNCTION "fastque_inventory_stock_insert_guard"();

CREATE FUNCTION "fastque_inventory_apply_movement"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_stock DECIMAL(12,3);
  v_average_cost DECIMAL(12,2);
  v_new_stock DECIMAL(12,3);
  v_new_average_cost DECIMAL(12,2);
BEGIN
  IF NEW."quantityDelta" = 0 THEN
    RAISE EXCEPTION 'inventory movement quantity must be nonzero' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" IN ('OPENING', 'PURCHASE') AND (NEW."quantityDelta" <= 0 OR NEW."unitCost" IS NULL) THEN
    RAISE EXCEPTION 'incoming inventory movement requires positive quantity and unit cost'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'CONSUMPTION' AND (NEW."quantityDelta" >= 0 OR NEW."unitCost" IS NOT NULL OR NEW."supplierId" IS NOT NULL) THEN
    RAISE EXCEPTION 'consumption movement shape is invalid' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'ADJUSTMENT' AND (NEW."unitCost" IS NOT NULL OR NEW."supplierId" IS NOT NULL OR length(btrim(COALESCE(NEW."reason", ''))) = 0) THEN
    RAISE EXCEPTION 'adjustment requires a reason and cannot set cost or supplier' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'OPENING' AND NEW."supplierId" IS NOT NULL THEN
    RAISE EXCEPTION 'opening movement cannot specify a supplier' USING ERRCODE = 'check_violation';
  END IF;

  SELECT "stockOnHand", "averageUnitCost"
    INTO v_stock, v_average_cost
    FROM "inventory_products"
    WHERE "id" = NEW."productId" AND "salonId" = NEW."salonId"
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory product not found in salon' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW."kind" = 'OPENING' AND (
      v_stock <> 0 OR EXISTS (SELECT 1 FROM "inventory_movements" m WHERE m."productId" = NEW."productId")
    ) THEN
    RAISE EXCEPTION 'opening stock may only be recorded once before any other movement'
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_stock := v_stock + NEW."quantityDelta";
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'inventory movement would result in negative stock' USING ERRCODE = 'check_violation';
  END IF;

  v_new_average_cost := v_average_cost;
  IF NEW."kind" IN ('OPENING', 'PURCHASE') THEN
    IF v_stock = 0 THEN
      v_new_average_cost := NEW."unitCost";
    ELSE
      v_new_average_cost := round(((v_stock * v_average_cost) + (NEW."quantityDelta" * NEW."unitCost")) / v_new_stock, 2);
    END IF;
  END IF;

  PERFORM set_config('fastque.inventory_movement_write', 'on', true);
  UPDATE "inventory_products"
    SET "stockOnHand" = v_new_stock,
        "averageUnitCost" = v_new_average_cost,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = NEW."productId" AND "salonId" = NEW."salonId";
  PERFORM set_config('fastque.inventory_movement_write', 'off', true);

  NEW."stockAfter" := v_new_stock;
  NEW."averageUnitCostAfter" := v_new_average_cost;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_movements_apply_stock"
  BEFORE INSERT ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "fastque_inventory_apply_movement"();

CREATE FUNCTION "fastque_inventory_movements_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory movements are append-only; record a correcting adjustment instead'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "fastque_inventory_movements_append_only"();
