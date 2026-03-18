import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { createGmailSyncRouter } from '../../../../src/integrations/google/gmail-sync.router.js';
import { errorHandler } from '../../../../src/core/middleware/error-handler.js';
import { ExternalServiceError } from '../../../../src/core/errors.js';
import { config } from '../../../../src/core/config.js';
import type { GmailSyncService } from '../../../../src/integrations/google/gmail-sync.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock service factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockService(): GmailSyncService {
    return {
        resolveLabelId: vi.fn(),
        listMessageIds: vi.fn(),
        fetchMessage:   vi.fn(),
        sync:           vi.fn(),
        listLabels:     vi.fn(),
    };
}

async function buildApp(service: GmailSyncService) {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(createGmailSyncRouter(service));
    return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /integrations/google/sync
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /integrations/google/sync', () => {
    let service: GmailSyncService;
    beforeEach(() => { service = createMockService(); vi.clearAllMocks(); });

    it('returns 200 with sync result', async () => {
        const syncResult = { fetched: 5, stored: 4, duplicates: 1, errors: 0 };
        vi.mocked(service.sync).mockResolvedValue(syncResult);

        const res  = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { label: 'INBOX', max_emails: 20 },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().result).toEqual(syncResult);
    });

    it('passes label and max_emails to service.sync', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { label: 'STARRED', max_emails: 30 },
        });

        expect(service.sync).toHaveBeenCalledWith({ label: 'STARRED', maxEmails: 30 });
    });

    it('uses default label from GMAIL_LABEL env var and max_emails 50 when body is empty', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: '/integrations/google/sync', payload: {} });

        expect(service.sync).toHaveBeenCalledWith({ label: config.GMAIL_LABEL, maxEmails: 50 });
    });

    it('uses defaults when no body is provided', async () => {
        vi.mocked(service.sync).mockResolvedValue({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });

        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: '/integrations/google/sync' });

        expect(service.sync).toHaveBeenCalledWith({ label: config.GMAIL_LABEL, maxEmails: 50 });
    });

    it('returns 400 when max_emails exceeds 100', async () => {
        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { label: 'INBOX', max_emails: 200 },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when max_emails is zero', async () => {
        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { label: 'INBOX', max_emails: 0 },
        });

        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when max_emails is negative', async () => {
        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { label: 'INBOX', max_emails: -5 },
        });

        expect(res.statusCode).toBe(400);
    });

    it('does not call service when validation fails', async () => {
        await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: { max_emails: 200 },
        });

        expect(service.sync).not.toHaveBeenCalled();
    });

    it('returns 502 when Gmail API is unavailable', async () => {
        vi.mocked(service.sync).mockRejectedValue(
            new ExternalServiceError('Gmail', 'Auth error')
        );

        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: {},
        });

        expect(res.statusCode).toBe(502);
    });

    it('includes nextPageToken in result when Gmail returns one', async () => {
        vi.mocked(service.sync).mockResolvedValue({
            fetched: 50, stored: 50, duplicates: 0, errors: 0, nextPageToken: 'page_abc',
        });

        const res = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync',
            payload: {},
        });

        expect(res.json().result.nextPageToken).toBe('page_abc');
    });

    it('exposes all sync result fields', async () => {
        vi.mocked(service.sync).mockResolvedValue({
            fetched: 10, stored: 8, duplicates: 2, errors: 1,
        });

        const res  = await (await buildApp(service)).inject({
            method: 'POST', url: '/integrations/google/sync', payload: {},
        });
        const result = res.json().result;

        expect(result).toHaveProperty('fetched',    10);
        expect(result).toHaveProperty('stored',     8);
        expect(result).toHaveProperty('duplicates', 2);
        expect(result).toHaveProperty('errors',     1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /integrations/google/labels
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /integrations/google/labels', () => {
    let service: GmailSyncService;
    beforeEach(() => { service = createMockService(); vi.clearAllMocks(); });

    it('returns 200 with labels array', async () => {
        const labels = [
            { id: 'INBOX',   name: 'INBOX',   type: 'system' },
            { id: 'STARRED', name: 'STARRED', type: 'system' },
            { id: 'Label_1', name: 'Work',    type: 'user'   },
        ];
        vi.mocked(service.listLabels).mockResolvedValue(labels);

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/labels',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().labels).toHaveLength(3);
        expect(res.json().labels[0]).toEqual({ id: 'INBOX', name: 'INBOX', type: 'system' });
    });

    it('returns empty labels array when none exist', async () => {
        vi.mocked(service.listLabels).mockResolvedValue([]);

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/labels',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().labels).toEqual([]);
    });

    it('calls service.listLabels once', async () => {
        vi.mocked(service.listLabels).mockResolvedValue([]);

        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/integrations/google/labels' });

        expect(service.listLabels).toHaveBeenCalledOnce();
    });

    it('returns 502 when Gmail API is unavailable', async () => {
        vi.mocked(service.listLabels).mockRejectedValue(
            new ExternalServiceError('Gmail', 'Not authenticated')
        );

        const res = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/labels',
        });

        expect(res.statusCode).toBe(502);
    });

    it('includes id, name and type on each label', async () => {
        vi.mocked(service.listLabels).mockResolvedValue([
            { id: 'Label_42', name: 'Personal', type: 'user' },
        ]);

        const res   = await (await buildApp(service)).inject({
            method: 'GET', url: '/integrations/google/labels',
        });
        const label = res.json().labels[0];

        expect(label).toHaveProperty('id',   'Label_42');
        expect(label).toHaveProperty('name', 'Personal');
        expect(label).toHaveProperty('type', 'user');
    });
});