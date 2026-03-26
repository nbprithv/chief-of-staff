CREATE TABLE `consumption_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`quantity_used` real NOT NULL,
	`notes` text,
	`logged_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`gmail_id` text NOT NULL,
	`thread_id` text,
	`content_hash` text NOT NULL,
	`subject` text NOT NULL,
	`sender_email` text NOT NULL,
	`sender_name` text,
	`recipients` text DEFAULT '[]' NOT NULL,
	`body_summary` text,
	`body_raw` text,
	`labels` text DEFAULT '["inbox"]' NOT NULL,
	`triaged` integer DEFAULT false NOT NULL,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`status` text NOT NULL,
	`log_date` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `node_email_links` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`email_id` text NOT NULL,
	`link_type` text DEFAULT 'generated_from' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`priority` text DEFAULT 'p2' NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`due_at` text,
	`completed_at` text,
	`location` text,
	`is_p0` integer DEFAULT false NOT NULL,
	`quantity` real,
	`unit` text,
	`shelf_life_days` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_gmail_id_unique` ON `emails` (`gmail_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `emails_content_hash_unique` ON `emails` (`content_hash`);