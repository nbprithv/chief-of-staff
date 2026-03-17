import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../../core/config';
import { logger } from '../../core/logger';

export interface TokenSet {
    access_token:  string;
    refresh_token: string;
    expiry_date:   number;   // Unix ms
    token_type:    string;
    scope:         string;
}

// Stored alongside the SQLite database file
const TOKEN_PATH = join(dirname(config.DB_PATH), 'google-tokens.json');

/**
 * Reads persisted tokens from disk.
 * Falls back to GOOGLE_REFRESH_TOKEN in .env if no file exists yet
 * (useful for bootstrapping without going through OAuth each time).
 */
export function loadTokens(): TokenSet | null {
    if (existsSync(TOKEN_PATH)) {
        try {
            const raw = readFileSync(TOKEN_PATH, 'utf8');
            return JSON.parse(raw) as TokenSet;
        } catch (err) {
            logger.warn('Failed to read token file', { path: TOKEN_PATH });
            return null;
        }
    }

    // Bootstrap from env — build a minimal token set
    if (config.GOOGLE_REFRESH_TOKEN) {
        return {
            access_token:  '',
            refresh_token: config.GOOGLE_REFRESH_TOKEN,
            expiry_date:   0,      // force refresh on first use
            token_type:    'Bearer',
            scope:         'https://www.googleapis.com/auth/gmail.readonly',
        };
    }

    return null;
}

/** Writes a fresh token set to disk. */
export function saveTokens(tokens: TokenSet): void {
    mkdirSync(dirname(TOKEN_PATH), { recursive: true });
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
    logger.info('Google tokens saved', { path: TOKEN_PATH });
}

/** Clears persisted tokens (e.g. on disconnect). */
export function clearTokens(): void {
    if (existsSync(TOKEN_PATH)) {
        writeFileSync(TOKEN_PATH, '', 'utf8');
        logger.info('Google tokens cleared');
    }
}

/** Returns true if the access token is expired or about to expire (within 5 min). */
export function isExpired(tokens: TokenSet): boolean {
    if (!tokens.access_token) return true;
    const buffer = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= tokens.expiry_date - buffer;
}