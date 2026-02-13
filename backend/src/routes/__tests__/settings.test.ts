import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { settingsRoutes } from '../settings.js';
import { prisma } from '../../lib/prisma.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.ready();
});

afterAll(async () => {
  await prisma.settings.deleteMany({
    where: { key: { startsWith: 'test_' } },
  });
  await prisma.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prisma.settings.deleteMany({
    where: { key: { startsWith: 'test_' } },
  });
});

describe('GET /api/settings', () => {
  it('returns all settings as key-value map', async () => {
    await prisma.settings.upsert({
      where: { key: 'test_setting_a' },
      update: { value: '42' },
      create: { key: 'test_setting_a', value: '42' },
    });
    await prisma.settings.upsert({
      where: { key: 'test_setting_b' },
      update: { value: 'hello' },
      create: { key: 'test_setting_b', value: 'hello' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/settings' });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.test_setting_a).toBe('42');
    expect(data.test_setting_b).toBe('hello');
  });

  it('returns empty object when no settings exist', async () => {
    // Delete all settings for this test
    await prisma.settings.deleteMany();

    const res = await app.inject({ method: 'GET', url: '/api/settings' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({});

    // Restore seed settings won't matter since beforeEach only cleans test_ prefixed
  });
});

describe('PUT /api/settings', () => {
  it('creates new settings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { test_custom_key: 'my_value' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated.test_custom_key).toBe('my_value');

    // Verify persisted
    const setting = await prisma.settings.findUnique({ where: { key: 'test_custom_key' } });
    expect(setting!.value).toBe('my_value');
  });

  it('updates existing settings', async () => {
    await prisma.settings.upsert({
      where: { key: 'test_update_me' },
      update: { value: 'old' },
      create: { key: 'test_update_me', value: 'old' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { test_update_me: 'new' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated.test_update_me).toBe('new');

    const setting = await prisma.settings.findUnique({ where: { key: 'test_update_me' } });
    expect(setting!.value).toBe('new');
  });

  it('validates queue_generation_hour (0-23)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { queue_generation_hour: '25' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('validates guided_mode (true/false)', async () => {
    const goodRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { guided_mode: 'true' },
    });
    expect(goodRes.statusCode).toBe(200);

    const badRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { guided_mode: 'maybe' },
    });
    expect(badRes.statusCode).toBe(400);
  });

  it('validates linkedin_weekly_limit (1-500)', async () => {
    const goodRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { linkedin_weekly_limit: '100' },
    });
    expect(goodRes.statusCode).toBe(200);

    const badRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { linkedin_weekly_limit: '0' },
    });
    expect(badRes.statusCode).toBe(400);
  });

  it('updates multiple settings at once', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        test_multi_a: 'val_a',
        test_multi_b: 'val_b',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated.test_multi_a).toBe('val_a');
    expect(res.json().data.updated.test_multi_b).toBe('val_b');
  });

  it('returns 400 for empty body', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('partially succeeds with mixed valid and invalid settings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        test_valid_key: 'good_value',
        queue_generation_hour: '99', // invalid
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated.test_valid_key).toBe('good_value');
    expect(res.json().data.errors.queue_generation_hour).toBeDefined();
  });
});
