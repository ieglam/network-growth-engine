import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config.js';
import { launchBrowser, isLoggedIn, newPage, closeBrowser } from '../services/linkedinBrowserService.js';
import { canSendRequest, recordRequest, getNextRequestDelay, enterCooldown } from '../services/linkedinRateLimiter.js';
import type { Page } from 'playwright';

const SAFETY_LIMIT = 5; // Max requests per run
const CONNECTION_NOTE_MAX = 300;
const DRY_RUN = false; // When true, stops BEFORE clicking Send so you can verify visually

const API_BASE = `http://localhost:${config.port}/api`;
const SCREENSHOTS_DIR = path.resolve(process.cwd(), 'screenshots');

interface SendResult {
  queueItemId: string;
  contactName: string;
  linkedinUrl: string;
  status: 'success' | 'failed' | 'skipped' | 'dry_run';
  reason?: string;
}

/** Typed shape of a queue item from GET /api/queue/today */
interface QueueItemFromAPI {
  id: string;
  contactId: string;
  actionType: string;
  status: string;
  personalizedMessage: string | null;
  templateId: string | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    title: string | null;
    company: string | null;
    linkedinUrl: string | null;
    status: string;
    relationshipScore: number;
  };
}

/**
 * Extract the LinkedIn username slug from a URL.
 * e.g. "https://www.linkedin.com/in/johndoe" → "johndoe"
 */
function extractLinkedInUsername(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Save a screenshot with a descriptive name.
 */
async function screenshot(page: Page, label: string, contactSlug: string): Promise<string> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${contactSlug}_${label}_${timestamp}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`  📸 Screenshot: ${filename}`);
  return filepath;
}

async function sendConnectionRequest(
  linkedinUrl: string,
  personalizedMessage: string,
  expectedFirstName: string,
  expectedLastName: string
): Promise<{ success: boolean; reason?: string }> {
  const expectedUsername = extractLinkedInUsername(linkedinUrl);
  if (!expectedUsername) {
    return { success: false, reason: `Cannot parse LinkedIn username from URL: ${linkedinUrl}` };
  }

  const contactSlug = expectedUsername;
  const page = await newPage();

  try {
    // ── STEP 1: Navigate to the EXACT profile URL ──
    console.log(`  [nav] Going to ${linkedinUrl}`);
    await page.goto(linkedinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000 + Math.random() * 2000);

    await screenshot(page, '01-after-navigation', contactSlug);

    // ── STEP 2: Verify we landed on the correct profile ──
    const finalUrl = page.url();
    console.log(`  [verify] Final URL: ${finalUrl}`);

    // Check for auth wall redirect
    if (finalUrl.includes('/login') || finalUrl.includes('/authwall') || finalUrl.includes('/checkpoint')) {
      await screenshot(page, '02-auth-wall', contactSlug);
      return { success: false, reason: `Redirected to auth wall: ${finalUrl}` };
    }

    // Verify the URL still contains the expected LinkedIn username
    const landedUsername = extractLinkedInUsername(finalUrl);
    if (landedUsername !== expectedUsername) {
      await screenshot(page, '02-wrong-profile-url', contactSlug);
      return {
        success: false,
        reason: `URL mismatch! Expected username "${expectedUsername}" but landed on "${landedUsername}" (URL: ${finalUrl})`,
      };
    }
    console.log(`  [verify] URL contains expected username: ${expectedUsername} ✓`);

    // Verify the person's name appears on the page.
    const nameSelectors = [
      'h1',
      'h1.text-heading-xlarge',
      'h1[class*="top-card"]',
      '.pv-top-card .text-heading-xlarge',
      'main h1',
      'main section:first-of-type h1',
    ];

    let pageNameText: string | null = null;
    for (const selector of nameSelectors) {
      pageNameText = await page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
      if (pageNameText && pageNameText.trim().length > 0) {
        console.log(`  [verify] Found name via selector: ${selector}`);
        break;
      }
    }

    // Last resort: search the page title (LinkedIn sets it to "Name | LinkedIn")
    if (!pageNameText) {
      const pageTitle = await page.title();
      const titleMatch = pageTitle.match(/^(.+?)\s*[|–—]/);
      if (titleMatch) {
        pageNameText = titleMatch[1];
        console.log(`  [verify] Found name via page title: "${pageNameText}"`);
      }
    }

    if (!pageNameText || pageNameText.trim().length === 0) {
      await screenshot(page, '02-no-name-found', contactSlug);
      return { success: false, reason: 'Could not find person name anywhere on profile page' };
    }

    const pageName = pageNameText.trim().toLowerCase();
    const expectedFirst = expectedFirstName.trim().toLowerCase();
    const expectedLast = expectedLastName.trim().toLowerCase();

    const firstNameMatch = pageName.includes(expectedFirst);
    const lastNameMatch = pageName.includes(expectedLast);

    if (!firstNameMatch && !lastNameMatch) {
      await screenshot(page, '02-name-mismatch', contactSlug);
      return {
        success: false,
        reason: `Name mismatch! Expected "${expectedFirstName} ${expectedLastName}" but page shows "${pageNameText.trim()}"`,
      };
    }

    console.log(`  [verify] Name on page: "${pageNameText.trim()}" — matches "${expectedFirstName} ${expectedLastName}" ✓`);
    await screenshot(page, '02-profile-verified', contactSlug);

    // ── STEP 3: Find the Connect button on the PROFILE (not sidebar) ──
    // Scroll to top to ensure the profile card (not sticky bar) is visible
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    // Debug: enumerate all buttons on the page that contain "Connect" text
    const allConnectInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const connectButtons: Array<{
        text: string;
        ariaLabel: string;
        inAside: boolean;
        inMain: boolean;
        inMainSection: boolean;
        className: string;
        rect: { top: number; left: number; width: number; height: number };
      }> = [];

      for (const b of buttons) {
        const text = b.textContent?.trim() || '';
        if (text.toLowerCase().includes('connect') || (b.getAttribute('aria-label') || '').toLowerCase().includes('connect')) {
          let inAside = false;
          let inMain = false;
          let inMainSection = false;
          let parent: HTMLElement | null = b;
          while (parent) {
            if (parent.tagName === 'ASIDE') inAside = true;
            if (parent.tagName === 'MAIN') inMain = true;
            if (parent.tagName === 'SECTION' && parent.parentElement?.closest('main')) {
              const mainEl = parent.parentElement?.closest('main') || document.querySelector('main');
              if (mainEl && mainEl.querySelector('section') === parent) {
                inMainSection = true;
              }
            }
            parent = parent.parentElement;
          }
          const rect = b.getBoundingClientRect();
          connectButtons.push({
            text: text.substring(0, 60),
            ariaLabel: b.getAttribute('aria-label') || '',
            inAside,
            inMain,
            inMainSection,
            className: b.className.substring(0, 80),
            rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
          });
        }
      }
      return connectButtons;
    });

    console.log(`  [connect] Found ${allConnectInfo.length} "Connect" button(s) on page:`);
    for (const b of allConnectInfo) {
      console.log(`    • "${b.text}" aria="${b.ariaLabel}" inMain=${b.inMain} inMainSection=${b.inMainSection} inAside=${b.inAside} pos=(${b.rect.top},${b.rect.left}) size=${b.rect.width}x${b.rect.height}`);
    }

    // Find Connect buttons whose aria-label matches the expected contact name.
    const firstLower = expectedFirstName.trim().toLowerCase();
    const lastLower = expectedLastName.trim().toLowerCase();

    const validConnects = allConnectInfo.filter(b => {
      if (b.rect.width === 0 || b.rect.height === 0) return false;
      const aria = b.ariaLabel.toLowerCase();
      return aria.includes(firstLower) || aria.includes(lastLower);
    });

    console.log(`  [connect] Valid Connect buttons matching "${expectedFirstName} ${expectedLastName}": ${validConnects.length}`);

    let foundConnect = false;
    let clickedFromDropdown = false;

    if (validConnects.length > 0) {
      console.log(`  [connect] Using matched Connect button: aria="${validConnects[0].ariaLabel}"`);
      await screenshot(page, '03-before-connect-click', contactSlug);

      foundConnect = await page.evaluate(({ first, last }) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const b of buttons) {
          const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
          if ((ariaLabel.includes(first) || ariaLabel.includes(last)) && ariaLabel.includes('connect')) {
            (b as HTMLButtonElement).click();
            return true;
          }
        }
        return false;
      }, { first: firstLower, last: lastLower });

      if (foundConnect) {
        console.log('  [connect] Clicked Connect button via evaluate ✓');
      }
    }

    if (!foundConnect) {
      // Strategy B: Click the "..." dropdown in the profile header.
      console.log('  [connect] No direct Connect in main, trying "..." dropdown...');

      const dropdownTrigger = page.locator('main section').first().locator(
        'button[aria-label="More actions"], button[aria-label="More"], button.artdeco-dropdown__trigger'
      ).first();
      const triggerVisible = await dropdownTrigger.isVisible({ timeout: 2000 }).catch(() => false);

      if (triggerVisible) {
        await screenshot(page, '03-before-more-click', contactSlug);
        await dropdownTrigger.click();
        await page.waitForTimeout(1500);
        await screenshot(page, '03-after-more-click', contactSlug);

        let clickedDropdownConnect = false;

        const dropdownConnectItems = page.getByText('Connect', { exact: true });
        const itemCount = await dropdownConnectItems.count();
        for (let ci = 0; ci < itemCount; ci++) {
          const item = dropdownConnectItems.nth(ci);
          const visible = await item.isVisible().catch(() => false);
          if (!visible) continue;
          const isInSidebarButton = await item.evaluate(el => {
            const btn = el.closest('button');
            return btn?.getAttribute('aria-label')?.includes('Invite') ?? false;
          });
          if (isInSidebarButton) continue;
          // Use force:true because dropdown items have SVG icons that intercept pointer events
          await item.click({ force: true });
          clickedDropdownConnect = true;
          break;
        }

        if (clickedDropdownConnect) {
          foundConnect = true;
          clickedFromDropdown = true;
          console.log('  [connect] Clicked "Connect" from "..." dropdown ✓');
        } else {
          const dropdownContent = await page.evaluate(() => {
            const items: string[] = [];
            const allEls = document.querySelectorAll('div, ul, li');
            for (const el of allEls) {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              if ((style.position === 'absolute' || style.position === 'fixed') &&
                  rect.width > 50 && rect.height > 50 && rect.top > 0 && rect.top < 500) {
                const texts = Array.from(el.querySelectorAll('span, li, a')).map(e => e.textContent?.trim()).filter(Boolean);
                if (texts.length > 0) items.push(...texts as string[]);
              }
            }
            return items.length > 0 ? items : ['(no dropdown items found)'];
          });
          console.log(`  [connect] Dropdown items: ${dropdownContent.join(', ')}`);
          await screenshot(page, '03-dropdown-no-connect', contactSlug);
          await page.keyboard.press('Escape');
        }
      } else {
        console.log('  [connect] No "..." dropdown trigger found');
      }
    }

    if (!foundConnect) {
      const pageButtons = await page.evaluate(() => {
        const mainEl = document.querySelector('main');
        if (!mainEl) return [] as string[];
        const section = mainEl.querySelector('section');
        if (!section) return [] as string[];
        return Array.from(section.querySelectorAll('button')).map(b => b.textContent?.trim() || '');
      });
      console.log(`  [connect] Profile section buttons: ${pageButtons.map(t => `"${t}"`).join(', ')}`);

      const hasPending = pageButtons.some(t => t.includes('Pending'));
      if (hasPending) {
        await screenshot(page, '03-already-pending', contactSlug);
        return { success: false, reason: 'SKIP:Connection request already pending' };
      }

      const hasMessage = pageButtons.some(t => t.includes('Message'));
      const hasFollow = pageButtons.some(t => t.includes('Follow'));

      if (hasMessage && !hasFollow) {
        await screenshot(page, '03-already-connected', contactSlug);
        return { success: false, reason: 'SKIP:Already connected' };
      }

      await screenshot(page, '03-connect-not-found', contactSlug);
      return { success: false, reason: 'SKIP:Connect button not available on this profile' };
    }

    // The Connect button was already clicked above
    await page.waitForTimeout(2500);
    await screenshot(page, '04-after-connect-click', contactSlug);

    // ── STEP 4: Click "Add a note" ──
    const addNoteButton = page.locator('button:has-text("Add a note")').first();
    const addNoteVisible = await addNoteButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (addNoteVisible) {
      await screenshot(page, '04-before-add-note', contactSlug);
      await addNoteButton.click();
      await page.waitForTimeout(1000);
      await screenshot(page, '04-after-add-note', contactSlug);
    }

    // ── STEP 5: Paste the personalized message ──
    const noteTextarea = page.locator('textarea[name="message"], textarea#custom-message, textarea').first();
    const textareaVisible = await noteTextarea.isVisible({ timeout: 3000 }).catch(() => false);

    if (textareaVisible) {
      await noteTextarea.fill(personalizedMessage);
      await page.waitForTimeout(500);
      await screenshot(page, '05-message-filled', contactSlug);
      console.log(`  [note] Message pasted (${personalizedMessage.length} chars)`);
    } else {
      await screenshot(page, '05-no-textarea', contactSlug);
      return { success: false, reason: 'Note textarea not found' };
    }

    // ── STEP 6: Click Send ──
    if (DRY_RUN) {
      await screenshot(page, '06-DRY-RUN-would-click-send', contactSlug);
      console.log('  🛑 DRY RUN — stopping before Send. Check screenshots to verify correct profile.');
      return { success: false, reason: 'DRY_RUN: Stopped before Send (verify screenshots)' };
    }

    const sendButton = page.locator('button[aria-label="Send invitation"], button[aria-label="Send now"]').first();
    let sendVisible = await sendButton.isVisible({ timeout: 2000 }).catch(() => false);

    if (!sendVisible) {
      const fallbackSend = page.locator(
        'button:has-text("Send"):not(:has-text("Send without"))'
      ).first();
      sendVisible = await fallbackSend.isVisible({ timeout: 2000 }).catch(() => false);
      if (sendVisible) {
        await screenshot(page, '06-before-send', contactSlug);
        await fallbackSend.click();
      }
    } else {
      await screenshot(page, '06-before-send', contactSlug);
      await sendButton.click();
    }

    if (!sendVisible) {
      await screenshot(page, '06-send-not-found', contactSlug);
      return { success: false, reason: 'Send button not found' };
    }

    await page.waitForTimeout(2000);
    await screenshot(page, '07-after-send', contactSlug);

    // Check for alerts — LinkedIn uses [role="alert"] for both success and error toasts
    const alertBanner = page.locator('[role="alert"]').first();
    const hasAlert = await alertBanner.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasAlert) {
      const alertText = (await alertBanner.textContent().catch(() => '')) || '';
      await screenshot(page, '07-alert-banner', contactSlug);

      if (alertText.toLowerCase().includes('invitation sent') || alertText.toLowerCase().includes('sent to')) {
        console.log(`  [send] Success confirmation: "${alertText.trim()}"`);
        return { success: true };
      }

      if (alertText.toLowerCase().includes('limit') || alertText.toLowerCase().includes('restrict')) {
        return { success: false, reason: `Soft ban signal detected: ${alertText.trim()}` };
      }

      return { success: false, reason: `Error after send: ${alertText.trim()}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await screenshot(page, 'XX-exception', contactSlug).catch(() => {});
    return { success: false, reason: message };
  } finally {
    await page.close();
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status} ${res.statusText}`);
  const json = await res.json() as { success: boolean; data: T; error?: { message: string } };
  if (!json.success) throw new Error(`API GET ${path}: ${json.error?.message || 'Unknown error'}`);
  return json.data;
}

async function apiPut<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API PUT ${path} failed: ${res.status} ${res.statusText}`);
  const json = await res.json() as { success: boolean; data: T; error?: { message: string } };
  if (!json.success) throw new Error(`API PUT ${path}: ${json.error?.message || 'Unknown error'}`);
  return json.data;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  LinkedIn Connection Request Sender                  ║');
  console.log(`║  Safety limit: ${SAFETY_LIMIT} request(s)                           ║`);
  console.log(`║  Dry run:      ${DRY_RUN ? 'YES (will NOT click Send)' : 'NO (will send for real)'}        ║`);
  console.log(`║  API:          ${API_BASE}                  ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log();

  // Ensure screenshots dir
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // 1. Launch browser and check login
  console.log('[1/4] Launching browser and checking LinkedIn login...');
  await launchBrowser();
  const loggedIn = await isLoggedIn();

  if (!loggedIn) {
    console.error('ERROR: Not logged in to LinkedIn.');
    console.error('Run the app and use POST /api/linkedin/login to log in first.');
    await closeBrowser();
    process.exit(1);
  }
  console.log('  ✓ Logged in to LinkedIn');

  // 2. Fetch today's queue from the API (single data source)
  console.log('[2/4] Fetching today\'s queue from API...');

  let allItems: QueueItemFromAPI[];
  try {
    allItems = await apiGet<QueueItemFromAPI[]>('/queue/today');
  } catch (err) {
    console.error(`  ERROR: Could not fetch queue. Is the backend running on port ${config.port}?`);
    console.error(`  ${err instanceof Error ? err.message : err}`);
    await closeBrowser();
    process.exit(1);
  }

  // Filter: pending or approved connection_request items with a LinkedIn URL and message
  const pendingItems = allItems
    .filter(item =>
      (item.status === 'pending' || item.status === 'approved') &&
      item.actionType === 'connection_request' &&
      item.contact.linkedinUrl &&
      item.personalizedMessage
    )
    .slice(0, SAFETY_LIMIT);

  if (pendingItems.length === 0) {
    console.log('  No pending/approved connection request items with LinkedIn URLs found in today\'s queue.');
    console.log('  Run "npx tsx src/cli/trigger-queue.ts" first to generate queue items.');
    await closeBrowser();
    process.exit(0);
  }

  console.log(`  Found ${pendingItems.length} pending item(s) from queue:`);
  for (const item of pendingItems) {
    const c = item.contact;
    console.log(`    • ${c.firstName} ${c.lastName} (${c.company || 'N/A'}) → ${c.linkedinUrl}`);
    console.log(`      Note: "${(item.personalizedMessage || '').substring(0, 60)}..."`);
  }
  console.log();

  // 3. Process each item
  console.log('[3/4] Processing connection requests...');
  console.log('─'.repeat(60));

  const results: SendResult[] = [];
  let successCount = 0;
  let failCount = 0;
  let softBanDetected = false;

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    const contact = item.contact;
    const contactName = `${contact.firstName} ${contact.lastName}`;
    const linkedinUrl = contact.linkedinUrl!;
    const message = item.personalizedMessage!;

    console.log();
    console.log(`[${i + 1}/${pendingItems.length}] ${contactName} (${contact.company || 'N/A'})`);

    // Validate message length
    if (message.length > CONNECTION_NOTE_MAX) {
      console.log(`  ⊘ Skipped: Message exceeds ${CONNECTION_NOTE_MAX} chars (${message.length})`);
      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'skipped', reason: `Message exceeds ${CONNECTION_NOTE_MAX} chars` });
      continue;
    }

    // Check rate limits
    const rateCheck = await canSendRequest();
    if (!rateCheck.allowed) {
      console.log(`  ⊘ Rate limited: ${rateCheck.reason}`);
      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'skipped', reason: `Rate limited: ${rateCheck.reason}` });
      break;
    }

    console.log(`  [target] URL:  ${linkedinUrl}`);
    console.log(`  [target] Name: ${contact.firstName} ${contact.lastName}`);
    console.log(`  [target] Note: "${message.substring(0, 80)}${message.length > 80 ? '...' : ''}"`);

    const sendResult = await sendConnectionRequest(
      linkedinUrl,
      message,
      contact.firstName,
      contact.lastName
    );

    if (DRY_RUN && sendResult.reason?.startsWith('DRY_RUN')) {
      console.log(`  🛑 Dry run complete for ${contactName}`);
      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'dry_run', reason: sendResult.reason });
      continue;
    }

    // SKIP: Connect not available — leave queue item as pending, move to next
    if (sendResult.reason?.startsWith('SKIP:')) {
      const skipReason = sendResult.reason.replace('SKIP:', '');
      console.log(`  ⊘ Skipped: ${skipReason}`);
      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'skipped', reason: skipReason });
      continue;
    }

    if (sendResult.success) {
      console.log('  ✓ Connection request sent on LinkedIn');

      // Mark as done via the queue API — this handles:
      //   - Queue item → executed/success
      //   - Interaction logging (connection_request_sent)
      //   - Contact status transition (target → requested)
      //   - Relationship score recalculation
      try {
        await apiPut(`/queue/${item.id}/done`, { notes: message });
        console.log('  ✓ Queue item marked as done via API');
      } catch (err) {
        console.error(`  ⚠ API /queue/${item.id}/done failed: ${err instanceof Error ? err.message : err}`);
        console.error('    The LinkedIn send succeeded but the DB update failed. Fix manually.');
      }

      // Increment rate limit counter (Redis-based, not in the queue API)
      await recordRequest();

      successCount++;
      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'success' });
    } else {
      console.log(`  ✗ Failed: ${sendResult.reason}`);
      failCount++;

      // Soft ban detection
      if (sendResult.reason?.includes('Soft ban') || sendResult.reason?.includes('restrict')) {
        softBanDetected = true;
        console.log('  ⚠ SOFT BAN DETECTED — entering cooldown');
        await enterCooldown();
      }

      // Mark as skipped via the queue API so it stays actionable
      try {
        await apiPut(`/queue/${item.id}/skip`, { reason: sendResult.reason || 'Failed to send' });
      } catch {
        // Non-critical — log and continue
      }

      results.push({ queueItemId: item.id, contactName, linkedinUrl, status: 'failed', reason: sendResult.reason });

      if (softBanDetected) break;
    }

    // Wait between requests
    if (i < pendingItems.length - 1 && !softBanDetected) {
      const delayMs = getNextRequestDelay();
      const delayMin = (delayMs / 60000).toFixed(1);
      console.log(`  ⏳ Waiting ${delayMin} minutes before next request...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // 4. Summary
  console.log();
  console.log('─'.repeat(60));
  console.log('[4/4] Summary');
  console.log('─'.repeat(60));
  console.log(`  Total processed: ${results.length}`);
  console.log(`  Successful:      ${successCount}`);
  console.log(`  Failed:          ${failCount}`);
  console.log(`  Skipped:         ${results.filter((r) => r.status === 'skipped').length}`);
  console.log(`  Dry run:         ${results.filter((r) => r.status === 'dry_run').length}`);
  console.log(`  Screenshots dir: ${SCREENSHOTS_DIR}`);

  if (softBanDetected) {
    console.log();
    console.log('  ⚠ SOFT BAN DETECTED — Cooldown mode activated.');
  }

  console.log();
  console.log('Results:');
  for (const r of results) {
    const icon = r.status === 'success' ? '✓' : r.status === 'dry_run' ? '🛑' : r.status === 'failed' ? '✗' : '⊘';
    console.log(`  ${icon} ${r.contactName} — ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  }

  await closeBrowser();
  process.exit(softBanDetected ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
