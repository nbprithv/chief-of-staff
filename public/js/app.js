import { api } from './api.js';

// ── Navigation ─────────────────────────────────────────────────────────────────

function initNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;

            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById(`view-${view}`);
            if (target) target.classList.add('active');

            // Lazy-load view data on first visit
            if (view === 'inbox')    loadInbox();
            if (view === 'calendar') loadCalendarView();
        });
    });
}

// ── Status bar ─────────────────────────────────────────────────────────────────

async function refreshStatus() {
    try {
        await api.health();
        setStatus('db', 'ok', 'DB');
    } catch {
        setStatus('db', 'error', 'DB error');
    }

    try {
        const { connected, user } = await api.gmailStatus();
        if (connected) {
            setStatus('google', 'synced', user?.email ?? 'Google connected');
            document.getElementById('sync-btn')?.removeAttribute('disabled');
            document.getElementById('sync-gmail-btn')?.removeAttribute('disabled');
            document.getElementById('sync-calendar-btn')?.removeAttribute('disabled');
            updateSettingsBlock(true, user);
        } else {
            setStatus('google', 'warn', 'Google not connected');
            updateSettingsBlock(false, null);
        }
    } catch {
        setStatus('google', 'warn', 'Google not connected');
        updateSettingsBlock(false, null);
    }

    try {
        const { count } = await api.emailUntriaged();
        if (count > 0) {
            setStatus('triage', 'warn', `${count} unread`);
            updateBadge('nav-inbox', count);
        } else {
            removeStatus('triage');
        }
    } catch { /* ignore */ }
}

function updateSettingsBlock(connected, user) {
    const el = document.getElementById('google-status-block');
    if (!el) return;
    if (connected && user) {
        el.innerHTML = `<span style="color:var(--green);font-weight:500">● Connected</span> as ${user.email}`;
    } else {
        el.textContent = 'Not connected. Click below to authorize Gmail and Calendar access.';
    }
}

function setStatus(id, type, text) {
    const bar = document.getElementById('status-bar');
    if (!bar) return;
    let el = document.getElementById(`status-${id}`);
    if (!el) {
        el = document.createElement('span');
        el.id = `status-${id}`;
        el.className = 'status-pill';
        bar.appendChild(el);
    }
    el.className = `status-pill status-${type}`;
    el.textContent = text;
}

function removeStatus(id) {
    document.getElementById(`status-${id}`)?.remove();
}

function updateBadge(navId, count) {
    const item = document.getElementById(navId);
    if (!item) return;
    let badge = item.querySelector('.nav-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        item.appendChild(badge);
    }
    badge.textContent = count;
}

// ── Masthead date ──────────────────────────────────────────────────────────────

function setMastheadDate() {
    const el = document.getElementById('masthead-date');
    if (!el) return;
    el.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
}

// ── Week strip (right panel) ───────────────────────────────────────────────────

function buildWeekStrip() {
    const strip = document.getElementById('week-strip');
    if (!strip) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find Monday of current week
    const monday = new Date(today);
    const dow = today.getDay(); // 0=Sun
    const offset = dow === 0 ? -6 : 1 - dow;
    monday.setDate(today.getDate() + offset);

    const dayNames = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    let html = '';

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const isToday   = d.getTime() === today.getTime();
        const isWeekend = i >= 5;
        const cls = ['cal-day', isToday ? 'today' : '', isWeekend ? 'weekend' : ''].filter(Boolean).join(' ');
        html += `<div class="${cls}">
            <div class="cal-day-name">${dayNames[i]}</div>
            <div class="cal-day-num">${d.getDate()}</div>
        </div>`;
    }

    strip.innerHTML = html;
}

// ── Dashboard data ─────────────────────────────────────────────────────────────

async function loadDashboard() {
    await Promise.all([
        loadTodayEvents(),
        loadInboxPreview(),
    ]);
}

async function loadTodayEvents() {
    const container = document.getElementById('today-events-list');
    const countEl   = document.getElementById('today-events-count');
    if (!container) return;

    try {
        const { nodes = [] } = await api.nodes({ type: 'event' });

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

        const todayEvents = nodes.filter(n => {
            const t = n.due_at ? new Date(n.due_at) : null;
            return t && t >= todayStart && t <= todayEnd;
        }).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

        if (countEl) countEl.textContent = `${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}`;

        if (todayEvents.length === 0) {
            container.innerHTML = emptyState('No events today');
            return;
        }

        container.innerHTML = todayEvents.map(renderEventRow).join('');
        updateUpcomingPanel(nodes);
    } catch {
        container.innerHTML = emptyState('Could not load events');
    }
}

async function loadInboxPreview() {
    const container = document.getElementById('inbox-preview-list');
    const countEl   = document.getElementById('inbox-preview-count');
    if (!container) return;

    try {
        const { emails = [] } = await api.emails({ limit: 5 });

        if (countEl) countEl.textContent = `${emails.length} recent`;

        if (emails.length === 0) {
            container.innerHTML = emptyState('No emails — sync Gmail to load');
            return;
        }

        container.innerHTML = emails.map(renderEmailRow).join('');
    } catch {
        container.innerHTML = emptyState('Could not load emails');
    }
}

// ── Inbox view ─────────────────────────────────────────────────────────────────

let inboxLoaded = false;

async function loadInbox() {
    if (inboxLoaded) return;
    inboxLoaded = true;

    const container = document.getElementById('inbox-full-list');
    const countEl   = document.getElementById('inbox-full-count');
    if (!container) return;

    try {
        const { emails = [] } = await api.emails({ limit: 100 });

        if (countEl) countEl.textContent = `${emails.length} email${emails.length !== 1 ? 's' : ''}`;

        if (emails.length === 0) {
            container.innerHTML = emptyState('No emails — click Sync Gmail to fetch');
            return;
        }

        container.innerHTML = emails.map(renderEmailRow).join('');
    } catch {
        container.innerHTML = emptyState('Could not load emails');
    }
}

// ── Calendar view ──────────────────────────────────────────────────────────────

let calendarLoaded = false;

async function loadCalendarView() {
    if (calendarLoaded) return;
    calendarLoaded = true;

    const container = document.getElementById('calendar-events-list');
    const countEl   = document.getElementById('calendar-events-count');
    if (!container) return;

    try {
        const { nodes = [] } = await api.nodes({ type: 'event' });

        const upcoming = nodes
            .filter(n => n.due_at && new Date(n.due_at) >= new Date(new Date().setHours(0,0,0,0)))
            .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

        if (countEl) countEl.textContent = `${upcoming.length} upcoming`;

        if (upcoming.length === 0) {
            container.innerHTML = emptyState('No events — click Sync Calendar to fetch');
            return;
        }

        // Group by date
        const grouped = {};
        for (const node of upcoming) {
            const dateKey = new Date(node.due_at).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
            });
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(node);
        }

        let html = '';
        for (const [date, events] of Object.entries(grouped)) {
            html += `<div class="date-group-label">${date}</div>`;
            html += events.map(renderEventRow).join('');
        }
        container.innerHTML = html;
    } catch {
        container.innerHTML = emptyState('Could not load events');
    }
}

// ── Upcoming events panel (right sidebar) ─────────────────────────────────────

function updateUpcomingPanel(allNodes) {
    const container = document.getElementById('upcoming-events-panel');
    if (!container) return;

    const now     = new Date();
    const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);

    const upcoming = allNodes
        .filter(n => n.due_at && new Date(n.due_at) >= now && new Date(n.due_at) <= weekEnd)
        .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
        .slice(0, 5);

    if (upcoming.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = upcoming.map(n => {
        const d = new Date(n.due_at);
        const isToday = d.toDateString() === now.toDateString();
        const timeStr = isToday
            ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            : d.toLocaleDateString('en-US', { weekday: 'short' });
        return `<div class="event-item">
            <div class="event-time">${timeStr}</div>
            <div>
                <div class="event-name">${escHtml(n.title)}</div>
                ${n.description ? `<div class="event-loc">${escHtml(n.description.slice(0, 60))}</div>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ── Sync button ────────────────────────────────────────────────────────────────

function initSyncButtons() {
    document.getElementById('sync-btn')?.addEventListener('click', syncAll);
    document.getElementById('sync-gmail-btn')?.addEventListener('click', async () => {
        setSyncing('sync-gmail-btn', true);
        try {
            await api.gmailSync({});
            inboxLoaded = false;
            loadInbox();
        } finally {
            setSyncing('sync-gmail-btn', false);
        }
    });
    document.getElementById('sync-calendar-btn')?.addEventListener('click', async () => {
        setSyncing('sync-calendar-btn', true);
        try {
            await api.calendarSync({});
            calendarLoaded = false;
            loadCalendarView();
        } finally {
            setSyncing('sync-calendar-btn', false);
        }
    });
}

async function syncAll() {
    const btn = document.getElementById('sync-btn');
    if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }

    try {
        await Promise.all([
            api.gmailSync({}).catch(() => {}),
            api.calendarSync({}).catch(() => {}),
        ]);
        // Refresh dashboard data
        inboxLoaded = false;
        calendarLoaded = false;
        await loadDashboard();
        // Refresh untriaged count
        await refreshStatus();
    } finally {
        if (btn) { btn.textContent = '↻ Sync now'; btn.disabled = false; }
    }
}

function setSyncing(btnId, syncing) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.textContent = syncing ? '↻ Syncing…' : (btnId === 'sync-gmail-btn' ? '↻ Sync Gmail' : '↻ Sync Calendar');
    btn.disabled = syncing;
}

// ── Render helpers ─────────────────────────────────────────────────────────────

function renderEventRow(node) {
    const d = node.due_at ? new Date(node.due_at) : null;
    const timeStr = d
        ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : '';
    return `<div class="event-item">
        <div class="event-time">${timeStr}</div>
        <div>
            <div class="event-name">${escHtml(node.title)}</div>
            ${node.description ? `<div class="event-loc">${escHtml(node.description.slice(0, 80))}</div>` : ''}
        </div>
    </div>`;
}

function renderEmailRow(email) {
    const isUnread = !email.triaged;
    const cls = `email-row${isUnread ? ' unread' : ''}`;
    const time = email.received_at
        ? formatEmailTime(new Date(email.received_at))
        : '';
    const sender = email.sender_name || email.sender_email || 'Unknown';
    const preview = email.body_raw
        ? email.body_raw.replace(/\s+/g, ' ').slice(0, 120)
        : '';
    return `<div class="${cls}">
        <div>
            <div class="email-from">${escHtml(sender)}</div>
            <div class="email-subject">${escHtml(email.subject || '(no subject)')}</div>
            ${preview ? `<div class="email-preview">${escHtml(preview)}</div>` : ''}
        </div>
        <div class="email-meta">${time}</div>
    </div>`;
}

function formatEmailTime(date) {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function emptyState(msg) {
    return `<div style="padding:28px 0;text-align:center;font-family:var(--mono);font-size:12px;color:var(--ink4)">${msg}</div>`;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
    setMastheadDate();
    buildWeekStrip();
    initNav();
    initSyncButtons();

    await Promise.all([
        refreshStatus(),
        loadDashboard(),
    ]);
}

document.addEventListener('DOMContentLoaded', boot);
