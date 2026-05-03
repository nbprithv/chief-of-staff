import type { FastifyInstance } from 'fastify';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { listJobs } from '../../domains/background-jobs/background-jobs.service.js';
import { runJob } from '../../domains/background-jobs/background-jobs.runner.js';

export async function cronRouter(app: FastifyInstance) {
    app.addHook('preHandler', async (req, reply) => {
        if (config.NODE_ENV === 'production') {
            const auth = req.headers['authorization'];
            if (!config.CRON_SECRET || auth !== `Bearer ${config.CRON_SECRET}`) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
        }
    });

    app.get('/api/cron/school-email-digest', async (_req, reply) => {
        const userId = config.CRON_USER_ID;
        if (!userId) {
            logger.error('Cron: CRON_USER_ID not configured');
            return reply.status(500).send({ error: 'CRON_USER_ID not configured' });
        }

        const jobs = await listJobs(userId);
        const job  = jobs.find(j => j.skill_id === 'school_email_digest');

        if (!job) {
            logger.warn('Cron: school_email_digest job not found in DB', { userId });
            return reply.status(404).send({ error: 'School Email Digest job not found — create it in the Jobs UI first' });
        }

        if (!job.enabled) {
            logger.info('Cron: school_email_digest job is disabled, skipping', { jobId: job.id });
            return reply.send({ ok: true, skipped: true, reason: 'job disabled' });
        }

        const result = await runJob(job);
        logger.info('Cron: school-email-digest complete', { jobId: job.id, ...result });
        return reply.send({ ok: true, result });
    });

    app.get('/api/cron/weeknight-meal-planner', async (_req, reply) => {
        const userId = config.CRON_USER_ID;
        if (!userId) {
            logger.error('Cron: CRON_USER_ID not configured');
            return reply.status(500).send({ error: 'CRON_USER_ID not configured' });
        }

        const jobs = await listJobs(userId);
        const job  = jobs.find(j => j.skill_id === 'weeknight_meal_planner');

        if (!job) {
            logger.warn('Cron: weeknight_meal_planner job not found in DB', { userId });
            return reply.status(404).send({ error: 'Weeknight Meal Planner job not found — create it in the Jobs UI first' });
        }

        if (!job.enabled) {
            logger.info('Cron: weeknight_meal_planner job is disabled, skipping', { jobId: job.id });
            return reply.send({ ok: true, skipped: true, reason: 'job disabled' });
        }

        const result = await runJob(job);
        logger.info('Cron: weeknight-meal-planner complete', { jobId: job.id, ...result });
        return reply.send({ ok: true, result });
    });
}
