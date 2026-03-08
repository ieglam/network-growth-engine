import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { enrichCompanyDescriptions, normalizeCompanyName } from './companyLookupService.js';

// ─── Persona categories with tuned relevance weights ────────────────────────

const PERSONA_CATEGORIES: { name: string; relevanceWeight: number }[] = [
  { name: 'Regulator/Policy', relevanceWeight: 9 },
  { name: 'Potential Employer', relevanceWeight: 9 },
  { name: 'Crypto/Blockchain Founder', relevanceWeight: 9 },
  { name: 'Venture Capital', relevanceWeight: 8 },
  { name: 'Fintech Founder', relevanceWeight: 7 },
  { name: 'General Industry', relevanceWeight: 6 },
  { name: 'Crypto Compliance', relevanceWeight: 5 },
  { name: 'Operator/CoS', relevanceWeight: 5 },
  { name: 'MBA Network', relevanceWeight: 5 },
  { name: 'General Founder', relevanceWeight: 3 },
];

const NEEDS_REVIEW_CATEGORY = { name: 'Needs Review', relevanceWeight: 2 };
const IRRELEVANT_CATEGORY = { name: 'Irrelevant', relevanceWeight: 0, isProtected: true };

const SYSTEM_PROMPT = `You are a contact classification assistant. Given a list of professional contacts, classify each into exactly ONE of these persona categories:

1. **Regulator/Policy** — Government officials, policy makers, regulators, compliance officers at government agencies. Example titles: "Policy Advisor", "Commissioner", "Director at SEC", "Government Relations".
2. **Potential Employer** — Recruiters, hiring managers, HR directors, talent acquisition professionals. Example titles: "Recruiter", "Head of Talent", "HR Director", "Hiring Manager".
3. **Venture Capital** — VCs, investors, partners at investment firms, angel investors. Example titles: "Partner at Sequoia", "Managing Director at a16z", "Venture Partner", "Angel Investor".
4. **Crypto/Blockchain Founder** — CEOs, CTOs, founders, co-founders at crypto, blockchain, web3, DeFi, digital asset, stablecoin, or token companies. Determine from the company description. Example: "CEO" at a company described as "provides blockchain payment solutions", "Founder" at a company in digital asset custody.
5. **Fintech Founder** — CEOs, CTOs, founders, co-founders at banking, payments, lending, neobank, BNPL, wealth management, insurance tech, or financial services companies. Example: "Founder" at a company described as "digital banking platform", "CEO" at a payment processing company.
6. **General Founder** — CEOs, CTOs, founders, co-founders, presidents at companies NOT in crypto or fintech. Catch-all for founder-level contacts in other industries. Example: "CEO" at a marketing agency, "Founder" at a food company.
7. **General Industry** — Professionals in relevant industries (finance, tech, consulting) who are NOT founders/CEOs/CTOs. Example titles: "Senior Analyst", "Product Manager", "Engineer", "Consultant".
8. **Crypto Compliance** — Non-founder professionals in crypto/blockchain/web3/DeFi compliance, legal, regulatory, or strategic roles. Example titles: "Head of Compliance at Coinbase", "Crypto Counsel", "Blockchain Policy Lead", "Crypto Functional Owner", "Blockchain Strategist", "Digital Assets Compliance".
9. **Operator/CoS** — Chiefs of Staff, operations leaders, business operations professionals. Example titles: "Chief of Staff", "VP Operations", "Head of Business Operations".
10. **MBA Network** — MBA students, recent MBA graduates, business school alumni, professors. Example titles: "MBA Candidate at Wharton", "MBA '24", "Professor of Finance".

FOUNDER CLASSIFICATION RULE:
For contacts with founder/CEO/CTO/COO/president titles, classify based on the company's industry using the company description:
- Crypto/blockchain/web3/DeFi/digital asset companies → **Crypto/Blockchain Founder**
- Banking/payments/lending/neobank/BNPL/wealth management/financial services companies → **Fintech Founder**
- All other companies or unknown companies → **General Founder**

CRYPTO COMPLIANCE RULE — Title overrides company for non-founder roles:
If a non-founder contact's title or headline contains ANY of these keywords: "crypto", "blockchain", "DeFi", "digital assets", "web3", "stablecoin", "token" — classify them as **Crypto Compliance** regardless of what company they work at.

For each contact, return your classification as a JSON array. Each element should have:
- "contactId": the ID provided
- "category": one of the exact category names above
- "confidence": "high", "medium", or "low"

Company descriptions in parentheses provide context about what the company does. Use this information to resolve ambiguous company names when classifying contacts.

Use "low" confidence when:
- The title/company combination is ambiguous
- Not enough information to be certain
- The contact could fit multiple categories equally

Respond ONLY with a valid JSON array, no other text.`;

const RELEVANCE_PROMPT = `You are a professional relevance filter. For each contact, determine if they are professionally relevant to ANY of these domains: fintech, crypto, blockchain, compliance, policy, regulation, venture capital, startups, law, consulting, B2B technology, finance, banking, or enterprise software.

Answer "yes" if the contact's title, company, or headline suggests they work in or adjacent to these domains.
Answer "no" ONLY if the contact is clearly in an unrelated field (e.g., florist, yoga instructor, personal trainer, artist with no tech connection).

When in doubt, answer "yes" — it is better to keep a borderline contact than to exclude someone relevant.

Return a JSON array with:
- "contactId": the ID provided
- "relevant": true or false

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

async function classifyBatch(
  contacts: ContactForClassification[],
  companyDescriptions: Map<string, string>
): Promise<ClassificationResult[]> {
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic API key not configured');

  const contactList = contacts
    .map((c) => {
      const parts = [`ID: ${c.id}`, `Name: ${c.firstName} ${c.lastName}`];
      if (c.title) parts.push(`Title: ${c.title}`);
      if (c.company) {
        const desc = companyDescriptions.get(normalizeCompanyName(c.company));
        if (desc && desc !== 'unknown') {
          parts.push(`Company: ${c.company} (${desc})`);
        } else {
          parts.push(`Company: ${c.company}`);
        }
      }
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

// ─── Relevance pre-filter ────────────────────────────────────────────────────

interface RelevanceResult {
  contactId: string;
  relevant: boolean;
}

async function filterRelevanceBatch(
  contacts: ContactForClassification[],
  companyDescriptions: Map<string, string>
): Promise<RelevanceResult[]> {
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic API key not configured');

  const contactList = contacts
    .map((c) => {
      const parts = [`ID: ${c.id}`, `Name: ${c.firstName} ${c.lastName}`];
      if (c.title) parts.push(`Title: ${c.title}`);
      if (c.company) {
        const desc = companyDescriptions.get(normalizeCompanyName(c.company));
        if (desc && desc !== 'unknown') {
          parts.push(`Company: ${c.company} (${desc})`);
        } else {
          parts.push(`Company: ${c.company}`);
        }
      }
      if (c.headline) parts.push(`Headline: ${c.headline}`);
      return parts.join(' | ');
    })
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: RELEVANCE_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Check relevance for these ${contacts.length} contacts:\n\n${contactList}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from relevance filter');
  }

  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr) as RelevanceResult[];
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

  // Filter out contacts in protected categories and already-categorized (unless force)
  const eligible = contacts.filter((c) => {
    const categoryNames = c.categories.map((cc) => cc.category.name);

    // Skip contacts in any protected category
    if (c.categories.some((cc) => cc.category.isProtected)) {
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

  // 2. Upsert all persona categories + Needs Review + Irrelevant
  const categoryMap = new Map<string, string>();
  for (const cat of [...PERSONA_CATEGORIES, NEEDS_REVIEW_CATEGORY]) {
    const dbCat = await prisma.category.upsert({
      where: { name: cat.name },
      update: { relevanceWeight: cat.relevanceWeight },
      create: { name: cat.name, relevanceWeight: cat.relevanceWeight },
    });
    categoryMap.set(cat.name, dbCat.id);
  }

  // Ensure Irrelevant category exists (protected, weight 0)
  const irrelevantCat = await prisma.category.upsert({
    where: { name: IRRELEVANT_CATEGORY.name },
    update: { relevanceWeight: 0, isProtected: true },
    create: { name: IRRELEVANT_CATEGORY.name, relevanceWeight: 0, isProtected: true },
  });
  categoryMap.set(IRRELEVANT_CATEGORY.name, irrelevantCat.id);

  // Also look up "Uncategorized" for later removal
  const uncategorizedCat = await prisma.category.findUnique({
    where: { name: 'Uncategorized' },
  });

  // 3. Enrich company descriptions for all unique companies
  const uniqueCompanies = [
    ...new Set(eligible.map((c) => c.company).filter((c): c is string => c !== null && c !== '')),
  ];
  const companyDescriptions = await enrichCompanyDescriptions(uniqueCompanies);

  // 4. Relevance pre-filter: mark irrelevant contacts before classification
  const BATCH_SIZE = 20;
  const irrelevantIds = new Set<string>();

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    try {
      const relevanceResults = await filterRelevanceBatch(batch, companyDescriptions);
      for (const r of relevanceResults) {
        if (!r.relevant) {
          irrelevantIds.add(r.contactId);
        }
      }
    } catch (err) {
      console.error('Relevance filter batch error:', err);
      // On error, skip filtering — classify all contacts
    }
  }

  // Assign irrelevant contacts immediately
  if (irrelevantIds.size > 0) {
    console.log(`[AI Categorize] ${irrelevantIds.size} contacts marked as Irrelevant`);
    const irrelevantCatId = categoryMap.get(IRRELEVANT_CATEGORY.name)!;

    for (const contactId of irrelevantIds) {
      const contact = eligible.find((c) => c.id === contactId);
      if (!contact) continue;

      summary.results.push({
        contactId,
        name: `${contact.firstName} ${contact.lastName}`,
        category: IRRELEVANT_CATEGORY.name,
        confidence: 'high',
      });

      if (!dryRun) {
        await prisma.contactCategory.createMany({
          data: [{ contactId, categoryId: irrelevantCatId }],
          skipDuplicates: true,
        });

        if (uncategorizedCat) {
          await prisma.contactCategory.deleteMany({
            where: { contactId, categoryId: uncategorizedCat.id },
          });
        }
      }

      summary.categorized++;
    }
  }

  // Filter out irrelevant contacts before classification
  const relevantEligible = eligible.filter((c) => !irrelevantIds.has(c.id));

  // 5. Classify relevant contacts in batches of 20
  for (let i = 0; i < relevantEligible.length; i += BATCH_SIZE) {
    const batch = relevantEligible.slice(i, i + BATCH_SIZE);

    try {
      const results = await classifyBatch(batch, companyDescriptions);

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
