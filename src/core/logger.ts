import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

const MIN_LEVEL: Level = config.NODE_ENV === 'production' ? 'info' : 'debug';

function log(level: Level, message: string, data?: unknown) {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;

  const entry = {
    ts:    new Date().toISOString(),
    level,
    msg:   message,
    ...(data ? { data } : {}),
  };

  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
  info:  (msg: string, data?: unknown) => log('info',  msg, data),
  warn:  (msg: string, data?: unknown) => log('warn',  msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
};
