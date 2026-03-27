import { describe, it, expect } from 'vitest';
import {
    parseEmailCounts,
    stripHtml,
    countHtmlListItems,
    countPlainListItems,
    countDateLines,
} from '../email-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// stripHtml
// ─────────────────────────────────────────────────────────────────────────────

describe('stripHtml()', () => {
    it('removes basic tags, trailing newline from closing block tag', () => {
        // <p> open tag → nothing; </p> close tag → newline; <b> inline → nothing
        expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world\n');
    });

    it('converts block close tags to newlines', () => {
        const out = stripHtml('<p>Line one</p><p>Line two</p>');
        expect(out).toContain('Line one');
        expect(out).toContain('Line two');
        // The two lines should be separated by newlines, not run together
        expect(out).not.toBe('Line oneLine two');
    });

    it('decodes common HTML entities', () => {
        expect(stripHtml('a &amp; b &lt;c&gt; &nbsp;d')).toBe('a & b <c>  d');
    });

    it('handles self-closing <br>', () => {
        const out = stripHtml('line1<br>line2<br/>line3');
        expect(out).toBe('line1\nline2\nline3');
    });

    it('returns empty string for empty input', () => {
        expect(stripHtml('')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countHtmlListItems
// ─────────────────────────────────────────────────────────────────────────────

describe('countHtmlListItems()', () => {
    it('counts <li> elements', () => {
        const html = '<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>';
        expect(countHtmlListItems(html)).toBe(3);
    });

    it('counts <li> with attributes', () => {
        const html = '<li class="foo">Item</li>';
        expect(countHtmlListItems(html)).toBe(1);
    });

    it('returns 0 when no list items', () => {
        expect(countHtmlListItems('<p>No list here</p>')).toBe(0);
    });

    it('counts nested list items', () => {
        const html = '<ul><li>Parent<ul><li>Child</li></ul></li></ul>';
        expect(countHtmlListItems(html)).toBe(2);
    });

    it('returns 0 for empty string', () => {
        expect(countHtmlListItems('')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countPlainListItems
// ─────────────────────────────────────────────────────────────────────────────

describe('countPlainListItems()', () => {
    it('counts dash bullet lines', () => {
        const text = '- Item one\n- Item two\n- Item three';
        expect(countPlainListItems(text)).toBe(3);
    });

    it('counts bullet • lines', () => {
        const text = '• First\n• Second';
        expect(countPlainListItems(text)).toBe(2);
    });

    it('counts asterisk bullet lines', () => {
        const text = '* A\n* B';
        expect(countPlainListItems(text)).toBe(2);
    });

    it('counts numbered list lines with period', () => {
        const text = '1. One\n2. Two\n3. Three';
        expect(countPlainListItems(text)).toBe(3);
    });

    it('counts numbered list lines with parenthesis', () => {
        const text = '1) One\n2) Two';
        expect(countPlainListItems(text)).toBe(2);
    });

    it('does not count plain prose lines as list items', () => {
        const text = 'Hello world\nThis is a sentence\nNo bullets here';
        expect(countPlainListItems(text)).toBe(0);
    });

    it('returns 0 for empty string', () => {
        expect(countPlainListItems('')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countDateLines
// ─────────────────────────────────────────────────────────────────────────────

describe('countDateLines()', () => {
    it('matches a day name', () => {
        expect(countDateLines('Join us on Monday for the meeting')).toBe(1);
    });

    it('matches a month + day', () => {
        expect(countDateLines('Event on March 15')).toBe(1);
    });

    it('matches a time like 3:00 PM', () => {
        expect(countDateLines('Starts at 3:00 PM')).toBe(1);
    });

    it('matches a time like 10am', () => {
        expect(countDateLines('Drop-off at 10am')).toBe(1);
    });

    it('matches a date like 1/15', () => {
        expect(countDateLines('Due 1/15')).toBe(1);
    });

    it('counts each matching line once, even with multiple patterns', () => {
        // "Monday, March 15 at 3:00 PM" has 3 patterns but is ONE line
        expect(countDateLines('Monday, March 15 at 3:00 PM')).toBe(1);
    });

    it('counts multiple lines that each have a date reference', () => {
        const text = 'Monday assembly at 8am\nTuesday field trip\nNo date here';
        expect(countDateLines(text)).toBe(2);
    });

    it('does not count plain prose with no dates', () => {
        expect(countDateLines('This email has no scheduling information.')).toBe(0);
    });

    it('returns 0 for empty string', () => {
        expect(countDateLines('')).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEmailCounts — HTML bodies
// ─────────────────────────────────────────────────────────────────────────────

describe('parseEmailCounts() — HTML', () => {
    it('counts list items as actions and date lines as events', () => {
        const html = `
            <ul>
                <li>Return the permission slip</li>
                <li>Bring a water bottle</li>
            </ul>
            <p>Field trip on Friday, May 3</p>
            <p>Pick-up at 2:30 PM</p>
        `;
        const { actions, events } = parseEmailCounts(html);
        expect(actions).toBe(2);
        expect(events).toBeGreaterThanOrEqual(2); // Friday + May 3 on one line, 2:30 PM on another
    });

    it('returns 0 actions when no list items', () => {
        const html = '<p>No list items here, just prose.</p>';
        expect(parseEmailCounts(html).actions).toBe(0);
    });

    it('returns 0 events when no date patterns', () => {
        const html = '<ul><li>Pack your lunch</li><li>Wear comfortable shoes</li></ul>';
        expect(parseEmailCounts(html).events).toBe(0);
    });

    it('handles empty body', () => {
        expect(parseEmailCounts('')).toEqual({ actions: 0, events: 0 });
    });

    it('handles null/undefined body', () => {
        expect(parseEmailCounts(null)).toEqual({ actions: 0, events: 0 });
        expect(parseEmailCounts(undefined)).toEqual({ actions: 0, events: 0 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEmailCounts — plain text bodies
// ─────────────────────────────────────────────────────────────────────────────

describe('parseEmailCounts() — plain text', () => {
    it('counts dash-bullet lines as actions', () => {
        const text = '- Sign the form\n- Return by Friday\nSee you then.';
        expect(parseEmailCounts(text).actions).toBe(2);
    });

    it('counts lines with date/time as events', () => {
        const text = 'Book Fair: Monday, April 8\nPicture Day: Wednesday\nRegular school day.';
        expect(parseEmailCounts(text).events).toBe(2);
    });

    it('does not double-count a line that is both a bullet and has a date', () => {
        // A line like "- Assembly on Monday" counts as 1 action AND 1 event
        const text = '- Assembly on Monday\n- Return permission slip';
        const { actions, events } = parseEmailCounts(text);
        expect(actions).toBe(2);
        expect(events).toBe(1); // only the first bullet has a date
    });

    it('handles plain body with no bullets and no dates', () => {
        const text = 'Thanks for a great week!\nHave a wonderful weekend.';
        expect(parseEmailCounts(text)).toEqual({ actions: 0, events: 0 });
    });
});
