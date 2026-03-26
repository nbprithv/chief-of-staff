import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { nodes } from '../nodes.schema.js';
import { emails, hashEmail } from '../emails.schema.js';
import { nodeEmailLinks } from '../node_email_links.schema.js';

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

    CREATE TABLE emails (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL DEFAULT '',
      gmail_id     TEXT NOT NULL UNIQUE,
      thread_id    TEXT,
      content_hash TEXT NOT NULL UNIQUE,
      subject      TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_name  TEXT,
      recipients   TEXT NOT NULL DEFAULT '[]',
      body_summary TEXT,
      body_raw     TEXT,
      labels       TEXT NOT NULL DEFAULT '["inbox"]',
      triaged      INTEGER NOT NULL DEFAULT 0,
      received_at  TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE node_email_links (
      id         TEXT PRIMARY KEY,
      node_id    TEXT NOT NULL REFERENCES nodes(id)  ON DELETE CASCADE,
      email_id   TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      link_type  TEXT NOT NULL DEFAULT 'generated_from'
                   CHECK(link_type IN ('generated_from','referenced_in','follow_up_for')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

    return drizzle(sqlite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<typeof nodes.$inferInsert> = {}): typeof nodes.$inferInsert & { id: string } {
    return {
        id:    crypto.randomUUID(),
        type:  'todo',
        title: 'Test node',
        ...overrides,
    };
}

let emailCounter = 0;
function makeEmail(overrides: Partial<typeof emails.$inferInsert> = {}): typeof emails.$inferInsert & { id: string } {
    emailCounter++;
    const fields = {
        gmail_id:     `msg_${emailCounter}`,
        sender_email: 'sender@example.com',
        received_at:  '2024-06-01T09:00:00.000Z',
        subject:      `Test subject ${emailCounter}`,
        body_raw:     `Body content ${emailCounter}`,
    };
    return {
        id:           crypto.randomUUID(),
        gmail_id:     fields.gmail_id,
        sender_email: fields.sender_email,
        received_at:  fields.received_at,
        subject:      fields.subject,
        body_raw:     fields.body_raw,
        content_hash: hashEmail(fields),
        ...overrides,
    };
}

function makeLink(
    node_id: string,
    email_id: string,
    overrides: Partial<typeof nodeEmailLinks.$inferInsert> = {},
): typeof nodeEmailLinks.$inferInsert & { id: string } {
    return {
        id: crypto.randomUUID(),
        node_id,
        email_id,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('node_email_links — defaults', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); emailCounter = 0; });

    it('defaults link_type to generated_from', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        const link = makeLink(node.id, email.id);
        await db.insert(nodeEmailLinks).values(link);

        const [found] = await db.select().from(nodeEmailLinks).where(eq(nodeEmailLinks.id, link.id));
        expect(found.link_type).toBe('generated_from');
    });

    it('sets created_at automatically', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        const link = makeLink(node.id, email.id);
        await db.insert(nodeEmailLinks).values(link);

        const [found] = await db.select().from(nodeEmailLinks).where(eq(nodeEmailLinks.id, link.id));
        expect(found.created_at).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Link types
// ─────────────────────────────────────────────────────────────────────────────

describe('node_email_links — link types', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); emailCounter = 0; });

    it('creates a generated_from link', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        await db.insert(nodeEmailLinks).values(makeLink(node.id, email.id, { link_type: 'generated_from' }));

        const [found] = await db.select().from(nodeEmailLinks)
            .where(and(eq(nodeEmailLinks.node_id, node.id), eq(nodeEmailLinks.email_id, email.id)));
        expect(found.link_type).toBe('generated_from');
    });

    it('creates a referenced_in link', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        await db.insert(nodeEmailLinks).values(makeLink(node.id, email.id, { link_type: 'referenced_in' }));

        const [found] = await db.select().from(nodeEmailLinks)
            .where(eq(nodeEmailLinks.node_id, node.id));
        expect(found.link_type).toBe('referenced_in');
    });

    it('creates a follow_up_for link', async () => {
        const node  = makeNode({ type: 'todo', title: 'Follow up with Alice' });
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        await db.insert(nodeEmailLinks).values(makeLink(node.id, email.id, { link_type: 'follow_up_for' }));

        const [found] = await db.select().from(nodeEmailLinks)
            .where(eq(nodeEmailLinks.node_id, node.id));
        expect(found.link_type).toBe('follow_up_for');
    });

    it('rejects an invalid link_type', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        await expect(
            db.insert(nodeEmailLinks).values(makeLink(node.id, email.id, { link_type: 'invalid' as any }))
        ).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Referential integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('node_email_links — referential integrity', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); emailCounter = 0; });

    it('rejects a link with a non-existent node_id', async () => {
        const email = makeEmail();
        await db.insert(emails).values(email);

        await expect(
            db.insert(nodeEmailLinks).values(makeLink('non_existent_node', email.id))
        ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('rejects a link with a non-existent email_id', async () => {
        const node = makeNode();
        await db.insert(nodes).values(node);

        await expect(
            db.insert(nodeEmailLinks).values(makeLink(node.id, 'non_existent_email'))
        ).rejects.toThrow(/FOREIGN KEY constraint failed/);
    });

    it('cascades delete when the linked node is deleted', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        const link = makeLink(node.id, email.id);
        await db.insert(nodeEmailLinks).values(link);

        await db.delete(nodes).where(eq(nodes.id, node.id));

        const remaining = await db.select().from(nodeEmailLinks).where(eq(nodeEmailLinks.id, link.id));
        expect(remaining).toHaveLength(0);
    });

    it('cascades delete when the linked email is deleted', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        const link = makeLink(node.id, email.id);
        await db.insert(nodeEmailLinks).values(link);

        await db.delete(emails).where(eq(emails.id, email.id));

        const remaining = await db.select().from(nodeEmailLinks).where(eq(nodeEmailLinks.id, link.id));
        expect(remaining).toHaveLength(0);
    });

    it('does not delete the email when the node is deleted', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);
        await db.insert(nodeEmailLinks).values(makeLink(node.id, email.id));

        await db.delete(nodes).where(eq(nodes.id, node.id));

        const [foundEmail] = await db.select().from(emails).where(eq(emails.id, email.id));
        expect(foundEmail).toBeDefined();
    });

    it('does not delete the node when the email is deleted', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);
        await db.insert(nodeEmailLinks).values(makeLink(node.id, email.id));

        await db.delete(emails).where(eq(emails.id, email.id));

        const [foundNode] = await db.select().from(nodes).where(eq(nodes.id, node.id));
        expect(foundNode).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Many-to-many relationships
// ─────────────────────────────────────────────────────────────────────────────

describe('node_email_links — many-to-many', () => {
    let db: ReturnType<typeof createTestDb>;
    beforeEach(() => { db = createTestDb(); emailCounter = 0; });

    it('links one email to multiple nodes', async () => {
        const email = makeEmail();
        const task  = makeNode({ type: 'todo',    title: 'Reply to Alice' });
        const event = makeNode({ type: 'event',   title: 'Meeting with Alice' });
        const idea  = makeNode({ type: 'idea',    title: 'New project idea from Alice' });

        await db.insert(emails).values(email);
        await db.insert(nodes).values([task, event, idea]);
        await db.insert(nodeEmailLinks).values([
            makeLink(task.id,  email.id, { link_type: 'generated_from' }),
            makeLink(event.id, email.id, { link_type: 'generated_from' }),
            makeLink(idea.id,  email.id, { link_type: 'referenced_in'  }),
        ]);

        const links = await db.select().from(nodeEmailLinks)
            .where(eq(nodeEmailLinks.email_id, email.id));
        expect(links).toHaveLength(3);
    });

    it('links one node to multiple emails', async () => {
        const node   = makeNode({ type: 'project', title: 'Q3 planning' });
        const email1 = makeEmail();
        const email2 = makeEmail();
        const email3 = makeEmail();

        await db.insert(nodes).values(node);
        await db.insert(emails).values([email1, email2, email3]);
        await db.insert(nodeEmailLinks).values([
            makeLink(node.id, email1.id, { link_type: 'generated_from' }),
            makeLink(node.id, email2.id, { link_type: 'referenced_in'  }),
            makeLink(node.id, email3.id, { link_type: 'follow_up_for'  }),
        ]);

        const links = await db.select().from(nodeEmailLinks)
            .where(eq(nodeEmailLinks.node_id, node.id));
        expect(links).toHaveLength(3);
        expect(links.map(l => l.link_type)).toEqual(
            expect.arrayContaining(['generated_from', 'referenced_in', 'follow_up_for'])
        );
    });

    it('allows the same node and email to be linked with different link_types', async () => {
        const node  = makeNode();
        const email = makeEmail();
        await db.insert(nodes).values(node);
        await db.insert(emails).values(email);

        await db.insert(nodeEmailLinks).values([
            makeLink(node.id, email.id, { link_type: 'generated_from' }),
            makeLink(node.id, email.id, { link_type: 'follow_up_for'  }),
        ]);

        const links = await db.select().from(nodeEmailLinks)
            .where(and(eq(nodeEmailLinks.node_id, node.id), eq(nodeEmailLinks.email_id, email.id)));
        expect(links).toHaveLength(2);
    });

    it('can filter links by link_type across all records', async () => {
        const node1  = makeNode({ title: 'Task from email' });
        const node2  = makeNode({ title: 'Follow-up task' });
        const email1 = makeEmail();
        const email2 = makeEmail();

        await db.insert(nodes).values([node1, node2]);
        await db.insert(emails).values([email1, email2]);
        await db.insert(nodeEmailLinks).values([
            makeLink(node1.id, email1.id, { link_type: 'generated_from' }),
            makeLink(node2.id, email2.id, { link_type: 'follow_up_for'  }),
        ]);

        const followUps = await db.select().from(nodeEmailLinks)
            .where(eq(nodeEmailLinks.link_type, 'follow_up_for'));
        expect(followUps).toHaveLength(1);
        expect(followUps[0].node_id).toBe(node2.id);
    });
});