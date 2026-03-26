import type { Config } from 'drizzle-kit';

export default {
  schema:    './src/db/schema/*.schema.ts',
  out:       './drizzle',
  dialect:   'turso',
  dbCredentials: {
    url:       process.env.TURSO_DATABASE_URL ?? 'file:./data/assistant.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
