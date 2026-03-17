import { google } from 'googleapis';
import { createHash, randomBytes } from 'crypto';
import { requireGoogleConfig, config } from '../../core/config';
import { logger } from '../../core/logger';
import { ExternalServiceError } from '../../core/errors';
import { loadTokens, saveTokens, clearTokens, isExpired } from './token-store';
import type { TokenSet } from './token-store';

// Gmail readonly + email metadata
export const GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];

// ── OAuth client factory ───────────────────────────────────────────────────────

export function createOAuthClient() {
    const { clientId, clientSecret, redirectUri } = requireGoogleConfig();

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── State parameter (CSRF protection) ─────────────────────────────────────────

/**
 * Generates a signed state token to protect the OAuth callback.
 * Format: <random_nonce>.<hmac>
 */
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
        access_type:  'offline',   // gets us a refresh_token
        prompt:       'consent',   // forces refresh_token to be returned even if previously granted
        scope:        GMAIL_SCOPES,
        state,
    });
}

// ── Exchange code for tokens ───────────────────────────────────────────────────

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
    const client = createOAuthClient();

    try {
        const { tokens } = await client.getToken(code);

        if (!tokens.refresh_token) {
            throw new Error(
                'No refresh_token returned. Try revoking access at myaccount.google.com/permissions and re-authorizing.'
            );
        }

        const tokenSet: TokenSet = {
            access_token:  tokens.access_token  ?? '',
            refresh_token: tokens.refresh_token,
            expiry_date:   tokens.expiry_date   ?? Date.now() + 3600 * 1000,
            token_type:    tokens.token_type    ?? 'Bearer',
            scope:         tokens.scope         ?? GMAIL_SCOPES.join(' '),
        };

        saveTokens(tokenSet);
        logger.info('Google OAuth complete — tokens saved');
        return tokenSet;
    } catch (err: any) {
        logger.error('Token exchange failed', { error: err.message });
        throw new ExternalServiceError('Google OAuth', err.message);
    }
}

// ── Get an authenticated client (auto-refreshes if needed) ────────────────────

export async function getAuthenticatedClient() {
    const tokens = loadTokens();

    if (!tokens) {
        throw new ExternalServiceError(
            'Google OAuth',
            'Not authenticated. Visit /integrations/google/auth to connect Gmail.'
        );
    }

    const client = createOAuthClient();
    client.setCredentials(tokens);

    // Refresh if expired
    if (isExpired(tokens)) {
        logger.debug('Access token expired — refreshing');
        try {
            const { credentials } = await client.refreshAccessToken();
            const refreshed: TokenSet = {
                access_token:  credentials.access_token  ?? '',
                refresh_token: credentials.refresh_token ?? tokens.refresh_token,
                expiry_date:   credentials.expiry_date   ?? Date.now() + 3600 * 1000,
                token_type:    credentials.token_type    ?? 'Bearer',
                scope:         credentials.scope         ?? tokens.scope,
            };
            saveTokens(refreshed);
            client.setCredentials(refreshed);
            logger.debug('Access token refreshed');
        } catch (err: any) {
            logger.error('Token refresh failed', { error: err.message });
            throw new ExternalServiceError(
                'Google OAuth',
                'Token refresh failed. Re-authorize at /integrations/google/auth'
            );
        }
    }

    return client;
}

// ── Get authenticated user info ────────────────────────────────────────────────

export async function getConnectedUser() {
    const client  = await getAuthenticatedClient();
    const oauth2  = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    return { email: data.email, name: data.name, picture: data.picture };
}

// ── Disconnect ─────────────────────────────────────────────────────────────────

export async function revokeAccess() {
    const tokens = loadTokens();
    if (tokens?.access_token) {
        const client = createOAuthClient();
        try {
            await client.revokeToken(tokens.access_token);
        } catch {
            // Best-effort — still clear locally even if revocation fails
        }
    }
    clearTokens();
    logger.info('Google access revoked');
}