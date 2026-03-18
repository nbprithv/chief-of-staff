const BASE = '/api/v1';

async function request(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return data;
}

export const api = {
    // ── Health ────────────────────────────────────────────────────────────────
    health: () => request('GET', '/health'),

    // ── Gmail ─────────────────────────────────────────────────────────────────
    gmailStatus:   ()      => request('GET',    '/integrations/google/status'),
    gmailLabels:   ()      => request('GET',    '/integrations/google/labels'),
    gmailSync:     (opts)  => request('POST',   '/integrations/google/sync', opts),
    gmailDisconnect: ()    => request('DELETE', '/integrations/google/disconnect'),

    // ── Emails ────────────────────────────────────────────────────────────────
    emails:          (q)   => request('GET',  `${BASE}/emails?${new URLSearchParams(q || {})}`),
    emailUntriaged:  ()    => request('GET',  `${BASE}/emails/untriaged`),
    emailIngest:     (body)=> request('POST', `${BASE}/emails/ingest`, body),
    emailAnalyze:    (id)  => request('POST', `${BASE}/emails/${id}/analyze`),
    emailAnalyzeBatch:(ids)=> request('POST', `${BASE}/emails/analyze/batch`, { ids }),
    emailTriage:     (id)  => request('POST', `${BASE}/emails/${id}/triage`),

    // ── Calendar ──────────────────────────────────────────────────────────────
    calendarSync:   (opts) => request('POST', '/integrations/google/calendars/sync', opts ?? {}),
    calendarList:   ()     => request('GET',  '/integrations/google/calendars'),

    // ── Nodes (tasks, events, projects, ideas) ────────────────────────────────
    nodes:     (q)    => request('GET',    `${BASE}/nodes?${new URLSearchParams(q || {})}`),
    nodeInbox: ()     => request('GET',    `${BASE}/nodes/inbox`),
    nodeDueSoon:(days)=> request('GET',    `${BASE}/nodes/due-soon${days ? `?days=${days}` : ''}`),
    nodeCreate: (body)=> request('POST',   `${BASE}/nodes`, body),
    nodeUpdate: (id, body) => request('PATCH',  `${BASE}/nodes/${id}`, body),
    nodeDelete: (id)  => request('DELETE', `${BASE}/nodes/${id}`),
};