import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundError } from '../../../core/errors.js';
import { hashEmail } from '../../../db/schema/emails.schema.js';
import type { EmailRepository } from '../email.repository.js';
import { createEmailService } from '../email.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock repository factory
// ─────────────────────────────────────────────────────────────────────────────

function createMockRepo(): EmailRepository {
    return {
        findAll:           vi.fn().mockResolvedValue([]),
        findById:          vi.fn().mockResolvedValue(null),
        findByGmailId:     vi.fn().mockResolvedValue(null),
        findByContentHash: vi.fn().mockResolvedValue(null),
        findByThreadId:    vi.fn().mockResolvedValue([]),
        findUntriaged:     vi.fn().mockResolvedValue([]),
        create:            vi.fn(),
        update:            vi.fn(),
        delete:            vi.fn(),
        countUntriaged:    vi.fn().mockResolvedValue(0),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let counter = 0;

function makeStoredEmail(overrides: Record<string, unknown> = {}) {
    counter++;
    return {
        id:           `id_${counter}`,
        gmail_id:     `gmail_${counter}`,
        thread_id:    null,
        content_hash: 'a'.repeat(64),
        subject:      `Subject ${counter}`,
        sender_email: `sender${counter}@example.com`,
        sender_name:  'Sender Name',
        recipients:   '["recipient@example.com"]',
        body_summary: null,
        body_raw:     `Body ${counter}`,
        labels:       '["inbox"]',
        triaged:      false,
        received_at:  '2024-06-01T09:00:00.000Z',
        created_at:   '2024-06-01T09:00:00.000Z',
        updated_at:   '2024-06-01T09:00:00.000Z',
        ...overrides,
    };
}

function makeCreateInput(overrides: Record<string, unknown> = {}) {
    counter++;
    return {
        gmail_id:     `gmail_${counter}`,
        subject:      `Subject ${counter}`,
        sender_email: `sender${counter}@example.com`,
        received_at:  '2024-06-01T09:00:00.000Z',
        body_raw:     `Body ${counter}`,
        recipients:   ['recipient@example.com'],
        labels:       ['inbox'],
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// list()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.list()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns deserialized emails from the repository', async () => {
        const stored = [
            makeStoredEmail({ recipients: '["a@b.com"]', labels: '["inbox"]' }),
            makeStoredEmail({ recipients: '[]',           labels: '["done"]'  }),
        ];
        vi.mocked(repo.findAll).mockResolvedValue(stored as any);

        const service = createEmailService(repo);
        const result  = await service.list(undefined, 'test-user');

        expect(result).toHaveLength(2);
        expect(result[0]!.recipients).toEqual(['a@b.com']);
        expect(result[0]!.labels).toEqual(['inbox']);
        expect(result[1]!.recipients).toEqual([]);
        expect(result[1]!.labels).toEqual(['done']);
    });

    it('passes filters through to the repository', async () => {
        const service = createEmailService(repo);
        await service.list({ triaged: false, sender_email: 'alice@example.com', limit: 10 }, 'test-user');
        expect(repo.findAll).toHaveBeenCalledWith({ triaged: false, sender_email: 'alice@example.com', limit: 10, userId: 'test-user' });
    });

    it('returns empty array when repository returns nothing', async () => {
        const service = createEmailService(repo);
        expect(await service.list(undefined, 'test-user')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getById()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.getById()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns a deserialized email when found', async () => {
        const stored = makeStoredEmail({ labels: '["inbox","flagged"]' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);

        const service = createEmailService(repo);
        const result  = await service.getById(stored.id, 'test-user');

        expect(result.id).toBe(stored.id);
        expect(result.labels).toEqual(['inbox', 'flagged']);
    });

    it('throws NotFoundError when email does not exist', async () => {
        const service = createEmailService(repo);
        await expect(service.getById('missing_id', 'test-user')).rejects.toThrow(NotFoundError);
    });

    it('calls findById with the correct id', async () => {
        const stored = makeStoredEmail();
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        await service.getById(stored.id, 'test-user');
        expect(repo.findById).toHaveBeenCalledWith(stored.id, 'test-user');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getByGmailId()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.getByGmailId()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns a deserialized email when found', async () => {
        const stored = makeStoredEmail();
        vi.mocked(repo.findByGmailId).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        const result  = await service.getByGmailId(stored.gmail_id, 'test-user');
        expect(result.gmail_id).toBe(stored.gmail_id);
    });

    it('throws NotFoundError when not found', async () => {
        const service = createEmailService(repo);
        await expect(service.getByGmailId('missing', 'test-user')).rejects.toThrow(NotFoundError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getThread()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.getThread()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns all deserialized emails in the thread', async () => {
        const thread = [makeStoredEmail(), makeStoredEmail(), makeStoredEmail()];
        vi.mocked(repo.findByThreadId).mockResolvedValue(thread as any);
        const service = createEmailService(repo);
        const result  = await service.getThread('thread_abc', 'test-user');
        expect(result).toHaveLength(3);
        expect(repo.findByThreadId).toHaveBeenCalledWith('thread_abc', 'test-user');
    });

    it('returns empty array for unknown thread', async () => {
        const service = createEmailService(repo);
        expect(await service.getThread('unknown', 'test-user')).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// listUntriaged()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.listUntriaged()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns deserialized untriaged emails', async () => {
        const untriaged = [makeStoredEmail({ triaged: false }), makeStoredEmail({ triaged: false })];
        vi.mocked(repo.findUntriaged).mockResolvedValue(untriaged as any);
        const service = createEmailService(repo);
        const result  = await service.listUntriaged('test-user');
        expect(result).toHaveLength(2);
        expect(result.every(e => e!.triaged === false)).toBe(true);
    });

    it('passes limit to repository', async () => {
        const service = createEmailService(repo);
        await service.listUntriaged('test-user', 25);
        expect(repo.findUntriaged).toHaveBeenCalledWith('test-user', 25);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ingest()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.ingest()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('creates and returns a new email with isDuplicate:false', async () => {
        const input   = makeCreateInput();
        const created = makeStoredEmail({ gmail_id: input.gmail_id });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null as any);
        vi.mocked(repo.create).mockResolvedValue(created as any);

        const service = createEmailService(repo);
        const result  = await service.ingest(input as any, 'test-user');

        expect(result.isDuplicate).toBe(false);
        expect(repo.create).toHaveBeenCalledOnce();
    });

    it('returns existing email with isDuplicate:true when hash matches', async () => {
        const input    = makeCreateInput();
        const existing = makeStoredEmail({ gmail_id: input.gmail_id });
        vi.mocked(repo.findByContentHash).mockResolvedValue(existing as any);

        const service = createEmailService(repo);
        const result  = await service.ingest(input as any, 'test-user');

        expect(result.isDuplicate).toBe(true);
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('passes the correct content_hash to findByContentHash', async () => {
        const input = makeCreateInput();
        const expectedHash = hashEmail({
            gmail_id:     input.gmail_id as string,
            sender_email: input.sender_email as string,
            received_at:  input.received_at as string,
            subject:      input.subject as string,
            body_raw:     input.body_raw as string,
        });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null as any);
        vi.mocked(repo.create).mockResolvedValue(makeStoredEmail() as any);

        const service = createEmailService(repo);
        await service.ingest(input as any, 'test-user');

        expect(repo.findByContentHash).toHaveBeenCalledWith(expectedHash, 'test-user');
    });

    it('serializes recipients and labels as JSON', async () => {
        const input = makeCreateInput({ recipients: ['a@b.com'], labels: ['inbox', 'flagged'] });
        vi.mocked(repo.findByContentHash).mockResolvedValue(null as any);
        vi.mocked(repo.create).mockResolvedValue(makeStoredEmail() as any);

        const service = createEmailService(repo);
        await service.ingest(input as any, 'test-user');

        const arg = vi.mocked(repo.create).mock.calls[0][0];
        expect(arg.recipients).toBe('["a@b.com"]');
        expect(arg.labels).toBe('["inbox","flagged"]');
    });

    it('defaults recipients to [] and labels to ["inbox"]', async () => {
        const { recipients: _r, labels: _l, ...stripped } = makeCreateInput();
        vi.mocked(repo.findByContentHash).mockResolvedValue(null as any);
        vi.mocked(repo.create).mockResolvedValue(makeStoredEmail() as any);

        const service = createEmailService(repo);
        await service.ingest(stripped as any, 'test-user');

        const arg = vi.mocked(repo.create).mock.calls[0][0];
        expect(arg.recipients).toBe('[]');
        expect(arg.labels).toBe('["inbox"]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// update()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.update()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('throws NotFoundError when email does not exist', async () => {
        const service = createEmailService(repo);
        await expect(service.update('missing', { triaged: true }, 'test-user')).rejects.toThrow(NotFoundError);
    });

    it('serializes labels to JSON', async () => {
        const stored  = makeStoredEmail();
        const updated = makeStoredEmail({ ...stored, labels: '["done"]' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.update).mockResolvedValue(updated as any);

        const service = createEmailService(repo);
        await service.update(stored.id, { labels: ['done'] }, 'test-user');

        expect(repo.update).toHaveBeenCalledWith(stored.id, 'test-user', expect.objectContaining({ labels: '["done"]' }));
    });

    it('only passes defined fields to the repository', async () => {
        const stored  = makeStoredEmail();
        const updated = makeStoredEmail({ ...stored, triaged: true });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.update).mockResolvedValue(updated as any);

        const service = createEmailService(repo);
        await service.update(stored.id, { triaged: true }, 'test-user');

        const arg = vi.mocked(repo.update).mock.calls[0][2];
        expect(arg).not.toHaveProperty('body_summary');
        expect(arg).toHaveProperty('triaged', true);
    });

    it('returns the deserialized updated email', async () => {
        const stored  = makeStoredEmail();
        const updated = makeStoredEmail({ ...stored, labels: '["action_required"]', triaged: true });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.update).mockResolvedValue(updated as any);

        const service = createEmailService(repo);
        const result  = await service.update(stored.id, { triaged: true }, 'test-user');

        expect(result.labels).toEqual(['action_required']);
        expect(result.triaged).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// markTriaged()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.markTriaged()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('throws NotFoundError when email does not exist', async () => {
        const service = createEmailService(repo);
        await expect(service.markTriaged('missing', 'test-user')).rejects.toThrow(NotFoundError);
    });

    it('calls update with triaged: true', async () => {
        const stored  = makeStoredEmail({ triaged: false });
        const updated = makeStoredEmail({ ...stored, triaged: true });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.update).mockResolvedValue(updated as any);

        const service = createEmailService(repo);
        await service.markTriaged(stored.id, 'test-user');

        expect(repo.update).toHaveBeenCalledWith(stored.id, 'test-user', { triaged: true });
    });

    it('returns the updated email with triaged: true', async () => {
        const stored  = makeStoredEmail({ triaged: false });
        const updated = makeStoredEmail({ ...stored, triaged: true });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.update).mockResolvedValue(updated as any);

        const service = createEmailService(repo);
        const result  = await service.markTriaged(stored.id, 'test-user');
        expect(result.triaged).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.delete()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('throws NotFoundError when email does not exist', async () => {
        const service = createEmailService(repo);
        await expect(service.delete('missing', 'test-user')).rejects.toThrow(NotFoundError);
    });

    it('calls repository.delete with the correct id', async () => {
        const stored = makeStoredEmail();
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.delete).mockResolvedValue(stored as any);

        const service = createEmailService(repo);
        await service.delete(stored.id, 'test-user');
        expect(repo.delete).toHaveBeenCalledWith(stored.id, 'test-user');
    });

    it('returns void on success', async () => {
        const stored = makeStoredEmail();
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        vi.mocked(repo.delete).mockResolvedValue(stored as any);

        const service = createEmailService(repo);
        expect(await service.delete(stored.id, 'test-user')).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countUntriaged()
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.countUntriaged()', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('returns the count from the repository', async () => {
        vi.mocked(repo.countUntriaged).mockResolvedValue(7);
        const service = createEmailService(repo);
        expect(await service.countUntriaged('test-user')).toBe(7);
    });

    it('returns 0 when there are no untriaged emails', async () => {
        const service = createEmailService(repo);
        expect(await service.countUntriaged('test-user')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deserialization
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService — deserialization', () => {
    let repo: EmailRepository;
    beforeEach(() => { counter = 0; repo = createMockRepo(); vi.clearAllMocks(); });

    it('parses recipients JSON string into an array', async () => {
        const stored = makeStoredEmail({ recipients: '["a@b.com","c@d.com"]' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        const result  = await service.getById(stored.id, 'test-user');
        expect(result.recipients).toEqual(['a@b.com', 'c@d.com']);
    });

    it('parses labels JSON string into an array', async () => {
        const stored = makeStoredEmail({ labels: '["inbox","flagged"]' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        const result  = await service.getById(stored.id, 'test-user');
        expect(result.labels).toEqual(['inbox', 'flagged']);
    });

    it('falls back to [] for malformed recipients JSON', async () => {
        const stored = makeStoredEmail({ recipients: 'not-valid-json' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        const result  = await service.getById(stored.id, 'test-user');
        expect(result.recipients).toEqual([]);
    });

    it('falls back to ["inbox"] for malformed labels JSON', async () => {
        const stored = makeStoredEmail({ labels: 'not-valid-json' });
        vi.mocked(repo.findById).mockResolvedValue(stored as any);
        const service = createEmailService(repo);
        const result  = await service.getById(stored.id, 'test-user');
        expect(result.labels).toEqual(['inbox']);
    });
});