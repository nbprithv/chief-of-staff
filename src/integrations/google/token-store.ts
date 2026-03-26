import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tokens } from '../../db/schema/tokens.schema.js';
import { logger } from '../../core/logger.js';

export interface TokenSet {
    access_token:  string;
    refresh_token: string;
    expiry_date:   number;   // Unix ms
    token_type:    string;
    scope:         string;
}

function tokenKey(userId: string): string {
    return `google_oauth:${userId}`;
}

/** Reads persisted tokens for a specific user from the database. */
export async function loadTokens(userId: string): Promise<TokenSet | null> {
    try {
        const [row] = await db.select().from(tokens).where(eq(tokens.key, tokenKey(userId)));
        if (row) return JSON.parse(row.value) as TokenSet;
    } catch (err: any) {
        logger.warn('Failed to read tokens from DB', { error: err.message });
    }
    return null;
}

/** Persists a token set for a specific user. */
export async function saveTokens(tokenSet: TokenSet, userId: string): Promise<void> {
    const key = tokenKey(userId);
    await db.insert(tokens)
        .values({ key, value: JSON.stringify(tokenSet) })
        .onConflictDoUpdate({
            target:  tokens.key,
            set:     { value: JSON.stringify(tokenSet), updated_at: new Date().toISOString() },
        });
    logger.info('Google tokens saved to DB', { userId });
}

/** Removes the stored token set for a specific user. */
export async function clearTokens(userId: string): Promise<void> {
    await db.delete(tokens).where(eq(tokens.key, tokenKey(userId)));
    logger.info('Google tokens cleared from DB', { userId });
}

/** Returns true if the access token is expired or expiring within 5 minutes. */
export function isExpired(tokens: TokenSet): boolean {
    if (!tokens.access_token) return true;
    return Date.now() >= tokens.expiry_date - 5 * 60 * 1000;
}
