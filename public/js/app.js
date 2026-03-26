import { api } from './api.js';

const DIGEST_QUERY = '(in:sent OR in:drafts) subject:"Galloway School Digest"';

const emailsById = new Map();

// ── Navigation ─────────────────────────────────────────────────────────────────

function switchView(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
    document.getElementById(`view-${name}`)?.classList.add('active');
    if (name === 'digests')  loadDigests();
    if (name === 'calendar') loadCalendar();
}

function initNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });
    document.getElementById('dash-cal-link')?.addEventListener('click',     () => switchView('calendar'));
    document.getElementById('dash-digests-link')?.addEventListener('click', () => switchView('digests'));
}

// ── Masthead ───────────────────────────────────────────────────────────────────

function setMastheadDate() {
    const el = document.getElementById('masthead-date');
    if (el) el.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
}

async function loadUser() {
    try {
        const { connected, user } = await api.gmailStatus();
        const el = document.getElementById('masthead-user');
        if (el && connected && user?.email) el.textContent = user.email;
        const block = document.getElementById('google-status-block');
        if (block) {
            block.innerHTML = connected && user
                ? `<span style="color:var(--green);font-weight:500">● Connected</span> as ${escHtml(user.email)}`
                : 'Not connected.';
        }
    } catch { /* ignore */ }
}

// ── Metrics ────────────────────────────────────────────────────────────────────

async function loadMetrics() {
    // Calendar counts
    try {
        const { nodes = [] } = await api.nodes({ type: 'event', limit: 500 });
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
        const weekEnd    = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + 7);

        const todayCount = nodes.filter(n => {
            const t = n.due_at ? new Date(n.due_at) : null;
            return t && t >= todayStart && t <= todayEnd;
        }).length;

        const weekCount = nodes.filter(n => {
            const t = n.due_at ? new Date(n.due_at) : null;
            return t && t >= todayStart && t < weekEnd;
        }).length;

        document.getElementById('m-today').textContent = todayCount;
        document.getElementById('m-week').textContent  = weekCount;
    } catch {
        document.getElementById('m-today').textContent = '—';
        document.getElementById('m-week').textContent  = '—';
    }

    // Digest count
    try {
        const { emails = [] } = await api.emails({ limit: 500 });
        document.getElementById('m-digests').textContent = emails.length;
        const badge = document.getElementById('badge-digests');
        if (badge) badge.textContent = emails.length > 0 ? emails.length : '';
    } catch {
        document.getElementById('m-digests').textContent = '—';
    }

    // Last sync (stored in localStorage)
    const lastSync = localStorage.getItem('lastSync');
    const syncEl = document.getElementById('m-sync');
    if (syncEl) syncEl.textContent = lastSync ? relativeTime(new Date(lastSync)) : 'never';
}

function relativeTime(date) {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

async function loadDashboard() {
    await Promise.all([loadSchedule(), loadRecentDigests()]);
}

async function loadSchedule() {
    const container = document.getElementById('dash-schedule');
    if (!container) return;

    try {
        const { nodes = [] } = await api.nodes({ type: 'event', limit: 500 });

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const cutoff     = new Date(todayStart); cutoff.setDate(todayStart.getDate() + 14);
        const tomorrow   = new Date(todayStart); tomorrow.setDate(todayStart.getDate() + 1);

        const upcoming = nodes
            .filter(n => n.due_at && new Date(n.due_at) >= todayStart && new Date(n.due_at) < cutoff)
            .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

        if (upcoming.length === 0) {
            container.innerHTML = emptyState('No events in the next 14 days');
            return;
        }

        // Group by day
        const groups = new Map();
        for (const n of upcoming) {
            const d = new Date(n.due_at); d.setHours(0, 0, 0, 0);
            let label;
            if (d.getTime() === todayStart.getTime())  label = 'Today';
            else if (d.getTime() === tomorrow.getTime()) label = 'Tomorrow';
            else label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(n);
        }

        let html = '';
        for (const [label, events] of groups) {
            const isToday = label === 'Today';
            html += `<div class="date-group-label${isToday ? ' today-label' : ''}">${label}</div>`;
            html += events.map(n => {
                const meta = safeJson(n.metadata);
                const timeStr = meta.all_day
                    ? 'all day'
                    : new Date(n.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                return `<div class="event-item">
                    <div class="event-time">${timeStr}</div>
                    <div>
                        <div class="event-name">${escHtml(n.title)}</div>
                        ${n.location ? `<div class="event-loc">${escHtml(n.location)}</div>` : ''}
                    </div>
                </div>`;
            }).join('');
        }
        container.innerHTML = html;
    } catch {
        container.innerHTML = emptyState('Could not load schedule');
    }
}

async function loadRecentDigests() {
    const container = document.getElementById('dash-digests');
    if (!container) return;

    try {
        const { emails = [] } = await api.emails({ limit: 8 });

        if (emails.length === 0) {
            container.innerHTML = emptyState('No digests — sync to load');
            return;
        }

        emails.forEach(e => emailsById.set(e.id, e));
        container.innerHTML = emails.map(renderDigestRow).join('');
    } catch {
        container.innerHTML = emptyState('Could not load digests');
    }
}

// ── Digests view ───────────────────────────────────────────────────────────────

let digestsLoaded = false;

async function loadDigests() {
    if (digestsLoaded) return;
    digestsLoaded = true;

    const container = document.getElementById('digests-list');
    const countEl   = document.getElementById('digests-count');
    if (!container) return;

    try {
        const { emails = [] } = await api.emails({ limit: 500 });

        if (countEl) countEl.textContent = `${emails.length} digest${emails.length !== 1 ? 's' : ''}`;

        if (emails.length === 0) {
            container.innerHTML = emptyState('No digests — click Sync to fetch');
            return;
        }

        emails.forEach(e => emailsById.set(e.id, e));
        container.innerHTML = emails.map(renderEmailRow).join('');
    } catch {
        container.innerHTML = emptyState('Could not load digests');
    }
}

// ── Calendar view ──────────────────────────────────────────────────────────────

let calendarLoaded = false;

async function loadCalendar() {
    if (calendarLoaded) return;
    calendarLoaded = true;

    const container = document.getElementById('calendar-list');
    const countEl   = document.getElementById('calendar-count');
    if (!container) return;

    try {
        const { nodes = [] } = await api.nodes({ type: 'event', limit: 500 });

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const upcoming = nodes
            .filter(n => n.due_at && new Date(n.due_at) >= todayStart)
            .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

        if (countEl) countEl.textContent = `${upcoming.length} upcoming`;

        if (upcoming.length === 0) {
            container.innerHTML = emptyState('No events — click Sync to fetch');
            return;
        }

        const grouped = new Map();
        for (const n of upcoming) {
            const key = new Date(n.due_at).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
            });
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(n);
        }

        let html = '';
        for (const [date, events] of grouped) {
            html += `<div class="date-group-label">${date}</div>`;
            html += events.map(n => {
                const meta    = safeJson(n.metadata);
                const timeStr = meta.all_day
                    ? 'all day'
                    : new Date(n.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                return `<div class="event-item">
                    <div class="event-time">${timeStr}</div>
                    <div>
                        <div class="event-name">${escHtml(n.title)}</div>
                        ${n.location    ? `<div class="event-loc">${escHtml(n.location)}</div>` : ''}
                        ${n.description ? `<div class="event-loc">${escHtml(n.description.slice(0, 80))}</div>` : ''}
                    </div>
                </div>`;
            }).join('');
        }
        container.innerHTML = html;
    } catch {
        container.innerHTML = emptyState('Could not load events');
    }
}

// ── Sync ───────────────────────────────────────────────────────────────────────

function initSyncButtons() {
    document.getElementById('sync-btn')?.addEventListener('click', syncAll);

    document.getElementById('sync-digests-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('sync-digests-btn');
        if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }
        try {
            await api.gmailSync({ query: DIGEST_QUERY, max_emails: 100 });
            digestsLoaded = false;
            await Promise.all([loadDigests(), loadMetrics()]);
        } finally {
            if (btn) { btn.textContent = '↻ Sync'; btn.disabled = false; }
        }
    });

    document.getElementById('sync-calendar-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('sync-calendar-btn');
        if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }
        try {
            await api.calendarSync({});
            calendarLoaded = false;
            await Promise.all([loadCalendar(), loadMetrics()]);
        } finally {
            if (btn) { btn.textContent = '↻ Sync'; btn.disabled = false; }
        }
    });
}

async function syncAll() {
    const btn = document.getElementById('sync-btn');
    if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }

    try {
        await Promise.all([
            api.gmailSync({ query: DIGEST_QUERY, max_emails: 100 }).catch(() => {}),
            api.calendarSync({}).catch(() => {}),
        ]);
        localStorage.setItem('lastSync', new Date().toISOString());

        digestsLoaded  = false;
        calendarLoaded = false;
        await Promise.all([loadMetrics(), loadDashboard()]);
    } finally {
        if (btn) { btn.textContent = '↻ Sync'; btn.disabled = false; }
    }
}

// ── Sign out ───────────────────────────────────────────────────────────────────

function initSignOut() {
    document.getElementById('signout-btn')?.addEventListener('click', async () => {
        try {
            const res  = await fetch('/integrations/google/disconnect', { method: 'DELETE' });
            const data = await res.json();
            window.location.href = data.redirect ?? '/login';
        } catch {
            window.location.href = '/login';
        }
    });
}

// ── Render helpers ─────────────────────────────────────────────────────────────

function renderDigestRow(email) {
    const date = email.received_at
        ? new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
    return `<div class="digest-row" data-id="${escHtml(email.id)}">
        <div class="digest-date">${date}</div>
        <div class="digest-subject">${escHtml(email.subject || '(no subject)')}</div>
    </div>`;
}

function renderEmailRow(email) {
    const date = email.received_at
        ? new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
    const preview = email.body_raw
        ? email.body_raw.replace(/\s+/g, ' ').trim().slice(0, 100)
        : '';
    return `<div class="email-row" data-id="${escHtml(email.id)}">
        <div>
            <div class="email-subject">${escHtml(email.subject || '(no subject)')}</div>
            ${preview ? `<div class="email-preview">${escHtml(preview)}</div>` : ''}
        </div>
        <div class="email-meta">${date}</div>
    </div>`;
}

function emptyState(msg) {
    return `<div style="padding:32px 0;text-align:center;font-family:var(--mono);font-size:11px;color:var(--ink4)">${msg}</div>`;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function safeJson(str) {
    try { return JSON.parse(str || '{}'); } catch { return {}; }
}

// ── Digest modal ───────────────────────────────────────────────────────────────

function isHtmlEmail(body) {
    return /<(html|body|div|p|table|span)\b/i.test(body || '');
}

function openDigestModal(email) {
    if (!email) return;

    document.getElementById('modal-subject').textContent = email.subject || '(no subject)';

    const parts = [];
    if (email.sender_name || email.sender_email) {
        parts.push(`From: ${email.sender_name || email.sender_email}`);
    }
    if (email.received_at) {
        parts.push(new Date(email.received_at).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        }));
    }
    document.getElementById('modal-meta').textContent = parts.join('  ·  ');

    const body   = email.body_raw || email.body_summary || '(no content)';
    const modal  = document.getElementById('digest-modal');
    const iframe = document.getElementById('modal-iframe');

    if (isHtmlEmail(body)) {
        iframe.srcdoc = body;
        modal.classList.add('html-mode');
    } else {
        document.getElementById('modal-body').textContent = body;
        modal.classList.remove('html-mode');
    }

    modal.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
}

function closeDigestModal() {
    const modal = document.getElementById('digest-modal');
    modal.classList.remove('is-open', 'html-mode');
    document.getElementById('modal-iframe').srcdoc = '';
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
}

function initDigestModal() {
    document.getElementById('modal-close')?.addEventListener('click', closeDigestModal);

    document.getElementById('digest-modal')?.addEventListener('click', e => {
        if (e.target.id === 'digest-modal') closeDigestModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeDigestModal();
    });

    document.getElementById('dash-digests')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) openDigestModal(emailsById.get(row.dataset.id));
    });

    document.getElementById('digests-list')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) openDigestModal(emailsById.get(row.dataset.id));
    });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
    setMastheadDate();
    initNav();
    initSyncButtons();
    initSignOut();
    initDigestModal();

    await Promise.all([
        loadUser(),
        loadMetrics(),
        loadDashboard(),
    ]);
}

document.addEventListener('DOMContentLoaded', boot);
