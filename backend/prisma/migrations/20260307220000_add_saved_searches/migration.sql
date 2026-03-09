-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "criteria" JSONB NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_run_count" INTEGER NOT NULL DEFAULT 0,
    "total_imported" INTEGER NOT NULL DEFAULT 0,
    "is_scheduled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);
