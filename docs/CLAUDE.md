# Network Growth Engine - Claude Development Guide

## 1. Project Overview

Network Growth Engine is a personal network management system for scaling professional connections from 700 to 7,000+ through strategic targeting, automated outreach, and relationship tracking. The system uses Next.js, Node.js, PostgreSQL, Redis/Bull, and Playwright for LinkedIn automation.

## 2. Commands

### Development

```bash
# Start all services (frontend, backend, postgres, redis)
npm run dev

# Start frontend only
npm run dev:frontend

# Start backend only
npm run dev:backend

# Start with Docker Compose
docker-compose up

# Stop Docker services
docker-compose down
```

### Database

```bash
# Run migrations
npx prisma migrate dev

# Reset database (destructive)
npx prisma migrate reset

# Generate Prisma client
npx prisma generate

# Open Prisma Studio (DB browser)
npx prisma studio

# Seed database
npm run db:seed
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run backend tests only
npm run test:backend

# Run frontend tests only
npm run test:frontend

# Run e2e tests
npm run test:e2e
```

### Linting & Formatting

```bash
# Lint all code
npm run lint

# Fix lint errors
npm run lint:fix

# Format code
npm run format

# Type check
npm run typecheck

# Run all checks (lint + format + typecheck)
npm run verify
```

### Build & Production

```bash
# Build for production
npm run build

# Start production server
npm run start

# Build and start
npm run prod
```

### Background Jobs

```bash
# Start job workers
npm run workers

# Run a specific job manually
npm run job:daily-queue
npm run job:score-batch
npm run job:gmail-sync
npm run job:calendar-sync
```

## 3. Conventions

### File Naming

```
# Components: PascalCase
frontend/src/components/ContactList.tsx
frontend/src/components/QueueItem.tsx

# Pages (Next.js App Router): lowercase with dashes
frontend/src/app/contacts/page.tsx
frontend/src/app/contacts/[id]/page.tsx
frontend/src/app/queue/page.tsx

# API routes: lowercase with dashes
backend/src/routes/contacts.ts
backend/src/routes/queue-items.ts

# Services: camelCase
backend/src/services/scoringService.ts
backend/src/services/duplicateDetector.ts

# Types: PascalCase, suffix with .types.ts
shared/types/contact.types.ts
shared/types/queue.types.ts

# Tests: same name with .test.ts suffix
backend/src/services/scoringService.test.ts
frontend/src/components/ContactList.test.tsx
```

### Directory Structure

```
/
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js App Router pages
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom React hooks
│   │   ├── lib/              # Utility functions
│   │   └── styles/           # Global styles
│   └── public/               # Static assets
├── backend/
│   ├── src/
│   │   ├── routes/           # API route handlers
│   │   ├── services/         # Business logic
│   │   ├── jobs/             # Bull job processors
│   │   ├── lib/              # Shared utilities
│   │   └── middleware/       # Fastify middleware/hooks
│   └── prisma/
│       ├── schema.prisma     # Database schema
│       ├── migrations/       # Migration files
│       └── seed.ts           # Seed script
├── shared/
│   └── types/                # Shared TypeScript types
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── TASKS.md
│   └── CLAUDE.md
└── docker-compose.yml
```

### Migration Naming

```
# Format: YYYYMMDDHHMMSS_description_in_snake_case
20260212143000_create_contacts_table
20260212143500_add_categories_and_tags
20260213100000_add_scoring_config
```

### Commit Format

```
# Format: type(scope): description

feat(contacts): add CSV import with duplicate detection
fix(scoring): correct recency decay calculation
refactor(queue): extract template rendering to service
test(api): add contact search endpoint tests
docs(readme): update setup instructions
chore(deps): upgrade prisma to 5.10

# Types: feat, fix, refactor, test, docs, chore, style, perf
# Scope: contacts, queue, scoring, templates, dashboard, api, ui, db
```

### Branch Naming

```
# Format: type/task-id-short-description

feature/TASK-004-contact-crud
fix/TASK-032-scoring-decay
refactor/TASK-014-status-transitions
```

### Code Style

```typescript
// Use explicit return types for functions
function calculateScore(contact: Contact): number { ... }

// Use async/await over .then()
const contacts = await prisma.contact.findMany();

// Use early returns for guard clauses
if (!contact) {
  throw new NotFoundError('Contact not found');
}

// Destructure props in React components
function ContactCard({ contact, onEdit }: ContactCardProps) { ... }

// Use const for immutable values
const RATE_LIMIT_WEEKLY = 100;
const SCORE_BANDS = { cold: 20, warm: 50, active: 75 } as const;
```

## 4. Workflow After Completing ANY Task

After completing any task, follow this workflow before committing:

### 1. Run Verification Suite

```bash
# Run all checks - MUST pass before commit
npm run verify

# This runs:
# - ESLint
# - Prettier format check
# - TypeScript type check
# - All tests
```

### 2. Update TASKS.md

```markdown
# Change task status from [ ] to [x]

### TASK-004: Contact CRUD API

**Status:** `[x]` # <-- Update this
```

### 3. Update Documentation (if behavior changed)

- If you changed API endpoints → update API docs
- If you changed data model → update ARCHITECTURE.md data model section
- If you added new settings → update PRD.md settings list
- If you changed scoring formula → update PRD.md scoring section

### 4. Commit and Push

```bash
# Stage changes
git add .

# Commit with proper format
git commit -m "feat(contacts): implement CRUD API endpoints

- Add POST/GET/PUT/DELETE for contacts
- Implement soft delete with 30-day retention
- Add field source tracking for manual edits

Closes TASK-004"

# Push to feature branch
git push origin feature/TASK-004-contact-crud
```

### 5. Open PR

```bash
# Create PR using gh CLI
gh pr create --title "feat(contacts): implement CRUD API" --body "
## Summary
Implements contact CRUD operations per TASK-004.

## Changes
- POST /api/contacts - create contact
- GET /api/contacts/:id - get contact
- PUT /api/contacts/:id - update contact
- DELETE /api/contacts/:id - soft delete

## Testing
- Added unit tests for all endpoints
- Manual testing with Postman

## Checklist
- [x] Tests pass
- [x] Lint passes
- [x] TASKS.md updated
- [x] Documentation updated (if needed)
"
```

## 5. Rules

### Never Skip Verification

```bash
# ALWAYS run before commit
npm run verify

# If tests fail, fix them before committing
# If lint fails, run npm run lint:fix
# If types fail, fix the type errors
```

### Never Modify Data Model Without Updating Docs

When changing the Prisma schema:

1. Create migration: `npx prisma migrate dev --name descriptive_name`
2. Update `ARCHITECTURE.md` → Data Model section
3. Update `PRD.md` → Data Model section (if user-facing)
4. Update relevant API documentation

### Full Test Suite Before Commit

```bash
# Run the full suite, not just affected tests
npm test

# If adding a new feature, add tests for:
# - Happy path
# - Error cases
# - Edge cases
```

### Re-plan After 3 Failed Attempts

If you've tried 3 different approaches to solve a problem and all failed:

1. Stop coding
2. Document what you tried and why it failed
3. Re-read the relevant PRD section
4. Check ARCHITECTURE.md for constraints you might have missed
5. Ask for clarification if needed
6. Create a new plan before continuing

### TASKS.md is Single Source of Truth

- Check TASKS.md before starting work to see dependencies
- Update TASKS.md immediately when completing a task
- If you discover a task is blocked, note it in TASKS.md
- If you discover new tasks needed, add them to TASKS.md with proper IDs

### API Response Consistency

All API responses should follow this format:

```typescript
// Success response
{
  "success": true,
  "data": { ... }
}

// Error response
{
  "success": false,
  "error": {
    "code": "CONTACT_NOT_FOUND",
    "message": "Contact with ID xyz not found"
  }
}

// List response with pagination
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## 6. Known Gotchas

### LinkedIn Rate Limits

```
Weekly cap: 100 connection requests
Daily cap: 20 connection requests
Request spacing: 2-5 minutes between requests

CRITICAL: Never exceed these limits. The rate limiter in Redis is the
source of truth. Always check canSendRequest() before any LinkedIn operation.

If you see a soft ban signal (request failures, warning banners),
immediately trigger cooldown mode. Do not attempt to retry.
```

### LinkedIn Connection Notes

```
MAX LENGTH: 300 characters

All rendered templates MUST be validated against this limit:
- Before displaying in queue
- Before sending via automation
- After token substitution (tokens can expand to longer values)

If a rendered note exceeds 300 chars:
1. Flag the queue item for manual editing
2. Do NOT send automatically
3. Show the character count and overage amount in UI

Template editor should:
- Show live character count
- Warn at 280 characters (yellow)
- Hard block save at 300 characters (red)
```

### JSONB Validation

```typescript
// Prisma doesn't validate JSONB structure
// Always validate before insert

import { z } from 'zod';

const InteractionMetadataSchema = z.object({
  threadId: z.string().optional(),
  meetingLink: z.string().url().optional(),
  notes: z.string().optional(),
});

// Validate before saving
const metadata = InteractionMetadataSchema.parse(input.metadata);
```

### Playwright Browser Context Cleanup

```typescript
// ALWAYS close the browser context when done
// Memory leaks occur if contexts are left open

let browser: Browser;
let context: BrowserContext;

try {
  browser = await chromium.launch();
  context = await browser.newContext({ storageState: 'cookies.json' });
  // ... do work
} finally {
  await context?.close();
  await browser?.close();
}

// For persistent contexts, save state before closing
await context.storageState({ path: 'cookies.json' });
```

### Daily Request Spreading

```typescript
// Don't send all requests at once
// Spread 15-20 requests across the business day with random gaps

function getNextRequestDelay(): number {
  const MIN_GAP_MS = 2 * 60 * 1000; // 2 minutes
  const MAX_GAP_MS = 5 * 60 * 1000; // 5 minutes
  return Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS)) + MIN_GAP_MS;
}

// Use Bull's delay feature
await linkedinQueue.add('connection-request', data, {
  delay: getNextRequestDelay(),
});
```

### Scoring Recalculation Triggers

```typescript
// Score recalculation is expensive - don't trigger unnecessarily

// DO: Batch recalculate overnight
// DON'T: Recalculate on every interaction

// DO: Allow on-demand single-contact recalc
// DON'T: Expose "recalculate all" button to UI

// DO: Recalculate affected contacts after bulk import
// DON'T: Recalculate during import (do it after)
```

### Status Transition Guards

```typescript
// Status transitions have guards - don't bypass them

// connected → engaged requires:
// 1. score >= 30
// 2. >= 2 logged interactions

// engaged → relationship requires:
// 1. score >= 60
// 2. >= 1 reciprocal interaction (they initiated)

// Always check both conditions, not just score
```

### Duplicate Detection Order

```typescript
// Duplicate detection has a confidence hierarchy
// Process in this order:

// 1. LinkedIn URL match → auto-merge (highest confidence)
// 2. Email match → auto-merge (flag if LinkedIn URLs differ)
// 3. Phone match → auto-merge
// 4. Name + Company match → manual review
// 5. Fuzzy name + Company → manual review

// Never auto-merge on name alone
```

### Template Token Edge Cases

```typescript
// Handle missing token data gracefully

const TOKENS = {
  first_name: contact.firstName || '',
  company: contact.company || 'your company',
  mutual_connection: contact.mutualConnections?.[0]?.name || '',
  recent_post: contact.recentPost?.topic || '',
};

// For optional tokens, either:
// 1. Remove the sentence containing the token
// 2. Replace with generic text
// 3. Flag for manual review before sending
```

### Redis Key Expiration

```typescript
// Set appropriate TTLs for Redis keys

// Rate limit counters: expire after 1 week (reset Monday)
await redis.set(`linkedin:requests:week:${weekStart}`, count, 'EX', 7 * 24 * 60 * 60);

// Daily counters: expire after 1 day
await redis.set(`linkedin:requests:day:${today}`, count, 'EX', 24 * 60 * 60);

// Cache: short TTL to ensure freshness
await redis.set('dashboard:metrics', json, 'EX', 5 * 60); // 5 minutes

// Cooldown: set explicit end time, not relative TTL
await redis.set('linkedin:cooldown:ends', endTimestamp);
```

### Timezone Handling

```typescript
// Queue generation time is in user's local timezone
// Store as hour (0-23), compute UTC offset at runtime

const queueHour = await getSettingValue('queue_generation_hour'); // e.g., 7
const userTimezone = 'America/Mexico_City';
const cronExpression = `0 ${queueHour} * * *`;

// Use a timezone-aware cron library or convert to UTC
```

### Soft Delete Queries

```typescript
// Always filter soft-deleted records in queries
// Use Prisma middleware or manual filter

// Middleware approach (recommended):
prisma.$use(async (params, next) => {
  if (params.model === 'Contact' && params.action === 'findMany') {
    params.args.where = {
      ...params.args.where,
      deletedAt: null,
    };
  }
  return next(params);
});

// Or use a base query helper
function activeContacts() {
  return prisma.contact.findMany({
    where: { deletedAt: null },
  });
}
```
