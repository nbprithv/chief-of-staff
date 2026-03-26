import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In the Vercel bundle api/index.js sits at the root; public/ is copied alongside it
const publicDir = path.join(__dirname, '../public');

// Cache the app instance across warm invocations
let appReady: Awaited<ReturnType<typeof buildApp>> | null = null;

async function getApp() {
    if (!appReady) {
        appReady = await buildApp({ publicDir });
        await appReady.ready();
    }
    return appReady;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    const app = await getApp();
    app.server.emit('request', req, res);
}
