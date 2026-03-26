import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { logger } from './core/logger.js';
import { errorHandler } from './core/middleware/error-handler.js';
import { loadTokens } from './integrations/google/token-store.js';

// Initialise DB connection on startup
import './db/client.js';

// Domain routers
import { tasksRouter }        from './domains/tasks/tasks.router.js';
import { emailRouter }        from './domains/email/email.router.js';
import { googleAuthRouter }   from './integrations/google/google-auth.router.js';
import { gmailSyncRouter }    from './integrations/google/gmail-sync.router.js';
import { calendarSyncRouter } from './integrations/google/calendar-sync.router.js';

export async function buildApp(options: { publicDir?: string } = {}) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const publicDir = options.publicDir ?? path.join(__dirname, '../public');

    const app = Fastify({ logger: false });

    await app.register(cors, { origin: true });

    await app.register(staticPlugin, {
        root:   publicDir,
        prefix: '/',
    });

    // ── Auth-gated entry point ────────────────────────────────────────────────
    app.get('/', async (_req, reply) => {
        const tokens = await loadTokens();
        if (!tokens) return reply.redirect('/login');
        return reply.sendFile('index.html');
    });

    app.get('/login', async (_req, reply) => {
        const tokens = await loadTokens();
        if (tokens) return reply.redirect('/');
        return reply.sendFile('login.html');
    });

    app.get('/health', async (_req, reply) => {
        return reply.send({ status: 'ok', db: 'libsql' });
    });

    await app.register(googleAuthRouter);
    await app.register(gmailSyncRouter);
    await app.register(calendarSyncRouter);

    await app.register(async (v1) => {
        await v1.register(tasksRouter);
        await v1.register(emailRouter);
    }, { prefix: '/api/v1' });

    app.setErrorHandler(errorHandler);

    return app;
}
