import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    logger.warn('Application error', { code: error.code, message: error.message, details: error.details });
    return reply.status(error.statusCode).send({
      error: {
        code:    error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  // Fastify validation errors
  if ('statusCode' in error && error.statusCode === 400) {
    return reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
  }

  logger.error('Unhandled error', { message: error.message, stack: error.stack });
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
