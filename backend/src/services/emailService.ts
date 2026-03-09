import nodemailer from 'nodemailer';
import { config } from '../lib/config.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtpEmail || !config.smtpPassword) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: config.smtpEmail,
        pass: config.smtpPassword,
      },
    });
  }

  return transporter;
}

export interface QueueEmailItem {
  contactName: string;
  company: string | null;
  actionType: string;
  linkedinUrl: string | null;
}

export interface SearchRunEmailItem {
  searchName: string;
  found: number;
  imported: number;
  duplicatesSkipped: number;
  errors: number;
}

export async function sendSearchResultsEmail(
  results: SearchRunEmailItem[]
): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    console.log('[email] SMTP not configured, skipping search notification');
    return false;
  }

  const totalFound = results.reduce((s, r) => s + r.found, 0);
  const totalImported = results.reduce((s, r) => s + r.imported, 0);
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const itemRows = results
    .map((r) => {
      return `• ${r.searchName}: ${r.found} found, ${r.imported} new, ${r.duplicatesSkipped} dupes${r.errors > 0 ? `, ${r.errors} errors` : ''}`;
    })
    .join('\n');

  const text = `Igor, weekly search results:\n\n${itemRows}\n\nTotal: ${totalFound} found, ${totalImported} new targets imported\n\nReview targets: http://localhost:3000/find-targets`;

  const htmlItems = results
    .map((r) => {
      const errorStr = r.errors > 0 ? ` <span style="color:red">(${r.errors} errors)</span>` : '';
      return `<li><strong>${r.searchName}</strong>: ${r.found} found, <strong>${r.imported} new</strong>, ${r.duplicatesSkipped} dupes${errorStr}</li>`;
    })
    .join('\n');

  const html = `
    <p>Igor, here are your weekly search results:</p>
    <ul style="line-height:1.8">${htmlItems}</ul>
    <p><strong>Total: ${totalFound} found, ${totalImported} new targets imported</strong></p>
    <p><a href="http://localhost:3000/find-targets">Review targets &rarr;</a></p>
  `;

  try {
    await transport.sendMail({
      from: config.smtpEmail,
      to: 'ieglamazdin@gmail.com',
      subject: `NGE Weekly Search — ${totalImported} new targets found — ${dateStr}`,
      text,
      html,
    });
    console.log('[email] Weekly search notification sent');
    return true;
  } catch (err) {
    console.error('[email] Failed to send search notification:', err);
    return false;
  }
}

export async function sendQueueReadyEmail(
  items: QueueEmailItem[],
  date: Date
): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    console.log('[email] SMTP not configured, skipping notification');
    return false;
  }

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const actionLabels: Record<string, string> = {
    connection_request: 'Connection Request',
    follow_up: 'Follow-Up',
    re_engagement: 'Re-Engagement',
  };

  const itemRows = items
    .map((item) => {
      const action = actionLabels[item.actionType] || item.actionType;
      const company = item.company ? ` — ${item.company}` : '';
      const name = item.linkedinUrl ? `${item.contactName} (${item.linkedinUrl})` : item.contactName;
      return `• ${name}${company} (${action})`;
    })
    .join('\n');

  const text = `Igor, here's today's queue for your review:\n\n${itemRows}\n\nTotal: ${items.length} items\n\nReview your queue: http://localhost:3000/queue`;

  const htmlItems = items
    .map((item) => {
      const action = actionLabels[item.actionType] || item.actionType;
      const company = item.company ? ` &mdash; ${item.company}` : '';
      const name = item.linkedinUrl
        ? `<a href="${item.linkedinUrl}">${item.contactName}</a>`
        : item.contactName;
      return `<li>${name}${company} <span style="color:#888">(${action})</span></li>`;
    })
    .join('\n');

  const html = `
    <p>Igor, here's today's queue for your review:</p>
    <ul style="line-height:1.8">${htmlItems}</ul>
    <p><strong>Total: ${items.length} items</strong></p>
    <p><a href="http://localhost:3000/queue">Review your queue &rarr;</a></p>
  `;

  try {
    await transport.sendMail({
      from: config.smtpEmail,
      to: 'ieglamazdin@gmail.com',
      subject: `NGE Daily Queue Ready — ${dateStr}`,
      text,
      html,
    });
    console.log('[email] Queue notification sent');
    return true;
  } catch (err) {
    console.error('[email] Failed to send notification:', err);
    return false;
  }
}
