import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calendarSyncService as defaultService } from './calendar-sync.service.js';
import { ValidationError } from '../../core/errors.js';
import type { CalendarSyncService } from './calendar-sync.service.js';

export function createCalendarSyncRouter(service: CalendarSyncService = defaultService) {
    return async function calendarSyncRouter(app: FastifyInstance) {

        // ── POST /integrations/google/calendars/sync ──────────────────────────────
        app.post('/integrations/google/calendars/sync', async (req, reply) => {
            const schema = z.object({
                calendar_id: z.string().optional(),
                time_min:    z.string().optional(),
                time_max:    z.string().optional(),
                max_results: z.number().int().positive().max(250).default(50),
            });
            const parsed = schema.safeParse(req.body ?? {});
            if (!parsed.success) throw new ValidationError('Invalid sync options', parsed.error.flatten());

            const result = await service.sync({
                calendarId:  parsed.data.calendar_id,
                timeMin:     parsed.data.time_min,
                timeMax:     parsed.data.time_max,
                maxResults:  parsed.data.max_results,
            });

            return reply.send({ result });
        });

        // ── GET /integrations/google/calendars ────────────────────────────────────
        app.get('/integrations/google/calendars', async (_req, reply) => {
            const calendars = await service.listCalendars();
            return reply.send({ calendars });
        });
    };
}

// Default export for app.ts
export const calendarSyncRouter = createCalendarSyncRouter();
