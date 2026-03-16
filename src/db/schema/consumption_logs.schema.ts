import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nodes } from './nodes.schema.js';

export const consumptionLogs = sqliteTable('consumption_logs', {
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  node_id:       text('node_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  quantity_used: real('quantity_used').notNull(),
  notes:         text('notes'),
  logged_at:     text('logged_at').notNull().default(sql`(datetime('now'))`),
});

export type ConsumptionLog    = typeof consumptionLogs.$inferSelect;
export type NewConsumptionLog = typeof consumptionLogs.$inferInsert;
