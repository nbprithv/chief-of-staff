import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalServiceError } from '../../../core/errors.js';
import { config } from '../../../core/config.js';

// ── Mock googleapis ───────────────────────────────────────────────────────────

const mockMessagesList = vi.fn();
const mockMessagesGet  = vi.fn();
const mockLabelsList   = vi.fn();

vi.mock('googleapis', () => ({
    google: {
        gmail: vi.fn().mockReturnValue({
            users: {
                messages: { list: mockMessagesList, get: mockMessagesGet },
                labels:   { list: mockLabelsList },
            },
        }),
    },
}));

// ── Mock OAuth client ─────────────────────────────────────────────────────────

vi.mock('../google-oauth.client.js', () => ({
    getAuthenticatedClient: vi.fn().mockResolvedValue({ /* fake client */ }),
}));

// Import after mocks
const { createGmailSyncService } = await import(
    '../gmail-sync.service.js'
    );

// ─────────────────────────────────────────────────────────────────────────────
// Mock repository factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockRepo() {
    return {
        findAll:           vi.fn().mockResolvedValue([]),
        findById:          vi.fn().mockResolvedValue(null),
        findByGmailId:     vi.fn().mockResolvedValue(null),
        findByContentHash: vi.fn().mockResolvedValue(null),
        findByThreadId:    vi.fn().mockResolvedValue([]),
        findUntriaged:     vi.fn().mockResolvedValue([]),
        create:            vi.fn().mockResolvedValue({}),
        update:            vi.fn().mockResolvedValue({}),
        delete:            vi.fn().mockResolvedValue({}),
        countUntriaged:    vi.fn().mockResolvedValue(0),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail message fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeGmailMessage(overrides: Record<string, any> = {}) {
    return {
        id:       'msg_001',
        threadId: 'thread_001',
        labelIds: ['INBOX', 'UNREAD'],
        payload: {
            headers: [
                { name: 'From',    value: 'Alice Smith <alice@example.com>' },
                { name: 'To',      value: 'bob@example.com' },
                { name: 'Subject', value: 'Test email subject' },
                { name: 'Date',    value: 'Mon, 10 Jun 2024 14:32:00 +0000' },
            ],
            body: {
                data: Buffer.from('Hello, this is the email body.').toString('base64url'),
            },
        },
        ...overrides,
    };
}

function makeMultipartMessage() {
    return {
        id: 'msg_multi', threadId: 'thread_multi', labelIds: ['INBOX'],
        payload: {
            mimeType: 'multipart/alternative',
            headers: [
                { name: 'From',    value: 'sender@example.com' },
                { name: 'To',      value: 'recipient@example.com' },
                { name: 'Subject', value: 'Multipart email' },
                { name: 'Date',    value: 'Mon, 10 Jun 2024 10:00:00 +0000' },
            ],
            parts: [
                {
                    mimeType: 'text/html',
                    body: { data: Buffer.from('<p>HTML body</p>').toString('base64url') },
                },
                {
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Plain text body').toString('base64url') },
                },
            ],
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMessageIds()
// ─────────────────────────────────────────────────────────────────────────────

const mockLabelsResponse = { data: { labels: [
    { id: 'INBOX',    name: 'INBOX' },
    { id: 'galloway', name: 'galloway' },
    { id: 'STARRED',  name: 'STARRED' },
] } };

describe('gmailSyncService.listMessageIds()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLabelsList.mockResolvedValue(mockLabelsResponse);
    });

    it('returns message ids from Gmail', async () => {
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }] },
        });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.listMessageIds({ label: 'INBOX' }, 'test-user');
        expect(result.ids).toEqual(['id1', 'id2', 'id3']);
    });

    it('returns nextPageToken when present', async () => {
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'id1' }], nextPageToken: 'tok_abc' },
        });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.listMessageIds({}, 'test-user');
        expect(result.nextPageToken).toBe('tok_abc');
    });

    it('returns undefined nextPageToken when absent', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.listMessageIds({}, 'test-user');
        expect(result.nextPageToken).toBeUndefined();
    });

    it('returns empty ids when no messages exist', async () => {
        mockMessagesList.mockResolvedValue({ data: {} });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.listMessageIds({}, 'test-user');
        expect(result.ids).toEqual([]);
    });

    it('defaults label to GMAIL_LABEL env var', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        await service.listMessageIds({}, 'test-user');
        expect(mockMessagesList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: [config.GMAIL_LABEL] })
        );
    });

    it('caps maxResults at 100', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        await service.listMessageIds({ maxEmails: 999 }, 'test-user');
        expect(mockMessagesList).toHaveBeenCalledWith(
            expect.objectContaining({ maxResults: 100 })
        );
    });

    it('passes pageToken when provided', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        await service.listMessageIds({ pageToken: 'page_xyz' }, 'test-user');
        expect(mockMessagesList).toHaveBeenCalledWith(
            expect.objectContaining({ pageToken: 'page_xyz' })
        );
    });

    it('throws ExternalServiceError when Gmail API fails', async () => {
        mockMessagesList.mockRejectedValue(new Error('API quota exceeded'));
        const service = createGmailSyncService(createMockRepo() as any);
        await expect(service.listMessageIds({}, 'test-user')).rejects.toThrow(ExternalServiceError);
    });

    it('includes the error message in the ExternalServiceError', async () => {
        mockMessagesList.mockRejectedValue(new Error('API quota exceeded'));
        const service = createGmailSyncService(createMockRepo() as any);
        await expect(service.listMessageIds({}, 'test-user')).rejects.toThrow('API quota exceeded');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchMessage()
// ─────────────────────────────────────────────────────────────────────────────

describe('gmailSyncService.fetchMessage()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns a parsed FetchedEmail', async () => {
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage() });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('msg_001', 'test-user');

        expect(email.gmail_id).toBe('msg_001');
        expect(email.thread_id).toBe('thread_001');
        expect(email.subject).toBe('Test email subject');
        expect(email.sender_name).toBe('Alice Smith');
        expect(email.sender_email).toBe('alice@example.com');
        expect(email.recipients).toContain('bob@example.com');
        expect(email.body_raw).toContain('Hello, this is the email body.');
    });

    it('parses a From header with no display name', async () => {
        const msg = makeGmailMessage({
            payload: {
                ...makeGmailMessage().payload,
                headers: [
                    { name: 'From',    value: 'plain@example.com' },
                    { name: 'To',      value: '' },
                    { name: 'Subject', value: 'Plain from' },
                    { name: 'Date',    value: 'Mon, 10 Jun 2024 14:32:00 +0000' },
                ],
            },
        });
        mockMessagesGet.mockResolvedValue({ data: msg });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('msg_001', 'test-user');

        expect(email.sender_name).toBeNull();
        expect(email.sender_email).toBe('plain@example.com');
    });

    it('uses (no subject) when Subject header is missing', async () => {
        const msg = makeGmailMessage({
            payload: {
                ...makeGmailMessage().payload,
                headers: [
                    { name: 'From', value: 'a@b.com' },
                    { name: 'Date', value: 'Mon, 10 Jun 2024 14:32:00 +0000' },
                ],
            },
        });
        mockMessagesGet.mockResolvedValue({ data: msg });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('x', 'test-user');
        expect(email.subject).toBe('(no subject)');
    });

    it('handles multiple recipients', async () => {
        const msg = makeGmailMessage({
            payload: {
                ...makeGmailMessage().payload,
                headers: [
                    { name: 'From',    value: 'a@b.com' },
                    { name: 'To',      value: 'x@y.com, z@w.com, q@r.com' },
                    { name: 'Subject', value: 'Multi recipient' },
                    { name: 'Date',    value: 'Mon, 10 Jun 2024 14:32:00 +0000' },
                ],
            },
        });
        mockMessagesGet.mockResolvedValue({ data: msg });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('x', 'test-user');
        expect(email.recipients).toHaveLength(3);
        expect(email.recipients).toContain('z@w.com');
    });

    it('prefers text/plain in a multipart message', async () => {
        mockMessagesGet.mockResolvedValue({ data: makeMultipartMessage() });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('msg_multi', 'test-user');
        expect(email.body_raw).toBe('Plain text body');
    });

    it('includes Gmail labels on the email', async () => {
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage() });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('msg_001', 'test-user');
        expect(email.labels).toContain('INBOX');
        expect(email.labels).toContain('UNREAD');
    });

    it('converts received_at to ISO 8601', async () => {
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage() });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('msg_001', 'test-user');
        expect(email.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('truncates body_raw to 10000 characters', async () => {
        const longBody = 'x'.repeat(15000);
        const msg = makeGmailMessage({
            payload: {
                headers: makeGmailMessage().payload.headers,
                body: { data: Buffer.from(longBody).toString('base64url') },
            },
        });
        mockMessagesGet.mockResolvedValue({ data: msg });
        const service = createGmailSyncService(createMockRepo() as any);
        const email   = await service.fetchMessage('x', 'test-user');
        expect(email.body_raw.length).toBeLessThanOrEqual(10000);
    });

    it('throws ExternalServiceError when Gmail API fails', async () => {
        mockMessagesGet.mockRejectedValue(new Error('Message not found'));
        const service = createGmailSyncService(createMockRepo() as any);
        await expect(service.fetchMessage('bad_id', 'test-user')).rejects.toThrow(ExternalServiceError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync()
// ─────────────────────────────────────────────────────────────────────────────

describe('gmailSyncService.sync()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLabelsList.mockResolvedValue(mockLabelsResponse);
    });

    it('returns zeroed result when no messages are found', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.sync({}, 'test-user');
        expect(result).toEqual({ fetched: 0, stored: 0, duplicates: 0, errors: 0 });
    });

    it('fetches, deduplicates, and stores new emails', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'msg1' }, { id: 'msg2' }] },
        });
        mockMessagesGet
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg1', threadId: 't1' }) })
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg2', threadId: 't2' }) });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null);

        const service = createGmailSyncService(repo as any);
        const result  = await service.sync({ label: 'INBOX' }, 'test-user');

        expect(result.fetched).toBe(2);
        expect(result.stored).toBe(2);
        expect(result.duplicates).toBe(0);
        expect(result.errors).toBe(0);
        expect(repo.create).toHaveBeenCalledTimes(2);
    });

    it('skips duplicate emails (content_hash match)', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'msg1' }, { id: 'msg2' }] },
        });
        mockMessagesGet
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg1' }) })
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg2' }) });
        // First is new, second is a content-hash duplicate
        vi.mocked(repo.findByContentHash)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'existing' } as any);

        const service = createGmailSyncService(repo as any);
        const result  = await service.sync({}, 'test-user');

        expect(result.stored).toBe(1);
        expect(result.duplicates).toBe(1);
        expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('skips duplicate emails (gmail_id match) without fetching message body', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'msg1' }, { id: 'msg2' }] },
        });
        // msg1 already in DB by gmail_id; msg2 is new
        vi.mocked(repo.findByGmailId)
            .mockResolvedValueOnce({ id: 'existing' } as any)
            .mockResolvedValueOnce(null);
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage({ id: 'msg2' }) });

        const service = createGmailSyncService(repo as any);
        const result  = await service.sync({}, 'test-user');

        expect(result.duplicates).toBe(1);
        expect(result.stored).toBe(1);
        // fetchMessage should only be called once (for msg2)
        expect(mockMessagesGet).toHaveBeenCalledTimes(1);
    });

    it('counts errors when a message fetch fails and continues processing', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'msg1' }, { id: 'msg2' }, { id: 'msg3' }] },
        });
        mockMessagesGet
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg1' }) })
            .mockRejectedValueOnce(new Error('Network error on msg2'))
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg3' }) });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null);

        const service = createGmailSyncService(repo as any);
        const result  = await service.sync({}, 'test-user');

        expect(result.fetched).toBe(2);
        expect(result.stored).toBe(2);
        expect(result.errors).toBe(1);
    });

    it('stores email with serialized recipients and labels as JSON', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg1' }] } });
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage() });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null);

        const service = createGmailSyncService(repo as any);
        await service.sync({}, 'test-user');

        const createArg = vi.mocked(repo.create).mock.calls[0][0];
        expect(() => JSON.parse(createArg.recipients as string)).not.toThrow();
        expect(() => JSON.parse(createArg.labels     as string)).not.toThrow();
        expect(JSON.parse(createArg.labels as string)).toContain('INBOX');
    });

    it('stores body_summary as null (populated later by AI pipeline)', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({ data: { messages: [{ id: 'msg1' }] } });
        mockMessagesGet.mockResolvedValue({ data: makeGmailMessage() });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null);

        const service = createGmailSyncService(repo as any);
        await service.sync({}, 'test-user');

        const createArg = vi.mocked(repo.create).mock.calls[0][0];
        expect(createArg.body_summary).toBeNull();
    });

    it('includes nextPageToken in the result when present', async () => {
        mockMessagesList.mockResolvedValue({
            data: { messages: [], nextPageToken: 'page_xyz' },
        });
        const service = createGmailSyncService(createMockRepo() as any);
        const result  = await service.sync({}, 'test-user');
        expect(result.nextPageToken).toBe('page_xyz');
    });

    it('uses GMAIL_LABEL env var as default label', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        await service.sync({}, 'test-user');
        expect(mockMessagesList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: [config.GMAIL_LABEL] })
        );
    });

    it('passes custom label to listMessageIds', async () => {
        mockMessagesList.mockResolvedValue({ data: { messages: [] } });
        const service = createGmailSyncService(createMockRepo() as any);
        await service.sync({ label: 'STARRED' });
        expect(mockMessagesList).toHaveBeenCalledWith(
            expect.objectContaining({ labelIds: ['STARRED'] })
        );
    });

    it('generates a unique id for each stored email', async () => {
        const repo = createMockRepo();
        mockMessagesList.mockResolvedValue({
            data: { messages: [{ id: 'msg1' }, { id: 'msg2' }] },
        });
        mockMessagesGet
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg1' }) })
            .mockResolvedValueOnce({ data: makeGmailMessage({ id: 'msg2' }) });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null);

        const service = createGmailSyncService(repo as any);
        await service.sync({}, 'test-user');

        const ids = vi.mocked(repo.create).mock.calls.map(c => c[0].id);
        expect(new Set(ids).size).toBe(2);
    });

    it('throws when listMessageIds itself fails (not a per-message error)', async () => {
        mockMessagesList.mockRejectedValue(new Error('Auth error'));
        const service = createGmailSyncService(createMockRepo() as any);
        await expect(service.sync({}, 'test-user')).rejects.toThrow(ExternalServiceError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// listLabels()
// ─────────────────────────────────────────────────────────────────────────────

describe('gmailSyncService.listLabels()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns mapped labels from Gmail', async () => {
        mockLabelsList.mockResolvedValue({
            data: {
                labels: [
                    { id: 'INBOX',   name: 'INBOX',   type: 'system' },
                    { id: 'STARRED', name: 'STARRED', type: 'system' },
                    { id: 'Label_1', name: 'Work',    type: 'user'   },
                ],
            },
        });
        const service = createGmailSyncService(createMockRepo() as any);
        const labels  = await service.listLabels('test-user');

        expect(labels).toHaveLength(3);
        expect(labels[0]).toEqual({ id: 'INBOX', name: 'INBOX', type: 'system' });
        expect(labels[2]).toEqual({ id: 'Label_1', name: 'Work', type: 'user' });
    });

    it('returns empty array when no labels exist', async () => {
        mockLabelsList.mockResolvedValue({ data: {} });
        const service = createGmailSyncService(createMockRepo() as any);
        const labels  = await service.listLabels('test-user');
        expect(labels).toEqual([]);
    });

    it('throws ExternalServiceError when Gmail API fails', async () => {
        mockLabelsList.mockRejectedValue(new Error('Unauthorized'));
        const service = createGmailSyncService(createMockRepo() as any);
        await expect(service.listLabels('test-user')).rejects.toThrow(ExternalServiceError);
    });
});