import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalServiceError } from '../../core/errors';

// ── Mock Anthropic SDK before importing the module under test ─────────────────

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
    default: vi.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
    })),
}));

// Import after mock is set up
const { analyzeEmail, analyzeEmailBatch } = await import('../email-analyze');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeClaudeResponse(text: string) {
    return {
        content: [{ type: 'text', text }],
    };
}

function makeValidAnalysisJson() {
    return JSON.stringify({
        summary:         'Alice is requesting a Q3 budget review.',
        priority:        'high',
        actions:         ['Review budget', 'Reply by Friday'],
        key_info:        'Deadline: Friday',
        suggested_reply: 'Thanks, I will review and reply by Friday.',
    });
}

function makeValidBatchJson(count: number) {
    return JSON.stringify({
        summary:     `Batch summary for ${count} emails.`,
        priority:    'medium',
        actions:     ['Action 1', 'Action 2'],
        key_info:    'Key date: June 15',
        email_count: count,
    });
}

const BASE_EMAIL = {
    sender_name:  'Alice Smith',
    sender_email: 'alice@example.com',
    subject:      'Q3 budget review',
    body_raw:     'Please review the Q3 budget.',
    body_summary: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// analyzeEmail()
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeEmail()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns parsed analysis on success', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidAnalysisJson()));

        const result = await analyzeEmail(BASE_EMAIL);

        expect(result.summary).toBe('Alice is requesting a Q3 budget review.');
        expect(result.priority).toBe('high');
        expect(result.actions).toEqual(['Review budget', 'Reply by Friday']);
        expect(result.key_info).toBe('Deadline: Friday');
        expect(result.suggested_reply).toBe('Thanks, I will review and reply by Friday.');
    });

    it('calls the Anthropic API with a user message', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidAnalysisJson()));

        await analyzeEmail(BASE_EMAIL);

        expect(mockCreate).toHaveBeenCalledOnce();
        const call = mockCreate.mock.calls[0][0];
        expect(call.messages[0].role).toBe('user');
        expect(call.messages[0].content).toContain('alice@example.com');
        expect(call.messages[0].content).toContain('Q3 budget review');
    });

    it('strips markdown fences from the response before parsing', async () => {
        const withFences = '```json\n' + makeValidAnalysisJson() + '\n```';
        mockCreate.mockResolvedValue(makeClaudeResponse(withFences));

        const result = await analyzeEmail(BASE_EMAIL);
        expect(result.summary).toBe('Alice is requesting a Q3 budget review.');
    });

    it('returns fallback when Claude returns malformed JSON', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse('This is not JSON at all.'));

        const result = await analyzeEmail(BASE_EMAIL);

        expect(result.summary).toBe('Could not parse analysis.');
        expect(result.priority).toBe('medium');
        expect(result.actions).toEqual([]);
        expect(result.key_info).toBeNull();
        expect(result.suggested_reply).toBeNull();
    });

    it('throws ExternalServiceError when the API call fails', async () => {
        mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

        await expect(analyzeEmail(BASE_EMAIL)).rejects.toThrow(ExternalServiceError);
    });

    it('includes the error message in the ExternalServiceError', async () => {
        mockCreate.mockRejectedValue(new Error('Connection timeout'));

        await expect(analyzeEmail(BASE_EMAIL)).rejects.toThrow('Connection timeout');
    });

    it('throws ExternalServiceError when response has no text block', async () => {
        mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] });

        await expect(analyzeEmail(BASE_EMAIL)).rejects.toThrow(ExternalServiceError);
    });

    it('handles an email with no body', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidAnalysisJson()));

        await analyzeEmail({ ...BASE_EMAIL, body_raw: null, body_summary: null });

        const prompt = mockCreate.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('(no body)');
    });

    it('passes the correct model and max_tokens', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidAnalysisJson()));
        await analyzeEmail(BASE_EMAIL);

        const call = mockCreate.mock.calls[0][0];
        expect(call.model).toBe('claude-sonnet-4-20250514');
        expect(call.max_tokens).toBe(1024);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// analyzeEmailBatch()
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeEmailBatch()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    const EMAILS = [
        BASE_EMAIL,
        { sender_name: 'Bob', sender_email: 'bob@example.com', subject: 'Invoice due', body_raw: 'Pay by June 15.', body_summary: null },
        { sender_name: 'Carol', sender_email: 'carol@example.com', subject: 'Meeting notes', body_raw: 'See attached notes.', body_summary: null },
    ];

    it('throws when given an empty array', async () => {
        await expect(analyzeEmailBatch([])).rejects.toThrow('Cannot analyze an empty batch');
    });

    it('delegates to analyzeEmail for a single-email batch', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidAnalysisJson()));

        const result = await analyzeEmailBatch([BASE_EMAIL]);

        expect(result.email_count).toBe(1);
        expect(result.summary).toBe('Alice is requesting a Q3 budget review.');
        expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('returns batch analysis for multiple emails', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidBatchJson(3)));

        const result = await analyzeEmailBatch(EMAILS);

        expect(result.email_count).toBe(3);
        expect(result.summary).toContain('3 emails');
        expect(result.priority).toBe('medium');
        expect(result.actions).toEqual(['Action 1', 'Action 2']);
    });

    it('calls the API once for a multi-email batch', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidBatchJson(3)));

        await analyzeEmailBatch(EMAILS);

        expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('includes all email subjects in the batch prompt', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse(makeValidBatchJson(3)));

        await analyzeEmailBatch(EMAILS);

        const prompt = mockCreate.mock.calls[0][0].messages[0].content;
        expect(prompt).toContain('Q3 budget review');
        expect(prompt).toContain('Invoice due');
        expect(prompt).toContain('Meeting notes');
    });

    it('returns fallback for malformed batch JSON response', async () => {
        mockCreate.mockResolvedValue(makeClaudeResponse('Not valid JSON'));

        const result = await analyzeEmailBatch(EMAILS);

        expect(result.summary).toBe('Could not parse batch analysis.');
        expect(result.priority).toBe('medium');
        expect(result.actions).toEqual([]);
        expect(result.email_count).toBe(EMAILS.length);
    });

    it('throws ExternalServiceError when API fails', async () => {
        mockCreate.mockRejectedValue(new Error('Service unavailable'));

        await expect(analyzeEmailBatch(EMAILS)).rejects.toThrow(ExternalServiceError);
    });

    it('strips markdown fences from batch response', async () => {
        const withFences = '```json\n' + makeValidBatchJson(3) + '\n```';
        mockCreate.mockResolvedValue(makeClaudeResponse(withFences));

        const result = await analyzeEmailBatch(EMAILS);
        expect(result.email_count).toBe(3);
    });
});