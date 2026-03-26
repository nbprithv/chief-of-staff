import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tokens } from '../../db/schema/tokens.schema.js';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';

export interface TokenSet {
    access_token:  string;
    refresh_token: string;
    expiry_date:   number;   // Unix ms
    token_type:    string;
    scope:         string;
}

const TOKEN_KEY = 'google_oauth';

/** Reads persisted tokens from the database. Falls back to GOOGLE_REFRESH_TOKEN env var. */
export async function loadTokens(): Promise<TokenSet | null> {
    try {
        const [row] = await db.select().from(tokens).where(eq(tokens.key, TOKEN_KEY));
        if (row) return JSON.parse(row.value) as TokenSet;
    } catch (err: any) {
        logger.warn('Failed to read tokens from DB', { error: err.message });
    }

    // Bootstrap fallback from env — useful for initial setup
    if (config.GOOGLE_REFRESH_TOKEN) {
        return {
            access_token:  '',
            refresh_token: config.GOOGLE_REFRESH_TOKEN,
            expiry_date:   0,
            token_type:    'Bearer',
            scope:         'https://www.googleapis.com/auth/gmail.readonly',
        };
    }

    return null;
}

/** Persists a token set to the database. */
export async function saveTokens(tokenSet: TokenSet): Promise<void> {
    await db.insert(tokens)
        .values({ key: TOKEN_KEY, value: JSON.stringify(tokenSet) })
        .onConflictDoUpdate({
            target:  tokens.key,
            set:     { value: JSON.stringify(tokenSet), updated_at: new Date().toISOString() },
        });
    logger.info('Google tokens saved to DB');
}

/** Removes the stored token set. */
export async function clearTokens(): Promise<void> {
    await db.delete(tokens).where(eq(tokens.key, TOKEN_KEY));
    logger.info('Google tokens cleared from DB');
}

/** Returns true if the access token is expired or expiring within 5 minutes. */
export function isExpired(tokens: TokenSet): boolean {
    if (!tokens.access_token) return true;
    return Date.now() >= tokens.expiry_date - 5 * 60 * 1000;
}
