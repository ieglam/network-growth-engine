import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { aiCategorizeContacts } from '../services/aiCategorizationService.js';
import { normalizeCompanyName } from '../services/companyLookupService.js';

/**
 * Test categorization on 20 contacts: 5 per category bucket.
 * Runs in dry-run mode — does NOT persist any changes.
 */

interface RawContact {
  id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  company: string | null;
  cat: string | null;
  is_protected: boolean;
}

async function pickFromCategory(categoryName: string, limit: number): Promise<RawContact[]> {
  return prisma.$queryRaw<RawContact[]>`
    SELECT DISTINCT ON (c.id)
      c.id,
      c.first_name,
      c.last_name,
      c.title,
      c.company,
      cat.name as cat,
      cat.is_protected
    FROM contacts c
    JOIN contact_categories cc ON cc.contact_id = c.id
    JOIN categories cat ON cat.id = cc.category_id
    WHERE c.deleted_at IS NULL
      AND c.company IS NOT NULL
      AND c.title IS NOT NULL
      AND cat.name = ${categoryName}
      AND cat.is_protected = false
    ORDER BY c.id
    LIMIT ${limit}
  `;
}

async function main() {
  const buckets = [
    { name: 'Needs Review', target: 5 },
    { name: 'C-Suite/Founder', target: 5 },
    { name: 'Crypto Compliance', target: 5 },
    { name: 'General Industry', target: 5 },
  ];

  const allContacts: RawContact[] = [];

  for (const bucket of buckets) {
    const rows = await pickFromCategory(bucket.name, bucket.target);
    console.log(`[${bucket.name}] found ${rows.length} eligible contacts`);
    allContacts.push(...rows);
  }

  if (allContacts.length === 0) {
    console.log('No contacts found. Exiting.');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== Test Batch: ${allContacts.length} contacts ===\n`);
  console.log('Current assignments:');
  for (const c of allContacts) {
    console.log(`  ${c.first_name} ${c.last_name} | ${c.title ?? '—'} | ${c.company ?? '—'} | current: ${c.cat ?? 'none'}`);
  }

  const contactIds = allContacts.map((c) => c.id);

  console.log('\n--- Running AI categorization (dry-run, force=true) ---\n');

  const result = await aiCategorizeContacts({
    contactIds,
    force: true,
    dryRun: true,
  });

  // Pre-load company descriptions for display
  const companyNames = [...new Set(allContacts.map((c) => c.company).filter(Boolean))] as string[];
  const descs = await prisma.companyDescription.findMany({
    where: { companyName: { in: companyNames.map(normalizeCompanyName) } },
  });
  const descMap = new Map(descs.map((d) => [d.companyName, d.description]));

  console.log('\n=== Results ===\n');
  console.log(
    '  ' +
      'Name'.padEnd(28) +
      'Title'.padEnd(30) +
      'Company'.padEnd(24) +
      'Co. Description'.padEnd(40) +
      'OLD'.padEnd(18) +
      'NEW'.padEnd(18) +
      'Conf'
  );
  console.log('  ' + '—'.repeat(160));

  for (const r of result.results) {
    const orig = allContacts.find((c) => c.id === r.contactId);
    if (!orig) continue;

    const currentCat = orig.cat ?? 'none';
    const coDesc = orig.company
      ? descMap.get(normalizeCompanyName(orig.company)) ?? '—'
      : '—';
    const coDescPreview =
      coDesc === 'unknown' ? 'unknown' : coDesc.length > 38 ? coDesc.slice(0, 35) + '...' : coDesc;
    const changed = currentCat !== r.category ? ' *' : '';

    console.log(
      `  ${(orig.first_name + ' ' + orig.last_name).padEnd(28)}${(orig.title ?? '—').slice(0, 28).padEnd(30)}${(orig.company ?? '—').slice(0, 22).padEnd(24)}${coDescPreview.padEnd(40)}${currentCat.padEnd(18)}${r.category.padEnd(18)}${r.confidence}${changed}`
    );
  }

  // Show contacts that the AI didn't return (errors)
  const returnedIds = new Set(result.results.map((r) => r.contactId));
  const missing = allContacts.filter((c) => !returnedIds.has(c.id));
  if (missing.length > 0) {
    console.log(`\n  Missing from AI response (${missing.length}):`);
    for (const c of missing) {
      console.log(`    ${c.first_name} ${c.last_name}`);
    }
  }

  console.log(
    `\nSummary: ${result.categorized} categorized, ${result.flaggedForReview} flagged for review, ${result.skipped} skipped (protected), ${result.errors} errors`
  );
  console.log('\n  * = category changed from current assignment');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
