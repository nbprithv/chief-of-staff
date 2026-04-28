import { google } from 'googleapis';
import { getAuthenticatedClient, getConnectedUser } from './google-oauth.client.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError } from '../../core/errors.js';

export interface SendEmailOptions {
    to:       string | string[];
    subject:  string;
    /** Plain-text body. If `html` is also supplied this becomes the fallback. */
    text:     string;
    /** Optional HTML body — sent as multipart/alternative alongside plain text. */
    html?:    string;
    cc?:      string | string[];
    bcc?:     string | string[];
    replyTo?: string;
}

export interface SendEmailResult {
    messageId: string;
    threadId:  string;
}

// ── RFC 2822 builder ──────────────────────────────────────────────────────────

function addrList(val: string | string[] | undefined): string {
    if (!val) return '';
    return Array.isArray(val) ? val.join(', ') : val;
}

/**
 * Encodes a header value using RFC 2047 UTF-8 quoted-printable
 * so non-ASCII subject lines (e.g. with emoji) are safe.
 */
function encodeHeader(value: string): string {
    // Only encode if non-ASCII chars are present
    if (!/[^\x00-\x7F]/.test(value)) return value;
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    return `=?UTF-8?B?${b64}?=`;
}

function buildRawMessage(from: string, opts: SendEmailOptions): string {
    const toStr  = addrList(opts.to);
    const ccStr  = addrList(opts.cc);
    const bccStr = addrList(opts.bcc);

    const boundary = `boundary_${Date.now().toString(36)}`;
    const hasHtml  = !!opts.html;

    const headers = [
        `From: ${from}`,
        `To: ${toStr}`,
        ccStr  ? `Cc: ${ccStr}`       : null,
        bccStr ? `Bcc: ${bccStr}`     : null,
        opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
        `Subject: ${encodeHeader(opts.subject)}`,
        `MIME-Version: 1.0`,
    ].filter(Boolean).join('\r\n');

    let body: string;

    if (hasHtml) {
        body = [
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            `Content-Type: text/plain; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            '',
            Buffer.from(opts.text, 'utf8').toString('base64'),
            '',
            `--${boundary}`,
            `Content-Type: text/html; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            '',
            Buffer.from(opts.html!, 'utf8').toString('base64'),
            '',
            `--${boundary}--`,
        ].join('\r\n');
    } else {
        body = [
            `Content-Type: text/plain; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            '',
            Buffer.from(opts.text, 'utf8').toString('base64'),
        ].join('\r\n');
    }

    return `${headers}\r\n${body}`;
}

/** base64url encode (URL-safe, no padding) as required by Gmail API */
function base64url(input: string): string {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends an email from the signed-in user's Gmail account.
 *
 * Requires the `gmail.send` OAuth scope — user must have re-authorized
 * after this scope was added.
 *
 * @param userId  The app user ID whose Google tokens to use
 * @param opts    Recipient(s), subject, body, optional CC/BCC/HTML
 */
export async function sendEmail(
    userId: string,
    opts: SendEmailOptions,
): Promise<SendEmailResult> {
    logger.info('[gmail-send] sending email', {
        userId,
        to:      addrList(opts.to),
        subject: opts.subject,
        hasHtml: !!opts.html,
    });

    const client    = await getAuthenticatedClient(userId);
    const userInfo  = await getConnectedUser(userId);
    const fromAddr  = userInfo.email;

    if (!fromAddr) {
        throw new ExternalServiceError('Gmail', 'Could not determine sender email address');
    }

    const raw = buildRawMessage(fromAddr, opts);

    try {
        const gmail = google.gmail({ version: 'v1', auth: client });
        const res   = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: base64url(raw) },
        });

        const messageId = res.data.id    ?? '';
        const threadId  = res.data.threadId ?? '';

        logger.info('[gmail-send] email sent', { userId, messageId, threadId });
        return { messageId, threadId };

    } catch (err: any) {
        const status  = err?.response?.status ?? err?.status ?? null;
        const message = err?.response?.data?.error?.message ?? err?.message ?? String(err);

        logger.error('[gmail-send] Gmail API error', {
            userId,
            status,
            message,
            scope: 'If 403, user needs to re-authorize with gmail.send scope',
        });

        throw new ExternalServiceError('Gmail', `Failed to send email: ${message}`);
    }
}
