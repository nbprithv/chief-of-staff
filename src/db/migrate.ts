import { createClient } from '@libsql/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import 'dotenv/config';

const url       = process.env.TURSO_DATABASE_URL ?? 'file:./data/assistant.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

if (url.startsWith('file:')) {
    const filePath = url.replace(/^file:/, '');
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
    if (dir) mkdirSync(dir, { recursive: true });
}

const target = url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//***@');
console.log(`Running migrations against: ${target}`);

const client = createClient({ url, authToken });

// Ensure migrations tracking table exists
await client.execute(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        hash  TEXT NOT NULL,
        created_at NUMERIC
    )
`);

// Load applied migration hashes
const { rows } = await client.execute(`SELECT hash FROM "__drizzle_migrations"`);
const applied = new Set(rows.map(r => r[0] as string));

// Load journal
const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8'));
const entries: Array<{ idx: number; tag: string; when: number }> =
    journal.entries.sort((a: any, b: any) => a.idx - b.idx);

let ran = 0;
for (const entry of entries) {
    const sql  = readFileSync(`./drizzle/${entry.tag}.sql`, 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');

    if (applied.has(hash)) continue;

    // Split on drizzle breakpoint markers and execute each statement individually
    const statements = sql
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(Boolean);

    for (const stmt of statements) {
        await client.execute(stmt);
    }

    await client.execute({
        sql:  `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
        args: [hash, entry.when],
    });

    console.log(`✓ ${entry.tag}`);
    ran++;
}

if (ran === 0) {
    console.log('No pending migrations.');
} else {
    console.log(`✓ ${ran} migration(s) applied.`);
}

client.close();
