-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('target', 'requested', 'connected', 'engaged', 'relationship');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('ic', 'manager', 'director', 'vp', 'c_suite');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('linkedin_message', 'email', 'meeting_1on1_inperson', 'meeting_1on1_virtual', 'meeting_group', 'linkedin_comment_given', 'linkedin_comment_received', 'linkedin_like_given', 'linkedin_like_received', 'introduction_given', 'introduction_received', 'manual_note', 'connection_request_sent', 'connection_request_accepted');

-- CreateEnum
CREATE TYPE "InteractionSource" AS ENUM ('manual', 'linkedin', 'gmail', 'calendar');

-- CreateEnum
CREATE TYPE "QueueItemStatus" AS ENUM ('pending', 'approved', 'executed', 'skipped', 'snoozed');

-- CreateEnum
CREATE TYPE "QueueActionType" AS ENUM ('connection_request', 'follow_up', 're_engagement');

-- CreateEnum
CREATE TYPE "QueueItemResult" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "StatusTransitionTrigger" AS ENUM ('manual', 'automated_promotion', 'automated_demotion', 'unfriended', 'import_trigger');

-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('relationship', 'priority');

-- CreateEnum
CREATE TYPE "MergeType" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ScoringConfigType" AS ENUM ('relationship_weight', 'priority_weight', 'timing_trigger', 'status_threshold', 'general');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "title" VARCHAR(200),
    "company" VARCHAR(200),
    "linkedin_url" VARCHAR(500),
    "email" VARCHAR(200),
    "phone" VARCHAR(50),
    "location" VARCHAR(200),
    "headline" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'target',
    "seniority" "Seniority",
    "relationship_score" INTEGER NOT NULL DEFAULT 0,
    "priority_score" DECIMAL(5,2),
    "notes" TEXT,
    "introduction_source" VARCHAR(200),
    "mutual_connections_count" INTEGER NOT NULL DEFAULT 0,
    "is_active_on_linkedin" BOOLEAN NOT NULL DEFAULT false,
    "has_open_to_connect" BOOLEAN NOT NULL DEFAULT false,
    "last_interaction_at" TIMESTAMP(3),
    "field_sources" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "relevance_weight" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_categories" (
    "contact_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "contact_categories_pkey" PRIMARY KEY ("contact_id","category_id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "source" "InteractionSource" NOT NULL DEFAULT 'manual',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "points_value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "persona" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(200),
    "body" VARCHAR(300) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "times_used" INTEGER NOT NULL DEFAULT 0,
    "acceptances" INTEGER NOT NULL DEFAULT 0,
    "responses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_items" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "queue_date" DATE NOT NULL,
    "action_type" "QueueActionType" NOT NULL,
    "template_id" TEXT,
    "personalized_message" TEXT,
    "status" "QueueItemStatus" NOT NULL DEFAULT 'pending',
    "snooze_until" DATE,
    "executed_at" TIMESTAMP(3),
    "result" "QueueItemResult",
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "from_status" "ContactStatus",
    "to_status" "ContactStatus" NOT NULL,
    "trigger" "StatusTransitionTrigger" NOT NULL,
    "trigger_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_history" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "score_type" "ScoreType" NOT NULL,
    "score_value" DECIMAL(7,2) NOT NULL,
    "recorded_at" DATE NOT NULL,

    CONSTRAINT "score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_history" (
    "id" TEXT NOT NULL,
    "primary_contact_id" TEXT NOT NULL,
    "merged_contact_id" TEXT NOT NULL,
    "merged_contact_data" JSONB NOT NULL,
    "merge_type" "MergeType" NOT NULL,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_conflicts" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "field_name" VARCHAR(100) NOT NULL,
    "manual_value" TEXT,
    "linkedin_value" TEXT,
    "email_calendar_value" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_value" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_config" (
    "id" TEXT NOT NULL,
    "config_type" "ScoringConfigType" NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" DECIMAL(7,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_tracker" (
    "id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "requests_sent" INTEGER NOT NULL DEFAULT 0,
    "cooldown_active" BOOLEAN NOT NULL DEFAULT false,
    "cooldown_started_at" TIMESTAMP(3),
    "cooldown_ends_at" TIMESTAMP(3),

    CONSTRAINT "rate_limit_tracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_linkedin_url_key" ON "contacts"("linkedin_url");

-- CreateIndex
CREATE INDEX "contacts_status_idx" ON "contacts"("status");

-- CreateIndex
CREATE INDEX "contacts_relationship_score_idx" ON "contacts"("relationship_score");

-- CreateIndex
CREATE INDEX "contacts_priority_score_idx" ON "contacts"("priority_score");

-- CreateIndex
CREATE INDEX "contacts_status_priority_score_idx" ON "contacts"("status", "priority_score" DESC);

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_deleted_at_idx" ON "contacts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "interactions_contact_id_occurred_at_idx" ON "interactions"("contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "queue_items_queue_date_status_idx" ON "queue_items"("queue_date", "status");

-- CreateIndex
CREATE INDEX "status_history_contact_id_idx" ON "status_history"("contact_id");

-- CreateIndex
CREATE INDEX "score_history_contact_id_recorded_at_idx" ON "score_history"("contact_id", "recorded_at");

-- CreateIndex
CREATE INDEX "data_conflicts_contact_id_resolved_idx" ON "data_conflicts"("contact_id", "resolved");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_config_config_type_key_key" ON "scoring_config"("config_type", "key");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_tracker_week_start_key" ON "rate_limit_tracker"("week_start");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AddForeignKey
ALTER TABLE "contact_categories" ADD CONSTRAINT "contact_categories_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_categories" ADD CONSTRAINT "contact_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_history" ADD CONSTRAINT "merge_history_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_conflicts" ADD CONSTRAINT "data_conflicts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
