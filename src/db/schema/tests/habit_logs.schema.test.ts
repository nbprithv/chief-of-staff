import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, gte, lte } from 'drizzle-orm';
import { nodes } from '../nodes.schema.js';
import { habitLogs } from '../habit_logs.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test DB setup
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    sqlite.exec(`
    CREATE TABLE nodes (
      id              TEXT PRIMARY KEY,
      parent_id       TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      type            TEXT NOT NULL CHECK(type IN ('idea','project','todo','event','grocery_item','habit')),
      title           TEXT NOT NULL,
      description     TEXT,
      status          TEXT NOT NULL DEFAULT 'inbox'
                        CHECK(status IN ('inbox','active','todo','in_progress','done','cancelled','archived')),
      priority        TEXT NOT NULL DEFAULT 'p2'
                        CHECK(priority IN ('p0','p1','p2','p3')),
      starts_at       TEXT,
      ends_at         TEXT,
      due_at          TEXT,
      completed_at    TEXT,
      location        TEXT,
      is_p0           INTEGER NOT NULL DEFAULT 0,
      quantity        REAL,
      unit            TEXT,
      shelf_life_days INTEGER,
      metadata        TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE habit_logs (
      id         TEXT PRIMARY KEY,
      node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      status     TEXT NOT NULL CHECK(status IN ('done','skipped','missed')),
      log_date   TEXT NOT NULL,
      notes      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

    return drizzle(sqlite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeHabit(overrides: Partial<typeof nodes.$inferInsert> = {}): typeof nodes.$inferInsert {
    return {
        id:    crypto.randomUUID(),
        type:  'habit',
        title: 'Morning run',
        ...overrides,
    };
}

function makeLog(
    node_id: string,
    overrides: Partial<typeof habitLogs.$inferInsert> = {},
): typeof habitLogs.$inferInsert {
    return {
        id:       crypto.randomUUID(),
        node_id,
        status:   'done',
        log_date: '2024-06-01',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('habit_logs — defaults', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('sets created_at automatically', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(makeLog(habit.id));

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.created_at).toBeTruthy();
    });

    it('defaults notes to null', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(makeLog(habit.id));

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.notes).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status values
// ─────────────────────────────────────────────────────────────────────────────

describe('habit_logs — status values', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('accepts done status', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(makeLog(habit.id, { status: 'done' }));

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.status).toBe('done');
    });

    it('accepts skipped status', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(makeLog(habit.id, { status: 'skipped', notes: 'Travelling' }));

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.status).toBe('skipped');
        expect(found.notes).toBe('Travelling');
    });

    it('accepts missed status', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(makeLog(habit.id, { status: 'missed' }));

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.status).toBe('missed');
    });

    it('rejects an invalid status', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);

        await expect(
            db.insert(habitLogs).values(makeLog(habit.id, { status: 'completed' as any }))
        ).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Referential integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('habit_logs — referential integrity', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('rejects a log with a non-existent node_id', async () => {
        await expect(
            db.insert(habitLogs).values(makeLog('non_existent_node'))
        ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('cascades delete to logs when the habit node is deleted', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values([
            makeLog(habit.id, { log_date: '2024-06-01' }),
            makeLog(habit.id, { log_date: '2024-06-02' }),
            makeLog(habit.id, { log_date: '2024-06-03' }),
        ]);

        await db.delete(nodes).where(eq(nodes.id, habit.id));

        const remaining = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(remaining).toHaveLength(0);
    });

    it('does not delete logs for other habits when one habit is deleted', async () => {
        const habit1 = makeHabit({ title: 'Morning run' });
        const habit2 = makeHabit({ title: 'Meditate' });
        await db.insert(nodes).values([habit1, habit2]);
        await db.insert(habitLogs).values([
            makeLog(habit1.id, { log_date: '2024-06-01' }),
            makeLog(habit2.id, { log_date: '2024-06-01' }),
        ]);

        await db.delete(nodes).where(eq(nodes.id, habit1.id));

        const remaining = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit2.id));
        expect(remaining).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Append-only log behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('habit_logs — append-only log behaviour', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('accumulates one log per day over a week', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);

        const week = [
            { log_date: '2024-06-01', status: 'done'    as const },
            { log_date: '2024-06-02', status: 'done'    as const },
            { log_date: '2024-06-03', status: 'skipped' as const },
            { log_date: '2024-06-04', status: 'done'    as const },
            { log_date: '2024-06-05', status: 'missed'  as const },
            { log_date: '2024-06-06', status: 'done'    as const },
            { log_date: '2024-06-07', status: 'done'    as const },
        ];

        await db.insert(habitLogs).values(week.map(w => makeLog(habit.id, w)));

        const all = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(all).toHaveLength(7);
    });

    it('allows multiple habits to log on the same date', async () => {
        const run      = makeHabit({ title: 'Morning run' });
        const meditate = makeHabit({ title: 'Meditate' });
        const journal  = makeHabit({ title: 'Journal' });
        await db.insert(nodes).values([run, meditate, journal]);

        await db.insert(habitLogs).values([
            makeLog(run.id,      { log_date: '2024-06-01', status: 'done'    }),
            makeLog(meditate.id, { log_date: '2024-06-01', status: 'skipped' }),
            makeLog(journal.id,  { log_date: '2024-06-01', status: 'done'    }),
        ]);

        const logsForDate = await db.select().from(habitLogs)
            .where(eq(habitLogs.log_date, '2024-06-01'));
        expect(logsForDate).toHaveLength(3);
    });

    it('allows two logs for the same habit on the same date (backfill scenario)', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);

        // Both inserts should succeed — no unique constraint on (node_id, log_date)
        await db.insert(habitLogs).values(makeLog(habit.id, { log_date: '2024-06-01', status: 'missed'  }));
        await db.insert(habitLogs).values(makeLog(habit.id, { log_date: '2024-06-01', status: 'done' }));

        const logs = await db.select().from(habitLogs)
            .where(and(eq(habitLogs.node_id, habit.id), eq(habitLogs.log_date, '2024-06-01')));
        expect(logs).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Querying and reporting
// ─────────────────────────────────────────────────────────────────────────────

describe('habit_logs — querying', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('can filter logs by status', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values([
            makeLog(habit.id, { log_date: '2024-06-01', status: 'done'    }),
            makeLog(habit.id, { log_date: '2024-06-02', status: 'skipped' }),
            makeLog(habit.id, { log_date: '2024-06-03', status: 'done'    }),
            makeLog(habit.id, { log_date: '2024-06-04', status: 'missed'  }),
            makeLog(habit.id, { log_date: '2024-06-05', status: 'done'    }),
        ]);

        const doneLogs = await db.select().from(habitLogs)
            .where(and(eq(habitLogs.node_id, habit.id), eq(habitLogs.status, 'done')));
        expect(doneLogs).toHaveLength(3);
    });

    it('can filter logs within a date range', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values([
            makeLog(habit.id, { log_date: '2024-05-30' }),
            makeLog(habit.id, { log_date: '2024-06-01' }),
            makeLog(habit.id, { log_date: '2024-06-05' }),
            makeLog(habit.id, { log_date: '2024-06-10' }),
            makeLog(habit.id, { log_date: '2024-06-15' }),
        ]);

        const inRange = await db.select().from(habitLogs).where(
            and(
                eq(habitLogs.node_id, habit.id),
                gte(habitLogs.log_date, '2024-06-01'),
                lte(habitLogs.log_date, '2024-06-10'),
            )
        );
        expect(inRange).toHaveLength(3);
    });

    it('can fetch logs for a specific habit on a specific date', async () => {
        const habit1 = makeHabit({ title: 'Run' });
        const habit2 = makeHabit({ title: 'Read' });
        await db.insert(nodes).values([habit1, habit2]);
        await db.insert(habitLogs).values([
            makeLog(habit1.id, { log_date: '2024-06-01', status: 'done'    }),
            makeLog(habit2.id, { log_date: '2024-06-01', status: 'skipped' }),
            makeLog(habit1.id, { log_date: '2024-06-02', status: 'missed'  }),
        ]);

        const [log] = await db.select().from(habitLogs).where(
            and(eq(habitLogs.node_id, habit1.id), eq(habitLogs.log_date, '2024-06-01'))
        );
        expect(log.status).toBe('done');
    });

    it('stores and retrieves notes on a log entry', async () => {
        const habit = makeHabit();
        await db.insert(nodes).values(habit);
        await db.insert(habitLogs).values(
            makeLog(habit.id, { status: 'skipped', notes: 'Feeling under the weather' })
        );

        const [found] = await db.select().from(habitLogs).where(eq(habitLogs.node_id, habit.id));
        expect(found.notes).toBe('Feeling under the weather');
    });
});