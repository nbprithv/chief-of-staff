/**
 * email-parser.js — pure, DOM-free helpers for parsing email bodies.
 * Safe to import in both browser and Node.js (Vitest).
 */

const HEADING_ACTION = /action\s+required/i;
const HEADING_EVENT  = /calendar\s+events?\s*(added)?/i;

// Any known section heading — used to detect when a section ends.
function isSectionHeading(line) {
    return HEADING_ACTION.test(line) || HEADING_EVENT.test(line);
}

/**
 * Strip all HTML tags from a string.
 * Block-level close tags become newlines so content stays line-separated.
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
 * Scan plain text for "ACTION REQUIRED" and "CALENDAR EVENTS ADDED" sections
 * and count the non-blank lines within each one.
 * Works on both plain text and HTML (HTML is stripped first).
 */
export function countSectionItems(body) {
    if (!body) return { actions: 0, events: 0 };

    const isHtml = /<[a-z][^>]*>/i.test(body);
    const text   = isHtml ? stripHtml(body) : body;

    const lines = text.split('\n').map(l => l.trim());

    let section = null;
    let actions = 0;
    let events  = 0;

    for (const line of lines) {
        if (HEADING_ACTION.test(line)) { section = 'actions'; continue; }
        if (HEADING_EVENT.test(line))  { section = 'events';  continue; }

        if (!line) continue; // skip blank lines

        // A line matching a known heading pattern resets the section (handled above).
        // Count non-blank content lines within the current section.
        if (section === 'actions') actions++;
        else if (section === 'events') events++;
    }

    return { actions, events };
}

/**
 * Given a raw email body (HTML or plain text), return pill counts.
 */
export function parseEmailCounts(body) {
    if (!body) return { actions: 0, events: 0 };
    return countSectionItems(body);
}
