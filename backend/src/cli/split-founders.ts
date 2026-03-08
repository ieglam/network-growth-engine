import 'dotenv/config';
import { prisma } from '../lib/prisma.js';
import { aiCategorizeContacts } from '../services/aiCategorizationService.js';

/**
 * Split C-Suite/Founder into three sub-categories + create templates.
 * First run: dry-run to show distribution.
 */
async function main() {
  const dryRun = !process.argv.includes('--save');

  // 1. Create templates for the three new founder categories
  console.log('\n--- Ensuring categories + templates exist ---\n');

  const founderCategories = [
    {
      name: 'Crypto/Blockchain Founder',
      relevanceWeight: 9,
      templateName: 'Crypto Founder - Regulatory Expertise',
      templateBody:
        "Hi {{first_name}}, I lead regulatory research at PolicyPartner, focused on digital asset policy and crypto compliance frameworks. Given {{company}}'s work in the space, I'd love to connect and share insights on emerging regulations.",
    },
    {
      name: 'Fintech Founder',
      relevanceWeight: 7,
      templateName: 'Fintech Founder - Shared Space',
      templateBody:
        "Hi {{first_name}}, I work in fintech policy at PolicyPartner — we research regulatory trends affecting companies like {{company}}. Always great to connect with fellow fintech builders. Would love to stay in touch!",
    },
    {
      name: 'General Founder',
      relevanceWeight: 3,
      templateName: 'General Founder - Professional Network',
      templateBody:
        "Hi {{first_name}}, I came across your profile and was impressed by your work at {{company}}. I'm in the fintech and policy space — always enjoy connecting with fellow founders. Would love to stay in touch!",
    },
  ];

  for (const fc of founderCategories) {
    const cat = await prisma.category.upsert({
      where: { name: fc.name },
      update: { relevanceWeight: fc.relevanceWeight },
      create: { name: fc.name, relevanceWeight: fc.relevanceWeight },
    });
    console.log(`  Category: ${fc.name} (weight ${fc.relevanceWeight}, id: ${cat.id})`);

    // Create template if it doesn't exist
    const existing = await prisma.template.findFirst({
      where: { name: fc.templateName },
    });
    if (!existing) {
      await prisma.template.create({
        data: {
          name: fc.templateName,
          categoryId: cat.id,
          body: fc.templateBody,
          isActive: true,
        },
      });
      console.log(`  Template created: ${fc.templateName} (${fc.templateBody.length} chars)`);
    } else {
      console.log(`  Template exists: ${fc.templateName}`);
    }
  }

  // 2. Get all contacts currently in C-Suite/Founder
  const cSuiteCat = await prisma.category.findUnique({
    where: { name: 'C-Suite/Founder' },
  });

  if (!cSuiteCat) {
    console.log('\nC-Suite/Founder category not found. Exiting.');
    await prisma.$disconnect();
    return;
  }

  const cSuiteContacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      categories: { some: { categoryId: cSuiteCat.id } },
    },
    select: { id: true },
  });

  const contactIds = cSuiteContacts.map((c) => c.id);
  console.log(`\nFound ${contactIds.length} contacts in C-Suite/Founder\n`);

  // 3. Run categorization
  console.log(`--- Running AI categorization (dryRun=${dryRun}, force=true) ---\n`);

  const result = await aiCategorizeContacts({
    contactIds,
    force: true,
    dryRun,
  });

  // 4. Show distribution
  const distribution = new Map<string, { count: number; examples: string[] }>();
  for (const r of result.results) {
    const entry = distribution.get(r.category) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 4) {
      entry.examples.push(r.name);
    }
    distribution.set(r.category, entry);
  }

  console.log('\n========================================');
  console.log('   FOUNDER SPLIT DISTRIBUTION');
  console.log('========================================\n');

  const sorted = [...distribution.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [cat, data] of sorted) {
    const pct = ((data.count / result.categorized) * 100).toFixed(1);
    const exStr = data.examples.join(', ');
    const more = data.count > 4 ? ` (+${data.count - 4} more)` : '';
    console.log(`  ${cat.padEnd(30)} ${String(data.count).padStart(4)} (${pct.padStart(5)}%)   e.g. ${exStr}${more}`);
  }

  console.log(`\n  Total categorized:  ${result.categorized}`);
  console.log(`  Skipped (protected): ${result.skipped}`);
  console.log(`  Flagged for review:  ${result.flaggedForReview}`);
  console.log(`  Errors:              ${result.errors}`);
  console.log(`\n  Mode: ${dryRun ? 'DRY RUN (nothing saved)' : 'LIVE — results saved to DB'}`);

  if (dryRun) {
    console.log('\n  To save results, re-run with: npx tsx src/cli/split-founders.ts --save');
  }

  console.log('');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
