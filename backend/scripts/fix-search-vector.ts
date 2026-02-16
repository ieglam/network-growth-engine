import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check if column exists
  const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'search_vector'`
  );

  if (cols.length > 0) {
    console.log('search_vector column already exists');
  } else {
    console.log('Creating search_vector column...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE contacts
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(first_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(last_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(title, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(notes, '')), 'C')
      ) STORED
    `);
    console.log('Column created.');

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_contacts_search_vector ON contacts USING GIN (search_vector)`
    );
    console.log('GIN index created.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
