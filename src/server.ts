import { buildApp } from './app.js';
import { config } from './core/config.js';
import { logger } from './core/logger.js';

const app = await buildApp();

try {
    await app.listen({ port: config.PORT, host: '127.0.0.1' });
    logger.info('API server running', { port: config.PORT });
    logger.info('Drizzle Studio', { cmd: 'npm run db:studio' });
} catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
}
