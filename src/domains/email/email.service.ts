import { hashEmail } from '../../db/schema/emails.schema.js';
import { createEmailRepository, emailRepository as defaultRepository } from './email.repository.js';
import { NotFoundError } from '../../core/errors.js';
import type { CreateEmailInput, UpdateEmailInput } from '../types.js';
import type { EmailRepository } from './email.repository.js';

import { logger } from '../../core/logger.js';

export function createEmailService(repository: EmailRepository = defaultRepository) {
    return {

        async list(filters?: {
            triaged?:      boolean;
            sender_email?: string;
            label?:        string;
            limit?:        number;
            offset?:       number;
        }) {
            const rows = await repository.findAll(filters);
            return rows.map(deserialize);
        },

        async getById(id: string) {
            const email = await repository.findById(id);
            if (!email) throw new NotFoundError('Email', id);
            return deserialize(email)!;
        },

        async getByGmailId(gmail_id: string) {
            const email = await repository.findByGmailId(gmail_id);
            if (!email) throw new NotFoundError('Email', gmail_id);
            return deserialize(email)!;
        },

        async getThread(thread_id: string) {
            const rows = await repository.findByThreadId(thread_id);
            return rows.map(deserialize);
        },

        async listUntriaged(limit?: number) {
            const rows = await repository.findUntriaged(limit);
            return rows.map(deserialize);
        },

        /**
         * Ingests an incoming email. Computes content_hash and silently skips
         * the insert if the email has already been processed.
         * Returns { email, isDuplicate }.
         */
        async ingest(input: CreateEmailInput) {
            const content_hash = hashEmail({
                gmail_id:     input.gmail_id,
                sender_email: input.sender_email,
                received_at:  input.received_at,
                subject:      input.subject,
                body_raw:     input.body_raw,
            });

            const existing = await repository.findByContentHash(content_hash);
            if (existing) {
                logger.info('>>>>>saving email>>>')
                return { email: deserialize(existing)!, isDuplicate: true };
            }

            const email = await repository.create({
                id:           crypto.randomUUID(),
                gmail_id:     input.gmail_id,
                thread_id:    input.thread_id ?? null,
                content_hash,
                subject:      input.subject,
                sender_email: input.sender_email,
                sender_name:  input.sender_name ?? null,
                recipients:   JSON.stringify(input.recipients ?? []),
                body_summary: input.body_summary ?? null,
                body_raw:     input.body_raw ?? null,
                labels:       JSON.stringify(input.labels ?? ['inbox']),
                received_at:  input.received_at,
            });

            return { email: deserialize(email)!, isDuplicate: false };
        },

        async update(id: string, input: UpdateEmailInput) {
            const existing = await repository.findById(id);
            if (!existing) throw new NotFoundError('Email', id);

            const updated = await repository.update(id, {
                ...(input.body_summary !== undefined && { body_summary: input.body_summary }),
                ...(input.labels       !== undefined && { labels: JSON.stringify(input.labels) }),
                ...(input.triaged      !== undefined && { triaged: input.triaged }),
            });

            return deserialize(updated!)!;
        },

        async markTriaged(id: string) {
            const existing = await repository.findById(id);
            if (!existing) throw new NotFoundError('Email', id);
            const updated = await repository.update(id, { triaged: true });
            return deserialize(updated!)!;
        },

        async delete(id: string) {
            const existing = await repository.findById(id);
            if (!existing) throw new NotFoundError('Email', id);
            await repository.delete(id);
        },

        async countUntriaged() {
            return repository.countUntriaged();
        },
    };
}

// ─── Deserializer — parses JSON columns back to arrays ────────────────────────

function deserialize(email: Awaited<ReturnType<EmailRepository['findById']>>) {
    if (!email) return null;
    return {
        ...email,
        recipients: parseJson<string[]>(email.recipients, []),
        labels:     parseJson<string[]>(email.labels,     ['inbox']),
    };
}

function parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// Default singleton for use in routers
export const emailService = createEmailService();
export type EmailService  = ReturnType<typeof createEmailService>;
export type EmailResponse = NonNullable<ReturnType<typeof deserialize>>;