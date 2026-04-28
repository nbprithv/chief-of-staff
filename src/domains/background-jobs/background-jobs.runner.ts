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
import { sendEmail } from '../../integrations/google/gmail-send.service.js';
import { runSchoolEmailDigest } from './skills/school-email-digest.skill.js';

// ── Skill dispatch map ────────────────────────────────────────────────────────
// Add entries here to give a skill its own runner instead of the generic loop.

const SKILL_RUNNERS: Record<string, (job: BackgroundJob) => Promise<{
    status: 'success' | 'skipped' | 'error';
    output?: string;
    error?: string;
    inputTokens: number;
    outputTokens: number;
}>> = {
    school_email_digest: runSchoolEmailDigest,
};

const MODEL = 'claude-sonnet-4-20250514';

function getClient(): Anthropic {
    if (!config.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    return new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
}

// ── Tools available to every job ──────────────────────────────────────────────

const JOB_TOOLS: Anthropic.Tool[] = [
    {
        name:        'send_email',
        description: 'Send an email from the signed-in Google account. Use this when the job output should be delivered to the user via email.',
        input_schema: {
            type: 'object',
            properties: {
                to: {
                    type:        'string',
                    description: 'Recipient email address. Use {user_email} from context to send to the user themselves.',
                },
                subject: {
                    type:        'string',
                    description: 'Email subject line.',
                },
                body: {
                    type:        'string',
                    description: 'Plain-text email body.',
                },
                cc: {
                    type:        'string',
                    description: 'Optional CC address(es), comma-separated.',
                },
            },
            required: ['to', 'subject', 'body'],
        },
    },
];

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
        // ── Dispatch to specialized skill runner if one is registered ─────────
        const skillRunner = job.skill_id ? SKILL_RUNNERS[job.skill_id] : null;
        if (skillRunner) {
            logger.info('Dispatching to skill runner', { jobId: job.id, skill_id: job.skill_id });
            const result = await skillRunner(job);
            await completeRun(run.id, {
                status:       result.status,
                output:       result.output,
                error:        result.error,
                inputTokens:  result.inputTokens,
                outputTokens: result.outputTokens,
            });
            if (result.status !== 'error') await setLastRun(job.id, startedAt);
            logger.info('Skill run complete', { jobId: job.id, status: result.status, tokens: result.inputTokens + result.outputTokens });
            return { status: result.status, output: result.output, error: result.error };
        }

        // ── Hydrate prompt ───────────────────────────────────────────────────
        const ctx    = await buildContext(userId);
        const prompt = hydratePrompt(job.prompt, ctx);

        logger.info('Running background job', {
            jobId: job.id,
            name: job.name,
            model: MODEL,
            maxTokens: job.max_tokens_per_run,
            promptLength: prompt.length,
            apiKeyPresent: !!config.ANTHROPIC_API_KEY,
        });

        // ── Agentic tool-call loop ────────────────────────────────────────────
        // Claude may call send_email; we handle the tool call and let Claude
        // produce a final text response (or just the tool result is enough).
        const client   = getClient();
        const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

        let text         = '';
        let inputTokens  = 0;
        let outputTokens = 0;
        const emailsSent: string[] = [];

        // Loop up to 3 turns (initial + potential tool calls)
        for (let turn = 0; turn < 3; turn++) {
            const response = await client.messages.create({
                model:      MODEL,
                max_tokens: job.max_tokens_per_run,
                tools:      JOB_TOOLS,
                messages,
            });

            inputTokens  += response.usage.input_tokens;
            outputTokens += response.usage.output_tokens;

            // Collect any text output from this turn
            const turnText = response.content
                .filter((b): b is Anthropic.TextBlock => b.type === 'text')
                .map(b => b.text.trim())
                .filter(Boolean)
                .join('\n\n');
            if (turnText) text = turnText;  // last non-empty text wins

            // If no tool calls, we're done
            if (response.stop_reason !== 'tool_use') break;

            // Handle tool calls
            const toolUses = response.content.filter(
                (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
            );

            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const toolUse of toolUses) {
                if (toolUse.name === 'send_email') {
                    const input = toolUse.input as {
                        to: string; subject: string; body: string; cc?: string;
                    };
                    logger.info('[jobs/runner] send_email tool called', {
                        jobId: job.id, to: input.to, subject: input.subject,
                    });
                    try {
                        const result = await sendEmail(userId, {
                            to:      input.to,
                            subject: input.subject,
                            text:    input.body,
                            cc:      input.cc,
                        });
                        emailsSent.push(input.to);
                        toolResults.push({
                            type:        'tool_result',
                            tool_use_id: toolUse.id,
                            content:     `Email sent successfully. Message ID: ${result.messageId}`,
                        });
                    } catch (err: any) {
                        logger.error('[jobs/runner] send_email tool failed', {
                            jobId: job.id, error: err?.message,
                        });
                        toolResults.push({
                            type:        'tool_result',
                            tool_use_id: toolUse.id,
                            is_error:    true,
                            content:     `Failed to send email: ${err?.message}`,
                        });
                    }
                } else {
                    toolResults.push({
                        type:        'tool_result',
                        tool_use_id: toolUse.id,
                        is_error:    true,
                        content:     `Unknown tool: ${toolUse.name}`,
                    });
                }
            }

            // Append assistant + tool results and continue
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user',      content: toolResults });
        }

        await completeRun(run.id, {
            status:       'success',
            output:       text,
            inputTokens,
            outputTokens,
        });

        await setLastRun(job.id, startedAt);

        logger.info('Job completed', {
            jobId:       job.id,
            tokens:      inputTokens + outputTokens,
            emailsSent:  emailsSent.length,
        });

        return { status: 'success', output: text };

    } catch (err: any) {
        // Capture full Anthropic API error details if available
        const message    = err?.message ?? String(err);
        const statusCode = err?.status ?? err?.statusCode ?? null;
        const errType    = err?.error?.type ?? err?.type ?? null;
        const errBody    = err?.error ?? null;

        logger.error('Job failed', {
            jobId:      job.id,
            error:      message,
            statusCode,
            errType,
            errBody,
            stack:      err?.stack?.split('\n').slice(0, 5),
        });

        await completeRun(run.id, { status: 'error', error: message });
        return { status: 'error', error: message };
    }
}
