import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import { getUserId } from '../../core/session.js';
import { ValidationError, NotFoundError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import {
    listJobs, getJob, createJob, updateJob, deleteJob,
    listRuns, hasBudgetRemaining,
} from './background-jobs.service.js';
import { runJob } from './background-jobs.runner.js';
import { syncJob, unscheduleJob } from './job-scheduler.js';
import { SKILL_TEMPLATES } from './skill-templates.js';

export async function backgroundJobsRouter(app: FastifyInstance): Promise<void> {

    // ── Log every request into this router ────────────────────────────────────
    app.addHook('onRequest', async (req) => {
        logger.info('[jobs] incoming request', { method: req.method, url: req.url });
    });

    // ── Auth gate on all routes ───────────────────────────────────────────────
    app.addHook('preHandler', async (req, reply) => {
        const userId = getUserId(req);
        if (!userId) {
            logger.error('[jobs] unauthenticated request rejected', { method: req.method, url: req.url });
            return reply.status(401).send({ error: 'Not authenticated' });
        }
    });

    // ── GET /jobs/templates ────────────────────────────────────────────────────
    app.get('/jobs/templates', async (_req, reply) => {
        return reply.send({ templates: SKILL_TEMPLATES });
    });

    // ── GET /jobs/budget ───────────────────────────────────────────────────────
    app.get('/jobs/budget', async (req, reply) => {
        const userId = getUserId(req)!;
        try {
            const budget = await hasBudgetRemaining(userId);
            logger.info('[jobs/budget]', budget);
            return reply.send(budget);
        } catch (err: any) {
            logger.error('[jobs/budget] failed to fetch budget', { error: err?.message, stack: err?.stack });
            throw err;
        }
    });

    // ── GET /jobs ──────────────────────────────────────────────────────────────
    app.get('/jobs', async (req, reply) => {
        const userId = getUserId(req)!;
        try {
            const jobs = await listJobs(userId);
            logger.info('[jobs/list] fetched jobs', { count: jobs.length });
            return reply.send({ jobs });
        } catch (err: any) {
            logger.error('[jobs/list] DB error listing jobs', { error: err?.message, stack: err?.stack });
            throw err;
        }
    });

    // ── POST /jobs ─────────────────────────────────────────────────────────────
    app.post('/jobs', async (req, reply) => {
        const userId = getUserId(req)!;
        const body   = req.body as Record<string, unknown>;

        logger.info('[jobs/create] body received', {
            bodyKeys:       Object.keys(body ?? {}),
            hasName:        !!body?.name,
            nameType:       typeof body?.name,
            hasPrompt:      !!body?.prompt,
            promptType:     typeof body?.prompt,
            hasSchedule:    !!body?.schedule,
            scheduleValue:  body?.schedule,
            maxTokens:      body?.max_tokens_per_run,
            enabled:        body?.enabled,
        });

        if (!body.name || typeof body.name !== 'string') {
            logger.error('[jobs/create] validation failed: name', { name: body.name, type: typeof body.name });
            throw new ValidationError('name is required');
        }
        if (!body.prompt || typeof body.prompt !== 'string') {
            logger.error('[jobs/create] validation failed: prompt', { prompt: typeof body.prompt });
            throw new ValidationError('prompt is required');
        }
        if (!body.schedule || typeof body.schedule !== 'string') {
            logger.error('[jobs/create] validation failed: schedule missing', { schedule: body.schedule });
            throw new ValidationError('schedule is required');
        }
        if (!cron.validate(body.schedule as string)) {
            logger.error('[jobs/create] validation failed: bad cron', { schedule: body.schedule });
            throw new ValidationError(`Invalid cron expression: ${body.schedule}`);
        }

        try {
            const job = await createJob({
                user_id:            userId,
                name:               body.name as string,
                description:        (body.description as string | undefined) ?? null,
                skill_id:           (body.skill_id    as string | undefined) ?? 'custom',
                prompt:             body.prompt as string,
                schedule:           body.schedule as string,
                enabled:            body.enabled !== false,
                max_tokens_per_run: typeof body.max_tokens_per_run === 'number' ? body.max_tokens_per_run : 500,
            });
            logger.info('[jobs/create] job created', { jobId: job.id, name: job.name });
            await syncJob(job.id);
            return reply.status(201).send({ job });
        } catch (err: any) {
            logger.error('[jobs/create] DB error creating job', { error: err?.message, stack: err?.stack });
            throw err;
        }
    });

    // ── GET /jobs/:id ──────────────────────────────────────────────────────────
    app.get('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        logger.info('[jobs/get]', { jobId: id });
        try {
            const job = await getJob(id, userId);
            if (!job) throw new NotFoundError('Job', id);
            return reply.send({ job });
        } catch (err: any) {
            if (!(err instanceof NotFoundError)) {
                logger.error('[jobs/get] DB error', { jobId: id, error: err?.message, stack: err?.stack });
            }
            throw err;
        }
    });

    // ── PATCH /jobs/:id ────────────────────────────────────────────────────────
    app.patch('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const body   = req.body as Record<string, unknown>;

        logger.info('[jobs/update] patch received', { jobId: id, bodyKeys: Object.keys(body ?? {}) });

        if (body.schedule && !cron.validate(body.schedule as string)) {
            logger.error('[jobs/update] validation failed: bad cron', { jobId: id, schedule: body.schedule });
            throw new ValidationError(`Invalid cron expression: ${body.schedule}`);
        }

        try {
            const job = await updateJob(id, userId, {
                name:               body.name               as string | undefined,
                description:        body.description        as string | undefined,
                skill_id:           body.skill_id           as string | undefined,
                prompt:             body.prompt             as string | undefined,
                schedule:           body.schedule           as string | undefined,
                enabled:            body.enabled            as boolean | undefined,
                max_tokens_per_run: body.max_tokens_per_run as number | undefined,
            });

            if (!job) throw new NotFoundError('Job', id);

            logger.info('[jobs/update] job updated', { jobId: id });
            await syncJob(id);
            return reply.send({ job });
        } catch (err: any) {
            if (!(err instanceof NotFoundError)) {
                logger.error('[jobs/update] DB error', { jobId: id, error: err?.message, stack: err?.stack });
            }
            throw err;
        }
    });

    // ── DELETE /jobs/:id ───────────────────────────────────────────────────────
    app.delete('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        logger.info('[jobs/delete]', { jobId: id });
        try {
            const existing = await getJob(id, userId);
            if (!existing) throw new NotFoundError('Job', id);
            unscheduleJob(id);
            await deleteJob(id, userId);
            logger.info('[jobs/delete] job deleted', { jobId: id });
            return reply.status(204).send();
        } catch (err: any) {
            if (!(err instanceof NotFoundError)) {
                logger.error('[jobs/delete] DB error', { jobId: id, error: err?.message, stack: err?.stack });
            }
            throw err;
        }
    });

    // ── GET /jobs/:id/runs ─────────────────────────────────────────────────────
    app.get('/jobs/:id/runs', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const q      = req.query as { limit?: string };
        logger.info('[jobs/runs] fetching runs', { jobId: id, limit: q.limit });
        try {
            const runs = await listRuns(id, userId, q.limit ? parseInt(q.limit) : 20);
            logger.info('[jobs/runs] fetched', { jobId: id, count: runs.length });
            return reply.send({ runs });
        } catch (err: any) {
            logger.error('[jobs/runs] DB error', { jobId: id, error: err?.message, stack: err?.stack });
            throw err;
        }
    });

    // ── POST /jobs/:id/run ─────────────────────────────────────────────────────
    app.post('/jobs/:id/run', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };

        logger.info('[jobs/run] manual trigger received', { jobId: id, userId });

        let job;
        try {
            job = await getJob(id, userId);
        } catch (err: any) {
            logger.error('[jobs/run] DB error loading job', { jobId: id, error: err?.message, stack: err?.stack });
            throw err;
        }

        if (!job) {
            logger.error('[jobs/run] job not found', { jobId: id, userId });
            throw new NotFoundError('Job', id);
        }

        logger.info('[jobs/run] job loaded', {
            jobId:     job.id,
            name:      job.name,
            schedule:  job.schedule,
            enabled:   job.enabled,
            maxTokens: job.max_tokens_per_run,
        });

        const result = await runJob(job);

        logger.info('[jobs/run] run finished', { jobId: id, status: result.status, error: result.error });
        return reply.send(result);
    });
}
