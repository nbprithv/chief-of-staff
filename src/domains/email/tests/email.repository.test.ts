import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createEmailRepository } from '../email.repository.js';
import { hashEmail } from '../../../db/schema/emails.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test DB setup
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb() {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
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
  `);
    return drizzle(sqlite);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let counter = 0;

function makeEmailData(overrides: Record<string, unknown> = {}) {
    counter++;
    const base = {
        gmail_id:     `gmail_${counter}`,
        sender_email: `sender${counter}@example.com`,
        received_at:  `2024-06-0${(counter % 9) + 1}T09:00:00.000Z`,
        subject:      `Subject ${counter}`,
        body_raw:     `Body content ${counter}`,
    };
    return {
        id:           crypto.randomUUID(),
        user_id:      'test-user',
        gmail_id:     base.gmail_id,
        thread_id:    null,
        content_hash: hashEmail(base),
        subject:      base.subject,
        sender_email: base.sender_email,
        sender_name:  null,
        recipients:   '[]',
        body_summary: null,
        body_raw:     base.body_raw,
        labels:       '["inbox"]',
        triaged:      false,
        received_at:  base.received_at,
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// create()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.create()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('inserts and returns the new email', async () => {
        const data  = makeEmailData();
        const email = await repo.create(data as any);
        expect(email.id).toBe(data.id);
        expect(email.gmail_id).toBe(data.gmail_id);
        expect(email.subject).toBe(data.subject);
    });

    it('stores content_hash on insert', async () => {
        const data  = makeEmailData();
        const email = await repo.create(data as any);
        expect(email.content_hash).toBe(data.content_hash);
        expect(email.content_hash).toHaveLength(64);
    });

    it('throws on duplicate gmail_id', async () => {
        const data = makeEmailData();
        await repo.create(data as any);
        await expect(
            repo.create({ ...data, id: crypto.randomUUID(), content_hash: 'different_hash_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } as any)
        ).rejects.toThrow(/UNIQUE constraint failed/);
    });

    it('throws on duplicate content_hash', async () => {
        const data = makeEmailData();
        await repo.create(data as any);
        await expect(
            repo.create({ ...data, id: crypto.randomUUID(), gmail_id: 'different_gmail_id' } as any)
        ).rejects.toThrow(/UNIQUE constraint failed/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findById()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findById()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns the email when found', async () => {
        const data  = makeEmailData();
        await repo.create(data as any);
        const found = await repo.findById(data.id, 'test-user');
        expect(found).not.toBeNull();
        expect(found!.id).toBe(data.id);
    });

    it('returns null when not found', async () => {
        const found = await repo.findById('non_existent_id', 'test-user');
        expect(found).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByGmailId()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findByGmailId()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns the email when found', async () => {
        const data  = makeEmailData();
        await repo.create(data as any);
        const found = await repo.findByGmailId(data.gmail_id, 'test-user');
        expect(found).not.toBeNull();
        expect(found!.gmail_id).toBe(data.gmail_id);
    });

    it('returns null when not found', async () => {
        const found = await repo.findByGmailId('non_existent_gmail_id', 'test-user');
        expect(found).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByContentHash()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findByContentHash()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns the email matching the hash', async () => {
        const data  = makeEmailData();
        await repo.create(data as any);
        const found = await repo.findByContentHash(data.content_hash, 'test-user');
        expect(found).not.toBeNull();
        expect(found!.content_hash).toBe(data.content_hash);
    });

    it('returns null for an unknown hash', async () => {
        const found = await repo.findByContentHash('a'.repeat(64), 'test-user');
        expect(found).toBeNull();
    });

    it('can be used as a duplicate check before insert', async () => {
        const data = makeEmailData();
        await repo.create(data as any);

        const existing = await repo.findByContentHash(data.content_hash, 'test-user');
        expect(existing).not.toBeNull();

        // Simulate "skip if exists" logic
        const shouldSkip = existing !== null;
        expect(shouldSkip).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByThreadId()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findByThreadId()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns all emails in the thread', async () => {
        const threadId = 'thread_abc';
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-01T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-02T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-03T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ thread_id: 'other_thread' }) as any);

        const thread = await repo.findByThreadId(threadId, 'test-user');
        expect(thread).toHaveLength(3);
        expect(thread.every(e => e.thread_id === threadId)).toBe(true);
    });

    it('returns emails ordered by received_at descending', async () => {
        const threadId = 'thread_ordered';
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-01T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-03T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ thread_id: threadId, received_at: '2024-06-02T09:00:00.000Z' }) as any);

        const thread = await repo.findByThreadId(threadId, 'test-user');
        expect(thread[0].received_at).toBe('2024-06-03T09:00:00.000Z');
        expect(thread[2].received_at).toBe('2024-06-01T09:00:00.000Z');
    });

    it('returns empty array for unknown thread', async () => {
        const thread = await repo.findByThreadId('non_existent_thread', 'test-user');
        expect(thread).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findUntriaged()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findUntriaged()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns only untriaged emails', async () => {
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: true  }) as any);

        const untriaged = await repo.findUntriaged('test-user');
        expect(untriaged).toHaveLength(2);
        expect(untriaged.every(e => e.triaged === false)).toBe(true);
    });

    it('respects the limit parameter', async () => {
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);

        const untriaged = await repo.findUntriaged('test-user', 2);
        expect(untriaged).toHaveLength(2);
    });

    it('returns empty array when all emails are triaged', async () => {
        await repo.create(makeEmailData({ triaged: true }) as any);
        await repo.create(makeEmailData({ triaged: true }) as any);

        const untriaged = await repo.findUntriaged('test-user');
        expect(untriaged).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findAll()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.findAll()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns all emails with no filters', async () => {
        await repo.create(makeEmailData() as any);
        await repo.create(makeEmailData() as any);
        await repo.create(makeEmailData() as any);

        const all = await repo.findAll();
        expect(all).toHaveLength(3);
    });

    it('filters by triaged=true', async () => {
        await repo.create(makeEmailData({ triaged: true  }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: true  }) as any);

        const triaged = await repo.findAll({ triaged: true });
        expect(triaged).toHaveLength(2);
        expect(triaged.every(e => e.triaged === true)).toBe(true);
    });

    it('filters by triaged=false', async () => {
        await repo.create(makeEmailData({ triaged: true  }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);

        const untriaged = await repo.findAll({ triaged: false });
        expect(untriaged).toHaveLength(1);
        expect(untriaged[0].triaged).toBe(false);
    });

    it('filters by sender_email', async () => {
        await repo.create(makeEmailData({ sender_email: 'alice@example.com' }) as any);
        await repo.create(makeEmailData({ sender_email: 'alice@example.com' }) as any);
        await repo.create(makeEmailData({ sender_email: 'bob@example.com'   }) as any);

        const aliceEmails = await repo.findAll({ sender_email: 'alice@example.com' });
        expect(aliceEmails).toHaveLength(2);
        expect(aliceEmails.every(e => e.sender_email === 'alice@example.com')).toBe(true);
    });

    it('returns emails ordered by received_at descending', async () => {
        await repo.create(makeEmailData({ received_at: '2024-06-01T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ received_at: '2024-06-03T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ received_at: '2024-06-02T09:00:00.000Z' }) as any);

        const all = await repo.findAll();
        expect(all[0].received_at).toBe('2024-06-03T09:00:00.000Z');
        expect(all[2].received_at).toBe('2024-06-01T09:00:00.000Z');
    });

    it('respects limit', async () => {
        await repo.create(makeEmailData() as any);
        await repo.create(makeEmailData() as any);
        await repo.create(makeEmailData() as any);
        await repo.create(makeEmailData() as any);

        const limited = await repo.findAll({ limit: 2 });
        expect(limited).toHaveLength(2);
    });

    it('respects offset for pagination', async () => {
        await repo.create(makeEmailData({ received_at: '2024-06-01T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ received_at: '2024-06-02T09:00:00.000Z' }) as any);
        await repo.create(makeEmailData({ received_at: '2024-06-03T09:00:00.000Z' }) as any);

        const page1 = await repo.findAll({ limit: 2, offset: 0 });
        const page2 = await repo.findAll({ limit: 2, offset: 2 });

        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(1);
        expect(page1[0].received_at).not.toBe(page2[0].received_at);
    });

    it('returns empty array when no emails exist', async () => {
        const all = await repo.findAll();
        expect(all).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// update()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.update()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('updates body_summary', async () => {
        const data = makeEmailData();
        await repo.create(data as any);

        const updated = await repo.update(data.id, 'test-user', { body_summary: 'AI-generated summary' });
        expect(updated!.body_summary).toBe('AI-generated summary');
    });

    it('updates labels', async () => {
        const data = makeEmailData();
        await repo.create(data as any);

        const updated = await repo.update(data.id, 'test-user', { labels: JSON.stringify(['action_required']) });
        expect(updated!.labels).toBe('["action_required"]');
    });

    it('marks as triaged', async () => {
        const data = makeEmailData({ triaged: false });
        await repo.create(data as any);

        const updated = await repo.update(data.id, 'test-user', { triaged: true });
        expect(updated!.triaged).toBe(true);
    });

    it('updates updated_at timestamp', async () => {
        const data = makeEmailData();
        await repo.create(data as any);

        const before = await repo.findById(data.id, 'test-user');
        await new Promise(r => setTimeout(r, 10));
        await repo.update(data.id, 'test-user', { triaged: true });
        const after = await repo.findById(data.id, 'test-user');

        expect(after!.updated_at).not.toBe(before!.updated_at);
    });

    it('returns null for a non-existent id', async () => {
        const result = await repo.update('non_existent', 'test-user', { triaged: true });
        expect(result).toBeNull();
    });

    it('does not affect other emails', async () => {
        const data1 = makeEmailData();
        const data2 = makeEmailData();
        await repo.create(data1 as any);
        await repo.create(data2 as any);

        await repo.update(data1.id, 'test-user', { triaged: true });

        const email2 = await repo.findById(data2.id, 'test-user');
        expect(email2!.triaged).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.delete()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('deletes the email and returns it', async () => {
        const data    = makeEmailData();
        await repo.create(data as any);
        const deleted = await repo.delete(data.id, 'test-user');
        expect(deleted!.id).toBe(data.id);
    });

    it('email is no longer findable after deletion', async () => {
        const data = makeEmailData();
        await repo.create(data as any);
        await repo.delete(data.id, 'test-user');
        const found = await repo.findById(data.id, 'test-user');
        expect(found).toBeNull();
    });

    it('returns null for a non-existent id', async () => {
        const result = await repo.delete('non_existent', 'test-user');
        expect(result).toBeNull();
    });

    it('does not delete other emails', async () => {
        const data1 = makeEmailData();
        const data2 = makeEmailData();
        await repo.create(data1 as any);
        await repo.create(data2 as any);

        await repo.delete(data1.id, 'test-user');

        const found = await repo.findById(data2.id, 'test-user');
        expect(found).not.toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countUntriaged()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailRepository.countUntriaged()', () => {
    let repo: ReturnType<typeof createEmailRepository>;
    beforeEach(() => { counter = 0; repo = createEmailRepository(createTestDb() as any); });

    it('returns 0 when there are no emails', async () => {
        expect(await repo.countUntriaged('test-user')).toBe(0);
    });

    it('counts only untriaged emails', async () => {
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: false }) as any);
        await repo.create(makeEmailData({ triaged: true  }) as any);

        expect(await repo.countUntriaged('test-user')).toBe(2);
    });

    it('returns 0 when all emails are triaged', async () => {
        await repo.create(makeEmailData({ triaged: true }) as any);
        await repo.create(makeEmailData({ triaged: true }) as any);

        expect(await repo.countUntriaged('test-user')).toBe(0);
    });

    it('decrements when an email is marked triaged', async () => {
        const data = makeEmailData({ triaged: false });
        await repo.create(data as any);

        expect(await repo.countUntriaged('test-user')).toBe(1);
        await repo.update(data.id, 'test-user', { triaged: true });
        expect(await repo.countUntriaged('test-user')).toBe(0);
    });
});