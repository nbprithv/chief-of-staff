import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gmailSyncService as defaultService } from './gmail-sync.service.js';
import { ValidationError } from '../../core/errors.js';
import type { GmailSyncService } from './gmail-sync.service.js';

export function createGmailSyncRouter(service: GmailSyncService = defaultService) {
    return async function gmailSyncRouter(app: FastifyInstance) {

        // ── POST /integrations/google/sync ──────────────────────────────────────
        app.post('/integrations/google/sync', async (req, reply) => {
            const schema = z.object({
                label:      z.string().default('INBOX'),
                max_emails: z.number().int().positive().max(100).default(50),
            });
            const parsed = schema.safeParse(req.body ?? {});
            if (!parsed.success) throw new ValidationError('Invalid sync options', parsed.error.flatten());

            const result = await service.sync({
                label:     parsed.data.label,
                maxEmails: parsed.data.max_emails,
            });

            return reply.send({ result });
        });

        // ── GET /integrations/google/labels ─────────────────────────────────────
        app.get('/integrations/google/labels', async (_req, reply) => {
            const labels = await service.listLabels();
            return reply.send({ labels });
        });
    };
}

// Default export for app.ts
export const gmailSyncRouter = createGmailSyncRouter();