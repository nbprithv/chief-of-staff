import { api } from './api.js';

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

        upcoming.forEach(n => eventsById.set(n.id, n));

        let html = '';
        for (const [date, events] of grouped) {
            html += `<div class="date-group-label">${date}</div>`;
            html += events.map(n => {
                const meta    = safeJson(n.metadata);
                const timeStr = meta.all_day
                    ? 'all day'
                    : new Date(n.due_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                return `<div class="event-item" data-id="${escHtml(n.id)}">
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

// Date/time pattern: "Monday", "Jan 1", "January 1", "1/15", "3:00 PM", "10am" etc.
const DATE_TIME_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b|\b\d{1,2}\s*(?:am|pm)\b/i;

function parseEmailCounts(body) {
    if (!body) return { actions: 0, events: 0 };

    const isHtml = /<[a-z]/i.test(body);
    let actions = 0;
    let events  = 0;

    if (isHtml) {
        const tmp = document.createElement('div');
        tmp.innerHTML = body;
        // Action items: <li> elements
        actions = tmp.querySelectorAll('li').length;
        // Events: any block element whose text matches a date/time pattern
        tmp.querySelectorAll('p, div, td, h1, h2, h3, h4, li').forEach(el => {
            if (DATE_TIME_RE.test(el.textContent)) events++;
        });
    } else {
        const lines = body.split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (/^[-•*]\s|^\d+[.)]\s/.test(trimmed)) actions++;
            if (DATE_TIME_RE.test(trimmed)) events++;
        });
    }

    return { actions, events };
}

function renderEmailRow(email) {
    const date = email.received_at
        ? new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
    const preview = email.body_raw
        ? email.body_raw.replace(/\s+/g, ' ').trim().slice(0, 100)
        : '';
    const { actions, events } = parseEmailCounts(email.body_raw);
    const pills = [
        actions ? `<span class="digest-pill digest-pill--action">${actions} action${actions !== 1 ? 's' : ''}</span>` : '',
        events  ? `<span class="digest-pill digest-pill--event">${events} event${events !== 1 ? 's' : ''}</span>`   : '',
    ].join('');
    return `<div class="email-row" data-id="${escHtml(email.id)}">
        <div class="email-row-main">
            <div class="email-subject">${escHtml(email.subject || '(no subject)')}</div>
            ${preview ? `<div class="email-preview">${escHtml(preview)}</div>` : ''}
            ${pills   ? `<div class="digest-pills">${pills}</div>` : ''}
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

// Track which view we came from so Back returns to the right place.
let emailViewReturnTo = 'digests';

function openEmailView(email) {
    if (!email) return;

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

    // Remember the current active view before switching
    const active = document.querySelector('.view.active');
    emailViewReturnTo = active?.id?.replace('view-', '') ?? 'digests';

    switchView('email');
}

function initEmailView() {
    document.getElementById('email-back-btn')?.addEventListener('click', () => {
        switchView(emailViewReturnTo);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('view-email')?.classList.contains('active')) {
            switchView(emailViewReturnTo);
        }
    });

    document.getElementById('dash-digests')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) openEmailView(emailsById.get(row.dataset.id));
    });

    document.getElementById('digests-list')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) openEmailView(emailsById.get(row.dataset.id));
    });
}

// ── Event detail view ──────────────────────────────────────────────────────────

let eventViewReturnTo = 'calendar';

function openEventView(event) {
    if (!event) return;

    const meta = safeJson(event.metadata);

    document.getElementById('event-detail-title').textContent = event.title || '(no title)';

    // Time line
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

    // Detail fields
    const fieldsEl = document.getElementById('event-detail-fields');
    fieldsEl.innerHTML = '';

    const addField = (label, value) => {
        const row = document.createElement('div');
        row.className = 'event-detail-field';
        row.innerHTML = `<div class="event-detail-label">${label}</div><div class="event-detail-value">${value}</div>`;
        fieldsEl.appendChild(row);
    };

    if (event.location) addField('Location', escHtml(event.location));

    if (event.description) {
        addField('Description', escHtml(event.description).replace(/\n/g, '<br>'));
    }

    if (meta.attendees?.length) {
        const list = meta.attendees.map(a => {
            const name = escHtml(a.name || a.email);
            const resp = a.response ? ` <span class="attendee-resp attendee-resp--${a.response}">${a.response}</span>` : '';
            return `<div class="attendee-row">${name}${resp}</div>`;
        }).join('');
        addField('Attendees', list);
    }

    if (meta.recurrence_rule) addField('Repeats', escHtml(meta.recurrence_rule));

    eventViewReturnTo = document.querySelector('.view.active')?.id?.replace('view-', '') ?? 'calendar';
    switchView('event');
}

function initEventView() {
    document.getElementById('event-back-btn')?.addEventListener('click', () => {
        switchView(eventViewReturnTo);
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('view-event')?.classList.contains('active')) {
            switchView(eventViewReturnTo);
        }
    });

    document.getElementById('calendar-list')?.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (row) openEventView(eventsById.get(row.dataset.id));
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

    await Promise.all([
        loadUser(),
        loadMetrics(),
        loadDashboard(),
    ]);
}

document.addEventListener('DOMContentLoaded', boot);
