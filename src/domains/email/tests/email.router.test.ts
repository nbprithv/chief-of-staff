import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { NotFoundError, ValidationError } from '../../../../src/core/errors.js';
import { errorHandler } from '../../../../src/core/middleware/error-handler.js';
import type { EmailService } from '../../../../src/domains/email/email.service.js';

// ── Mock session so all requests appear authenticated ─────────────────────────

vi.mock('../../../../src/core/session.js', () => ({
    getUserId:       vi.fn().mockReturnValue('test@example.com'),
    setUserCookie:   vi.fn(),
    clearUserCookie: vi.fn(),
}));

import { createEmailRouter } from '../../../../src/domains/email/email.router.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock service factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockService(): EmailService {
    return {
        list:           vi.fn().mockResolvedValue([]),
        getById:        vi.fn().mockResolvedValue(null),
        getByGmailId:   vi.fn().mockResolvedValue(null),
        getThread:      vi.fn().mockResolvedValue([]),
        listUntriaged:  vi.fn().mockResolvedValue([]),
        ingest:         vi.fn(),
        update:         vi.fn(),
        markTriaged:    vi.fn(),
        delete:         vi.fn(),
        countUntriaged: vi.fn().mockResolvedValue(0),
    };
}

async function buildApp(service: EmailService) {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(createEmailRouter(service));
    return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let counter = 0;

function makeEmail(overrides: Record<string, unknown> = {}) {
    counter++;
    return {
        id: `id_${counter}`, gmail_id: `gmail_${counter}`, thread_id: null,
        content_hash: 'a'.repeat(64), subject: `Subject ${counter}`,
        sender_email: `sender${counter}@example.com`, sender_name: null,
        recipients: [], body_summary: null, body_raw: `Body ${counter}`,
        labels: ['inbox'], triaged: false,
        received_at: '2024-06-01T09:00:00.000Z',
        created_at: '2024-06-01T09:00:00.000Z', updated_at: '2024-06-01T09:00:00.000Z',
        ...overrides,
    };
}

function makeValidIngestBody(overrides: Record<string, unknown> = {}) {
    counter++;
    return {
        gmail_id: `gmail_${counter}`, subject: `Subject ${counter}`,
        sender_email: `sender${counter}@example.com`,
        received_at: '2024-06-01T09:00:00.000Z',
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /emails
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /emails', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with emails array', async () => {
        vi.mocked(service.list).mockResolvedValue([makeEmail(), makeEmail()] as any);
        const res = await (await buildApp(service)).inject({ method: 'GET', url: '/emails' });
        expect(res.statusCode).toBe(200);
        expect(res.json().emails).toHaveLength(2);
    });

    it('passes triaged=true filter to service', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails?triaged=true' });
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ triaged: true }), expect.any(String));
    });

    it('passes triaged=false filter to service', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails?triaged=false' });
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ triaged: false }), expect.any(String));
    });

    it('passes sender_email filter to service', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails?sender_email=alice@example.com' });
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ sender_email: 'alice@example.com' }), expect.any(String));
    });

    it('passes limit and offset as integers', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails?limit=10&offset=20' });
        expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }), expect.any(String));
    });

    it('does not pass triaged when absent', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails' });
        expect(vi.mocked(service.list).mock.calls[0][0]?.triaged).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /emails/untriaged
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /emails/untriaged', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with emails and count', async () => {
        vi.mocked(service.listUntriaged).mockResolvedValue([makeEmail(), makeEmail()] as any);
        vi.mocked(service.countUntriaged).mockResolvedValue(2);
        const res  = await (await buildApp(service)).inject({ method: 'GET', url: '/emails/untriaged' });
        const body = res.json();
        expect(res.statusCode).toBe(200);
        expect(body.emails).toHaveLength(2);
        expect(body.count).toBe(2);
    });

    it('passes limit to service when provided', async () => {
        const app = await buildApp(service);
        await app.inject({ method: 'GET', url: '/emails/untriaged?limit=5' });
        expect(service.listUntriaged).toHaveBeenCalledWith(expect.any(String), 5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /emails/thread/:thread_id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /emails/thread/:thread_id', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with thread emails', async () => {
        vi.mocked(service.getThread).mockResolvedValue([makeEmail(), makeEmail()] as any);
        const res = await (await buildApp(service)).inject({ method: 'GET', url: '/emails/thread/t_abc' });
        expect(res.statusCode).toBe(200);
        expect(res.json().emails).toHaveLength(2);
        expect(service.getThread).toHaveBeenCalledWith('t_abc', expect.any(String));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /emails/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /emails/:id', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with the email', async () => {
        const email = makeEmail();
        vi.mocked(service.getById).mockResolvedValue(email as any);
        const res = await (await buildApp(service)).inject({ method: 'GET', url: `/emails/${email.id}` });
        expect(res.statusCode).toBe(200);
        expect(res.json().email.id).toBe(email.id);
    });

    it('returns 404 when not found', async () => {
        vi.mocked(service.getById).mockRejectedValue(new NotFoundError('Email', 'x'));
        const res = await (await buildApp(service)).inject({ method: 'GET', url: '/emails/missing' });
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /emails/ingest
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /emails/ingest', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 201 and isDuplicate:false for a new email', async () => {
        const email = makeEmail();
        vi.mocked(service.ingest).mockResolvedValue({ email: email as any, isDuplicate: false });
        const res = await (await buildApp(service)).inject({ method: 'POST', url: '/emails/ingest', payload: makeValidIngestBody() });
        expect(res.statusCode).toBe(201);
        expect(res.json().isDuplicate).toBe(false);
    });

    it('returns 200 and isDuplicate:true for a duplicate', async () => {
        const email = makeEmail();
        vi.mocked(service.ingest).mockResolvedValue({ email: email as any, isDuplicate: true });
        const res = await (await buildApp(service)).inject({ method: 'POST', url: '/emails/ingest', payload: makeValidIngestBody() });
        expect(res.statusCode).toBe(200);
        expect(res.json().isDuplicate).toBe(true);
    });

    it('returns 400 for missing required fields', async () => {
        const res = await (await buildApp(service)).inject({ method: 'POST', url: '/emails/ingest', payload: { subject: 'No sender' } });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for invalid sender_email', async () => {
        const res = await (await buildApp(service)).inject({ method: 'POST', url: '/emails/ingest', payload: makeValidIngestBody({ sender_email: 'bad-email' }) });
        expect(res.statusCode).toBe(400);
    });

    it('does not call service when validation fails', async () => {
        await (await buildApp(service)).inject({ method: 'POST', url: '/emails/ingest', payload: { invalid: true } });
        expect(service.ingest).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /emails/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /emails/:id', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with updated email', async () => {
        const email = makeEmail({ triaged: true });
        vi.mocked(service.update).mockResolvedValue(email as any);
        const res = await (await buildApp(service)).inject({ method: 'PATCH', url: `/emails/${email.id}`, payload: { triaged: true } });
        expect(res.statusCode).toBe(200);
        expect(res.json().email.triaged).toBe(true);
    });

    it('returns 404 when not found', async () => {
        vi.mocked(service.update).mockRejectedValue(new NotFoundError('Email', 'x'));
        const res = await (await buildApp(service)).inject({ method: 'PATCH', url: '/emails/missing', payload: { triaged: true } });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid payload', async () => {
        const res = await (await buildApp(service)).inject({ method: 'PATCH', url: '/emails/x', payload: { triaged: 'not-boolean' } });
        expect(res.statusCode).toBe(400);
    });

    it('accepts empty body', async () => {
        const email = makeEmail();
        vi.mocked(service.update).mockResolvedValue(email as any);
        const res = await (await buildApp(service)).inject({ method: 'PATCH', url: `/emails/${email.id}`, payload: {} });
        expect(res.statusCode).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /emails/:id/triage
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /emails/:id/triage', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 200 with the triaged email', async () => {
        const email = makeEmail({ triaged: true });
        vi.mocked(service.markTriaged).mockResolvedValue(email as any);
        const res = await (await buildApp(service)).inject({ method: 'POST', url: `/emails/${email.id}/triage` });
        expect(res.statusCode).toBe(200);
        expect(res.json().email.triaged).toBe(true);
    });

    it('returns 404 when not found', async () => {
        vi.mocked(service.markTriaged).mockRejectedValue(new NotFoundError('Email', 'x'));
        const res = await (await buildApp(service)).inject({ method: 'POST', url: '/emails/missing/triage' });
        expect(res.statusCode).toBe(404);
    });

    it('passes the correct id to service', async () => {
        const email = makeEmail();
        vi.mocked(service.markTriaged).mockResolvedValue(email as any);
        const app = await buildApp(service);
        await app.inject({ method: 'POST', url: `/emails/${email.id}/triage` });
        expect(service.markTriaged).toHaveBeenCalledWith(email.id, expect.any(String));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /emails/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /emails/:id', () => {
    let service: EmailService;
    beforeEach(() => { counter = 0; service = createMockService(); });

    it('returns 204 on success', async () => {
        vi.mocked(service.delete).mockResolvedValue(undefined);
        const res = await (await buildApp(service)).inject({ method: 'DELETE', url: '/emails/some_id' });
        expect(res.statusCode).toBe(204);
        expect(res.body).toBe('');
    });

    it('returns 404 when not found', async () => {
        vi.mocked(service.delete).mockRejectedValue(new NotFoundError('Email', 'x'));
        const res = await (await buildApp(service)).inject({ method: 'DELETE', url: '/emails/missing' });
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('passes the correct id to service', async () => {
        vi.mocked(service.delete).mockResolvedValue(undefined);
        const app = await buildApp(service);
        await app.inject({ method: 'DELETE', url: '/emails/target_id' });
        expect(service.delete).toHaveBeenCalledWith('target_id', expect.any(String));
    });
});