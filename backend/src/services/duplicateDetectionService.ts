import { prisma } from '../lib/prisma.js';

interface DuplicateMatch {
  contactAId: string;
  contactBId: string;
  matchType: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Run duplicate detection across all active contacts.
 * Returns counts of auto-merged and flagged pairs.
 */
export async function runDuplicateDetection(): Promise<{
  autoMerged: number;
  flagged: number;
}> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      linkedinUrl: true,
      email: true,
      phone: true,
    },
  });

  const matches: DuplicateMatch[] = [];

  // Build lookup indexes
  const urlMap = new Map<string, string[]>();
  const emailMap = new Map<string, string[]>();
  const phoneMap = new Map<string, string[]>();
  const nameCompanyMap = new Map<string, string[]>();

  for (const c of contacts) {
    if (c.linkedinUrl) {
      const normalized = normalizeUrl(c.linkedinUrl);
      if (!urlMap.has(normalized)) urlMap.set(normalized, []);
      urlMap.get(normalized)!.push(c.id);
    }

    if (c.email) {
      const normalized = c.email.toLowerCase().trim();
      if (!emailMap.has(normalized)) emailMap.set(normalized, []);
      emailMap.get(normalized)!.push(c.id);
    }

    if (c.phone) {
      const normalized = normalizePhone(c.phone);
      if (normalized) {
        if (!phoneMap.has(normalized)) phoneMap.set(normalized, []);
        phoneMap.get(normalized)!.push(c.id);
      }
    }

    const nameKey = `${c.firstName.toLowerCase()}|${c.lastName.toLowerCase()}|${(c.company || '').toLowerCase()}`;
    if (c.company) {
      if (!nameCompanyMap.has(nameKey)) nameCompanyMap.set(nameKey, []);
      nameCompanyMap.get(nameKey)!.push(c.id);
    }
  }

  const seenPairs = new Set<string>();

  function addMatch(
    idA: string,
    idB: string,
    matchType: string,
    confidence: 'high' | 'medium' | 'low'
  ) {
    const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
    const key = `${a}|${b}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    matches.push({ contactAId: a, contactBId: b, matchType, confidence });
  }

  // 1. LinkedIn URL exact match → high confidence
  for (const ids of urlMap.values()) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 'linkedin_url', 'high');
        }
      }
    }
  }

  // 2. Email exact match → high confidence
  for (const ids of emailMap.values()) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 'email', 'high');
        }
      }
    }
  }

  // 3. Phone exact match → high confidence
  for (const ids of phoneMap.values()) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 'phone', 'high');
        }
      }
    }
  }

  // 4. Name + Company exact match → medium confidence
  for (const ids of nameCompanyMap.values()) {
    if (ids.length > 1) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          addMatch(ids[i], ids[j], 'name_company', 'medium');
        }
      }
    }
  }

  // 5. Fuzzy name + Company → low confidence
  const contactsWithCompany = contacts.filter((c) => c.company);
  for (let i = 0; i < contactsWithCompany.length; i++) {
    for (let j = i + 1; j < contactsWithCompany.length; j++) {
      const a = contactsWithCompany[i];
      const b = contactsWithCompany[j];
      if (a.company!.toLowerCase() !== b.company!.toLowerCase()) continue;

      // Skip if already matched by exact name
      const exactKey = `${a.firstName.toLowerCase()}|${a.lastName.toLowerCase()}|${a.company!.toLowerCase()}`;
      if (nameCompanyMap.has(exactKey) && nameCompanyMap.get(exactKey)!.length > 1) continue;

      if (fuzzyNameMatch(a.firstName, a.lastName, b.firstName, b.lastName)) {
        addMatch(a.id, b.id, 'fuzzy_name_company', 'low');
      }
    }
  }

  // Remove existing pending pairs that we'd re-create
  const existingPairs = await prisma.duplicatePair.findMany({
    where: { status: 'pending' },
    select: { contactAId: true, contactBId: true },
  });
  const existingPairSet = new Set(existingPairs.map((p) => `${p.contactAId}|${p.contactBId}`));

  // Also skip dismissed pairs
  const dismissedPairs = await prisma.duplicatePair.findMany({
    where: { status: 'dismissed' },
    select: { contactAId: true, contactBId: true },
  });
  const dismissedPairSet = new Set(dismissedPairs.map((p) => `${p.contactAId}|${p.contactBId}`));

  let autoMerged = 0;
  let flagged = 0;

  for (const match of matches) {
    const pairKey = `${match.contactAId}|${match.contactBId}`;

    // Skip already existing or dismissed pairs
    if (existingPairSet.has(pairKey) || dismissedPairSet.has(pairKey)) continue;

    if (match.confidence === 'high') {
      // Auto-merge: keep the more complete record
      await autoMergeContacts(match.contactAId, match.contactBId, match.matchType);
      autoMerged++;
    } else {
      // Flag for manual review
      await prisma.duplicatePair.create({
        data: {
          contactAId: match.contactAId,
          contactBId: match.contactBId,
          matchType: match.matchType,
          confidence: match.confidence,
          status: 'pending',
        },
      });
      flagged++;
    }
  }

  return { autoMerged, flagged };
}

/**
 * Auto-merge two contacts: keep the primary (more complete), soft-delete the other.
 */
async function autoMergeContacts(
  contactAId: string,
  contactBId: string,
  matchType: string
): Promise<void> {
  const [a, b] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactAId } }),
    prisma.contact.findUnique({ where: { id: contactBId } }),
  ]);

  if (!a || !b) return;

  // Pick the more complete record as primary
  const scoreA = completenessScore(a);
  const scoreB = completenessScore(b);
  const [primary, secondary] = scoreA >= scoreB ? [a, b] : [b, a];

  // Merge: fill missing fields on primary from secondary
  const updates: Record<string, unknown> = {};
  const mergeableFields = [
    'title',
    'company',
    'linkedinUrl',
    'email',
    'phone',
    'location',
    'headline',
    'seniority',
    'notes',
    'introductionSource',
  ] as const;

  for (const field of mergeableFields) {
    if (!primary[field] && secondary[field]) {
      updates[field] = secondary[field];
    }
  }

  // Keep higher scores
  if (secondary.relationshipScore > primary.relationshipScore) {
    updates.relationshipScore = secondary.relationshipScore;
  }

  if (Object.keys(updates).length > 0) {
    await prisma.contact.update({
      where: { id: primary.id },
      data: updates,
    });
  }

  // Soft-delete the secondary
  await prisma.contact.update({
    where: { id: secondary.id },
    data: { deletedAt: new Date() },
  });

  // Record merge history
  await prisma.mergeHistory.create({
    data: {
      primaryContactId: primary.id,
      mergedContactId: secondary.id,
      mergedContactData: JSON.parse(JSON.stringify(secondary)),
      mergeType: 'auto',
    },
  });

  // Record in duplicate_pairs as merged
  await prisma.duplicatePair.upsert({
    where: {
      contactAId_contactBId: {
        contactAId: contactAId < contactBId ? contactAId : contactBId,
        contactBId: contactAId < contactBId ? contactBId : contactAId,
      },
    },
    update: {
      status: 'merged',
      resolvedAt: new Date(),
    },
    create: {
      contactAId: contactAId < contactBId ? contactAId : contactBId,
      contactBId: contactAId < contactBId ? contactBId : contactAId,
      matchType,
      confidence: 'high',
      status: 'merged',
      resolvedAt: new Date(),
    },
  });
}

function completenessScore(contact: Record<string, unknown>): number {
  const fields = [
    'title',
    'company',
    'linkedinUrl',
    'email',
    'phone',
    'location',
    'headline',
    'seniority',
    'notes',
  ];
  return fields.filter((f) => !!contact[f]).length;
}

function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?linkedin\.com/, '')
    .replace(/\/+$/, '')
    .trim();
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits;
}

function fuzzyNameMatch(firstA: string, lastA: string, firstB: string, lastB: string): boolean {
  const fA = firstA.toLowerCase();
  const lA = lastA.toLowerCase();
  const fB = firstB.toLowerCase();
  const lB = lastB.toLowerCase();

  // Last names must match exactly
  if (lA !== lB) return false;

  // First name: one is a prefix/abbreviation of the other (e.g., "Alex" vs "Alexander", "J" vs "John")
  if (fA === fB) return false; // exact match handled elsewhere
  if (fA.startsWith(fB) || fB.startsWith(fA)) return true;

  // Levenshtein distance <= 2 for names length 4+
  if (fA.length >= 4 && fB.length >= 4 && levenshtein(fA, fB) <= 2) return true;

  return false;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length][b.length];
}
