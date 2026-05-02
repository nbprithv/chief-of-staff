import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * background_jobs — user-defined scheduled Claude AI tasks
 *
 * schedule is a standard cron expression (5-field): "MM HH * * DOW"
 * e.g. "0 8 * * *"  → daily at 08:00
 *      "0 8 * * 1"  → every Monday at 08:00
 *      "0 * * * *"  → every hour
 *
 * skill_id is a well-known template slug (e.g. "daily_brief") or "custom"
 * prompt   is the full user message sent to Claude
 */
export const backgroundJobs = sqliteTable('background_jobs', {
    id:                 text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    user_id:            text('user_id').notNull().default(''),

    name:               text('name').notNull(),
    description:        text('description'),
    skill_id:           text('skill_id').notNull().default('custom'),  // slug or "custom"
    prompt:             text('prompt').notNull(),

    // Cron schedule (5-field)
    schedule:           text('schedule').notNull(),                    // e.g. "0 8 * * *"
    enabled:            integer('enabled', { mode: 'boolean' }).notNull().default(true),

    // Token cap per single run (guards against runaway prompts)
    max_tokens_per_run: integer('max_tokens_per_run').notNull().default(500),

    last_run_at:        text('last_run_at'),
    next_run_at:        text('next_run_at'),

    created_at:         text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at:         text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type BackgroundJob    = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;
