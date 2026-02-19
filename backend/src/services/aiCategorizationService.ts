import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';

// ─── Persona categories with tuned relevance weights ────────────────────────

const PERSONA_CATEGORIES: { name: string; relevanceWeight: number }[] = [
  { name: 'Regulator/Policy', relevanceWeight: 9 },
  { name: 'Potential Employer', relevanceWeight: 9 },
  { name: 'Venture Capital', relevanceWeight: 8 },
  { name: 'C-Suite/Founder', relevanceWeight: 7 },
  { name: 'General Industry', relevanceWeight: 6 },
  { name: 'Crypto Compliance', relevanceWeight: 5 },
  { name: 'Operator/CoS', relevanceWeight: 5 },
  { name: 'MBA Network', relevanceWeight: 5 },
];

const NEEDS_REVIEW_CATEGORY = { name: 'Needs Review', relevanceWeight: 2 };

const SYSTEM_PROMPT = `You are a contact classification assistant. Given a list of professional contacts, classify each into exactly ONE of these persona categories:

1. **Regulator/Policy** — Government officials, policy makers, regulators, compliance officers at government agencies. Example titles: "Policy Advisor", "Commissioner", "Director at SEC", "Government Relations".
2. **Potential Employer** — Recruiters, hiring managers, HR directors, talent acquisition professionals. Example titles: "Recruiter", "Head of Talent", "HR Director", "Hiring Manager".
3. **Venture Capital** — VCs, investors, partners at investment firms, angel investors. Example titles: "Partner at Sequoia", "Managing Director at a16z", "Venture Partner", "Angel Investor".
4. **C-Suite/Founder** — CEOs, CTOs, COOs, founders, co-founders, presidents of companies. Example titles: "CEO", "Co-Founder", "CTO", "President".
5. **General Industry** — Professionals in relevant industries (finance, tech, consulting) who don't fit other categories. Example titles: "Senior Analyst", "Product Manager", "Engineer", "Consultant".
6. **Crypto Compliance** — Professionals in crypto/blockchain/web3 compliance, legal, or regulatory roles. Example titles: "Head of Compliance at Coinbase", "Crypto Counsel", "Blockchain Policy Lead".
7. **Operator/CoS** — Chiefs of Staff, operations leaders, business operations professionals. Example titles: "Chief of Staff", "VP Operations", "Head of Business Operations".
8. **MBA Network** — MBA students, recent MBA graduates, business school alumni, professors. Example titles: "MBA Candidate at Wharton", "MBA '24", "Professor of Finance".

For each contact, return your classification as a JSON array. Each element should have:
- "contactId": the ID provided
- "category": one of the exact category names above
- "confidence": "high", "medium", or "low"

Use "low" confidence when:
- The title/company combination is ambiguous
- Not enough information to be certain
- The contact could fit multiple categories equally

Respond ONLY with a valid JSON array, no other text.`;

// ─── Anthropic client singleton ─────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropicClient;
}

// ─── Batch classification ───────────────────────────────────────────────────

interface ContactForClassification {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  headline: string | null;
}

interface ClassificationResult {
  contactId: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
}

const VALID_CATEGORIES = new Set(PERSONA_CATEGORIES.map((c) => c.name));

async function classifyBatch(contacts: ContactForClassification[]): Promise<ClassificationResult[]> {
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic API key not configured');

  const contactList = contacts
    .map((c) => {
      const parts = [`ID: ${c.id}`, `Name: ${c.firstName} ${c.lastName}`];
      if (c.title) parts.push(`Title: ${c.title}`);
      if (c.company) parts.push(`Company: ${c.company}`);
      if (c.headline) parts.push(`Headline: ${c.headline}`);
      return parts.join(' | ');
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Classify these ${contacts.length} contacts:\n\n${contactList}`,
      },
    ],
  });

  // Extract text from response
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Anthropic');
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as ClassificationResult[];

  // Validate and filter results
  return parsed.filter(
    (r) =>
      r.contactId &&
      VALID_CATEGORIES.has(r.category) &&
      ['high', 'medium', 'low'].includes(r.confidence)
  );
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

interface AiCategorizeOptions {
  contactIds?: string[];
  force?: boolean;
  dryRun?: boolean;
}

interface AiCategorizeResult {
  total: number;
  categorized: number;
  flaggedForReview: number;
  skipped: number;
  errors: number;
  results: {
    contactId: string;
    name: string;
    category: string;
    confidence: string;
  }[];
}

export async function aiCategorizeContacts(
  options: AiCategorizeOptions = {}
): Promise<AiCategorizeResult> {
  const { contactIds, force = false, dryRun = false } = options;

  const summary: AiCategorizeResult = {
    total: 0,
    categorized: 0,
    flaggedForReview: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  // 1. Query contacts
  const whereClause: Record<string, unknown> = { deletedAt: null };
  if (contactIds && contactIds.length > 0) {
    whereClause.id = { in: contactIds };
  }

  const contacts = await prisma.contact.findMany({
    where: whereClause,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      company: true,
      headline: true,
      categories: {
        include: { category: true },
      },
    },
  });

  summary.total = contacts.length;

  // Filter out Legacy and already-categorized (unless force)
  const eligible = contacts.filter((c) => {
    const categoryNames = c.categories.map((cc) => cc.category.name);

    // Skip Legacy contacts
    if (categoryNames.some((n) => n.toLowerCase().includes('legacy'))) {
      summary.skipped++;
      return false;
    }

    // Skip already AI-categorized (unless force)
    if (!force) {
      const hasPersonaCategory = categoryNames.some((n) => VALID_CATEGORIES.has(n));
      if (hasPersonaCategory) {
        summary.skipped++;
        return false;
      }
    }

    return true;
  });

  if (eligible.length === 0) return summary;

  // 2. Upsert all persona categories + Needs Review
  const categoryMap = new Map<string, string>();
  for (const cat of [...PERSONA_CATEGORIES, NEEDS_REVIEW_CATEGORY]) {
    const dbCat = await prisma.category.upsert({
      where: { name: cat.name },
      update: { relevanceWeight: cat.relevanceWeight },
      create: { name: cat.name, relevanceWeight: cat.relevanceWeight },
    });
    categoryMap.set(cat.name, dbCat.id);
  }

  // Also look up "Uncategorized" for later removal
  const uncategorizedCat = await prisma.category.findUnique({
    where: { name: 'Uncategorized' },
  });

  // 3. Process in batches of 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);

    try {
      const results = await classifyBatch(batch);

      for (const result of results) {
        const contact = batch.find((c) => c.id === result.contactId);
        if (!contact) continue;

        const categoryId = categoryMap.get(result.category);
        if (!categoryId) continue;

        summary.results.push({
          contactId: result.contactId,
          name: `${contact.firstName} ${contact.lastName}`,
          category: result.category,
          confidence: result.confidence,
        });

        if (!dryRun) {
          // Assign AI-determined category
          await prisma.contactCategory.createMany({
            data: [{ contactId: result.contactId, categoryId }],
            skipDuplicates: true,
          });

          // Low-confidence contacts also get "Needs Review"
          if (result.confidence === 'low') {
            const needsReviewId = categoryMap.get(NEEDS_REVIEW_CATEGORY.name)!;
            await prisma.contactCategory.createMany({
              data: [{ contactId: result.contactId, categoryId: needsReviewId }],
              skipDuplicates: true,
            });
            summary.flaggedForReview++;
          }

          // Remove "Uncategorized" from contacts that got a real category
          if (uncategorizedCat) {
            await prisma.contactCategory.deleteMany({
              where: {
                contactId: result.contactId,
                categoryId: uncategorizedCat.id,
              },
            });
          }
        } else if (result.confidence === 'low') {
          summary.flaggedForReview++;
        }

        summary.categorized++;
      }

      // Track contacts that weren't in the API response (errors)
      const returnedIds = new Set(results.map((r) => r.contactId));
      for (const contact of batch) {
        if (!returnedIds.has(contact.id)) {
          summary.errors++;
        }
      }
    } catch (err) {
      console.error(`AI categorization batch error:`, err);
      summary.errors += batch.length;
    }
  }

  return summary;
}

// ─── Convenience wrapper for imports ────────────────────────────────────────

export async function categorizeNewlyImported(contactIds: string[]): Promise<AiCategorizeResult | null> {
  if (!config.anthropicApiKey || contactIds.length === 0) return null;

  try {
    return await aiCategorizeContacts({ contactIds });
  } catch (err) {
    console.error('AI categorization failed for newly imported contacts:', err);
    return null;
  }
}
