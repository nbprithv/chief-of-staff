import { google } from 'googleapis';
import { getAuthenticatedClient } from './google-oauth.client.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError } from '../../core/errors.js';

export interface CreateEventInput {
    title:        string;
    description?: string;
    date:         string;        // YYYY-MM-DD
    start_time?:  string;        // HH:MM 24h — omit for all-day event
    end_time?:    string;        // HH:MM 24h — defaults to start + 1 hour
    location?:    string;
    attendees?:   string[];      // email addresses; invites sent via sendUpdates:'all'
    timezone?:    string;        // defaults to America/New_York
    calendarId?:  string;        // defaults to 'primary'
    reminders?:   { minutesBefore: number }[];  // popup reminders; omit to use calendar defaults
}

export interface CreatedEvent {
    id:       string;
    htmlLink: string;
}

/**
 * Creates a Google Calendar event with optional attendee invites.
 * Requires the `calendar.events` OAuth scope.
 */
export async function createCalendarEvent(
    userId: string,
    input:  CreateEventInput,
): Promise<CreatedEvent> {
    const tz         = input.timezone  ?? 'America/New_York';
    const calendarId = input.calendarId ?? 'primary';
    const allDay     = !input.start_time;

    const startObj = allDay
        ? { date: input.date }
        : { dateTime: `${input.date}T${input.start_time}:00`, timeZone: tz };

    const endObj = allDay
        ? { date: input.date }
        : { dateTime: `${input.date}T${endTime(input.start_time!, input.end_time)}:00`, timeZone: tz };

    const attendees = (input.attendees ?? []).map(email => ({ email }));

    logger.info('[calendar-write] creating event', {
        userId,
        title:     input.title,
        date:      input.date,
        allDay,
        attendees: input.attendees,
    });

    try {
        const client   = await getAuthenticatedClient(userId);
        const calendar = google.calendar({ version: 'v3', auth: client });

        const remindersBody = input.reminders && input.reminders.length > 0
            ? { useDefault: false, overrides: input.reminders.map(r => ({ method: 'popup', minutes: r.minutesBefore })) }
            : { useDefault: true };

        const res = await calendar.events.insert({
            calendarId,
            sendUpdates: attendees.length > 0 ? 'all' : 'none',
            requestBody: {
                summary:     input.title,
                description: input.description ?? undefined,
                location:    input.location    ?? undefined,
                start:       startObj,
                end:         endObj,
                attendees,
                reminders:   remindersBody,
            },
        });

        logger.info('[calendar-write] event created', { id: res.data.id, title: input.title });
        return { id: res.data.id ?? '', htmlLink: res.data.htmlLink ?? '' };

    } catch (err: any) {
        const msg = err?.response?.data?.error?.message ?? err?.message ?? String(err);
        logger.error('[calendar-write] failed', { userId, title: input.title, error: msg });
        throw new ExternalServiceError('Google Calendar', `Failed to create event "${input.title}": ${msg}`);
    }
}

function endTime(start: string, end?: string): string {
    if (end) return end;
    const [h, m] = start.split(':').map(Number);
    return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
