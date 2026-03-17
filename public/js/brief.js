import { api } from './api.js';

// ── State ─────────────────────────────────────────────────────────────────────

let briefState = {
    status:    'idle',   // idle | loading | ready | error
    content:   null,
    meta:      null,
    stats:     { dueToday: 0, thisWeek: 0, overdue: 0 },
};

// ── Render helpers ────────────────────────────────────────────────────────────

function renderBanner() {
    const el = document.getElementById('brief-banner');
    if (!el) return;

    if (briefState.status === 'loading') {
        el.innerHTML = `
      <div class="brief-loading">
        <span class="spinner"></span>
        <span>Generating your daily brief…</span>
      </div>`;
        return;
    }

    if (briefState.status === 'error') {
        el.innerHTML = `
      <div>
        <div class="brief-eyebrow">Daily brief</div>
        <div class="brief-headline" style="color:#888;font-size:13px">
          Could not generate brief. Check your API key and try again.
        </div>
        <button class="brief-generate-btn" onclick="window.brief.generate()">↻ Retry</button>
      </div>`;
        return;
    }

    if (briefState.status === 'idle') {
        const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
        el.innerHTML = `
      <div>
        <div class="brief-eyebrow">Daily brief · ${today}</div>
        <div class="brief-headline" style="color:#666;font-style:italic">
          No brief generated yet for today.
        </div>
        <button class="brief-generate-btn" onclick="window.brief.generate()">Generate brief</button>
      </div>`;
        return;
    }

    // ready
    const { content, meta, stats } = briefState;
    el.innerHTML = `
    <div>
      <div class="brief-eyebrow">${meta.eyebrow}</div>
      <div class="brief-headline">${content}</div>
      <div class="brief-meta">${meta.footer}</div>
    </div>
    <div class="brief-stats">
      <div class="brief-stat"><strong>${stats.dueToday}</strong>due today</div>
      <div class="brief-stat"><strong>${stats.thisWeek}</strong>this week</div>
      <div class="brief-stat"><strong>${stats.overdue}</strong>overdue</div>
    </div>`;
}

// ── Generate ──────────────────────────────────────────────────────────────────

async function generate() {
    briefState.status = 'loading';
    renderBanner();

    const t0 = Date.now();

    try {
        // Fetch nodes due soon + inbox from the API
        const [dueSoon, inbox] = await Promise.all([
            api.nodeDueSoon(7).catch(() => ({ nodes: [] })),
            api.nodeInbox().catch(() => ({ nodes: [] })),
        ]);

        const nodes = [
            ...(dueSoon.nodes || []),
            ...(inbox.nodes  || []),
        ];

        // Compute stats
        const now       = new Date();
        const todayEnd  = new Date(now); todayEnd.setHours(23, 59, 59, 999);
        const weekEnd   = new Date(now); weekEnd.setDate(now.getDate() + 7);

        const dueToday = nodes.filter(n => n.due_at && new Date(n.due_at) <= todayEnd).length;
        const thisWeek = nodes.filter(n => n.due_at && new Date(n.due_at) > todayEnd && new Date(n.due_at) <= weekEnd).length;
        const overdue  = nodes.filter(n => n.due_at && new Date(n.due_at) < now && n.status !== 'done').length;

        briefState.stats = { dueToday, thisWeek, overdue };

        // Build the prompt
        const today = new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
        });

        let nodesText = '';
        if (nodes.length > 0) {
            nodesText = nodes.slice(0, 20).map(n =>
                `- [${n.type}][${n.priority}] ${n.title}${n.due_at ? ` (due ${new Date(n.due_at).toLocaleDateString()})` : ''}`
            ).join('\n');
        } else {
            nodesText = '(no tasks or items found)';
        }

        const prompt = `Today is ${today}. You are a personal executive assistant writing a crisp daily brief.

Current tasks and items:
${nodesText}

Write a 2–3 sentence daily brief in a confident, clear editorial voice. Lead with the most urgent item, then summarize the week ahead. Be specific — mention names, amounts, and deadlines. Do not use bullet points. Output only the brief text, nothing else.`;

        // Call Claude
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model:      'claude-sonnet-4-20250514',
                max_tokens: 300,
                messages:   [{ role: 'user', content: prompt }],
            }),
        });

        const data  = await response.json();
        const text  = data.content?.find(b => b.type === 'text')?.text?.trim();
        const ms    = Date.now() - t0;
        const tokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

        if (!text) throw new Error('Empty response from Claude');

        const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        briefState.status  = 'ready';
        briefState.content = text;
        briefState.meta    = {
            eyebrow: `Daily brief · ${dayName}, ${dateStr}`,
            footer:  `Generated ${(ms / 1000).toFixed(1)}s · claude-sonnet · ${tokens} tokens`,
        };

    } catch (err) {
        console.error('Brief generation failed:', err);
        briefState.status = 'error';
    }

    renderBanner();
}

// ── Auto-generate on load ─────────────────────────────────────────────────────

export async function initBrief() {
    renderBanner();       // show idle state immediately
    await generate();     // then generate
}

// Expose for inline onclick
window.brief = { generate };