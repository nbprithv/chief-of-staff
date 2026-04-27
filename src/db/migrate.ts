import { createClient } from '@libsql/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';

/**
 * Runs all pending migrations against the given database URL.
 * Safe to call on every startup — already-applied migrations are skipped.
 *
 * @param migrationsDir  Absolute path to the folder containing drizzle SQL files
 *                       and meta/_journal.json. Defaults to <cwd>/drizzle.
 */
export async function runMigrations(migrationsDir?: string): Promise<void> {
    const dir = migrationsDir ?? path.join(process.cwd(), 'drizzle');

    const url       = process.env.TURSO_DATABASE_URL ?? 'file:./data/assistant.db';
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (url.startsWith('file:')) {
        const filePath = url.replace(/^file:/, '');
        const dataDir  = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
        if (dataDir) mkdirSync(dataDir, { recursive: true });
    }

    const target = url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//***@');
    console.log(`[migrate] Running against: ${target}`);

    const client = createClient({ url, authToken });

    await client.execute(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            hash       TEXT NOT NULL,
            created_at NUMERIC
        )
    `);

    const { rows } = await client.execute(`SELECT hash FROM "__drizzle_migrations"`);
    const applied  = new Set(rows.map(r => r[0] as string));

    const journal = JSON.parse(readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'));
    const entries: Array<{ idx: number; tag: string; when: number }> =
        journal.entries.sort((a: any, b: any) => a.idx - b.idx);

    let ran = 0;
    for (const entry of entries) {
        const sql  = readFileSync(path.join(dir, `${entry.tag}.sql`), 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');

        if (applied.has(hash)) continue;

        const statements = sql
            .split('--> statement-breakpoint')
            .map((s: string) => s.trim())
            .filter(Boolean);

        for (const stmt of statements) {
            await client.execute(stmt);
        }

        await client.execute({
            sql:  `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)`,
            args: [hash, entry.when],
        });

        console.log(`[migrate] ✓ ${entry.tag}`);
        ran++;
    }

    console.log(ran === 0 ? '[migrate] No pending migrations.' : `[migrate] ✓ ${ran} migration(s) applied.`);
    client.close();
}

// ── CLI entry point (npm run db:migrate) ──────────────────────────────────────

// Only run when executed directly, not when imported
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
    import('dotenv/config').then(() => runMigrations()).catch(err => {
        console.error('[migrate] Failed:', err);
        process.exit(1);
    });
}
