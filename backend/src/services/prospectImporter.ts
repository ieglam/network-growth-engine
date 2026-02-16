import { prisma } from '../lib/prisma.js';
import type { ScrapedProspect } from './linkedinSearchScraper.js';

export interface ImportResult {
  imported: number;
  duplicatesSkipped: number;
  errors: number;
  details: {
    importedContacts: { id: string; name: string; linkedinUrl: string }[];
    skippedDuplicates: { name: string; linkedinUrl: string; existingId: string }[];
    errorMessages: string[];
  };
}

/**
 * Import scraped prospects into the contacts database.
 * - Deduplicates by LinkedIn URL first, then by name+company
 * - Imports as status "target" with "LinkedIn Search Pull" category
 * - Marks field_sources as "linkedin_scrape"
 */
export async function importProspects(prospects: ScrapedProspect[]): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    duplicatesSkipped: 0,
    errors: 0,
    details: {
      importedContacts: [],
      skippedDuplicates: [],
      errorMessages: [],
    },
  };

  for (const prospect of prospects) {
    try {
      // 1. Check for duplicate by LinkedIn URL
      if (prospect.linkedinUrl) {
        const existingByUrl = await prisma.contact.findFirst({
          where: {
            linkedinUrl: prospect.linkedinUrl,
            deletedAt: null,
          },
          select: { id: true, firstName: true, lastName: true },
        });

        if (existingByUrl) {
          result.duplicatesSkipped++;
          result.details.skippedDuplicates.push({
            name: prospect.fullName,
            linkedinUrl: prospect.linkedinUrl,
            existingId: existingByUrl.id,
          });
          continue;
        }
      }

      // 2. Check for duplicate by name + company
      if (prospect.firstName && prospect.lastName && prospect.company) {
        const existingByName = await prisma.contact.findFirst({
          where: {
            firstName: { equals: prospect.firstName, mode: 'insensitive' },
            lastName: { equals: prospect.lastName, mode: 'insensitive' },
            company: { equals: prospect.company, mode: 'insensitive' },
            deletedAt: null,
          },
          select: { id: true },
        });

        if (existingByName) {
          result.duplicatesSkipped++;
          result.details.skippedDuplicates.push({
            name: prospect.fullName,
            linkedinUrl: prospect.linkedinUrl,
            existingId: existingByName.id,
          });
          continue;
        }
      }

      // 3. Import as new contact
      const fieldSources: Record<string, string> = {
        firstName: 'linkedin_scrape',
        lastName: 'linkedin_scrape',
      };
      if (prospect.title) fieldSources.title = 'linkedin_scrape';
      if (prospect.company) fieldSources.company = 'linkedin_scrape';
      if (prospect.linkedinUrl) fieldSources.linkedinUrl = 'linkedin_scrape';
      if (prospect.headline) fieldSources.headline = 'linkedin_scrape';
      if (prospect.location) fieldSources.location = 'linkedin_scrape';

      const created = await prisma.contact.create({
        data: {
          firstName: prospect.firstName,
          lastName: prospect.lastName,
          title: prospect.title,
          company: prospect.company,
          linkedinUrl: prospect.linkedinUrl,
          headline: prospect.headline,
          location: prospect.location,
          mutualConnectionsCount: prospect.mutualConnectionsCount,
          status: 'target',
          fieldSources,
        },
      });

      // Assign "LinkedIn Search Pull" category (create if it doesn't exist)
      const linkedinSearchCategory = await prisma.category.upsert({
        where: { name: 'LinkedIn Search Pull' },
        update: {},
        create: { name: 'LinkedIn Search Pull', relevanceWeight: 7 },
      });
      await prisma.contactCategory.create({
        data: {
          contactId: created.id,
          categoryId: linkedinSearchCategory.id,
        },
      });

      // Log status history
      await prisma.statusHistory.create({
        data: {
          contactId: created.id,
          fromStatus: null,
          toStatus: 'target',
          trigger: 'import_trigger',
          triggerReason: 'Imported from LinkedIn search scrape',
        },
      });

      result.imported++;
      result.details.importedContacts.push({
        id: created.id,
        name: prospect.fullName,
        linkedinUrl: prospect.linkedinUrl,
      });
    } catch (error) {
      result.errors++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.details.errorMessages.push(`Failed to import ${prospect.fullName}: ${message}`);
    }
  }

  return result;
}
