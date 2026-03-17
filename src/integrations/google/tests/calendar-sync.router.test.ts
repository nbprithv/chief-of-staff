import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { createCalendarSyncRouter } from '../../../../src/integrations/google/calendar-sync.router.js';
import { errorHandler } from '../../../../src/core/middleware/error-handler.js';
import { ExternalServiceError } from '../../../../src/core/errors.js';
import type { CalendarSyncService } from '../../../../src/integrations/google/calendar-sync.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock service factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockService(): CalendarSyncService {
    return {
        listCalendars: vi.fn(),
        fetchEvents:   vi.fn(),
        findByGcalId:  vi.fn(),
        sync:          vi.fn(),
    };
}

async function buildApp(service: CalendarSyncService) {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(createCalendarSyncRouter(service));
    return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /integrations/google/calendars/sync
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /integrations/google/calendars/sync', () => {
    let service: CalendarSyncService;
    beforeEach(() => { service = createMockService(); vi.clearAllMocks(); });

    it('returns 200 with sync result', async () => {
        const syncResult = { fetched: 10, stored: 8, duplicates: 2, errors: 0 };
        vi.mocked(service.sync).mockResolvedValue(syncResult);

        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: { max_results: 10 },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().result).toEqual(syncResult);
    });

    it('passes calendar_id, time_min, time_max, and max_results to service.sync', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: {
                calendar_id: 'work@example.com',
                time_min:    '2024-01-01T00:00:00Z',
                time_max:    '2024-12-31T23:59:59Z',
                max_results: 100,
            },
        });

        expect(service.sync).toHaveBeenCalledWith({
            calendarId:  'work@example.com',
            timeMin:     '2024-01-01T00:00:00Z',
            timeMax:     '2024-12-31T23:59:59Z',
            maxResults:  100,
        });
    });

    it('uses default max_results of 50 when not provided', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: '/integrations/google/calendars/sync', payload: {} });

        expect(service.sync).toHaveBeenCalledWith(
            expect.objectContaining({ maxResults: 50 })
        );
    });

    it('uses defaults when no body is provided', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: '/integrations/google/calendars/sync' });

        expect(service.sync).toHaveBeenCalledWith(
            expect.objectContaining({ maxResults: 50 })
        );
    });

    it('passes undefined calendarId when calendar_id is absent', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: '/integrations/google/calendars/sync', payload: {} });

        const call = vi.mocked(service.sync).mock.calls[0][0];
        expect(call.calendarId).toBeUndefined();
    });

    it('returns 400 when max_results exceeds 250', async () => {
        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: { max_results: 300 },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when max_results is zero', async () => {
        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: { max_results: 0 },
        });
        expect(res.statusCode).toBe(400);
    });

    it('does not call service when validation fails', async () => {
        await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: { max_results: 0 },
        });
        expect(service.sync).not.toHaveBeenCalled();
    });

    it('returns 502 when Google Calendar API is unavailable', async () => {
        vi.mocked(service.sync).mockRejectedValue(
            new ExternalServiceError('Google Calendar', 'Not authenticated')
        );

        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync',
            payload: {},
        });

        expect(res.statusCode).toBe(502);
    });

    it('exposes all sync result fields', async () => {
        vi.mocked(service.sync).mockResolvedValue({
            fetched: 5, stored: 3, duplicates: 2, errors: 1, nextPageToken: 'tok_abc',
        });

        const res    = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/calendars/sync', payload: {},
        });
        const result = res.json().result;

        expect(result).toHaveProperty('fetched',    5);
        expect(result).toHaveProperty('stored',     3);
        expect(result).toHaveProperty('duplicates', 2);
        expect(result).toHaveProperty('errors',     1);
        expect(result).toHaveProperty('nextPageToken', 'tok_abc');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /integrations/google/calendars
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /integrations/google/calendars', () => {
    let service: CalendarSyncService;
    beforeEach(() => { service = createMockService(); vi.clearAllMocks(); });

    it('returns 200 with calendars array', async () => {
        const calendars = [
            { id: 'primary',     summary: 'My Calendar', primary: true  },
            { id: 'cal_work',    summary: 'Work',        primary: false },
        ];
        vi.mocked(service.listCalendars).mockResolvedValue(calendars);

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/calendars',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().calendars).toHaveLength(2);
        expect(res.json().calendars[0]).toEqual({ id: 'primary', summary: 'My Calendar', primary: true });
    });

    it('returns empty calendars array when none exist', async () => {
        vi.mocked(service.listCalendars).mockResolvedValue([]);

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/calendars',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().calendars).toEqual([]);
    });

    it('calls service.listCalendars once', async () => {
        vi.mocked(service.listCalendars).mockResolvedValue([]);

        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/integrations/google/calendars' });

        expect(service.listCalendars).toHaveBeenCalledOnce();
    });

    it('returns 502 when Google Calendar API is unavailable', async () => {
        vi.mocked(service.listCalendars).mockRejectedValue(
            new ExternalServiceError('Google Calendar', 'Not authenticated')
        );

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/calendars',
        });

        expect(res.statusCode).toBe(502);
    });

    it('includes id, summary and primary on each calendar', async () => {
        vi.mocked(service.listCalendars).mockResolvedValue([
            { id: 'cal_42', summary: 'Personal', primary: false },
        ]);

        const res      = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/calendars',
        });
        const calendar = res.json().calendars[0];

        expect(calendar).toHaveProperty('id',      'cal_42');
        expect(calendar).toHaveProperty('summary', 'Personal');
        expect(calendar).toHaveProperty('primary', false);
    });
});
