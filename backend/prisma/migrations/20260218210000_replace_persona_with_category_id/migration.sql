-- AlterTable: Add category_id column to templates
ALTER TABLE "templates" ADD COLUMN "category_id" TEXT;

-- Data migration: Map existing persona values to category IDs
UPDATE "templates" SET "category_id" = (SELECT id FROM "categories" WHERE name = 'General Industry' LIMIT 1)
  WHERE "persona" = 'Industry Peer';

UPDATE "templates" SET "category_id" = (SELECT id FROM "categories" WHERE name ILIKE '%crypto%' LIMIT 1)
  WHERE "persona" ILIKE '%crypto%';

-- Drop the persona column
ALTER TABLE "templates" DROP COLUMN "persona";

-- Add foreign key constraint
ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
