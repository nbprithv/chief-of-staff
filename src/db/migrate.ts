import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync } from 'fs';
import 'dotenv/config';

const url       = process.env.TURSO_DATABASE_URL ?? 'file:./data/assistant.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '');
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
    if (dir) mkdirSync(dir, { recursive: true });
}

const client = createClient({ url, authToken });
const db     = drizzle(client);

const target = url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//***@'); // redact auth
console.log(`Running migrations against: ${target}`);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('✓ Migrations complete');

client.close();
