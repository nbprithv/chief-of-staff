import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalServiceError } from '../../../core/errors.js';

// ── Mock googleapis ───────────────────────────────────────────────────────────

const mockGetToken        = vi.fn();
const mockRefreshAccess   = vi.fn();
const mockRevokeToken     = vi.fn();
const mockGenerateAuthUrl = vi.fn();
const mockSetCredentials  = vi.fn();
const mockUserinfoGet     = vi.fn();

vi.mock('googleapis', () => ({
    google: {
        auth: {
            OAuth2: vi.fn().mockImplementation(() => ({
                generateAuthUrl:    mockGenerateAuthUrl,
                getToken:           mockGetToken,
                setCredentials:     mockSetCredentials,
                refreshAccessToken: mockRefreshAccess,
                revokeToken:        mockRevokeToken,
            })),
        },
        oauth2: vi.fn().mockReturnValue({
            userinfo: { get: mockUserinfoGet },
        }),
    },
}));

// ── Mock config ───────────────────────────────────────────────────────────────

vi.mock('../../../core/config.js', () => ({
    requireGoogleConfig: vi.fn().mockReturnValue({
        clientId:    'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/auth/google/callback',
    }),
    config: {
        google: {
            clientId:    'test-client-id',
            clientSecret: 'test-client-secret',
            redirectUri: 'http://localhost:3000/auth/google/callback',
        },
    },
}));

// ── Mock token-store ──────────────────────────────────────────────────────────

const mockLoadTokens  = vi.fn();
const mockSaveTokens  = vi.fn();
const mockClearTokens = vi.fn();
const mockIsExpired   = vi.fn();

vi.mock('../token-store.js', () => ({
    loadTokens:  mockLoadTokens,
    saveTokens:  mockSaveTokens,
    clearTokens: mockClearTokens,
    isExpired:   mockIsExpired,
}));

// Import after mocks
const {
    generateOAuthState,
    verifyOAuthState,
    getAuthorizationUrl,
    exchangeCodeForTokens,
    getAuthenticatedClient,
    getConnectedUser,
    revokeAccess,
} = await import('../google-oauth.client.js');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TOKENS = {
    access_token:  'access_abc',
    refresh_token: 'refresh_xyz',
    expiry_date:   Date.now() + 3600 * 1000,
    token_type:    'Bearer',
    scope:         'https://www.googleapis.com/auth/gmail.readonly',
};

// ─────────────────────────────────────────────────────────────────────────────
// generateOAuthState() / verifyOAuthState()
// ─────────────────────────────────────────────────────────────────────────────

describe('generateOAuthState() / verifyOAuthState()', () => {
    it('generates a non-empty state string', () => {
        const state = generateOAuthState();
        expect(typeof state).toBe('string');
        expect(state.length).toBeGreaterThan(10);
    });

    it('includes a dot-separated nonce and signature', () => {
        const state  = generateOAuthState();
        const parts  = state.split('.');
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
    });

    it('verifies a freshly generated state as valid', () => {
        const state = generateOAuthState();
        expect(verifyOAuthState(state)).toBe(true);
    });

    it('rejects a tampered nonce', () => {
        const state  = generateOAuthState();
        const [, sig] = state.split('.');
        expect(verifyOAuthState(`tampered.${sig}`)).toBe(false);
    });

    it('rejects a tampered signature', () => {
        const state   = generateOAuthState();
        const [nonce] = state.split('.');
        expect(verifyOAuthState(`${nonce}.tampered`)).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(verifyOAuthState('')).toBe(false);
    });

    it('rejects a string with no dot separator', () => {
        expect(verifyOAuthState('nodothere')).toBe(false);
    });

    it('generates unique states on each call', () => {
        const s1 = generateOAuthState();
        const s2 = generateOAuthState();
        expect(s1).not.toBe(s2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAuthorizationUrl()
// ─────────────────────────────────────────────────────────────────────────────

describe('getAuthorizationUrl()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('calls generateAuthUrl on the OAuth2 client', () => {
        mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?...');
        const url = getAuthorizationUrl('test-state');
        expect(mockGenerateAuthUrl).toHaveBeenCalledOnce();
        expect(url).toContain('accounts.google.com');
    });

    it('passes access_type=offline and prompt=consent', () => {
        mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/...');
        getAuthorizationUrl('test-state');
        const call = mockGenerateAuthUrl.mock.calls[0][0];
        expect(call.access_type).toBe('offline');
        expect(call.prompt).toBe('consent');
    });

    it('includes the state parameter', () => {
        mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/...');
        getAuthorizationUrl('my-state-token');
        const call = mockGenerateAuthUrl.mock.calls[0][0];
        expect(call.state).toBe('my-state-token');
    });

    it('includes Gmail scopes', () => {
        mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/...');
        getAuthorizationUrl('test-state');
        const call = mockGenerateAuthUrl.mock.calls[0][0];
        expect(call.scope).toContain('https://www.googleapis.com/auth/gmail.readonly');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// exchangeCodeForTokens()
// ─────────────────────────────────────────────────────────────────────────────

describe('exchangeCodeForTokens()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('exchanges code and returns a token set', async () => {
        mockGetToken.mockResolvedValue({ tokens: {
                access_token:  'access_abc',
                refresh_token: 'refresh_xyz',
                expiry_date:   Date.now() + 3600000,
                token_type:    'Bearer',
                scope:         'gmail.readonly',
            }});

        const result = await exchangeCodeForTokens('auth-code-123');
        expect(result.access_token).toBe('access_abc');
        expect(result.refresh_token).toBe('refresh_xyz');
    });

    it('throws ExternalServiceError when no refresh_token is returned', async () => {
        mockGetToken.mockResolvedValue({ tokens: { access_token: 'tok' } });
        await expect(exchangeCodeForTokens('code')).rejects.toThrow(ExternalServiceError);
    });

    it('throws ExternalServiceError when getToken fails', async () => {
        mockGetToken.mockRejectedValue(new Error('invalid_grant'));
        await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(ExternalServiceError);
    });

    it('includes the original error message', async () => {
        mockGetToken.mockRejectedValue(new Error('Token exchange network error'));
        await expect(exchangeCodeForTokens('code')).rejects.toThrow('Token exchange network error');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAuthenticatedClient()
// ─────────────────────────────────────────────────────────────────────────────

describe('getAuthenticatedClient()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('throws ExternalServiceError when no tokens are stored', async () => {
        mockLoadTokens.mockReturnValue(null);
        await expect(getAuthenticatedClient()).rejects.toThrow(ExternalServiceError);
    });

    it('returns client without refreshing when token is valid', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockIsExpired.mockReturnValue(false);

        const client = await getAuthenticatedClient();
        expect(client).toBeDefined();
        expect(mockRefreshAccess).not.toHaveBeenCalled();
    });

    it('refreshes the token when expired', async () => {
        mockLoadTokens.mockReturnValue({ ...VALID_TOKENS, expiry_date: Date.now() - 1000 });
        mockIsExpired.mockReturnValue(true);
        mockRefreshAccess.mockResolvedValue({ credentials: {
                access_token:  'new_access',
                refresh_token: 'new_refresh',
                expiry_date:   Date.now() + 3600000,
                token_type:    'Bearer',
                scope:         'gmail.readonly',
            }});

        await getAuthenticatedClient();
        expect(mockRefreshAccess).toHaveBeenCalledOnce();
        expect(mockSaveTokens).toHaveBeenCalledOnce();
    });

    it('saves refreshed tokens to store', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockIsExpired.mockReturnValue(true);
        mockRefreshAccess.mockResolvedValue({ credentials: {
                access_token: 'refreshed', refresh_token: 'ref2',
                expiry_date: Date.now() + 3600000, token_type: 'Bearer', scope: 'x',
            }});

        await getAuthenticatedClient();
        expect(mockSaveTokens.mock.calls[0][0].access_token).toBe('refreshed');
    });

    it('throws ExternalServiceError when token refresh fails', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockIsExpired.mockReturnValue(true);
        mockRefreshAccess.mockRejectedValue(new Error('invalid_grant'));

        await expect(getAuthenticatedClient()).rejects.toThrow(ExternalServiceError);
    });

    it('sets credentials on the client before returning', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockIsExpired.mockReturnValue(false);

        await getAuthenticatedClient();
        expect(mockSetCredentials).toHaveBeenCalledWith(VALID_TOKENS);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getConnectedUser()
// ─────────────────────────────────────────────────────────────────────────────

describe('getConnectedUser()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns user info from Google', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockIsExpired.mockReturnValue(false);
        mockUserinfoGet.mockResolvedValue({
            data: { email: 'user@gmail.com', name: 'Test User', picture: 'https://photo.url' },
        });

        const user = await getConnectedUser();
        expect(user.email).toBe('user@gmail.com');
        expect(user.name).toBe('Test User');
        expect(user.picture).toBe('https://photo.url');
    });

    it('propagates auth errors', async () => {
        mockLoadTokens.mockReturnValue(null);
        await expect(getConnectedUser()).rejects.toThrow(ExternalServiceError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// revokeAccess()
// ─────────────────────────────────────────────────────────────────────────────

describe('revokeAccess()', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('revokes the access token at Google', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockRevokeToken.mockResolvedValue({});

        await revokeAccess();
        expect(mockRevokeToken).toHaveBeenCalledWith(VALID_TOKENS.access_token);
    });

    it('always clears local tokens even if revocation fails', async () => {
        mockLoadTokens.mockReturnValue(VALID_TOKENS);
        mockRevokeToken.mockRejectedValue(new Error('network error'));

        await revokeAccess();
        expect(mockClearTokens).toHaveBeenCalledOnce();
    });

    it('clears tokens even when no tokens exist', async () => {
        mockLoadTokens.mockReturnValue(null);

        await revokeAccess();
        expect(mockClearTokens).toHaveBeenCalledOnce();
        expect(mockRevokeToken).not.toHaveBeenCalled();
    });
});