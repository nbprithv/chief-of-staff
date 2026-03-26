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
    query?:     string;   // Gmail search query (overrides label when set)
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

    if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf8');
    }

    if (part.parts) {
        for (const subpart of part.parts) {
            const text = decodeBody(subpart);
            if (text) return text;
        }
    }

    return '';
}

function extractBodyFromPayload(payload: any): string {
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }
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

        async resolveLabelId(labelName: string, userId: string): Promise<string> {
            const client = await getAuthenticatedClient(userId);
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

        async listMessageIds(options: SyncOptions, userId: string) {
            const { label = config.GMAIL_LABEL, query, maxEmails = 50, pageToken } = options;
            const client = await getAuthenticatedClient(userId);
            const gmail  = google.gmail({ version: 'v1', auth: client });

            const listParams: any = {
                userId:     'me',
                maxResults: Math.min(maxEmails, 100),
                pageToken,
            };

            if (query) {
                listParams.q = query;
            } else {
                const labelId = await this.resolveLabelId(label, userId);
                listParams.labelIds = [labelId];
            }

            try {
                const res = await gmail.users.messages.list(listParams);

                return {
                    ids:           (res.data.messages ?? []).map((m: any) => m.id as string),
                    nextPageToken: res.data.nextPageToken ?? undefined,
                };
            } catch (err: any) {
                throw new ExternalServiceError('Gmail', `Failed to list messages: ${err.message}`);
            }
        },

        async fetchMessage(messageId: string, userId: string): Promise<FetchedEmail> {
            const client = await getAuthenticatedClient(userId);
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

        async sync(options: SyncOptions, userId: string): Promise<SyncResult> {
            const { label = config.GMAIL_LABEL, maxEmails = 50 } = options;

            logger.info('Gmail sync starting', { label, maxEmails, userId });

            const result: SyncResult = { fetched: 0, stored: 0, duplicates: 0, errors: 0 };

            const { ids, nextPageToken } = await this.listMessageIds(options, userId);
            result.nextPageToken = nextPageToken;

            if (ids.length === 0) {
                logger.info('Gmail sync: no messages found', { label, userId });
                return result;
            }

            logger.info('Gmail sync: fetching messages', { count: ids.length, userId });

            for (const id of ids) {
                try {
                    const email = await this.fetchMessage(id, userId);
                    result.fetched++;

                    const content_hash = hashEmail({
                        gmail_id:     email.gmail_id,
                        sender_email: email.sender_email,
                        received_at:  email.received_at,
                        subject:      email.subject,
                        body_raw:     email.body_raw,
                    });

                    const existing = await repository.findByContentHash(content_hash, userId);
                    if (existing) {
                        result.duplicates++;
                        logger.debug('Duplicate email skipped', { gmail_id: id });
                        continue;
                    }

                    await repository.create({
                        id:           crypto.randomUUID(),
                        user_id:      userId,
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
                    logger.debug('Email stored', { gmail_id: id, subject: email.subject, userId });
                } catch (err: any) {
                    result.errors++;
                    logger.error('Failed to process email', { gmail_id: id, error: err.message });
                }
            }

            logger.info('Gmail sync complete', { ...result, userId });
            return result;
        },

        async listLabels(userId: string) {
            const client = await getAuthenticatedClient(userId);
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
