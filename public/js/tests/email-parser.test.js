import { describe, it, expect } from 'vitest';
import {
    parseEmailCounts,
    stripHtml,
    countSectionItems,
} from '../email-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// stripHtml
// ─────────────────────────────────────────────────────────────────────────────

describe('stripHtml()', () => {
    it('removes basic tags, trailing newline from closing block tag', () => {
        expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world\n');
    });

    it('converts block close tags to newlines', () => {
        const out = stripHtml('<p>Line one</p><p>Line two</p>');
        expect(out).toContain('Line one');
        expect(out).toContain('Line two');
        expect(out).not.toBe('Line oneLine two');
    });

    it('decodes common HTML entities', () => {
        expect(stripHtml('a &amp; b &lt;c&gt; &nbsp;d')).toBe('a & b <c>  d');
    });

    it('handles self-closing <br>', () => {
        expect(stripHtml('line1<br>line2<br/>line3')).toBe('line1\nline2\nline3');
    });

    it('returns empty string for empty input', () => {
        expect(stripHtml('')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countSectionItems — plain text
// ─────────────────────────────────────────────────────────────────────────────

describe('countSectionItems() — plain text', () => {
    it('counts items under ACTION REQUIRED heading', () => {
        const text = [
            'ACTION REQUIRED',
            'Sign the permission slip',
            'Return the library book',
            '',
            'CALENDAR EVENTS ADDED',
            'Monday assembly',
        ].join('\n');
        expect(countSectionItems(text).actions).toBe(2);
    });

    it('counts items under CALENDAR EVENTS ADDED heading', () => {
        const text = [
            'CALENDAR EVENTS ADDED',
            'Monday - School Assembly, 9am',
            'Wednesday - Field Trip',
            'Friday - Early Dismissal at 1pm',
        ].join('\n');
        expect(countSectionItems(text).events).toBe(3);
    });

    it('handles both sections in one email', () => {
        const text = [
            'Weekly Digest',
            '',
            'ACTION REQUIRED',
            'Return permission slip by Friday',
            'Pay lunch balance',
            '',
            'CALENDAR EVENTS ADDED',
            'Tuesday - Picture Day',
            'Thursday - Book Fair',
        ].join('\n');
        const { actions, events } = countSectionItems(text);
        expect(actions).toBe(2);
        expect(events).toBe(2);
    });

    it('stops counting action items when the next section heading is reached', () => {
        const text = [
            'ACTION REQUIRED',
            'Item A',
            'Item B',
            'CALENDAR EVENTS ADDED',  // ← section boundary
            'Event X',
        ].join('\n');
        expect(countSectionItems(text).actions).toBe(2);
    });

    it('stops counting events when the next section heading is reached', () => {
        const text = [
            'CALENDAR EVENTS ADDED',
            'Event X',
            'Event Y',
            'ACTION REQUIRED',  // ← section boundary
            'Item A',
        ].join('\n');
        expect(countSectionItems(text).events).toBe(2);
    });

    it('returns zeros when neither heading is present', () => {
        const text = 'Hello families,\n\nHave a great week!\n';
        expect(countSectionItems(text)).toEqual({ actions: 0, events: 0 });
    });

    it('ignores blank lines within a section', () => {
        const text = [
            'ACTION REQUIRED',
            '',
            'Return form',
            '',
            'Bring supplies',
            '',
        ].join('\n');
        expect(countSectionItems(text).actions).toBe(2);
    });

    it('is case-insensitive on heading names', () => {
        const text = [
            'Action Required',
            'Do the thing',
            'Calendar Events Added',
            'Go to the thing',
        ].join('\n');
        const { actions, events } = countSectionItems(text);
        expect(actions).toBe(1);
        expect(events).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// countSectionItems — HTML bodies
// ─────────────────────────────────────────────────────────────────────────────

describe('countSectionItems() — HTML', () => {
    it('counts items in ACTION REQUIRED section of an HTML email', () => {
        const html = `
            <h2>ACTION REQUIRED</h2>
            <ul>
                <li>Sign the permission slip</li>
                <li>Pay the lunch balance</li>
                <li>Update emergency contacts</li>
            </ul>
            <h2>CALENDAR EVENTS ADDED</h2>
            <ul>
                <li>Monday - Assembly</li>
            </ul>
        `;
        expect(countSectionItems(html).actions).toBe(3);
    });

    it('counts items in CALENDAR EVENTS ADDED section of an HTML email', () => {
        const html = `
            <h2>ACTION REQUIRED</h2>
            <ul><li>Return form</li></ul>
            <h2>CALENDAR EVENTS ADDED</h2>
            <ul>
                <li>Tuesday - Field Trip</li>
                <li>Friday - Early Dismissal</li>
            </ul>
        `;
        expect(countSectionItems(html).events).toBe(2);
    });

    it('handles paragraph-based items (not only <li>)', () => {
        const html = `
            <h2>CALENDAR EVENTS ADDED</h2>
            <p>Monday - Assembly at 9am</p>
            <p>Thursday - Book Fair</p>
        `;
        expect(countSectionItems(html).events).toBe(2);
    });

    it('returns zeros when headings are absent from HTML', () => {
        const html = '<p>Thanks for a great week! See you Monday.</p>';
        expect(countSectionItems(html)).toEqual({ actions: 0, events: 0 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEmailCounts — integration
// ─────────────────────────────────────────────────────────────────────────────

describe('parseEmailCounts()', () => {
    it('returns zeros for empty/null body', () => {
        expect(parseEmailCounts('')).toEqual({ actions: 0, events: 0 });
        expect(parseEmailCounts(null)).toEqual({ actions: 0, events: 0 });
        expect(parseEmailCounts(undefined)).toEqual({ actions: 0, events: 0 });
    });

    it('parses a realistic plain-text digest correctly', () => {
        const body = [
            'Galloway School Weekly Digest',
            '',
            'ACTION REQUIRED',
            'Return the signed permission slip by Friday',
            'Update your emergency contact information in the portal',
            '',
            'CALENDAR EVENTS ADDED',
            'Monday, April 7 - Morning Assembly (8:30am)',
            'Wednesday, April 9 - Field Trip to Science Museum',
            'Friday, April 11 - Early Dismissal at 1:00pm',
        ].join('\n');

        const { actions, events } = parseEmailCounts(body);
        expect(actions).toBe(2);
        expect(events).toBe(3);
    });

    it('parses a realistic HTML digest correctly', () => {
        const html = `
            <html><body>
            <h1>Galloway School Weekly Digest</h1>
            <h2>ACTION REQUIRED</h2>
            <ul>
                <li>Return the signed permission slip by Friday</li>
                <li>Update emergency contact information</li>
            </ul>
            <h2>CALENDAR EVENTS ADDED</h2>
            <ul>
                <li>Monday - Morning Assembly</li>
                <li>Wednesday - Field Trip</li>
                <li>Friday - Early Dismissal</li>
            </ul>
            </body></html>
        `;
        const { actions, events } = parseEmailCounts(html);
        expect(actions).toBe(2);
        expect(events).toBe(3);
    });
});
