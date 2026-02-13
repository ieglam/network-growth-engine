-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('pending', 'merged', 'dismissed');

-- CreateTable
CREATE TABLE "duplicate_pairs" (
    "id" TEXT NOT NULL,
    "contact_a_id" TEXT NOT NULL,
    "contact_b_id" TEXT NOT NULL,
    "match_type" VARCHAR(50) NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_pairs_contact_a_id_contact_b_id_key" ON "duplicate_pairs"("contact_a_id", "contact_b_id");

-- CreateIndex
CREATE INDEX "duplicate_pairs_status_idx" ON "duplicate_pairs"("status");

-- AddForeignKey
ALTER TABLE "duplicate_pairs" ADD CONSTRAINT "duplicate_pairs_contact_a_id_fkey" FOREIGN KEY ("contact_a_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_pairs" ADD CONSTRAINT "duplicate_pairs_contact_b_id_fkey" FOREIGN KEY ("contact_b_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
