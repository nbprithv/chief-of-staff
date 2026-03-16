import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import * as schema from './schema/index.js';

// Ensure the data directory exists before opening the file
mkdirSync(dirname(config.DB_PATH), { recursive: true });

const sqlite = new Database(config.DB_PATH);

// WAL mode — better performance for concurrent reads alongside writes
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

logger.info('SQLite connected', { path: config.DB_PATH });
