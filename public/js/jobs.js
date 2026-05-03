import { api } from './api.js';

// ── Hard-coded card definitions (visual layer) ─────────────────────────────────
// Prompts + default schedules come from the API templates endpoint at init.

const CARDS = [
    { id: 'school_email_digest', name: 'School Email Digest', letter: 'S', color: '#4A7FB5' },
    { id: 'week_ahead',          name: 'Week Ahead',          letter: 'W', color: '#7B5EA7' },
    { id: 'inbox_triage',        name: 'Inbox Triage',        letter: 'I', color: '#B07D2F' },
    { id: 'overdue_nudge',       name: 'Overdue Nudge',       letter: 'O', color: '#C25B3F' },
    { id: 'weeknight_meal_planner', name: 'Meal Prep',         letter: 'M', color: '#3D8C6E' },
];

// ── State ──────────────────────────────────────────────────────────────────────

// Schedules are defined in vercel.json and are not configurable via the UI.
// This map reflects the crons section of vercel.json for display purposes.
const VERCEL_SCHEDULES = {
    school_email_digest:    '0 18 * * 1-5',
    weeknight_meal_planner: '0 13 * * 6',
};

let jobs        = [];
let templates   = [];   // full templates from API (includes defaultPrompt)
let budget      = { spent: 0, limit: 20, remaining: 20, ok: true };
let runningSet  = new Set();

// ── Cron helpers ───────────────────────────────────────────────────────────────

function parseCron(expr) {
    if (!expr) return { freq: 'daily', hour: 8, minute: 0, dow: 1, dom: 1, dowRaw: '*' };
    const [m, h, dom, , dow] = expr.split(' ');
    if (h === '*')                  return { freq: 'hourly',   hour: 0,  minute: +m, dow: 1,    dom: 1,    dowRaw: dow };
    if (dom !== '*' && dow === '*') return { freq: 'monthly',  hour: +h, minute: +m, dow: 1,    dom: +dom, dowRaw: dow };
    if (dow !== '*' && dom === '*') {
        // Range (e.g. 1-5) or list (e.g. 1,3,5) — not a single day
        if (dow.includes('-') || dow.includes(',')) {
            return { freq: 'weekdays', hour: +h, minute: +m, dow: 1, dom: 1, dowRaw: dow };
        }
        return { freq: 'weekly', hour: +h, minute: +m, dow: +dow, dom: 1, dowRaw: dow };
    }
    return { freq: 'daily', hour: +h, minute: +m, dow: 1, dom: 1, dowRaw: dow };
}

const DOW_RANGE_LABELS = { '1-5': 'Mon–Fri', '0-4': 'Sun–Thu', '1-6': 'Mon–Sat' };

function describeCron(expr) {
    const { freq, hour, minute, dow, dom, dowRaw } = parseCron(expr);
    const t    = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    switch (freq) {
        case 'hourly':   return `Every hour at :${String(minute).padStart(2,'0')}`;
        case 'daily':    return `Daily at ${t}`;
        case 'weekly':   return `${days[dow]} at ${t}`;
        case 'monthly':  return `Monthly · day ${dom} at ${t}`;
        case 'weekdays': return `${DOW_RANGE_LABELS[dowRaw] ?? dowRaw} at ${t}`;
        default:         return expr;
    }
}

// ── Budget bar ─────────────────────────────────────────────────────────────────

function renderBudget() {
    const el = document.getElementById('jobs-budget-bar');
    if (!el) return;
    const pct   = Math.min(100, (budget.spent / budget.limit) * 100);
    const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
    const remaining = Math.max(0, budget.limit - budget.spent);
    el.innerHTML = `
    <div class="jc-budget">
      <div class="jc-budget-row">
        <span class="jc-budget-label">Monthly AI budget</span>
        <span class="jc-budget-amount">$${budget.spent.toFixed(4)} of $${budget.limit.toFixed(2)} &middot; <span style="color:${color}">$${remaining.toFixed(4)} remaining</span>
          ${!budget.ok ? '<span class="jc-budget-exhausted">EXHAUSTED</span>' : ''}
        </span>
      </div>
      <div class="jc-budget-track"><div class="jc-budget-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
}

// ── Card rendering ─────────────────────────────────────────────────────────────

function renderCards() {
    const el = document.getElementById('jobs-cards');
    if (!el) return;
    el.innerHTML = CARDS.map(card => renderCard(card)).join('');
}

function renderCard(card) {
    const tpl     = templates.find(t => t.id === card.id);
    const job     = jobs.find(j => j.skill_id === card.id) ?? null;
    const sched   = VERCEL_SCHEDULES[card.id] ?? tpl?.suggestedSchedule ?? '0 8 * * *';
    const enabled = job ? job.enabled : true;
    const exists  = !!job;
    const isRunning = runningSet.has(card.id);

    const statusLabel = !exists ? 'inactive' : enabled ? 'active' : 'paused';
    const statusMod   = !exists ? 'jc-status--inactive' : enabled ? 'jc-status--active' : 'jc-status--paused';

    const lastRunText = job?.last_run_at
        ? `Last run ${relativeTime(job.last_run_at)}`
        : exists ? 'Never run' : 'Not yet configured';

    const desc = tpl?.description ?? '';

    return `
    <div class="jc-card${!enabled && exists ? ' jc-card--paused' : ''}" id="jcard-${card.id}">
      <div class="jc-card-header" style="cursor:pointer" onclick="window.jobs.viewDetails('${card.id}')">
        <div class="jc-icon" style="background:${card.color}1a;color:${card.color}">${card.letter}</div>
        <div class="jc-card-info">
          <div class="jc-name">${card.name}</div>
          <div class="jc-desc">${esc(desc)}</div>
        </div>
        <span class="jc-status ${statusMod}">${statusLabel}</span>
      </div>

      <div class="jc-meta">
        <span class="jc-sched-text">⏰ ${describeCron(sched)}</span>
        <span class="jc-lastrun-text">${lastRunText}</span>
      </div>

      <div class="jc-actions">
        <button class="jc-btn jc-btn--run" onclick="window.jobs.runNow('${card.id}')" ${isRunning ? 'disabled' : ''}>
          ${isRunning
            ? '<span class="spinner" style="width:9px;height:9px;border-width:1.5px;border-color:currentColor;border-top-color:transparent"></span>'
            : '▶&nbsp;Run now'}
        </button>
        <button class="jc-btn jc-btn--outline" onclick="window.jobs.togglePause('${card.id}')">
          ${!enabled && exists ? '▷&nbsp;Resume' : '⏸&nbsp;Pause'}
        </button>
      </div>
    </div>`;
}

// ── Data ───────────────────────────────────────────────────────────────────────

async function refresh() {
    try {
        const [{ templates: tpls }, { jobs: jbs }, bdg] = await Promise.all([
            api.jobTemplates(),
            api.jobs(),
            api.jobBudget(),
        ]);
        templates = tpls;
        jobs      = jbs;
        budget    = bdg;
    } catch (err) {
        console.error('Failed to load jobs:', err);
    }
    renderBudget();
    renderCards();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}

async function ensureJobExists(card) {
    let job = jobs.find(j => j.skill_id === card.id);
    if (job) return job;

    const tpl = templates.find(t => t.id === card.id);
    const { job: created } = await api.jobCreate({
        name:               card.name,
        skill_id:           card.id,
        prompt:             tpl?.defaultPrompt ?? '',
        enabled:            true,
        max_tokens_per_run: tpl?.suggestedMaxTokens ?? 500,
    });
    jobs.push(created);
    return created;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function initJobs() {
    await refresh();
}

window.jobs = {
    async runNow(skillId) {
        const card = CARDS.find(c => c.id === skillId);
        if (!card) return;

        runningSet.add(skillId);
        renderCards();

        try {
            const job    = await ensureJobExists(card);
            const result = await api.jobRunNow(job.id);
            if (result.status === 'skipped') alert(`Skipped: ${result.error}`);
            else if (result.status === 'error') alert(`Failed: ${result.error}`);
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            runningSet.delete(skillId);
        }
        await refresh();
    },

    closeModal(event) {
        // If triggered by overlay click, only close when clicking the backdrop itself
        if (event && event.target !== document.getElementById('jm-overlay')) return;
        document.getElementById('jm-overlay').classList.remove('open');
    },

    async viewDetails(skillId) {
        const card = CARDS.find(c => c.id === skillId);
        if (!card) return;

        const job     = jobs.find(j => j.skill_id === skillId) ?? null;
        const tpl     = templates.find(t => t.id === skillId);
        const sched   = VERCEL_SCHEDULES[skillId] ?? tpl?.suggestedSchedule ?? '0 8 * * *';
        const enabled = job ? job.enabled : true;
        const exists  = !!job;
        const statusLabel = !exists ? 'inactive' : enabled ? 'active' : 'paused';
        const statusMod   = !exists ? 'jc-status--inactive' : enabled ? 'jc-status--active' : 'jc-status--paused';

        // Populate header
        document.getElementById('jm-icon').style.cssText = `background:${card.color}1a;color:${card.color}`;
        document.getElementById('jm-icon').textContent = card.letter;
        document.getElementById('jm-title').textContent = card.name;
        document.getElementById('jm-subtitle').textContent = tpl?.description ?? '';

        // Populate meta strip
        document.getElementById('jm-meta').innerHTML = `
            <div class="jm-meta-item">
                <span class="jm-meta-label">Status</span>
                <span class="jc-status ${statusMod}" style="align-self:flex-start">${statusLabel}</span>
            </div>
            <div class="jm-meta-item">
                <span class="jm-meta-label">Schedule</span>
                <span class="jm-meta-value">${describeCron(sched)}</span>
            </div>
            <div class="jm-meta-item">
                <span class="jm-meta-label">Last run</span>
                <span class="jm-meta-value">${job?.last_run_at ? relativeTime(job.last_run_at) : '—'}</span>
            </div>`;

        // Show loading state and open overlay
        document.getElementById('jm-body').innerHTML = '<div class="jm-loading"><span class="spinner"></span></div>';
        document.getElementById('jm-overlay').classList.add('open');

        // Fetch run history (only if job exists in DB)
        if (!job) {
            document.getElementById('jm-body').innerHTML = '<div class="jm-empty">No runs yet — this job hasn\'t been configured.</div>';
            return;
        }

        try {
            const { runs } = await api.jobRuns(job.id, { limit: 10 });
            if (!runs || runs.length === 0) {
                document.getElementById('jm-body').innerHTML = '<div class="jm-empty">No runs yet.</div>';
                return;
            }
            const html = `<div class="jm-runs-title">Recent Runs</div>` + runs.map(r => {
                const statusCls = r.status === 'success' ? 'jm-run-status--success'
                                : r.status === 'error'   ? 'jm-run-status--error'
                                : 'jm-run-status--skipped';
                const tokens = (r.input_tokens || r.output_tokens)
                    ? `<span class="jm-run-tokens">${(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} tok</span>`
                    : '';
                const output = r.output
                    ? `<div class="jm-run-output">${esc(r.output)}</div>` : '';
                const error = r.error
                    ? `<div class="jm-run-error">${esc(r.error)}</div>` : '';
                return `
                <div class="jm-run">
                    <div class="jm-run-header">
                        <span class="jm-run-status ${statusCls}">${r.status}</span>
                        ${tokens}
                        <span class="jm-run-time">${relativeTime(r.started_at ?? r.created_at)}</span>
                    </div>
                    ${output}${error}
                </div>`;
            }).join('');
            document.getElementById('jm-body').innerHTML = html;
        } catch (err) {
            document.getElementById('jm-body').innerHTML = `<div class="jm-empty">Failed to load runs: ${esc(err.message)}</div>`;
        }
    },

    async togglePause(skillId) {
        const card = CARDS.find(c => c.id === skillId);
        if (!card) return;
        try {
            const job = jobs.find(j => j.skill_id === skillId);
            if (!job) {
                // Create as paused
                const tpl = templates.find(t => t.id === skillId);
                const { job: created } = await api.jobCreate({
                    name:               card.name,
                    skill_id:           skillId,
                    prompt:             tpl?.defaultPrompt ?? '',
                    enabled:            false,
                    max_tokens_per_run: tpl?.suggestedMaxTokens ?? 500,
                });
                jobs.push(created);
            } else {
                await api.jobUpdate(job.id, { enabled: !job.enabled });
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
        await refresh();
    },
};
