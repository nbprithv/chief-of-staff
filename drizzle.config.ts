import type { Config } from 'drizzle-kit';

export default {
  schema:    './src/db/schema/*.schema.ts',
  out:       './drizzle',
  dialect:   'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? './data/assistant.db',
  },
} satisfies Config;
