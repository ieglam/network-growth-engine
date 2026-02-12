# Network Growth Engine - Product Requirements Document

## 1. Overview

Network Growth Engine is a personal network management and growth system designed to systematically scale Igor's professional network from 700 to 7,000+ high-value connections within 12 months through strategic targeting, automated outreach management, and intelligent relationship development. The system provides a centralized contact database with rich metadata, scoring algorithms for relationship strength and outreach priority, a daily action queue for systematic execution, and integrations with LinkedIn, Gmail, and Google Calendar to automate data capture and outreach workflows.

## 2. Target User

**Solo operator:** Igor Glamazdin, building a professional network across crypto industry, MBA networks, regulators, and potential employers. Single-user system with no multi-tenancy requirements. User is technical (can edit config files, run migrations) but wants a polished daily workflow that takes <10 minutes.

## 3. User Stories

### Contact Database & Management

#### US-01: Import LinkedIn connections via CSV

**As** Igor, **I want to** upload my LinkedIn CSV export and have all 700 contacts created in the database, **so that** I start with my existing network loaded.

**Acceptance Criteria:**

- Upload accepts LinkedIn's standard CSV export format
- Duplicate detection runs before insert (matching on LinkedIn URL first, then name+company)
- Each imported contact gets status "connected," category "uncategorized," relationship score 0 (pending first batch calculation)
- Import summary shows: X imported, Y duplicates skipped, Z errors (with details)
- Import is idempotent — re-uploading the same CSV creates no duplicates

#### US-02: Import contacts via manual CSV

**As** Igor, **I want to** upload a custom CSV (conference attendee list, curated target list) with column mapping, **so that** I can bulk-add targets from any source.

**Acceptance Criteria:**

- UI shows column mapping step: map CSV columns to contact fields (name, company, title, LinkedIn URL, email, category)
- Default status for manual CSV imports is "target"
- Duplicate detection runs before insert
- Unmapped columns are ignored, not errored
- Supports CSVs without LinkedIn URLs (name+company is minimum required)

#### US-03: Create/edit/delete a contact manually

**As** Igor, **I want to** add or edit a contact's details, **so that** I can maintain accurate records.

**Acceptance Criteria:**

- Contact form includes all fields from data model (name, title, company, LinkedIn URL, email, phone, location, categories, tags, notes, status, manual flags)
- Editing a field marks it as "manual entry" source (highest priority in conflict resolution)
- Deleting a contact moves it to a soft-delete archive, recoverable for 30 days
- Required fields: first name, last name. Everything else nullable.

#### US-04: Search and filter contacts

**As** Igor, **I want to** search by name, company, title, category, tag, status, and relationship score range, **so that** I can quickly find who I'm looking for.

**Acceptance Criteria:**

- Full-text search across name, company, title, notes
- Filter by: category (multi-select), status (multi-select), tag (multi-select), relationship score range (slider), location
- Filters are combinable (AND logic)
- Results return in <200ms for 10K contacts
- Results are sortable by name, company, relationship score, last interaction date, date added

#### US-05: View contact detail page

**As** Igor, **I want to** see a contact's full profile with interaction history, scores, and status timeline, **so that** I have full context before reaching out.

**Acceptance Criteria:**

- Shows all contact fields, current scores (relationship, priority), status with transition history
- Interaction timeline: chronological list of all logged interactions (messages, meetings, emails, manual notes)
- Conflict flags shown if any data conflicts exist
- Quick actions: edit, change status, add note, add tag, recalculate score (on-demand), mark as duplicate
- Link to LinkedIn profile (opens in new tab)

---

### Strategic Categories & Tagging

#### US-06: Manage strategic categories

**As** Igor, **I want to** create, edit, and assign relevance weights to strategic categories, **so that** the priority scoring reflects my current strategic goals.

**Acceptance Criteria:**

- CRUD for categories with name and relevance weight (1-10)
- Default categories pre-seeded (crypto client, regulator, potential employer, chief of staff, MBA network, Mexico City network, general)
- A contact can belong to multiple categories
- Changing a category's weight triggers re-scoring of all contacts in that category at next batch run
- Categories are editable from the UI (not config file) even in v1

#### US-07: Tag contacts with custom tags

**As** Igor, **I want to** apply freeform tags to contacts, **so that** I can group them by dimensions not covered by categories (e.g., "met at Consensus 2025," "speaks Spanish," "warm intro via Sarah").

**Acceptance Criteria:**

- Tags are freeform text, autocomplete from existing tags
- A contact can have unlimited tags
- Tags are filterable and searchable
- Bulk tag operations: select multiple contacts, apply/remove tag

---

### Scoring Engines

#### US-08: Relationship strength scoring

**As** Igor, **I want** every contact's relationship strength automatically calculated daily, **so that** I know who's warm, who's going cold, and where to invest.

**Acceptance Criteria:**

- Daily batch job calculates scores for all contacts
- Inputs: all signals defined in scoring system (messages, meetings, emails, engagement, reciprocity, manual flags)
- Weights are stored in a config table, editable via DB seed (admin UI deferred)
- 90-day half-life decay applied
- Score normalized to 0-100 with bands: cold (0-20), warm (21-50), active (51-75), strong (76-100)
- On-demand recalculation available for individual contacts
- Score history logged (daily snapshots) for trend tracking

#### US-09: Priority scoring for targets

**As** Igor, **I want** every target contact scored by priority (relevance × accessibility × timing), **so that** my daily queue surfaces the highest-value outreach opportunities.

**Acceptance Criteria:**

- Priority = (Relevance × 0.5) + (Accessibility × 0.3) + (Timing × 0.2), weights configurable
- Relevance: category weight × seniority multiplier, normalized 0-10
- Accessibility: mutual connections, shared groups, active LinkedIn presence, geographic overlap, warm intro availability, scored 0-10
- Timing: binary triggers (job change, recent post, funding news, shared event, travel overlap, profile view, mutual connection activity), additive
- Recalculated daily for all contacts with status "target"
- Timing triggers expire (configurable per trigger type)

---

### Templates & Outreach

#### US-10: Manage outreach templates

**As** Igor, **I want to** create, edit, and categorize connection note templates with personalization tokens, **so that** my outreach is consistent and efficient.

**Acceptance Criteria:**

- Template CRUD with: name, category/persona (which type of target it's for), body with tokens
- **Body max length: 300 characters** (LinkedIn connection note limit)
- Supported tokens: `{{first_name}}`, `{{company}}`, `{{title}}`, `{{mutual_connection}}`, `{{recent_post}}`, `{{category_context}}`, `{{custom}}`
- Template preview with sample contact data
- **Character count displayed in editor, warning at 280 chars, hard block at 300 chars**
- Templates tagged by persona (crypto exec, regulator, MBA, etc.)
- A/B variant support: multiple templates per persona, system assigns variants via round-robin

#### US-11: Template performance tracking

**As** Igor, **I want to** see acceptance rate and response rate per template, **so that** I can iterate on what works.

**Acceptance Criteria:**

- Track per template: times used, acceptance rate (connected / requested), response rate (replied / connected), time-to-accept average
- Dashboard view with template leaderboard
- Minimum 20 uses before showing statistically meaningful metrics (flag "low sample" below that)

---

### Daily Action Queue

#### US-12: Generate daily action queue

**As** Igor, **I want** the system to generate my daily action queue each morning, **so that** I know exactly who to contact and what to do.

**Acceptance Criteria:**

- Queue generated daily at configured time (default 7 AM local)
- Queue contains:
  - **New connection requests with note:** top 15-20 targets by priority score, personalized connection note pre-selected (default action is "Connect + Add Note")
  - Follow-ups: contacts who accepted connection in last 7 days but haven't received a first message
  - Re-engagement: contacts whose relationship score dropped below a threshold recently
  - Overdue actions: anything from yesterday's queue that wasn't completed
- Each queue item shows: contact name, company, title, LinkedIn URL, recommended action, pre-filled connection note, priority score, context notes (why now)
- **Rendered connection notes validated to be ≤300 chars; if over, flagged for manual editing**
- Queue respects weekly LinkedIn rate limit (doesn't suggest more connection requests than remaining weekly capacity)

#### US-13: Execute or dismiss queue items

**As** Igor, **I want to** mark queue items as done, skipped, or snoozed, **so that** the system tracks my activity and adjusts.

**Acceptance Criteria:**

- Actions per item: "Done" (logs the interaction as connection_request_sent), "Skip" (removes from today, doesn't re-queue), "Snooze 3 days" / "Snooze 1 week" (re-queues for later)
- "Done" prompts for quick note (optional): "How did it go?" freeform text
- **Edit button allows modifying connection note before execution; changes validated ≤300 chars**
- Skipped targets get a small priority penalty (configurable, default -1 to relevance) to avoid resurfacing repeatedly
- Batch "Approve & Execute" button for guided mode: marks all approved items as pending execution
- End-of-day summary: X completed, Y skipped, Z snoozed, weekly rate limit status

---

### Status Management

#### US-14: Automated status transitions

**As** Igor, **I want** contact statuses to update automatically based on relationship score thresholds, **so that** I don't manually manage 7,000 status labels.

**Acceptance Criteria:**

- connected → engaged: score ≥ 30 AND ≥ 2 logged interactions
- engaged → relationship: score ≥ 60 AND ≥ 1 reciprocal interaction
- Backward: status demotes if score below threshold for 30+ consecutive days
- All transitions logged in status history with timestamp and trigger reason
- Manual override always available (can promote or demote at any time)
- Skipping statuses allowed (e.g., import a contact directly as "relationship")

#### US-15: Detect unfriending / disconnection

**As** Igor, **I want** the system to detect when a connection is removed, **so that** their status updates accordingly.

**Acceptance Criteria:**

- Periodic check (weekly) compares current LinkedIn connection list against database
- If a previously "connected" contact is no longer in the connection list, status changes to "target" with flag: "Previously connected — removed on [date]"
- Notification in dashboard: "X contacts were removed from your LinkedIn connections this week"
- Deferred to Phase 2 (requires LinkedIn scraping of connection list)

---

### Dashboard & Analytics

#### US-16: Growth dashboard

**As** Igor, **I want to** see my network growth metrics at a glance, **so that** I know if I'm on track for 7,000 connections in 12 months.

**Acceptance Criteria:**

- Current total network size vs goal (700 → 7,000) with progress bar
- Weekly and monthly growth rate (new connections)
- Connection acceptance rate (accepted / requested)
- Breakdown by strategic category (pie chart or bar)
- Trend line: network size over time

#### US-17: Relationship health dashboard

**As** Igor, **I want to** see the distribution of relationship strengths across my network, **so that** I know where to invest attention.

**Acceptance Criteria:**

- Distribution chart: how many contacts in each band (cold, warm, active, strong)
- Top 10 strongest relationships
- "Going cold" alert: contacts whose score dropped >15 points in last 30 days
- Average relationship score trend over time

---

### Duplicate Management

#### US-18: Manage duplicate contacts

**As** Igor, **I want** duplicates flagged and presented for review/merge, **so that** I maintain a clean database without double-counting or double-outreach.

**Acceptance Criteria:**

- Auto-merge for high-confidence matches (same LinkedIn URL, same email, same phone)
- Flag for manual review on probable matches (same name + company, fuzzy name + company)
- Side-by-side comparison view for manual review
- Merge logic: most complete record wins, most recent value for conflicts, merge history preserved
- "Not a duplicate" dismissal prevents re-flagging the same pair
- Merge is undoable for 30 days

---

### Data Conflict Resolution

#### US-19: Enrichment conflict handling

**As** Igor, **I want** data conflicts between sources flagged and presented for resolution, **so that** I maintain accurate contact records.

**Acceptance Criteria:**

- Source hierarchy: manual > calendar/email > LinkedIn
- When sources conflict, flag is created on contact
- Dashboard shows total conflict count
- Conflict detail view: shows each source's value, lets me pick the correct one
- If LinkedIn data is 60+ days newer than manual entry, surface as suggestion instead of ignoring
- Resolved conflicts are logged

---

### LinkedIn Automation (Phase 2)

#### US-20: Send automated connection requests with note via Playwright

**As** Igor, **I want** the system to automatically send connection requests with personalized notes to approved targets, **so that** I don't manually copy-paste 100 requests per week.

**Acceptance Criteria:**

- Playwright/browser automation sends connection requests with personalized connection note (clicks "Connect", then "Add a note", then pastes the note)
- **Connection note must be ≤300 characters; automation rejects any item that exceeds this**
- Respects rate limits: 100/week max, 15-20/day, 2-5 minute gaps between requests
- Hard-stop at 100, warning at 80
- Execution only after daily queue approval
- Logs success/failure per request
- Cooldown mode: pauses all automation if soft ban detected, requires manual resume after 7 days

#### US-21: Scrape LinkedIn profiles for enrichment data

**As** Igor, **I want** contact profiles automatically refreshed with latest LinkedIn data, **so that** job titles, companies, and activity are current.

**Acceptance Criteria:**

- Scrapes: name, title, company, location, headline, recent posts, mutual connections count
- Re-enrichment cadence: targets weekly, connected/engaged monthly, dormant quarterly, high-value weekly
- Separate daily quota: 50 profiles/day max
- Conflict detection when scraped data differs from stored data
- Respects cooldown mode

#### US-22: Monitor target activity for timing triggers

**As** Igor, **I want** the system to detect when targets post, change jobs, or have company news, **so that** timing triggers fire and boost their priority.

**Acceptance Criteria:**

- Detects: new LinkedIn posts (last 7 days), job changes (last 30 days), company funding/news
- Updates timing score daily
- Triggers expire after their window passes
- Activity data stored for engagement recommendations ("comment on their post before connecting")

---

### Gmail/Calendar Integration (Phase 3)

#### US-23: Log email interactions automatically

**As** Igor, **I want** email exchanges with contacts auto-logged, **so that** relationship scores reflect email communication.

**Acceptance Criteria:**

- Gmail API scans sent/received emails
- Matches email addresses to contacts in database
- Logs email thread as interaction (capped at 3 threads/month for scoring)
- Does not store email content, only metadata (date, participant, thread ID)

#### US-24: Detect calendar meetings with contacts

**As** Igor, **I want** calendar meetings auto-detected and logged, **so that** relationship scores reflect meetings.

**Acceptance Criteria:**

- Google Calendar API scans events
- Matches attendee emails to contacts
- Categorizes: 1:1 vs group, in-person vs virtual (based on location field or video link)
- Logs meeting as interaction with appropriate point value
- Suggests connecting with non-connected meeting attendees

#### US-25: Discover contacts from email history

**As** Igor, **I want** the system to surface people I've emailed frequently who aren't in the database, **so that** I can add them as targets or connections.

**Acceptance Criteria:**

- Scans email history for addresses with 3+ email exchanges
- Compares against database, surfaces unmatched addresses
- Shows: email address, name (if available), exchange count, most recent date
- One-click "Add as contact" with email pre-filled
- Dismissable ("not relevant") to prevent re-surfacing

---

### Operational Features

#### US-26: Export contacts to CSV/JSON

**As** Igor, **I want to** export my contact database, **so that** I have backups and can use the data elsewhere.

**Acceptance Criteria:**

- Export all contacts or filtered subset
- Formats: CSV, JSON
- Includes all fields, scores, status, tags, categories
- Export interaction history as separate file (optional)
- GDPR-style: can export all data for a single contact

#### US-27: Configure system settings

**As** Igor, **I want to** adjust system settings without editing code, **so that** I can tune behavior over time.

**Acceptance Criteria:**

- Configurable settings:
  - Daily queue generation time
  - LinkedIn rate limits (weekly cap, daily cap, gap between requests)
  - Scoring weights (relationship signals, priority formula weights)
  - Notification preferences (morning queue, afternoon overdue)
  - Cooldown duration
- Settings UI in app (not config file) for Phase 1 critical settings
- Changes take effect on next batch run

#### US-28: Use guided/manual mode

**As** Igor, **I want to** run the system in guided mode where it tells me what to do but doesn't execute, **so that** I can use it before automation is built or if LinkedIn blocks automation.

**Acceptance Criteria:**

- Toggle in settings: "Guided Mode" on/off
- When on: daily queue generates same targets and connection notes, but "Approve & Execute" becomes "Show Instructions"
- Instructions view for each connection request:
  - **"Go to [LinkedIn URL], click Connect, click Add a note, paste: [connection note]"**
  - LinkedIn URL is clickable (opens in new tab)
  - Connection note has click-to-copy button
- "Mark Done" button updates status to "requested" after manual execution
- All tracking and scoring works identically to automated mode

#### US-29: View and manage LinkedIn rate limit status

**As** Igor, **I want to** see my current LinkedIn usage against limits, **so that** I know my remaining capacity and can plan accordingly.

**Acceptance Criteria:**

- Dashboard widget: X of 100 requests used this week, resets Monday
- Visual indicator: green (<80), yellow (80-99), red (100 / cooldown)
- Cooldown state clearly indicated if active, with resume date
- Historical view: requests per week for last 8 weeks

---

## 4. Data Model

### Entities

#### Contact

| Field                    | Type         | Notes                                                               |
| ------------------------ | ------------ | ------------------------------------------------------------------- |
| id                       | UUID         | Primary key                                                         |
| first_name               | VARCHAR(100) | Required                                                            |
| last_name                | VARCHAR(100) | Required                                                            |
| title                    | VARCHAR(200) | Nullable                                                            |
| company                  | VARCHAR(200) | Nullable                                                            |
| linkedin_url             | VARCHAR(500) | Nullable, unique if present                                         |
| email                    | VARCHAR(200) | Nullable                                                            |
| phone                    | VARCHAR(50)  | Nullable                                                            |
| location                 | VARCHAR(200) | Nullable                                                            |
| headline                 | TEXT         | Nullable, from LinkedIn                                             |
| status                   | ENUM         | target, requested, connected, engaged, relationship                 |
| seniority                | ENUM         | ic, manager, director, vp, c_suite                                  |
| relationship_score       | INTEGER      | 0-100, calculated                                                   |
| priority_score           | DECIMAL      | Calculated for targets                                              |
| notes                    | TEXT         | Nullable                                                            |
| introduction_source      | VARCHAR(200) | How met / who introduced                                            |
| mutual_connections_count | INTEGER      | From LinkedIn                                                       |
| is_active_on_linkedin    | BOOLEAN      | Posts regularly                                                     |
| has_open_to_connect      | BOOLEAN      | LinkedIn setting                                                    |
| last_interaction_at      | TIMESTAMP    | When last interaction occurred                                      |
| field_sources            | JSONB        | Tracks source per field: {"title": "manual", "company": "linkedin"} |
| deleted_at               | TIMESTAMP    | Soft delete                                                         |
| created_at               | TIMESTAMP    |                                                                     |
| updated_at               | TIMESTAMP    |                                                                     |

#### ContactCategory (join table)

| Field       | Type | Notes          |
| ----------- | ---- | -------------- |
| contact_id  | UUID | FK to Contact  |
| category_id | UUID | FK to Category |

#### Category

| Field            | Type         | Notes       |
| ---------------- | ------------ | ----------- |
| id               | UUID         | Primary key |
| name             | VARCHAR(100) | Unique      |
| relevance_weight | INTEGER      | 1-10        |
| created_at       | TIMESTAMP    |             |

#### Tag

| Field      | Type         | Notes       |
| ---------- | ------------ | ----------- |
| id         | UUID         | Primary key |
| name       | VARCHAR(100) | Unique      |
| created_at | TIMESTAMP    |             |

#### ContactTag (join table)

| Field      | Type | Notes         |
| ---------- | ---- | ------------- |
| contact_id | UUID | FK to Contact |
| tag_id     | UUID | FK to Tag     |

#### Interaction

| Field        | Type      | Notes                                                                                                                                                                                                                                                                                             |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | UUID      | Primary key                                                                                                                                                                                                                                                                                       |
| contact_id   | UUID      | FK to Contact                                                                                                                                                                                                                                                                                     |
| type         | ENUM      | linkedin_message, email, meeting_1on1_inperson, meeting_1on1_virtual, meeting_group, linkedin_comment_given, linkedin_comment_received, linkedin_like_given, linkedin_like_received, introduction_given, introduction_received, manual_note, connection_request_sent, connection_request_accepted |
| source       | ENUM      | manual, linkedin, gmail, calendar                                                                                                                                                                                                                                                                 |
| occurred_at  | TIMESTAMP | When interaction happened                                                                                                                                                                                                                                                                         |
| metadata     | JSONB     | Type-specific data (thread_id, meeting_link, comment_text, etc.)                                                                                                                                                                                                                                  |
| points_value | INTEGER   | Calculated based on type                                                                                                                                                                                                                                                                          |
| created_at   | TIMESTAMP |                                                                                                                                                                                                                                                                                                   |

#### Template

| Field       | Type         | Notes                                                           |
| ----------- | ------------ | --------------------------------------------------------------- |
| id          | UUID         | Primary key                                                     |
| name        | VARCHAR(100) |                                                                 |
| persona     | VARCHAR(100) | Which target type                                               |
| subject     | VARCHAR(200) | For email templates (not used for LinkedIn connection notes)    |
| body        | VARCHAR(300) | With tokens. **Max 300 chars** (LinkedIn connection note limit) |
| is_active   | BOOLEAN      |                                                                 |
| times_used  | INTEGER      |                                                                 |
| acceptances | INTEGER      |                                                                 |
| responses   | INTEGER      |                                                                 |
| created_at  | TIMESTAMP    |                                                                 |
| updated_at  | TIMESTAMP    |                                                                 |

#### QueueItem

| Field                | Type      | Notes                                         |
| -------------------- | --------- | --------------------------------------------- |
| id                   | UUID      | Primary key                                   |
| contact_id           | UUID      | FK to Contact                                 |
| queue_date           | DATE      | Which day's queue                             |
| action_type          | ENUM      | connection_request, follow_up, re_engagement  |
| template_id          | UUID      | FK to Template, nullable                      |
| personalized_message | TEXT      | Rendered message                              |
| status               | ENUM      | pending, approved, executed, skipped, snoozed |
| snooze_until         | DATE      | Nullable                                      |
| executed_at          | TIMESTAMP | Nullable                                      |
| result               | ENUM      | success, failed, nullable                     |
| notes                | TEXT      | User notes on completion                      |
| created_at           | TIMESTAMP |                                               |

#### StatusHistory

| Field          | Type      | Notes                                                               |
| -------------- | --------- | ------------------------------------------------------------------- |
| id             | UUID      | Primary key                                                         |
| contact_id     | UUID      | FK to Contact                                                       |
| from_status    | ENUM      |                                                                     |
| to_status      | ENUM      |                                                                     |
| trigger        | ENUM      | manual, automated_promotion, automated_demotion, unfriended, import |
| trigger_reason | TEXT      | E.g., "score crossed 30"                                            |
| created_at     | TIMESTAMP |                                                                     |

#### ScoreHistory

| Field       | Type    | Notes                  |
| ----------- | ------- | ---------------------- |
| id          | UUID    | Primary key            |
| contact_id  | UUID    | FK to Contact          |
| score_type  | ENUM    | relationship, priority |
| score_value | DECIMAL |                        |
| recorded_at | DATE    |                        |

#### MergeHistory

| Field               | Type      | Notes                              |
| ------------------- | --------- | ---------------------------------- |
| id                  | UUID      | Primary key                        |
| primary_contact_id  | UUID      | FK to Contact (surviving)          |
| merged_contact_id   | UUID      | The absorbed contact's original ID |
| merged_contact_data | JSONB     | Full snapshot before merge         |
| merge_type          | ENUM      | auto, manual                       |
| merged_at           | TIMESTAMP |                                    |

#### DataConflict

| Field                | Type         | Notes                 |
| -------------------- | ------------ | --------------------- |
| id                   | UUID         | Primary key           |
| contact_id           | UUID         | FK to Contact         |
| field_name           | VARCHAR(100) | Which field conflicts |
| manual_value         | TEXT         | Nullable              |
| linkedin_value       | TEXT         | Nullable              |
| email_calendar_value | TEXT         | Nullable              |
| resolved             | BOOLEAN      |                       |
| resolved_value       | TEXT         | What was chosen       |
| resolved_at          | TIMESTAMP    | Nullable              |
| created_at           | TIMESTAMP    |                       |

#### ScoringConfig

| Field       | Type         | Notes                                                      |
| ----------- | ------------ | ---------------------------------------------------------- |
| id          | UUID         | Primary key                                                |
| config_type | ENUM         | relationship_weight, priority_weight, timing_trigger, etc. |
| key         | VARCHAR(100) | E.g., "meeting_1on1_inperson"                              |
| value       | DECIMAL      | E.g., 15                                                   |
| updated_at  | TIMESTAMP    |                                                            |

#### RateLimitTracker

| Field               | Type      | Notes                                       |
| ------------------- | --------- | ------------------------------------------- |
| id                  | UUID      | Primary key                                 |
| week_start          | DATE      | Monday of the week                          |
| requests_sent       | INTEGER   | Weekly total (daily tracking in Redis only) |
| cooldown_active     | BOOLEAN   |                                             |
| cooldown_started_at | TIMESTAMP | Nullable                                    |
| cooldown_ends_at    | TIMESTAMP | Nullable                                    |

#### Settings

| Field      | Type         | Notes                                   |
| ---------- | ------------ | --------------------------------------- |
| id         | UUID         | Primary key                             |
| key        | VARCHAR(100) | Unique setting key                      |
| value      | TEXT         | Setting value (JSON-encoded if complex) |
| updated_at | TIMESTAMP    |                                         |

---

## 5. Scoring Systems

### Relationship Strength Score

**Inputs:**

- LinkedIn messages sent/received (count + recency)
- Email exchanges (count + recency)
- Calendar meetings (1:1 vs group, in-person vs virtual)
- LinkedIn engagement given (likes/comments on their posts)
- LinkedIn engagement received (their likes/comments on my posts)
- Manual flags: "met in person," "had call," "introduced by X"
- Shared context events (same conference, same virtual discussion)
- Response rate (do they reply, how fast)
- Reciprocity ratio (bidirectional vs one-sided)
- Introduction activity (intros given or received)
- Content engagement depth (thoughtful comment > like)

**Excluded:** Twitter/X interactions, Slack, passive profile views

**Weights (configurable):**

| Signal                                          | Base Points    | Notes                                                       |
| ----------------------------------------------- | -------------- | ----------------------------------------------------------- |
| 1:1 meeting (in-person)                         | 15             | Highest value                                               |
| 1:1 meeting (virtual)                           | 10             |                                                             |
| Group meeting                                   | 5              | Only if meaningful interaction                              |
| Email exchange (thread)                         | 5 per thread   | Capped at 3 threads/month                                   |
| LinkedIn DM exchange                            | 4 per exchange | Back-and-forth = 1 exchange                                 |
| Thoughtful LinkedIn comment (given or received) | 3              | Comment > 20 words                                          |
| LinkedIn like (given or received)               | 1              | Low signal                                                  |
| Introduction made (either direction)            | 10             | High trust signal                                           |
| Manual "met in person" flag                     | 8              | One-time boost per event                                    |
| Reciprocity multiplier                          | 1.0x-1.5x      | If they initiate ≥30% of interactions, multiply by 1.3-1.5x |

**Recency Decay:** Half-life of 90 days. Interaction from 90 days ago contributes 50% of points. 180 days = 25%.

**Normalization:** Raw points normalized to 0-100 scale.

**Bands:**

- Cold: 0-20
- Warm: 21-50
- Active: 51-75
- Strong: 76-100

**Recalculation:** Daily batch job (overnight). On-demand available for individual contacts.

---

### Priority Score (for targets)

**Formula:** `Priority = (Relevance × 0.5) + (Accessibility × 0.3) + (Timing × 0.2)`

Weights are configurable.

#### Relevance (0-10)

Category-based with seniority multiplier.

**Category Weights:**

| Category                                         | Weight |
| ------------------------------------------------ | ------ |
| Crypto client (current/prospective)              | 10     |
| Regulator / policy official                      | 9      |
| Potential employer / hiring manager              | 9      |
| Chief of Staff / operator at high-growth company | 7      |
| MBA network                                      | 6      |
| Mexico City fintech / expat network              | 6      |
| General industry contact                         | 3      |

Contact can belong to multiple categories — use highest weight, not sum.

**Seniority Multiplier:**

- C-suite/VP: 1.5x
- Director: 1.2x
- Manager: 1.0x
- IC: 0.8x

**Final Relevance:** `category_weight × seniority_multiplier`, normalized to 0-10.

#### Accessibility (0-10, capped)

| Factor                                               | Points |
| ---------------------------------------------------- | ------ |
| 5+ mutual connections                                | 4      |
| 2-4 mutual connections                               | 2      |
| 1 mutual connection                                  | 1      |
| Shared group/community                               | 2      |
| "Open to Connect" or active LinkedIn presence        | 2      |
| Geographic overlap (same city or travel destination) | 2      |
| Warm intro available                                 | 3      |
| Second-degree via strong relationship (score >60)    | 2      |

#### Timing (additive, uncapped)

| Trigger                                        | Bonus |
| ---------------------------------------------- | ----- |
| Changed jobs in last 30 days                   | +3    |
| Posted on LinkedIn in last 7 days              | +2    |
| Company raised funding / made news             | +2    |
| Attending same upcoming event                  | +3    |
| Geographic overlap in next 30 days (travel)    | +2    |
| They viewed my profile                         | +1    |
| Mutual connection recently connected with them | +1    |

Triggers expire when their window passes. Checked daily.

---

## 6. Status Flow

### States

1. **target** — Identified as someone to connect with
2. **requested** — Connection request sent, awaiting response
3. **connected** — Connection accepted, not yet engaged
4. **engaged** — Active communication established
5. **relationship** — Strong, reciprocal relationship

### Automated Transitions

| Transition             | Trigger                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| connected → engaged    | Relationship score ≥ 30 AND ≥ 2 logged interactions                     |
| engaged → relationship | Relationship score ≥ 60 AND ≥ 1 reciprocal interaction (they initiated) |
| Any → demoted          | Score below threshold for 30 consecutive days                           |

### Demotion Rules

- relationship → engaged: score < 60 for 30 days
- engaged → connected: score < 30 for 30 days
- If unfriended detected: status → target with flag "Previously connected — removed on [date]"

### Skip Rules

- Manual override allows setting any status directly
- CSV import allows specifying initial status
- No forced linear progression

### Logging

All transitions logged in StatusHistory with timestamp, from/to status, trigger type, and reason.

---

## 7. Scope Boundaries

### In Scope

- Single-user personal network management
- LinkedIn as primary platform (free tier, Sales Navigator support deferred)
- Gmail and Google Calendar integration for interaction logging
- Responsive web app (PWA with web push for 2 notifications)
- CSV import from LinkedIn export and manual sources
- Template-based outreach with personalization tokens
- Automated scoring and status management
- Daily action queue with guided or automated execution
- Export functionality (CSV, JSON)

### Out of Scope (with rationale)

| Item                               | Rationale                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Multi-user support                 | Personal tool; auth/permissions/multi-tenancy triples complexity for zero benefit                          |
| CRM integration (Salesforce)       | Custom status flow doesn't map to CRM stages; no current need                                              |
| AI-generated message content       | Outreach must sound like Igor; templates with tokens preferred; AI maybe for template selection later      |
| Social media beyond LinkedIn       | 95% of networking happens on LinkedIn; Twitter/X doubles integration surface for marginal return           |
| Group/event management             | Events are timing triggers on contacts, not first-class entities; use Luma/Eventbrite for event management |
| Payment processing / deal tracking | Not selling to these contacts; would be scope creep toward CRM                                             |

### Gray Area Rulings

| Item                                              | Ruling                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| LinkedIn Sales Navigator                          | Out of scope for v1. Build assuming free LinkedIn. Data model accommodates richer data but doesn't depend on it. |
| Native mobile app                                 | Out. Responsive web only. PWA web push for notifications.                                                        |
| Non-LinkedIn contact import                       | In scope: LinkedIn CSV, manual CSV with mapping, Gmail contact discovery (Phase 3)                               |
| Automated request sending                         | In scope. Playwright sends requests. Guided mode is fallback toggle, not default.                                |
| Third-party enrichment (Apollo, Clearbit, Hunter) | Phase 3. Data model includes nullable fields. Hunter.io possibly Phase 2 if email finding is bottleneck.         |

---

## 8. Constraints

### LinkedIn Rate Limits

- **Weekly cap:** 100 connection requests max
- **Daily distribution:** 15-20 requests per business day
- **Request spacing:** 2-5 minute randomized gaps between requests
- **Warning threshold:** Alert at 80 requests
- **Hard stop:** Refuse request #101 even if manually forced
- **Overflow handling:** Remaining requests roll to next Monday, re-scored
- **Cooldown:** If soft ban detected, all automation pauses. 7-day minimum cooldown. Manual resume required. Non-LinkedIn operations continue.

### Re-enrichment Cadence

| Contact Type                                       | Frequency                   |
| -------------------------------------------------- | --------------------------- |
| Active pipeline (target, requested)                | Weekly                      |
| Connected + engaged (score > 30)                   | Monthly                     |
| Cold/dormant (score < 30, no interaction 90+ days) | Quarterly                   |
| High-value tagged                                  | Weekly regardless of status |

Enrichment scrapes: 50 profiles/day max (separate from connection request budget).

### Performance Targets

- Search/filter: < 200ms for 10K contacts
- Daily workflow: < 10 minutes
- Database capacity: 10,000+ contacts

### Privacy

- User owns all data
- Export available (CSV, JSON)
- GDPR-style deletion: soft delete with 30-day recovery, then hard delete
- No sharing of contact data with third parties
- Email/calendar integration stores metadata only, not content

---

## 9. Success Metrics

### Quantitative

- Achieve 7,000 connections within 12 months
- Maintain > 40% connection acceptance rate
- Generate 50+ meaningful opportunities (intros, jobs, deals) from network
- 10% of connections achieve "relationship" status (active, reciprocal engagement)
- Daily workflow completes in < 10 minutes
- Weekly workflow completes in < 30 minutes

### Qualitative

- Network feels manageable, not overwhelming
- Every connection has strategic rationale
- System feels like productivity multiplier, not busywork
- Clear ROI: jobs, clients, intros, insights from network

---

## 10. Phasing

### Phase 1 - Foundation (4 weeks) — Priority Ranked

1. **Contact database with full data model** — PostgreSQL with all entities, relationships, JSONB for flexibility
2. **CSV import** — LinkedIn export + manual CSV with column mapping, duplicate detection
3. **Strategic category tagging system** — Categories with relevance weights, freeform tags, bulk operations
4. **Daily action queue generation** — Queue logic, guided mode execution, status tracking
5. **Template library with personalization tokens** — CRUD, token rendering, persona assignment
6. **Basic dashboard** — Network size, growth rate, category breakdown, acceptance rate

### Phase 2 - Automation — Priority Ranked

1. **Relationship scoring algorithm** — Daily batch calculation, all signals, decay, history
2. **LinkedIn Playwright automation** — Automated request sending with rate limiting
3. **Outreach workflow automation** — Sequences, scheduling, execution tracking
4. **LinkedIn profile scraping/enrichment** — Profile data refresh, conflict detection
5. **Target generation engine** — Weekly suggestions based on priority scoring
6. **Template A/B testing** — Round-robin assignment, performance tracking by variant

### Phase 3 - Intelligence & Integrations

- Gmail integration — Email interaction logging
- Calendar integration — Meeting detection and logging
- Email/calendar contact discovery — Surface untracked contacts from email history
- Network visualization (graph view)
- Second-degree connection mining
- Opportunity detection
- Advanced analytics

---

## 11. Daily/Weekly Workflows

### Daily Workflow (10 minutes, morning)

1. Open app → dashboard shows queue summary (2 min)
2. Scan 15-20 connection targets with pre-selected templates
3. Edit message or skip if target doesn't look right
4. Click "Approve & Execute" (guided mode: "Show Instructions" then execute manually)
5. Handle follow-ups for recent acceptances
6. Check "going cold" alerts, add notes or schedule re-engagement
7. Close

**Time:** 5-8 minutes normal, 10-12 if editing templates or investigating contacts.

### Weekly Workflow (30 minutes, Sunday evening)

1. Review growth dashboard — on track for goal?
2. Check acceptance rate — is outreach working?
3. Review template leaderboard — retire or edit low performers
4. Bulk-categorize new uncategorized connections from the week
5. Resolve any items in conflict queue
6. Check category breakdown — balanced across strategic goals?
7. Adjust targeting weights if needed
8. Export weekly summary (optional)

---

## 12. Initial Setup Experience

**Target time:** 2-3 hours (one weekend afternoon)

| Step                             | Time      | Notes                                                                                       |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| LinkedIn CSV import              | 5 min     | Automated processing                                                                        |
| Bulk categorization              | 60-90 min | Filter by company/title patterns, bulk-assign categories. UX must support this efficiently. |
| Write templates                  | 30-45 min | 10-15 templates covering main personas                                                      |
| Set up categories and weights    | 15 min    | Adjust defaults, add any custom categories                                                  |
| Review auto-scores, sanity check | 15 min    | Look at top 10 and bottom 10 by relationship score                                          |

**If setup takes > 3 hours, the UX is wrong.**

---

## 13. Open Questions

1. **Reciprocity multiplier calculation:** How exactly is "they initiate ≥30% of interactions" calculated? Is it based on count of interactions or weighted by type?

2. **Seniority detection:** How is seniority inferred from LinkedIn data? Title keyword matching? Manual assignment only?

3. **"Thoughtful comment" detection:** How does the system determine if a comment is >20 words? Is this scraped from LinkedIn or manually flagged?

4. **Travel/geographic overlap:** How is upcoming travel entered into the system? Manual calendar events? Separate travel planning feature?

5. **Company news/funding detection:** What data source for "company raised funding / made news"? Manual entry? Third-party API (Crunchbase)?

6. **Profile view detection:** LinkedIn limits profile view visibility. Is this feature dependent on premium LinkedIn? How reliable?

7. **Guided mode message copying:** In guided mode, how does the user copy the personalized message? Click-to-copy button? Auto-copy to clipboard?

8. **Batch categorization UX:** What specific UI patterns make bulk categorization of 700 contacts achievable in 60-90 minutes? Filter presets? Suggested categories based on title/company patterns?

9. **Notification delivery:** Web push requires user permission and browser support. What's the fallback if web push fails? Email? In-app only?
