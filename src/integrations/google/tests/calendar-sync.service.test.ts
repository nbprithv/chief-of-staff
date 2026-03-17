import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalServiceError } from '../../../core/errors.js';

// ── Mock googleapis ───────────────────────────────────────────────────────────

const mockCalendarListList = vi.fn();
const mockEventsList       = vi.fn();

vi.mock('googleapis', () => ({
    google: {
        calendar: vi.fn().mockReturnValue({
            calendarList: { list: mockCalendarListList },
            events:       { list: mockEventsList },
        }),
    },
}));

// ── Mock OAuth client ─────────────────────────────────────────────────────────

vi.mock('../google-oauth.client.js', () => ({
    getAuthenticatedClient: vi.fn().mockResolvedValue({ /* fake client */ }),
}));

// ── Mock db/client ─────────────────────────────────────────────────────────────

vi.mock('../../../db/client.js', () => ({ db: {} }));

// Import after mocks
const { createCalendarSyncService } = await import('../calendar-sync.service.js');

// ─────────────────────────────────────────────────────────────────────────────
// Mock db factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb() {
    const mockWhere     = vi.fn().mockResolvedValue([]);
    const mockFrom      = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect    = vi.fn().mockReturnValue({ from: mockFrom });
    const mockReturning = vi.fn().mockResolvedValue([{ id: 'node-id', type: 'event', title: 'Test Event' }]);
    const mockValues    = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockInsert    = vi.fn().mockReturnValue({ values: mockValues });

    return {
        select:      mockSelect,
        insert:      mockInsert,
        // Exposed for per-test configuration
        _where:      mockWhere,
        _values:     mockValues,
        _returning:  mockReturning,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeCalendarListItem(overrides: Record<string, any> = {}) {
    return {
        id:      'calendar_primary',
        summary: 'Primary Calendar',
        primary: true,
        ...overrides,
    };
}

function makeGCalEvent(overrides: Record<string, any> = {}) {
    return {
        id:          'evt_001',
        summary:     'Team Meeting',
        description: 'Monthly sync',
        location:    'Conference Room A',
        start:       { dateTime: '2024-06-15T10:00:00Z' },
        end:         { dateTime: '2024-06-15T11:00:00Z' },
        attendees:   [
            { displayName: 'Alice', email: 'alice@example.com', responseStatus: 'accepted' },
        ],
        recurrence: ['RRULE:FREQ=MONTHLY'],
        ...overrides,
    };
}

function makeAllDayEvent(overrides: Record<string, any> = {}) {
    return {
        id:      'evt_allday',
        summary: 'Company Holiday',
        start:   { date: '2024-07-04' },
        end:     { date: '2024-07-05' },
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// listCalendars()
// ─────────────────────────────────────────────────────────────────────────────

describe('calendarSyncService.listCalendars()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns mapped calendars from Google', async () => {
        mockCalendarListList.mockResolvedValue({
            data: {
                items: [
                    makeCalendarListItem(),
                    makeCalendarListItem({ id: 'cal_work', summary: 'Work', primary: false }),
                ],
            },
        });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.listCalendars();

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ id: 'calendar_primary', summary: 'Primary Calendar', primary: true });
        expect(result[1]).toEqual({ id: 'cal_work', summary: 'Work', primary: false });
    });

    it('returns empty array when no calendars exist', async () => {
        mockCalendarListList.mockResolvedValue({ data: {} });
        const service = createCalendarSyncService(createMockDb() as any);
        expect(await service.listCalendars()).toEqual([]);
    });

    it('returns primary: false when primary field is absent', async () => {
        mockCalendarListList.mockResolvedValue({
            data: { items: [{ id: 'cal_x', summary: 'Other' }] },
        });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.listCalendars();
        expect(result[0]!.primary).toBe(false);
    });

    it('throws ExternalServiceError when API fails', async () => {
        mockCalendarListList.mockRejectedValue(new Error('Auth expired'));
        const service = createCalendarSyncService(createMockDb() as any);
        await expect(service.listCalendars()).rejects.toThrow(ExternalServiceError);
    });

    it('includes the error message in ExternalServiceError', async () => {
        mockCalendarListList.mockRejectedValue(new Error('Auth expired'));
        const service = createCalendarSyncService(createMockDb() as any);
        await expect(service.listCalendars()).rejects.toThrow('Auth expired');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchEvents()
// ─────────────────────────────────────────────────────────────────────────────

describe('calendarSyncService.fetchEvents()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns parsed events from Google Calendar', async () => {
        mockEventsList.mockResolvedValue({
            data: { items: [makeGCalEvent()] },
        });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();

        expect(events).toHaveLength(1);
        expect(events[0]!.gcal_id).toBe('evt_001');
        expect(events[0]!.title).toBe('Team Meeting');
        expect(events[0]!.description).toBe('Monthly sync');
        expect(events[0]!.starts_at).toBe('2024-06-15T10:00:00Z');
        expect(events[0]!.ends_at).toBe('2024-06-15T11:00:00Z');
        expect(events[0]!.location).toBe('Conference Room A');
        expect(events[0]!.all_day).toBe(false);
    });

    it('parses attendees correctly', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [makeGCalEvent()] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();

        expect(events[0]!.attendees).toHaveLength(1);
        expect(events[0]!.attendees[0]).toEqual({
            name: 'Alice', email: 'alice@example.com', response: 'accepted',
        });
    });

    it('extracts recurrence_rule from recurrence array', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [makeGCalEvent()] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();
        expect(events[0]!.recurrence_rule).toBe('RRULE:FREQ=MONTHLY');
    });

    it('marks all-day events correctly', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [makeAllDayEvent()] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();

        expect(events[0]!.all_day).toBe(true);
        expect(events[0]!.starts_at).toBe('2024-07-04');
        expect(events[0]!.ends_at).toBe('2024-07-05');
    });

    it('uses (no title) when summary is absent', async () => {
        const evt = makeGCalEvent({ summary: undefined });
        mockEventsList.mockResolvedValue({ data: { items: [evt] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();
        expect(events[0]!.title).toBe('(no title)');
    });

    it('returns empty events when no items exist', async () => {
        mockEventsList.mockResolvedValue({ data: {} });
        const service = createCalendarSyncService(createMockDb() as any);
        const { events } = await service.fetchEvents();
        expect(events).toEqual([]);
    });

    it('returns nextPageToken when present', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [], nextPageToken: 'tok_xyz' } });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.fetchEvents();
        expect(result.nextPageToken).toBe('tok_xyz');
    });

    it('returns undefined nextPageToken when absent', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.fetchEvents();
        expect(result.nextPageToken).toBeUndefined();
    });

    it('defaults calendarId to primary', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [] } });
        const service = createCalendarSyncService(createMockDb() as any);
        await service.fetchEvents();
        expect(mockEventsList).toHaveBeenCalledWith(
            expect.objectContaining({ calendarId: 'primary' })
        );
    });

    it('passes custom calendarId to API', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [] } });
        const service = createCalendarSyncService(createMockDb() as any);
        await service.fetchEvents({ calendarId: 'work@example.com' });
        expect(mockEventsList).toHaveBeenCalledWith(
            expect.objectContaining({ calendarId: 'work@example.com' })
        );
    });

    it('throws ExternalServiceError when API fails', async () => {
        mockEventsList.mockRejectedValue(new Error('Rate limit exceeded'));
        const service = createCalendarSyncService(createMockDb() as any);
        await expect(service.fetchEvents()).rejects.toThrow(ExternalServiceError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// findByGcalId()
// ─────────────────────────────────────────────────────────────────────────────

describe('calendarSyncService.findByGcalId()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns a node when found', async () => {
        const db   = createMockDb();
        const node = { id: 'node-id', type: 'event', title: 'Team Meeting' };
        db._where.mockResolvedValue([node]);

        const service = createCalendarSyncService(db as any);
        const result  = await service.findByGcalId('evt_001');
        expect(result).toEqual(node);
    });

    it('returns null when not found', async () => {
        const db = createMockDb();
        db._where.mockResolvedValue([]);

        const service = createCalendarSyncService(db as any);
        const result  = await service.findByGcalId('evt_unknown');
        expect(result).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync()
// ─────────────────────────────────────────────────────────────────────────────

describe('calendarSyncService.sync()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns zeroed result when no events are found', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [] } });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.sync();
        expect(result).toEqual({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });
    });

    it('stores new events and returns correct counts', async () => {
        mockEventsList.mockResolvedValue({
            data: { items: [makeGCalEvent({ id: 'evt_1' }), makeGCalEvent({ id: 'evt_2' })] },
        });
        const db = createMockDb();
        db._where.mockResolvedValue([]); // no duplicates

        const service = createCalendarSyncService(db as any);
        const result  = await service.sync();

        expect(result.fetched).toBe(2);
        expect(result.stored).toBe(2);
        expect(result.duplicates).toBe(0);
        expect(result.errors).toBe(0);
    });

    it('skips duplicate events (gcal_id match)', async () => {
        mockEventsList.mockResolvedValue({
            data: { items: [makeGCalEvent({ id: 'evt_1' }), makeGCalEvent({ id: 'evt_2' })] },
        });
        const db = createMockDb();
        // First event: new; second event: duplicate
        db._where
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 'existing-node' }]);

        const service = createCalendarSyncService(db as any);
        const result  = await service.sync();

        expect(result.stored).toBe(1);
        expect(result.duplicates).toBe(1);
    });

    it('counts errors when insert fails and continues processing', async () => {
        mockEventsList.mockResolvedValue({
            data: { items: [makeGCalEvent({ id: 'evt_1' }), makeGCalEvent({ id: 'evt_2' })] },
        });
        const db = createMockDb();
        db._where.mockResolvedValue([]); // no duplicates
        // First insert succeeds, second fails
        db._returning
            .mockResolvedValueOnce([{ id: 'node-1' }])
            .mockRejectedValueOnce(new Error('DB write error'));

        const service = createCalendarSyncService(db as any);
        const result  = await service.sync();

        expect(result.stored).toBe(1);
        expect(result.errors).toBe(1);
    });

    it('stores events with correct node fields', async () => {
        mockEventsList.mockResolvedValue({
            data: { items: [makeGCalEvent()] },
        });
        const db = createMockDb();
        db._where.mockResolvedValue([]);

        const service = createCalendarSyncService(db as any);
        await service.sync();

        const values = db._values.mock.calls[0][0];
        expect(values.type).toBe('event');
        expect(values.title).toBe('Team Meeting');
        expect(values.status).toBe('active');
        expect(values.starts_at).toBe('2024-06-15T10:00:00Z');
        expect(values.ends_at).toBe('2024-06-15T11:00:00Z');
        expect(values.location).toBe('Conference Room A');
    });

    it('stores gcal_id in metadata JSON', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [makeGCalEvent({ id: 'evt_xyz' })] } });
        const db = createMockDb();
        db._where.mockResolvedValue([]);

        const service = createCalendarSyncService(db as any);
        await service.sync();

        const values   = db._values.mock.calls[0][0];
        const metadata = JSON.parse(values.metadata);
        expect(metadata.gcal_id).toBe('evt_xyz');
    });

    it('stores attendees in metadata JSON', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [makeGCalEvent()] } });
        const db = createMockDb();
        db._where.mockResolvedValue([]);

        const service = createCalendarSyncService(db as any);
        await service.sync();

        const values   = db._values.mock.calls[0][0];
        const metadata = JSON.parse(values.metadata);
        expect(metadata.attendees).toHaveLength(1);
        expect(metadata.attendees[0].email).toBe('alice@example.com');
    });

    it('includes nextPageToken in result when present', async () => {
        mockEventsList.mockResolvedValue({ data: { items: [], nextPageToken: 'page_abc' } });
        const service = createCalendarSyncService(createMockDb() as any);
        const result  = await service.sync();
        expect(result.nextPageToken).toBe('page_abc');
    });

    it('throws when fetchEvents itself fails', async () => {
        mockEventsList.mockRejectedValue(new Error('Auth error'));
        const service = createCalendarSyncService(createMockDb() as any);
        await expect(service.sync()).rejects.toThrow(ExternalServiceError);
    });
});
