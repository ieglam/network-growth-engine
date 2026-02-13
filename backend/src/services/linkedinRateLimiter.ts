import { redis } from '../lib/redis.js';
import { config } from '../lib/config.js';

const KEYS = {
  weeklyCounter: (weekStart: string) => `linkedin:requests:week:${weekStart}`,
  dailyCounter: (date: string) => `linkedin:requests:day:${date}`,
  lastRequestTime: 'linkedin:last_request_time',
  cooldownEnd: 'linkedin:cooldown:ends',
};

/**
 * Get the Monday of the current week as ISO date string.
 */
function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  return monday.toISOString().split('T')[0];
}

/**
 * Get today's date as ISO date string.
 */
function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Check if we can send a LinkedIn request right now.
 * Checks: cooldown, weekly limit, daily limit, request spacing.
 */
export async function canSendRequest(): Promise<{
  allowed: boolean;
  reason?: string;
  waitMs?: number;
}> {
  // 1. Check cooldown
  const cooldownEnd = await redis.get(KEYS.cooldownEnd);
  if (cooldownEnd) {
    const endTime = parseInt(cooldownEnd, 10);
    if (Date.now() < endTime) {
      return {
        allowed: false,
        reason: 'cooldown',
        waitMs: endTime - Date.now(),
      };
    }
    // Cooldown expired, clean up
    await redis.del(KEYS.cooldownEnd);
  }

  // 2. Check weekly limit
  const weekStart = getWeekStart();
  const weeklyCount = parseInt((await redis.get(KEYS.weeklyCounter(weekStart))) || '0', 10);
  if (weeklyCount >= config.linkedinWeeklyLimit) {
    return { allowed: false, reason: 'weekly_limit' };
  }

  // 3. Check daily limit
  const today = getToday();
  const dailyCount = parseInt((await redis.get(KEYS.dailyCounter(today))) || '0', 10);
  if (dailyCount >= config.linkedinDailyLimit) {
    return { allowed: false, reason: 'daily_limit' };
  }

  // 4. Check request spacing
  const lastRequest = await redis.get(KEYS.lastRequestTime);
  if (lastRequest) {
    const lastTime = parseInt(lastRequest, 10);
    const elapsed = Date.now() - lastTime;
    const minGapMs = config.linkedinRequestGapMin * 1000;
    if (elapsed < minGapMs) {
      return {
        allowed: false,
        reason: 'spacing',
        waitMs: minGapMs - elapsed,
      };
    }
  }

  return { allowed: true };
}

/**
 * Record a sent request — increments counters and updates last request time.
 */
export async function recordRequest(): Promise<void> {
  const weekStart = getWeekStart();
  const today = getToday();

  const weekKey = KEYS.weeklyCounter(weekStart);
  const dayKey = KEYS.dailyCounter(today);

  await redis
    .multi()
    .incr(weekKey)
    .expire(weekKey, 7 * 24 * 60 * 60) // 7 days
    .incr(dayKey)
    .expire(dayKey, 24 * 60 * 60) // 1 day
    .set(KEYS.lastRequestTime, Date.now().toString())
    .exec();
}

/**
 * Enter cooldown mode for a specified number of days.
 */
export async function enterCooldown(days?: number): Promise<void> {
  const cooldownDays = days ?? config.cooldownDays;
  const endTime = Date.now() + cooldownDays * 24 * 60 * 60 * 1000;
  await redis.set(KEYS.cooldownEnd, endTime.toString());
}

/**
 * Get the current cooldown status.
 */
export async function getCooldownStatus(): Promise<{
  active: boolean;
  endsAt: string | null;
  remainingMs: number;
}> {
  const cooldownEnd = await redis.get(KEYS.cooldownEnd);
  if (!cooldownEnd) {
    return { active: false, endsAt: null, remainingMs: 0 };
  }

  const endTime = parseInt(cooldownEnd, 10);
  const remaining = endTime - Date.now();

  if (remaining <= 0) {
    await redis.del(KEYS.cooldownEnd);
    return { active: false, endsAt: null, remainingMs: 0 };
  }

  return {
    active: true,
    endsAt: new Date(endTime).toISOString(),
    remainingMs: remaining,
  };
}

/**
 * Get current rate limit status for display.
 */
export async function getRateLimitStatus(): Promise<{
  weeklyUsed: number;
  weeklyLimit: number;
  dailyUsed: number;
  dailyLimit: number;
  cooldown: {
    active: boolean;
    endsAt: string | null;
  };
  nextRequestAllowed: boolean;
}> {
  const weekStart = getWeekStart();
  const today = getToday();

  const [weeklyStr, dailyStr] = await redis.mget(
    KEYS.weeklyCounter(weekStart),
    KEYS.dailyCounter(today)
  );

  const weeklyUsed = parseInt(weeklyStr || '0', 10);
  const dailyUsed = parseInt(dailyStr || '0', 10);
  const cooldown = await getCooldownStatus();
  const { allowed } = await canSendRequest();

  return {
    weeklyUsed,
    weeklyLimit: config.linkedinWeeklyLimit,
    dailyUsed,
    dailyLimit: config.linkedinDailyLimit,
    cooldown: {
      active: cooldown.active,
      endsAt: cooldown.endsAt,
    },
    nextRequestAllowed: allowed,
  };
}

/**
 * Get a randomized delay between requests (in milliseconds).
 */
export function getNextRequestDelay(): number {
  const minMs = config.linkedinRequestGapMin * 1000;
  const maxMs = config.linkedinRequestGapMax * 1000;
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}
