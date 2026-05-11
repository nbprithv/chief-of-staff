/**
 * School Email Digest skill
 *
 * Flow:
 *   1. Fetch Galloway School emails via two Gmail queries + dedup
 *   2. Claude → structured JSON (per-email key points, action items with URLs, events)
 *   3. Create Google Calendar events with attendee invites + reminders
 *   4. Create action item tasks as 30-min calendar events (niranjan only)
 *   5. Send digest email (HTML + plain text) to both recipients
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../core/config.js';
import { logger } from '../../../core/logger.js';
import { fetchGallowayEmails } from '../../../integrations/google/gmail-fetch.service.js';
import { sendEmail } from '../../../integrations/google/gmail-send.service.js';
import { createCalendarEvent } from '../../../integrations/google/calendar-write.service.js';
import type { BackgroundJob } from '../../../db/schema/background_jobs.schema.js';

const MODEL      = 'claude-sonnet-4-20250514';
const RECIPIENTS = ['niranjan.prithviraj@gmail.com', 'shalini.o@gmail.com'];
const NIRANJAN   = 'niranjan.prithviraj@gmail.com';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionItem {
    description:      string;
    url?:             string | null;
    deadline_date?:   string | null;   // YYYY-MM-DD
    is_rsvp?:         boolean;
    rsvp_event_date?: string | null;   // YYYY-MM-DD
    rsvp_event_time?: string | null;   // HH:MM 24h
}

interface ParsedDigest {
    has_content: boolean;
    emails_processed: Array<{
        subject:      string;
        sender:       string;
        key_points:   string[];
        action_items: ActionItem[];
    }>;
    events: Array<{
        title:        string;
        date:         string;
        start_time?:  string | null;
        end_time?:    string | null;
        description?: string;
        location?:    string | null;
        all_day?:     boolean;
    }>;
}

export interface SkillRunResult {
    status:       'success' | 'skipped' | 'error';
    output?:      string;
    error?:       string;
    inputTokens:  number;
    outputTokens: number;
}

// ── Due-date helpers ──────────────────────────────────────────────────────────

function todayAt18(): { date: string; time: string } {
    const d = new Date();
    return {
        date: d.toISOString().slice(0, 10),
        time: '18:00',
    };
}

function actionItemDue(item: ActionItem, today: Date): { date: string; time: string; urgent: boolean } {
    if (item.is_rsvp && item.rsvp_event_date) {
        const eventDt = new Date(`${item.rsvp_event_date}T${item.rsvp_event_time ?? '08:00'}:00`);
        const dueDt   = new Date(eventDt.getTime() - 48 * 60 * 60 * 1000);
        if (dueDt > today) {
            return { date: dueDt.toISOString().slice(0, 10), time: dueDt.toTimeString().slice(0, 5), urgent: false };
        }
        return { ...todayAt18(), urgent: true };
    }
    if (item.deadline_date) {
        return { date: item.deadline_date, time: '18:00', urgent: false };
    }
    return { ...todayAt18(), urgent: false };
}

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runSchoolEmailDigest(job: BackgroundJob): Promise<SkillRunResult> {
    const userId = job.user_id;
    const today  = new Date();

    const todayLabel = today.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    // ── 1. Fetch Galloway emails ─────────────────────────────────────────────
    // Use the job's last successful run as the cutoff so we don't re-process
    // emails already covered by a previous run. Falls back to 24h on first run.
    const since  = job.last_run_at ? new Date(job.last_run_at) : null;
    const emails = await fetchGallowayEmails(userId, since);
    logger.info('[school-digest] email fetch window', {
        since: since?.toISOString() ?? 'last 24h (first run)',
    });
    logger.info('[school-digest] emails fetched', { count: emails.length });

    // ── 2. Ask Claude for structured extraction ──────────────────────────────
    let parsed: ParsedDigest;
    let inputTokens  = 0;
    let outputTokens = 0;

    if (emails.length === 0) {
        // Still send a no-email digest — skip the Claude call
        parsed = { has_content: false, emails_processed: [], events: [] };
    } else {
        const emailsBlock = emails
            .map((e, i) => [
                `=== Email ${i + 1} ===`,
                `From: ${e.sender}`,
                `Subject: ${e.subject}`,
                `Date: ${e.received_at}`,
                '',
                e.body,
            ].join('\n'))
            .join('\n\n');

        const prompt = `Today is ${todayLabel}. You are processing emails from The Galloway School for a school parent.

Here are the recent Galloway School emails:

${emailsBlock}

For each email, extract key points and action items. Also extract any calendar events.

Respond with ONLY a valid JSON object — no markdown, no commentary:

{
  "has_content": true,
  "emails_processed": [
    {
      "subject": "Email subject (strip Fwd:/FW: prefixes)",
      "sender": "Sender name or address",
      "key_points": ["2-4 bullet points summarising the email"],
      "action_items": [
        {
          "description": "Specific thing a parent needs to do",
          "url": "URL from the email tied to this action item, or null",
          "deadline_date": "YYYY-MM-DD if a deadline is mentioned, or null",
          "is_rsvp": false,
          "rsvp_event_date": "YYYY-MM-DD if this is an RSVP for an event, or null",
          "rsvp_event_time": "HH:MM if the event has a start time, or null"
        }
      ]
    }
  ],
  "events": [
    {
      "title": "Event name exactly as mentioned",
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM or null",
      "end_time": "HH:MM or null",
      "description": "Brief context from the email",
      "location": "Location if mentioned, or null",
      "all_day": false
    }
  ]
}

Rules:
- Use 24-hour time (e.g. "14:30" for 2:30 PM)
- Resolve relative dates ("next Friday", "this week") against today's date
- Only include events with a specific date mentioned
- For all-day events set all_day: true and omit start_time/end_time
- Always preserve any URL tied to an action item
- If emails contain no useful content, set has_content: false and use empty arrays`;

        if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

        const client   = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
            model:      MODEL,
            max_tokens: job.max_tokens_per_run,
            messages:   [{ role: 'user', content: prompt }],
        });

        inputTokens  = response.usage.input_tokens;
        outputTokens = response.usage.output_tokens;
        const rawText = response.content.find(b => b.type === 'text')?.text?.trim() ?? '';

        try {
            const json = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            parsed = JSON.parse(json);
        } catch (err: any) {
            logger.error('[school-digest] JSON parse failed', { preview: rawText.slice(0, 300) });
            throw new Error(`Claude returned non-JSON response: ${err?.message}`);
        }
    }

    // ── Tracking ─────────────────────────────────────────────────────────────
    const errors: string[] = [];
    interface TaskResult  { title: string; due: string; success: boolean; reason?: string; }
    interface EventResult { title: string; when: string; success: boolean; reason?: string; }
    const tasksAdded:   TaskResult[]  = [];
    const tasksFailed:  TaskResult[]  = [];
    const eventsAdded:  EventResult[] = [];
    const eventsFailed: EventResult[] = [];

    // ── 3. Create calendar events ────────────────────────────────────────────
    for (const event of parsed.events) {
        const when = event.all_day
            ? event.date
            : `${event.date}${event.start_time ? ' at ' + event.start_time : ''}`;
        try {
            await createCalendarEvent(userId, {
                title:       event.title,
                description: `${event.description ?? ''}\n\nAdded automatically from Galloway School email.`.trim(),
                date:        event.date,
                start_time:  event.all_day ? undefined : (event.start_time ?? undefined),
                end_time:    event.all_day ? undefined : (event.end_time ?? undefined),
                location:    event.location ?? undefined,
                attendees:   RECIPIENTS,
                reminders:   [{ minutesBefore: 24 * 60 }, { minutesBefore: 60 }],
            });
            eventsAdded.push({ title: event.title, when, success: true });
        } catch (err: any) {
            logger.error('[school-digest] calendar event failed', { title: event.title, error: err?.message });
            eventsFailed.push({ title: event.title, when, success: false, reason: err?.message });
            errors.push(`Calendar "${event.title}": ${err?.message}`);
        }
    }

    // ── 4. Create action item tasks as 30-min calendar events ────────────────
    const allActionItems = parsed.emails_processed.flatMap(e =>
        e.action_items.map(a => ({ ...a, source_subject: e.subject }))
    );

    for (const item of allActionItems) {
        const { date, time, urgent } = actionItemDue(item, today);
        const title = urgent ? `✅ URGENT: ${item.description}` : `✅ ${item.description}`;
        const dueLabel = `${date} at ${time}`;
        const description = [
            `Action item from: ${item.source_subject}`,
            item.url ? `Link: ${item.url}` : null,
            'Action item from Galloway School email.',
        ].filter(Boolean).join('\n');

        // end_time = start + 30 min
        const [h, m]   = time.split(':').map(Number);
        const endMins  = m + 30;
        const endTime  = `${String(h + Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;

        try {
            await createCalendarEvent(userId, {
                title,
                description,
                date,
                start_time: time,
                end_time:   endTime,
                attendees:  [NIRANJAN],
                reminders:  [{ minutesBefore: 24 * 60 }, { minutesBefore: 60 }],
            });
            tasksAdded.push({ title: item.description, due: dueLabel, success: true });
        } catch (err: any) {
            logger.error('[school-digest] action task failed', { title, error: err?.message });
            tasksFailed.push({ title: item.description, due: dueLabel, success: false, reason: err?.message });
            errors.push(`Task "${item.description}": ${err?.message}`);
        }
    }

    // ── 5. Compose & send digest email ───────────────────────────────────────
    const hasAny = parsed.has_content || emails.length > 0;
    const subjectLine = emails.length === 0
        ? `📚 Galloway School Digest — ${todayLabel} (No new emails)`
        : `📚 Galloway School Digest — ${todayLabel}`;

    // Build sections
    const allItems = allActionItems;

    const sectionActionRequired = allItems.length > 0 ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '🚨 ACTION REQUIRED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...allItems.map(a => {
            const src = (a as any).source_subject ? ` — from: ${(a as any).source_subject}` : '';
            const link = a.url ? `\n   → ${a.url}` : '';
            return `▶ ${a.description}${src}${link}`;
        }),
        '',
    ] : [];

    const sectionTasksAdded = tasksAdded.length > 0 ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '✅ ACTION ITEM TASKS ADDED TO CALENDAR',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...tasksAdded.map(t => `• ${t.title} — Due: ${t.due}`),
        '',
    ] : [];

    const sectionTasksFailed = tasksFailed.length > 0 ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '⚠️ ACTION ITEM TASKS NOT ADDED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...tasksFailed.map(t => `• ${t.title} — could not be added automatically. Please add manually.${t.reason ? '\n  Reason: ' + t.reason : ''}`),
        '',
    ] : [];

    const sectionEventsFailed = eventsFailed.length > 0 ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '⚠️ CALENDAR EVENTS NOT ADDED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...eventsFailed.map(e => `• ${e.title} — ${e.when} — could not be added automatically.${e.reason ? '\n  Reason: ' + e.reason : ''}`),
        '',
    ] : [];

    const sectionEventsAdded = eventsAdded.length > 0 ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '📅 CALENDAR EVENTS ADDED',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...eventsAdded.map(e => `• ${e.title} — ${e.when}`),
        '',
    ] : [];

    const emailDetails = parsed.emails_processed.length > 0 ? [
        '─────────────────────────────────────────',
        `📬 EMAILS TODAY: ${parsed.emails_processed.length}`,
        '─────────────────────────────────────────',
        '',
        ...parsed.emails_processed.flatMap(e => [
            `### ${e.subject}`,
            `From: ${e.sender}`,
            '',
            ...e.key_points.map(p => `• ${p}`),
            '',
            '─────────────────────────────────────────',
            '',
        ]),
    ] : [
        '─────────────────────────────────────────',
        '📬 EMAILS TODAY: 0',
        '─────────────────────────────────────────',
        '',
        'No new emails from The Galloway School today.',
        '',
    ];

    const bodyLines = [
        `Hi Niranjan,`,
        '',
        `Here's your Galloway School digest for ${todayLabel}.`,
        '',
        ...sectionActionRequired,
        ...sectionTasksAdded,
        ...sectionTasksFailed,
        ...sectionEventsFailed,
        ...sectionEventsAdded,
        ...emailDetails,
        'This digest was generated automatically from your connected Gmail account.',
    ];

    const plainText = bodyLines.join('\n');

    // HTML version — same structure, URLs become <a> links
    const htmlLines = bodyLines.map(line => {
        // Make raw URLs clickable
        return line.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
    });
    const htmlBody = `<pre style="font-family:sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${htmlLines.join('\n')}</pre>`;

    try {
        await sendEmail(userId, {
            to:      RECIPIENTS,
            subject: subjectLine,
            text:    plainText,
            html:    htmlBody,
        });
        logger.info('[school-digest] digest email sent', { to: RECIPIENTS, emails: emails.length });
    } catch (err: any) {
        logger.error('[school-digest] email send failed', { error: err?.message });
        errors.push(`Email send: ${err?.message}`);
    }

    // ── 6. Return summary ────────────────────────────────────────────────────
    const summary = [
        `Emails processed: ${parsed.emails_processed.length}.`,
        `Action item tasks added: ${tasksAdded.length}${tasksFailed.length > 0 ? `, ${tasksFailed.length} failed` : ''}.`,
        `Calendar events added: ${eventsAdded.length}${eventsFailed.length > 0 ? `, ${eventsFailed.length} failed` : ''}.`,
        `Digest sent to ${RECIPIENTS.join(' and ')}.`,
        errors.length > 0 ? `\nErrors: ${errors.join('; ')}` : null,
    ].filter(Boolean).join(' ');

    return {
        status:       errors.length > 0 && eventsAdded.length === 0 && tasksAdded.length === 0 && !hasAny ? 'error' : 'success',
        output:       summary,
        inputTokens,
        outputTokens,
    };
}
