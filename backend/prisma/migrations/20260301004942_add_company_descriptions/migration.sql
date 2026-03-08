-- CreateTable
CREATE TABLE "company_descriptions" (
    "id" TEXT NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_descriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_descriptions_company_name_key" ON "company_descriptions"("company_name");
