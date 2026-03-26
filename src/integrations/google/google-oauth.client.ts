import { google } from 'googleapis';
import { createHash, randomBytes } from 'crypto';
import { requireGoogleConfig, config } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { ExternalServiceError } from '../../core/errors.js';
import { loadTokens, saveTokens, clearTokens, isExpired } from './token-store.js';
import type { TokenSet } from './token-store.js';

// Gmail + Calendar readonly + user info
export const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

// ── OAuth client factory ───────────────────────────────────────────────────────

export function createOAuthClient() {
    const { clientId, clientSecret, redirectUri } = requireGoogleConfig();
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── State parameter (CSRF protection) ─────────────────────────────────────────

export function generateOAuthState(): string {
    const nonce = randomBytes(16).toString('hex');
    const sig   = createHash('sha256')
        .update(`${nonce}:${config.SESSION_SECRET}`)
        .digest('hex')
        .slice(0, 16);
    return `${nonce}.${sig}`;
}

export function verifyOAuthState(state: string): boolean {
    const [nonce, sig] = state.split('.');
    if (!nonce || !sig) return false;
    const expected = createHash('sha256')
        .update(`${nonce}:${config.SESSION_SECRET}`)
        .digest('hex')
        .slice(0, 16);
    return sig === expected;
}

// ── Authorization URL ──────────────────────────────────────────────────────────

export function getAuthorizationUrl(state: string): string {
    const client = createOAuthClient();
    return client.generateAuthUrl({
        access_type: 'offline',
        prompt:      'consent',
        scope:       GMAIL_SCOPES,
        state,
    });
}

// ── Exchange code for tokens (does NOT persist — caller is responsible) ────────

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
    const client = createOAuthClient();

    try {
        const { tokens } = await client.getToken(code);

        if (!tokens.refresh_token) {
            throw new Error(
                'No refresh_token returned. Try revoking access at myaccount.google.com/permissions and re-authorizing.'
            );
        }

        return {
            access_token:  tokens.access_token  ?? '',
            refresh_token: tokens.refresh_token,
            expiry_date:   tokens.expiry_date   ?? Date.now() + 3600 * 1000,
            token_type:    tokens.token_type    ?? 'Bearer',
            scope:         tokens.scope         ?? GMAIL_SCOPES.join(' '),
        };
    } catch (err: any) {
        logger.error('Token exchange failed', { error: err.message });
        throw new ExternalServiceError('Google OAuth', err.message);
    }
}

// ── Get an authenticated client (auto-refreshes if needed) ────────────────────

export async function getAuthenticatedClient(userId: string) {
    const tokenSet = await loadTokens(userId);

    if (!tokenSet) {
        throw new ExternalServiceError(
            'Google OAuth',
            'Not authenticated. Visit /integrations/google/auth to connect.'
        );
    }

    const client = createOAuthClient();
    client.setCredentials(tokenSet);

    if (isExpired(tokenSet)) {
        logger.debug('Access token expired — refreshing', { userId });
        try {
            const { credentials } = await client.refreshAccessToken();
            const refreshed: TokenSet = {
                access_token:  credentials.access_token  ?? '',
                refresh_token: credentials.refresh_token ?? tokenSet.refresh_token,
                expiry_date:   credentials.expiry_date   ?? Date.now() + 3600 * 1000,
                token_type:    credentials.token_type    ?? 'Bearer',
                scope:         credentials.scope         ?? tokenSet.scope,
            };
            await saveTokens(refreshed, userId);
            client.setCredentials(refreshed);
            logger.debug('Access token refreshed', { userId });
        } catch (err: any) {
            logger.error('Token refresh failed', { error: err.message, userId });
            throw new ExternalServiceError('Google OAuth', 'Token refresh failed. Re-authorize at /integrations/google/auth');
        }
    }

    return client;
}

// ── Get authenticated user info ────────────────────────────────────────────────

export async function getConnectedUser(userId: string) {
    const client   = await getAuthenticatedClient(userId);
    const oauth2   = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return { email: data.email, name: data.name, picture: data.picture };
}

// ── Disconnect ─────────────────────────────────────────────────────────────────

export async function revokeAccess(userId: string) {
    const tokenSet = await loadTokens(userId);
    if (tokenSet?.access_token) {
        const client = createOAuthClient();
        try {
            await client.revokeToken(tokenSet.access_token);
        } catch {
            // Best-effort — still clear locally even if revocation fails
        }
    }
    await clearTokens(userId);
    logger.info('Google access revoked', { userId });
}
