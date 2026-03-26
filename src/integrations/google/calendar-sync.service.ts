import { google } from 'googleapis';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthenticatedClient } from './google-oauth.client.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError } from '../../core/errors.js';
import { db as defaultDb } from '../../db/client.js';
import { nodes } from '../../db/schema/index.js';
import type { Node } from '../../db/schema/nodes.schema.js';

export interface CalendarSyncOptions {
    calendarId?:  string;
    timeMin?:     string;
    timeMax?:     string;
    maxResults?:  number;
    pageToken?:   string;
}

export interface CalendarSyncResult {
    fetched:    number;
    stored:     number;
    duplicates: number;
    errors:     number;
    nextPageToken?: string;
}

interface ParsedEvent {
    gcal_id:         string;
    title:           string;
    description:     string | null;
    starts_at:       string | null;
    ends_at:         string | null;
    location:        string | null;
    attendees:       Array<{ name?: string; email: string; response?: string }>;
    recurrence_rule: string | null;
    all_day:         boolean;
}

function parseEvent(event: any): ParsedEvent {
    const starts_at = event.start?.dateTime ?? event.start?.date ?? null;
    const ends_at   = event.end?.dateTime   ?? event.end?.date   ?? null;
    const all_day   = !event.start?.dateTime;

    const attendees = (event.attendees ?? []).map((a: any) => ({
        name:     a.displayName,
        email:    a.email,
        response: a.responseStatus,
    }));

    return {
        gcal_id:         event.id,
        title:           event.summary ?? '(no title)',
        description:     event.description ?? null,
        starts_at,
        ends_at,
        location:        event.location ?? null,
        attendees,
        recurrence_rule: event.recurrence?.[0] ?? null,
        all_day,
    };
}

// ── Calendar sync service factory ─────────────────────────────────────────────

export function createCalendarSyncService(db = defaultDb) {
    return {

        /**
         * Lists all calendars on the authenticated account.
         */
        async listCalendars() {
            const client   = await getAuthenticatedClient();
            const calendar = google.calendar({ version: 'v3', auth: client });

            try {
                const res = await calendar.calendarList.list();
                return (res.data.items ?? []).map((c: any) => ({
                    id:      c.id      as string,
                    summary: c.summary as string,
                    primary: c.primary ?? false,
                }));
            } catch (err: any) {
                throw new ExternalServiceError('Google Calendar', `Failed to list calendars: ${err.message}`);
            }
        },

        /**
         * Fetches events from a calendar (defaults to 'primary').
         */
        async fetchEvents(options: CalendarSyncOptions = {}) {
            const { calendarId = 'primary', timeMin, timeMax, maxResults = 50, pageToken } = options;
            const client   = await getAuthenticatedClient();
            const calendar = google.calendar({ version: 'v3', auth: client });

            try {
                const res = await calendar.events.list({
                    calendarId,
                    timeMin,
                    timeMax,
                    maxResults,
                    pageToken,
                    singleEvents: true,
                    orderBy:      'startTime',
                });
                return {
                    events:        (res.data.items ?? []).map(parseEvent),
                    nextPageToken: res.data.nextPageToken ?? undefined,
                };
            } catch (err: any) {
                throw new ExternalServiceError('Google Calendar', `Failed to fetch events: ${err.message}`);
            }
        },

        /**
         * Finds an existing node by its Google Calendar event ID.
         * Returns null if not found.
         */
        async findByGcalId(gcal_id: string): Promise<Node | null> {
            const [node] = await db
                .select()
                .from(nodes)
                .where(and(
                    eq(nodes.type, 'event'),
                    sql`json_extract(${nodes.metadata}, '$.gcal_id') = ${gcal_id}`,
                ));
            return node ?? null;
        },

        /**
         * Syncs Google Calendar events into the nodes table.
         * Skips events already stored (dedup via gcal_id in metadata).
         */
        async sync(options: CalendarSyncOptions = {}): Promise<CalendarSyncResult> {
            logger.info('Calendar sync starting', options);

            const result: CalendarSyncResult = { fetched: 0, stored: 0, duplicates: 0, errors: 0 };

            const { events, nextPageToken } = await this.fetchEvents(options);
            result.nextPageToken = nextPageToken;

            if (events.length === 0) {
                logger.info('Calendar sync: no events found');
                return result;
            }

            logger.info('Calendar sync: processing events', { count: events.length });

            for (const event of events) {
                try {
                    result.fetched++;

                    const existing = await this.findByGcalId(event.gcal_id);
                    if (existing) {
                        result.duplicates++;
                        logger.debug('Duplicate calendar event skipped', { gcal_id: event.gcal_id });
                        continue;
                    }

                    await db.insert(nodes).values({
                        id:          crypto.randomUUID(),
                        type:        'event',
                        title:       event.title,
                        description: event.description,
                        starts_at:   event.starts_at,
                        ends_at:     event.ends_at,
                        due_at:      event.starts_at,   // dashboard filters on due_at
                        location:    event.location,
                        status:      'active',
                        metadata:    JSON.stringify({
                            gcal_id:         event.gcal_id,
                            attendees:       event.attendees,
                            recurrence_rule: event.recurrence_rule,
                            all_day:         event.all_day,
                        }),
                    }).returning();

                    result.stored++;
                    logger.debug('Calendar event stored', { gcal_id: event.gcal_id, title: event.title });
                } catch (err: any) {
                    result.errors++;
                    logger.error('Failed to process calendar event', { gcal_id: event.gcal_id, error: err.message });
                }
            }

            logger.info('Calendar sync complete', result);
            return result;
        },
    };
}

export const calendarSyncService = createCalendarSyncService();
export type CalendarSyncService  = ReturnType<typeof createCalendarSyncService>;
