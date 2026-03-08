-- AlterTable
ALTER TABLE "categories" ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT false;

-- Set Legacy category as protected
UPDATE "categories" SET "is_protected" = true WHERE "name" = 'Legacy';
