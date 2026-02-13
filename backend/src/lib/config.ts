import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  databaseUrl: z
    .string()
    .default('postgresql://postgres:postgres@localhost:5432/network_growth_engine'),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),

  // CORS
  corsOrigin: z.string().default('http://localhost:3000'),

  // LinkedIn Rate Limits
  linkedinWeeklyLimit: z.coerce.number().default(100),
  linkedinDailyLimit: z.coerce.number().default(20),
  linkedinRequestGapMin: z.coerce.number().default(120), // 2 minutes in seconds
  linkedinRequestGapMax: z.coerce.number().default(300), // 5 minutes in seconds
  cooldownDays: z.coerce.number().default(7),

  // Feature Flags
  guidedMode: z.coerce.boolean().default(true),
  linkedinAutomation: z.coerce.boolean().default(false),
  gmailIntegration: z.coerce.boolean().default(false),
  calendarIntegration: z.coerce.boolean().default(false),

  // LinkedIn Browser
  linkedinHeadless: z.coerce.boolean().default(false),

  // Queue Settings
  queueGenerationHour: z.coerce.number().min(0).max(23).default(7),
});

const parsed = configSchema.safeParse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  logLevel: process.env.LOG_LEVEL,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  corsOrigin: process.env.CORS_ORIGIN,
  linkedinWeeklyLimit: process.env.LINKEDIN_WEEKLY_LIMIT,
  linkedinDailyLimit: process.env.LINKEDIN_DAILY_LIMIT,
  linkedinRequestGapMin: process.env.LINKEDIN_REQUEST_GAP_MIN,
  linkedinRequestGapMax: process.env.LINKEDIN_REQUEST_GAP_MAX,
  cooldownDays: process.env.COOLDOWN_DAYS,
  guidedMode: process.env.GUIDED_MODE,
  linkedinAutomation: process.env.LINKEDIN_AUTOMATION,
  gmailIntegration: process.env.GMAIL_INTEGRATION,
  calendarIntegration: process.env.CALENDAR_INTEGRATION,
  linkedinHeadless: process.env.LINKEDIN_HEADLESS,
  queueGenerationHour: process.env.QUEUE_GENERATION_HOUR,
});

if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = z.infer<typeof configSchema>;
