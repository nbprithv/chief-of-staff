import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { backgroundJobs, type BackgroundJob, type NewBackgroundJob } from '../../db/schema/background_jobs.schema.js';
import { jobRuns, type JobRun } from '../../db/schema/job_runs.schema.js';
import { config } from '../../core/config.js';

// ── Token cost constants (Claude Sonnet) ─────────────────────────────────────
const INPUT_COST_PER_TOKEN  = 3  / 1_000_000;  // $3  per 1M input tokens
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;  // $15 per 1M output tokens

export function calcCost(inputTokens: number, outputTokens: number): number {
    return inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;
}

// ── Monthly budget helpers ────────────────────────────────────────────────────

/** Returns total USD spent in the current calendar month across all job runs. */
export async function getMonthlySpend(userId: string): Promise<number> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const rows = await db
        .select({ total: sql<number>`COALESCE(SUM(cost_usd), 0)` })
        .from(jobRuns)
        .where(
            and(
                eq(jobRuns.user_id, userId),
                gte(jobRuns.created_at, monthStart.toISOString()),
            ),
        );

    return rows[0]?.total ?? 0;
}

export function getBudgetLimit(): number {
    return config.MONTHLY_BUDGET_USD;
}

export async function hasBudgetRemaining(userId: string): Promise<{ ok: boolean; spent: number; limit: number; remaining: number }> {
    const spent     = await getMonthlySpend(userId);
    const limit     = getBudgetLimit();
    const remaining = limit - spent;
    return { ok: remaining > 0.01, spent, limit, remaining };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listJobs(userId: string): Promise<BackgroundJob[]> {
    return db.select().from(backgroundJobs).where(eq(backgroundJobs.user_id, userId));
}

export async function getJob(id: string, userId: string): Promise<BackgroundJob | null> {
    const rows = await db
        .select()
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.user_id, userId)));
    return rows[0] ?? null;
}

export async function createJob(input: Omit<NewBackgroundJob, 'id' | 'created_at' | 'updated_at'>): Promise<BackgroundJob> {
    const [row] = await db.insert(backgroundJobs).values(input).returning();
    return row;
}

export async function updateJob(
    id: string,
    userId: string,
    patch: Partial<Pick<BackgroundJob, 'name' | 'description' | 'skill_id' | 'prompt' | 'schedule' | 'enabled' | 'max_tokens_per_run'>>,
): Promise<BackgroundJob | null> {
    const [row] = await db
        .update(backgroundJobs)
        .set({ ...patch, updated_at: new Date().toISOString() })
        .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.user_id, userId)))
        .returning();
    return row ?? null;
}

export async function deleteJob(id: string, userId: string): Promise<void> {
    await db.delete(backgroundJobs).where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.user_id, userId)));
}

export async function setLastRun(id: string, now: string): Promise<void> {
    await db
        .update(backgroundJobs)
        .set({ last_run_at: now, updated_at: now })
        .where(eq(backgroundJobs.id, id));
}

// ── Job runs ──────────────────────────────────────────────────────────────────

export async function listRuns(jobId: string, userId: string, limit = 20): Promise<JobRun[]> {
    return db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.job_id, jobId), eq(jobRuns.user_id, userId)))
        .orderBy(desc(jobRuns.created_at))
        .limit(limit);
}

export async function createRun(jobId: string, userId: string): Promise<JobRun> {
    const [row] = await db
        .insert(jobRuns)
        .values({ job_id: jobId, user_id: userId, status: 'running' })
        .returning();
    return row;
}

export async function completeRun(
    runId: string,
    result: { status: 'success' | 'error' | 'skipped'; output?: string; error?: string; inputTokens?: number; outputTokens?: number },
): Promise<JobRun> {
    const inputTokens  = result.inputTokens  ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const cost_usd     = calcCost(inputTokens, outputTokens);

    const [row] = await db
        .update(jobRuns)
        .set({
            status:        result.status,
            output:        result.output  ?? null,
            error:         result.error   ?? null,
            input_tokens:  inputTokens,
            output_tokens: outputTokens,
            cost_usd,
            completed_at:  new Date().toISOString(),
        })
        .where(eq(jobRuns.id, runId))
        .returning();
    return row;
}

// ── Context helpers (used by the runner to hydrate prompt templates) ──────────

export type JobContext = {
    date:             string;
    events:           string;
    tasks_due_today:  string;
    tasks_due_week:   string;
    tasks_overdue:    string;
    inbox_count:      string;
    inbox_items:      string;
    meals_week:       string;
};

export async function buildContext(_userId: string): Promise<JobContext> {
    const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    // Pull live data from the nodes table for context injection
    const { db: drizzleDb } = await import('../../db/client.js');
    const { nodes }          = await import('../../db/schema/nodes.schema.js');
    const { gte: gteOp, lte, and: andOp, eq: eqOp, ne } = await import('drizzle-orm');

    const now        = new Date();
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const weekEnd    = new Date(now); weekEnd.setDate(now.getDate() + 7);

    const allActive = await drizzleDb.select().from(nodes).where(
        andOp(ne(nodes.status, 'done'), ne(nodes.status, 'cancelled'), ne(nodes.status, 'archived')),
    );

    const events = allActive
        .filter(n => n.type === 'event' && n.starts_at && new Date(n.starts_at) <= weekEnd)
        .slice(0, 10)
        .map(n => `- ${n.title}${n.starts_at ? ` (${new Date(n.starts_at).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })})` : ''}`)
        .join('\n') || '(none)';

    const dueToday = allActive
        .filter(n => n.type === 'todo' && n.due_at && new Date(n.due_at) <= todayEnd)
        .slice(0, 10)
        .map(n => `- [${n.priority}] ${n.title}`)
        .join('\n') || '(none)';

    const dueWeek = allActive
        .filter(n => n.type === 'todo' && n.due_at && new Date(n.due_at) > todayEnd && new Date(n.due_at) <= weekEnd)
        .slice(0, 10)
        .map(n => `- [${n.priority}] ${n.title} (due ${new Date(n.due_at!).toLocaleDateString()})`)
        .join('\n') || '(none)';

    const overdue = allActive
        .filter(n => n.type === 'todo' && n.due_at && new Date(n.due_at) < now)
        .slice(0, 10)
        .map(n => `- [${n.priority}] ${n.title} (was due ${new Date(n.due_at!).toLocaleDateString()})`)
        .join('\n') || '(none)';

    const inbox = allActive.filter(n => n.status === 'inbox');

    const inboxItems = inbox
        .slice(0, 15)
        .map(n => `- [${n.type}] ${n.title}`)
        .join('\n') || '(none)';

    const meals = allActive
        .filter(n => n.type === 'meal' && n.starts_at && new Date(n.starts_at) <= weekEnd)
        .slice(0, 14)
        .map(n => `- ${n.title}${n.starts_at ? ` (${new Date(n.starts_at).toLocaleDateString()})` : ''}`)
        .join('\n') || '(none planned)';

    return {
        date:            today,
        events,
        tasks_due_today: dueToday,
        tasks_due_week:  dueWeek,
        tasks_overdue:   overdue,
        inbox_count:     String(inbox.length),
        inbox_items:     inboxItems,
        meals_week:      meals,
    };
}

export function hydratePrompt(template: string, ctx: JobContext): string {
    return template
        .replace(/{date}/g,            ctx.date)
        .replace(/{events}/g,          ctx.events)
        .replace(/{tasks_due_today}/g, ctx.tasks_due_today)
        .replace(/{tasks_due_week}/g,  ctx.tasks_due_week)
        .replace(/{tasks_overdue}/g,   ctx.tasks_overdue)
        .replace(/{inbox_count}/g,     ctx.inbox_count)
        .replace(/{inbox_items}/g,     ctx.inbox_items)
        .replace(/{meals_week}/g,      ctx.meals_week);
}
