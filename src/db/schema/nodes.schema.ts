import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Node types and what fields they use:
 *
 * idea         — title, description, priority
 * project      — title, description, status, priority, due_at
 * todo         — title, description, status, priority, due_at, completed_at
 * event        — title, description, location, starts_at, ends_at
 * grocery_item — title, is_p0, quantity, unit, shelf_life_days, location (store)
 * habit        — title, description, metadata (frequency, target_time)
 *
 * parent_id builds the hierarchy:
 *   null          → top-level (idea, project, habit)
 *   project id    → child task, event, or grocery item
 *   task id       → subtask
 */

export const nodes = sqliteTable('nodes', {
  id:             text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  parent_id:      text('parent_id'),                    // self-ref FK — applied via index below
  type:           text('type', {
                    enum: ['idea', 'project', 'todo', 'event', 'grocery_item', 'habit'],
                  }).notNull(),
  title:          text('title').notNull(),
  description:    text('description'),
  status:         text('status', {
                    enum: ['inbox', 'active', 'todo', 'in_progress', 'done', 'cancelled', 'archived'],
                  }).notNull().default('inbox'),
  priority:       text('priority', {
                    enum: ['p0', 'p1', 'p2', 'p3'],
                  }).notNull().default('p2'),

  // ── Scheduling (events + tasks) ──────────────────────────────────────────
  starts_at:      text('starts_at'),                    // ISO 8601
  ends_at:        text('ends_at'),                      // ISO 8601
  due_at:         text('due_at'),                       // ISO 8601
  completed_at:   text('completed_at'),                 // ISO 8601

  // ── Location (events + grocery items) ────────────────────────────────────
  location:       text('location'),

  // ── Grocery fields ───────────────────────────────────────────────────────
  is_p0:          integer('is_p0', { mode: 'boolean' }).notNull().default(false),
  quantity:       real('quantity'),
  unit:           text('unit'),
  shelf_life_days: integer('shelf_life_days'),

  // ── Catch-all for type-specific data (JSON) ───────────────────────────────
  // Examples:
  //   habit     → { frequency: 'daily', target_time: '07:00' }
  //   event     → { attendees: [...], recurrence_rule: '...' }
  //   grocery   → { reorder_threshold: 2, typical_quantity: 4 }
  metadata:       text('metadata').notNull().default('{}'),

  created_at:     text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at:     text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type Node    = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;

// ── Typed metadata shapes (for use in services) ───────────────────────────────

export interface HabitMetadata {
  frequency:   'daily' | 'weekdays' | 'weekly' | 'custom';
  target_time?: string;    // HH:MM
}

export interface EventMetadata {
  attendees?:       Array<{ name?: string; email: string; response?: string }>;
  recurrence_rule?: string;
  all_day?:         boolean;
  gcal_id?:         string;
}

export interface GroceryMetadata {
  reorder_threshold?: number;
  typical_quantity?:  number;
}

export type NodeMetadata = HabitMetadata | EventMetadata | GroceryMetadata | Record<string, unknown>;
