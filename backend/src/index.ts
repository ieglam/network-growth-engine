import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './lib/config.js';
import { healthRoutes } from './routes/health.js';
import { contactRoutes } from './routes/contacts.js';
import { importRoutes } from './routes/import.js';
import { categoryRoutes } from './routes/categories.js';
import { tagRoutes } from './routes/tags.js';
import { templateRoutes } from './routes/templates.js';
import { interactionRoutes } from './routes/interactions.js';
import { queueRoutes } from './routes/queue.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { settingsRoutes } from './routes/settings.js';
import { exportRoutes } from './routes/export.js';
import { duplicateRoutes } from './routes/duplicates.js';

const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
});

async function buildApp() {
  // Register plugins
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Disable for development
  });

  // Register routes
  await fastify.register(healthRoutes, { prefix: '/api' });
  await fastify.register(contactRoutes, { prefix: '/api' });
  await fastify.register(importRoutes, { prefix: '/api' });
  await fastify.register(categoryRoutes, { prefix: '/api' });
  await fastify.register(tagRoutes, { prefix: '/api' });
  await fastify.register(templateRoutes, { prefix: '/api' });
  await fastify.register(interactionRoutes, { prefix: '/api' });
  await fastify.register(queueRoutes, { prefix: '/api' });
  await fastify.register(dashboardRoutes, { prefix: '/api' });
  await fastify.register(settingsRoutes, { prefix: '/api' });
  await fastify.register(exportRoutes, { prefix: '/api' });
  await fastify.register(duplicateRoutes, { prefix: '/api' });

  return fastify;
}

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Network Growth Engine - Backend Server                ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at http://localhost:${config.port}                ║
║  Environment: ${config.nodeEnv.padEnd(41)}║
║  Health check: http://localhost:${config.port}/api/health         ║
╚═══════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

export { buildApp };
