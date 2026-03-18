import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { config } from './core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { logger } from './core/logger.js';
import { errorHandler } from './core/middleware/error-handler.js';

// Initialise DB connection on startup
import './db/client.js';

// Domain routers
import { tasksRouter }        from './domains/tasks/tasks.router.js';
import { emailRouter }        from './domains/email/email.router.js';
import { googleAuthRouter }   from './integrations/google/google-auth.router.js';
import { gmailSyncRouter }    from './integrations/google/gmail-sync.router.js';
import { calendarSyncRouter } from './integrations/google/calendar-sync.router.js';

async function bootstrap() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  await app.register(staticPlugin, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
  });

  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', db: 'sqlite' });
  });

  // Google OAuth + sync routes live at root (no /api/v1 prefix) because
  // the auth flow uses browser redirects and the UI links to them directly.
  await app.register(googleAuthRouter);
  await app.register(gmailSyncRouter);
  await app.register(calendarSyncRouter);

  await app.register(async (v1) => {
    await v1.register(tasksRouter);
    await v1.register(emailRouter);
  }, { prefix: '/api/v1' });

  app.setErrorHandler(errorHandler);

  try {
    await app.listen({ port: config.PORT, host: '127.0.0.1' });
    logger.info('API server running', { port: config.PORT });
    logger.info('Drizzle Studio', { cmd: 'npm run db:studio' });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

bootstrap();
