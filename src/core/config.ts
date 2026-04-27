import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT:               z.coerce.number().default(3000),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  // Turso (libsql) — use file:./data/assistant.db locally, libsql://... on Vercel
  TURSO_DATABASE_URL: z.string().default('file:./data/assistant.db'),
  TURSO_AUTH_TOKEN:   z.string().optional(),
  SESSION_SECRET:     z.string().default('dev-secret-change-in-production'),
  ANTHROPIC_API_KEY:     z.string().optional(),
  // Monthly token budget cap in USD (default $20)
  MONTHLY_BUDGET_USD:    z.coerce.number().default(20),
  GOOGLE_CLIENT_ID:      z.string().optional(),
  GOOGLE_CLIENT_SECRET:  z.string().optional(),
  GOOGLE_REDIRECT_URI:   z.string().url().optional(),
  GOOGLE_REFRESH_TOKEN:  z.string().optional(),
  GMAIL_LABEL:           z.string().default('INBOX'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nCopy .env.example to .env and fill in the values.');
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export function requireGoogleConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = config;
  if (!GOOGLE_CLIENT_ID)     throw new Error('Google OAuth: Client ID not configured');
  if (!GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth: Client Secret not configured');
  if (!GOOGLE_REDIRECT_URI)  throw new Error('Google OAuth: Redirect URI not configured');
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI };
}
