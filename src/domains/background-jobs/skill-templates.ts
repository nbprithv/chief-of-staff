/**
 * Built-in skill templates — curated prompts users can drop into a job.
 * Users can also write fully custom prompts (skill_id = "custom").
 */

export interface SkillTemplate {
    id:               string;
    name:             string;
    description:      string;
    defaultPrompt:    string;
    suggestedSchedule: string;   // cron expression
    suggestedMaxTokens: number;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
    {
        id:          'daily_brief',
        name:        'Daily Brief',
        description: 'Morning summary of today\'s tasks, events, and priorities.',
        defaultPrompt: `Today is {date}. You are a personal executive assistant writing a crisp morning brief.

Here is the context:
- Upcoming events (next 24 h): {events}
- Tasks due today: {tasks_due_today}
- Overdue tasks: {tasks_overdue}
- Inbox items: {inbox_count} unprocessed

Write a 3–4 sentence morning brief in a confident, clear voice. Lead with the most time-sensitive item, then summarize the day. Be specific — mention titles and times. No bullet points. Output only the brief text.`,
        suggestedSchedule: '0 7 * * *',
        suggestedMaxTokens: 400,
    },
    {
        id:          'week_ahead',
        name:        'Week Ahead',
        description: 'Sunday planning summary of the coming week\'s events and due tasks.',
        defaultPrompt: `Today is {date}. Prepare a week-ahead planning note for the next 7 days.

Upcoming events: {events}
Tasks due this week: {tasks_due_week}

Write 3–5 sentences summarising the week ahead. Highlight any conflicts, heavy days, or important deadlines. Tone: direct executive assistant. Output only the text.`,
        suggestedSchedule: '0 9 * * 0',
        suggestedMaxTokens: 500,
    },
    {
        id:          'inbox_triage',
        name:        'Inbox Triage',
        description: 'Suggests how to handle unprocessed inbox tasks — prioritise, defer, or drop.',
        defaultPrompt: `Today is {date}. Review the following {inbox_count} unprocessed items in the inbox and suggest how to handle each one: prioritise (P0/P1), defer to a specific day, or drop entirely.

Items:
{inbox_items}

Respond with a short list, one item per line, in this format:
[ACTION] Title — reason (max 10 words)

Actions: PRIORITISE, DEFER, DROP. Be decisive.`,
        suggestedSchedule: '0 8 * * 1',
        suggestedMaxTokens: 600,
    },
    {
        id:          'overdue_nudge',
        name:        'Overdue Nudge',
        description: 'Flags overdue tasks and suggests which to tackle first.',
        defaultPrompt: `Today is {date}. The following tasks are overdue:

{tasks_overdue}

Write 2–3 sentences identifying the most critical overdue item and suggesting a simple plan to clear the backlog. Be direct and practical. Output only the text.`,
        suggestedSchedule: '0 9 * * *',
        suggestedMaxTokens: 300,
    },
    {
        id:          'meal_prep_reminder',
        name:        'Meal Prep Reminder',
        description: 'Weekly grocery and meal-prep summary based on planned meals.',
        defaultPrompt: `Today is {date}. Here are the meals planned for the next 7 days:

{meals_week}

Write a brief, practical meal-prep reminder: what to shop for, what to prep in advance, and any timing tips. Keep it to 3–4 sentences. Output only the text.`,
        suggestedSchedule: '0 10 * * 6',
        suggestedMaxTokens: 400,
    },
    {
        id:          'custom',
        name:        'Custom',
        description: 'Write your own prompt from scratch.',
        defaultPrompt: '',
        suggestedSchedule: '0 8 * * *',
        suggestedMaxTokens: 500,
    },
];

export function getTemplate(id: string): SkillTemplate | undefined {
    return SKILL_TEMPLATES.find(t => t.id === id);
}
