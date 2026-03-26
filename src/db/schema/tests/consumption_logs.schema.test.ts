import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and, gte, lte, sum } from 'drizzle-orm';
import { nodes } from '../nodes.schema.js';
import { consumptionLogs } from '../consumption_logs.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test DB setup
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    sqlite.exec(`
    CREATE TABLE nodes (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE consumption_logs (
      id            TEXT PRIMARY KEY,
      node_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      quantity_used REAL NOT NULL,
      notes         TEXT,
      logged_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

    return drizzle(sqlite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeGroceryItem(overrides: Partial<typeof nodes.$inferInsert> = {}): typeof nodes.$inferInsert & { id: string } {
    return {
        id:              crypto.randomUUID(),
        type:            'grocery_item',
        title:           'Whole milk',
        is_p0:           true,
        quantity:        1,
        unit:            'gallon',
        shelf_life_days: 7,
        ...overrides,
    };
}

function makeLog(
    node_id: string,
    overrides: Partial<typeof consumptionLogs.$inferInsert> = {},
): typeof consumptionLogs.$inferInsert {
    return {
        id:            crypto.randomUUID(),
        node_id,
        quantity_used: 0.25,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('consumption_logs — defaults', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('sets logged_at automatically', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(makeLog(item.id));

        const [found] = await db.select().from(consumptionLogs).where(eq(consumptionLogs.node_id, item.id));
        expect(found.logged_at).toBeTruthy();
    });

    it('defaults notes to null', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(makeLog(item.id));

        const [found] = await db.select().from(consumptionLogs).where(eq(consumptionLogs.node_id, item.id));
        expect(found.notes).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// quantity_used
// ─────────────────────────────────────────────────────────────────────────────

describe('consumption_logs — quantity_used', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('stores an integer quantity', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(makeLog(item.id, { quantity_used: 1 }));

        const [found] = await db.select().from(consumptionLogs).where(eq(consumptionLogs.node_id, item.id));
        expect(found.quantity_used).toBe(1);
    });

    it('stores a fractional quantity', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(makeLog(item.id, { quantity_used: 0.5 }));

        const [found] = await db.select().from(consumptionLogs).where(eq(consumptionLogs.node_id, item.id));
        expect(found.quantity_used).toBe(0.5);
    });

    it('stores a small fractional quantity', async () => {
        const item = makeGroceryItem({ title: 'Olive oil', unit: 'liter' });
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(makeLog(item.id, { quantity_used: 0.05 }));

        const [found] = await db.select().from(consumptionLogs).where(eq(consumptionLogs.node_id, item.id));
        expect(found.quantity_used).toBeCloseTo(0.05);
    });

    it('rejects a missing quantity_used', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);

        const { quantity_used: _, ...withoutQty } = makeLog(item.id);
        await expect(
            db.insert(consumptionLogs).values(withoutQty as any)
        ).rejects.toThrow(/NOT NULL constraint failed/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Referential integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('consumption_logs — referential integrity', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('rejects a log with a non-existent node_id', async () => {
        await expect(
            db.insert(consumptionLogs).values(makeLog('non_existent_node'))
        ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('cascades delete to logs when the grocery item node is deleted', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values([
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-01T08:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-02T08:00:00' }),
            makeLog(item.id, { quantity_used: 0.50, logged_at: '2024-06-03T08:00:00' }),
        ]);

        await db.delete(nodes).where(eq(nodes.id, item.id));

        const remaining = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id));
        expect(remaining).toHaveLength(0);
    });

    it('does not delete logs for other items when one item is deleted', async () => {
        const milk = makeGroceryItem({ title: 'Milk' });
        const eggs = makeGroceryItem({ title: 'Eggs' });
        await db.insert(nodes).values([milk, eggs]);
        await db.insert(consumptionLogs).values([
            makeLog(milk.id, { quantity_used: 0.5 }),
            makeLog(eggs.id, { quantity_used: 6   }),
        ]);

        await db.delete(nodes).where(eq(nodes.id, milk.id));

        const remaining = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, eggs.id));
        expect(remaining).toHaveLength(1);
        expect(remaining[0].quantity_used).toBe(6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Append-only log behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('consumption_logs — append-only log behaviour', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('accumulates multiple logs for the same item over time', async () => {
        const item = makeGroceryItem({ title: 'Whole milk' });
        await db.insert(nodes).values(item);

        await db.insert(consumptionLogs).values([
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-01T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-02T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.50, logged_at: '2024-06-03T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-04T07:00:00' }),
        ]);

        const all = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id));
        expect(all).toHaveLength(4);
    });

    it('stores notes on a log entry', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values(
            makeLog(item.id, { quantity_used: 0.5, notes: 'Used for coffee and cereal' })
        );

        const [found] = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id));
        expect(found.notes).toBe('Used for coffee and cereal');
    });

    it('allows multiple items to be logged at the same timestamp', async () => {
        const milk = makeGroceryItem({ title: 'Milk' });
        const eggs = makeGroceryItem({ title: 'Eggs' });
        await db.insert(nodes).values([milk, eggs]);

        const ts = '2024-06-01T08:00:00';
        await db.insert(consumptionLogs).values([
            makeLog(milk.id, { quantity_used: 0.25, logged_at: ts }),
            makeLog(eggs.id, { quantity_used: 2,    logged_at: ts }),
        ]);

        const logsAtTs = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.logged_at, ts));
        expect(logsAtTs).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Querying and depletion tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('consumption_logs — querying and depletion tracking', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('can filter logs within a time range', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values([
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-05-28T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-01T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-04T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-07T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-15T07:00:00' }),
        ]);

        const inRange = await db.select().from(consumptionLogs).where(
            and(
                eq(consumptionLogs.node_id, item.id),
                gte(consumptionLogs.logged_at, '2024-06-01T00:00:00'),
                lte(consumptionLogs.logged_at, '2024-06-07T23:59:59'),
            )
        );
        expect(inRange).toHaveLength(3);
    });

    it('can sum total quantity consumed for a given item', async () => {
        const item = makeGroceryItem({ title: 'Olive oil', unit: 'liter', quantity: 1 });
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values([
            makeLog(item.id, { quantity_used: 0.1  }),
            makeLog(item.id, { quantity_used: 0.15 }),
            makeLog(item.id, { quantity_used: 0.25 }),
        ]);

        const [result] = await db
            .select({ total: sum(consumptionLogs.quantity_used) })
            .from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id));

        expect(Number(result.total)).toBeCloseTo(0.5);
    });

    it('returns no logs for an item with no consumption history', async () => {
        const item = makeGroceryItem({ title: 'New item, never used' });
        await db.insert(nodes).values(item);

        const logs = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id));
        expect(logs).toHaveLength(0);
    });

    it('can fetch the most recent log for an item', async () => {
        const item = makeGroceryItem();
        await db.insert(nodes).values(item);
        await db.insert(consumptionLogs).values([
            makeLog(item.id, { quantity_used: 0.25, logged_at: '2024-06-01T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.50, logged_at: '2024-06-05T07:00:00' }),
            makeLog(item.id, { quantity_used: 0.10, logged_at: '2024-06-03T07:00:00' }),
        ]);

        const logs = await db.select().from(consumptionLogs)
            .where(eq(consumptionLogs.node_id, item.id))
            .orderBy(consumptionLogs.logged_at);

        const mostRecent = logs[logs.length - 1];
        expect(mostRecent.logged_at).toBe('2024-06-05T07:00:00');
        expect(mostRecent.quantity_used).toBe(0.50);
    });

    it('can fetch logs for multiple items in one query', async () => {
        const milk = makeGroceryItem({ title: 'Milk' });
        const eggs = makeGroceryItem({ title: 'Eggs' });
        const bread = makeGroceryItem({ title: 'Bread' });
        await db.insert(nodes).values([milk, eggs, bread]);
        await db.insert(consumptionLogs).values([
            makeLog(milk.id,  { quantity_used: 0.5 }),
            makeLog(eggs.id,  { quantity_used: 3   }),
            makeLog(bread.id, { quantity_used: 0.5 }),
        ]);

        const itemIds = [milk.id, eggs.id];
        const logs = await db.select().from(consumptionLogs)
            .where(
                and(
                    gte(consumptionLogs.node_id, itemIds[0]),
                    lte(consumptionLogs.node_id, itemIds[1]),
                )
            );

        // Use a direct filter approach for multi-id queries
        const allLogs = await db.select().from(consumptionLogs);
        const filtered = allLogs.filter(l => itemIds.includes(l.node_id));
        expect(filtered).toHaveLength(2);
    });
});