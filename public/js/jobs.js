import { api } from './api.js';

// ── State ─────────────────────────────────────────────────────────────────────

let jobs      = [];
let templates = [];
let budget    = { spent: 0, limit: 20, remaining: 20, ok: true };
let editing   = null;   // job being edited, or null for create
let runsView  = null;   // job whose runs are displayed in the runs panel

// ── Cron helpers ──────────────────────────────────────────────────────────────

/**
 * Convert friendly UI fields to a cron expression.
 * freq: 'hourly' | 'daily' | 'weekly' | 'monthly'
 */
function buildCron({ freq, hour = 8, minute = 0, dow = 1, dom = 1 } = {}) {
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    switch (freq) {
        case 'hourly':  return `${m} * * * *`;
        case 'daily':   return `${m} ${h} * * *`;
        case 'weekly':  return `${m} ${h} * * ${dow}`;
        case 'monthly': return `${m} ${h} ${dom} * *`;
        default:        return `${m} ${h} * * *`;
    }
}

/**
 * Parse a cron expression back into friendly UI fields.
 * Returns { freq, hour, minute, dow, dom }.
 */
function parseCron(expr) {
    if (!expr) return { freq: 'daily', hour: 8, minute: 0, dow: 1, dom: 1 };
    const [m, h, dom, , dow] = expr.split(' ');

    if (h === '*')                   return { freq: 'hourly',  hour: 0,      minute: parseInt(m), dow: 1,          dom: 1 };
    if (dom !== '*' && dow === '*')  return { freq: 'monthly', hour: parseInt(h), minute: parseInt(m), dow: 1,     dom: parseInt(dom) };
    if (dow !== '*' && dom === '*')  return { freq: 'weekly',  hour: parseInt(h), minute: parseInt(m), dow: parseInt(dow), dom: 1 };
    return { freq: 'daily', hour: parseInt(h), minute: parseInt(m), dow: 1, dom: 1 };
}

function describeCron(expr) {
    const { freq, hour, minute, dow, dom } = parseCron(expr);
    const t = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    switch (freq) {
        case 'hourly':  return `Every hour at :${String(minute).padStart(2,'0')}`;
        case 'daily':   return `Daily at ${t}`;
        case 'weekly':  return `Every ${days[dow]} at ${t}`;
        case 'monthly': return `Monthly on day ${dom} at ${t}`;
        default:        return expr;
    }
}

// ── Budget bar ────────────────────────────────────────────────────────────────

function renderBudget() {
    const el = document.getElementById('jobs-budget-bar');
    if (!el) return;

    const pct    = Math.min(100, (budget.spent / budget.limit) * 100);
    const color  = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green)';
    const spentFmt   = `$${budget.spent.toFixed(3)}`;
    const limitFmt   = `$${budget.limit.toFixed(2)}`;
    const remFmt     = `$${budget.remaining.toFixed(3)}`;

    el.innerHTML = `
    <div class="jobs-budget">
      <div class="jobs-budget-label">
        <span>Monthly token budget</span>
        <span style="font-family:var(--mono);font-size:11px;color:var(--ink2)">${spentFmt} / ${limitFmt}</span>
      </div>
      <div class="jobs-budget-track">
        <div class="jobs-budget-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink3);margin-top:3px">
        ${remFmt} remaining this month
        ${!budget.ok ? '<span style="color:var(--red);font-weight:600;margin-left:8px">BUDGET EXHAUSTED — jobs will be skipped</span>' : ''}
      </div>
    </div>`;
}

// ── Jobs list ─────────────────────────────────────────────────────────────────

function statusDot(job) {
    if (!job.enabled) return '<span class="jobs-dot jobs-dot--off" title="Disabled"></span>';
    return '<span class="jobs-dot jobs-dot--on" title="Enabled"></span>';
}

function renderJobsList() {
    const list = document.getElementById('jobs-list');
    if (!list) return;

    if (jobs.length === 0) {
        list.innerHTML = `<div class="jobs-empty">No background jobs yet. Create one to get started.</div>`;
        return;
    }

    list.innerHTML = jobs.map(j => `
    <div class="jobs-row ${runsView?.id === j.id ? 'jobs-row--active' : ''}" id="jr-${j.id}">
      <div class="jobs-row-main" onclick="window.jobs.viewRuns('${j.id}')">
        <div class="jobs-row-left">
          ${statusDot(j)}
          <div>
            <div class="jobs-row-name">${j.name}</div>
            <div class="jobs-row-meta">
              <span class="jobs-tag">${j.skill_id}</span>
              <span>${describeCron(j.schedule)}</span>
              ${j.last_run_at ? `<span>Last run ${relativeTime(j.last_run_at)}</span>` : '<span style="color:var(--ink4)">Never run</span>'}
            </div>
          </div>
        </div>
        <div class="jobs-row-actions" onclick="event.stopPropagation()">
          <button class="jobs-btn-sm" onclick="window.jobs.runNow('${j.id}')" title="Run now">▶</button>
          <button class="jobs-btn-sm" onclick="window.jobs.toggleEnabled('${j.id}', ${!j.enabled})" title="${j.enabled ? 'Disable' : 'Enable'}">
            ${j.enabled ? '⏸' : '▷'}
          </button>
          <button class="jobs-btn-sm" onclick="window.jobs.edit('${j.id}')" title="Edit">✎</button>
          <button class="jobs-btn-sm jobs-btn-sm--danger" onclick="window.jobs.del('${j.id}')" title="Delete">✕</button>
        </div>
      </div>
    </div>`).join('');
}

// ── Runs panel ────────────────────────────────────────────────────────────────

function renderRunsPanel() {
    const panel = document.getElementById('jobs-runs-panel');
    if (!panel) return;

    if (!runsView) {
        panel.innerHTML = `<div class="jobs-runs-empty">Click a job to view its run history.</div>`;
        return;
    }

    // Trigger async load
    panel.innerHTML = `<div class="jobs-runs-loading"><span class="spinner"></span> Loading runs…</div>`;

    api.jobRuns(runsView.id, { limit: '30' }).then(({ runs }) => {
        if (!panel.isConnected) return;

        const header = `
        <div class="jobs-runs-header">
          <div class="jobs-runs-title">${runsView.name} — History</div>
          <button class="jobs-btn-sm" onclick="window.jobs.runNow('${runsView.id}')">▶ Run now</button>
        </div>`;

        if (runs.length === 0) {
            panel.innerHTML = header + `<div class="jobs-runs-empty">No runs yet.</div>`;
            return;
        }

        panel.innerHTML = header + runs.map(r => {
            const statusClass = { success: 'run-ok', error: 'run-err', skipped: 'run-skip', running: 'run-run' }[r.status] ?? '';
            const tokens = r.input_tokens + r.output_tokens;
            const cost   = r.cost_usd > 0 ? `$${r.cost_usd.toFixed(4)}` : '—';

            return `
            <div class="jobs-run-row ${statusClass}">
              <div class="jobs-run-meta">
                <span class="jobs-run-status">${r.status}</span>
                <span class="jobs-run-time">${relativeTime(r.started_at)}</span>
                ${tokens > 0 ? `<span class="jobs-run-tokens">${tokens.toLocaleString()} tokens · ${cost}</span>` : ''}
              </div>
              ${r.output ? `<div class="jobs-run-output">${escHtml(r.output)}</div>` : ''}
              ${r.error  ? `<div class="jobs-run-error">${escHtml(r.error)}</div>` : ''}
            </div>`;
        }).join('');
    }).catch(err => {
        panel.innerHTML = `<div class="jobs-runs-error">Failed to load runs: ${escHtml(err.message)}</div>`;
    });
}

// ── Create / Edit drawer ──────────────────────────────────────────────────────

function openDrawer(job) {
    editing = job ?? null;
    const drawer  = document.getElementById('jobs-drawer');
    const overlay = document.getElementById('jobs-overlay');
    if (!drawer || !overlay) return;

    const isEdit = !!job;
    const crn    = isEdit ? parseCron(job.schedule) : { freq: 'daily', hour: 8, minute: 0, dow: 1, dom: 1 };

    const templateOptions = templates
        .map(t => `<option value="${t.id}" ${(isEdit ? job.skill_id : 'daily_brief') === t.id ? 'selected' : ''}>${t.name}</option>`)
        .join('');

    drawer.innerHTML = `
    <div class="jobs-drawer-header">
      <div class="jobs-drawer-title">${isEdit ? 'Edit Job' : 'New Job'}</div>
      <button class="jobs-drawer-close" onclick="window.jobs.closeDrawer()">✕</button>
    </div>

    <div class="jobs-form">

      <div class="jobs-field">
        <label>Skill template</label>
        <select id="jf-skill" onchange="window.jobs.onSkillChange(this.value)">
          ${templateOptions}
        </select>
      </div>

      <div class="jobs-field">
        <label>Job name</label>
        <input id="jf-name" type="text" placeholder="e.g. Morning Brief" value="${escHtml(isEdit ? job.name : '')}">
      </div>

      <div class="jobs-field">
        <label>Prompt <span class="jobs-field-hint">Use {date}, {events}, {tasks_due_today}, {tasks_overdue}, {inbox_count}, {inbox_items}, {meals_week}</span></label>
        <textarea id="jf-prompt" rows="7" placeholder="Your prompt…">${escHtml(isEdit ? job.prompt : '')}</textarea>
      </div>

      <div class="jobs-field">
        <label>Frequency</label>
        <div class="jobs-freq-row">
          <select id="jf-freq" onchange="window.jobs.onFreqChange()">
            <option value="hourly"  ${crn.freq==='hourly'  ? 'selected':''}>Every hour</option>
            <option value="daily"   ${crn.freq==='daily'   ? 'selected':''}>Daily</option>
            <option value="weekly"  ${crn.freq==='weekly'  ? 'selected':''}>Weekly</option>
            <option value="monthly" ${crn.freq==='monthly' ? 'selected':''}>Monthly</option>
          </select>

          <select id="jf-dow" style="${crn.freq!=='weekly' ? 'display:none':''}" title="Day of week">
            ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                .map((d,i) => `<option value="${i}" ${crn.dow===i ? 'selected':''}>${d}</option>`).join('')}
          </select>

          <input id="jf-dom" type="number" min="1" max="28" value="${crn.dom}"
                 style="${crn.freq!=='monthly' ? 'display:none':''}" title="Day of month" class="jobs-dom-input">

          <div id="jf-time-wrap" style="${crn.freq==='hourly' ? 'display:none':'display:flex;gap:4px;align-items:center'}">
            <span style="font-family:var(--mono);font-size:11px;color:var(--ink3)">at</span>
            <input id="jf-hour"   type="number" min="0" max="23" value="${crn.hour}"   class="jobs-time-input" placeholder="HH">
            <span style="font-family:var(--mono);font-size:12px">:</span>
            <input id="jf-minute" type="number" min="0" max="59" value="${crn.minute}" class="jobs-time-input" placeholder="MM">
          </div>
        </div>
        <div id="jf-cron-preview" class="jobs-cron-preview"></div>
      </div>

      <div class="jobs-field jobs-field--row">
        <label>Max tokens / run</label>
        <input id="jf-tokens" type="number" min="100" max="4000" value="${isEdit ? job.max_tokens_per_run : 500}" class="jobs-tokens-input">
        <span class="jobs-field-hint">≈ $${(500 * 15 / 1_000_000).toFixed(4)} max output cost per run</span>
      </div>

      <div class="jobs-field jobs-field--row">
        <label>Enabled</label>
        <input id="jf-enabled" type="checkbox" ${(!isEdit || job.enabled) ? 'checked' : ''}>
      </div>

      <div class="jobs-form-actions">
        <button class="jobs-btn-ghost" onclick="window.jobs.closeDrawer()">Cancel</button>
        <button class="jobs-btn-primary" onclick="window.jobs.saveJob()">
          ${isEdit ? 'Save changes' : 'Create job'}
        </button>
      </div>
    </div>`;

    // Pre-fill prompt if creating new with a template
    if (!isEdit) {
        const tpl = templates.find(t => t.id === 'daily_brief');
        if (tpl) {
            document.getElementById('jf-prompt').value = tpl.defaultPrompt;
            document.getElementById('jf-name').value   = tpl.name;
        }
    }

    updateCronPreview();

    overlay.classList.add('active');
    drawer.classList.add('active');
}

function updateCronPreview() {
    const freq   = document.getElementById('jf-freq')?.value;
    const hour   = parseInt(document.getElementById('jf-hour')?.value   ?? '8');
    const minute = parseInt(document.getElementById('jf-minute')?.value ?? '0');
    const dow    = parseInt(document.getElementById('jf-dow')?.value    ?? '1');
    const dom    = parseInt(document.getElementById('jf-dom')?.value    ?? '1');
    const expr   = buildCron({ freq, hour, minute, dow, dom });
    const prev   = document.getElementById('jf-cron-preview');
    if (prev) prev.textContent = `cron: ${expr}  ·  ${describeCron(expr)}`;
}

// ── Public API (exposed on window) ────────────────────────────────────────────

export async function initJobs() {
    await refresh();
}

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
    renderJobsList();
    renderRunsPanel();
}

window.jobs = {
    async viewRuns(jobId) {
        runsView = jobs.find(j => j.id === jobId) ?? null;
        renderJobsList();    // re-render to highlight active row
        renderRunsPanel();
    },

    openCreate() { openDrawer(null); },

    edit(jobId) {
        const job = jobs.find(j => j.id === jobId);
        if (job) openDrawer(job);
    },

    closeDrawer() {
        document.getElementById('jobs-drawer')?.classList.remove('active');
        document.getElementById('jobs-overlay')?.classList.remove('active');
        editing = null;
    },

    onSkillChange(skillId) {
        const tpl = templates.find(t => t.id === skillId);
        if (!tpl) return;
        const promptEl = document.getElementById('jf-prompt');
        const nameEl   = document.getElementById('jf-name');
        if (promptEl && tpl.defaultPrompt) promptEl.value = tpl.defaultPrompt;
        if (nameEl   && !editing)          nameEl.value   = tpl.name;

        // Update suggested schedule
        const { freq, hour, minute, dow } = parseCron(tpl.suggestedSchedule);
        const freqEl = document.getElementById('jf-freq');
        const hourEl = document.getElementById('jf-hour');
        const minEl  = document.getElementById('jf-minute');
        const dowEl  = document.getElementById('jf-dow');
        if (freqEl) freqEl.value = freq;
        if (hourEl) hourEl.value = hour;
        if (minEl)  minEl.value  = minute;
        if (dowEl)  dowEl.value  = dow;
        window.jobs.onFreqChange();

        // Update token input
        const tokEl = document.getElementById('jf-tokens');
        if (tokEl) tokEl.value = tpl.suggestedMaxTokens;
    },

    onFreqChange() {
        const freq    = document.getElementById('jf-freq')?.value;
        const dowEl   = document.getElementById('jf-dow');
        const domEl   = document.getElementById('jf-dom');
        const timeEl  = document.getElementById('jf-time-wrap');

        if (dowEl)  dowEl.style.display  = freq === 'weekly'  ? '' : 'none';
        if (domEl)  domEl.style.display  = freq === 'monthly' ? '' : 'none';
        if (timeEl) timeEl.style.display = freq === 'hourly'  ? 'none' : 'flex';
        updateCronPreview();
    },

    async saveJob() {
        const name    = document.getElementById('jf-name')?.value.trim();
        const prompt  = document.getElementById('jf-prompt')?.value.trim();
        const skill   = document.getElementById('jf-skill')?.value;
        const freq    = document.getElementById('jf-freq')?.value;
        const hour    = parseInt(document.getElementById('jf-hour')?.value   ?? '8');
        const minute  = parseInt(document.getElementById('jf-minute')?.value ?? '0');
        const dow     = parseInt(document.getElementById('jf-dow')?.value    ?? '1');
        const dom     = parseInt(document.getElementById('jf-dom')?.value    ?? '1');
        const tokens  = parseInt(document.getElementById('jf-tokens')?.value ?? '500');
        const enabled = document.getElementById('jf-enabled')?.checked ?? true;
        const schedule = buildCron({ freq, hour, minute, dow, dom });

        if (!name)    { alert('Job name is required.'); return; }
        if (!prompt)  { alert('Prompt is required.'); return; }

        const body = { name, prompt, skill_id: skill, schedule, enabled, max_tokens_per_run: tokens };

        try {
            if (editing) {
                await api.jobUpdate(editing.id, body);
            } else {
                await api.jobCreate(body);
            }
            window.jobs.closeDrawer();
            await refresh();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    },

    async toggleEnabled(jobId, enabled) {
        await api.jobUpdate(jobId, { enabled });
        await refresh();
    },

    async runNow(jobId) {
        const btn = document.querySelector(`#jr-${jobId} .jobs-btn-sm`);
        const job = jobs.find(j => j.id === jobId);
        if (!job) return;

        // Optimistic feedback
        const origHTML = btn?.innerHTML;
        if (btn) btn.innerHTML = '<span class="spinner" style="width:10px;height:10px"></span>';

        try {
            const result = await api.jobRunNow(jobId);
            if (result.status === 'success') {
                // Show output briefly in runs panel
                runsView = job;
                renderJobsList();
            } else if (result.status === 'skipped') {
                alert(`Job skipped: ${result.error}`);
            } else {
                alert(`Job failed: ${result.error}`);
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        } finally {
            if (btn) btn.innerHTML = origHTML ?? '▶';
        }

        await refresh();
    },

    async del(jobId) {
        const job = jobs.find(j => j.id === jobId);
        if (!job) return;
        if (!confirm(`Delete "${job.name}"? This cannot be undone.`)) return;

        try {
            await api.jobDelete(jobId);
            if (runsView?.id === jobId) runsView = null;
            await refresh();
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    },
};

// ── Utils ─────────────────────────────────────────────────────────────────────

function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
}

function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s <  60)   return `${s}s ago`;
    if (s <  3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}
