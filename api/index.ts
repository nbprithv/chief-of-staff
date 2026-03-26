import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from '../src/db/client.js';
import { buildApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In the Vercel bundle api/index.js sits at the root; public/ is copied alongside it
const publicDir        = path.join(__dirname, '../public');
const migrationsFolder = path.join(process.cwd(), 'drizzle');

// Cache the app instance across warm invocations
let appReady: Awaited<ReturnType<typeof buildApp>> | null = null;

async function getApp() {
    if (!appReady) {
        // Run pending migrations on every cold start
        await migrate(db, { migrationsFolder });
        appReady = await buildApp({ publicDir });
        await appReady.ready();
    }
    return appReady;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    const app = await getApp();
    app.server.emit('request', req, res);
}
