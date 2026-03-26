import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
    getAuthorizationUrl,
    exchangeCodeForTokens,
    getConnectedUser,
    revokeAccess,
    generateOAuthState,
    verifyOAuthState,
} from './google-oauth.client.js';
import { gmailSyncService } from './gmail-sync.service.js';
import { calendarSyncService } from './calendar-sync.service.js';
import { loadTokens } from './token-store';
import { logger } from '../../core/logger';
import { ExternalServiceError, AppError } from '../../core/errors';
import { config } from '../../core/config';
import { db } from '../../db/client.js';
import { emails } from '../../db/schema/emails.schema.js';
import { nodes } from '../../db/schema/nodes.schema.js';

// In-memory store for pending state tokens (valid for 10 minutes)
const pendingStates = new Map<string, number>();

const STATE_TTL_MS = 10 * 60 * 1000;

export async function googleAuthRouter(app: FastifyInstance) {

    // ── GET /integrations/google/auth ─────────────────────────────────────────
    // Initiates the OAuth flow. Redirects the browser to Google's consent page.
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
    // Google redirects here after the user grants/denies consent.
    app.get('/integrations/google/callback', async (req, reply) => {
        const { code, state, error } = req.query as Record<string, string>;

        // User denied access
        if (error) {
            logger.warn('Google OAuth denied by user', { error });
            return reply.redirect(`/login?auth=denied&reason=${encodeURIComponent(error)}`);
        }

        // Validate state (CSRF check)
        if (!state || !verifyOAuthState(state)) {
            logger.warn('OAuth state mismatch — possible CSRF attempt');
            return reply.status(400).send({
                error: { code: 'INVALID_STATE', message: 'Invalid OAuth state parameter' },
            });
        }

        // Check state hasn't expired
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
            await exchangeCodeForTokens(code);
            const user = await getConnectedUser();
            logger.info('Google OAuth successful', { email: user.email });

            // Clear stale data then kick off a fresh background sync.
            // We don't await so the browser redirect is instant.
            db.delete(emails).returning();
            db.delete(nodes).where(eq(nodes.type, 'event')).returning();

            const timeMin = new Date(Date.now() - 30  * 24 * 60 * 60 * 1000).toISOString();
            const timeMax = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

            const DIGEST_QUERY = '(in:sent OR in:drafts) subject:"Galloway School Digest"';

            Promise.all([
                gmailSyncService.sync({ query: DIGEST_QUERY, maxEmails: 100 }),
                calendarSyncService.sync({ maxResults: 250, timeMin, timeMax }),
            ]).then(([emails, cal]) => {
                logger.info('Post-login sync complete', { emails, calendar: cal });
            }).catch((err: any) => {
                logger.error('Post-login sync failed', { error: err.message });
            });

            return reply.redirect(`/?auth=success&email=${encodeURIComponent(user.email ?? '')}`);
        } catch (err: any) {
            logger.error('OAuth callback failed', { error: err.message });
            return reply.redirect(`/login?auth=error&reason=${encodeURIComponent(err.message)}`);
        }
    });

    // ── GET /integrations/google/status ───────────────────────────────────────
    // Returns the current connection state — called by the UI on load.
    app.get('/integrations/google/status', async (_req, reply) => {
        const tokens = loadTokens();

        if (!tokens) {
            return reply.send({ connected: false, user: null });
        }

        try {
            const user = await getConnectedUser();
            return reply.send({ connected: true, user });
        } catch {
            // Tokens exist but are invalid (e.g. revoked externally)
            return reply.send({ connected: false, user: null, stale: true });
        }
    });

    // ── DELETE /integrations/google/disconnect ────────────────────────────────
    // Revokes access and clears stored tokens. Returns JSON so the UI can
    // redirect client-side to /login after sign-out.
    app.delete('/integrations/google/disconnect', async (_req, reply) => {
        await revokeAccess();
        return reply.send({ disconnected: true, redirect: '/login' });
    });
}