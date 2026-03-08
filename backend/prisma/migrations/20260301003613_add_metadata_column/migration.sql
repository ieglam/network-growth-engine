/*
  Warnings:

  - You are about to drop the column `search_vector` on the `contacts` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InteractionType" ADD VALUE 'linkedin_dm_sent';
ALTER TYPE "InteractionType" ADD VALUE 'linkedin_dm_received';

-- DropIndex
DROP INDEX "idx_contacts_search_vector";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "search_vector",
ADD COLUMN     "metadata" JSONB;
