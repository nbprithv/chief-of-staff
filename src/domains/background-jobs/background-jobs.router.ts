import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import { getUserId } from '../../core/session.js';
import { ValidationError, NotFoundError } from '../../core/errors.js';
import {
    listJobs, getJob, createJob, updateJob, deleteJob,
    listRuns, hasBudgetRemaining,
} from './background-jobs.service.js';
import { runJob } from './background-jobs.runner.js';
import { syncJob, unscheduleJob } from './job-scheduler.js';
import { SKILL_TEMPLATES } from './skill-templates.js';

export async function backgroundJobsRouter(app: FastifyInstance): Promise<void> {

    // Auth gate on all routes
    app.addHook('preHandler', async (req, reply) => {
        if (!getUserId(req)) return reply.status(401).send({ error: 'Not authenticated' });
    });

    // ── GET /jobs/templates ────────────────────────────────────────────────────
    app.get('/jobs/templates', async (_req, reply) => {
        return reply.send({ templates: SKILL_TEMPLATES });
    });

    // ── GET /jobs/budget ───────────────────────────────────────────────────────
    app.get('/jobs/budget', async (req, reply) => {
        const userId = getUserId(req)!;
        const budget = await hasBudgetRemaining(userId);
        return reply.send(budget);
    });

    // ── GET /jobs ──────────────────────────────────────────────────────────────
    app.get('/jobs', async (req, reply) => {
        const userId = getUserId(req)!;
        const jobs   = await listJobs(userId);
        return reply.send({ jobs });
    });

    // ── POST /jobs ─────────────────────────────────────────────────────────────
    app.post('/jobs', async (req, reply) => {
        const userId = getUserId(req)!;
        const body   = req.body as Record<string, unknown>;

        if (!body.name || typeof body.name !== 'string') {
            throw new ValidationError('name is required');
        }
        if (!body.prompt || typeof body.prompt !== 'string') {
            throw new ValidationError('prompt is required');
        }
        if (!body.schedule || typeof body.schedule !== 'string') {
            throw new ValidationError('schedule is required');
        }
        if (!cron.validate(body.schedule as string)) {
            throw new ValidationError(`Invalid cron expression: ${body.schedule}`);
        }

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

        await syncJob(job.id);
        return reply.status(201).send({ job });
    });

    // ── GET /jobs/:id ──────────────────────────────────────────────────────────
    app.get('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const job = await getJob(id, userId);
        if (!job) throw new NotFoundError('Job', id);
        return reply.send({ job });
    });

    // ── PATCH /jobs/:id ────────────────────────────────────────────────────────
    app.patch('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const body   = req.body as Record<string, unknown>;

        if (body.schedule && !cron.validate(body.schedule as string)) {
            throw new ValidationError(`Invalid cron expression: ${body.schedule}`);
        }

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

        await syncJob(id);
        return reply.send({ job });
    });

    // ── DELETE /jobs/:id ───────────────────────────────────────────────────────
    app.delete('/jobs/:id', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const existing = await getJob(id, userId);
        if (!existing) throw new NotFoundError('Job', id);

        unscheduleJob(id);
        await deleteJob(id, userId);
        return reply.status(204).send();
    });

    // ── GET /jobs/:id/runs ─────────────────────────────────────────────────────
    app.get('/jobs/:id/runs', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const q      = req.query as { limit?: string };
        const runs   = await listRuns(id, userId, q.limit ? parseInt(q.limit) : 20);
        return reply.send({ runs });
    });

    // ── POST /jobs/:id/run ─────────────────────────────────────────────────────
    // Trigger an immediate manual run
    app.post('/jobs/:id/run', async (req, reply) => {
        const userId = getUserId(req)!;
        const { id } = req.params as { id: string };
        const job = await getJob(id, userId);
        if (!job) throw new NotFoundError('Job', id);

        const result = await runJob(job);
        return reply.send(result);
    });
}
