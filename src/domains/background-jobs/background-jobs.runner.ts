import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import type { BackgroundJob } from '../../db/schema/background_jobs.schema.js';
import {
    hasBudgetRemaining,
    buildContext,
    hydratePrompt,
    createRun,
    completeRun,
    setLastRun,
} from './background-jobs.service.js';

const MODEL = 'claude-sonnet-4-20250514';

function getClient(): Anthropic {
    if (!config.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}

/**
 * Executes a single background job:
 * 1. Check monthly budget — skip if exhausted
 * 2. Hydrate the prompt with live context
 * 3. Call Claude with token cap
 * 4. Record the run result
 */
export async function runJob(job: BackgroundJob): Promise<{
    status: 'success' | 'error' | 'skipped';
    output?: string;
    error?: string;
}> {
    const userId = job.user_id;

    // ── Budget gate ──────────────────────────────────────────────────────────
    const budget = await hasBudgetRemaining(userId);
    if (!budget.ok) {
        logger.warn('Job skipped — monthly budget exhausted', {
            jobId: job.id, spent: budget.spent.toFixed(4), limit: budget.limit,
        });
        const run = await createRun(job.id, userId);
        await completeRun(run.id, {
            status: 'skipped',
            error: `Monthly budget of $${budget.limit} exhausted (spent $${budget.spent.toFixed(4)})`,
        });
        return { status: 'skipped', error: `Monthly budget $${budget.limit} exhausted` };
    }

    // ── Create run record ────────────────────────────────────────────────────
    const run = await createRun(job.id, userId);
    const startedAt = new Date().toISOString();

    try {
        // ── Hydrate prompt ───────────────────────────────────────────────────
        const ctx    = await buildContext(userId);
        const prompt = hydratePrompt(job.prompt, ctx);

        logger.info('Running background job', { jobId: job.id, name: job.name });

        // ── Call Claude ──────────────────────────────────────────────────────
        const client   = getClient();
        const response = await client.messages.create({
            model:      MODEL,
            max_tokens: job.max_tokens_per_run,
            messages:   [{ role: 'user', content: prompt }],
        });

        const text         = response.content.find(b => b.type === 'text')?.text?.trim() ?? '';
        const inputTokens  = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;

        await completeRun(run.id, {
            status:       'success',
            output:       text,
            inputTokens,
            outputTokens,
        });

        await setLastRun(job.id, startedAt);

        logger.info('Job completed', {
            jobId: job.id,
            tokens: inputTokens + outputTokens,
        });

        return { status: 'success', output: text };

    } catch (err: any) {
        const message = err?.message ?? String(err);
        logger.error('Job failed', { jobId: job.id, error: message });

        await completeRun(run.id, { status: 'error', error: message });
        return { status: 'error', error: message };
    }
}
