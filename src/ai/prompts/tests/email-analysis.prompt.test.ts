import { describe, it, expect } from 'vitest';
import {
    buildSingleEmailPrompt,
    buildBatchEmailPrompt,
} from '../email-analysis.prompt';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BASE_EMAIL = {
    sender_name:  'Alice Smith',
    sender_email: 'alice@example.com',
    subject:      'Q3 budget review',
    body_raw:     'Please review the attached Q3 budget and reply by Friday.',
    body_summary: null,
};

const EMAILS = [
    { ...BASE_EMAIL },
    {
        sender_name:  'Bob Jones',
        sender_email: 'bob@example.com',
        subject:      'Invoice #1234 due',
        body_raw:     'Your invoice of $500 is due June 15.',
        body_summary: null,
    },
    {
        sender_name:  null,
        sender_email: 'no-reply@system.com',
        subject:      'System maintenance tonight',
        body_raw:     'Scheduled maintenance 2am–4am.',
        body_summary: null,
    },
];

// ─────────────────────────────────────────────────────────────────────────────
// buildSingleEmailPrompt()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSingleEmailPrompt()', () => {

    it('includes the sender name and email', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('Alice Smith');
        expect(prompt).toContain('alice@example.com');
    });

    it('includes the subject', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('Q3 budget review');
    });

    it('includes the body_raw content', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('Please review the attached Q3 budget');
    });

    it('falls back to body_summary when body_raw is null', () => {
        const prompt = buildSingleEmailPrompt({
            ...BASE_EMAIL,
            body_raw:     null,
            body_summary: 'A summary of the email.',
        });
        expect(prompt).toContain('A summary of the email.');
    });

    it('uses "(no body)" when both body_raw and body_summary are null', () => {
        const prompt = buildSingleEmailPrompt({
            ...BASE_EMAIL,
            body_raw:     null,
            body_summary: null,
        });
        expect(prompt).toContain('(no body)');
    });

    it('uses sender_email as display name when sender_name is null', () => {
        const prompt = buildSingleEmailPrompt({ ...BASE_EMAIL, sender_name: null });
        expect(prompt).toContain('alice@example.com <alice@example.com>');
    });

    it('truncates body_raw to 3000 characters', () => {
        const longBody = 'x'.repeat(4000);
        const prompt   = buildSingleEmailPrompt({ ...BASE_EMAIL, body_raw: longBody });
        const bodyStart = prompt.indexOf('---\n') + 4;
        expect(prompt.slice(bodyStart).length).toBeLessThanOrEqual(3001);
    });

    it('instructs Claude to respond with JSON only', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('ONLY a valid JSON object');
        expect(prompt).toContain('no markdown');
        expect(prompt).toContain('no backticks');
    });

    it('includes all required JSON fields in the schema description', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('"summary"');
        expect(prompt).toContain('"priority"');
        expect(prompt).toContain('"actions"');
        expect(prompt).toContain('"key_info"');
        expect(prompt).toContain('"suggested_reply"');
    });

    it('includes the priority guide', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(prompt).toContain('high');
        expect(prompt).toContain('medium');
        expect(prompt).toContain('low');
    });

    it('returns a non-empty string', () => {
        const prompt = buildSingleEmailPrompt(BASE_EMAIL);
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildBatchEmailPrompt()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildBatchEmailPrompt()', () => {

    it('includes all sender names and emails', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('Alice Smith');
        expect(prompt).toContain('alice@example.com');
        expect(prompt).toContain('Bob Jones');
        expect(prompt).toContain('bob@example.com');
    });

    it('includes all subjects', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('Q3 budget review');
        expect(prompt).toContain('Invoice #1234 due');
        expect(prompt).toContain('System maintenance tonight');
    });

    it('includes the email count in the prompt', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain(String(EMAILS.length));
    });

    it('numbers each email in the batch', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('--- Email 1 ---');
        expect(prompt).toContain('--- Email 2 ---');
        expect(prompt).toContain('--- Email 3 ---');
    });

    it('uses sender_email as display name when sender_name is null', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('no-reply@system.com <no-reply@system.com>');
    });

    it('truncates each email body to 600 characters', () => {
        const longBody = 'y'.repeat(1000);
        const emails   = [{ ...BASE_EMAIL, body_raw: longBody }];
        const prompt   = buildBatchEmailPrompt(emails);
        const bodyPart = prompt.split('--- Email 1 ---')[1];
        expect(bodyPart.length).toBeLessThan(1000);
    });

    it('falls back to body_summary when body_raw is null', () => {
        const email  = { ...BASE_EMAIL, body_raw: null, body_summary: 'Batch summary fallback.' };
        const prompt = buildBatchEmailPrompt([email]);
        expect(prompt).toContain('Batch summary fallback.');
    });

    it('uses "(no body)" when both body fields are null', () => {
        const email  = { ...BASE_EMAIL, body_raw: null, body_summary: null };
        const prompt = buildBatchEmailPrompt([email]);
        expect(prompt).toContain('(no body)');
    });

    it('instructs Claude to respond with JSON only', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('ONLY a valid JSON object');
        expect(prompt).toContain('no backticks');
    });

    it('includes all required batch JSON fields in schema description', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain('"summary"');
        expect(prompt).toContain('"priority"');
        expect(prompt).toContain('"actions"');
        expect(prompt).toContain('"key_info"');
        expect(prompt).toContain('"email_count"');
    });

    it('embeds the correct email_count value in the JSON schema', () => {
        const prompt = buildBatchEmailPrompt(EMAILS);
        expect(prompt).toContain(`"email_count": ${EMAILS.length}`);
    });

    it('works for a single-email batch', () => {
        const prompt = buildBatchEmailPrompt([BASE_EMAIL]);
        expect(prompt).toContain('--- Email 1 ---');
        expect(prompt).not.toContain('--- Email 2 ---');
    });
});