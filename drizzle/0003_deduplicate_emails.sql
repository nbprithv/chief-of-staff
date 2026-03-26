-- Remove duplicate emails, keeping the earliest-inserted copy
-- (lowest rowid) per user + sender + subject + calendar day.
-- Forwarded copies of the same digest arrive with different gmail_ids
-- but share the same sender, subject and send date.
DELETE FROM emails WHERE rowid NOT IN (
    SELECT MIN(rowid) FROM emails
    GROUP BY user_id, sender_email, subject, substr(received_at, 1, 10)
);
--> statement-breakpoint
-- Unique index prevents future duplicates at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_dedup
ON emails (user_id, sender_email, subject, substr(received_at, 1, 10));
