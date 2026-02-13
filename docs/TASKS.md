# Network Growth Engine - Task List

> Each task represents one PR. Tasks are ordered by dependency and priority within each phase.

## Legend

- **Complexity:** S (Small, <4 hours), M (Medium, 4-8 hours), L (Large, 8+ hours)
- **Status:** `[ ]` Not started, `[x]` Complete, `[~]` In progress

---

## Foundation

### TASK-001: Project scaffolding

**Status:** `[x]`
**Complexity:** M
**Dependencies:** None

**Description:**
Initialize the monorepo with Next.js frontend, Node.js backend (Fastify), PostgreSQL database, and Redis. Set up Docker Compose for local development, TypeScript configuration, ESLint, Prettier, and basic CI pipeline.

**Acceptance Criteria:**

- [x] Next.js 14+ app with App Router created in `/frontend`
- [x] Node.js backend with **Fastify** in `/backend`
- [x] Docker Compose file with PostgreSQL 15 and Redis 7
- [x] TypeScript configured for both frontend and backend
- [x] ESLint + Prettier configured with shared config
- [x] `npm run dev` starts all services
- [x] Basic health check endpoint returns 200

---

### TASK-002: Database schema and Prisma setup

**Status:** `[x]`
**Complexity:** L
**Dependencies:** TASK-001

**Description:**
Define the complete database schema in Prisma, including all entities from the data model: Contact (with last_interaction_at and field_sources), Category, Tag, Interaction, Template, QueueItem, StatusHistory, ScoreHistory, MergeHistory, DataConflict, ScoringConfig, RateLimitTracker, Settings. Create initial migration and seed file.

**Acceptance Criteria:**

- [x] All 15 entities defined in Prisma schema (including Settings)
- [x] Contact includes `last_interaction_at` TIMESTAMP and `field_sources` JSONB
- [x] Template body is VARCHAR(300) for LinkedIn connection note limit
- [x] All relationships (foreign keys, join tables) correctly defined
- [x] JSONB fields for metadata columns
- [x] Enums for status, interaction_type, seniority, etc.
- [x] Indexes on status, relationship_score, priority_score
- [x] Full-text search index on contact name/company/title/notes
- [x] `npx prisma migrate dev` runs successfully
- [x] Seed file creates default categories and scoring config

---

### TASK-003: Seed default data

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Create seed script that populates default strategic categories with relevance weights, default scoring configuration (relationship weights, priority formula weights), and sample templates.

**Acceptance Criteria:**

- [x] 7 default categories seeded with weights from PRD
- [x] All relationship scoring weights seeded (meeting, email, DM, etc.)
- [x] Priority formula weights seeded (0.5, 0.3, 0.2)
- [x] 3 sample templates created (crypto exec, MBA, general)
- [x] Seed is idempotent (can run multiple times safely)

---

## Core Features (Phase 1)

### TASK-004: Contact CRUD API

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-002

**Description:**
Implement REST API endpoints for creating, reading, updating, and deleting contacts. Include soft delete logic, field source tracking (manual entry), and validation.

**Acceptance Criteria:**

- [ ] `POST /api/contacts` creates a contact (required: first_name, last_name)
- [ ] `GET /api/contacts/:id` returns contact with all fields
- [ ] `PUT /api/contacts/:id` updates contact, marks fields as manual source
- [ ] `DELETE /api/contacts/:id` soft-deletes (sets deleted_at)
- [ ] Validation rejects invalid data with clear error messages
- [ ] All endpoints return proper HTTP status codes

---

### TASK-005: Contact search and filter API

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-004

**Description:**
Implement search and filter endpoint for contacts with full-text search, multi-select filters, and sorting. Optimize for <200ms response with 10K contacts.

**Acceptance Criteria:**

- [ ] `GET /api/contacts` with query params for search/filter
- [ ] Full-text search across name, company, title, notes
- [ ] Filter by: status (multi), category (multi), tag (multi), score range, location
- [ ] Filters combine with AND logic
- [ ] Sorting by name, company, relationship_score, last_interaction, created_at
- [ ] Pagination with limit/offset
- [ ] Response time <200ms verified with 10K test records

---

### TASK-006: LinkedIn CSV import

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-004

**Description:**
Implement LinkedIn CSV export import with duplicate detection. Parse LinkedIn's standard export format, map to contact fields, run duplicate detection, and report results.

**Acceptance Criteria:**

- [ ] `POST /api/import/linkedin` accepts CSV file upload
- [ ] Parses LinkedIn export format (First Name, Last Name, URL, Email, Company, Position)
- [ ] Duplicate detection on LinkedIn URL (exact match)
- [ ] Duplicate detection on name + company (flagged for review)
- [ ] Imported contacts get status "connected", category "uncategorized"
- [ ] Returns summary: imported count, duplicates skipped, errors
- [ ] Import is idempotent (re-upload same file = no new records)

---

### TASK-007: Manual CSV import with column mapping

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-004

**Description:**
Implement generic CSV import with user-defined column mapping. Support any CSV format with mapping UI, default status "target", and duplicate detection.

**Acceptance Criteria:**

- [ ] `POST /api/import/csv/preview` returns column headers for mapping
- [ ] `POST /api/import/csv` accepts file + column mapping config
- [ ] Maps: name (required), company, title, linkedin_url, email, category
- [ ] Default status "target" for manual imports
- [ ] Duplicate detection runs before insert
- [ ] Unmapped columns ignored without error
- [ ] Supports CSVs without LinkedIn URLs (name+company minimum)

---

### TASK-008: Category CRUD and assignment

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Implement API for managing strategic categories (create, edit, delete, list) and assigning categories to contacts. Support multiple categories per contact.

**Acceptance Criteria:**

- [ ] `GET /api/categories` lists all categories with weights
- [ ] `POST /api/categories` creates category with name and weight
- [ ] `PUT /api/categories/:id` updates name or weight
- [ ] `DELETE /api/categories/:id` removes category (unassigns from contacts)
- [ ] `POST /api/contacts/:id/categories` assigns categories to contact
- [ ] Contact can have multiple categories

---

### TASK-009: Tag CRUD and bulk operations

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Implement API for freeform tags with autocomplete, assignment to contacts, and bulk operations (add/remove tag from multiple contacts).

**Acceptance Criteria:**

- [ ] `GET /api/tags` lists all tags with usage counts
- [ ] `GET /api/tags/autocomplete?q=` returns matching tags
- [ ] `POST /api/contacts/:id/tags` adds tags to contact
- [ ] `DELETE /api/contacts/:id/tags/:tagId` removes tag
- [ ] `POST /api/contacts/bulk/tags` adds tag to multiple contacts
- [ ] `DELETE /api/contacts/bulk/tags` removes tag from multiple contacts
- [ ] Contacts can have unlimited tags

---

### TASK-010: Template CRUD

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Implement API for connection note templates with personalization tokens. Support CRUD operations, persona tagging, and A/B variants. **Templates are for LinkedIn connection notes (300 char max).**

**Acceptance Criteria:**

- [ ] `GET /api/templates` lists all templates
- [ ] `POST /api/templates` creates template (name, persona, body)
- [ ] `PUT /api/templates/:id` updates template
- [ ] `DELETE /api/templates/:id` deletes template
- [ ] **Body max length: 300 characters (validated on save)**
- [ ] Body supports tokens: {{first_name}}, {{company}}, {{title}}, {{mutual_connection}}, {{recent_post}}, {{category_context}}, {{custom}}
- [ ] Templates tagged by persona
- [ ] Multiple templates per persona (A/B variants)

---

### TASK-011: Template token rendering

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-010

**Description:**
Implement token replacement engine that renders a template with contact data. Handle missing tokens gracefully. **Validate rendered output is ≤300 chars.**

**Acceptance Criteria:**

- [ ] `POST /api/templates/:id/render` with contact_id returns rendered connection note
- [ ] All tokens replaced with contact data
- [ ] Missing data: token removed or replaced with placeholder (configurable)
- [ ] **Returns character count and warns if rendered note exceeds 300 chars**
- [ ] Preview endpoint for testing: `POST /api/templates/:id/preview` with sample data

---

### TASK-014: Status transition service

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-004

**Description:**
Implement automated status transitions based on relationship score thresholds and interaction counts. Log all transitions in StatusHistory.

**Acceptance Criteria:**

- [x] Service checks status transitions during score calculation
- [x] connected → engaged: score ≥ 30 AND ≥ 2 interactions
- [x] engaged → relationship: score ≥ 60 AND ≥ 1 reciprocal interaction
- [x] Demotion: score below threshold for 30 consecutive days
- [x] Manual override API: `PUT /api/contacts/:id/status`
- [x] All transitions logged in StatusHistory with reason
- [x] Import can set initial status (skip linear progression)

---

### TASK-032: Relationship scoring batch job

**Status:** `[x]`
**Complexity:** L
**Dependencies:** TASK-004, TASK-031

**Description:**
Implement the nightly batch job that calculates relationship scores for all contacts using the defined formula with decay and reciprocity. **Moved to Phase 1 because daily queue requires scores to rank targets.**

**Acceptance Criteria:**

- [x] Bull job `score-batch-processor` registered
- [x] Scheduled to run overnight (2 AM)
- [x] Fetches all interactions per contact
- [x] Applies base points per interaction type (from ScoringConfig)
- [x] Applies 90-day half-life decay
- [x] Calculates reciprocity ratio, applies multiplier if ≥30%
- [x] Normalizes to 0-100
- [x] Updates contact.relationship_score
- [x] Logs to ScoreHistory
- [x] Triggers status transition check
- [x] Processes 10K contacts in <5 minutes

---

### TASK-033: Priority scoring service

**Status:** `[x]`
**Complexity:** M
**Dependencies:** TASK-008, TASK-032

**Description:**
Implement priority scoring for targets using relevance, accessibility, and timing factors. **Moved to Phase 1 because daily queue requires priority scores to rank targets.**

**Acceptance Criteria:**

- [x] Calculated for contacts with status "target"
- [x] Relevance: category weight × seniority multiplier, normalized 0-10
- [x] Accessibility: sum of applicable factors, capped at 10
- [x] Timing: sum of active triggers (job change, recent post, etc.)
- [x] Priority = (Relevance × 0.5) + (Accessibility × 0.3) + (Timing × 0.2)
- [x] Weights configurable via ScoringConfig
- [x] Updates contact.priority_score
- [x] Runs daily after relationship scoring

---

### TASK-012: Daily queue generation service

**Status:** `[x]`
**Complexity:** L
**Dependencies:** TASK-004, TASK-010, TASK-011, TASK-033

**Description:**
Implement the daily queue generation logic as a Bull job. Select top targets by priority score, match templates, render connection notes, add follow-ups and re-engagements, respect rate limits.

**Acceptance Criteria:**

- [x] Bull job `daily-queue-generation` registered
- [x] Scheduled to run at configurable time (default 7 AM)
- [x] Selects top 15-20 targets by priority_score
- [x] Matches template to contact based on persona/category
- [x] Renders personalized connection note for each (max 300 chars)
- [x] **Flags items where rendered note exceeds 300 chars for manual editing**
- [x] Adds follow-ups: connections from last 7 days without first message
- [x] Adds re-engagements: score dropped >15 in 30 days
- [x] Carries over yesterday's incomplete items
- [x] Respects weekly rate limit (doesn't exceed remaining capacity)
- [x] Creates QueueItem records with status "pending"

---

### TASK-013: Queue item management API

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-012

**Description:**
Implement API for managing queue items: list today's queue, mark items as done/skipped/snoozed, add notes, batch approve.

**Acceptance Criteria:**

- [ ] `GET /api/queue/today` returns today's queue items
- [ ] `PUT /api/queue/:id/done` marks done, logs interaction, prompts for note
- [ ] `PUT /api/queue/:id/skip` marks skipped, applies priority penalty
- [ ] `PUT /api/queue/:id/snooze` sets snooze_until date
- [ ] `POST /api/queue/approve` batch approves selected items
- [ ] `GET /api/queue/summary` returns counts: pending, completed, skipped, snoozed

---

### TASK-015: Basic dashboard API

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-004, TASK-008

**Description:**
Implement API endpoints for dashboard metrics: network size, growth rate, acceptance rate, category breakdown, score distribution.

**Acceptance Criteria:**

- [ ] `GET /api/dashboard/growth` returns size vs goal, growth rate, acceptance rate
- [ ] `GET /api/dashboard/categories` returns breakdown by category
- [ ] `GET /api/dashboard/scores` returns distribution by band (cold/warm/active/strong)
- [ ] `GET /api/dashboard/trends` returns time series data for charts
- [ ] Response cached in Redis (5 min TTL)

---

### TASK-016: Settings API

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Implement API for managing system settings: queue generation time, rate limits, notification preferences, guided mode toggle.

**Acceptance Criteria:**

- [ ] `GET /api/settings` returns all settings
- [ ] `PUT /api/settings` updates settings
- [ ] Settings: queue_generation_hour, linkedin_weekly_limit, linkedin_daily_limit, cooldown_days, guided_mode, notification_morning, notification_afternoon
- [ ] Settings stored in database, not env vars
- [ ] Changes take effect on next relevant operation

---

### TASK-017: Export API

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-004

**Description:**
Implement contact export in CSV and JSON formats. Support full export and filtered export.

**Acceptance Criteria:**

- [ ] `GET /api/export/contacts?format=csv` exports all contacts
- [ ] `GET /api/export/contacts?format=json` exports all contacts
- [ ] Supports same filters as search (export filtered subset)
- [ ] Includes all fields, scores, status, tags, categories
- [ ] `GET /api/export/contacts/:id` exports single contact (GDPR-style)
- [ ] Optional: include interactions as separate file

---

## UI (Phase 1)

### TASK-018: UI shell and navigation

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-001

**Description:**
Create the Next.js app shell with navigation, layout, and responsive design. Implement sidebar navigation with links to all main views.

**Acceptance Criteria:**

- [ ] App layout with sidebar navigation
- [ ] Navigation links: Dashboard, Queue, Contacts, Templates, Settings
- [ ] Responsive: sidebar collapses on mobile
- [ ] Tailwind CSS configured
- [ ] Dark mode support (optional, nice-to-have)

---

### TASK-019: Contact list view

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-005, TASK-018

**Description:**
Implement the contact list view with search, filters, sorting, and bulk actions. Use TanStack Table for performance with large datasets.

**Acceptance Criteria:**

- [ ] Table displays: name, company, title, status, relationship score, last interaction
- [ ] Search bar with full-text search
- [ ] Filter panel: status, category, tag, score range, location
- [ ] Sortable columns
- [ ] Pagination
- [ ] Checkbox selection for bulk actions
- [ ] Bulk actions: add tag, remove tag, change category
- [ ] Click row to navigate to detail view
- [ ] Performance: smooth scrolling with 1000+ rows visible

---

### TASK-020: Contact detail view

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-004, TASK-018

**Description:**
Implement the contact detail page showing all fields, scores, status timeline, interaction history, and quick actions.

**Acceptance Criteria:**

- [ ] Shows all contact fields in organized layout
- [ ] Displays relationship score with band indicator
- [ ] Displays priority score (for targets)
- [ ] Status badge with transition history expandable
- [ ] Interaction timeline: chronological list with type icons
- [ ] Conflict flags shown if any exist
- [ ] Quick actions: edit, change status, add note, add tag, recalculate score
- [ ] Link to LinkedIn profile (external)

---

### TASK-021: Contact create/edit form

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-004, TASK-018

**Description:**
Implement contact create and edit forms with all fields, validation, category/tag assignment, and manual flag handling.

**Acceptance Criteria:**

- [ ] Form with all contact fields
- [ ] Required field validation (first_name, last_name)
- [ ] Category multi-select
- [ ] Tag input with autocomplete
- [ ] Status dropdown (for manual override)
- [ ] Notes textarea
- [ ] Save marks edited fields as "manual" source
- [ ] Cancel discards changes

---

### TASK-022: CSV import wizard

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-006, TASK-007, TASK-018

**Description:**
Implement CSV import UI with file upload, format selection (LinkedIn vs manual), column mapping step, preview, and import execution with progress.

**Acceptance Criteria:**

- [ ] File upload dropzone
- [ ] Format selection: LinkedIn export or Manual CSV
- [ ] LinkedIn: automatic mapping, no column selection needed
- [ ] Manual: column mapping UI with dropdowns
- [ ] Preview shows first 5 rows with mapped fields
- [ ] Import button with progress indicator
- [ ] Results summary: imported, skipped, errors
- [ ] Error details expandable

---

### TASK-023: Daily queue view

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-012, TASK-013, TASK-018

**Description:**
Implement the daily action queue UI showing today's tasks, pre-filled connection notes, and action buttons (done, skip, snooze). Support guided mode workflow with LinkedIn connection note flow.

**Acceptance Criteria:**

- [ ] Queue summary at top: X connection requests, Y follow-ups, Z re-engagements
- [ ] Rate limit status widget: X of 100 this week
- [ ] List of queue items grouped by action type
- [ ] Each item shows: contact name, company, action type, connection note preview with **character count (X/300)**
- [ ] **Flag items where rendered note exceeds 300 chars with warning icon**
- [ ] Expand item to see full connection note, edit if needed
- [ ] Action buttons: Done, Skip, Snooze (3 days / 1 week)
- [ ] Done prompts for optional note
- [ ] Guided mode: "Show Instructions" shows **"Go to [URL], click Connect, click Add a note, paste: [note]"** with click-to-copy
- [ ] Batch "Approve & Execute" button (Phase 2: triggers automation)
- [ ] End-of-day summary accessible

---

### TASK-024: Template management view

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-010, TASK-011, TASK-018

**Description:**
Implement template list and editor with token insertion, preview, persona assignment, and performance stats. **Includes character count enforcement for 300-char LinkedIn limit.**

**Acceptance Criteria:**

- [ ] Template list showing name, persona, usage count, acceptance rate
- [ ] Create/Edit form with name, persona, body fields
- [ ] **Character count displayed live (X/300), warning at 280 (yellow), hard block at 300 (red)**
- [ ] Token insertion toolbar: click to insert {{first_name}}, etc.
- [ ] Live preview with sample contact data **showing rendered character count**
- [ ] Persona dropdown
- [ ] Active/inactive toggle
- [ ] Performance stats shown for templates with 20+ uses
- [ ] "Low sample" badge for templates under 20 uses

---

### TASK-025: Category management view

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-008, TASK-018

**Description:**
Implement category list and editor with relevance weight slider.

**Acceptance Criteria:**

- [ ] Category list showing name and relevance weight
- [ ] Create/Edit form with name and weight (1-10 slider)
- [ ] Delete with confirmation (warns about unassigning from contacts)
- [ ] Drag to reorder (optional, nice-to-have)

---

### TASK-026: Dashboard view

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-015, TASK-018

**Description:**
Implement the main dashboard with growth metrics, category breakdown, score distribution, and alerts.

**Acceptance Criteria:**

- [ ] Network size progress bar (700 → 7,000)
- [ ] Growth rate card (weekly/monthly)
- [ ] Acceptance rate card
- [ ] Category breakdown chart (pie or bar)
- [ ] Score distribution chart (cold/warm/active/strong)
- [ ] "Going cold" alert list (score dropped >15 in 30 days)
- [ ] Trend line chart (network size over time)
- [ ] Rate limit status widget

---

### TASK-027: Settings view

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-016, TASK-018

**Description:**
Implement settings page for configuring system behavior.

**Acceptance Criteria:**

- [ ] Queue generation time picker
- [ ] Rate limit inputs (weekly, daily)
- [ ] Cooldown duration input
- [ ] Guided mode toggle
- [ ] Notification toggles (morning queue, afternoon overdue)
- [ ] Save button with success feedback

---

## Core Features (Phase 1 continued)

### TASK-028: Duplicate detection service

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-004

**Description:**
Implement duplicate detection service that runs on import and can be triggered manually. Detect duplicates based on confidence hierarchy (URL, email, name+company, fuzzy name).

**Acceptance Criteria:**

- [ ] Same LinkedIn URL → auto-merge
- [ ] Same email → auto-merge (flag if LinkedIn profiles differ)
- [ ] Same name + same company → flag for manual review
- [ ] Fuzzy name + same company → flag for manual review
- [ ] Same phone → auto-merge
- [ ] Auto-merge: keep most complete record, preserve merge history
- [ ] Flagged duplicates stored in review queue

---

### TASK-029: Duplicate review UI

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-028, TASK-018

**Description:**
Implement duplicate review interface with side-by-side comparison and merge controls.

**Acceptance Criteria:**

- [ ] `GET /api/duplicates` returns flagged duplicate pairs
- [ ] UI shows duplicate pairs in queue
- [ ] Side-by-side comparison view for each pair
- [ ] Actions: Merge, Not a duplicate, Merge with edits
- [ ] Merge combines records per merge logic
- [ ] "Not a duplicate" dismisses permanently
- [ ] Merge is undoable for 30 days

---

### TASK-030: Data conflict detection and UI

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-004, TASK-018

**Description:**
Implement data conflict detection when sources disagree, and UI for resolving conflicts.

**Acceptance Criteria:**

- [ ] Conflict created when update has different value than existing
- [ ] Source hierarchy respected: manual > email/calendar > LinkedIn
- [ ] `GET /api/conflicts` returns unresolved conflicts
- [ ] Dashboard shows conflict count
- [ ] Conflict detail view shows all source values
- [ ] User picks correct value, conflict resolved
- [ ] Exception: LinkedIn data 60+ days newer → surfaced as suggestion
- [ ] Resolved conflicts logged

---

### TASK-031: Interaction logging API

**Status:** `[x]`
**Complexity:** S
**Dependencies:** TASK-002

**Description:**
Implement API for manually logging interactions (notes, meetings, calls) that aren't captured automatically.

**Acceptance Criteria:**

- [x] `POST /api/contacts/:id/interactions` creates interaction
- [x] Types: manual_note, meeting_1on1_inperson, meeting_1on1_virtual, meeting_group, introduction_given, introduction_received
- [x] Metadata stored in JSONB (notes, location, etc.)
- [x] occurred_at timestamp (default: now)
- [x] Points value calculated based on type
- [x] Updates contact's last_interaction timestamp

---

## Automation (Phase 2)

### TASK-034: LinkedIn browser automation setup

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-001

**Description:**
Set up Playwright with persistent browser context for LinkedIn automation. Handle login state, cookie management, and browser lifecycle.

**Acceptance Criteria:**

- [ ] Playwright installed with Chromium
- [ ] Persistent browser context created on first run
- [ ] Cookies saved to encrypted file between runs
- [ ] Login check: navigate to LinkedIn, detect if logged in
- [ ] Manual login prompt if not authenticated
- [ ] Browser context cleanup on shutdown
- [ ] Headless/headed mode configurable

---

### TASK-035: LinkedIn rate limiter

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-034

**Description:**
Implement Redis-based rate limiter for all LinkedIn operations with weekly/daily counters, cooldown support, and request spacing.

**Acceptance Criteria:**

- [ ] Redis keys for weekly counter (resets Monday), daily counter (resets daily)
- [ ] Cooldown flag with end timestamp
- [ ] `canSendRequest()` checks all limits
- [ ] `recordRequest()` increments counters
- [ ] `enterCooldown(days)` sets cooldown flag
- [ ] `getCooldownStatus()` returns state and end date
- [ ] Request spacing: enforces 2-5 min gap between requests
- [ ] API endpoint `GET /api/linkedin/status` returns limit status

---

### TASK-036: LinkedIn connection request sender

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-034, TASK-035, TASK-012

**Description:**
Implement Bull worker that sends connection requests with personalized notes via Playwright with rate limiting, error handling, and result logging.

**Acceptance Criteria:**

- [ ] Bull job `linkedin-connection-request` registered
- [ ] Receives: contact LinkedIn URL, personalized connection note
- [ ] **Validates connection note is ≤300 chars before sending; rejects if over**
- [ ] Checks rate limits before execution
- [ ] Navigates to profile, clicks Connect, clicks "Add a note", pastes connection note
- [ ] Handles variations (Connect vs Follow, pending request exists)
- [ ] Random delay (2-5 min) before next job
- [ ] Logs success/failure to QueueItem
- [ ] On failure: detects soft ban signals, triggers cooldown
- [ ] Updates contact status to "requested" on success

---

### TASK-037: LinkedIn profile scraper

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-034, TASK-035

**Description:**
Implement profile scraping to fetch/refresh contact data from LinkedIn. Respect separate daily quota for enrichment.

**Acceptance Criteria:**

- [ ] Bull job `linkedin-profile-scrape` registered
- [ ] Scrapes: name, title, company, location, headline, mutual connections count
- [ ] Scrapes recent posts (last 7 days) for timing triggers
- [ ] Separate daily quota: 50 profiles/day
- [ ] Detects job changes (compare title/company to stored)
- [ ] Creates DataConflict if scraped differs from stored
- [ ] Updates contact with new data (respecting source hierarchy)
- [ ] Queues profiles based on re-enrichment cadence rules

---

### TASK-038: LinkedIn activity monitor

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-037

**Description:**
Monitor target activity (posts, job changes) to fire timing triggers and update priority scores.

**Acceptance Criteria:**

- [ ] Detects new posts in last 7 days → timing bonus +2
- [ ] Detects job change in last 30 days → timing bonus +3
- [ ] Stores last activity data to avoid re-triggering
- [ ] Triggers expire when window passes
- [ ] Updates contact metadata with activity info
- [ ] Engagement recommendations stored: "Posted about X on [date]"

---

### TASK-039: Unfriend detection

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-034, TASK-035

**Description:**
Weekly job that compares LinkedIn connection list to database and detects removed connections.

**Acceptance Criteria:**

- [ ] Bull job `linkedin-unfriend-check` registered
- [ ] Runs weekly
- [ ] Scrapes current LinkedIn connection list
- [ ] Compares to contacts with status "connected" or higher
- [ ] Missing contacts: status → "target", flag "Previously connected — removed on [date]"
- [ ] Logs to StatusHistory with trigger "unfriended"
- [ ] Dashboard notification: "X contacts removed this week"

---

### TASK-045: Target generation engine

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-033

**Description:**
Generate weekly target suggestions based on priority scoring, filtering out already connected and previously skipped.

**Acceptance Criteria:**

- [ ] `GET /api/targets/suggestions` returns top targets
- [ ] Filters: status = "target", not skipped recently, not in cooldown
- [ ] Ordered by priority_score DESC
- [ ] Limit configurable (default: 150/week)
- [ ] Groups by category for balanced targeting
- [ ] Deduplicates against pending requests
- [ ] Returns with context: why this target? (timing triggers, mutual connections)

---

### TASK-046: Outreach workflow automation

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-036, TASK-012

**Description:**
Implement automated execution of approved queue items with the LinkedIn worker, including retry logic and failure handling.

**Acceptance Criteria:**

- [ ] "Approve & Execute" triggers LinkedIn jobs for approved items
- [ ] Jobs queued with rate-limited delays
- [ ] Retry failed jobs up to 3 times with backoff
- [ ] Failure after 3 retries: mark item failed, notify user
- [ ] Soft ban detection: pause all pending jobs, enter cooldown
- [ ] Progress visible in UI: pending, executing, completed, failed
- [ ] Execution can be paused/cancelled

---

### TASK-047: Template A/B testing

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-010, TASK-011, TASK-036

**Description:**
Implement A/B test assignment and tracking for templates. Assign variants via round-robin, track performance by variant.

**Acceptance Criteria:**

- [ ] Multiple templates can have same persona
- [ ] Queue generation assigns variants via **round-robin** (not random)
- [ ] Tracks: times used, acceptances, responses per variant
- [ ] Performance stats split by variant
- [ ] Minimum 20 uses before showing comparison
- [ ] UI shows variant performance comparison

---

## Intelligence & Integrations (Phase 3)

### TASK-040: Gmail integration setup

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-001

**Description:**
Set up Google OAuth for Gmail API with read-only scope. Handle token storage, refresh, and revocation. **Moved to Phase 3.**

**Acceptance Criteria:**

- [ ] Google OAuth 2.0 flow implemented
- [ ] Scope: gmail.readonly
- [ ] Tokens stored encrypted in database
- [ ] Token refresh handled automatically
- [ ] Revoke endpoint to disconnect Gmail
- [ ] Settings UI to connect/disconnect Gmail

---

### TASK-041: Gmail sync worker

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-040, TASK-031

**Description:**
Implement worker that syncs email interactions from Gmail, matching senders/recipients to contacts. **Moved to Phase 3.**

**Acceptance Criteria:**

- [ ] Bull job `gmail-sync` registered
- [ ] Runs hourly
- [ ] Fetches messages since last sync
- [ ] Extracts: from/to emails, thread ID, timestamp
- [ ] Matches emails to contacts in database
- [ ] Creates interaction records (type: email, source: gmail)
- [ ] Caps at 3 threads/month for scoring
- [ ] Does NOT store email content
- [ ] Handles pagination for large inboxes

---

### TASK-042: Gmail contact discovery

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-040

**Description:**
Surface email addresses from Gmail history that aren't in the contact database, for potential adding. **Moved to Phase 3.**

**Acceptance Criteria:**

- [ ] Scans email history for addresses with 3+ exchanges
- [ ] Compares against contact emails in database
- [ ] Returns unmatched addresses with name (if available), count, last date
- [ ] `GET /api/discover/email` returns discovered contacts
- [ ] One-click "Add as contact" with email pre-filled
- [ ] "Dismiss" prevents re-surfacing

---

### TASK-043: Calendar integration setup

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-001

**Description:**
Set up Google OAuth for Calendar API with read-only scope. **Moved to Phase 3.**

**Acceptance Criteria:**

- [ ] Google OAuth 2.0 flow (can share with Gmail auth)
- [ ] Scope: calendar.readonly
- [ ] Tokens stored encrypted
- [ ] Settings UI to connect/disconnect Calendar

---

### TASK-044: Calendar sync worker

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-043, TASK-031

**Description:**
Implement worker that syncs calendar meetings, matching attendees to contacts and categorizing meeting types. **Moved to Phase 3.**

**Acceptance Criteria:**

- [ ] Bull job `calendar-sync` registered
- [ ] Runs hourly
- [ ] Fetches events since last sync
- [ ] Extracts: attendee emails, event time, location/video link
- [ ] Categorizes: 1:1 vs group (by attendee count), in-person vs virtual (by location)
- [ ] Matches attendees to contacts
- [ ] Creates interaction records with appropriate type
- [ ] Does NOT store event title/description content
- [ ] Suggests connecting with non-connected attendees

---

### TASK-048: Network visualization

**Status:** `[ ]`
**Complexity:** L
**Dependencies:** TASK-004, TASK-008

**Description:**
Implement network graph visualization showing contacts clustered by category, company, or location with relationship strength as edge weights.

**Acceptance Criteria:**

- [ ] Graph view using D3.js or similar
- [ ] Nodes: contacts (size by relationship score)
- [ ] Edges: shared category/company/tags
- [ ] Cluster by: category, company, location (toggle)
- [ ] Filter visible nodes by score range, status
- [ ] Click node to view contact detail
- [ ] Zoom/pan controls
- [ ] Performance: renders 1000+ nodes smoothly

---

### TASK-049: Opportunity detection

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-038

**Description:**
Detect opportunities from contact activity: job postings, speaking opportunities, introduction possibilities.

**Acceptance Criteria:**

- [ ] Detects job postings from contacts' companies
- [ ] Detects contacts attending same events
- [ ] Identifies introduction chains (A knows B, B knows C)
- [ ] Geographic overlap detection for travel
- [ ] `GET /api/opportunities` returns active opportunities
- [ ] Dashboard widget shows opportunity count

---

### TASK-050: Advanced analytics

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-015

**Description:**
Implement advanced analytics: conversion funnel, template ROI, category ROI, time-to-relationship metrics.

**Acceptance Criteria:**

- [ ] Conversion funnel: target → requested → connected → engaged → relationship
- [ ] Template ROI: which templates lead to highest relationship scores
- [ ] Category ROI: which categories convert best
- [ ] Time-to-relationship: average days from connected to relationship
- [ ] Exportable reports (CSV)

---

## Polish

### TASK-051: Web push notifications

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-012, TASK-016

**Description:**
Implement PWA web push notifications for morning queue and afternoon overdue alerts.

**Acceptance Criteria:**

- [ ] Service worker registered for push
- [ ] Permission request flow
- [ ] Morning notification: "Your daily queue is ready" at configured time
- [ ] Afternoon notification: "You have X follow-ups overdue" at 2 PM if items pending
- [ ] Click notification opens queue view
- [ ] Respects notification preferences in settings

---

### TASK-052: Keyboard shortcuts

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-018

**Description:**
Implement keyboard shortcuts for power users across the application.

**Acceptance Criteria:**

- [ ] `/` focuses search
- [ ] `g q` goes to queue
- [ ] `g c` goes to contacts
- [ ] `g d` goes to dashboard
- [ ] `n` creates new contact (on contacts page)
- [ ] `j/k` navigates list items
- [ ] `Enter` opens selected item
- [ ] `?` shows shortcut help modal

---

### TASK-053: Error handling and offline support

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-018

**Description:**
Implement comprehensive error handling, loading states, and basic offline support.

**Acceptance Criteria:**

- [ ] API errors show user-friendly messages
- [ ] Loading skeletons for all data-fetching views
- [ ] Retry button on failed requests
- [ ] Offline detection with banner
- [ ] Queue items can be marked done while offline (syncs when online)
- [ ] Form data preserved on navigation

---

## Non-Code Tasks

### TASK-054: Seed database with 700 LinkedIn connections

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** TASK-006, TASK-022

**Description:**
Export Igor's LinkedIn connections and import them into the production database. Perform initial categorization and quality check.

**Acceptance Criteria:**

- [ ] LinkedIn CSV exported
- [ ] CSV imported via import wizard
- [ ] Duplicates reviewed and resolved
- [ ] Basic categorization applied (bulk operations)
- [ ] Top 50 contacts manually reviewed for accuracy
- [ ] Scoring batch job run
- [ ] Dashboard shows accurate counts

---

### TASK-055: Write initial templates

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-024

**Description:**
Create 10-15 outreach templates covering main personas.

**Acceptance Criteria:**

- [ ] Templates created for: crypto exec, crypto compliance, regulator, MBA student, MBA alum, potential employer, chief of staff, Mexico City fintech, general
- [ ] Each template has clear persona tag
- [ ] Templates use appropriate tokens
- [ ] At least 2 variants for top 3 personas (for A/B testing)

---

### TASK-056: Documentation - User guide

**Status:** `[ ]`
**Complexity:** M
**Dependencies:** All Phase 1 tasks

**Description:**
Write user documentation covering daily workflow, weekly workflow, and all features.

**Acceptance Criteria:**

- [ ] Quick start guide
- [ ] Daily workflow walkthrough
- [ ] Weekly workflow walkthrough
- [ ] Feature reference for each view
- [ ] Troubleshooting section
- [ ] Hosted in `/docs` or separate site

---

### TASK-057: Documentation - API reference

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** All API tasks

**Description:**
Document all API endpoints with request/response examples.

**Acceptance Criteria:**

- [ ] All endpoints documented
- [ ] Request parameters described
- [ ] Response schemas shown
- [ ] Example requests with curl
- [ ] Error codes documented
- [ ] OpenAPI/Swagger spec generated (optional)

---

### TASK-058: CLI seed command

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-006

**Description:**
Create CLI command that accepts a LinkedIn CSV path and imports contacts via the API. Enables data loading before UI is built.

**Acceptance Criteria:**

- [ ] `npm run seed:linkedin <path-to-csv>` command
- [ ] Calls the same import logic as `POST /api/import/linkedin`
- [ ] Outputs: imported count, duplicates skipped, errors
- [ ] Works without UI running (backend + DB only)
- [ ] Exit code 0 on success, 1 on error

---

### TASK-059: Hard delete cleanup job

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-004

**Description:**
Nightly Bull job that permanently deletes soft-deleted records older than 30 days, including orphaned related records.

**Acceptance Criteria:**

- [ ] Bull job `hard-delete-cleanup` registered
- [ ] Runs nightly (3 AM)
- [ ] Deletes contacts where `deleted_at < NOW() - 30 days`
- [ ] Cascades: deletes orphaned interactions, status history, score history for hard-deleted contacts
- [ ] Logs count of records deleted per table
- [ ] Does NOT delete merge history (preserved for audit)

---

### TASK-060: Score history archival

**Status:** `[ ]`
**Complexity:** S
**Dependencies:** TASK-032

**Description:**
Monthly job that aggregates daily score history snapshots older than 90 days into weekly averages, then deletes the daily rows. Keeps DB size manageable at scale.

**Acceptance Criteria:**

- [ ] Bull job `score-history-archival` registered
- [ ] Runs monthly (1st of month, 4 AM)
- [ ] For snapshots older than 90 days: calculate weekly average per contact
- [ ] Insert weekly summary records
- [ ] Delete daily records older than 90 days
- [ ] Logs: X daily records archived into Y weekly records
