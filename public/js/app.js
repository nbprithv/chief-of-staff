import { api }       from './api.js';
import { initBrief } from './brief.js';

// ── Navigation ─────────────────────────────────────────────────────────────────

function initNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;

            // Update nav active state
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Show the correct view
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById(`view-${view}`);
            if (target) target.classList.add('active');
        });
    });
}

// ── Status bar ─────────────────────────────────────────────────────────────────

async function refreshStatus() {
    // DB health
    try {
        await api.health();
        setStatus('db', 'ok', 'DB connected');
    } catch {
        setStatus('db', 'error', 'DB error');
    }

    // Gmail status
    try {
        const { connected, user } = await api.gmailStatus();
        if (connected) {
            setStatus('gmail', 'synced', `${user?.email ?? 'Gmail'} connected`);
            document.getElementById('run-pipeline-btn')?.removeAttribute('disabled');
        } else {
            setStatus('gmail', 'warn', 'Gmail not connected');
        }
    } catch {
        setStatus('gmail', 'warn', 'Gmail not connected');
    }

    // Untriaged count
    try {
        const { count } = await api.emailUntriaged();
        if (count > 0) {
            setStatus('triage', 'warn', `${count} untriaged`);
            updateBadge('nav-inbox', count);
        } else {
            removeStatus('triage');
        }
    } catch { /* ignore */ }
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

// ── Run pipeline ───────────────────────────────────────────────────────────────

function initPipelineButton() {
    const btn = document.getElementById('run-pipeline-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        window.location.href = '/pipeline.html';
    });
}

// ── Task checkbox interactivity ───────────────────────────────────────────────

function initTaskChecks() {
    document.querySelectorAll('.node-check').forEach(check => {
        check.addEventListener('click', e => {
            e.stopPropagation();
            const row = check.closest('.node-row');
            const isChecked = check.classList.contains('checked');
            check.classList.toggle('checked', !isChecked);
            check.textContent = !isChecked ? '✓' : '';
            row?.classList.toggle('done', !isChecked);

            // In production: api.nodeUpdate(nodeId, { status: 'done' })
        });
    });
}

// ── Habit toggle ───────────────────────────────────────────────────────────────

function initHabits() {
    document.querySelectorAll('.habit-row').forEach(row => {
        row.addEventListener('click', () => {
            const status = row.querySelector('.habit-status');
            if (!status) return;
            const isDone = status.classList.contains('row-status-done');
            status.className = isDone ? 'row-status-pending' : 'row-status-done';
            status.textContent = isDone ? '○ pending' : '✓ done';
        });
    });
}

// ── Boot ───────────────────────────────────────────────────────────────────────

async function boot() {
    setMastheadDate();
    initNav();
    initTaskChecks();
    initHabits();
    initPipelineButton();

    // Kick off async work in parallel
    await Promise.all([
        refreshStatus(),
        initBrief(),
    ]);
}

document.addEventListener('DOMContentLoaded', boot);