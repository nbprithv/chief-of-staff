import { google } from 'googleapis';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
    createOAuthClient,
    getAuthorizationUrl,
    exchangeCodeForTokens,
    getConnectedUser,
    revokeAccess,
    generateOAuthState,
    verifyOAuthState,
} from './google-oauth.client.js';
import { gmailSyncService } from './gmail-sync.service.js';
import { calendarSyncService } from './calendar-sync.service.js';
import { saveTokens, loadTokens } from './token-store.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError, AppError } from '../../core/errors.js';
import { db } from '../../db/client.js';
import { emails } from '../../db/schema/emails.schema.js';
import { nodes } from '../../db/schema/nodes.schema.js';
import { getUserId, setUserCookie, clearUserCookie } from '../../core/session.js';

// In-memory store for pending state tokens (valid for 10 minutes)
const pendingStates = new Map<string, number>();

const STATE_TTL_MS = 10 * 60 * 1000;

export async function googleAuthRouter(app: FastifyInstance) {

    // ── GET /integrations/google/auth ─────────────────────────────────────────
    app.get('/integrations/google/auth', async (req, reply) => {
        try {
            const state = generateOAuthState();
            pendingStates.set(state, Date.now() + STATE_TTL_MS);

            // Clean up expired states
            for (const [s, exp] of pendingStates) {
                if (Date.now() > exp) pendingStates.delete(s);
            }

            const url = getAuthorizationUrl(state);
            logger.info('Redirecting to Google OAuth');
            return reply.redirect(url);
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new ExternalServiceError('Google OAuth', err.message);
        }
    });

    // ── GET /integrations/google/callback ─────────────────────────────────────
    app.get('/integrations/google/callback', async (req, reply) => {
        const { code, state, error } = req.query as Record<string, string>;

        if (error) {
            logger.warn('Google OAuth denied by user', { error });
            return reply.redirect(`/login?auth=denied&reason=${encodeURIComponent(error)}`);
        }

        if (!state || !verifyOAuthState(state)) {
            logger.warn('OAuth state mismatch — possible CSRF attempt');
            return reply.status(400).send({
                error: { code: 'INVALID_STATE', message: 'Invalid OAuth state parameter' },
            });
        }

        const expiry = pendingStates.get(state);
        if (!expiry || Date.now() > expiry) {
            return reply.status(400).send({
                error: { code: 'STATE_EXPIRED', message: 'OAuth state expired. Please try again.' },
            });
        }
        pendingStates.delete(state);

        if (!code) {
            return reply.status(400).send({
                error: { code: 'MISSING_CODE', message: 'No authorization code received from Google' },
            });
        }

        try {
            // Exchange code → get token set (not yet saved)
            const tokenSet = await exchangeCodeForTokens(code);

            // Identify the user using the fresh tokens
            const tempClient = createOAuthClient();
            tempClient.setCredentials(tokenSet);
            const oauth2   = google.oauth2({ version: 'v2', auth: tempClient });
            const { data } = await oauth2.userinfo.get();
            const userId   = data.email!;

            // Save tokens keyed to this user, then set session cookie
            await saveTokens(tokenSet, userId);
            setUserCookie(reply, userId);

            logger.info('Google OAuth successful', { userId });

            // Clear only this user's stale data, then kick off a background sync
            await db.delete(emails).where(eq(emails.user_id, userId));
            await db.delete(nodes).where(and(eq(nodes.type, 'event'), eq(nodes.user_id, userId)));

            const timeMin = new Date(Date.now() - 30  * 24 * 60 * 60 * 1000).toISOString();
            const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
            const DIGEST_QUERY = '(in:sent OR in:drafts) subject:"Galloway School Digest"';

            Promise.all([
                gmailSyncService.sync({ query: DIGEST_QUERY, maxEmails: 100 }, userId),
                calendarSyncService.sync({ maxResults: 250, timeMin, timeMax }, userId),
            ]).then(([emailRes, calRes]) => {
                logger.info('Post-login sync complete', { emails: emailRes, calendar: calRes, userId });
            }).catch((err: any) => {
                logger.error('Post-login sync failed', { error: err.message, userId });
            });

            return reply.redirect(`/?auth=success&email=${encodeURIComponent(userId)}`);
        } catch (err: any) {
            logger.error('OAuth callback failed', { error: err.message });
            return reply.redirect(`/login?auth=error&reason=${encodeURIComponent(err.message)}`);
        }
    });

    // ── GET /integrations/google/status ───────────────────────────────────────
    app.get('/integrations/google/status', async (req, reply) => {
        const userId = getUserId(req);
        if (!userId) return reply.send({ connected: false, user: null });

        const tokenSet = await loadTokens(userId);
        if (!tokenSet) return reply.send({ connected: false, user: null });

        try {
            const user = await getConnectedUser(userId);
            return reply.send({ connected: true, user });
        } catch {
            return reply.send({ connected: false, user: null, stale: true });
        }
    });

    // ── DELETE /integrations/google/disconnect ────────────────────────────────
    app.delete('/integrations/google/disconnect', async (req, reply) => {
        const userId = getUserId(req);
        if (userId) await revokeAccess(userId);
        clearUserCookie(reply);
        return reply.send({ disconnected: true, redirect: '/login' });
    });
}
