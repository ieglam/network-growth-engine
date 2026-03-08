import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { aiCategorizeContacts } from '../services/aiCategorizationService.js';

/**
 * Full batch categorization — saves results to DB.
 * Skips contacts in protected categories (Legacy, Irrelevant).
 * Uses force=true to re-evaluate all contacts.
 */
async function main() {
  const totalContacts = await prisma.contact.count({ where: { deletedAt: null } });
  console.log(`\nTotal active contacts: ${totalContacts}`);

  // Show protected categories that will be skipped
  const protectedCats = await prisma.category.findMany({
    where: { isProtected: true },
    include: { _count: { select: { contacts: true } } },
  });
  console.log(`\nProtected categories (will be skipped):`);
  for (const c of protectedCats) {
    console.log(`  ${c.name} (${c._count.contacts} contacts)`);
  }

  console.log('\n--- Running full AI categorization (force=true, dryRun=false) ---\n');

  const result = await aiCategorizeContacts({
    force: true,
    dryRun: false,
  });

  // Count category changes by comparing results to previous assignments
  const contactIds = result.results.map((r) => r.contactId);
  const previousAssignments = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: {
      id: true,
      categories: { include: { category: true } },
    },
  });

  // Build a lookup of current categories (post-save)
  const prevMap = new Map<string, string[]>();
  for (const c of previousAssignments) {
    prevMap.set(c.id, c.categories.map((cc) => cc.category.name));
  }

  // Count stats
  let irrelevantCount = 0;
  const categoryCounts = new Map<string, number>();

  for (const r of result.results) {
    categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
    if (r.category === 'Irrelevant') {
      irrelevantCount++;
    }
  }

  // Print summary
  console.log('\n========================================');
  console.log('        CATEGORIZATION COMPLETE');
  console.log('========================================\n');
  console.log(`  Total processed:       ${result.total}`);
  console.log(`  Skipped (protected):   ${result.skipped}`);
  console.log(`  Categorized:           ${result.categorized}`);
  console.log(`  Moved to Irrelevant:   ${irrelevantCount}`);
  console.log(`  Flagged for review:    ${result.flaggedForReview}`);
  console.log(`  Errors:                ${result.errors}`);

  console.log('\n  Category breakdown:');
  const sorted = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sorted) {
    console.log(`    ${cat.padEnd(22)} ${count}`);
  }

  // Show final category counts from DB
  const finalCounts = await prisma.category.findMany({
    include: { _count: { select: { contacts: true } } },
    orderBy: { relevanceWeight: 'desc' },
  });

  console.log('\n  Final DB category totals:');
  for (const c of finalCounts) {
    const prot = c.isProtected ? ' [protected]' : '';
    console.log(`    ${c.name.padEnd(22)} ${String(c._count.contacts).padStart(5)} contacts${prot}`);
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Categorization failed:', err);
  process.exit(1);
});
