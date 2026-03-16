import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT:               z.coerce.number().default(3000),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
  DB_PATH:            z.string().default('./data/assistant.db'),
  ANTHROPIC_API_KEY:  z.string().startsWith('sk-ant-'),
  GOOGLE_CLIENT_ID:      z.string().optional(),
  GOOGLE_CLIENT_SECRET:  z.string().optional(),
  GOOGLE_REDIRECT_URI:   z.string().url().optional(),
  GOOGLE_REFRESH_TOKEN:  z.string().optional(),
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
