export interface EmailAnalysis {
    summary:         string;
    priority:        'high' | 'medium' | 'low';
    actions:         string[];
    key_info:        string | null;
    suggested_reply: string | null;
}

export interface BatchEmailAnalysis {
    summary:      string;
    priority:     'high' | 'medium' | 'low';
    actions:      string[];
    key_info:     string | null;
    email_count:  number;
}

export function buildSingleEmailPrompt(email: {
    sender_name:  string | null;
    sender_email: string;
    subject:      string;
    body_raw:     string | null;
    body_summary?: string | null;
}): string {
    const body = email.body_raw ?? email.body_summary ?? '(no body)';

    return `You are an executive assistant analyzing an email on behalf of your user.

Analyze the email below and respond with ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required JSON shape:
{
  "summary": "2–3 sentence plain-English summary of what this email is about",
  "priority": "high | medium | low",
  "actions": ["list of specific action items the recipient needs to take, if any"],
  "key_info": "any important dates, amounts, deadlines, or names — null if none",
  "suggested_reply": "a single suggested reply sentence if a reply is warranted — null if not"
}

Priority guide:
- high: requires action today, financial/legal urgency, time-sensitive decision
- medium: needs a response or action within a few days
- low: informational, FYI, automated notification

Email:
From: ${email.sender_name ?? email.sender_email} <${email.sender_email}>
Subject: ${email.subject}
---
${body.slice(0, 3000)}`;
}

export function buildBatchEmailPrompt(emailList: Array<{
    sender_name:  string | null;
    sender_email: string;
    subject:      string;
    body_raw:     string | null;
    body_summary?: string | null;
}>): string {
    const formatted = emailList.map((e, i) => {
        const body = (e.body_raw ?? e.body_summary ?? '(no body)').slice(0, 600);
        return `--- Email ${i + 1} ---
From: ${e.sender_name ?? e.sender_email} <${e.sender_email}>
Subject: ${e.subject}
${body}`;
    }).join('\n\n');

    return `You are an executive assistant analyzing a batch of ${emailList.length} emails on behalf of your user.

Analyze all emails and respond with ONLY a valid JSON object — no markdown, no explanation, no backticks.

Required JSON shape:
{
  "summary": "2–3 sentence overview covering the most important themes across all emails",
  "priority": "high | medium | low — based on the most urgent email in the batch",
  "actions": ["top action items across all emails, ordered by urgency, max 8"],
  "key_info": "important dates, amounts, or deadlines across all emails — null if none",
  "email_count": ${emailList.length}
}

Emails:
${formatted}`;
}