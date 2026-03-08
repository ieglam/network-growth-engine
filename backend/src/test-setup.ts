/**
 * Global test setup — runs before every test file.
 * Guards against accidentally running tests on the production database.
 */
import { beforeAll } from 'vitest';

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const match = dbUrl.match(/\/([^/?]+)(\?|$)/);
  const dbName = match?.[1] ?? '';

  if (!dbName.includes('test')) {
    throw new Error(
      `REFUSING TO RUN TESTS: DATABASE_URL points to "${dbName}" which does not ` +
        `contain "test". Tests must run against a test database (e.g. ` +
        `network_growth_engine_test). Check backend/.env.test.`
    );
  }
});
