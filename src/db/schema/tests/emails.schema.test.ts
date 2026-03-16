import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { emails, hashEmail } from '../emails.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test DB setup — in-memory SQLite, rebuilt for each test suite
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Minimal inline table creation — avoids needing migration files in tests
  sqlite.exec(`
    CREATE TABLE emails (
      id           TEXT PRIMARY KEY,
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

const BASE_EMAIL = {
  gmail_id:     'msg_abc123',
  sender_email: 'alice@example.com',
  sender_name:  'Alice',
  received_at:  '2024-06-01T09:00:00.000Z',
  subject:      'Project update',
  body_raw:     'Here is the latest update on the project.',
};

function makeEmail(overrides: Partial<typeof BASE_EMAIL> = {}) {
  const fields = { ...BASE_EMAIL, ...overrides };
  return {
    id:           crypto.randomUUID(),
    gmail_id:     fields.gmail_id,
    sender_email: fields.sender_email,
    sender_name:  fields.sender_name,
    received_at:  fields.received_at,
    subject:      fields.subject,
    body_raw:     fields.body_raw,
    content_hash: hashEmail(fields),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// hashEmail()
// ─────────────────────────────────────────────────────────────────────────────

describe('hashEmail()', () => {

  it('returns a 64-character hex string', () => {
    const hash = hashEmail(BASE_EMAIL);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical inputs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL });
    expect(h1).toBe(h2);
  });

  it('produces different hashes when gmail_id differs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL, gmail_id: 'msg_different' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes when sender_email differs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL, sender_email: 'bob@example.com' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes when subject differs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL, subject: 'A different subject' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes when received_at differs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL, received_at: '2024-06-02T09:00:00.000Z' });
    expect(h1).not.toBe(h2);
  });

  it('produces different hashes when body_raw differs', () => {
    const h1 = hashEmail(BASE_EMAIL);
    const h2 = hashEmail({ ...BASE_EMAIL, body_raw: 'Completely different body.' });
    expect(h1).not.toBe(h2);
  });

  it('treats missing body_raw as empty string — consistent with no-body emails', () => {
    const withEmpty   = hashEmail({ ...BASE_EMAIL, body_raw: '' });
    const withMissing = hashEmail({ ...BASE_EMAIL, body_raw: undefined });
    expect(withEmpty).toBe(withMissing);
  });

  it('is sensitive to field ordering in the pipe-delimited string', () => {
    // Swapping gmail_id and sender_email values must produce a different hash
    const h1 = hashEmail({ ...BASE_EMAIL, gmail_id: 'A', sender_email: 'B' });
    const h2 = hashEmail({ ...BASE_EMAIL, gmail_id: 'B', sender_email: 'A' });
    expect(h1).not.toBe(h2);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Email schema — insert / read
// ─────────────────────────────────────────────────────────────────────────────

describe('emails table — insert and read', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => { db = createTestDb(); });

  it('inserts and retrieves an email', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const [found] = await db.select().from(emails).where(eq(emails.gmail_id, record.gmail_id));
    expect(found.gmail_id).toBe(record.gmail_id);
    expect(found.subject).toBe(BASE_EMAIL.subject);
    expect(found.sender_email).toBe(BASE_EMAIL.sender_email);
  });

  it('stores content_hash on the record', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(found.content_hash).toBe(record.content_hash);
    expect(found.content_hash).toHaveLength(64);
  });

  it('defaults triaged to false', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(found.triaged).toBe(false);
  });

  it('defaults labels to ["inbox"]', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(JSON.parse(found.labels)).toEqual(['inbox']);
  });

  it('defaults recipients to []', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(JSON.parse(found.recipients)).toEqual([]);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication via content_hash UNIQUE constraint
// ─────────────────────────────────────────────────────────────────────────────

describe('emails table — deduplication', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => { db = createTestDb(); });

  it('rejects a second insert with the same content_hash', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    // Same hash, different id — simulates re-processing the same email
    await expect(
      db.insert(emails).values({ ...record, id: crypto.randomUUID() })
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a second insert with the same gmail_id', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const duplicate = makeEmail({ gmail_id: BASE_EMAIL.gmail_id, subject: 'Different subject' });
    await expect(
      db.insert(emails).values(duplicate)
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('allows two emails with different gmail_ids and different hashes', async () => {
    const first  = makeEmail({ gmail_id: 'msg_001' });
    const second = makeEmail({ gmail_id: 'msg_002' });

    await db.insert(emails).values(first);
    await db.insert(emails).values(second);

    const all = await db.select().from(emails);
    expect(all).toHaveLength(2);
  });

  it('can detect a duplicate before inserting using content_hash lookup', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const hash = hashEmail(BASE_EMAIL);
    const [existing] = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.content_hash, hash));

    expect(existing).toBeDefined();
    expect(existing.id).toBe(record.id);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

describe('emails table — update', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => { db = createTestDb(); });

  it('marks an email as triaged', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    await db.update(emails).set({ triaged: true }).where(eq(emails.id, record.id));

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(found.triaged).toBe(true);
  });

  it('updates labels', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const newLabels = JSON.stringify(['action_required', 'follow_up']);
    await db.update(emails).set({ labels: newLabels }).where(eq(emails.id, record.id));

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(JSON.parse(found.labels)).toEqual(['action_required', 'follow_up']);
  });

  it('updates body_summary after AI processing', async () => {
    const record = makeEmail();
    await db.insert(emails).values(record);

    const summary = 'Alice is providing a project status update.';
    await db.update(emails).set({ body_summary: summary }).where(eq(emails.id, record.id));

    const [found] = await db.select().from(emails).where(eq(emails.id, record.id));
    expect(found.body_summary).toBe(summary);
  });

});