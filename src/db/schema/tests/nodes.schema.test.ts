import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, isNull, isNotNull } from 'drizzle-orm';
import { nodes } from '../nodes.schema.js';
import type { HabitMetadata, EventMetadata, GroceryMetadata } from '../nodes.schema.js';

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
  `);

    return drizzle(sqlite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<typeof nodes.$inferInsert> = {}): typeof nodes.$inferInsert {
    return {
        id:    crypto.randomUUID(),
        type:  'todo',
        title: 'Test node',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — defaults', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('defaults status to inbox', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.status).toBe('inbox');
    });

    it('defaults priority to p2', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.priority).toBe('p2');
    });

    it('defaults is_p0 to false', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.is_p0).toBe(false);
    });

    it('defaults metadata to {}', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(JSON.parse(found.metadata)).toEqual({});
    });

    it('defaults nullable fields to null', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.parent_id).toBeNull();
        expect(found.description).toBeNull();
        expect(found.starts_at).toBeNull();
        expect(found.ends_at).toBeNull();
        expect(found.due_at).toBeNull();
        expect(found.completed_at).toBeNull();
        expect(found.location).toBeNull();
        expect(found.quantity).toBeNull();
        expect(found.unit).toBeNull();
        expect(found.shelf_life_days).toBeNull();
    });

    it('sets created_at and updated_at automatically', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.created_at).toBeTruthy();
        expect(found.updated_at).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Node types
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — node types', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('inserts an idea', async () => {
        const node = makeNode({ type: 'idea', title: 'Build a personal assistant' });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('idea');
    });

    it('inserts a project', async () => {
        const node = makeNode({
            type:     'project',
            title:    'Kitchen renovation',
            priority: 'p1',
            due_at:   '2024-12-31T00:00:00.000Z',
        });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('project');
        expect(found.due_at).toBe('2024-12-31T00:00:00.000Z');
    });

    it('inserts a todo', async () => {
        const node = makeNode({
            type:     'todo',
            title:    'Order countertops',
            priority: 'p1',
            due_at:   '2024-07-15T00:00:00.000Z',
        });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('todo');
        expect(found.priority).toBe('p1');
    });

    it('inserts an event with location and times', async () => {
        const node = makeNode({
            type:      'event',
            title:     'Meet contractor',
            location:  '123 Main St',
            starts_at: '2024-07-10T15:00:00.000Z',
            ends_at:   '2024-07-10T16:00:00.000Z',
        });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('event');
        expect(found.location).toBe('123 Main St');
        expect(found.starts_at).toBe('2024-07-10T15:00:00.000Z');
        expect(found.ends_at).toBe('2024-07-10T16:00:00.000Z');
    });

    it('inserts a grocery_item with quantity fields', async () => {
        const node = makeNode({
            type:            'grocery_item',
            title:           'Whole milk',
            is_p0:           true,
            quantity:        1,
            unit:            'gallon',
            shelf_life_days: 7,
            location:        'Whole Foods',
        });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('grocery_item');
        expect(found.is_p0).toBe(true);
        expect(found.quantity).toBe(1);
        expect(found.unit).toBe('gallon');
        expect(found.shelf_life_days).toBe(7);
    });

    it('inserts a habit with metadata', async () => {
        const meta: HabitMetadata = { frequency: 'daily', target_time: '07:00' };
        const node = makeNode({
            type:     'habit',
            title:    'Morning run',
            metadata: JSON.stringify(meta),
        });
        await db.insert(nodes).values(node);
        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.type).toBe('habit');
        const parsed = JSON.parse(found.metadata) as HabitMetadata;
        expect(parsed.frequency).toBe('daily');
        expect(parsed.target_time).toBe('07:00');
    });

    it('rejects an invalid type', async () => {
        const node = makeNode({ type: 'invalid_type' as any });
        await expect(db.insert(nodes).values(node)).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy — parent / child relationships
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — hierarchy', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('attaches a child task to a parent project', async () => {
        const project = makeNode({ type: 'project', title: 'Kitchen renovation' });
        const task    = makeNode({ type: 'todo', title: 'Order countertops', parent_id: project.id });

        await db.insert(nodes).values(project);
        await db.insert(nodes).values(task);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, task.id));
        expect(found.parent_id).toBe(project.id);
    });

    it('returns only top-level nodes when filtering for null parent_id', async () => {
        const project = makeNode({ type: 'project', title: 'Top-level project' });
        const task    = makeNode({ type: 'todo',    title: 'Child task', parent_id: project.id });
        const idea    = makeNode({ type: 'idea',    title: 'Top-level idea' });

        await db.insert(nodes).values(project);
        await db.insert(nodes).values(task);
        await db.insert(nodes).values(idea);

        const topLevel = await db.select().from(nodes).where(isNull(nodes.parent_id));
        expect(topLevel).toHaveLength(2);
        expect(topLevel.map(n => n.title)).toEqual(
            expect.arrayContaining(['Top-level project', 'Top-level idea'])
        );
    });

    it('returns all children of a given parent', async () => {
        const project  = makeNode({ type: 'project', title: 'Groceries' });
        const milk     = makeNode({ type: 'grocery_item', title: 'Whole milk',  parent_id: project.id });
        const eggs     = makeNode({ type: 'grocery_item', title: 'Eggs',        parent_id: project.id });
        const unrelated = makeNode({ type: 'todo', title: 'Unrelated task' });

        await db.insert(nodes).values([project, milk, eggs, unrelated]);

        const children = await db.select().from(nodes).where(eq(nodes.parent_id, project.id));
        expect(children).toHaveLength(2);
        expect(children.map(n => n.title)).toEqual(expect.arrayContaining(['Whole milk', 'Eggs']));
    });

    it('supports subtasks — a todo can be a child of another todo', async () => {
        const parent = makeNode({ type: 'todo', title: 'Write report' });
        const child  = makeNode({ type: 'todo', title: 'Write introduction', parent_id: parent.id });

        await db.insert(nodes).values(parent);
        await db.insert(nodes).values(child);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, child.id));
        expect(found.parent_id).toBe(parent.id);
    });

    it('cascades delete to children when parent is deleted', async () => {
        const project = makeNode({ type: 'project', title: 'Project to delete' });
        const task    = makeNode({ type: 'todo', title: 'Child task', parent_id: project.id });

        await db.insert(nodes).values(project);
        await db.insert(nodes).values(task);

        await db.delete(nodes).where(eq(nodes.id, project.id));

        const remaining = await db.select().from(nodes).where(eq(nodes.id, task.id));
        expect(remaining).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — status transitions', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('updates status from inbox to in_progress', async () => {
        const node = makeNode({ type: 'todo', title: 'Start me' });
        await db.insert(nodes).values(node);

        await db.update(nodes).set({ status: 'in_progress' }).where(eq(nodes.id, node.id));

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.status).toBe('in_progress');
    });

    it('marks a node as done with a completed_at timestamp', async () => {
        const node      = makeNode({ type: 'todo', title: 'Finish me' });
        const completedAt = '2024-07-01T12:00:00.000Z';
        await db.insert(nodes).values(node);

        await db.update(nodes).set({
            status:       'done',
            completed_at: completedAt,
        }).where(eq(nodes.id, node.id));

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.status).toBe('done');
        expect(found.completed_at).toBe(completedAt);
    });

    it('rejects an invalid status value', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);

        await expect(
            db.update(nodes).set({ status: 'invalid_status' as any }).where(eq(nodes.id, node.id))
        ).rejects.toThrow();
    });

    it('cancels a node', async () => {
        const node = makeNode({ type: 'project', title: 'Cancelled project' });
        await db.insert(nodes).values(node);

        await db.update(nodes).set({ status: 'cancelled' }).where(eq(nodes.id, node.id));

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.status).toBe('cancelled');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — priority', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('accepts all valid priority values', async () => {
        const priorities = ['p0', 'p1', 'p2', 'p3'] as const;

        for (const priority of priorities) {
            const node = makeNode({ priority, title: `Priority ${priority}` });
            await db.insert(nodes).values(node);
            const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
            expect(found.priority).toBe(priority);
        }
    });

    it('rejects an invalid priority', async () => {
        const node = makeNode({ priority: 'p4' as any });
        await expect(db.insert(nodes).values(node)).rejects.toThrow();
    });

    it('can filter nodes by priority', async () => {
        await db.insert(nodes).values([
            makeNode({ title: 'P0 task', priority: 'p0' }),
            makeNode({ title: 'P1 task', priority: 'p1' }),
            makeNode({ title: 'Another P0', priority: 'p0' }),
        ]);

        const p0Nodes = await db.select().from(nodes).where(eq(nodes.priority, 'p0'));
        expect(p0Nodes).toHaveLength(2);
        expect(p0Nodes.every(n => n.priority === 'p0')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Metadata JSON
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — metadata', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('stores and retrieves event metadata', async () => {
        const meta: EventMetadata = {
            attendees: [
                { name: 'Alice', email: 'alice@example.com', response: 'accepted' },
                { name: 'Bob',   email: 'bob@example.com',   response: 'awaiting' },
            ],
            all_day:  false,
            gcal_id:  'gcal_xyz',
        };
        const node = makeNode({ type: 'event', title: 'Team sync', metadata: JSON.stringify(meta) });
        await db.insert(nodes).values(node);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        const parsed = JSON.parse(found.metadata) as EventMetadata;
        expect(parsed.attendees).toHaveLength(2);
        expect(parsed.attendees![0].email).toBe('alice@example.com');
        expect(parsed.gcal_id).toBe('gcal_xyz');
        expect(parsed.all_day).toBe(false);
    });

    it('stores and retrieves grocery metadata', async () => {
        const meta: GroceryMetadata = { reorder_threshold: 1, typical_quantity: 2 };
        const node = makeNode({
            type:     'grocery_item',
            title:    'Eggs',
            metadata: JSON.stringify(meta),
        });
        await db.insert(nodes).values(node);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        const parsed = JSON.parse(found.metadata) as GroceryMetadata;
        expect(parsed.reorder_threshold).toBe(1);
        expect(parsed.typical_quantity).toBe(2);
    });

    it('stores and retrieves habit metadata', async () => {
        const meta: HabitMetadata = { frequency: 'weekdays', target_time: '06:30' };
        const node = makeNode({ type: 'habit', title: 'Meditate', metadata: JSON.stringify(meta) });
        await db.insert(nodes).values(node);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        const parsed = JSON.parse(found.metadata) as HabitMetadata;
        expect(parsed.frequency).toBe('weekdays');
        expect(parsed.target_time).toBe('06:30');
    });

    it('can update metadata without affecting other fields', async () => {
        const node = makeNode({ type: 'habit', title: 'Morning run', metadata: '{"frequency":"daily"}' });
        await db.insert(nodes).values(node);

        const updated: HabitMetadata = { frequency: 'weekdays', target_time: '07:00' };
        await db.update(nodes)
            .set({ metadata: JSON.stringify(updated) })
            .where(eq(nodes.id, node.id));

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.title).toBe('Morning run');  // unchanged
        const parsed = JSON.parse(found.metadata) as HabitMetadata;
        expect(parsed.frequency).toBe('weekdays');
        expect(parsed.target_time).toBe('07:00');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Grocery-specific fields
// ─────────────────────────────────────────────────────────────────────────────

describe('nodes table — grocery fields', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); });

    it('stores is_p0 flag correctly', async () => {
        const p0Item  = makeNode({ type: 'grocery_item', title: 'Milk',  is_p0: true });
        const p1Item  = makeNode({ type: 'grocery_item', title: 'Chips', is_p0: false });
        await db.insert(nodes).values([p0Item, p1Item]);

        const [milk]  = await db.select().from(nodes).where(eq(nodes.id, p0Item.id));
        const [chips] = await db.select().from(nodes).where(eq(nodes.id, p1Item.id));
        expect(milk.is_p0).toBe(true);
        expect(chips.is_p0).toBe(false);
    });

    it('can filter for p0 grocery items', async () => {
        await db.insert(nodes).values([
            makeNode({ type: 'grocery_item', title: 'Milk',   is_p0: true }),
            makeNode({ type: 'grocery_item', title: 'Eggs',   is_p0: true }),
            makeNode({ type: 'grocery_item', title: 'Snacks', is_p0: false }),
        ]);

        const p0Items = await db.select().from(nodes).where(eq(nodes.is_p0, true));
        expect(p0Items).toHaveLength(2);
        expect(p0Items.every(n => n.is_p0 === true)).toBe(true);
    });

    it('stores fractional quantities', async () => {
        const node = makeNode({ type: 'grocery_item', title: 'Olive oil', quantity: 0.5, unit: 'liter' });
        await db.insert(nodes).values(node);

        const [found] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(found.quantity).toBe(0.5);
        expect(found.unit).toBe('liter');
    });
});