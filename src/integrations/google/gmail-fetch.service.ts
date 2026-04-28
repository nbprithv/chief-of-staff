import { google } from 'googleapis';
import { getAuthenticatedClient } from './google-oauth.client.js';
import { logger } from '../../core/logger.js';

export interface FetchedEmailSummary {
    subject:     string;
    sender:      string;
    received_at: string;
    body:        string;
}

/**
 * Searches Gmail with the given query and returns the decoded email contents.
 * Does NOT store anything — read-only, for context building.
 */
export async function fetchEmailsByQuery(
    userId:     string,
    query:      string,
    maxResults = 20,
): Promise<FetchedEmailSummary[]> {
    logger.info('[gmail-fetch] searching', { userId, query, maxResults });

    const client = await getAuthenticatedClient(userId);
    const gmail  = google.gmail({ version: 'v1', auth: client });

    const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
    const ids     = listRes.data.messages ?? [];
    if (ids.length === 0) return [];

    const results: FetchedEmailSummary[] = [];

    for (const { id } of ids) {
        if (!id) continue;
        try {
            const msgRes = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
            const msg    = msgRes.data;
            const headers: any[] = msg.payload?.headers ?? [];

            const getH = (name: string) =>
                headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

            results.push({
                subject:     getH('Subject') || '(no subject)',
                sender:      getH('From'),
                received_at: getH('Date') || new Date().toISOString(),
                body:        extractText(msg.payload).slice(0, 3_000),
            });
        } catch (err: any) {
            logger.warn('[gmail-fetch] skipping message', { id, error: err?.message });
        }
    }

    logger.info('[gmail-fetch] fetched', { count: results.length });
    return results;
}

function extractText(payload: any): string {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }
    if (payload.parts) {
        for (const part of payload.parts) {
            const t = extractText(part);
            if (t) return t;
        }
    }
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }
    return '';
}
