import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nodes } from './nodes.schema.js';
import { emails } from './emails.schema.js';

/**
 * Link types:
 *   generated_from  — email caused this node to be created (e.g. task extracted from email)
 *   referenced_in   — email mentions this node but didn't create it
 *   follow_up_for   — node is a follow-up waiting on a reply to this email
 */
export const nodeEmailLinks = sqliteTable('node_email_links', {
  id:        text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  node_id:   text('node_id').notNull().references(() => nodes.id,   { onDelete: 'cascade' }),
  email_id:  text('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
  link_type: text('link_type', {
               enum: ['generated_from', 'referenced_in', 'follow_up_for'],
             }).notNull().default('generated_from'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type NodeEmailLink    = typeof nodeEmailLinks.$inferSelect;
export type NewNodeEmailLink = typeof nodeEmailLinks.$inferInsert;
