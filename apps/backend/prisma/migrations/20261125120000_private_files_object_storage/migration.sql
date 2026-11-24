-- Additive: finance receipts and Work evidence photos can live in private object storage.
-- Existing rows keep their bytes; new rows store only the object key.
ALTER TABLE "finance_attachments" ALTER COLUMN "data" DROP NOT NULL,
ADD COLUMN "storageKey" VARCHAR(200);

ALTER TABLE "work_evidence_files" ALTER COLUMN "content" DROP NOT NULL,
ADD COLUMN "storageKey" VARCHAR(200);
