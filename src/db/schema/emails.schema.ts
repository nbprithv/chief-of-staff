import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';

export const emails = sqliteTable('emails', {
  id:           text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  gmail_id:     text('gmail_id').notNull().unique(),
  thread_id:    text('thread_id'),

  // SHA-256 of (gmail_id | sender_email | received_at | subject | body_raw).
  // UNIQUE constraint prevents processing the same email twice.
  content_hash: text('content_hash').notNull().unique(),

  subject:      text('subject').notNull(),
  sender_email: text('sender_email').notNull(),
  sender_name:  text('sender_name'),
  recipients:   text('recipients').notNull().default('[]'),  // JSON string[]
  body_summary: text('body_summary'),
  body_raw:     text('body_raw'),
  labels:       text('labels').notNull().default('["inbox"]'), // JSON string[]
  triaged:      integer('triaged', { mode: 'boolean' }).notNull().default(false),
  received_at:  text('received_at').notNull(),
  created_at:   text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at:   text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type Email    = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;

// ── Hash helper ───────────────────────────────────────────────────────────────

/**
 * Produces a stable 64-char hex hash for an incoming email.
 * Used to populate content_hash and check for duplicates before insert.
 */
export function hashEmail(fields: {
  gmail_id:     string;
  sender_email: string;
  received_at:  string;
  subject:      string;
  body_raw?:    string;
}): string {
  return createHash('sha256')
    .update([
      fields.gmail_id,
      fields.sender_email,
      fields.received_at,
      fields.subject,
      fields.body_raw ?? '',
    ].join('|'))
    .digest('hex')
    .slice(0, 64);
}
