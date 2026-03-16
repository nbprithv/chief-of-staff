import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nodes } from './nodes.schema.js';

export const habitLogs = sqliteTable('habit_logs', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  node_id:   text('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  status:    text('status', {
               enum: ['done', 'skipped', 'missed'],
             }).notNull(),
  log_date:  text('log_date').notNull(),   // YYYY-MM-DD
  notes:     text('notes'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type HabitLog    = typeof habitLogs.$inferSelect;
export type NewHabitLog = typeof habitLogs.$inferInsert;
