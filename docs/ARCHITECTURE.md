# Network Growth Engine - Architecture Document

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Next.js Frontend (React)                         │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │  Daily   │ │ Contact  │ │ Template │ │Dashboard │ │ Settings │  │    │
│  │  │  Queue   │ │  Manager │ │  Editor  │ │ /Reports │ │          │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS / REST API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Node.js)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         API Layer (Fastify)                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ Contact  │ │  Queue   │ │ Template │ │  Import  │ │  Export  │  │    │
│  │  │  Routes  │ │  Routes  │ │  Routes  │ │  Routes  │ │  Routes  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Service Layer                                │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │ Scoring  │ │  Queue   │ │Duplicate │ │ Conflict │ │  Status  │  │    │
│  │  │ Service  │ │Generator │ │ Detector │ │ Resolver │ │ Manager  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Background Job Queue (Bull/Redis)               │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │  Daily   │ │  Score   │ │ LinkedIn │ │  Email   │ │ Calendar │  │    │
│  │  │  Queue   │ │  Batch   │ │  Worker  │ │  Sync    │ │   Sync   │  │    │
│  │  │Generator │ │Processor │ │ (Ph 2)   │ │ (Ph 3)   │ │  (Ph 3)  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│     PostgreSQL       │ │      Redis       │ │  External Services   │
│  ┌────────────────┐  │ │ ┌──────────────┐ │ │ ┌────────────────┐   │
│  │    Contacts    │  │ │ │  Job Queue   │ │ │ │    LinkedIn    │   │
│  │  Interactions  │  │ │ │  Rate Limit  │ │ │ │   (Playwright) │   │
│  │   Templates    │  │ │ │    Cache     │ │ │ ├────────────────┤   │
│  │   QueueItems   │  │ │ └──────────────┘ │ │ │   Gmail API    │   │
│  │    History     │  │ │                  │ │ ├────────────────┤   │
│  │    Configs     │  │ │                  │ │ │ Calendar API   │   │
│  └────────────────┘  │ │                  │ │ └────────────────┘   │
└──────────────────────┘ └──────────────────┘ └──────────────────────┘
```

## 2. Tech Stack

### Frontend

- **Framework:** Next.js 14+ (App Router)
- **UI Library:** React 18+
- **Styling:** Tailwind CSS
- **State Management:** React Query (TanStack Query) for server state, Zustand for client state
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts or Chart.js for dashboards
- **Tables:** TanStack Table for contact list with sorting/filtering

### Backend

- **Runtime:** Node.js 20+
- **Framework:** Fastify (chosen over Express for better TypeScript support, built-in validation, and faster performance)
- **Language:** TypeScript
- **ORM:** Prisma (type-safe, migrations, JSONB support)
- **Validation:** Zod (integrated with Fastify schema validation)

### Database

- **Primary:** PostgreSQL 15+
- **Features Used:**
  - JSONB for flexible metadata (interaction details, merge history snapshots)
  - Full-text search (tsvector) for contact search
  - Indexes on frequently filtered columns (status, category, relationship_score)
  - Partial indexes for active records only

### Job Queue

- **Queue:** Bull (backed by Redis)
- **Redis:** Redis 7+ (also used for rate limit tracking and caching)
- **Jobs:**
  - `daily-queue-generation` — Runs at configured time (default 7 AM)
  - `score-batch-processor` — Runs overnight, calculates all relationship scores
  - `linkedin-worker` — Processes outreach queue with rate limiting (Phase 2)
  - `enrichment-worker` — Re-enriches contact profiles (Phase 2)
  - `hard-delete-cleanup` — Nightly job to permanently delete soft-deleted records older than 30 days
  - `score-history-archival` — Monthly job to aggregate old score history
  - `email-sync` — Syncs Gmail interactions (Phase 3)
  - `calendar-sync` — Syncs Google Calendar meetings (Phase 3)

### LinkedIn Automation (Phase 2)

- **Tool:** Playwright
- **Browser:** Chromium (headless or headed based on config)
- **Session Management:** Persistent browser context with saved cookies
- **Rate Limiting:** Enforced via Redis counters + Bull job delays

### External APIs (Phase 3)

- **Gmail:** Google Gmail API (read-only scope for sent/received emails)
- **Calendar:** Google Calendar API (read-only scope for events)
- **OAuth:** Google OAuth 2.0 for authentication

### Hosting Options

- **Cloud:** Railway, Render, or Vercel (frontend) + Railway (backend + Postgres + Redis)
- **Local-first:** Docker Compose for local development and self-hosting
- **Recommended for v1:** Railway (simple, supports Postgres + Redis + background workers)

## 3. Data Flow

### Contact Lifecycle: Target → Relationship

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CONTACT LIFECYCLE                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────┐
    │  TARGET  │ ◄─── CSV Import (manual list)
    └────┬─────┘      Manual creation
         │            Gmail discovery (Phase 3)
         │
         │ Connection request sent
         ▼
    ┌──────────┐
    │REQUESTED │ ◄─── Queue item executed
    └────┬─────┘      Status: awaiting response
         │
         │ Accepted (detected via LinkedIn scrape or manual)
         ▼
    ┌──────────┐
    │CONNECTED │ ◄─── LinkedIn CSV import (existing connections)
    └────┬─────┘      Manual status set
         │
         │ Score ≥ 30 AND ≥ 2 interactions
         ▼
    ┌──────────┐
    │ ENGAGED  │
    └────┬─────┘
         │
         │ Score ≥ 60 AND ≥ 1 reciprocal interaction
         ▼
    ┌──────────────┐
    │ RELATIONSHIP │
    └──────────────┘

    ◄─── Demotion: Score below threshold for 30 days
    ◄─── Unfriended: Detected via connection list diff
```

### Daily Queue Generation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DAILY QUEUE GENERATION                                 │
└─────────────────────────────────────────────────────────────────────────────┘

7:00 AM (configurable)
         │
         ▼
┌────────────────────┐
│ Clear Today's      │ ─── Delete today's stale pending/approved items
│ Stale Items        │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Carry Over Overdue │ ─── Move previous days' PENDING items to today
│ Pending Items      │     Skipped & snoozed items are NOT carried over
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Check Rate Limits  │ ─── DB: executed connection_requests this week < 100?
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Calculate Capacity │ ─── remaining = 100 - sent_this_week
└────────┬───────────┘     daily_cap = min(remaining, 20)
         │
         ▼
┌────────────────────┐
│ Exclude Recently   │ ─── Contacts skipped in last N days are excluded
│ Skipped Contacts   │     N = Settings.skip_requeue_days (default 30)
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Fetch Targets     │ ─── status = 'target', not recently skipped,
│  by Priority Score │     not already carried over
└────────┬───────────┘     ORDER BY priority_score DESC, LIMIT daily_cap
         │
         ▼
┌────────────────────┐
│ Select Templates   │ ─── Match template.category to contact.category
└────────┬───────────┘     Falls back to least-used active template
         │
         ▼
┌────────────────────┐
│ Render Messages    │ ─── Replace tokens with contact data
└────────┬───────────┘     {{first_name}}, {{company}}, etc.
         │                 Flag items > 300 chars for manual editing
         ▼
┌────────────────────┐
│ Add Follow-ups     │ ─── Connections from last 7 days without first message
└────────┬───────────┘     (planned, not yet implemented)
         │
         ▼
┌────────────────────┐
│ Add Re-engagement  │ ─── Score dropped >15 points in 30 days
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Create QueueItems │ ─── Insert into queue_items table
└────────────────────┘     status = 'pending'
```

#### Skip Requeue Behavior

When a user skips a queue item, that contact is excluded from future daily queues
for a configurable duration (default: 30 days). This prevents the same irrelevant
contacts from resurfacing daily. The duration is controlled by the `skip_requeue_days`
setting in the `settings` table.

After the skip window expires, the contact becomes eligible for queue selection
again based on their priority score.

### Scoring Batch Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     NIGHTLY SCORE CALCULATION                                │
└─────────────────────────────────────────────────────────────────────────────┘

2:00 AM (overnight)
         │
         ▼
┌────────────────────┐
│ Fetch All Contacts │
└────────┬───────────┘
         │
         ▼ (for each contact)
┌────────────────────┐
│ Fetch Interactions │ ─── All interactions for this contact
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Apply Base Points  │ ─── ScoringConfig lookup per interaction type
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Apply Recency      │ ─── points × 0.5^(days_ago / 90)
│ Decay              │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Calculate          │ ─── their_initiated / total_interactions
│ Reciprocity        │     if ≥ 30%: multiply by 1.3-1.5
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Normalize to 0-100 │ ─── Cap at 100
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Update Contact     │ ─── SET relationship_score = X
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Log Score History  │ ─── INSERT into score_history
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Check Status       │ ─── Promote or demote based on thresholds
│ Transitions        │
└────────────────────┘
```

## 4. Integration Architecture

### LinkedIn Integration (Phase 2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LINKEDIN INTEGRATION                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌──────────────────┐
                         │   Bull Queue     │
                         │ linkedin-worker  │
                         └────────┬─────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Connection      │    │ Profile         │    │ Activity        │
│ Request Job     │    │ Enrichment Job  │    │ Monitor Job     │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Rate Limiter (Redis)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Weekly Counter  │  │ Daily Counter   │  │ Cooldown Flag   │  │
│  │ (100 max)       │  │ (20 max)        │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ If under limits
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Playwright Browser                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            Persistent Browser Context                    │    │
│  │            (cookies saved between runs)                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│  ┌────────────┐     ┌────────────┐     ┌────────────┐          │
│  │ Navigate   │     │ Scrape     │     │ Send       │          │
│  │ to Profile │     │ Profile    │     │ Request    │          │
│  └────────────┘     └────────────┘     └────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  │ Random delay (2-5 min)
                                  ▼
                         ┌───────────────┐
                         │ Next Job      │
                         └───────────────┘
```

### Rate Limit Coordination

All LinkedIn operations share a single rate limit pool:

```typescript
// Redis keys
linkedin:requests:week:{weekStart}     // Counter, resets Monday
linkedin:requests:day:{date}           // Counter, resets daily
linkedin:cooldown                      // Boolean flag
linkedin:cooldown:ends                 // Timestamp

// Before any LinkedIn operation:
1. Check cooldown flag → if set, reject job
2. Check weekly counter → if ≥ 100, reject job
3. Check daily counter → if ≥ 20, delay job to tomorrow
4. Increment counters
5. Execute operation
6. If operation fails with soft ban signal → set cooldown
```

### Gmail/Calendar Integration (Phase 3)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EMAIL/CALENDAR SYNC                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ Google OAuth 2.0 │ ─── Scopes: gmail.readonly, calendar.readonly
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│   Gmail Sync     │     │  Calendar Sync   │
│   (hourly)       │     │  (hourly)        │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│ Fetch messages   │     │ Fetch events     │
│ since last sync  │     │ since last sync  │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│ Extract:         │     │ Extract:         │
│ - from/to emails │     │ - attendee emails│
│ - thread ID      │     │ - event type     │
│ - timestamp      │     │ - location/link  │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│ Match emails to  │     │ Match emails to  │
│ contacts         │     │ contacts         │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────┐
│           Create Interactions               │
│  - Type: email / meeting_1on1 / meeting_group
│  - Source: gmail / calendar                 │
│  - Metadata: thread_id, event_id, etc.     │
└─────────────────────────────────────────────┘
```

## 5. Key Design Decisions

### Relational vs Graph Database

**Decision:** PostgreSQL (relational) with JSONB

**Rationale:**

- Contact relationships are primarily one-to-many (contact → interactions, contact → tags), not many-to-many graph traversals
- Second-degree connection analysis is LinkedIn's job — we store the count, not the graph
- PostgreSQL's JSONB provides flexibility for variable metadata without schema changes
- Prisma ORM provides excellent TypeScript integration and migration support
- Network visualization (Phase 3) can be built on top of relational data with a graph rendering library

**Trade-off:** If second-degree analysis becomes core (mining who-knows-who), revisit with Neo4j or PostgreSQL's graph extensions.

### Job Queue Architecture

**Decision:** Bull (Redis-backed) with separate queues per job type

**Rationale:**

- Bull provides reliable job persistence, retry logic, and scheduling
- Separate queues allow different concurrency settings (LinkedIn: 1 concurrent, scoring: 10 concurrent)
- Redis also serves as rate limit counter and cache layer
- Bull's delay feature enables "send next request in 3 minutes" without custom scheduling

**Job Queue Configuration:**

```javascript
// linkedin-worker: 1 concurrent, respect rate limits
// score-processor: 10 concurrent, batch processing
// email-sync: 1 concurrent, API rate limits
// calendar-sync: 1 concurrent, API rate limits
```

### Enrichment Conflict Resolution

**Decision:** Source hierarchy with explicit conflict tracking

**Hierarchy:** Manual > Email/Calendar > LinkedIn

**Implementation:**

- Each field tracks its source (manual, linkedin, gmail, calendar)
- When a new value differs from existing, create a DataConflict record
- Dashboard surfaces conflicts for resolution
- Exception: LinkedIn data 60+ days newer than manual triggers a "suggestion" workflow

### Rate Limit Enforcement

**Decision:** Hard enforcement at infrastructure level, not application level

**Implementation:**

- Redis counters are the source of truth
- All LinkedIn operations go through a shared rate limiter
- Counter checks happen before job execution, not after
- Cooldown flag is a circuit breaker — one flag stops all operations
- Weekly counter resets via scheduled job Monday 00:00

### Soft Delete Strategy

**Decision:** Soft delete with 30-day retention, then hard delete

**Implementation:**

- `deleted_at` timestamp on Contact
- All queries filter `WHERE deleted_at IS NULL` by default
- Nightly job hard-deletes records where `deleted_at < NOW() - 30 days`
- Merge history preserves absorbed contact data indefinitely (for undo)

## 6. Security & Privacy

### Data Ownership

- All data stored locally or in user's own Railway/cloud instance
- No data shared with third parties
- No analytics or telemetry sent externally

### Authentication

- Single-user system: simple session-based auth or local-only (no auth needed if running locally)
- Google OAuth for Gmail/Calendar (read-only scopes, tokens stored encrypted)
- LinkedIn: session cookies stored encrypted in browser context

### Data Export

- Full export available: CSV or JSON
- Per-contact export for GDPR-style requests
- Includes all fields, interactions, scores, history

### Data Deletion

- Soft delete with 30-day recovery window
- Hard delete permanently removes all data including interactions and history
- Merge history snapshots allow restoring merged contacts

### Sensitive Data Handling

- Email content is NOT stored — only metadata (from, to, date, thread_id)
- Calendar event content is NOT stored — only metadata (attendees, time, type)
- LinkedIn messages are NOT stored — only count and recency
- No storing of passwords or sensitive credentials (OAuth tokens only)

### Browser Automation Security

- Playwright browser context isolated from system browser
- Cookies stored encrypted on disk
- Browser profile directory is gitignored
- Cooldown mode prevents automation when account is at risk

## 7. Performance Targets

### Response Times

| Operation                | Target                        |
| ------------------------ | ----------------------------- |
| Contact search/filter    | < 200ms for 10K contacts      |
| Contact detail page load | < 300ms                       |
| Daily queue generation   | < 30 seconds for 10K contacts |
| Score batch processing   | < 5 minutes for 10K contacts  |

### Capacity

| Metric                   | Target                 |
| ------------------------ | ---------------------- |
| Total contacts           | 10,000+                |
| Interactions per contact | 1,000+                 |
| Templates                | 100+                   |
| Concurrent users         | 1 (single-user system) |

### Database Optimization

- Index on `contacts.status` (enum, frequent filter)
- Index on `contacts.relationship_score` (range queries)
- Composite index on `contacts(status, priority_score)` for queue generation
- Full-text index on `contacts(first_name, last_name, company, title, notes)`
- Partial index: `WHERE deleted_at IS NULL` on frequently queried tables

### Caching Strategy

- Redis cache for:
  - Rate limit counters (TTL: 1 week)
  - Scoring config (TTL: 1 hour, invalidate on update)
  - Dashboard aggregates (TTL: 5 minutes)
- No caching for contact data (always fresh from DB)

## 8. Deployment Architecture

### Development

```
┌─────────────────────────────────────────┐
│           Docker Compose                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Next.js │ │PostgreSQL│ │  Redis  │   │
│  │  :3000  │ │  :5432   │ │  :6379  │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘
```

### Production (Railway)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Railway Project                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │   Web       │ │   Worker    │ │  PostgreSQL │ │   Redis   │ │
│  │  (Next.js)  │ │  (Bull)     │ │  (managed)  │ │ (managed) │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# Google OAuth (Phase 3)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# App Config
QUEUE_GENERATION_HOUR=7        # 7 AM local
LINKEDIN_WEEKLY_LIMIT=100
LINKEDIN_DAILY_LIMIT=20
LINKEDIN_REQUEST_GAP_MIN=120   # 2 minutes in seconds
LINKEDIN_REQUEST_GAP_MAX=300   # 5 minutes in seconds
COOLDOWN_DAYS=7

# Feature Flags
GUIDED_MODE=true               # Start with guided mode in Phase 1
LINKEDIN_AUTOMATION=false      # Enable in Phase 2
GMAIL_INTEGRATION=false        # Enable in Phase 3
CALENDAR_INTEGRATION=false     # Enable in Phase 3
```
