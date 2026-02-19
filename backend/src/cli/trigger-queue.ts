import 'dotenv/config';
import { generateDailyQueue } from '../services/queueGenerationService.js';
import { sendQueueReadyEmail } from '../services/emailService.js';
import { prisma } from '../lib/prisma.js';

async function main() {
  console.log('Triggering daily queue generation for today...');
  const start = Date.now();
  const result = await generateDailyQueue();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Done in ${elapsed}s`);
  console.log(`  Connection requests: ${result.connectionRequests}`);
  console.log(`  Re-engagements:     ${result.reEngagements}`);
  console.log(`  Flagged for editing: ${result.flaggedForEditing}`);
  console.log(`  Total:              ${result.total}`);

  if (result.total > 0) {
    const today = new Date();
    const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const queueItems = await prisma.queueItem.findMany({
      where: { queueDate, status: 'pending' },
      include: {
        contact: { select: { firstName: true, lastName: true, company: true, linkedinUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const emailItems = queueItems.map((item) => ({
      contactName: `${item.contact.firstName} ${item.contact.lastName}`,
      company: item.contact.company,
      actionType: item.actionType,
      linkedinUrl: item.contact.linkedinUrl,
    }));

    await sendQueueReadyEmail(emailItems, queueDate);
  } else {
    console.log('No items generated, skipping email.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Queue generation failed:', err);
  process.exit(1);
});
