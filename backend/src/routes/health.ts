import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  fastify.get('/health', async (_request, _reply) => {
    return {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
      },
    };
  });

  fastify.get('/health/ready', async (_request, reply) => {
    // TODO: Add database and Redis connectivity checks
    const checks = {
      database: true, // Placeholder until Prisma is set up
      redis: true, // Placeholder until Redis is set up
    };

    const allHealthy = Object.values(checks).every(Boolean);

    if (!allHealthy) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'One or more services are not ready',
        },
        data: { checks },
      });
    }

    return {
      success: true,
      data: {
        status: 'ready',
        checks,
      },
    };
  });
}
