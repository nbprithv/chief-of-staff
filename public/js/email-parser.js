/**
 * email-parser.js — pure, DOM-free helpers for parsing email bodies.
 * Safe to import in both browser and Node.js (Vitest).
 */

// Matches day names, month names, date formats, and time formats.
export const DATE_TIME_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b|\b\d{1,2}\s*(?:am|pm)\b/gi;

/**
 * Strip all HTML tags from a string, collapsing whitespace.
 * Block-level close tags are replaced with a newline so text stays line-separated.
 */
export function stripHtml(html) {
    return html
        .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|br)[^>]*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>');
}

/**
 * Count <li> occurrences in raw HTML — each one is treated as an action item.
 */
export function countHtmlListItems(html) {
    return (html.match(/<li[\s>]/gi) ?? []).length;
}

/**
 * Count lines in plain text that look like bullet/numbered list items.
 */
export function countPlainListItems(text) {
    return text.split('\n').filter(line => /^[\s]*[-•*]\s|^[\s]*\d+[.)]\s/.test(line)).length;
}

/**
 * Count lines that contain at least one date or time reference.
 * Each line is counted at most once regardless of how many matches it has.
 */
export function countDateLines(text) {
    return text.split('\n').filter(line => {
        DATE_TIME_RE.lastIndex = 0;
        return DATE_TIME_RE.test(line);
    }).length;
}

/**
 * Given a raw email body (HTML or plain text), return:
 *   actions — number of action items (list items)
 *   events  — number of lines that look like scheduled items
 */
export function parseEmailCounts(body) {
    if (!body) return { actions: 0, events: 0 };

    const isHtml = /<[a-z][^>]*>/i.test(body);

    if (isHtml) {
        const actions = countHtmlListItems(body);
        const text    = stripHtml(body);
        const events  = countDateLines(text);
        return { actions, events };
    }

    const actions = countPlainListItems(body);
    const events  = countDateLines(body);
    return { actions, events };
}
