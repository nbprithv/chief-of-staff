import { api } from './api.js';
import { stripHtml } from './email-parser.js';

const DIGEST_QUERY = '(in:sent OR in:drafts) subject:"Galloway School Digest"';

const emailsById  = new Map();
const eventsById  = new Map();

/** ISO datetime string for 20 days ago — used to filter email fetches. */
function since20Days() {
    const d = new Date();
    d.setDate(d.getDate() - 20);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

// ── Navigation ─────────────────────────────────────────────────────────────────

const MAIN_VIEWS = new Set(['dashboard', 'digests', 'calendar', 'settings']);

// Apply DOM changes for a given view name without touching the URL.
function applyViewDOM(name) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${name}"]`)?.classList.add('active');
    document.getElementById(`view-${name}`)?.classList.add('active');
    if (name === 'digests')  loadDigests();
    if (name === 'calendar') loadCalendar();
}

// Navigate to a named view — updates the hash so the browser records history.
function switchView(name) {
    location.hash = name;
}

// Navigate to an email detail — hash becomes #email/<id>.
function navigateToEmail(email) {
    location.hash = `email/${email.id}`;
}

// Navigate to an event detail — hash becomes #event/<id>.
function navigateToEvent(event) {
    location.hash = `event/${event.id}`;
}

// Read the current hash and apply the matching view/detail.
function applyHash() {
    const hash = location.hash.slice(1); // strip leading '#'

    if (hash.startsWith('email/')) {
        const id    = hash.slice(6);
        const email = emailsById.get(id);
        if (email) { renderEmailView(email); applyViewDOM('email'); return; }
        // ID not in memory — fall through to digests
        applyViewDOM('digests');
        return;
    }

    if (hash.startsWith('event/')) {
        const id    = hash.slice(6);
        const event = eventsById.get(id);
        if (event) { renderEventView(event); applyViewDOM('event'); return; }
        applyViewDOM('calendar');
        return;
    }

    const view = MAIN_VIEWS.has(hash) ? hash : 'dashboard';
    applyViewDOM(view);
}

function initNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });
    document.getElementById('dash-cal-link')?.addEventListener('click',     () => switchView('calendar'));
    document.getElementById('dash-digests-link')?.addEventListener('click', () => switchView('digests'));

    window.addEventListener('hashchange', applyHash);
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
        const { emails = [] } = await api.emails({ limit: 8, since: since20Days() });

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
        const { emails = [] } = await api.emails({ limit: 500, since: since20Days() });

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

const calState = {
    loaded:       false,
    year:         new Date().getFullYear(),
    month:        new Date().getMonth(),
    selectedDate: null,
    dateMap:      null,   // Map<'YYYY-MM-DD', node[]>
};

function dateKey(dt) {
    // Returns 'YYYY-MM-DD' in local time
    const d = new Date(dt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildEventsDateMap(nodes) {
    const map = new Map();
    for (const n of nodes) {
        const key = dateKey(n.starts_at || n.due_at);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(n);
    }
    return map;
}

function renderCalendarMonth() {
    const { year, month, dateMap, selectedDate } = calState;
    const today      = dateKey(new Date());
    const firstDow   = new Date(year, month, 1).getDay();  // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const el = document.getElementById('cal-month-label');
    if (el) el.textContent = monthLabel;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const headerEl = document.getElementById('cal-grid-header');
    if (headerEl) {
        headerEl.innerHTML = dayNames.map(d =>
            `<div class="cal-grid-header-cell">${d}</div>`
        ).join('');
    }

    let cells = '';
    for (let i = 0; i < firstDow; i++) {
        cells += `<div class="cal-grid-day cal-grid-day--empty"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const key      = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const events   = dateMap?.get(key) ?? [];
        const dow      = (firstDow + d - 1) % 7;
        const isWeekend = dow === 0 || dow === 6;
        const classes  = [
            'cal-grid-day',
            key === today         ? 'cal-grid-day--today'    : '',
            key === selectedDate  ? 'cal-grid-day--selected' : '',
            isWeekend             ? 'cal-grid-day--weekend'  : '',
        ].filter(Boolean).join(' ');
        cells += `<button class="${classes}" data-date="${key}">
            <span class="cal-day-num">${d}</span>
            ${events.length ? `<span class="cal-event-badge">${events.length}</span>` : ''}
        </button>`;
    }

    const gridEl = document.getElementById('cal-grid');
    if (gridEl) gridEl.innerHTML = cells;
}

function renderDayEvents(key) {
    calState.selectedDate = key;
    const panel = document.getElementById('cal-day-panel');
    if (!panel) return;

    const events = (calState.dateMap?.get(key) ?? [])
        .slice()
        .sort((a, b) => (a.starts_at || a.due_at || '').localeCompare(b.starts_at || b.due_at || ''));

    const label = new Date(key + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    if (events.length === 0) {
        panel.innerHTML = `<div class="cal-day-panel-label">${label}</div>
            <div class="cal-no-events">No events</div>`;
        return;
    }

    const rows = events.map(n => {
        const meta = safeJson(n.metadata);
        let timeHtml;
        if (meta.all_day) {
            timeHtml = `<div class="cal-ev-allday">All day</div>`;
        } else {
            const dt   = new Date(n.starts_at || n.due_at);
            const hour = dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(/\s?(AM|PM)/i, '');
            const ampm = dt.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).match(/AM|PM/i)?.[0] ?? '';
            const mins = dt.getMinutes() ? `:${String(dt.getMinutes()).padStart(2, '0')}` : '';
            timeHtml = `<div class="cal-ev-time">${hour}${mins}<span class="cal-ev-time-ampm">${ampm}</span></div>`;
        }
        return `<div class="cal-ev-item" data-id="${escHtml(n.id)}">
            <div>${timeHtml}</div>
            <div>
                <div class="cal-ev-name">${escHtml(n.title)}</div>
                ${n.location ? `<div class="cal-ev-loc">${escHtml(n.location)}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    panel.innerHTML = `<div class="cal-day-panel-label">${label}</div>${rows}`;
}

async function loadCalendar() {
    if (calState.loaded) return;
    calState.loaded = true;

    const countEl = document.getElementById('calendar-count');
    const panel   = document.getElementById('cal-day-panel');

    try {
        const { nodes = [] } = await api.nodes({ type: 'event', limit: 500 });
        nodes.forEach(n => eventsById.set(n.id, n));

        calState.dateMap = buildEventsDateMap(nodes);

        if (countEl) countEl.textContent = `${nodes.length} event${nodes.length !== 1 ? 's' : ''}`;

        renderCalendarMonth();

        // Auto-select today if it has events, otherwise show placeholder
        const today = dateKey(new Date());
        if (calState.dateMap.has(today)) {
            renderDayEvents(today);
            renderCalendarMonth(); // refresh selection highlight
        } else if (panel) {
            panel.innerHTML = `<div class="cal-no-events">Select a date to see events</div>`;
        }
    } catch {
        if (panel) panel.innerHTML = emptyState('Could not load events');
    }
}

function initCalendarNav() {
    document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
        calState.month--;
        if (calState.month < 0) { calState.month = 11; calState.year--; }
        renderCalendarMonth();
    });

    document.getElementById('cal-next-btn')?.addEventListener('click', () => {
        calState.month++;
        if (calState.month > 11) { calState.month = 0; calState.year++; }
        renderCalendarMonth();
    });

    document.getElementById('cal-grid')?.addEventListener('click', e => {
        const cell = e.target.closest('[data-date]');
        if (!cell) return;
        renderDayEvents(cell.dataset.date);
        renderCalendarMonth();
    });

    document.getElementById('cal-day-panel')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) navigateToEvent(eventsById.get(row.dataset.id));
    });
}

function initThemeToggle() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
    }
    updateThemeIcon();

    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = current === 'dark' || (!current && systemDark);
        const next = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon();
    });
}

function updateThemeIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const current   = document.documentElement.getAttribute('data-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark    = current === 'dark' || (!current && systemDark);
    btn.textContent = isDark ? '☀' : '☾';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
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
            calState.loaded = false; calState.dateMap = null;
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
        calState.loaded = false; calState.dateMap = null;
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
    const raw = email.body_raw || '';
    const isHtml = /<[a-z][^>]*>/i.test(raw);
    const text = isHtml ? stripHtml(raw) : raw;
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    return `<div class="email-row" data-id="${escHtml(email.id)}">
        <div class="email-row-main">
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

// ── Email detail view ──────────────────────────────────────────────────────────

// Convert HTML email to readable DOM nodes, preserving <a> hyperlinks.
function htmlToReadableNodes(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    tmp.querySelectorAll('style, script, head, meta, link, noscript').forEach(el => el.remove());

    const frag = document.createDocumentFragment();

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text) frag.appendChild(document.createTextNode(text));
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName.toLowerCase();

        if (tag === 'a') {
            const href = node.getAttribute('href') || '';
            const label = node.textContent.trim();
            if (href && href.startsWith('http')) {
                const link = document.createElement('a');
                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = label || href;
                link.className = 'email-link';
                frag.appendChild(link);
            } else {
                frag.appendChild(document.createTextNode(label));
            }
            return;
        }

        const block = ['p','div','tr','li','br','h1','h2','h3','h4','h5','h6','blockquote','hr','table','thead','tbody','section','article'].includes(tag);
        if (block && frag.lastChild?.textContent?.slice(-1) !== '\n') {
            frag.appendChild(document.createTextNode('\n'));
        }
        for (const child of node.childNodes) walk(child);
        if (block) frag.appendChild(document.createTextNode('\n'));
    }

    for (const child of tmp.childNodes) walk(child);

    const span = document.createElement('span');
    span.appendChild(frag);
    span.innerHTML = span.innerHTML.replace(/\n{3,}/g, '\n\n');
    return span;
}

// Populate the email detail view DOM without changing the URL.
function renderEmailView(email) {
    document.getElementById('email-detail-subject').textContent = email.subject || '(no subject)';

    const parts = [];
    if (email.sender_name || email.sender_email) {
        parts.push(`From: ${email.sender_name || email.sender_email}`);
    }
    if (email.received_at) {
        parts.push(new Date(email.received_at).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        }));
    }
    document.getElementById('email-detail-meta').textContent = parts.join('  ·  ');

    const raw    = email.body_raw || email.body_summary || '(no content)';
    const bodyEl = document.getElementById('email-detail-body');
    const isHtml = /<(html|body|div|p|table|span|br)\b/i.test(raw);
    bodyEl.innerHTML = '';
    if (isHtml) {
        bodyEl.appendChild(htmlToReadableNodes(raw));
    } else {
        bodyEl.textContent = raw;
    }
}

function initEmailView() {
    document.getElementById('email-back-btn')?.addEventListener('click', () => history.back());

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('view-email')?.classList.contains('active')) {
            history.back();
        }
    });

    document.getElementById('dash-digests')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) navigateToEmail(emailsById.get(row.dataset.id));
    });

    document.getElementById('digests-list')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) navigateToEmail(emailsById.get(row.dataset.id));
    });
}

// ── Event detail view ──────────────────────────────────────────────────────────

// Populate the event detail view DOM without changing the URL.
function renderEventView(event) {
    const meta = safeJson(event.metadata);

    document.getElementById('event-detail-title').textContent = event.title || '(no title)';

    const timeEl = document.getElementById('event-detail-time');
    if (meta.all_day) {
        const day = new Date(event.due_at || event.starts_at).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        timeEl.textContent = `${day}  ·  All day`;
    } else {
        const fmt = dt => new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const day = new Date(event.starts_at || event.due_at).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        const start = event.starts_at ? fmt(event.starts_at) : '';
        const end   = event.ends_at   ? fmt(event.ends_at)   : '';
        timeEl.textContent = [day, start && end ? `${start} – ${end}` : start].filter(Boolean).join('  ·  ');
    }

    const fieldsEl = document.getElementById('event-detail-fields');
    fieldsEl.innerHTML = '';

    const addField = (label, value) => {
        const row = document.createElement('div');
        row.className = 'event-detail-field';
        row.innerHTML = `<div class="event-detail-label">${label}</div><div class="event-detail-value">${value}</div>`;
        fieldsEl.appendChild(row);
    };

    if (event.location) addField('Location', escHtml(event.location));
    if (event.description) addField('Description', escHtml(event.description).replace(/\n/g, '<br>'));
    if (meta.attendees?.length) {
        const list = meta.attendees.map(a => {
            const name = escHtml(a.name || a.email);
            const resp = a.response ? ` <span class="attendee-resp attendee-resp--${a.response}">${a.response}</span>` : '';
            return `<div class="attendee-row">${name}${resp}</div>`;
        }).join('');
        addField('Attendees', list);
    }
    if (meta.recurrence_rule) addField('Repeats', escHtml(meta.recurrence_rule));
}

function initEventView() {
    document.getElementById('event-back-btn')?.addEventListener('click', () => history.back());

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('view-event')?.classList.contains('active')) {
            history.back();
        }
    });

}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
    setMastheadDate();
    initNav();
    initSyncButtons();
    initSignOut();
    initEmailView();
    initEventView();
    initCalendarNav();
    initThemeToggle();

    await Promise.all([
        loadUser(),
        loadMetrics(),
        loadDashboard(),
    ]);

    // Apply the initial hash (handles page refresh on a detail view or deep link).
    applyHash();
}

document.addEventListener('DOMContentLoaded', boot);
