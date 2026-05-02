import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    logger.error('Application error', {
      code:       error.code,
      message:    error.message,
      statusCode: error.statusCode,
      details:    error.details,
      method:     request.method,
      url:        request.url,
    });
    return reply.status(error.statusCode).send({
      error: {
        code:    error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  // Fastify schema / built-in validation errors (statusCode 4xx)
  const statusCode = 'statusCode' in error ? (error.statusCode ?? 500) : 500;
  if (statusCode >= 400 && statusCode < 500) {
    logger.error('Request error', {
      statusCode,
      message: error.message,
      method:  request.method,
      url:     request.url,
    });
    return reply.status(statusCode).send({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
  }

  logger.error('Unhandled error', { message: error.message, stack: error.stack });
  return reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
