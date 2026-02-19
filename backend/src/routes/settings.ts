import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { Queue } from 'bullmq';
import { config } from '../lib/config.js';

const settingValidators: Record<string, z.ZodType> = {
  queue_generation_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM format (00:00–23:59)'),
  linkedin_weekly_limit: z.coerce.number().int().min(1).max(500),
  linkedin_daily_limit: z.coerce.number().int().min(1).max(100),
  cooldown_days: z.coerce.number().int().min(1).max(30),
  guided_mode: z.enum(['true', 'false']),
  notification_morning: z.enum(['true', 'false']),
  notification_afternoon: z.enum(['true', 'false']),
  network_goal: z.coerce.number().int().min(1),
};

export async function settingsRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/settings — Return all settings
  fastify.get('/settings', async () => {
    const settings = await prisma.settings.findMany({
      orderBy: { key: 'asc' },
    });

    const map: Record<string, string> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }

    return { success: true, data: map };
  });

  // PUT /api/settings — Update one or more settings
  fastify.put('/settings', async (request, reply) => {
    const bodyResult = z
      .record(z.string(), z.string())
      .refine((obj) => Object.keys(obj).length > 0, {
        message: 'At least one setting is required',
      })
      .safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body must be a non-empty object of key-value pairs',
        },
      });
    }

    const updates = bodyResult.data;
    const errors: Record<string, string> = {};
    const updated: Record<string, string> = {};

    for (const [key, value] of Object.entries(updates)) {
      // Validate known settings
      const validator = settingValidators[key];
      if (validator) {
        const result = validator.safeParse(value);
        if (!result.success) {
          errors[key] = `Invalid value: ${result.error.issues[0].message}`;
          continue;
        }
      }

      await prisma.settings.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      updated[key] = value;

      // Dynamically update BullMQ cron schedule when queue time changes
      if (key === 'queue_generation_time') {
        const [hour, minute] = value.split(':').map(Number);
        const queue = new Queue('daily-queue-generation', {
          connection: { url: config.redisUrl },
        });
        await queue.upsertJobScheduler(
          'daily-queue',
          { pattern: `${minute} ${hour} * * *`, tz: 'America/Mexico_City' },
          { name: 'generate-queue' }
        );
        await queue.close();
        fastify.log.info(`Queue generation rescheduled to ${value} America/Mexico_City`);
      }
    }

    if (Object.keys(errors).length > 0 && Object.keys(updated).length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'All settings failed validation',
          details: errors,
        },
      });
    }

    return {
      success: true,
      data: { updated, ...(Object.keys(errors).length > 0 ? { errors } : {}) },
    };
  });
}
