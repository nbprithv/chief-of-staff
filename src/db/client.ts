import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdirSync } from 'fs';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import * as schema from './schema/index.js';

// For local file URLs, ensure the data directory exists
if (config.TURSO_DATABASE_URL.startsWith('file:')) {
    const filePath = config.TURSO_DATABASE_URL.replace(/^file:/, '');
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
    if (dir) mkdirSync(dir, { recursive: true });
}

const client = createClient({
    url:       config.TURSO_DATABASE_URL,
    authToken: config.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

logger.info('Database connected', { url: config.TURSO_DATABASE_URL });
