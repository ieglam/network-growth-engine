import { sendQueueReadyEmail } from '../services/emailService.js';
import { prisma } from '../lib/prisma.js';

async function main() {
  const today = new Date();
  const queueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const queueItems = await prisma.queueItem.findMany({
    where: { queueDate },
    include: {
      contact: { select: { firstName: true, lastName: true, company: true, linkedinUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (queueItems.length === 0) {
    console.log('No queue items for today. Nothing to send.');
    process.exit(0);
  }

  const emailItems = queueItems.map((item) => ({
    contactName: `${item.contact.firstName} ${item.contact.lastName}`,
    company: item.contact.company,
    actionType: item.actionType,
    linkedinUrl: item.contact.linkedinUrl,
  }));

  console.log(`Sending test email with ${emailItems.length} real queue items...`);
  const sent = await sendQueueReadyEmail(emailItems, queueDate);
  if (sent) {
    console.log('Test email sent successfully! Check your inbox.');
  } else {
    console.log('Failed to send. Check SMTP_EMAIL and SMTP_PASSWORD in .env');
  }
  process.exit(0);
}

main();
