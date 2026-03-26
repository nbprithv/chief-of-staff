import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Key-value store for persisted settings (e.g. Google OAuth tokens)
export const tokens = sqliteTable('tokens', {
    key:        text('key').primaryKey(),
    value:      text('value').notNull(),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type Token    = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
