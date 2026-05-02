--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `background_jobs` (
    `id`                 text PRIMARY KEY NOT NULL,
    `user_id`            text NOT NULL DEFAULT '',
    `name`               text NOT NULL,
    `description`        text,
    `skill_id`           text NOT NULL DEFAULT 'custom',
    `prompt`             text NOT NULL,
    `schedule`           text NOT NULL,
    `enabled`            integer NOT NULL DEFAULT 1,
    `max_tokens_per_run` integer NOT NULL DEFAULT 500,
    `last_run_at`        text,
    `next_run_at`        text,
    `created_at`         text NOT NULL DEFAULT (datetime('now')),
    `updated_at`         text NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_runs` (
    `id`            text PRIMARY KEY NOT NULL,
    `job_id`        text NOT NULL,
    `user_id`       text NOT NULL DEFAULT '',
    `status`        text NOT NULL DEFAULT 'running',
    `input_tokens`  integer NOT NULL DEFAULT 0,
    `output_tokens` integer NOT NULL DEFAULT 0,
    `cost_usd`      real NOT NULL DEFAULT 0,
    `output`        text,
    `error`         text,
    `started_at`    text NOT NULL DEFAULT (datetime('now')),
    `completed_at`  text,
    `created_at`    text NOT NULL DEFAULT (datetime('now'))
);
