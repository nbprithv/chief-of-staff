import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './core/config.js';
import { logger } from './core/logger.js';
import { errorHandler } from './core/middleware/error-handler.js';

// Initialise DB connection on startup
import './db/client.js';

// Domain routers
import { tasksRouter } from './domains/tasks/tasks.router.js';
import { emailRouter } from './domains/email/email.router.js';
import { googleAuthRouter } from '@/integrations/google/google-auth.router'

// — future routers registered here as you build them —
// import { projectsRouter }        from './domains/projects/projects.router.js';
// import { calendarRouter }        from './domains/calendar/calendar.router.js';
// import { groceryRouter }         from './domains/grocery/grocery.router.js';
// import { briefingRouter }        from './domains/briefing/briefing.router.js';
// import { recommendationsRouter } from './domains/recommendations/recommendations.router.js';
// import { habitsRouter }          from './domains/habits/habits.router.js';

async function bootstrap() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok', db: 'sqlite' });
  });

  await app.register(async (v1) => {
    await v1.register(tasksRouter);
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
