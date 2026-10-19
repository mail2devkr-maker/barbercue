-- Backward-compatible service catalog refinement. Existing categories remain unchanged and all
-- historical service rows receive NULL; no booking, price, duration, or service identity changes.
ALTER TABLE "services" ADD COLUMN "subcategory" TEXT;
