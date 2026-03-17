import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { ExternalServiceError } from '../../src/core/errors.js';
import {
    buildSingleEmailPrompt,
    buildBatchEmailPrompt,
} from './prompts/email-analysis.prompt.js';
import type { EmailAnalysis, BatchEmailAnalysis } from './prompts/email-analysis.prompt.js';

// Lazy-init so the client isn't created until first use
let _client: Anthropic | null = null;

function getClient(): Anthropic {
    if (!_client) _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    return _client;
}

const MODEL   = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;

// ── Single email analysis ─────────────────────────────────────────────────────

export async function analyzeEmail(email: {
    sender_name:   string | null;
    sender_email:  string;
    subject:       string;
    body_raw:      string | null;
    body_summary?: string | null;
}): Promise<EmailAnalysis> {
    const prompt = buildSingleEmailPrompt(email);

    logger.debug('Analyzing email', { subject: email.subject });

    try {
        const message = await getClient().messages.create({
            model:      MODEL,
            max_tokens: MAX_TOKENS,
            messages:   [{ role: 'user', content: prompt }],
        });

        const text = extractText(message);
        return parseAnalysis<EmailAnalysis>(text, {
            summary:         'Could not parse analysis.',
            priority:        'medium',
            actions:         [],
            key_info:        null,
            suggested_reply: null,
        });
    } catch (err: any) {
        logger.error('Email analysis failed', { error: err.message });
        throw new ExternalServiceError('Claude', err.message);
    }
}

// ── Batch email analysis ──────────────────────────────────────────────────────

export async function analyzeEmailBatch(emails: Array<{
    sender_name:   string | null;
    sender_email:  string;
    subject:       string;
    body_raw:      string | null;
    body_summary?: string | null;
}>): Promise<BatchEmailAnalysis> {
    if (emails.length === 0) {
        throw new Error('Cannot analyze an empty batch');
    }

    // Single email — delegate to the single analyzer for richer output
    if (emails.length === 1) {
        const single = await analyzeEmail(emails[0]);
        return {
            summary:     single.summary,
            priority:    single.priority,
            actions:     single.actions,
            key_info:    single.key_info,
            email_count: 1,
        };
    }

    const prompt = buildBatchEmailPrompt(emails);

    logger.debug('Analyzing email batch', { count: emails.length });

    try {
        const message = await getClient().messages.create({
            model:      MODEL,
            max_tokens: MAX_TOKENS,
            messages:   [{ role: 'user', content: prompt }],
        });

        const text = extractText(message);
        return parseAnalysis<BatchEmailAnalysis>(text, {
            summary:     'Could not parse batch analysis.',
            priority:    'medium',
            actions:     [],
            key_info:    null,
            email_count: emails.length,
        });
    } catch (err: any) {
        logger.error('Batch email analysis failed', { error: err.message, count: emails.length });
        throw new ExternalServiceError('Claude', err.message);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(message: Anthropic.Message): string {
    const block = message.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('No text block in Claude response');
    return block.text;
}

function parseAnalysis<T>(raw: string, fallback: T): T {
    // Strip any accidental markdown fences
    const clean = raw.replace(/```(?:json)?/g, '').trim();
    try {
        return JSON.parse(clean) as T;
    } catch {
        logger.warn('Failed to parse Claude JSON response', { raw: raw.slice(0, 200) });
        return fallback;
    }
}