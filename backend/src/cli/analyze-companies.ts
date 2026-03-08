import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { normalizeCompanyName } from '../services/companyLookupService.js';

async function main() {
  const client = new Anthropic({ apiKey: config.anthropicApiKey! });

  // 1. Fetch all company descriptions
  const allDescs = await prisma.companyDescription.findMany({
    orderBy: { companyName: 'asc' },
  });

  const known = allDescs.filter((d) => d.description !== 'unknown');
  const unknown = allDescs.filter((d) => d.description === 'unknown');

  console.log(`\nCompany descriptions: ${allDescs.length} total, ${known.length} known, ${unknown.length} unknown\n`);

  // 2. Ask Haiku to cluster the known companies into industry verticals
  const companyList = known
    .map((d) => `- ${d.companyName}: ${d.description.slice(0, 120)}`)
    .join('\n');

  const clusterResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Here are ${known.length} companies with descriptions. Cluster them into 8-10 industry verticals/sectors. For each cluster, list the exact company names that belong to it.

Return a JSON array where each element has:
- "sector": the vertical name (e.g. "Digital Banking / Neobanks", "Payments & Transfers", "Crypto & Blockchain")
- "companies": array of exact company name strings from the list

Every company must appear in exactly one cluster.

Companies:
${companyList}

Respond ONLY with a valid JSON array, no other text.`,
      },
    ],
  });

  const clusterText = clusterResponse.content.find((b) => b.type === 'text');
  if (!clusterText || clusterText.type !== 'text') throw new Error('No response');

  let jsonStr = clusterText.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  interface Cluster {
    sector: string;
    companies: string[];
  }

  const clusters = JSON.parse(jsonStr) as Cluster[];

  // Build a lookup: companyName -> sector
  const sectorMap = new Map<string, string>();
  for (const c of clusters) {
    for (const name of c.companies) {
      sectorMap.set(name.toLowerCase(), c.sector);
    }
  }

  // Also classify unknown companies as "Unknown/Uncategorized"
  for (const d of unknown) {
    sectorMap.set(d.companyName.toLowerCase(), 'Unknown / No Description');
  }

  console.log('=== Company Description Clusters ===\n');
  for (const c of clusters.sort((a, b) => b.companies.length - a.companies.length)) {
    const examples = c.companies.slice(0, 5).join(', ');
    const more = c.companies.length > 5 ? ` (+${c.companies.length - 5} more)` : '';
    console.log(`  ${c.sector.padEnd(40)} ${String(c.companies.length).padStart(4)} companies   e.g. ${examples}${more}`);
  }
  console.log(`  ${'Unknown / No Description'.padEnd(40)} ${String(unknown.length).padStart(4)} companies`);
  console.log(`  ${''.padEnd(40)} ────`);
  console.log(`  ${'TOTAL'.padEnd(40)} ${String(known.length + unknown.length).padStart(4)}`);

  // 3. Break down C-Suite/Founder contacts by sector
  console.log('\n\n=== C-Suite/Founder Breakdown by Sector ===\n');

  const cSuiteCategory = await prisma.category.findUnique({
    where: { name: 'C-Suite/Founder' },
  });

  if (!cSuiteCategory) {
    console.log('C-Suite/Founder category not found');
    await prisma.$disconnect();
    return;
  }

  const cSuiteContacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      categories: {
        some: { categoryId: cSuiteCategory.id },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      title: true,
      company: true,
    },
  });

  console.log(`  Total C-Suite/Founder contacts: ${cSuiteContacts.length}\n`);

  // Map each contact to a sector based on their company
  const sectorBreakdown = new Map<string, { count: number; examples: string[] }>();

  for (const contact of cSuiteContacts) {
    let sector = 'No Company Listed';

    if (contact.company) {
      const normalized = normalizeCompanyName(contact.company);
      sector = sectorMap.get(normalized) ?? 'Unknown / No Description';
    }

    const entry = sectorBreakdown.get(sector) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < 3) {
      const name = `${contact.firstName} ${contact.lastName}`;
      const co = contact.company ? ` (${contact.company.slice(0, 25)})` : '';
      entry.examples.push(`${name}${co}`);
    }
    sectorBreakdown.set(sector, entry);
  }

  // Now ask Haiku to classify the "Unknown" C-Suite contacts into crypto/fintech/general/non-tech
  // based on their titles and company names
  const unknownCSuite = cSuiteContacts.filter((c) => {
    if (!c.company) return false;
    const normalized = normalizeCompanyName(c.company);
    return sectorMap.get(normalized) === 'Unknown / No Description';
  });

  if (unknownCSuite.length > 0) {
    console.log(`  Classifying ${unknownCSuite.length} C-Suite contacts with unknown companies (in batches)...\n`);

    const SUB_BATCH = 50;
    const allSubResults: { id: string; subSector: string }[] = [];

    for (let i = 0; i < unknownCSuite.length; i += SUB_BATCH) {
      const batch = unknownCSuite.slice(i, i + SUB_BATCH);
      const unknownList = batch
        .map((c) => `- ID:${c.id} | ${c.firstName} ${c.lastName} | Title: ${c.title ?? '—'} | Company: ${c.company}`)
        .join('\n');

      try {
        const subclassResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: `These are C-Suite/Founder contacts whose companies don't have cached descriptions. Based on the company name and title, classify each into one of these sub-sectors:
- "Crypto / Blockchain Founders" — company or title mentions crypto, blockchain, web3, DeFi, digital assets, tokens, stablecoins
- "Fintech Founders" — company or title mentions fintech, payments, banking, lending, insurance tech
- "General Tech Founders" — SaaS, AI, enterprise software, marketplaces, etc.
- "Non-Tech Founders" — no clear tech/fintech/crypto signal

Return a JSON array with:
- "id": the contact ID
- "subSector": one of the four sub-sector names above

Contacts:
${unknownList}

Respond ONLY with a valid JSON array, no other text.`,
            },
          ],
        });

        const subText = subclassResponse.content.find((b) => b.type === 'text');
        if (subText && subText.type === 'text') {
          let subJson = subText.text.trim();
          if (subJson.startsWith('```')) {
            subJson = subJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          const batchResults = JSON.parse(subJson) as { id: string; subSector: string }[];
          allSubResults.push(...batchResults);
          console.log(`    Batch ${Math.floor(i / SUB_BATCH) + 1}: classified ${batchResults.length} contacts`);
        }
      } catch (err) {
        console.error(`    Batch ${Math.floor(i / SUB_BATCH) + 1} failed:`, err);
      }
    }

    if (allSubResults.length > 0) {
      const subResults = allSubResults;

      // Reclassify these contacts from "Unknown" into sub-sectors
      const reclassified = new Map<string, string>();
      for (const r of subResults) {
        reclassified.set(r.id, r.subSector);
      }

      // Rebuild the breakdown: remove from Unknown, add to sub-sectors
      const unknownEntry = sectorBreakdown.get('Unknown / No Description');
      if (unknownEntry) {
        for (const contact of unknownCSuite) {
          const subSector = reclassified.get(contact.id);
          if (!subSector) continue;

          unknownEntry.count--;

          const entry = sectorBreakdown.get(subSector) ?? { count: 0, examples: [] };
          entry.count++;
          if (entry.examples.length < 3) {
            const name = `${contact.firstName} ${contact.lastName}`;
            const co = contact.company ? ` (${contact.company.slice(0, 25)})` : '';
            entry.examples.push(`${name}${co}`);
          }
          sectorBreakdown.set(subSector, entry);
        }

        // Remove Unknown if empty
        if (unknownEntry.count <= 0) {
          sectorBreakdown.delete('Unknown / No Description');
        }
      }
    }
  }

  // Print the breakdown sorted by count
  const sorted = [...sectorBreakdown.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [sector, data] of sorted) {
    const pct = ((data.count / cSuiteContacts.length) * 100).toFixed(1);
    const exStr = data.examples.join('; ');
    console.log(`  ${sector.padEnd(40)} ${String(data.count).padStart(4)} (${pct.padStart(5)}%)   e.g. ${exStr}`);
  }

  console.log(`  ${''.padEnd(40)} ────`);
  console.log(`  ${'TOTAL'.padEnd(40)} ${String(cSuiteContacts.length).padStart(4)}`);

  console.log('');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
