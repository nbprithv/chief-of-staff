import { google } from 'googleapis';
import { getAuthenticatedClient } from './google-oauth.client.js';
import { hashEmail } from '../../db/schema/emails.schema.js';
import { createEmailRepository } from '../../domains/email/email.repository.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError } from '../../core/errors.js';
import { config } from '../../core/config.js';
import type { EmailRepository } from '../../domains/email/email.repository.js';

export interface SyncOptions {
    label?:     string;   // Gmail label — defaults to 'INBOX'
    maxEmails?: number;   // max to fetch — defaults to 50
    pageToken?: string;   // for pagination
}

export interface SyncResult {
    fetched:    number;
    stored:     number;
    duplicates: number;
    errors:     number;
    nextPageToken?: string;
}

export interface FetchedEmail {
    gmail_id:     string;
    thread_id:    string;
    subject:      string;
    sender_name:  string | null;
    sender_email: string;
    recipients:   string[];
    body_raw:     string;
    labels:       string[];
    received_at:  string;
}

// ── Gmail message helpers ─────────────────────────────────────────────────────

function getHeader(headers: any[], name: string): string {
    return headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseEmailAddress(raw: string): { name: string | null; email: string } {
    const match = raw.match(/^(.*?)\s*<(.+?)>$/);
    if (match) return { name: match[1].trim() || null, email: match[2].trim() };
    return { name: null, email: raw.trim() };
}

function decodeBody(part: any): string {
    if (!part) return '';

    // Prefer text/plain
    if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
    }

    // Recurse into multipart
    if (part.parts) {
        for (const subpart of part.parts) {
            const text = decodeBody(subpart);
            if (text) return text;
        }
    }

    return '';
}

function extractBodyFromPayload(payload: any): string {
    // Simple body
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }
    // Multipart
    if (payload.parts) {
        return decodeBody(payload);
    }
    return '';
}

function parseMessage(msg: any): FetchedEmail {
    const headers = msg.payload?.headers ?? [];
    const from    = parseEmailAddress(getHeader(headers, 'From'));
    const toRaw   = getHeader(headers, 'To');
    const recipients = toRaw
        ? toRaw.split(',').map((r: string) => parseEmailAddress(r.trim()).email)
        : [];

    const dateHeader = getHeader(headers, 'Date');
    const received_at = dateHeader
        ? new Date(dateHeader).toISOString()
        : new Date().toISOString();

    return {
        gmail_id:     msg.id,
        thread_id:    msg.threadId,
        subject:      getHeader(headers, 'Subject') || '(no subject)',
        sender_name:  from.name,
        sender_email: from.email,
        recipients,
        body_raw:     extractBodyFromPayload(msg.payload).slice(0, 10000),
        labels:       msg.labelIds ?? [],
        received_at,
    };
}

// ── Sync service factory ──────────────────────────────────────────────────────

export function createGmailSyncService(repository: EmailRepository = createEmailRepository()) {
    return {

        /**
         * Lists message IDs from Gmail for a given label.
         * Returns up to maxEmails IDs and a nextPageToken for pagination.
         */
        async resolveLabelId(labelName: string): Promise<string> {
            const client = await getAuthenticatedClient();
            const gmail  = google.gmail({ version: 'v1', auth: client });

            const res = await gmail.users.labels.list({ userId: 'me' });
            const match = (res.data.labels ?? []).find(
                (l: any) => l.name?.toLowerCase() === labelName.toLowerCase()
            );

            if (!match?.id) {
                throw new ExternalServiceError('Gmail', `Label "${labelName}" not found`);
            }

            logger.debug('Resolved label', { name: labelName, id: match.id });
            return match.id as string;
        },

        async listMessageIds(options: SyncOptions = {}) {
            const { label = config.GMAIL_LABEL, maxEmails = 50, pageToken } = options;
            const client = await getAuthenticatedClient();
            const gmail  = google.gmail({ version: 'v1', auth: client });

            const labelId = await this.resolveLabelId(label);

            try {
                const res = await gmail.users.messages.list({
                    userId:    'me',
                    labelIds:  [labelId],
                    maxResults: Math.min(maxEmails, 100),
                    pageToken,
                });

                return {
                    ids:           (res.data.messages ?? []).map((m: any) => m.id as string),
                    nextPageToken: res.data.nextPageToken ?? undefined,
                };
            } catch (err: any) {
                throw new ExternalServiceError('Gmail', `Failed to list messages: ${err.message}`);
            }
        },

        /**
         * Fetches a single message by ID (full format).
         */
        async fetchMessage(messageId: string): Promise<FetchedEmail> {
            const client = await getAuthenticatedClient();
            const gmail  = google.gmail({ version: 'v1', auth: client });

            try {
                const res = await gmail.users.messages.get({
                    userId: 'me',
                    id:     messageId,
                    format: 'full',
                });
                return parseMessage(res.data);
            } catch (err: any) {
                throw new ExternalServiceError('Gmail', `Failed to fetch message ${messageId}: ${err.message}`);
            }
        },

        /**
         * Full sync: lists IDs, fetches each message, deduplicates via
         * content_hash, and stores new emails to the repository.
         */
        async sync(options: SyncOptions = {}): Promise<SyncResult> {
            const { label = config.GMAIL_LABEL, maxEmails = 50 } = options;

            logger.info('Gmail sync starting', { label, maxEmails });

            const result: SyncResult = { fetched: 0, stored: 0, duplicates: 0, errors: 0 };

            // 1. List message IDs
            const { ids, nextPageToken } = await this.listMessageIds(options);
            result.nextPageToken = nextPageToken;

            if (ids.length === 0) {
                logger.info('Gmail sync: no messages found', { label });
                return result;
            }

            logger.info('Gmail sync: fetching messages', { count: ids.length, label });

            // 2. Fetch each message and store — process sequentially to respect rate limits
            for (const id of ids) {
                try {
                    const email = await this.fetchMessage(id);
                    result.fetched++;

                    // 3. Deduplicate via content_hash
                    const content_hash = hashEmail({
                        gmail_id:     email.gmail_id,
                        sender_email: email.sender_email,
                        received_at:  email.received_at,
                        subject:      email.subject,
                        body_raw:     email.body_raw,
                    });

                    const existing = await repository.findByContentHash(content_hash);
                    if (existing) {
                        result.duplicates++;
                        logger.debug('Duplicate email skipped', { gmail_id: id });
                        continue;
                    }

                    // 4. Store to repository
                    await repository.create({
                        id:           crypto.randomUUID(),
                        gmail_id:     email.gmail_id,
                        thread_id:    email.thread_id,
                        content_hash,
                        subject:      email.subject,
                        sender_name:  email.sender_name,
                        sender_email: email.sender_email,
                        recipients:   JSON.stringify(email.recipients),
                        body_raw:     email.body_raw,
                        body_summary: null,
                        labels:       JSON.stringify(email.labels),
                        received_at:  email.received_at,
                    });

                    result.stored++;
                    logger.info('Email stored', { gmail_id: id, subject: email.subject });
                    logger.debug('Email stored', { gmail_id: id, subject: email.subject });
                } catch (err: any) {
                    result.errors++;
                    logger.error('Failed to process email', { gmail_id: id, error: err.message });
                }
            }

            logger.info('Gmail sync complete', result);
            return result;
        },

        /**
         * Returns all available labels for the authenticated account.
         * Useful for letting the user pick a label in the UI.
         */
        async listLabels() {
            const client = await getAuthenticatedClient();
            const gmail  = google.gmail({ version: 'v1', auth: client });

            try {
                const res = await gmail.users.labels.list({ userId: 'me' });
                return (res.data.labels ?? []).map((l: any) => ({
                    id:   l.id   as string,
                    name: l.name as string,
                    type: l.type as string,
                }));
            } catch (err: any) {
                throw new ExternalServiceError('Gmail', `Failed to list labels: ${err.message}`);
            }
        },
    };
}

export const gmailSyncService = createGmailSyncService();
export type GmailSyncService = ReturnType<typeof createGmailSyncService>;