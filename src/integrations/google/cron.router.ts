import type { FastifyInstance } from 'fastify';
import { gmailSyncService } from './gmail-sync.service.js';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';

const SCHOOL_DIGEST_QUERY = '(in:sent OR in:drafts) subject:"Galloway School Digest"';

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

        const result = await gmailSyncService.sync(
            { query: SCHOOL_DIGEST_QUERY, maxEmails: 50 },
            userId,
        );

        logger.info('Cron: school-email-digest complete', { ...result, userId });
        return reply.send({ ok: true, result });
    });
}
