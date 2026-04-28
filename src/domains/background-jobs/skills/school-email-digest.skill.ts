/**
 * School Email Digest skill
 *
 * Flow:
 *   1. Fetch recent Galloway School emails from Gmail
 *   2. Send to Claude → structured JSON (digest text + event list)
 *   3. Email digest to both recipients via Gmail send API
 *   4. Create Google Calendar events (with invites) for any dates mentioned
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../core/config.js';
import { logger } from '../../../core/logger.js';
import { fetchEmailsByQuery } from '../../../integrations/google/gmail-fetch.service.js';
import { sendEmail } from '../../../integrations/google/gmail-send.service.js';
import { createCalendarEvent } from '../../../integrations/google/calendar-write.service.js';
import type { BackgroundJob } from '../../../db/schema/background_jobs.schema.js';

const MODEL      = 'claude-sonnet-4-20250514';
const RECIPIENTS = ['niranjan.prithviraj@gmail.com', 'shalini.o@gmail.com'];

// Matches emails from gallowayschool.org received in the last 2 days
const GMAIL_QUERY = 'from:gallowayschool.org newer_than:2d';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedDigest {
    has_content:  boolean;
    digest:       string;
    action_items: string[];
    events: Array<{
        title:        string;
        date:         string;   // YYYY-MM-DD
        start_time?:  string;   // HH:MM 24h
        end_time?:    string;   // HH:MM 24h
        description?: string;
        location?:    string;
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

// ── Runner ────────────────────────────────────────────────────────────────────

export async function runSchoolEmailDigest(job: BackgroundJob): Promise<SkillRunResult> {
    const userId = job.user_id;

    // ── 1. Fetch Galloway emails ─────────────────────────────────────────────
    const emails = await fetchEmailsByQuery(userId, GMAIL_QUERY, 20);

    if (emails.length === 0) {
        logger.info('[school-digest] no emails found, skipping');
        return { status: 'skipped', output: 'No Galloway School emails in the last 2 days.', inputTokens: 0, outputTokens: 0 };
    }

    logger.info('[school-digest] emails fetched', { count: emails.length });

    // ── 2. Ask Claude for structured digest ──────────────────────────────────
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

    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    const prompt = `Today is ${today}. You are processing emails from The Galloway School for a school parent.

Here are the recent Galloway School emails:

${emailsBlock}

Summarize them into a clear digest and extract any events or action items.

Respond with ONLY a valid JSON object — no markdown, no commentary — in this exact schema:

{
  "has_content": true,
  "digest": "Clear plain-text summary of all emails. Lead with the most time-sensitive item. Separate topics with blank lines. No markdown.",
  "action_items": ["Specific thing a parent needs to do or follow up on"],
  "events": [
    {
      "title": "Event name exactly as mentioned",
      "date": "YYYY-MM-DD",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "description": "Brief description from the email",
      "location": "Location if mentioned",
      "all_day": false
    }
  ]
}

Rules:
- Only include events with a specific date mentioned in the emails
- Use 24-hour time (e.g. "14:30" for 2:30 PM)
- For all-day events (no time specified), set all_day: true and omit start_time/end_time
- If no events or action items found, use empty arrays
- If emails contain no useful content, set has_content: false`;

    if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');

    const client   = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
        model:      MODEL,
        max_tokens: job.max_tokens_per_run,
        messages:   [{ role: 'user', content: prompt }],
    });

    const inputTokens  = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const rawText      = response.content.find(b => b.type === 'text')?.text?.trim() ?? '';

    // ── 3. Parse response ────────────────────────────────────────────────────
    let parsed: ParsedDigest;
    try {
        const json = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        parsed = JSON.parse(json);
    } catch (err: any) {
        logger.error('[school-digest] JSON parse failed', { preview: rawText.slice(0, 300) });
        throw new Error(`Claude returned non-JSON response: ${err?.message}`);
    }

    if (!parsed.has_content) {
        return { status: 'skipped', output: 'Emails found but no meaningful content to digest.', inputTokens, outputTokens };
    }

    const errors: string[] = [];

    // ── 4. Send digest email ─────────────────────────────────────────────────
    const actionSection = parsed.action_items.length > 0
        ? `\n\nACTION ITEMS\n${'─'.repeat(30)}\n${parsed.action_items.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
        : '';

    const eventSection = parsed.events.length > 0
        ? `\n\nEVENTS ADDED TO CALENDAR\n${'─'.repeat(30)}\n${parsed.events.map(e =>
              `• ${e.title} — ${e.date}${e.start_time ? ` at ${e.start_time}` : ''}`
          ).join('\n')}`
        : '';

    const emailBody = `Galloway School Digest — ${today}\n${'═'.repeat(40)}\n\n${parsed.digest}${actionSection}${eventSection}\n\n${'─'.repeat(40)}\nSent automatically by Aide.`;

    try {
        await sendEmail(userId, {
            to:      RECIPIENTS,
            subject: `Galloway School Digest — ${today}`,
            text:    emailBody,
        });
        logger.info('[school-digest] digest email sent', { to: RECIPIENTS });
    } catch (err: any) {
        logger.error('[school-digest] email send failed', { error: err?.message });
        errors.push(`Email: ${err?.message}`);
    }

    // ── 5. Create calendar events ────────────────────────────────────────────
    let eventsCreated = 0;
    for (const event of parsed.events) {
        try {
            await createCalendarEvent(userId, {
                title:       event.title,
                description: event.description,
                date:        event.date,
                start_time:  event.all_day ? undefined : event.start_time,
                end_time:    event.all_day ? undefined : event.end_time,
                location:    event.location,
                attendees:   RECIPIENTS,
            });
            eventsCreated++;
        } catch (err: any) {
            logger.error('[school-digest] calendar event failed', { title: event.title, error: err?.message });
            errors.push(`Calendar "${event.title}": ${err?.message}`);
        }
    }

    const summary = [
        `Digest sent to ${RECIPIENTS.join(' and ')}.`,
        `${eventsCreated} of ${parsed.events.length} calendar event(s) created.`,
        parsed.action_items.length > 0 ? `${parsed.action_items.length} action item(s).` : null,
        errors.length > 0 ? `\nErrors: ${errors.join('; ')}` : null,
    ].filter(Boolean).join(' ');

    return {
        status:       errors.length > 0 && eventsCreated === 0 && !parsed.digest ? 'error' : 'success',
        output:       `${summary}\n\n${'─'.repeat(40)}\n${parsed.digest}`,
        inputTokens,
        outputTokens,
    };
}
