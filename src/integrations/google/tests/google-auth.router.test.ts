import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { errorHandler } from '../../../core/middleware/error-handler';
import { ExternalServiceError } from '../../../core/errors';

// ── Mock OAuth client functions ───────────────────────────────────────────────

const mockGenerateOAuthState    = vi.fn();
const mockVerifyOAuthState      = vi.fn();
const mockGetAuthorizationUrl   = vi.fn();
const mockExchangeCodeForTokens = vi.fn();
const mockGetConnectedUser      = vi.fn();
const mockRevokeAccess          = vi.fn();
const mockLoadTokens            = vi.fn();

vi.mock('../google-oauth.client.js', () => ({
    generateOAuthState:    mockGenerateOAuthState,
    verifyOAuthState:      mockVerifyOAuthState,
    getAuthorizationUrl:   mockGetAuthorizationUrl,
    exchangeCodeForTokens: mockExchangeCodeForTokens,
    getConnectedUser:      mockGetConnectedUser,
    revokeAccess:          mockRevokeAccess,
}));

vi.mock('../token-store.js', () => ({
    loadTokens: mockLoadTokens,
}));

const { googleAuthRouter } = await import('../google-auth.router.js');

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp() {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(googleAuthRouter);
    return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /integrations/google/auth
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /integrations/google/auth', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('redirects to the Google authorization URL', async () => {
        mockGenerateOAuthState.mockReturnValue('nonce.sig');
        mockGetAuthorizationUrl.mockReturnValue('https://accounts.google.com/consent?state=nonce.sig');

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/integrations/google/auth' });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('accounts.google.com');
    });

    it('generates a state token before building the URL', async () => {
        mockGenerateOAuthState.mockReturnValue('fresh-state');
        mockGetAuthorizationUrl.mockReturnValue('https://accounts.google.com/...');

        const app = await buildApp();
        await app.inject({ method: 'GET', url: '/integrations/google/auth' });

        expect(mockGenerateOAuthState).toHaveBeenCalledOnce();
        expect(mockGetAuthorizationUrl).toHaveBeenCalledWith('fresh-state');
    });

    it('returns 502 when Google config is missing', async () => {
        mockGenerateOAuthState.mockReturnValue('s');
        mockGetAuthorizationUrl.mockImplementation(() => {
            throw new ExternalServiceError('Google OAuth', 'Client ID not configured');
        });

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/integrations/google/auth' });

        expect(res.statusCode).toBe(502);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /integrations/google/callback
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /integrations/google/callback', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    // Helper: prime the router's pendingStates map by going through /auth first
    async function primeState(app: Awaited<ReturnType<typeof buildApp>>, state: string) {
        mockGenerateOAuthState.mockReturnValue(state);
        mockVerifyOAuthState.mockReturnValue(true);
        mockGetAuthorizationUrl.mockReturnValue('https://accounts.google.com/...');
        await app.inject({ method: 'GET', url: '/integrations/google/auth' });
    }

    it('redirects to /?auth=success on valid callback', async () => {
        const app   = await buildApp();
        const state = 'valid.state';
        await primeState(app, state);

        mockExchangeCodeForTokens.mockResolvedValue({});
        mockGetConnectedUser.mockResolvedValue({ email: 'user@gmail.com', name: 'User' });

        const res = await app.inject({
            method: 'GET',
            url:    `/integrations/google/callback?code=auth_code&state=${state}`,
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('auth=success');
        expect(res.headers.location).toContain('user%40gmail.com');
    });

    it('redirects to /?auth=denied when user denies consent', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'GET',
            url:    '/integrations/google/callback?error=access_denied&state=x',
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('auth=denied');
        expect(res.headers.location).toContain('access_denied');
    });

    it('returns 400 for invalid state signature', async () => {
        mockVerifyOAuthState.mockReturnValue(false);

        const app = await buildApp();
        const res = await app.inject({
            method: 'GET',
            url:    '/integrations/google/callback?code=x&state=bad.state',
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INVALID_STATE');
    });

    it('returns 400 for missing state', async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: 'GET',
            url:    '/integrations/google/callback?code=x',
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INVALID_STATE');
    });

    it('returns 400 for expired state', async () => {
        // State passes signature check but was never registered (simulates expiry)
        mockVerifyOAuthState.mockReturnValue(true);

        const app = await buildApp();
        const res = await app.inject({
            method: 'GET',
            url:    '/integrations/google/callback?code=x&state=valid.sig',
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('STATE_EXPIRED');
    });

    it('returns 400 when code is missing but state is valid', async () => {
        const app   = await buildApp();
        const state = 'nocode.state';
        await primeState(app, state);

        const res = await app.inject({
            method: 'GET',
            url:    `/integrations/google/callback?state=${state}`,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('MISSING_CODE');
    });

    it('redirects to /?auth=error when token exchange fails', async () => {
        const app   = await buildApp();
        const state = 'fail.state';
        await primeState(app, state);

        mockExchangeCodeForTokens.mockRejectedValue(new Error('invalid_grant'));

        const res = await app.inject({
            method: 'GET',
            url:    `/integrations/google/callback?code=bad_code&state=${state}`,
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain('auth=error');
        expect(res.headers.location).toContain('invalid_grant');
    });

    it('does not reuse a state token (one-time use)', async () => {
        const app   = await buildApp();
        const state = 'onetime.state';
        await primeState(app, state);

        mockExchangeCodeForTokens.mockResolvedValue({});
        mockGetConnectedUser.mockResolvedValue({ email: 'u@g.com', name: 'U' });

        // First use — should succeed
        const res1 = await app.inject({
            method: 'GET',
            url:    `/integrations/google/callback?code=code1&state=${state}`,
        });
        expect(res1.statusCode).toBe(302);
        expect(res1.headers.location).toContain('auth=success');

        // Second use — state is gone, should fail
        const res2 = await app.inject({
            method: 'GET',
            url:    `/integrations/google/callback?code=code2&state=${state}`,
        });
        expect(res2.statusCode).toBe(400);
        expect(res2.json().error.code).toBe('STATE_EXPIRED');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /integrations/google/status
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /integrations/google/status', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns connected:false when no tokens are stored', async () => {
        mockLoadTokens.mockReturnValue(null);

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/integrations/google/status' });

        expect(res.statusCode).toBe(200);
        expect(res.json().connected).toBe(false);
        expect(res.json().user).toBeNull();
    });

    it('returns connected:true with user info when tokens are valid', async () => {
        mockLoadTokens.mockReturnValue({ access_token: 'tok', refresh_token: 'ref' });
        mockGetConnectedUser.mockResolvedValue({ email: 'user@gmail.com', name: 'User', picture: null });

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/integrations/google/status' });

        expect(res.statusCode).toBe(200);
        expect(res.json().connected).toBe(true);
        expect(res.json().user.email).toBe('user@gmail.com');
    });

    it('returns connected:false with stale:true when tokens are invalid', async () => {
        mockLoadTokens.mockReturnValue({ access_token: 'stale_tok', refresh_token: 'ref' });
        mockGetConnectedUser.mockRejectedValue(new Error('Token revoked'));

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/integrations/google/status' });

        expect(res.statusCode).toBe(200);
        expect(res.json().connected).toBe(false);
        expect(res.json().stale).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /integrations/google/disconnect
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /integrations/google/disconnect', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns disconnected:true on success', async () => {
        mockRevokeAccess.mockResolvedValue(undefined);

        const app = await buildApp();
        const res = await app.inject({ method: 'DELETE', url: '/integrations/google/disconnect' });

        expect(res.statusCode).toBe(200);
        expect(res.json().disconnected).toBe(true);
    });

    it('calls revokeAccess', async () => {
        mockRevokeAccess.mockResolvedValue(undefined);

        const app = await buildApp();
        await app.inject({ method: 'DELETE', url: '/integrations/google/disconnect' });

        expect(mockRevokeAccess).toHaveBeenCalledOnce();
    });
});