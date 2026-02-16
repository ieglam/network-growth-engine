import { generateDailyQueue } from '../services/queueGenerationService.js';

async function main() {
  console.log('Triggering daily queue generation for today...');
  const start = Date.now();
  const result = await generateDailyQueue();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Done in ${elapsed}s`);
  console.log(`  Connection requests: ${result.connectionRequests}`);
  console.log(`  Follow-ups:         ${result.followUps}`);
  console.log(`  Re-engagements:     ${result.reEngagements}`);
  console.log(`  Carried over:       ${result.carriedOver}`);
  console.log(`  Flagged for editing: ${result.flaggedForEditing}`);
  console.log(`  Total:              ${result.total}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Queue generation failed:', err);
  process.exit(1);
});
