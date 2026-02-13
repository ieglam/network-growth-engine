import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  launchBrowser,
  isLoggedIn,
  promptLogin,
  closeBrowser,
  getBrowserStatus,
} from '../services/linkedinBrowserService.js';

export async function linkedinRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  // GET /api/linkedin/status — Get browser and login status
  fastify.get('/linkedin/status', async () => {
    const browserStatus = getBrowserStatus();
    let loggedIn = false;

    if (browserStatus.launched) {
      loggedIn = await isLoggedIn();
    }

    return {
      success: true,
      data: {
        browserLaunched: browserStatus.launched,
        headless: browserStatus.headless,
        loggedIn,
      },
    };
  });

  // POST /api/linkedin/launch — Launch the browser
  fastify.post('/linkedin/launch', async () => {
    await launchBrowser();
    const loggedIn = await isLoggedIn();

    return {
      success: true,
      data: {
        message: loggedIn
          ? 'Browser launched — already logged in'
          : 'Browser launched — login required',
        loggedIn,
      },
    };
  });

  // POST /api/linkedin/login — Prompt manual login (headed mode only)
  fastify.post('/linkedin/login', async (_request, reply) => {
    const status = getBrowserStatus();
    if (status.headless) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'HEADLESS_MODE',
          message: 'Cannot prompt login in headless mode. Set LINKEDIN_HEADLESS=false',
        },
      });
    }

    const success = await promptLogin();
    if (!success) {
      return reply.status(408).send({
        success: false,
        error: { code: 'LOGIN_TIMEOUT', message: 'Login timed out or failed' },
      });
    }

    return {
      success: true,
      data: { message: 'Login successful' },
    };
  });

  // POST /api/linkedin/close — Close the browser
  fastify.post('/linkedin/close', async () => {
    await closeBrowser();
    return {
      success: true,
      data: { message: 'Browser closed' },
    };
  });
}
