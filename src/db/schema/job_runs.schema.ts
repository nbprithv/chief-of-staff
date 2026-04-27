import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * job_runs — one row per background job execution
 *
 * Tracks token usage so we can enforce the monthly $20 budget.
 * Cost formula (Claude Sonnet): (input * 3 + output * 15) / 1_000_000
 */
export const jobRuns = sqliteTable('job_runs', {
    id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    job_id:        text('job_id').notNull(),
    user_id:       text('user_id').notNull().default(''),

    status:        text('status', {
                     enum: ['running', 'success', 'error', 'skipped'],
                   }).notNull().default('running'),

    input_tokens:  integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),

    // Pre-computed: (input * 3 + output * 15) / 1_000_000
    cost_usd:      real('cost_usd').notNull().default(0),

    output:        text('output'),    // Claude's response text
    error:         text('error'),     // error message if status=error

    started_at:    text('started_at').notNull().default(sql`(datetime('now'))`),
    completed_at:  text('completed_at'),

    created_at:    text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type JobRun    = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
