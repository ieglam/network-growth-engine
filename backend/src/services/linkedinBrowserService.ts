import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../lib/config.js';

const STORAGE_DIR = path.resolve(process.cwd(), '.linkedin');
const STATE_FILE = path.join(STORAGE_DIR, 'state.enc');
const ENCRYPTION_KEY_ENV = 'LINKEDIN_ENCRYPTION_KEY';

// 32-byte key for AES-256
function getEncryptionKey(): Buffer {
  const keyHex = process.env[ENCRYPTION_KEY_ENV];
  if (!keyHex || keyHex.length < 32) {
    // Generate a key if not set (first run)
    const generated = crypto.randomBytes(32);
    console.warn(
      `[LinkedIn] No ${ENCRYPTION_KEY_ENV} set. Generated key: ${generated.toString('hex')}`
    );
    console.warn(`[LinkedIn] Set ${ENCRYPTION_KEY_ENV}=${generated.toString('hex')} in .env`);
    return generated;
  }
  return Buffer.from(keyHex, 'hex');
}

function encrypt(data: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string): string {
  const key = getEncryptionKey();
  const [ivHex, encryptedHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Ensure the storage directory exists.
 */
function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/**
 * Save browser state (cookies, local storage) to an encrypted file.
 */
async function saveState(): Promise<void> {
  if (!context) return;
  ensureStorageDir();
  const state = await context.storageState();
  const json = JSON.stringify(state);
  const encrypted = encrypt(json);
  fs.writeFileSync(STATE_FILE, encrypted, 'utf8');
}

/**
 * Load saved browser state from encrypted file, if it exists.
 */
function loadState(): string | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const encrypted = fs.readFileSync(STATE_FILE, 'utf8');
    return decrypt(encrypted);
  } catch {
    console.warn('[LinkedIn] Failed to decrypt state file — starting fresh');
    return null;
  }
}

/**
 * Launch browser and create a persistent context.
 * Restores previous session state if available.
 */
export async function launchBrowser(): Promise<BrowserContext> {
  if (context) return context;

  browser = await chromium.launch({
    headless: config.linkedinHeadless,
  });

  const savedState = loadState();
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
  };

  if (savedState) {
    contextOptions.storageState = JSON.parse(savedState);
  }

  context = await browser.newContext(contextOptions);

  return context;
}

/**
 * Check if the current session is logged in to LinkedIn.
 * Navigates to linkedin.com/feed and checks for the feed page.
 */
export async function isLoggedIn(): Promise<boolean> {
  const ctx = await launchBrowser();
  const page = await ctx.newPage();
  try {
    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // If redirected to login page, we're not logged in
    const url = page.url();
    if (url.includes('/login') || url.includes('/authwall') || url.includes('/uas/')) {
      return false;
    }

    // Check for feed content or profile nav
    const feedExists = await page
      .locator('[data-test-id="feed-sort-dropdown"], .feed-shared-update-v2, .global-nav')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    return feedExists;
  } catch {
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Open a browser page for the user to manually log in.
 * Waits for successful login, then saves state.
 * Must run in headed mode.
 */
export async function promptLogin(): Promise<boolean> {
  if (config.linkedinHeadless) {
    console.error('[LinkedIn] Cannot prompt login in headless mode. Set LINKEDIN_HEADLESS=false');
    return false;
  }

  const ctx = await launchBrowser();
  const page = await ctx.newPage();

  try {
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    console.log('[LinkedIn] Please log in to LinkedIn in the browser window...');

    // Wait for navigation to feed page (user logs in manually)
    await page.waitForURL('**/feed/**', { timeout: 300000 }); // 5 minutes

    // Save session state
    await saveState();
    console.log('[LinkedIn] Login successful — session saved');

    return true;
  } catch {
    console.error('[LinkedIn] Login timed out or failed');
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Get a new page from the browser context.
 */
export async function newPage(): Promise<Page> {
  const ctx = await launchBrowser();
  return ctx.newPage();
}

/**
 * Save current state and close the browser.
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveState();
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Get the current browser status.
 */
export function getBrowserStatus(): {
  launched: boolean;
  headless: boolean;
} {
  return {
    launched: browser !== null,
    headless: config.linkedinHeadless,
  };
}
