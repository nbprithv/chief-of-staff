import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailService as defaultService } from './email.service.js';
import { CreateEmailSchema, UpdateEmailSchema } from '../types.js';
import { ValidationError } from '../../core/errors.js';
import type { EmailService } from './email.service.js';

export function createEmailRouter(service: EmailService = defaultService) {
    return async function emailRouter(app: FastifyInstance) {

        // ── GET /emails ───────────────────────────────────────────────────────────
        app.get('/emails', async (req, reply) => {
            const q = req.query as Record<string, string>;
            const emails = await service.list({
                triaged:      q.triaged !== undefined ? q.triaged === 'true' : undefined,
                sender_email: q.sender_email,
                label:        q.label,
                limit:        q.limit  ? parseInt(q.limit)  : undefined,
                offset:       q.offset ? parseInt(q.offset) : undefined,
            });
            return reply.send({ emails });
        });

        // ── GET /emails/untriaged ─────────────────────────────────────────────────
        app.get('/emails/untriaged', async (req, reply) => {
            const { limit } = req.query as { limit?: string };
            const emails = await service.listUntriaged(limit ? parseInt(limit) : undefined);
            const count  = await service.countUntriaged();
            return reply.send({ emails, count });
        });

        // ── GET /emails/thread/:thread_id ─────────────────────────────────────────
        app.get('/emails/thread/:thread_id', async (req, reply) => {
            const { thread_id } = req.params as { thread_id: string };
            const emails = await service.getThread(thread_id);
            return reply.send({ emails });
        });

        // ── GET /emails/:id ───────────────────────────────────────────────────────
        app.get('/emails/:id', async (req, reply) => {
            const { id } = req.params as { id: string };
            const email = await service.getById(id);
            return reply.send({ email });
        });

        // ── POST /emails/ingest ───────────────────────────────────────────────────
        app.post('/emails/ingest', async (req, reply) => {
            const parsed = CreateEmailSchema.safeParse(req.body);
            if (!parsed.success) throw new ValidationError('Invalid email data', parsed.error.flatten());

            const { email, isDuplicate } = await service.ingest(parsed.data);
            return reply
                .status(isDuplicate ? 200 : 201)
                .send({ email, isDuplicate });
        });

        // ── POST /emails/:id/analyze ──────────────────────────────────────────────
        // Runs a single email through Claude and persists the summary to body_summary.
        app.post('/emails/:id/analyze', async (req, reply) => {
            const { id } = req.params as { id: string };
            const { email, analysis } = await service.analyze(id);
            return reply.send({ email, analysis });
        });

        // ── POST /emails/analyze/batch ────────────────────────────────────────────
        // Analyzes multiple emails. Returns a combined batch summary plus per-email
        // analysis. Persists individual summaries to each email's body_summary.
        app.post('/emails/analyze/batch', async (req, reply) => {
            const schema = z.object({
                ids: z.array(z.string()).min(1).max(20),
            });
            const parsed = schema.safeParse(req.body);
            if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());

            const result = await service.analyzeBatch(parsed.data.ids);
            return reply.send(result);
        });

        // ── PATCH /emails/:id ─────────────────────────────────────────────────────
        app.patch('/emails/:id', async (req, reply) => {
            const { id } = req.params as { id: string };
            const parsed = UpdateEmailSchema.safeParse(req.body);
            if (!parsed.success) throw new ValidationError('Invalid email data', parsed.error.flatten());

            const email = await service.update(id, parsed.data);
            return reply.send({ email });
        });

        // ── POST /emails/:id/triage ───────────────────────────────────────────────
        app.post('/emails/:id/triage', async (req, reply) => {
            const { id } = req.params as { id: string };
            const email = await service.markTriaged(id);
            return reply.send({ email });
        });

        // ── DELETE /emails/:id ────────────────────────────────────────────────────
        app.delete('/emails/:id', async (req, reply) => {
            const { id } = req.params as { id: string };
            await service.delete(id);
            return reply.status(204).send();
        });
    };
}

// Default export for use in app.ts
export const emailRouter = createEmailRouter();