import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gmailSyncService as defaultService } from './gmail-sync.service.js';
import { ValidationError } from '../../core/errors.js';
import { config } from '../../core/config.js';
import { getUserId } from '../../core/session.js';
import type { GmailSyncService } from './gmail-sync.service.js';

export function createGmailSyncRouter(service: GmailSyncService = defaultService) {
    return async function gmailSyncRouter(app: FastifyInstance) {

        // ── POST /integrations/google/sync ──────────────────────────────────────
        app.post('/integrations/google/sync', async (req, reply) => {
            const userId = getUserId(req);
            if (!userId) return reply.status(401).send({ error: 'Not authenticated' });

            const schema = z.object({
                label:      z.string().default(config.GMAIL_LABEL),
                query:      z.string().optional(),
                max_emails: z.number().int().positive().max(100).default(50),
            });
            const parsed = schema.safeParse(req.body ?? {});
            if (!parsed.success) throw new ValidationError('Invalid sync options', parsed.error.flatten());

            const result = await service.sync({
                label:     parsed.data.label,
                query:     parsed.data.query,
                maxEmails: parsed.data.max_emails,
            }, userId);

            return reply.send({ result });
        });

        // ── GET /integrations/google/labels ─────────────────────────────────────
        app.get('/integrations/google/labels', async (req, reply) => {
            const userId = getUserId(req);
            if (!userId) return reply.status(401).send({ error: 'Not authenticated' });
            const labels = await service.listLabels(userId);
            return reply.send({ labels });
        });
    };
}

// Default export for app.ts
export const gmailSyncRouter = createGmailSyncRouter();
