import cron from 'node-cron';
import { logger } from '../../core/logger.js';
import { db } from '../../db/client.js';
import { backgroundJobs } from '../../db/schema/background_jobs.schema.js';
import { eq } from 'drizzle-orm';
import { runJob } from './background-jobs.runner.js';

// Map of jobId → cron task, so we can cancel/replace when jobs are updated
const activeTasks = new Map<string, cron.ScheduledTask>();

function scheduleJob(job: typeof backgroundJobs.$inferSelect): void {
    if (!cron.validate(job.schedule)) {
        logger.warn('Invalid cron expression — skipping job', { jobId: job.id, schedule: job.schedule });
        return;
    }

    const existing = activeTasks.get(job.id);
    if (existing) existing.stop();

    const task = cron.schedule(job.schedule, async () => {
        logger.info('Cron fired', { jobId: job.id, name: job.name });
        await runJob(job);
    }, { timezone: 'America/New_York' });   // TODO: make timezone configurable per-job

    activeTasks.set(job.id, task);
    logger.info('Job scheduled', { jobId: job.id, name: job.name, schedule: job.schedule });
}

/** Load all enabled jobs from the DB and register their cron tasks. */
export async function startScheduler(): Promise<void> {
    const jobs = await db
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.enabled, true));

    for (const job of jobs) {
        scheduleJob(job);
    }

    logger.info('Job scheduler started', { count: jobs.length });
}

/** Re-register a single job (call after create/update). */
export async function syncJob(jobId: string): Promise<void> {
    const rows = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, jobId));
    const job  = rows[0];
    if (!job) return;

    if (!job.enabled) {
        unscheduleJob(jobId);
        return;
    }

    scheduleJob(job);
}

/** Remove a job's cron task (call after delete or disable). */
export function unscheduleJob(jobId: string): void {
    const task = activeTasks.get(jobId);
    if (task) {
        task.stop();
        activeTasks.delete(jobId);
        logger.info('Job unscheduled', { jobId });
    }
}
